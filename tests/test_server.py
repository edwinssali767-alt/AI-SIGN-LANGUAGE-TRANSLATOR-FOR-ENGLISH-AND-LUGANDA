"""Backend security and honesty tests (Flask test client, no network). Run:
    backend\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
"""
import base64
import io
import shutil
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import server  # noqa: E402  (loads the app and models once)
from PIL import Image  # noqa: E402

LABEL = "zz_unittest_sign"


def blank_image_data_url(color=(255, 255, 255)):
    buf = io.BytesIO()
    Image.new("RGB", (320, 240), color).save(buf, format="JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


class TokenTests(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()

    def test_forged_admin_tokens_are_rejected(self):
        for forged in ("admin_1", "admin_", "admin_x.y.z", "Bearer admin_1", "", None):
            self.assertFalse(server.is_valid_admin_token(forged), forged)
            headers = {"Authorization": forged} if forged else {}
            self.assertEqual(self.client.get("/api/admin/landmarks/summary", headers=headers).status_code, 401)

    def test_forged_user_tokens_are_ignored(self):
        self.assertIsNone(server.get_user_id_from_token("user_1"))
        self.assertIsNone(server.get_user_id_from_token("user_"))

    def test_signed_tokens_round_trip(self):
        self.assertEqual(server.get_user_id_from_token(server.sign_token("user", "42")), "42")
        self.assertTrue(server.is_valid_admin_token(server.sign_token("admin", "7")))

    def test_a_user_token_is_not_an_admin_token_and_vice_versa(self):
        self.assertFalse(server.is_valid_admin_token(server.sign_token("user", "1")))
        self.assertIsNone(server.get_user_id_from_token(server.sign_token("admin", "1")))
        # same payload re-labelled with the other prefix must also fail (the kind is inside the signature)
        user = server.sign_token("user", "1")
        self.assertFalse(server.is_valid_admin_token("admin_" + user.split("_", 1)[1]))

    def test_tampered_token_is_rejected(self):
        t = server.sign_token("admin", "1")
        self.assertFalse(server.is_valid_admin_token(t[:-3] + ("aaa" if not t.endswith("aaa") else "bbb")))

    def test_expired_token_is_rejected(self):
        t = server.sign_token("admin", "1")
        old = server.TOKEN_MAX_AGE_SECONDS
        server.TOKEN_MAX_AGE_SECONDS = -1
        try:
            self.assertFalse(server.is_valid_admin_token(t))
        finally:
            server.TOKEN_MAX_AGE_SECONDS = old


class LandmarkEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self.auth = {"Authorization": server.sign_token("admin", "unittest")}
        self.frames = [[0.5] * 63 for _ in range(12)]
        self.body = {"label": LABEL, "signer_id": "s9", "device": "phone", "consent": True, "frames": self.frames}

    def tearDown(self):
        shutil.rmtree(server.LANDMARK_DIR / LABEL, ignore_errors=True)

    def post(self, **over):
        return self.client.post("/api/admin/landmarks", json={**self.body, **over}, headers=self.auth)

    def test_requires_admin(self):
        self.assertEqual(self.client.post("/api/admin/landmarks", json=self.body).status_code, 401)

    def test_consent_is_mandatory(self):
        for bad in (False, None, "true", 1):
            self.assertEqual(self.post(consent=bad).status_code, 400, bad)
        self.assertFalse((server.LANDMARK_DIR / LABEL).exists())

    def test_valid_recording_is_saved_as_numbers_only(self):
        r = self.post()
        self.assertEqual(r.status_code, 201)
        saved = list((server.LANDMARK_DIR / LABEL).glob("*.json"))
        self.assertEqual(len(saved), 1)
        self.assertFalse(list((server.LANDMARK_DIR / LABEL).glob("*.jp*g")) + list((server.LANDMARK_DIR / LABEL).glob("*.mp4")))

    def test_validation(self):
        self.assertEqual(self.post(device="toaster").status_code, 400)
        self.assertEqual(self.post(signer_id="").status_code, 400)
        self.assertEqual(self.post(label="").status_code, 400)
        self.assertEqual(self.post(frames=self.frames[:3]).status_code, 400)  # too short
        self.assertEqual(self.post(frames=[[0.5] * 5] * 12).status_code, 400)  # wrong width
        self.assertEqual(self.post(frames=[[float("nan")] * 63] * 12).status_code, 400)
        self.assertEqual(self.post(frames=[["x"] * 63] * 12).status_code, 400)

    def test_path_traversal_in_label_is_neutralised(self):
        r = self.post(label="../../evil", signer_id="../x")
        self.assertIn(r.status_code, (201, 400))
        self.assertFalse((ROOT / "evil").exists())
        shutil.rmtree(server.LANDMARK_DIR / "evil", ignore_errors=True)


class RecogniserHonestyTests(unittest.TestCase):
    def test_a_blank_picture_is_never_translated(self):
        gp = server.gesture_processor
        for color in ((255, 255, 255), (0, 0, 0), (128, 128, 128)):
            label, confidence = gp.predict_static_gesture(blank_image_data_url(color), with_confidence=True)
            self.assertIsNone(label, "the old fallback invented 'hello' or 'thank_you' here")

    def test_confidence_comes_from_the_model_not_a_constant(self):
        _, c1 = server.gesture_processor.predict_static_gesture(blank_image_data_url((255, 255, 255)), with_confidence=True)
        _, c2 = server.gesture_processor.predict_static_gesture(blank_image_data_url((10, 10, 10)), with_confidence=True)
        self.assertNotEqual(c1, 0.85)
        self.assertNotEqual(c2, 0.85)

    def test_threshold_is_80_percent(self):
        self.assertEqual(server.gesture_processor.MIN_CONFIDENCE, 0.8)


class HttpSurfaceTests(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()

    def test_no_cross_origin_access_by_default(self):
        r = self.client.get("/api/health", headers={"Origin": "https://evil.example"})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("Access-Control-Allow-Origin", r.headers)

    def test_wasm_and_modules_have_correct_mime_types(self):
        self.assertTrue(self.client.get("/vendor/mediapipe/vision_wasm_internal.wasm").headers["Content-Type"].startswith("application/wasm"))
        self.assertIn("javascript", self.client.get("/vendor/mediapipe/vision_bundle.mjs").headers["Content-Type"])

    def test_path_traversal_cannot_read_server_files(self):
        for path in ("/../backend/.env", "/..%2fbackend%2f.env", "/%2e%2e/backend/server.py", "/backend/.env"):
            r = self.client.get(path)
            self.assertNotEqual(r.status_code, 200, path)
            self.assertNotIn(b"SECRET_KEY", r.data)

    def test_data_files_are_served(self):
        self.assertEqual(self.client.get("/data/vocabulary.json").status_code, 200)
        self.assertEqual(self.client.get("/data/patterns.json").status_code, 200)


if __name__ == "__main__":
    unittest.main()


class StaticAssetTests(unittest.TestCase):
    """/static/... must come from frontend/static (Flask's own static route used to shadow it with a 404)."""

    def test_files_under_frontend_static_are_served(self):
        folder = ROOT / "frontend" / "static" / "audio" / "lg"
        probe = folder / "zz_unittest_probe.mp3"
        probe.write_bytes(b"ID3\x00\x00\x00\x00\x00\x00\x00")
        try:
            client = server.app.test_client()
            r = client.head("/static/audio/lg/zz_unittest_probe.mp3")
            try:
                self.assertEqual(r.status_code, 200)
                self.assertIn("audio", r.headers["Content-Type"])
            finally:
                r.close()  # Windows keeps the file locked until the response is closed
            self.assertEqual(client.head("/static/audio/lg/does_not_exist.mp3").status_code, 404)
        finally:
            probe.unlink(missing_ok=True)
