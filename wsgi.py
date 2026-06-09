#!/usr/bin/env python
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend'))
from app import app
app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))