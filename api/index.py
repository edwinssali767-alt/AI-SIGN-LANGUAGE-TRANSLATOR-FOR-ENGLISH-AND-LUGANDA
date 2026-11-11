"""Vercel serverless entrypoint: exposes the Flask API (accounts, history, admin) at /api/*.

The static site in frontend/ is served by Vercel's CDN. Only the light backend runs here;
heavy ML packages (mediapipe, opencv, scikit-learn) are not installed on Vercel because
recognition runs in the browser.
"""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / 'backend'
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from server import app  # noqa: E402,F401  (Vercel looks for `app`)
