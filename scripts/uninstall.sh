#!/usr/bin/env bash
# =============================================================================
# Lil Dude — Uninstall Script (macOS/Linux)
# Removes the global npm package and optionally the ~/.lil-dude directory.
# Usage: bash scripts/uninstall.sh
# =============================================================================

set -euo pipefail

# --- Colors ---
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  RESET='\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  CYAN=''
  RESET=''
fi

info() { printf "${CYAN}%s${RESET}\n" "$1"; }
success() { printf "${GREEN}%s${RESET}\n" "$1"; }
warn() { printf "${YELLOW}%s${RESET}\n" "$1"; }
error() { printf "${RED}%s${RESET}\n" "$1" >&2; }

PACKAGE_NAME="lil-dude"
CONFIG_DIR="${HOME}/.lil-dude"

printf "\n"
info "  Uninstalling Lil Dude..."
printf "\n"

# --- Remove global npm package ---
if command -v lil-dude >/dev/null 2>&1; then
  info "  Removing ${PACKAGE_NAME} global package..."
  npm uninstall -g "${PACKAGE_NAME}" 2>/dev/null || warn "  npm uninstall returned non-zero (package may already be removed)"
  success "  Global package removed"
else
  warn "  lil-dude command not found — package may already be uninstalled"
fi

# --- Optionally remove config directory ---
if [ -d "$CONFIG_DIR" ]; then
  printf "\n"
  warn "  Configuration directory found at: ${CONFIG_DIR}"
  warn "  This contains your config, database, and logs."
  printf "\n"

  if [ -t 0 ]; then
    printf "  Remove ${CONFIG_DIR}? [y/N] "
    read -r REPLY
    case "$REPLY" in
      [yY]*)
        rm -rf "$CONFIG_DIR"
        success "  Removed ${CONFIG_DIR}"
        ;;
      *)
        info "  Kept ${CONFIG_DIR}"
        ;;
    esac
  else
    info "  Skipping config removal (non-interactive). Remove manually if needed:"
    info "    rm -rf ${CONFIG_DIR}"
  fi
fi

printf "\n"
success "  Lil Dude has been uninstalled."
printf "\n"

exit 0
