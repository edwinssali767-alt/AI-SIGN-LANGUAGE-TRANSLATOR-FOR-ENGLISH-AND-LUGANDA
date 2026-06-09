import os
import sys
from pathlib import Path

backend_dir = Path(__file__).parent / 'backend'
sys.path.insert(0, str(backend_dir))
os.chdir(backend_dir)

import backend.app as backend_app

app = backend_app.app