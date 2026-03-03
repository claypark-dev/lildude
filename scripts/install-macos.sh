#!/usr/bin/env bash
# =============================================================================
# Lil Dude — macOS Install + LaunchAgent Setup
# Creates a launchd service so Lil Dude starts automatically on login.
# Usage: bash scripts/install-macos.sh
# Flags: --yes  Skip all interactive prompts
#        --no-service  Skip LaunchAgent setup
# =============================================================================

set -euo pipefail

# --- Configuration ---
PLIST_LABEL="com.lildude.agent"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"
LOG_DIR="${HOME}/.lil-dude/logs"
CONFIG_DIR="${HOME}/.lil-dude"
YES_FLAG=false
NO_SERVICE=false

# --- Parse arguments ---
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES_FLAG=true ;;
    --no-service) NO_SERVICE=true ;;
  esac
done

# --- Colors ---
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' CYAN='' BOLD='' RESET=''
fi

info()    { printf "${CYAN}%s${RESET}\n" "$1"; }
success() { printf "${GREEN}%s${RESET}\n" "$1"; }
warn()    { printf "${YELLOW}%s${RESET}\n" "$1"; }
error()   { printf "${RED}%s${RESET}\n" "$1" >&2; }

# --- Check macOS ---
if [[ "$(uname)" != "Darwin" ]]; then
  error "  This script is for macOS only."
  error "  On Linux, use: bash scripts/install-linux.sh"
  exit 1
fi

# --- Step 1: Run base install ---
info "  Running base installer..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$YES_FLAG" = true ]; then
  bash "${SCRIPT_DIR}/install.sh" --yes
else
  bash "${SCRIPT_DIR}/install.sh"
fi

if [ "$NO_SERVICE" = true ]; then
  success "  Skipping LaunchAgent setup (--no-service)"
  exit 0
fi

# --- Step 2: Locate lil-dude binary ---
LIL_DUDE_BIN="$(command -v lil-dude 2>/dev/null || true)"
if [ -z "$LIL_DUDE_BIN" ]; then
  error "  Could not find lil-dude binary after installation."
  exit 1
fi
info "  Binary found at: ${LIL_DUDE_BIN}"

# --- Step 3: Create log directory ---
mkdir -p "${LOG_DIR}"
info "  Log directory: ${LOG_DIR}"

# --- Step 4: Create LaunchAgent plist ---
if [ "$YES_FLAG" = false ] && [ -t 0 ]; then
  printf "\n"
  printf "  Install LaunchAgent to start Lil Dude on login? [Y/n] "
  read -r REPLY
  case "$REPLY" in
    [nN]*)
      info "  Skipping LaunchAgent setup."
      info "  Start manually with: lil-dude start"
      exit 0
      ;;
  esac
fi

# Remove existing plist if present
if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm -f "$PLIST_PATH"
  info "  Removed existing LaunchAgent"
fi

mkdir -p "$PLIST_DIR"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${LIL_DUDE_BIN}</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/lildude-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/lildude-stderr.log</string>
    <key>WorkingDirectory</key>
    <string>${CONFIG_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
    <key>ThrottleInterval</key>
    <integer>30</integer>
</dict>
</plist>
PLIST

success "  LaunchAgent created: ${PLIST_PATH}"

# --- Step 5: Load LaunchAgent ---
launchctl load "$PLIST_PATH" 2>/dev/null || true
success "  LaunchAgent loaded — Lil Dude will start on login"

printf "\n"
info "  Management commands:"
info "    Start now:    launchctl start ${PLIST_LABEL}"
info "    Stop:         launchctl stop ${PLIST_LABEL}"
info "    Unload:       launchctl unload ${PLIST_PATH}"
info "    View logs:    tail -f ${LOG_DIR}/lildude-stdout.log"
printf "\n"

exit 0
