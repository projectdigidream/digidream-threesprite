#!/bin/zsh
# Drives the installed Android app through Export → Save zip… → the system
# file picker → Save, then pulls the zip from Downloads and lists it. Uses the
# accessibility tree (uiautomator dump) to find buttons. Needs a running
# emulator/device with the app installed (see android-selftest.sh).
set -u
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/drive-out/android}"
mkdir -p "$OUT"
PKG=com.digidream.threesprite

dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml; }
find_node() {
  dump | python3 -c '
import sys,re
needle=sys.argv[1].lower()
xml=sys.stdin.read()
nodes=[m.group(0) for m in re.finditer(r"<node [^>]*>", xml)]
def centre(n):
    b=re.search(r"bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"", n)
    if not b: return None
    x0,y0,x1,y1=map(int,b.groups())
    if x1<=x0 or y1<=y0: return None
    return ((x0+x1)//2,(y0+y1)//2)
def attr(n,name):
    m=re.search(name+r"=\"([^\"]*)\"", n); return (m.group(1) if m else "").lower()
for pred in (lambda n: attr(n,"text")==needle or attr(n,"content-desc")==needle,
             lambda n: needle in attr(n,"text") or needle in attr(n,"content-desc"),
             lambda n: needle in n.lower()):
    for n in nodes:
        if pred(n):
            c=centre(n)
            if c: print(c[0],c[1]); sys.exit()
' "$1"
}
tap_node() {
  local pos=""
  for attempt in 1 2 3 4 5; do pos=$(find_node "$1"); [ -n "$pos" ] && break; sleep 2; done
  if [ -z "$pos" ]; then
    if [ -n "${2:-}" ]; then echo "node '$1' not found; tapping fallback $2"; adb shell input tap $2; return 0; fi
    echo "node not found: $1"; return 1
  fi
  echo "tap '$1' at $pos"; adb shell input tap $pos; return 0
}

adb shell "rm -f /sdcard/Download/*.zip" 2>/dev/null
adb shell am force-stop $PKG
adb shell run-as $PKG rm -f selftest files/selftest
adb shell am start -W -n $PKG/.MainActivity >/dev/null
sleep 8
tap_node "Export" "973 2264" || exit 1
sleep 2
adb shell input swipe 540 1700 540 600 400; sleep 1
adb shell input swipe 540 1700 540 600 400; sleep 1
adb exec-out screencap -p > "$OUT/export.png"
tap_node "Save zip" || exit 1
sleep 5
adb exec-out screencap -p > "$OUT/picker.png"
adb shell input keyevent 66   # Enter in the focused filename field
sleep 6
if ! adb shell ls /sdcard/Download/ 2>/dev/null | grep -qi zip; then
  adb shell input keyevent 111 >/dev/null 2>&1
  sleep 1
  tap_node "SAVE" || tap_node "Save" || exit 1
  sleep 6
fi
adb exec-out screencap -p > "$OUT/after.png"
echo "-- Downloads"
adb shell ls -la /sdcard/Download/ | grep -i zip || { echo "(no zip in Downloads)"; exit 1; }
adb shell ls /sdcard/Download/ | grep -i zip | head -1 | while read f; do adb pull "/sdcard/Download/$f" "$OUT/$f" >/dev/null && unzip -l "$OUT/$f" | tail -3; done
echo "== done ($OUT)"
