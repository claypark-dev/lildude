#!/usr/bin/env bash
# =============================================================================
# Lil Dude — Install Script (macOS/Linux)
# Usage: curl -fsSL https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install.sh | bash
# Flags: --yes  Skip all interactive prompts
# Exit codes: 0 success, 1 missing Node.js, 2 install failed, 3 verification failed
# =============================================================================

set -euo pipefail

# --- Configuration ---
REQUIRED_NODE_MAJOR=20
PACKAGE_NAME="lil-dude"
GITHUB_REPO="https://github.com/claypark-dev/lildude.git"
YES_FLAG=false

# --- Parse arguments ---
for arg in "$@"; do
  case "$arg" in
    --yes|-y)
      YES_FLAG=true
      ;;
  esac
done

# --- Colors (only when stdout is a terminal) ---
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  CYAN=''
  BOLD=''
  RESET=''
fi

# --- Helper functions ---
info() {
  printf "${CYAN}%s${RESET}\n" "$1"
}

success() {
  printf "${GREEN}%s${RESET}\n" "$1"
}

warn() {
  printf "${YELLOW}%s${RESET}\n" "$1"
}

error() {
  printf "${RED}%s${RESET}\n" "$1" >&2
}

# --- Banner ---
print_banner() {
  printf "\n"
  printf "${BOLD}${CYAN}"
  printf "  _     _ _   ____            _      \n"
  printf " | |   (_) | |  _ \\ _   _  __| | ___ \n"
  printf " | |   | | | | | | | | | |/ _\` |/ _ \\\\\n"
  printf " | |___| | | | |_| | |_| | (_| |  __/\n"
  printf " |_____|_|_| |____/ \\__,_|\\__,_|\\___|  \n"
  printf "${RESET}\n"
  printf "  ${BOLD}Your personal AI executive assistant${RESET}\n"
  printf "\n"
}

# --- Step 1: Print banner ---
print_banner

info "  Starting Lil Dude installation..."
printf "\n"

# --- Step 2: Check for Node.js ---
check_node() {
  if ! command -v node >/dev/null 2>&1; then
    error "  Node.js is not installed."
    error ""
    error "  Lil Dude requires Node.js ${REQUIRED_NODE_MAJOR}+."
    error "  Install it from: https://nodejs.org/"
    error ""
    error "  On macOS:   brew install node"
    error "  On Ubuntu:  curl -fsSL https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x | sudo -E bash - && sudo apt-get install -y nodejs"
    error "  On Fedora:  sudo dnf install nodejs"
    exit 1
  fi

  NODE_VERSION=$(node --version 2>/dev/null | sed 's/^v//')
  NODE_MAJOR=$(printf "%s" "$NODE_VERSION" | cut -d. -f1)

  if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
    error "  Node.js v${NODE_VERSION} found, but v${REQUIRED_NODE_MAJOR}+ is required."
    error ""
    error "  Please upgrade Node.js:"
    error "    https://nodejs.org/"
    error "    Or: nvm install ${REQUIRED_NODE_MAJOR}"
    exit 1
  fi

  success "  Node.js v${NODE_VERSION} detected"
}

# --- Step 3: Check for npm ---
check_npm() {
  if ! command -v npm >/dev/null 2>&1; then
    error "  npm is not installed."
    error "  npm is bundled with Node.js — please reinstall Node.js from https://nodejs.org/"
    exit 1
  fi

  NPM_VERSION=$(npm --version 2>/dev/null)
  success "  npm v${NPM_VERSION} detected"
}

# --- Step 4: Install lil-dude ---
install_package() {
  info "  Installing ${PACKAGE_NAME} globally..."
  printf "\n"

  if npm install -g "${PACKAGE_NAME}" 2>/dev/null; then
    success "  ${PACKAGE_NAME} installed via npm"
  else
    warn "  npm registry install failed, trying from GitHub..."
    if npm install -g "${GITHUB_REPO}" 2>/dev/null; then
      success "  ${PACKAGE_NAME} installed from GitHub"
    else
      error "  Failed to install ${PACKAGE_NAME}."
      error ""
      error "  Try installing manually:"
      error "    npm install -g ${PACKAGE_NAME}"
      error ""
      error "  If you get permission errors, try:"
      error "    npm install -g ${PACKAGE_NAME} --prefix ~/.local"
      error "  Then add ~/.local/bin to your PATH."
      exit 2
    fi
  fi
}

# --- Step 5: Verify installation ---
verify_install() {
  printf "\n"
  info "  Verifying installation..."

  if ! command -v lil-dude >/dev/null 2>&1; then
    error "  lil-dude command not found after installation."
    error ""
    error "  This usually means the npm global bin directory is not in your PATH."
    error "  Run: npm config get prefix"
    error "  Then add <prefix>/bin to your PATH."
    exit 3
  fi

  INSTALLED_VERSION=$(lil-dude --version 2>/dev/null || echo "unknown")
  success "  lil-dude v${INSTALLED_VERSION} is installed"
}

# --- Step 6: Run doctor ---
run_doctor() {
  printf "\n"
  info "  Running system health check..."
  printf "\n"

  lil-dude doctor || true
}

# --- Step 7: Prompt for onboarding ---
prompt_onboard() {
  printf "\n"
  success "  Installation complete!"
  printf "\n"
  info "  Next step: Set up your assistant by running:"
  printf "\n"
  printf "    ${BOLD}lil-dude onboard${RESET}\n"
  printf "\n"
  info "  This will guide you through:"
  info "    - Choosing an AI provider (Anthropic, OpenAI, etc.)"
  info "    - Setting your security level"
  info "    - Configuring your monthly budget"
  info "    - Connecting messaging channels"
  printf "\n"

  if [ "$YES_FLAG" = true ]; then
    return 0
  fi

  if [ -t 0 ]; then
    printf "  Run onboard now? [Y/n] "
    read -r REPLY
    case "$REPLY" in
      [nN]*)
        info "  You can run 'lil-dude onboard' anytime."
        ;;
      *)
        lil-dude onboard
        ;;
    esac
  fi
}

# --- Main flow ---
check_node
check_npm
install_package
verify_install
run_doctor
prompt_onboard

exit 0
