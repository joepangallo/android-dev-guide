#!/usr/bin/env bash
# COP4667 Teaching Guide — local server (Linux / generic).
# Live "Run" needs an http origin; file:// is CORS-blocked by the Kotlin compiler.
# Usage:  bash serve.sh    then open http://localhost:8765/index.html
cd "$(dirname "$0")" || exit 1
PORT=8765
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "Python 3 is required but was not found."; exit 1; }
URL="http://localhost:${PORT}/index.html"
echo "Serving the COP4667 guide at ${URL}  (Ctrl-C to stop)"
( sleep 1; xdg-open "${URL}" >/dev/null 2>&1 || "$PY" -m webbrowser "${URL}" >/dev/null 2>&1 ) &
exec "$PY" -m http.server "${PORT}"
