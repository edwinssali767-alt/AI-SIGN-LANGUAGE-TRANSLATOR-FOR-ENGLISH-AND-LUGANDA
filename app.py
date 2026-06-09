import sys
import os

backend_path = os.path.join(os.path.dirname(__file__), 'backend')
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from server import app as application, socketio

if __name__ == "__main__":
    if socketio:
        socketio.run(application, host="0.0.0.0", port=5000)
    else:
        application.run(host="0.0.0.0", port=5000)