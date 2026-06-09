import os
import sys
from pathlib import Path

backend_dir = Path(__file__).parent / 'backend'
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

os.chdir(backend_dir)

# Now we can import from backend
from app import app

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))