#!/usr/bin/env bash
# =============================================================================
# Lil Dude — Linux Install + systemd Service Setup
# Creates a systemd user service so Lil Dude starts automatically on login.
# Usage: bash scripts/install-linux.sh
# Flags: --yes  Skip all interactive prompts
#        --no-service  Skip systemd setup
# =============================================================================

set -euo pipefail

# --- Configuration ---
SERVICE_NAME="lildude"
SYSTEMD_DIR="${HOME}/.config/systemd/user"
SERVICE_PATH="${SYSTEMD_DIR}/${SERVICE_NAME}.service"
CONFIG_DIR="${HOME}/.lil-dude"
LOG_DIR="${HOME}/.lil-dude/logs"
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

# --- Check Linux ---
if [[ "$(uname)" != "Linux" ]]; then
  error "  This script is for Linux only."
  error "  On macOS, use: bash scripts/install-macos.sh"
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
  success "  Skipping systemd service setup (--no-service)"
  exit 0
fi

# --- Step 2: Check systemd ---
if ! command -v systemctl >/dev/null 2>&1; then
  warn "  systemd not found — skipping service setup."
  warn "  Start Lil Dude manually with: lil-dude start"
  exit 0
fi

# --- Step 3: Locate lil-dude binary ---
LIL_DUDE_BIN="$(command -v lil-dude 2>/dev/null || true)"
if [ -z "$LIL_DUDE_BIN" ]; then
  error "  Could not find lil-dude binary after installation."
  exit 1
fi
info "  Binary found at: ${LIL_DUDE_BIN}"

# --- Step 4: Create directories ---
mkdir -p "${LOG_DIR}"
mkdir -p "${SYSTEMD_DIR}"
info "  Log directory: ${LOG_DIR}"

# --- Step 5: Prompt for service installation ---
if [ "$YES_FLAG" = false ] && [ -t 0 ]; then
  printf "\n"
  printf "  Install systemd user service to start Lil Dude on login? [Y/n] "
  read -r REPLY
  case "$REPLY" in
    [nN]*)
      info "  Skipping systemd service setup."
      info "  Start manually with: lil-dude start"
      exit 0
      ;;
  esac
fi

# --- Step 6: Stop existing service ---
if systemctl --user is-active "${SERVICE_NAME}" >/dev/null 2>&1; then
  systemctl --user stop "${SERVICE_NAME}" 2>/dev/null || true
  info "  Stopped existing service"
fi

# --- Step 7: Create systemd unit file ---
NODE_BIN="$(command -v node 2>/dev/null)"

cat > "$SERVICE_PATH" <<UNIT
[Unit]
Description=Lil Dude — Personal AI Executive Assistant
After=network.target

[Service]
Type=simple
ExecStart=${LIL_DUDE_BIN} start
WorkingDirectory=${CONFIG_DIR}
Restart=on-failure
RestartSec=30
Environment=NODE_ENV=production
Environment=PATH=${NODE_BIN%/*}:/usr/local/bin:/usr/bin:/bin
StandardOutput=append:${LOG_DIR}/lildude-stdout.log
StandardError=append:${LOG_DIR}/lildude-stderr.log

# Resource limits
LimitNOFILE=4096
MemoryMax=512M

[Install]
WantedBy=default.target
UNIT

success "  systemd service created: ${SERVICE_PATH}"

# --- Step 8: Enable and start ---
systemctl --user daemon-reload
systemctl --user enable "${SERVICE_NAME}" 2>/dev/null || true
systemctl --user start "${SERVICE_NAME}" 2>/dev/null || true
success "  Service enabled and started"

# Enable lingering so service runs even when not logged in
loginctl enable-linger "$(whoami)" 2>/dev/null || warn "  Could not enable lingering (service only runs when logged in)"

printf "\n"
info "  Management commands:"
info "    Status:       systemctl --user status ${SERVICE_NAME}"
info "    Stop:         systemctl --user stop ${SERVICE_NAME}"
info "    Restart:      systemctl --user restart ${SERVICE_NAME}"
info "    Disable:      systemctl --user disable ${SERVICE_NAME}"
info "    View logs:    journalctl --user -u ${SERVICE_NAME} -f"
info "    Or:           tail -f ${LOG_DIR}/lildude-stdout.log"
printf "\n"

exit 0
