"""Tests for recordings and the published sign model stored in MongoDB (the only option on Vercel).
A fake in-memory collection stands in for the database, so nothing here touches a real one. Run:
    backend\\venv\\Scripts\\python.exe -m unittest discover -s tests -p "test_*.py"
"""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import server  # noqa: E402


class FakeCursor(list):
    def sort(self, *_):
        return self

    def skip(self, n):
        return FakeCursor(self[n:])

    def limit(self, n):
        return FakeCursor(self[:n])


class FakeCollection:
    """Just enough of a pymongo collection for the landmark and model endpoints."""

    def __init__(self):
        self.docs = []

    def insert_one(self, doc):
        doc = dict(doc)
        doc.setdefault("_id", f"id{len(self.docs)}")
        self.docs.append(doc)
        return type("R", (), {"inserted_id": doc["_id"]})()

    @staticmethod
    def _match(d, q):
        return all(d.get(k) == v for k, v in q.items())

    def find(self, q=None, proj=None):
        return FakeCursor(d for d in self.docs if self._match(d, q or {}))

    def find_one(self, q, proj=None):
        for d in self.docs:
            if self._match(d, q):
                return {k: v for k, v in d.items() if not (proj and proj.get(k) == 0)}
        return None

    def count_documents(self, q):
        return len(self.find(q))

    def distinct(self, key):
        return sorted({d[key] for d in self.docs})

    def aggregate(self, _pipeline):
        counts = {}
        for d in self.docs:
            counts[d["label"]] = counts.get(d["label"], 0) + 1
        return [{"_id": k, "n": v} for k, v in counts.items()]

    def delete_many(self, q):
        keep = [d for d in self.docs if not self._match(d, q)]
        n = len(self.docs) - len(keep)
        self.docs = keep
        return type("R", (), {"deleted_count": n})()

    def replace_one(self, q, doc, upsert=False):
        for i, d in enumerate(self.docs):
            if self._match(d, q):
                self.docs[i] = doc
                return
        if upsert:
            self.docs.append(doc)


def tiny_model(labels=("A", "B"), hidden=4):
    k = len(labels)
    return {
        "labels": list(labels),
        "layers": [
            {"w": [[0.01] * hidden for _ in range(63)], "b": [0.0] * hidden, "act": "relu"},
            {"w": [[0.1] * k for _ in range(hidden)], "b": [0.0] * k, "act": "softmax"},
        ],
    }


class RemoteStoreTests(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self.auth = {"Authorization": server.sign_token("admin", "unittest")}
        self.samples, self.models = FakeCollection(), FakeCollection()
        self._saved = (server._remote_store, server._landmark_samples, server._landmark_models, server.LANDMARK_MODEL_FILE)
        server._remote_store = lambda: True
        server._landmark_samples = lambda: self.samples
        server._landmark_models = lambda: self.models
        self.tmp = tempfile.mkdtemp()
        server.LANDMARK_MODEL_FILE = Path(self.tmp) / "gesture-mlp.json"
        self.body = {"label": "WATER", "signer_id": "s1", "device": "phone", "consent": True, "frames": [[0.5] * 63] * 12}

    def tearDown(self):
        (server._remote_store, server._landmark_samples, server._landmark_models, server.LANDMARK_MODEL_FILE) = self._saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def save(self, **over):
        return self.client.post("/api/admin/landmarks", json={**self.body, **over}, headers=self.auth)

    def test_recording_goes_to_the_database_not_the_disk(self):
        r = self.save()
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(self.samples.docs), 1)
        self.assertEqual(self.samples.docs[0]["label"], "water")  # labels are stored lower-case, trained as upper-case glosses
        self.assertFalse(list(Path(self.tmp).glob("*")))

    def test_consent_still_required_with_the_database(self):
        self.assertEqual(self.save(consent=False).status_code, 400)
        self.assertEqual(len(self.samples.docs), 0)

    def test_summary_and_export_are_admin_only_and_paged(self):
        for sid in ("s1", "s2", "s3"):
            self.save(signer_id=sid)
        self.assertEqual(self.client.get("/api/admin/landmarks/export").status_code, 401)
        self.assertEqual(self.client.get("/api/admin/landmarks/summary").status_code, 401)
        summary = self.client.get("/api/admin/landmarks/summary", headers=self.auth).get_json()
        self.assertEqual(summary["signs"], {"water": 3})
        self.assertEqual(summary["signers"], ["s1", "s2", "s3"])
        page = self.client.get("/api/admin/landmarks/export?skip=1&limit=1", headers=self.auth).get_json()
        self.assertEqual((page["total"], len(page["samples"])), (3, 1))
        self.assertEqual(set(page["samples"][0]), {"label", "signer_id", "device", "frames"})
        self.assertEqual(self.client.get("/api/admin/landmarks/export?skip=abc", headers=self.auth).status_code, 400)

    def test_delete_one_signer_or_whole_sign(self):
        self.save(signer_id="s1")
        self.save(signer_id="s2")
        self.assertEqual(self.client.delete("/api/admin/landmarks?label=WATER&signer_id=s1").status_code, 401)
        r = self.client.delete("/api/admin/landmarks?label=WATER&signer_id=s1", headers=self.auth)
        self.assertEqual(r.get_json()["deleted"], 1)
        r = self.client.delete("/api/admin/landmarks?label=WATER", headers=self.auth)
        self.assertEqual(r.get_json()["deleted"], 1)
        self.assertEqual(self.client.delete("/api/admin/landmarks", headers=self.auth).status_code, 400)

    def test_publish_then_everyone_can_download_the_model(self):
        self.assertEqual(self.client.get("/api/landmark-model").status_code, 404)
        self.assertEqual(self.client.put("/api/admin/landmark-model", json={"model": tiny_model()}).status_code, 401)
        r = self.client.put("/api/admin/landmark-model", json={"model": tiny_model(), "metrics": {"accuracy": 0.9}}, headers=self.auth)
        self.assertEqual(r.status_code, 200)
        got = self.client.get("/api/landmark-model")
        self.assertEqual(got.status_code, 200)
        self.assertEqual(got.get_json()["labels"], ["A", "B"])
        self.assertIn("max-age", got.headers["Cache-Control"])
        again = self.client.put("/api/admin/landmark-model", json={"model": tiny_model(("X", "Y", "Z"))}, headers=self.auth)
        self.assertEqual(again.status_code, 200)
        self.assertEqual(len(self.models.docs), 1)  # replaced, not duplicated
        self.assertEqual(self.client.get("/api/landmark-model").get_json()["labels"], ["X", "Y", "Z"])
        info = self.client.get("/api/admin/landmarks/summary", headers=self.auth).get_json()["model"]
        self.assertEqual(info["labels"], ["X", "Y", "Z"])

    def test_bad_models_are_rejected(self):
        def put(model):
            return self.client.put("/api/admin/landmark-model", json={"model": model}, headers=self.auth).status_code

        good = tiny_model()
        self.assertEqual(put(None), 400)
        self.assertEqual(put({**good, "labels": ["A"]}), 400)              # needs 2+ labels
        self.assertEqual(put({**good, "labels": ["A", "B", "C"]}), 400)    # outputs != labels
        bad_in = tiny_model()
        bad_in["layers"][0]["w"] = bad_in["layers"][0]["w"][:10]
        self.assertEqual(put(bad_in), 400)                                 # wrong input width
        bad_act = tiny_model()
        bad_act["layers"][-1]["act"] = "relu"
        self.assertEqual(put(bad_act), 400)
        bad_num = tiny_model()
        bad_num["layers"][0]["w"][0][0] = float("nan")
        self.assertEqual(put(bad_num), 400)
        huge = tiny_model()
        huge["layers"][0]["w"][0][0] = 1e9
        self.assertEqual(put(huge), 400)
        self.assertEqual(len(self.models.docs), 0)


if __name__ == "__main__":
    unittest.main()
