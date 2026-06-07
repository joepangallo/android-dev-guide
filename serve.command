#!/bin/bash
# ============================================================================
# Android Development Teaching Guide — local server launcher (double-click on macOS).
#
# WHY: the live "Run" buttons (challenge arena, runnable code) compile on
# JetBrains' Kotlin server. That server refuses requests from a file:// page
# (the browser sends "Origin: null"). Served over http it works normally.
# This serves the guide at http://localhost:8765 and opens it for you.
# Keep this window open while you use the guide; close it (or Ctrl-C) to stop.
# ============================================================================
cd "$(dirname "$0")" || exit 1
PORT=8765
PY="$(command -v python3 || command -v python)"
if [ -z "$PY" ]; then
  echo "Python 3 is required but was not found."
  echo "Install it from https://www.python.org/downloads/ and run this again."
  read -n 1 -s -r -p "Press any key to close…"; echo; exit 1
fi
URL="http://localhost:${PORT}/index.html"
echo "────────────────────────────────────────────────────────────"
echo "  Android Development — Teaching Guide"
echo "  Serving at:  ${URL}"
echo ""
echo "  Keep this window OPEN while you use the guide."
echo "  Press Ctrl-C (or close this window) to stop the server."
echo "────────────────────────────────────────────────────────────"
( sleep 1; open "${URL}" >/dev/null 2>&1 || "$PY" -m webbrowser "${URL}" >/dev/null 2>&1 ) &
exec "$PY" -m http.server "${PORT}"
