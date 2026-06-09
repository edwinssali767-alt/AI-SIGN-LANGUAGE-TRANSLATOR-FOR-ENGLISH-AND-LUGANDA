#!/usr/bin/env python
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / 'backend'))
os.chdir(Path(__file__).parent / 'backend')
from app import app as application

if __name__ == '__main__':
    application.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))