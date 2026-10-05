#!/usr/bin/env bash
#
# Builds the Android release APK and leaves a copy at the root of the
# repository as PrSpr-editor.apk. The Android toolchain variables are not in
# any shell profile on this machine, so they are worked out here rather than
# being something to remember.
#
#   pnpm apk            release APK (signed with whatever keystore.properties says)
#   pnpm apk --debug    debug APK, which builds faster
#
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
[ -d "$ANDROID_HOME" ] || { echo "No Android SDK at $ANDROID_HOME. Set ANDROID_HOME." >&2; exit 1; }

# the newest installed NDK, so a toolchain update does not strand this script
if [ -z "${NDK_HOME:-}" ]; then
  NDK_HOME="$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$NDK_HOME" ] || { echo "No NDK under $ANDROID_HOME/ndk. Install one in Android Studio." >&2; exit 1; }
  export NDK_HOME
fi

if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
  [ -n "$JAVA_HOME" ] || JAVA_HOME="$(ls -d /opt/homebrew/Cellar/openjdk@17/*/libexec/openjdk.jdk/Contents/Home 2>/dev/null | tail -1 || true)"
  [ -n "$JAVA_HOME" ] || { echo "No Java 17. Install it (brew install openjdk@17) or set JAVA_HOME." >&2; exit 1; }
  export JAVA_HOME
fi
export PATH="$ANDROID_HOME/platform-tools:$PATH"

echo "SDK  $ANDROID_HOME"
echo "NDK  $NDK_HOME"
echo "Java $JAVA_HOME"

pnpm tauri android build --apk "$@"

# Gradle drops the copy itself, so this only has to report what landed.
out="$repo/PrSpr-editor.apk"
if [ -f "$out" ]; then
  echo
  echo "APK at $out ($(( $(wc -c < "$out") / 1024 / 1024 )) MB, $(date -r "$out" '+%Y-%m-%d %H:%M'))"
else
  echo "The build finished but no APK reached $out." >&2
  exit 1
fi
