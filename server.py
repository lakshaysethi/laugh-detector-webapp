from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


STATE_LOCK = threading.Lock()
STATE = {
    "status": "Idle",
    "detail": "Camera is off.",
    "tone": "neutral",
    "laughScore": 0,
    "happyScore": 0,
    "mouthOpenScore": 0,
    "faceCount": 0,
    "updatedAt": None,
    "source": "server",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class LaughDetectorHandler(SimpleHTTPRequestHandler):
    def _set_json_headers(self, status: HTTPStatus = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        if self.path.startswith("/api/"):
            self._set_json_headers(HTTPStatus.NO_CONTENT)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api/live":
            with STATE_LOCK:
                payload = dict(STATE)
            self._set_json_headers()
            self.wfile.write(json.dumps(payload).encode("utf-8"))
            return

        if self.path == "/api/health":
            self._set_json_headers()
            self.wfile.write(json.dumps({"ok": True, "updatedAt": now_iso()}).encode("utf-8"))
            return

        return super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/live":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            incoming = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid JSON")
            return

        snapshot = {
            "status": str(incoming.get("status", "Idle")),
            "detail": str(incoming.get("detail", "")),
            "tone": str(incoming.get("tone", "neutral")),
            "laughScore": float(incoming.get("laughScore", 0)),
            "happyScore": float(incoming.get("happyScore", 0)),
            "mouthOpenScore": float(incoming.get("mouthOpenScore", 0)),
            "faceCount": int(incoming.get("faceCount", 0)),
            "updatedAt": incoming.get("updatedAt") or now_iso(),
            "source": "browser",
        }

        with STATE_LOCK:
            STATE.update(snapshot)

        self._set_json_headers(HTTPStatus.NO_CONTENT)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        # Keep container logs quiet unless there is an actual error.
        return


def main() -> None:
    port = int(os.environ.get("PORT", "4173"))
    os.chdir(os.path.dirname(__file__))
    server = ThreadingHTTPServer(("0.0.0.0", port), LaughDetectorHandler)
    print(f"Serving laugh detector on http://0.0.0.0:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
