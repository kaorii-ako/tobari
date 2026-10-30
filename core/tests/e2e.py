#!/usr/bin/env python3
import hashlib
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.environ.get("TOBARI_BIN", os.path.join(ROOT, "target/debug/tobari"))
EXT = "chrome-extension://dbpaojilndlchffoodnamfgjccblnpoe/"

tmp = tempfile.mkdtemp(prefix="tobari-e2e-")
env = dict(os.environ)
env.update({
    "HOME": tmp,
    "XDG_CONFIG_HOME": f"{tmp}/config",
    "XDG_DATA_HOME": f"{tmp}/data",
    "XDG_STATE_HOME": f"{tmp}/state",
    "XDG_RUNTIME_DIR": f"{tmp}/run",
    "TOBARI_LLAMA_SERVER": os.path.join(ROOT, "tests/fake_llama_server.py"),
    "FAKE_LLAMA_LOG": f"{tmp}/llama.log",
    "TOBARI_FORCE_CPU": "1",
})
os.makedirs(f"{tmp}/run", mode=0o700)
os.makedirs(f"{tmp}/data/tobari/models")
os.makedirs(f"{tmp}/config/tobari")
model = b"GGUF fake weights for tests"
with open(f"{tmp}/data/tobari/models/tiny.gguf", "wb") as f:
    f.write(model)
with open(f"{tmp}/data/tobari/models/models.toml", "w") as f:
    f.write(f'''[[models]]
id = "tiny"
repo = "none/none"
file = "tiny.gguf"
sha256 = "{hashlib.sha256(model).hexdigest()}"
license = "test"
size_mb = 1
ctx_default = 512
default = true
''')
with open(f"{tmp}/config/tobari/settings.toml", "w") as f:
    f.write("idle_unload_secs = 2\n")

host = subprocess.Popen([BIN, EXT], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env)
inbox = {}
parts = {}
seen_parts = set()
browser_requests = []
lock = threading.Condition()


def reader():
    while True:
        h = host.stdout.read(4)
        if len(h) < 4:
            return
        (n,) = struct.unpack("=I", h)
        msg = json.loads(host.stdout.read(n))
        if msg.get("type") == "part":
            parts.setdefault(msg["id"], []).append(msg["data"])
            seen_parts.add(msg["id"])
            if msg["seq"] + 1 < msg["count"]:
                continue
            msg = json.loads("".join(parts.pop(msg["id"])))
        with lock:
            if msg.get("type") == "browser":
                browser_requests.append(msg)
            else:
                inbox.setdefault(msg.get("id"), []).append(msg)
            lock.notify_all()


threading.Thread(target=reader, daemon=True).start()


def send(obj):
    b = json.dumps(obj).encode()
    host.stdin.write(struct.pack("=I", len(b)) + b)
    host.stdin.flush()


def call(i, obj, timeout=15):
    send({"id": i, **obj})
    end = time.time() + timeout
    with lock:
        while time.time() < end:
            msgs = inbox.get(i, [])
            done = [m for m in msgs if m["type"] in ("result", "error")]
            if done:
                return msgs
            lock.wait(0.2)
    raise SystemExit(f"timeout waiting for {obj['type']}")


def result(msgs):
    last = msgs[-1]
    if last["type"] == "error":
        raise SystemExit(f"error: {last['message']}")
    return last["data"]


checks = []


def ok(name, cond):
    checks.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)


st = result(call(1, {"type": "status"}))
ok("status reports local destination", st["destination"]["local"] and st["destination"]["model"] == "tiny")
ok("sidecar starts stopped", st["sidecar"]["running"] is False)

msgs = call(2, {"type": "chat", "messages": [{"role": "user", "content": "ping 帳 ภาษาไทย"}]})
deltas = "".join(m["text"] for m in msgs if m["type"] == "delta")
ok("chat streams through sidecar with bearer token", deltas == "pong: ping 帳 ภาษาไทย")
ok("chat announces destination first", msgs[0]["type"] == "destination")
log = [json.loads(l) for l in open(f"{tmp}/llama.log")]
ok("llama-server bound to 127.0.0.1", log[0]["host"] == "127.0.0.1")
ok("sidecar running after chat", result(call(3, {"type": "status"}))["sidecar"]["running"])

skills = result(call(4, {"type": "skills.list"}))
ok("10 bundled skills installed", len(skills["skills"]) == 10 and not skills["errors"])
gh = result(call(5, {"type": "skills.for_site", "host": "github.com"}))
ok("explain-github-pr offered on github.com", any(s["name"] == "explain-github-pr" for s in gh))

result(call(6, {"type": "memory.write", "name": "trip", "content": "Hotel near Namba 帳簿"}))
hits = result(call(7, {"type": "memory.search", "query": "namba"}))
ok("memory write and search", hits and hits[0]["name"] == "trip")
ok("memory files are plain markdown", open(f"{tmp}/data/tobari/memory/trip.md").read().startswith("Hotel"))

verdict = result(call(8, {"type": "guard.check", "action": {"tool": "navigate", "args": {"url": "javascript:alert(1)"}, "why": "x"}, "context": {"user_request": "open it"}}))
ok("guard denies javascript: URLs", verdict["decision"] == "deny")

big = result(call(9, {"type": "guard.wrap", "source": "big", "text": "あ" * 400000}))
ok("responses over 1 MB arrive in parts and reassemble", 9 in seen_parts and big.count("あ") == 400000)

out = {}


def run_cli():
    out["tabs"] = subprocess.run([BIN, "--json", "tabs"], env=env, capture_output=True, text=True, timeout=20)


t = threading.Thread(target=run_cli)
t.start()
end = time.time() + 10
while time.time() < end and not browser_requests:
    time.sleep(0.1)
if browser_requests:
    r = browser_requests[0]
    send({"type": "browser_result", "id": r["id"], "data": [{"id": 7, "title": "帳 test", "url": "https://example.org/", "active": True}]})
t.join()
ok("CLI `tobari tabs` reaches the browser over the control socket", '"帳 test"' in out["tabs"].stdout)
ok("control socket is private", oct(os.stat(f"{tmp}/run/tobari").st_mode & 0o777) == "0o700")

time.sleep(14)
ok("sidecar unloads after idle timeout", result(call(10, {"type": "status"}))["sidecar"]["running"] is False)
pid = log[0]["pid"]
alive = os.path.exists(f"/proc/{pid}") and "Z" not in open(f"/proc/{pid}/stat").read().split()[2]
ok("llama-server process is gone", not alive)

host.stdin.close()
host.wait(timeout=10)
ok("host exits when the browser disconnects", host.returncode == 0)
ok("control socket removed on exit", not os.path.exists(f"{tmp}/run/tobari/control.sock"))

failed = [n for n, c in checks if not c]
print(f"\n{len(checks) - len(failed)}/{len(checks)} passed")
sys.exit(1 if failed else 0)
