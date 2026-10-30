#!/usr/bin/env python3
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

args = sys.argv[1:]
opt = {args[i]: args[i + 1] for i in range(0, len(args) - 1) if args[i].startswith("--") or args[i] == "-m" or args[i] == "-c"}
host, port, key = opt["--host"], int(opt["--port"]), opt["--api-key"]
if host != "127.0.0.1":
    sys.exit("refusing: not bound to loopback")
if len(key) < 64:
    sys.exit("refusing: token too short")
log = os.environ.get("FAKE_LLAMA_LOG")
if log:
    with open(log, "a") as f:
        f.write(json.dumps({"pid": os.getpid(), "host": host, "model": opt["-m"]}) + "\n")


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def authed(self):
        if self.headers.get("Authorization") != f"Bearer {key}":
            self.send_response(401)
            self.end_headers()
            return False
        return True

    def do_GET(self):
        if not self.authed():
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def do_POST(self):
        if not self.authed():
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        last = body["messages"][-1]["content"]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for piece in ["pong: ", last[:40]]:
            chunk = {"choices": [{"delta": {"content": piece}}]}
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")


ThreadingHTTPServer((host, port), H).serve_forever()
