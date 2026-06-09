import os
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent
backend_dir = project_root / 'backend'
for path in (project_root, backend_dir):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

os.chdir(backend_dir)

# Import the backend Flask app without shadowing this wrapper module.
from backend.app import app

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
