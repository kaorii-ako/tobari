#!/usr/bin/env python3
import base64
import json
import os
import struct
import subprocess
import sys

HOST_DIR = os.environ.get("TOBARI_HOST_DIR", os.path.expanduser("~/.local/share/tobari"))
HOST_BIN = os.path.join(HOST_DIR, "tobari-core")
MANIFEST_NAME = "dev.tobari.core.json"

BROWSERS = [
    ("chrome", "~/.config/google-chrome/NativeMessagingHosts"),
    ("chromium", "~/.config/chromium/NativeMessagingHosts"),
    ("brave", "~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
]


def read_manifest_template():
    with open(os.path.join(os.path.dirname(__file__), "native-host.json")) as f:
        return f.read()


def install(ext_id):
    template = read_manifest_template()
    body = template.replace("__TOBARI_EXT_ID__", ext_id)
    for name, rel in BROWSERS:
        d = os.path.expanduser(os.path.join(rel))
        if not os.path.isdir(os.path.dirname(d)):
            continue
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, MANIFEST_NAME), "w") as f:
            f.write(body.replace("__HOST_PATH__", HOST_BIN))
        print(f"installed manifest for {name}")


def smoke():
    p = subprocess.Popen(
        [HOST_BIN, "serve"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
    )
    assert p.stdin and p.stdout
    msg = json.dumps({"type": "status"}).encode()
    p.stdin.write(struct.pack("<I", len(msg)) + msg)
    p.stdin.flush()
    raw = p.stdout.read(4)
    (n,) = struct.unpack("<I", raw)
    body = p.stdout.read(n)
    print(body.decode())
    p.kill()


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "install":
        install(sys.argv[2])
    elif len(sys.argv) == 2 and sys.argv[1] == "smoke":
        smoke()
    else:
        print("usage: install-native-host.py install <ext-id> | smoke")
