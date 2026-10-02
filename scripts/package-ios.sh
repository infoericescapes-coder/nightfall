#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
project_output="${1:-$project_root/native-ios}"
if [[ "$project_output" != /* ]]; then project_output="$PWD/$project_output"; fi
bundle_identifier="${NIGHTFALL_BUNDLE_ID:-com.ericescapes.nightfall}"
if [ -e "$project_output" ]; then
  printf '%s\n' "Output already exists: $project_output" 'Choose a new output folder to preserve the existing project.' >&2
  exit 1
fi
if ! xcrun --find safari-web-extension-packager >/dev/null 2>&1; then
  printf '%s\n' 'Full Xcode with Safari Web Extension Packager is required for local iOS packaging.' 'Alternatively, upload dist/Nightfall-Safari.zip to the Safari Web Extension Packager in App Store Connect.' >&2
  exit 1
fi
cd "$project_root"
npm run build
xcrun safari-web-extension-packager "$project_root/extension" \
  --ios-only --swift --copy-resources --no-open --no-prompt \
  --app-name Nightfall --bundle-identifier "$bundle_identifier" \
  --project-location "$project_output"
printf '\n%s\n' "Generated an unsigned iOS Xcode project at: $project_output" 'Open it in Xcode, select your signing team and iPhone/iPad target, then build and test.'
