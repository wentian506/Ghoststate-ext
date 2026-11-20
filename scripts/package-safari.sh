#!/usr/bin/env bash
set -euo pipefail
if [[ "$(uname -s)" != Darwin ]] || ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo 'Safari conversion requires macOS and Xcode with safari-web-extension-converter.' >&2; exit 1
fi
root="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$root/release/chromium/manifest.json" ]] || { echo 'Run npm ci && npm run build first.' >&2; exit 1; }
out="${1:-$root/release/safari-xcode}"
mkdir -p "$out"
xcrun safari-web-extension-converter "$root/release/chromium" --project-location "$out" --app-name GhostState --bundle-identifier com.ghoststate.app --macos-only --swift --no-open
echo 'Generated an Xcode project. Build/sign and test in Safari. Native BLE integration is not provided by the converter; see docs/INSTALLATION.md.'
