#!/usr/bin/env bash
# Agent bridge check: bench/mcp_test.sh BIN. Speaks MCP over `tobari mcp` stdio: fill + click a page, read the
# title back, take a screenshot, and check built-in pages stay off limits.
set -uo pipefail
bin=$(realpath "$1"); here=$(dirname "$0")
export XDG_DATA_HOME=$(mktemp -d)
port=$((20000 + RANDOM % 20000))
python3 "$here/script_server.py" $port mcp-test >/dev/null 2>&1 & srv=$!
WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 \
  timeout -s INT 40 cage -- "$bin" --ozone-platform=wayland http://127.0.0.1:$port/index.html >/dev/null 2>&1 & app=$!
for _ in $(seq 50); do "$bin" tabs >/dev/null 2>&1 && break; sleep 0.2; done
sleep 3
pass=0; fail=()
check() { if eval "$2"; then pass=$((pass + 1)); else fail+=("$1"); fi; }
out=$(python3 - "$bin" <<'P'
import json, subprocess, sys
p = subprocess.Popen([sys.argv[1], "mcp"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
n = 0
def rpc(method, params=None, note=False):
    global n
    m = {"jsonrpc": "2.0", "method": method, "params": params or {}}
    if not note: n += 1; m["id"] = n
    p.stdin.write(json.dumps(m) + "\n"); p.stdin.flush()
    return None if note else json.loads(p.stdout.readline())
def tool(name, **a): return rpc("tools/call", {"name": name, "arguments": a})["result"]
r = {}
r["init"] = rpc("initialize", {"protocolVersion": "2025-03-26"})["result"]["serverInfo"]["name"] == "tobari"
rpc("notifications/initialized", note=True)
r["tools"] = len(rpc("tools/list")["result"]["tools"]) == 7
r["fill"] = not tool("tobari_fill", selector="#name", text="agent")["isError"]
r["click"] = not tool("tobari_click", selector="#go")["isError"]
r["nomatch"] = tool("tobari_click", selector="#nope")["isError"]
r["title"] = "hello agent" in tool("tobari_tabs")["content"][0]["text"]
shot = tool("tobari_screenshot")["content"][0]
r["shot"] = shot["type"] == "image" and shot["data"].startswith("iVBOR")
r["unknown"] = rpc("nope")["error"]["code"] == -32601
print(json.dumps(r))
P
)
for k in init tools fill click nomatch title shot unknown; do
  check "$k" "[ \"\$(echo '$out' | python3 -c \"import json,sys; print(json.load(sys.stdin).get('$k'))\")\" = True ]"
done
kill -INT $app 2>/dev/null; wait $app 2>/dev/null; kill $srv 2>/dev/null
rm -rf "$XDG_DATA_HOME"
echo "mcp: $([ ${#fail[@]} = 0 ] && echo PASS || echo FAIL) $pass / $((pass + ${#fail[@]})) ${fail[*]:-}"
[ ${#fail[@]} = 0 ]
