#!/usr/bin/env python3
import json
import os
import struct
import subprocess
import sys
import time

CORE = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.local/share/tobari/bin/tobari-core")


def send(proc, obj):
    data = json.dumps(obj).encode()
    proc.stdin.write(struct.pack("<I", len(data)) + data)
    proc.stdin.flush()


def read_msg(proc):
    header = proc.stdout.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("<I", header)
    return json.loads(proc.stdout.read(length))


def main():
    log_dir = os.path.expanduser("~/.local/state/tobari/logs")
    os.makedirs(log_dir, exist_ok=True)
    stderr_log = open(os.path.join(log_dir, "acceptance-sidecar.log"), "wb")
    proc = subprocess.Popen(
        [CORE],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=stderr_log,
        bufsize=0,
    )
    send(proc, {"type": "hello", "origin": "chrome-extension://icoelnobjkgnmgemdeljcnkemjmhomcb/"})
    send(proc, {"type": "get_status", "origin": "chrome-extension://icoelnobjkgnmgemdeljcnkemjmhomcb/"})

    ready = False
    deadline = time.time() + 240
    while time.time() < deadline:
        msg = read_msg(proc)
        if msg is None:
            print("sidecar closed stdout", flush=True)
            break
        print("EVENT", json.dumps(msg), flush=True)
        if msg.get("type") == "status" and msg.get("state") == "ready":
            ready = True
            break
        if msg.get("type") == "error":
            break

    if not ready:
        print("NOT_READY", flush=True)
        proc.terminate()
        return 1

    send(
        proc,
        {
            "type": "chat",
            "req_id": "acceptance-1",
            "mode": "chat",
            "prompt": "Reply with exactly the word: tobari",
        },
    )
    collected = []
    deadline = time.time() + 180
    while time.time() < deadline:
        msg = read_msg(proc)
        if msg is None:
            break
        if msg.get("type") == "stream_delta":
            collected.append(msg["delta"])
        elif msg.get("type") == "done":
            print("DONE", flush=True)
            break
        elif msg.get("type") == "error":
            print("CHAT_ERROR", json.dumps(msg), flush=True)
            break
    text = "".join(collected).strip()
    print("ANSWER:", text, flush=True)
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    return 0 if text else 1


if __name__ == "__main__":
    sys.exit(main())
