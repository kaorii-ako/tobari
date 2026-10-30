"""Serve bench/script-test and print the first result the page posts, then exit.

Usage: python3 bench/script_server.py PORT [DIR]  (prints one JSON line)
"""
import http.server, pathlib, sys

ROOT = pathlib.Path(__file__).parent / (sys.argv[2] if len(sys.argv) > 2 else "script-test")


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.send_response(204)
        self.end_headers()
        print(body.decode(), flush=True)
        self.server.done = True

    def log_message(self, *a):
        pass


srv = http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H)
srv.done = False
srv.timeout = 60
while not srv.done:
    srv.handle_request()
