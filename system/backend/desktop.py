# desktop.py
import threading
import webview
from main import app

def run_flask():
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)

if __name__ == "__main__":
    threading.Thread(target=run_flask, daemon=True).start()
    webview.create_window("Biri_Go", "http://127.0.0.1:5000", width=1280, height=800)
    webview.start()