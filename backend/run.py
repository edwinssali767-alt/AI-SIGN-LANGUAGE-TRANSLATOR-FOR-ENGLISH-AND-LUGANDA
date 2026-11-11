import sys
import os

backend_path = os.path.dirname(os.path.abspath(__file__))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from server import app as application, socketio

# Alias for gunicorn
app = application

if __name__ == "__main__":
    # Safe defaults: localhost only, no debugger. For phone testing on your Wi-Fi set HOST=0.0.0.0;
    # for auto-reload while developing set FLASK_DEBUG=1.
    host = os.getenv("HOST", "127.0.0.1")
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    if socketio:
        socketio.run(application, host=host, port=5000, debug=debug, use_reloader=False, allow_unsafe_werkzeug=True)
    else:
        application.run(host=host, port=5000, debug=debug, use_reloader=False)
