"""Probe: does Codex call a Galeata-like MCP tool without asking, given extra -c options?

Usage: python3 -I codex_mcp_probe.py WORKDIR LOGFILE [-c key=value ...]
       [--task TEXT] [--instructions TEXT]   (task instead of the tool-call prompt,
                                              developerInstructions for thread/start)
Starts `codex app-server` with the fake MCP server (scripts/probe/fake_mcp_server.py)
registered as "galeata", asks for plan.get + plan.update_step, declines any approval
request, and prints what happened. Exit code 0 when both calls reached the server
without any approval request.
"""

import json
import os
import pathlib
import subprocess
import sys
import time

workdir, log = sys.argv[1], sys.argv[2]
extra, task, instructions = [], None, None
rest = sys.argv[3:]
while rest:
    flag = rest.pop(0)
    if flag == "--task":
        task = rest.pop(0)
    elif flag == "--instructions":
        instructions = rest.pop(0)
    else:
        extra.append(flag)
server = pathlib.Path(__file__).with_name("fake_mcp_server.py")
args = json.dumps(["-I", str(server), log])
command = [
    os.path.expanduser("~/.local/bin/codex"), "app-server",
    "-c", 'mcp_servers.galeata.command="python3"',
    "-c", f"mcp_servers.galeata.args={args}",
    *extra,
]
prompt = task or ("Appelle l'outil MCP galeata plan.get, puis plan.update_step pour mettre l'étape s1 "
          "à in_progress avec la révision obtenue. Réponds ensuite juste : fait.")
pathlib.Path(log).unlink(missing_ok=True)
proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL, text=True, cwd=workdir)


def send(message):
    proc.stdin.write(json.dumps(message) + "\n")
    proc.stdin.flush()


asked = []
send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"clientInfo": {"name": "galeata", "version": "0"}}})
deadline = time.time() + 150
for line in proc.stdout:
    message = json.loads(line)
    if message.get("id") == 1 and "result" in message:
        send({"jsonrpc": "2.0", "method": "initialized"})
        send({"jsonrpc": "2.0", "id": 2, "method": "thread/start", "params": {
            "cwd": workdir, "approvalPolicy": "on-request", "sandbox": "workspace-write", "ephemeral": True,
            **({"developerInstructions": instructions} if instructions else {})}})
    elif message.get("id") == 2 and "result" in message:
        thread = message["result"]["thread"]["id"]
        send({"jsonrpc": "2.0", "id": 3, "method": "turn/start", "params": {
            "threadId": thread, "input": [{"type": "text", "text": prompt}]}})
    elif message.get("method") and message.get("id") is not None:
        asked.append(message["method"])
        send({"jsonrpc": "2.0", "id": message["id"], "result": {"action": "decline"}})
    elif message.get("method") == "turn/completed":
        break
    if time.time() > deadline:
        print("délai dépassé")
        break
proc.kill()
calls = [json.loads(l)["name"] for l in open(log)] if os.path.exists(log) else []
for line in (open(log) if os.path.exists(log) else []):
    call = json.loads(line)
    args = {k: v for k, v in call.get("arguments", {}).items() if k != "revision"}
    print("  ", call["name"], json.dumps(args, ensure_ascii=False)[:200])
print(f"options {extra} → demandes : {asked or 'aucune'} ; appels reçus : {calls or 'aucun'}")
sys.exit(0 if calls and not asked else 1)
