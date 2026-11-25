"""Minimal MCP stdio server used to probe how agent CLIs see Galeata-like tools.

It exposes `plan.get`, `plan.set` and `plan.update_step` (dotted names, like galeata-mcp) and
logs every call to the file given as first argument, so a probe can check which
name the agent used and whether the call went through.

Usage (by a CLI's MCP config): python3 -I fake_mcp_server.py /path/to/calls.log [plan.json]
An optional plan.json is returned by plan.get (default: a one-step demo plan).
"""

import json
import sys

LOG = sys.argv[1]
PLAN = (
    open(sys.argv[2], encoding="utf-8").read()
    if len(sys.argv) > 2
    else '{"revision":3,"objective":"Démo","steps":[{"id":"s1","title":"Lire hello.txt","status":"pending"}]}'
)
TOOLS = [
    {
        "name": "plan.get",
        "description": "Lire le plan de mission et sa révision",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "plan.set",
        "description": "Fixer l'objectif et les étapes du plan de mission",
        "inputSchema": {
            "type": "object",
            "properties": {
                "revision": {"type": "integer"},
                "objective": {"type": "string"},
                "steps": {"type": "array", "items": {"type": "object"}},
            },
            "required": ["revision", "objective", "steps"],
            "additionalProperties": False,
        },
    },
    {
        "name": "plan.update_step",
        "description": "Mettre à jour l'état d'une étape du plan de mission",
        "inputSchema": {
            "type": "object",
            "properties": {
                "revision": {"type": "integer"},
                "id": {"type": "string"},
                "status": {"type": "string", "enum": ["pending", "in_progress", "done"]},
            },
            "required": ["revision", "id", "status"],
            "additionalProperties": False,
        },
    },
]


def reply(message_id, result):
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": message_id, "result": result}) + "\n")
    sys.stdout.flush()


for line in sys.stdin:
    try:
        message = json.loads(line)
    except ValueError:
        continue
    method, message_id = message.get("method"), message.get("id")
    if message_id is None:
        continue
    if method == "initialize":
        reply(message_id, {
            "protocolVersion": message["params"].get("protocolVersion", "2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "galeata-probe", "version": "0"},
        })
    elif method == "tools/list":
        reply(message_id, {"tools": TOOLS})
    elif method == "tools/call":
        with open(LOG, "a", encoding="utf-8") as log:
            log.write(json.dumps(message["params"], ensure_ascii=False) + "\n")
        name = message["params"]["name"]
        # Behaves like Galeata: updates change the plan (and end "tracked: false").
        plan = json.loads(PLAN)
        args = message["params"].get("arguments", {})
        if name == "plan.update_step":
            for step in plan.get("steps", []):
                if step["id"] == args.get("id"):
                    step["status"] = args.get("status", step["status"])
            plan.pop("tracked", None)
            plan["revision"] = plan.get("revision", 0) + 1
            PLAN = json.dumps(plan, ensure_ascii=False)
        text = PLAN
        reply(message_id, {"content": [{"type": "text", "text": text}]})
    else:
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": message_id, "error": {"code": -32601, "message": method}}) + "\n")
        sys.stdout.flush()
