import os
import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent
project_root = backend_dir.parent
for path in (project_root, backend_dir):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))
os.chdir(backend_dir)

from server import app as application

# Gunicorn looks for 'application' or 'app'
app = application
