import sys
import os

backend_path = os.path.join(os.path.dirname(__file__), 'backend')
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from server import app as application, socketio

# Alias for gunicorn
app = application

if __name__ == "__main__":
    debug = bool(application.config.get("DEBUG", False))
    if socketio:
        socketio.run(application, host="0.0.0.0", port=5000, debug=debug, use_reloader=False)
    else:
        application.run(host="0.0.0.0", port=5000, debug=debug, use_reloader=False)
