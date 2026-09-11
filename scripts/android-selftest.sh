#!/bin/zsh
# Boots the Medium_Phone AVD headlessly (if no emulator is running), installs
# the debug APK, runs the in-app self-test via the AppData marker, then
# relaunches normally and screenshots. Output: ./drive-out/android/
#   pnpm tauri android build --debug --apk --target aarch64   # first
#   scripts/android-selftest.sh
set -u
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/drive-out/android}"
mkdir -p "$OUT"
APK="$ROOT/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
PKG=com.digidream.threesprite
AVD="${AVD:-Medium_Phone}"

echo "== emulator"
if ! adb devices | grep -q "emulator-"; then
  nohup emulator -avd "$AVD" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect > "$OUT/emulator.log" 2>&1 &
  sleep 5
fi
adb wait-for-device
for i in $(seq 1 150); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 2
done
echo "boot_completed=$(adb shell getprop sys.boot_completed | tr -d '\r')"
adb shell input keyevent 82 >/dev/null 2>&1 || true

echo "== install"
adb install -r "$APK" 2>&1 | tail -1

echo "== selftest"
adb shell am force-stop $PKG
adb shell run-as $PKG rm -f selftest.json files/selftest.json
adb shell run-as $PKG mkdir -p files
adb shell run-as $PKG touch selftest files/selftest
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity | tail -1
for i in $(seq 1 60); do
  adb shell run-as $PKG test -f selftest.json 2>/dev/null && break
  adb shell run-as $PKG test -f files/selftest.json 2>/dev/null && break
  sleep 2
done
adb shell run-as $PKG cat selftest.json 2>/dev/null || adb shell run-as $PKG cat files/selftest.json 2>/dev/null || echo "(no selftest.json)"
adb exec-out screencap -p > "$OUT/selftest.png"

echo "== normal launch"
adb shell run-as $PKG rm -f files/selftest selftest
adb shell am force-stop $PKG
adb shell am start -W -n $PKG/.MainActivity >/dev/null
sleep 8
adb exec-out screencap -p > "$OUT/app.png"
echo "-- logcat (rust / crashes)"
adb logcat -d 2>/dev/null | grep -E "RustStdoutStderr|FATAL|AndroidRuntime" | tail -20
echo "== done ($OUT)"
