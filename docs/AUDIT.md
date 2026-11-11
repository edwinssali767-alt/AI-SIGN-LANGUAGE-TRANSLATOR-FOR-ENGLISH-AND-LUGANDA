# AUDIT: AI Sign Language Translator (English / Luganda, USL)

Audit date: 2026-11-06. Read-only review; no application code was changed for this document.

## 1. Stack

| Layer | What is used |
|---|---|
| Backend | Flask (`backend/server.py`, 1806 lines, 40+ routes), Flask-SocketIO (optional), Flask-CORS |
| Python | `backend/venv` is Python 3.10.11 (system Python is 3.14, which cannot run the pinned packages) |
| ML libs in venv | numpy 1.26.4, scikit-learn 1.7.2, mediapipe 0.10.35, tensorflow/keras 2.15 (**tensorflowjs not installed**) |
| Models | scikit-learn `RandomForest`/`DecisionTree` pickles in `backend/models/` (`gesture_model.pkl`, `scaler.pkl`, `gesture_dynamics_model.pkl`, `dynamics_scaler.pkl`) |
| Database | MongoDB Atlas when `MONGODB_URI` is set, otherwise SQLite (`backend/sign_translator.db`) through `mongodb_client.py` / `database.py` |
| Cloud services | Cloudinary (images/videos), SMTP welcome email, MongoDB Atlas. All optional and all contradict the "offline only" rule if enabled |
| Frontend | Plain HTML/JS/CSS in `frontend/`, served by Flask itself. PWA service worker (`sw.js`). Three.js + GSAP vendored in `frontend/vendor/` |
| Auth | Home-made tokens `user_<id>` / `admin_<id>` (see Security) |
| Billing | Free-translation limits, pricing page, subscription endpoints. **Out of scope: left untouched** |

## 2. How a gesture goes from camera to prediction today

1. `translator.js` opens the camera with `getUserMedia` (now through `camera-permission.js`).
2. Single shot: the video frame is drawn to a canvas, exported as JPEG (`toDataURL`, quality 0.8) and POSTed to `/api/translate`.
3. Motion: about 15 JPEG frames are collected and POSTed to `/api/translate-motion`.
4. Real-time: JPEG frames are streamed over Socket.IO (`realtime_frame`), only for logged-in users.
5. `GestureProcessor` (`backend/gesture_processor.py`) decodes the JPEG, converts it to **grayscale pixels**, computes 63 hand-made statistics (downsampled pixels, mean/std/min/max, edge energy) and feeds them to the RandomForest.
6. Motion model: frame-difference statistics over 15 frames, DecisionTree/RandomForest.
7. The label (`hello`, `thank_you`, ...) is looked up in the `gestures` collection (or a 9-entry fallback dict in `translator.py`) to get English and Luganda text, and the result is logged.

**Models load** once at import time in `GestureProcessor.__init__` (`server.py:88`), from `<root>/models/` first, then `backend/models/`. The root `models/` folder is empty, so the `backend/models/` copies are used.

**Labels today**
- Trained dataset folders: `fine`, `hello`, `how`, `thank_you`, `you` (200 JPEGs each in `backend/gesture_dataset/`; `datasets/` at the root is empty).
- `supported_gestures` in code lists a different set: `hello, thank_you, yes, no, good, bad, water, mother, father`.
- Fallback dictionary in `translator.py`: `hello, thank_you, yes, no, good, bad, how, fine, you`.
- The three lists disagree with each other.

## 3. Bugs and correctness problems

1. **The model does not use hand landmarks at all.** `backend/training_log.txt` shows `train_gesture_model.py` crashed on `mp.solutions` (removed in mediapipe 0.10.35) and silently fell back to pixel statistics. The deployed model classifies brightness and edge totals of the whole image, so it is effectively recognising lighting and background, not hand shapes. Any accuracy figure from it is meaningless.
2. **Heuristic fallback invents answers.** `_heuristic_static_gesture` returns `hello` or `thank_you` for any image when confidence is below 0.4. A blank wall can "translate" as hello.
3. **Fake confidence.** The Socket.IO real-time handler hard-codes `confidence = 0.85` regardless of the model output.
4. **Very low thresholds.** Static 0.4, motion 0.5. Nothing like the 80% target.
5. **No smoothing or stability logic.** Each request is judged alone; no voting across frames.
6. **No hand or quality check.** Dark, far or empty frames are still classified.
7. **Shared mutable state.** One global `GestureProcessor.frame_buffer` (deque) is shared by every user and request, so two users' frames mix in the same motion window, and the buffer is cleared only on a successful prediction.
8. **Python 3.14 crash in training script.** `print("⚠ ...")` raises `UnicodeEncodeError` on Windows cp1252 consoles (seen in the log).
9. **Letter recognition** (`recognize_letter`) builds a 9-feature vector that never matches the scaler's 63 features, so it always falls through to `_detect_letter_by_shape` (aspect-ratio guesses: wide = Y, tall = I, ...). Letters are effectively random.
10. **sklearn version mismatch.** Models were pickled with 1.8.0 and are loaded with 1.7.2 (`InconsistentVersionWarning`); results may be wrong.
11. **Duplicate/dead files.** `style2_fixed.css`, `style2_temp.css`, the root `admin/` and `training/` folders, empty `canMakeTranslation` file.
12. **Heavy payloads.** Full JPEG frames (about 114 KB each at 640x480) are uploaded per prediction; 15 per motion request.

## 4. Performance problems

- Server-side decoding and feature extraction for every frame; the server becomes the bottleneck and the app cannot work offline.
- Motion request sends about 1.7 MB of JPEG per translation.
- `server.py` is a single 1.8k-line module; models are loaded eagerly even if unused.
- Flask development server with `debug=True` and the reloader, bound to `0.0.0.0`.
- Three.js (670 KB) loads on the landing page.

## 5. Security and privacy problems

1. **Forgeable tokens.** `get_user_id_from_token` accepts any string `user_<id>`; admin tokens are `admin_<id>`. There is no signature, expiry or server-side session, so anyone who knows or guesses an id can impersonate that user or an admin.
2. **Default admin credentials.** `ADMIN_USERNAME=admin` / `ADMIN_PASSWORD=admin123` and `SECRET_KEY='change-me-in-production'` are the code defaults. Confirm `.env` overrides them.
3. **Plain-text password comparison** for legacy users (`verify_password` falls back to `==`). Admin env login also compares in clear text.
4. **`debug=True` on `0.0.0.0:5000`** exposes the Werkzeug debugger to the network.
5. **CORS `*`** on `/api/*` and on Socket.IO.
6. **Secrets on disk.** `backend/.env` holds MongoDB, Cloudinary and SMTP credentials (git-ignored, good). They should be rotated if the folder was ever shared.
7. **Uploads.** Training image/video upload endpoints store user files; admin-only check depends on the forgeable token above.
8. **Data sent to the cloud.** Camera frames and captured gestures can be pushed to Cloudinary and stored in MongoDB Atlas; this conflicts with "do not store video" and "offline".
9. **No privacy notice or consent** for the camera apart from the new permission dialog.
10. **Service worker** caches scripts network-first (fine) but lists `admin.js` in the shared precache.

## 6. What is good (keep)

- Clear separation of frontend files and API routes; the translation lookup and logging are reusable.
- Existing admin, letters and gestures pages and UI theme.
- Database abstraction already falls back to SQLite, so the app runs without Atlas.

## 7. Environment facts that affect the plan

- No hand-landmark model file is present. The modern MediaPipe Tasks API needs `hand_landmarker.task` (about 7.5 MB, free, Apache-2.0). It must be downloaded once and committed or bundled; after that everything runs offline.
- The browser needs the `@mediapipe/tasks-vision` JS + WASM files and `tensorflow.js` vendored locally (no CDN) to work offline.
- `tensorflowjs` is not installed. Two free options: install the `tensorflowjs` Python package (it conflicts with TF 2.15 pins in some versions), or write the trained weights to JSON and run the small MLP/1D-CNN with a tiny hand-written inference or `tfjs` layers loader. Decision needed (see plan).
- No real signer-labelled data exists. The 1000 JPEGs have no signer IDs, so a "split by signer" evaluation cannot be done on them. New landmark data must be collected through the admin page with signer IDs.
- Luganda audio files and sign clips (`/static/audio/lg`, `/static/signs`) do not exist yet; the UI must degrade to captions when they are missing. Flask currently has no `/static` folder: files are served from `frontend/`.
- The 80 seed signs in `vocabulary.json` are **unverified**. Every entry will carry `status: "needs verification by a deaf USL signer"`. Luganda wording and signs must be validated by native Deaf signers before real use.

## 8. Implementation plan (small steps, each tested and run)

**Step 2 - Recognition**
1. `frontend/landmarks.js`: normalisation (wrist subtraction, divide by max wrist distance), pure functions, unit tested.
2. `frontend/recognizer.js`: 640x480 resize, MediaPipe Hand Landmarker in the browser (vendored), 10-frame majority vote, 80% threshold + stability counter, "unknown / please repeat", quality hints (hands lost, too dark, too far).
3. `training/train_landmarks.py`: loads landmark JSON, split by signer, augmentation (rotation, scale, noise, mirror, blur/downscale simulation applied before extraction where images exist), MLP (static) and 1D-CNN/GRU (30-frame sequences), confusion matrix and per-class accuracy, TF.js export.
4. Admin capture page: 30-frame landmark sequences, signer ID, device type, consent checkbox, saves landmarks only (no video, no images); new endpoint stores JSON locally.
5. Remove the fake-confidence and heuristic fallback paths from the server; keep the old endpoints working for the existing pages until the new recogniser replaces them.

**Step 3 - Signs to sentence to voice**
`frontend/sentence-builder.js` + `frontend/data/patterns.json` + `vocabulary.json`; caption box with edit and confirm; Repeat button; English via `speechSynthesis`; Luganda via `/static/audio/lg/<gloss>.mp3` when present; language toggle and speed control.

**Step 4 - Text/speech to sign**
`frontend/text-to-gloss.js` (synonyms, word-order rules from `patterns.json`, fingerspelling fallback through the Letters page), clip player with captions, speed, replay and pause, written behind a small `SignRenderer` interface so a Three.js avatar can replace the clips later; `vocabulary.json` with about 80 seed entries.

**Step 5 - Quality and speed**
Lazy-load models, privacy notice and consent, accessibility pass, mobile layout, throttled inference for low-end phones, `tests/` for normalisation, smoothing, sentence builder and text-to-gloss (Node `node:test`, no new dependencies), README update.

**Security fixes (proposed alongside, not billing related):** signed tokens (HMAC with `itsdangerous`, already a Flask dependency), `debug=False` by default, restrict CORS to the same origin, require non-default admin credentials. These touch authentication and are listed here so you can approve them separately.

## 9. Decisions needed before coding

1. May I download `hand_landmarker.task`, `@mediapipe/tasks-vision` and `tensorflow.js` once (free, open source) and commit them under `frontend/vendor/`? It is the only way to run offline.
2. TF.js export: install `tensorflowjs` into the venv, or ship weights as JSON with a tiny custom inference loader? (Recommended: JSON weights, no dependency risk.)
3. Which signs should the first trained model cover? Today's data covers only `hello, thank_you, how, fine, you` and is not usable for landmarks. A real USL signer must record the new set.
4. Approve or defer the security fixes in section 8.


---

## 10. Status after implementation (2026-11-09)

| Audit item | Result |
|---|---|
| Model did not use landmarks | Replaced for the new flow: MediaPipe landmarks, normalised, small MLP in the browser (`sl-core.js`, `recognizer.js`, `training/train_landmarks.py`). Needs real signer data. |
| Fake 0.85 confidence, always-`hello` fallback | Removed. The legacy pixel model needs a detected hand and 80% confidence; a blank picture is no longer translated (tested). |
| Shared frame buffer between users | Guarded by a lock and cleared per request. |
| Forgeable `user_` / `admin_` tokens | Signed, expiring tokens; kind is part of the signature (tested). |
| `debug=True` on `0.0.0.0`, CORS `*` | Localhost, no debug, no CORS by default. |
| Default admin password | **Still your action**: set a strong `ADMIN_PASSWORD` in `backend/.env`. A warning prints at startup. |
| Letters recogniser guessing from aspect ratio | Now returns nothing unless a hand is detected; accuracy of the letter model itself is unchanged. |
| Camera frames sent to a server | New flow sends nothing. Old buttons still send single frames (documented in `privacy.html`). |
| Atlas required at startup | Server now starts without it; accounts and history still need it. **Not refactored.** |
| Cloudinary / Atlas / SMTP are cloud services | Unchanged (existing features). None are used by the new offline features. |
| Signer-split training, augmentation, confusion matrix | Done. Found and fixed an export bug for 2-class models; export now self-checks against scikit-learn. |

Remaining: record real data from several Deaf signers and train; verify the vocabulary and Luganda wording with a Deaf USL signer and a Luganda speaker; record Luganda audio and sign clips; replace the MongoDB-only data layer if a fully offline deployment is required.
