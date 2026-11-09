"""Train the landmark gesture classifier and export it for the browser.

Data: datasets/landmarks/<label>/*.json, written by the admin capture page:
    {"signer_id": "s01", "device": "phone", "label": "WATER", "consent": true,
     "frames": [[x0,y0,z0, ... x20,y20,z20], ...]}      # raw MediaPipe coords, 0-1

Run:  python training/train_landmarks.py            (real data)
      python training/train_landmarks.py --demo     (synthetic data, only to test the pipeline;
                                                    writes to a temp folder, never to the app)
Output: frontend/models/gesture-mlp.json  + training/reports/report.txt
"""
import argparse
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from sklearn.metrics import accuracy_score, confusion_matrix
from sklearn.model_selection import GroupShuffleSplit
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import LabelEncoder

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "datasets" / "landmarks"
OUT_MODEL = ROOT / "frontend" / "models" / "gesture-mlp.json"
REPORT_DIR = ROOT / "training" / "reports"
NUM_LM = 21
MIN_SIGNERS = 2


def normalize(frame):
    """Same as SLCore.normalizeLandmarks in frontend/sl-core.js. frame: (21,3) -> (63,) or None."""
    pts = np.asarray(frame, dtype=np.float32).reshape(NUM_LM, 3)
    pts = pts - pts[0]
    m = np.linalg.norm(pts, axis=1).max()
    if not m > 1e-6:
        return None
    return (pts / m).reshape(-1)


def load_dataset(data_dir):
    X, y, groups = [], [], []
    skipped = 0
    for path in sorted(Path(data_dir).glob("*/*.json")):
        rec = json.loads(path.read_text(encoding="utf-8"))
        if not rec.get("consent"):
            skipped += 1  # never train on data without consent
            continue
        for frame in rec["frames"]:
            f = normalize(np.asarray(frame).reshape(NUM_LM, 3))
            if f is not None:
                X.append(f)
                y.append(rec["label"])
                groups.append(rec["signer_id"])
    if skipped:
        print(f"Skipped {skipped} recordings without consent")
    return np.array(X, dtype=np.float32), np.array(y), np.array(groups)


# ---- augmentation (works on raw-scale 63-vectors that are already normalized) ----
# Strength 1.0 is meant for real, varied recordings. With very few signers or near-identical samples use
# a lower --aug-strength: too much distortion makes similar signs overlap and the model under-confident.
AUG = {"rotate_deg": 15.0, "scale": 0.10, "stretch": 0.06, "noise": 0.01, "mirror_p": 0.5,
       "lowres_p": 0.3, "lowres_steps": (0.01, 0.02), "lowres_jitter": 0.004}


def augment(x, rng, strength=1.0):
    """One augmented copy of a normalized (63,) sample."""
    pts = x.reshape(NUM_LM, 3).copy()
    # rotation in the image plane and a small tilt
    a = np.deg2rad(rng.uniform(-AUG["rotate_deg"], AUG["rotate_deg"]) * strength)
    c, s = np.cos(a), np.sin(a)
    pts[:, :2] = pts[:, :2] @ np.array([[c, -s], [s, c]], dtype=np.float32).T
    # random scale + anisotropic stretch (camera distance / aspect ratio)
    pts *= 1 + rng.uniform(-AUG["scale"], AUG["scale"]) * strength
    pts[:, 0] *= 1 + rng.uniform(-AUG["stretch"], AUG["stretch"]) * strength
    # mirror (left hand vs right hand)
    if rng.random() < AUG["mirror_p"]:
        pts[:, 0] *= -1
    # landmark noise
    pts += rng.normal(0, AUG["noise"] * strength, pts.shape).astype(np.float32)
    # blur / low-resolution camera: coarse quantisation + extra jitter
    if strength > 0 and rng.random() < AUG["lowres_p"]:
        step = rng.choice(AUG["lowres_steps"]) * strength
        pts = np.round(pts / step) * step + rng.normal(0, AUG["lowres_jitter"] * strength, pts.shape).astype(np.float32)
    m = np.linalg.norm(pts - pts[0], axis=1).max()
    pts = (pts - pts[0]) / (m if m > 1e-6 else 1.0)
    return pts.reshape(-1)


def augment_set(X, y, copies, rng, strength=1.0):
    Xa, ya = [X], [y]
    for _ in range(copies):
        Xa.append(np.array([augment(x, rng, strength) for x in X], dtype=np.float32))
        ya.append(y)
    return np.concatenate(Xa), np.concatenate(ya)


def _layers_for_export(clf):
    """Layers as plain lists. A 2-class sklearn MLP has ONE logistic output unit; the browser always
    uses a softmax over N outputs, so that unit is turned into two outputs [-z/2, +z/2]
    (softmax([-z/2, z/2]) == sigmoid(z))."""
    n = len(clf.coefs_)
    layers = []
    for i, (w, b) in enumerate(zip(clf.coefs_, clf.intercepts_)):
        last = i == n - 1
        if last and w.shape[1] == 1:
            w = np.concatenate([-w / 2, w / 2], axis=1)
            b = np.concatenate([-b / 2, b / 2])
        layers.append({"w": np.round(w, 5).tolist(), "b": np.round(b, 5).tolist(),
                       "act": "softmax" if last else "relu"})
    return layers


def forward(layers, X):
    """Same maths as SLCore.mlpPredict in frontend/sl-core.js, vectorised."""
    x = np.asarray(X, dtype=np.float64)
    for layer in layers:
        x = x @ np.array(layer["w"]) + np.array(layer["b"])
        if layer["act"] == "relu":
            x = np.maximum(0, x)
    e = np.exp(x - x.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


def export_mlp(clf, class_names, path, X_check):
    layers = _layers_for_export(clf)
    # Refuse to write a model whose browser maths would differ from scikit-learn's.
    diff = np.abs(forward(layers, X_check) - clf.predict_proba(X_check)).max()
    if diff > 1e-3:
        sys.exit(f"Export check failed: browser maths differs from scikit-learn by {diff:.4f}. Model not written.")
    payload = {"version": 1, "input": 63, "labels": [str(c) for c in class_names], "layers": layers}
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return Path(path).stat().st_size


def per_class_report(cm, labels):
    lines = ["Per-class accuracy (recall):"]
    for i, lab in enumerate(labels):
        total = cm[i].sum()
        acc = cm[i, i] / total if total else 0.0
        lines.append(f"  {lab:<14} {acc:6.1%}  ({cm[i, i]}/{total})")
    return lines


def make_demo(dir_, rng):
    """Synthetic hands: each label is a random base pose; signers add their own offset + noise."""
    labels = ["HELLO", "WATER", "YES", "NO"]
    bases = {l: rng.uniform(-1, 1, (NUM_LM, 3)) * 0.1 + np.linspace(0, 0.4, NUM_LM)[:, None] * rng.uniform(-1, 1, 3)
             for l in labels}
    for sid in ["s01", "s02", "s03", "s04", "s05"]:
        style = rng.normal(0, 0.01, (NUM_LM, 3))
        for l in labels:
            frames = [(bases[l] + style + rng.normal(0, 0.01, (NUM_LM, 3)) + 0.5).reshape(-1).tolist() for _ in range(30)]
            d = Path(dir_) / l
            d.mkdir(parents=True, exist_ok=True)
            (d / f"{sid}.json").write_text(json.dumps(
                {"signer_id": sid, "device": "demo", "label": l, "consent": True, "frames": frames}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="synthetic data, pipeline test only")
    ap.add_argument("--data", default=str(DATA_DIR))
    ap.add_argument("--out", default=str(OUT_MODEL))
    ap.add_argument("--aug", type=int, default=4, help="augmented copies per training sample")
    ap.add_argument("--aug-strength", type=float, default=1.0, help="0 = no augmentation, 1 = default")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)

    data_dir, out = Path(args.data), Path(args.out)
    if args.demo:
        tmp = Path(tempfile.mkdtemp(prefix="landmarks_demo_"))
        data_dir, out = tmp / "data", tmp / "gesture-mlp.json"
        make_demo(data_dir, rng)
        print(f"DEMO MODE: synthetic data in {data_dir}; model will NOT be written to the app.")

    X, y_text, groups = load_dataset(data_dir)
    le = LabelEncoder()
    y = le.fit_transform(y_text) if len(y_text) else y_text
    if len(X) == 0:
        sys.exit(f"No consented landmark data found in {data_dir}. Record signs on the admin page first.")
    signers = sorted(set(groups))
    print(f"{len(X)} frames, {len(le.classes_)} signs, {len(signers)} signers: {signers}")
    if len(signers) < MIN_SIGNERS + 1:
        sys.exit(f"Need at least {MIN_SIGNERS + 1} different signers to split by signer "
                 f"(train / held-out test). Found {len(signers)}.")

    # Split by SIGNER: test signers are never seen in training.
    gss = GroupShuffleSplit(n_splits=1, test_size=max(1, round(len(signers) * 0.25)) / len(signers), random_state=args.seed)
    tr, te = next(gss.split(X, y, groups))
    print(f"Train signers: {sorted(set(groups[tr]))}  Test signers: {sorted(set(groups[te]))}")

    Xtr, ytr = augment_set(X[tr], y[tr], args.aug, rng, args.aug_strength)
    # No sklearn early stopping: its random validation split is not signer-based and it halts after a
    # dozen epochs, leaving the model under-confident (outputs ~60% and nothing passes the 80% gate).
    # Training stops when the loss plateaus; L2 (alpha) and signer-held-out evaluation guard against overfitting.
    clf = MLPClassifier(hidden_layer_sizes=(64, 32), alpha=1e-2, max_iter=300,
                        early_stopping=False, random_state=args.seed)
    clf.fit(Xtr, ytr)

    labels = list(le.classes_)
    pred = clf.predict(X[te])
    acc = accuracy_score(y[te], pred)
    cm = confusion_matrix(y[te], pred, labels=list(range(len(labels))))

    proba = clf.predict_proba(X[te])
    conf = proba.max(axis=1)
    sure = float((conf >= 0.8).mean())
    lines = [f"Held-out signer accuracy: {acc:.1%}",
             f"Mean confidence {conf.mean():.0%}; {sure:.0%} of held-out frames reach the 80% display threshold.", "", "Confusion matrix (rows=true, cols=predicted):",
             "  labels: " + ", ".join(labels), str(cm), ""] + per_class_report(cm, labels)
    report = "\n".join(lines)
    print("\n" + report)

    size = export_mlp(clf, labels, out, X[te])
    print(f"\nExported {out} ({size / 1024:.1f} KB)")
    if not args.demo:
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        (REPORT_DIR / "report.txt").write_text(report, encoding="utf-8")


if __name__ == "__main__":
    main()
