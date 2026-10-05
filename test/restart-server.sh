#!/usr/bin/env bash
# Restart the TollAI server detached from the calling shell and wait until it
# actually answers, so tests never race a stale process.
set -u
cd "$(dirname "$0")/.."

pkill -9 -f "node server.js" 2>/dev/null
sleep 1

USE_OLLAMA=false setsid node server.js > /tmp/srv.log 2>&1 < /dev/null &
disown 2>/dev/null || true

for _ in $(seq 1 40); do
  if curl -fs -o /dev/null "http://localhost:${PORT:-3000}/tollai/status" 2>/dev/null; then
    echo "server ready on :${PORT:-3000}"
    exit 0
  fi
  sleep 0.5
done

echo "server failed to start; last log lines:" >&2
tail -20 /tmp/srv.log >&2
exit 1
