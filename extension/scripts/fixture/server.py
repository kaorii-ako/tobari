#!/usr/bin/env python3
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
CALLS = []


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def do_POST(self):
        if self.path != "/mcp":
            self.send_error(404)
            return
        msg = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        method = msg.get("method")
        if "id" not in msg:
            self.send_response(202)
            self.end_headers()
            return
        if method == "initialize":
            result = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "fruit-shop", "version": "1"}}
        elif method == "tools/list":
            result = {"tools": [{"name": "get_price", "description": "Price of a fruit in yen", "inputSchema": {"type": "object", "properties": {"fruit": {"type": "string"}}, "required": ["fruit"]}}]}
        elif method == "tools/call":
            CALLS.append(msg["params"])
            fruit = msg["params"]["arguments"].get("fruit", "")
            result = {"content": [{"type": "text", "text": f"{fruit}: 120 yen (calls so far: {len(CALLS)})"}]}
        else:
            body = {"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "no such method"}}
            return self.reply(body, sse=False)
        self.reply({"jsonrpc": "2.0", "id": msg["id"], "result": result}, sse=method == "tools/call")

    def reply(self, body, sse):
        data = json.dumps(body)
        self.send_response(200)
        self.send_header("Mcp-Session-Id", "test-session")
        if sse:
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(f"event: message\ndata: {data}\n\n".encode())
        else:
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data.encode())


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
