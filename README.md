# AI Sign Language Translator for English and Luganda

Sign language (Uganda Sign Language, USL) to text and speech, and typed or spoken sentences back to signs, in English and Luganda.
Recognition runs **in the browser**: it works with a weak connection, no paid or cloud AI is used, and camera video is never stored.

The original project description and deployment guide are in [readme(final).md](readme(final).md). This file covers the offline features added later.

## What is in the app

| Page | What it does |
|---|---|
| Translator | Camera. **Signs to sentence**: recognised signs are collected into an English and a Luganda sentence that the signer checks and edits before it is spoken. The older Capture and Real-time buttons still work. |
| Text to Sign | Type or say a sentence and watch it signed one sign at a time, with captions. Unknown words are fingerspelled. |
| Letters, Learn Gestures | Fingerspelling and gesture lessons. |
| Admin | Records training data (hand-landmark numbers only) with signer ID, device type and a consent box. |
| Privacy | What is and is not stored. |

## Project layout

| Folder | What is in it |
|---|---|
| `frontend/` | The website (static HTML/CSS/JS, fonts, MediaPipe, vocabulary and patterns). Served by Vercel's CDN in production. |
| `backend/` | Flask API: accounts, history, admin, landmark recording. `run.py` starts it locally, `wsgi.py` is for gunicorn. |
| `api/` | Vercel serverless entrypoint (`api/index.py`) that exposes the backend at `/api/*`. |
| `training/` | `train_landmarks.py`: trains the in-browser sign model from recorded landmarks. |
| `tests/` | Node unit tests, Python tests, and real-browser end-to-end tests. |
| `scripts/` | Windows/Linux launchers (`start.bat`, `start.sh`, `TRAIN_GESTURES.bat`). |
| `docs/` | Older guides and notes, plus `AUDIT.md`. |

## Deploy on Vercel

`vercel.json` serves `frontend/` as the static site and runs the backend as one serverless function. The root `requirements.txt` is the **slim** set for that function (no mediapipe/opencv/scikit-learn: recognition runs in the browser). `backend/requirements.txt` is the full set for local use and Render.

Set these in Vercel, Project Settings, Environment Variables: `MONGODB_URI`, `MONGODB_DB_NAME`, the `MONGODB_*_COLLECTION` names, `SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`. In MongoDB Atlas, Network Access must allow Vercel's changing IPs (`0.0.0.0/0`).

## Setup

```powershell
cd backend
python -m venv venv                 # Python 3.10 (the venv in this repo uses 3.10)
.\venv\Scripts\activate
pip install -r requirements.txt
python run.py                       # http://localhost:5000
```

Settings go in `backend/.env` (see `.env.example`). Important ones:

| Setting | Meaning |
|---|---|
| `SECRET_KEY` | Signs login tokens. Use a long random value. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Admin login. **Change the password**: the server warns at startup if it is weak. |
| `HOST` | Defaults to `127.0.0.1` (this computer only). Set `0.0.0.0` to test from a phone on your Wi-Fi. |
| `FLASK_DEBUG=1` | Auto-reload while developing. Off by default. |
| `CORS_ORIGINS` | Empty by default (same-origin only). |

The offline features need **no** database. Login, history and the admin lists use MongoDB; if it cannot be reached the server still starts and says so.

### Files needed for offline use (already in the repo)

| File | Size | Why |
|---|---|---|
| `frontend/models/hand_landmarker.task` | 7.8 MB | MediaPipe hand model (Apache-2.0) |
| `frontend/vendor/mediapipe/*` | 19 MB | MediaPipe WebAssembly runtime (Apache-2.0) |
| `frontend/fonts/*` | 0.1 MB | Schibsted Grotesk and Newsreader (SIL OFL), self-hosted |

They are downloaded by the browser **only when Start recognition is pressed**, then cached by the service worker. Keep them in git: a deployment (e.g. Render) needs them.

## How recognition works

camera frame, resized to 640x480 (steps down on slow devices) → MediaPipe hand landmarks (21 points) → normalised (wrist subtracted, divided by the farthest distance from the wrist) → small neural network (JSON weights, runs in the browser) → majority vote over the last 10 frames.

A sign is shown only when it has **at least 80% confidence** and enough agreeing frames (about 0.6 s). Otherwise the page says "Not sure. Please repeat the sign." Quality hints appear for "too dark", "no hand found" and "too far".

A sentence is finished after **1.5 s with no hand**, or when **Done** is pressed. Nothing is spoken until the signer presses **Speak**.

## Train the sign model

Everything is done on the **Admin** page. No code, no terminal, and it works on the live Vercel site.

1. **Admin, Record Sign Data.** For each sign: type the sign name (use the glosses in `frontend/data/vocabulary.json`, e.g. `WATER`), a signer code such as `s01` (not a real name), the device, tick **consent**, press **Record**. Each press saves 30 frames of hand-landmark numbers (never video or photos) to the database.
2. Use **several different signers** (at least 3), different lighting, and both phone and laptop. A model is judged on signers it never saw, so more people means a more honest and more reliable result.
3. **Admin, Train the Sign Model, Train model.** Your browser downloads the recordings, trains the model (about 1 to 3 minutes) and shows the accuracy on held-back data, a per-sign table, and warnings (too few signers, too few recordings, signs that get confused).
4. Press **Publish to translator**. It is stored in MongoDB and the translator loads it automatically (within about a minute, or on reload). If accuracy is below 70% the button stays locked unless you tick **Publish anyway**.

Developers can still train offline with `python training/train_landmarks.py` (writes `frontend/models/gesture-mlp.json`, the file-based fallback the translator uses when no published model exists). To remove bad data: `DELETE /api/admin/landmarks?label=WATER[&signer_id=s01]` with the admin token.

Recordings are stored in MongoDB (collection `landmark_samples`) and, when running without a database, in `datasets/landmarks/` (excluded from git).

## Add a new sign

1. Add an entry to `frontend/data/vocabulary.json`:

   ```json
   { "gloss": "BREAD", "category": "noun", "english": "bread", "luganda": "omugaati",
     "synonyms": ["bread", "loaf"], "media": "/static/signs/bread.mp4",
     "status": "needs verification by a deaf USL signer" }
   ```

   - `category` is one of `pronoun, question, verb, adjective, noun, social, time, number, function`.
   - Verbs and adjectives also need `forms` (Luganda by person: `1s, 2s, 3s, 1p, 3p`) and verbs `english_3s`. Copy `WANT` as a template.
   - Nouns can have `english_obj` for the form after a verb (`"a doctor"`).
2. Put the clip at `frontend/static/signs/bread.mp4` (or `bread.png`). Keep it small: **480p, a few seconds, no audio**. Without a clip the player shows a captioned card that says so.
3. Record the sign on the Admin page and retrain (above).

**Every sign and every Luganda word in the seed vocabulary was written without a Deaf signer or a Luganda speaker and is marked "needs verification". Have them checked before real use.**

## Add a sentence pattern

Edit `frontend/data/patterns.json`, section `sentence`. Patterns are tried in order; the first match wins.

```json
{ "id": "want-noun-please", "match": ["@verb", "@noun", "PLEASE"], "exact": true,
  "english": "{2}, please.", "luganda": "{2}, nsaba." }
```

- `match`: glosses or wildcards `@pronoun @verb @noun @adjective @question @number @time`.
- `{1} {2} ...` insert the word at that position. Verbs and adjectives are conjugated for the first pronoun. `{be}` = am/are/is, `{do}` = do/does, `{3:base}` = the plain English verb.
- No pattern matches? The words are joined into a readable phrase and the signer is asked to edit it.

The same file's `text_to_gloss` section holds the word-order rules for Text to Sign (words to ignore, question words moved to the end, time words moved to the front, fingerspelling on/off).

## Add Luganda audio

Put MP3 files in `frontend/static/audio/lg/`. The file name is the Luganda text with accents removed and everything that is not a letter or digit replaced by `_`:

| Spoken | File |
|---|---|
| a whole sentence: "Njagala amazzi." | `njagala_amazzi.mp3` |
| a single sign (fallback): `WATER` | `water.mp3` |

A whole-sentence recording is used first. Otherwise a sentence is played sign by sign **only if every sign has a file**. If nothing matches, the signer sees captions and the note "No Luganda recording yet". Record with a native Luganda speaker.

English is spoken by the browser's own voice (`speechSynthesis`); if the device has no voice, captions are shown.

## Text to Sign: replacing clips with an avatar later

`frontend/sign-renderer.js` has a `ClipRenderer` with two methods, `render(item, stage, opts)` and `cancel()`. A Three.js landmark-driven avatar only needs another class with the same two methods, passed to `SignPlayer`.

## Tests

```powershell
node --test "tests/*.test.js"                                     # recognition maths, smoothing, sentence builder, text to gloss
backend\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"   # tokens, consent, honest recogniser, export

# End to end, in a real browser (server must be running on :5000; needs Edge or Chrome)
node tests/e2e/ui.e2e.js                       # every page and flow, light/dark, phone width
node tests/e2e/contrast.e2e.js                 # WCAG AA contrast of every text element, both themes
node tests/e2e/perf.e2e.js <feeds-dir>         # low-end phone profile: weight, lazy loading, speed
node tests/e2e/recognition.e2e.js <feeds-dir>  # fake camera -> record -> train -> recognise
```

`<feeds-dir>` holds looping test videos (`fine.mjpeg`, `how.mjpeg`, `nohand.mjpeg`, `black.mjpeg`) made with ffmpeg from still photos; see the header of `tests/e2e/recognition.e2e.js`. The recognition test creates and then deletes its own data.

## Design

Charcoal `#1E1E1C`, sand `#D8CBB3`, electric blue (`#2E6AFF` for fills, one unit from `#2F6BFF` so white text reaches 4.5:1; `#1A44BB` where blue is text). Type: Schibsted Grotesk with Newsreader italic as the accent. Tokens are at the top of `frontend/style2.css`; component character is in `frontend/brand.css`. `PRODUCT.md` records the product context used by the Impeccable design tools.

## Privacy

See `frontend/privacy.html`. Video is never stored. Signs-to-sentence sends nothing off the device. The older Capture / Real-time buttons send single frames to this server, which discards them. Training data is hand-point numbers only, saved with consent and a signer code.

## Known limits

- **No trained sign model ships.** Until signers have recorded data and the model is trained, recognition shows "no trained sign model yet" and the **Add a sign by hand** picker can be used.
- The old pixel-based server model (Capture / Real-time buttons) is unreliable. It now refuses any picture without a detected hand and answers only at 80% confidence or more.
- The database layer needs MongoDB Atlas for accounts and history. Everything offline works without it.
- Speech input ("Speak instead") uses the browser's speech service, which may send audio online. Typing is always offline.
- Pricing and payment behaviour was not changed.
