"""
Single-service deployment: web server (keepalive) + 24/7 hunter loop.
Runs on Render FREE plan - no cron or paid worker needed.
"""
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

from night_shift import main as run_night_shift

INTERVAL_SEC = 15 * 60  # every 15 minutes


def hunter_loop():
    while True:
        try:
            print("[hunter] cycle start", flush=True)
            run_night_shift()
        except Exception:
            traceback.print_exc()
        time.sleep(INTERVAL_SEC)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"massagevip control plane alive")

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    threading.Thread(target=hunter_loop, daemon=True).start()
    port = int(__import__("os").environ.get("PORT", 10000))
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
