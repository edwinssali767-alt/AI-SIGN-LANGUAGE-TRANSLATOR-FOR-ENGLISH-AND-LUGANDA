import os
import sys
from pathlib import Path

backend_dir = Path(__file__).parent / 'backend'
sys.path.insert(0, str(backend_dir))
os.chdir(backend_dir)

from app import app as application

if __name__ == '__main__':
    application.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))