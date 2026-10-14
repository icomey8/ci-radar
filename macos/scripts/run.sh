#!/bin/sh
# Builds the Debug app and opens it against `pnpm api` (localhost:8787, or $API_PORT).
set -eu
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
cd "$(dirname "$0")/.."

xcodebuild -project CIRadar.xcodeproj -scheme CIRadar -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath .build/xcode -quiet build

app=.build/xcode/Build/Products/Debug/CIRadar.app
# `open` only re-activates a running copy, so quit it to pick up the new build.
pkill -x CIRadar || true
if [ -n "${API_PORT:-}" ]; then
  open -n "$app" --args -apiBaseURL "http://localhost:$API_PORT"
else
  open -n "$app"
fi
