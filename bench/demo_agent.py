# The scripted "agent" for bench/demo_gif.sh: plain MCP JSON-RPC over `tobari mcp`, paced so a viewer can follow.
import json, subprocess, sys, time
p = subprocess.Popen([sys.argv[1], "mcp"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
n = 0
def rpc(method, params=None):
    global n
    n += 1
    p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": n, "method": method, "params": params or {}}) + "\n")
    p.stdin.flush()
    return json.loads(p.stdout.readline())
def tool(name, pause=1.2, **a):
    r = rpc("tools/call", {"name": name, "arguments": a})
    time.sleep(pause)
    return r
rpc("initialize", {"protocolVersion": "2025-03-26"})
tool("tobari_open", 2.2, url=sys.argv[2])
for item in ["JR Pass", "Umbrella", "Portable charger"]:
    tool("tobari_fill", 0.9, selector="#item", text=item)
    tool("tobari_click", 1.1, selector="#add")
tool("tobari_read", 1.5)
tool("tobari_screenshot", 1.5)
