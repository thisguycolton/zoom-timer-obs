#!/bin/bash
# Builds "Zoom Timer Bridge.app" and zips it to dist/ZoomTimerBridge-<version>.zip.
# Usage: scripts/build-app.sh [--install]   (--install also copies the app to /Applications)
set -euo pipefail

VERSION="${VERSION:-1.0.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
APP="$DIST/Zoom Timer Bridge.app"
cd "$ROOT"

echo "==> Building release binary"
if swift build -c release --arch arm64 --arch x86_64 >/dev/null 2>&1; then
    BIN="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/ZoomTimerBridge"
    echo "    universal (Apple silicon + Intel)"
else
    # Command Line Tools without full Xcode can't build universal binaries.
    swift build -c release
    BIN="$(swift build -c release --show-bin-path)/ZoomTimerBridge"
    echo "    $(uname -m) only"
fi

echo "==> Assembling app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/ZoomTimerBridge"
sed "s/__VERSION__/$VERSION/g" packaging/Info.plist > "$APP/Contents/Info.plist"
cp -R overlay "$APP/Contents/Resources/overlay"

echo "==> Generating icon"
ICONSET="$(mktemp -d)/AppIcon.iconset"
swift scripts/make-icon.swift "$ICONSET"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "==> Signing (ad hoc)"
codesign --force --deep -s - "$APP"

echo "==> Zipping"
ZIP="$DIST/ZoomTimerBridge-$VERSION.zip"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
echo "    $ZIP"

if [[ "${1:-}" == "--install" ]]; then
    echo "==> Installing to /Applications"
    osascript -e 'quit app "Zoom Timer Bridge"' 2>/dev/null || true
    rm -rf "/Applications/Zoom Timer Bridge.app"
    cp -R "$APP" /Applications/
    echo "    /Applications/Zoom Timer Bridge.app"
fi
