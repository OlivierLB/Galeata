"""Fake agent CLI for transport tests.

Replays a captured fixture (tests/fixtures/agents/*.jsonl): every recorded
outbound line is printed, and every recorded inbound line makes the script
wait for one real line on stdin, which is echoed to stderr for diagnostics.
Exits 0 at the end of the fixture, or 3 if stdin closes early.
"""

import json
import sys


def main(path: str) -> int:
    with open(path, encoding="utf-8") as fixture:
        records = [json.loads(line) for line in fixture if line.strip()]
    for record in records:
        if record["dir"] == "in":
            received = sys.stdin.readline()
            if not received:
                print("stdin fermé trop tôt", file=sys.stderr)
                return 3
            print(f"reçu {received.strip()[:120]}", file=sys.stderr, flush=True)
        elif isinstance(record["msg"], str):
            print(record["msg"], flush=True)
        else:
            print(json.dumps(record["msg"], ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
