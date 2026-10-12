#!/bin/sh
# Tests the CIRadarKit package, then builds the app (spec §4.5).
set -eu
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
cd "$(dirname "$0")/.."

swift test --package-path CIRadarKit
xcodebuild -project CIRadar.xcodeproj -scheme CIRadar -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath .build/xcode -quiet build
