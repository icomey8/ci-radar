#!/bin/sh
# Builds the Debug app, launches it, captures its window to a PNG, prints the path, and quits it (spec §7.4).
# Usage: screenshot.sh [scenario]
# With a scenario the app serves that fixture scenario (`-fixtureScenario`); without one it talks to
# `pnpm api` like run.sh. Needs Screen Recording for the app running this script.
set -eu
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
cd "$(dirname "$0")/.."

scenario="${1:-}"

xcodebuild -project CIRadar.xcodeproj -scheme CIRadar -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath .build/xcode -quiet build

if [ -n "$scenario" ]; then
  set -- -fixtureScenario "$scenario"
elif [ -n "${API_PORT:-}" ]; then
  set -- -apiBaseURL "http://localhost:$API_PORT"
else
  set --
fi

app=.build/xcode/Build/Products/Debug/CIRadar.app
pkill -x CIRadar || true
# Run the executable directly rather than via `open`, so we have its PID and its stderr.
"$app/Contents/MacOS/CIRadar" "$@" -ApplePersistenceIgnoreState YES &
pid=$!
# Quit every copy, in case `open` below started a second one, and wait so none outlives the script.
trap 'pkill -x CIRadar || true; wait "$pid" 2>/dev/null || true' EXIT

window=$(swift scripts/window-id.swift "$pid")
# A directly-run app starts in the background; `open` on the running copy brings it to the front,
# so the capture shows the active window. Then let the first load land and the window finish drawing.
open "$app"
sleep 1

mkdir -p .build/screenshots
out="$(pwd)/.build/screenshots/${scenario:-live}.png"
rm -f "$out"
if ! screencapture -x -o -l "$window" "$out" || [ ! -s "$out" ]; then
  echo "screenshot.sh: capturing window $window failed" >&2
  exit 1
fi
echo "$out"
