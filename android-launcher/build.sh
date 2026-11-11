#!/usr/bin/env bash
# Builds CarLauncher.apk without the Android SDK or Gradle.
# Needs: bash, curl, unzip, zip, and a JDK (11+). Tools are downloaded once into ./.tools
#
#   ./build.sh                 -> build/CarLauncher.apk (signed with a local key in ./.tools)
#   KEYSTORE=... KS_PASS=... KS_ALIAS=... ./build.sh   -> sign with your own key
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$HERE/.tools"
OUT="$HERE/build"
mkdir -p "$TOOLS" "$OUT"

ANDROID_JAR_URL="https://raw.githubusercontent.com/Sable/android-platforms/master/android-28/android.jar"
DX_URL="https://repo.maven.apache.org/maven2/com/jakewharton/android/repackaged/dalvik-dx/16.0.1/dalvik-dx-16.0.1.jar"
APKTOOL_URL="https://github.com/iBotPeaches/Apktool/releases/download/v2.10.0/apktool_2.10.0.jar"
SIGNER_URL="https://github.com/patrickfav/uber-apk-signer/releases/download/v1.3.0/uber-apk-signer-1.3.0.jar"

fetch() { [ -s "$TOOLS/$1" ] || { echo "Downloading $1"; curl -fsSL -o "$TOOLS/$1" "$2"; }; }
fetch android.jar "$ANDROID_JAR_URL"
fetch dx.jar "$DX_URL"
fetch apktool.jar "$APKTOOL_URL"
fetch uber-apk-signer.jar "$SIGNER_URL"

# aapt2 ships inside apktool
case "$(uname -s)" in
  Linux*)  AAPT2_IN=prebuilt/linux/aapt2_64 ;;
  Darwin*) AAPT2_IN=prebuilt/macosx/aapt2_64 ;;
  *) echo "Unsupported OS for this script (use Linux, macOS or WSL)"; exit 1 ;;
esac
AAPT2="$TOOLS/aapt2"
if [ ! -x "$AAPT2" ]; then
  unzip -p "$TOOLS/apktool.jar" "$AAPT2_IN" > "$AAPT2"
  chmod +x "$AAPT2"
fi

WORK="$OUT/work"
rm -rf "$WORK"; mkdir -p "$WORK/classes" "$WORK/res" "$WORK/gen"

echo "1/5 Compiling resources"
"$AAPT2" compile --dir "$HERE/res" -o "$WORK/res/res.zip"

echo "2/5 Linking resources"
"$AAPT2" link -o "$WORK/base.apk" -I "$TOOLS/android.jar" --manifest "$HERE/AndroidManifest.xml" \
  --java "$WORK/gen" --min-sdk-version 21 --target-sdk-version 28 "$WORK/res/res.zip"

echo "3/5 Compiling Java"
find "$HERE/src" "$WORK/gen" -name '*.java' > "$WORK/sources.txt"
javac -nowarn -source 8 -target 8 -encoding UTF-8 -bootclasspath "$TOOLS/android.jar" -classpath "$TOOLS/android.jar" \
  -d "$WORK/classes" @"$WORK/sources.txt" 2>&1 | grep -v -E '^warning: \[options\]|^[0-9]+ warnings?$' || true
[ -n "$(find "$WORK/classes" -name '*.class' | head -1)" ] || { echo "javac failed"; exit 1; }

echo "4/5 Converting to dex"
java -cp "$TOOLS/dx.jar" com.android.dx.command.Main --dex --min-sdk-version=21 --output="$WORK/classes.dex" "$WORK/classes"
cp "$WORK/base.apk" "$WORK/unsigned.apk"
(cd "$WORK" && zip -q -j unsigned.apk classes.dex)

echo "5/5 Signing"
if [ -z "${KEYSTORE:-}" ]; then
  KEYSTORE="$TOOLS/launcher.jks"; KS_ALIAS=carlauncher; KS_PASS=carlauncher
  [ -f "$KEYSTORE" ] || keytool -genkeypair -keystore "$KEYSTORE" -alias "$KS_ALIAS" -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass "$KS_PASS" -keypass "$KS_PASS" -dname "CN=Car Launcher, O=Car Themes, C=US" >/dev/null 2>&1
fi
rm -rf "$WORK/signed"
java -jar "$TOOLS/uber-apk-signer.jar" -a "$WORK/unsigned.apk" -o "$WORK/signed" \
  --ks "$KEYSTORE" --ksAlias "$KS_ALIAS" --ksPass "$KS_PASS" --ksKeyPass "$KS_PASS" >/dev/null
cp "$WORK"/signed/*.apk "$OUT/CarLauncher.apk"
echo "Done: $OUT/CarLauncher.apk"
