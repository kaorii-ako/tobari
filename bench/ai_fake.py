"""Fake OpenAI-compatible model server for bench/ai_test.sh: python3 bench/ai_fake.py PORT OUT.json

Serves a test page at /page.html, lists one model, streams a fixed Thai + English reply, and writes the
first chat request body to OUT.json.
"""
import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAGE = "<!doctype html><meta charset=utf-8><title>Kiwi notes</title><p>Kiwi birds cannot fly. Marker ZEBRA-42.</p>"

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/page.html":
            self.send(200, "text/html; charset=utf-8", PAGE.encode())
        elif self.path == "/v1/models":
            self.send(200, "application/json", b'{"data":[{"id":"fake-1"}]}')
        else:
            self.send(404, "text/plain", b"no")

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        open(sys.argv[2], "wb").write(body)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for part in ["Kiwi ", "can't fly. ", "นกกีวีบินไม่ได้"]:
            ev = {"choices": [{"delta": {"content": part}}]}
            self.wfile.write(f"data: {json.dumps(ev)}\n\n".encode())
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")

ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
