#!/usr/bin/env bash
# devorbitus fork only: run the fork's daemon and sideload the personal iPhone build.
#
#   scripts/personal-ios.sh daemon           start the fork dev daemon (127.0.0.1:6768)
#   scripts/personal-ios.sh pair             enable its relay and print the pairing QR code
#   scripts/personal-ios.sh install TEAM_ID  build Release for the connected iPhone and install it
#   scripts/personal-ios.sh relay-off        turn the dev daemon's relay back off
#
# The main Paseo daemon on 6767 (~/.paseo) is never touched.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV_HOME="$ROOT/.dev/paseo-home"
APP_DIR="$ROOT/packages/app"
WORKSPACE="$APP_DIR/ios/Paseodevorbitus.xcworkspace"
SCHEME="Paseodevorbitus"

# A Paseo agent exports its own PASEO_HOME (~/.paseo); pin the checkout-local home instead.
dev_env() { env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD PASEO_HOME="$DEV_HOME" "$@"; }
cli() { (cd "$ROOT" && dev_env npm run --silent cli -- --host 127.0.0.1:6768 "$@"); }
listening() { lsof -iTCP:6768 -sTCP:LISTEN -n -P >/dev/null 2>&1; }

set_relay() {
  node -e '
    const fs = require("node:fs");
    const [file, on] = process.argv.slice(1);
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    config.daemon ??= {};
    config.daemon.relay = { ...(config.daemon.relay ?? {}), enabled: on === "true" };
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  ' "$DEV_HOME/config.json" "$1"
  cli daemon reload >/dev/null
}

case "${1:-}" in
  daemon)
    if listening; then
      echo "Fork dev daemon already listening on 127.0.0.1:6768."
      exit 0
    fi
    echo "Starting the fork dev daemon; logs in /tmp/paseo-dev-server.log"
    (cd "$ROOT" && dev_env nohup npm run dev:server >/tmp/paseo-dev-server.log 2>&1 &)
    for _ in $(seq 1 90); do listening && break; sleep 2; done
    listening || { echo "Daemon did not start; see /tmp/paseo-dev-server.log" >&2; exit 1; }
    cli plugin ls
    ;;
  pair)
    listening || { echo "Run '$0 daemon' first." >&2; exit 1; }
    set_relay true
    cli daemon pair
    echo
    echo "In the Paseo (devorbitus) app: Add host → scan this code."
    ;;
  relay-off)
    set_relay false
    echo "Dev daemon relay disabled."
    ;;
  install)
    TEAM_ID="${2:?Usage: $0 install TEAM_ID  (Xcode → Settings → Accounts → your Personal Team)}"
    DEVICE_ID="$(xcrun devicectl list devices --json-output /dev/stdout 2>/dev/null |
      node -e '
        let raw = ""; process.stdin.on("data", (c) => (raw += c)).on("end", () => {
          const devices = JSON.parse(raw.slice(raw.indexOf("{"))).result?.devices ?? [];
          const phone = devices.find((d) => d.hardwareProperties?.platform === "iOS" &&
            d.connectionProperties?.pairingState === "paired");
          process.stdout.write(phone?.hardwareProperties?.udid ?? "");
        });
      ')"
    [ -n "$DEVICE_ID" ] || { echo "No paired iPhone found. Connect it, unlock it, and trust this Mac." >&2; exit 1; }
    [ -d "$WORKSPACE" ] || (cd "$APP_DIR" && CI=1 APP_VARIANT=personal npx expo prebuild --platform ios --clean)
    # Codegen output lives in ios/build/generated and comes from pod install, not xcodebuild.
    [ -d "$APP_DIR/ios/build/generated" ] || (cd "$APP_DIR/ios" && APP_VARIANT=personal pod install)
    # The JS bundle imports these workspace packages from their built output.
    (cd "$ROOT" && npm run --silent build:client && npm run --silent build:plugin &&
      npm run --silent build --workspace=@getpaseo/expo-two-way-audio) >/dev/null
    echo "Building for iPhone $DEVICE_ID with team $TEAM_ID…"
    (cd "$APP_DIR/ios" && APP_VARIANT=personal xcodebuild \
      -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release \
      -destination "id=$DEVICE_ID" -derivedDataPath build/device \
      -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic \
      | tee /tmp/xcode-device.log | grep -E "error:|BUILD (SUCCEEDED|FAILED)")
    xcrun devicectl device install app --device "$DEVICE_ID" \
      "$APP_DIR/ios/build/device/Build/Products/Release-iphoneos/$SCHEME.app"
    echo
    echo "Installed. On the iPhone, trust the developer once:"
    echo "  Settings → General → VPN & Device Management → your Apple ID → Trust."
    ;;
  *)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
