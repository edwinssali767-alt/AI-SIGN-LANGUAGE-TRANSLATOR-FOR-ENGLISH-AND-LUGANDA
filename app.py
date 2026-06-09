import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from app import app as application, socketio

if __name__ == "__main__":
    if socketio:
        socketio.run(application, host="0.0.0.0", port=5000)
    else:
        application.run(host="0.0.0.0", port=5000)