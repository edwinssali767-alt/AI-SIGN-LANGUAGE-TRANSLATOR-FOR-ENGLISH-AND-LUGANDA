"""Regression tests for the landmark training/export code. Run:
    backend\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from sklearn.neural_network import MLPClassifier

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "training"))
import train_landmarks as T  # noqa: E402


def blobs(n_classes, rng):
    X = np.vstack([rng.normal(i, 0.3, (60, 63)) for i in range(n_classes)]).astype(np.float32)
    y = np.repeat(np.arange(n_classes), 60)
    return X, y


class ExportTests(unittest.TestCase):
    def check(self, n_classes):
        X, y = blobs(n_classes, np.random.default_rng(3))
        clf = MLPClassifier(hidden_layer_sizes=(16,), max_iter=300, random_state=3).fit(X, y)
        layers = T._layers_for_export(clf)
        self.assertEqual(len(layers[-1]["b"]), n_classes)  # always one output per class
        diff = np.abs(T.forward(layers, X) - clf.predict_proba(X)).max()
        self.assertLess(diff, 1e-3)

    def test_two_class_model_exports_two_outputs(self):
        self.check(2)  # sklearn uses a single logistic unit here; this was a real bug

    def test_three_class_model_exports(self):
        self.check(3)

    def test_export_refuses_a_mismatching_model(self):
        X, y = blobs(2, np.random.default_rng(4))
        clf = MLPClassifier(hidden_layer_sizes=(8,), max_iter=200, random_state=4).fit(X, y)
        clf.predict_proba = lambda data: np.full((len(data), 2), 0.5)  # scikit-learn "disagrees" with the export
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "m.json"
            with self.assertRaises(SystemExit):
                T.export_mlp(clf, ["a", "b"], out, X[:5])
            self.assertFalse(out.exists())  # nothing was written

    def test_normalize_matches_js_rules(self):
        pts = np.random.default_rng(1).random((21, 3))
        f = T.normalize(pts)
        self.assertEqual(f.shape, (63,))
        self.assertTrue(np.allclose(f[:3], 0))
        self.assertAlmostEqual(float(np.linalg.norm(f.reshape(21, 3), axis=1).max()), 1.0, places=5)
        self.assertTrue(np.allclose(f, T.normalize(pts * 3 + 0.2), atol=1e-5))  # scale/shift invariant
        self.assertIsNone(T.normalize(np.full((21, 3), 0.5)))

    def test_training_data_without_consent_is_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "x").mkdir()
            frames = np.random.default_rng(2).random((12, 63)).tolist()
            for consent, name in ((True, "a"), (False, "b")):
                (Path(d) / "x" / f"{name}.json").write_text(json.dumps(
                    {"signer_id": name, "device": "phone", "label": "x", "consent": consent, "frames": frames}))
            X, y, g = T.load_dataset(d)
            self.assertEqual(set(g), {"a"})


if __name__ == "__main__":
    unittest.main()
