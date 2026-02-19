# =============================================================================
# Lil Dude — Install Script (Windows PowerShell)
# Usage: irm https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install.ps1 | iex
# Flags: -Yes  Skip all interactive prompts
# Exit codes: 0 success, 1 missing Node.js, 2 install failed, 3 verification failed
# =============================================================================

param(
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

$RequiredNodeMajor = 20
$PackageName = "lil-dude"
$GithubRepo = "https://github.com/claypark-dev/lildude.git"

# --- Helper functions ---
function Write-Info {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Yellow
}

function Write-Error-Msg {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Red
}

# --- Banner ---
function Show-Banner {
    Write-Host ""
    Write-Host "  _     _ _   ____            _      " -ForegroundColor Cyan
    Write-Host " | |   (_) | |  _ \ _   _  __| | ___ " -ForegroundColor Cyan
    Write-Host " | |   | | | | | | | | | |/ _`` |/ _ \" -ForegroundColor Cyan
    Write-Host " | |___| | | | |_| | |_| | (_| |  __/" -ForegroundColor Cyan
    Write-Host " |_____|_|_| |____/ \__,_|\__,_|\___|" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Your personal AI executive assistant" -ForegroundColor White
    Write-Host ""
}

# --- Step 1: Print banner ---
Show-Banner
Write-Info "  Starting Lil Dude installation..."
Write-Host ""

# --- Step 2: Check for Node.js ---
function Test-NodeVersion {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Write-Error-Msg "  Node.js is not installed."
        Write-Error-Msg ""
        Write-Error-Msg "  Lil Dude requires Node.js ${RequiredNodeMajor}+."
        Write-Error-Msg "  Install it from: https://nodejs.org/"
        Write-Error-Msg ""
        Write-Error-Msg "  Or use winget:  winget install OpenJS.NodeJS"
        Write-Error-Msg "  Or use choco:   choco install nodejs"
        exit 1
    }

    $nodeVersionRaw = & node --version 2>$null
    $nodeVersion = $nodeVersionRaw -replace '^v', ''
    $nodeMajor = [int]($nodeVersion.Split('.')[0])

    if ($nodeMajor -lt $RequiredNodeMajor) {
        Write-Error-Msg "  Node.js v${nodeVersion} found, but v${RequiredNodeMajor}+ is required."
        Write-Error-Msg ""
        Write-Error-Msg "  Please upgrade Node.js:"
        Write-Error-Msg "    https://nodejs.org/"
        Write-Error-Msg "    Or: nvm install ${RequiredNodeMajor}"
        exit 1
    }

    Write-Success "  Node.js v${nodeVersion} detected"
}

# --- Step 3: Check for npm ---
function Test-NpmAvailable {
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npmCmd) {
        Write-Error-Msg "  npm is not installed."
        Write-Error-Msg "  npm is bundled with Node.js -- please reinstall Node.js from https://nodejs.org/"
        exit 1
    }

    $npmVersion = & npm --version 2>$null
    Write-Success "  npm v${npmVersion} detected"
}

# --- Step 4: Install lil-dude ---
function Install-Package {
    Write-Info "  Installing ${PackageName} globally..."
    Write-Host ""

    try {
        & npm install -g $PackageName 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "  ${PackageName} installed via npm"
            return
        }
    }
    catch {
        # Fall through to GitHub install
    }

    Write-Warn "  npm registry install failed, trying from GitHub..."
    try {
        & npm install -g $GithubRepo 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "  ${PackageName} installed from GitHub"
            return
        }
    }
    catch {
        # Fall through to error
    }

    Write-Error-Msg "  Failed to install ${PackageName}."
    Write-Error-Msg ""
    Write-Error-Msg "  Try installing manually:"
    Write-Error-Msg "    npm install -g ${PackageName}"
    exit 2
}

# --- Step 5: Verify installation ---
function Test-Installation {
    Write-Host ""
    Write-Info "  Verifying installation..."

    $lilDudeCmd = Get-Command lil-dude -ErrorAction SilentlyContinue
    if (-not $lilDudeCmd) {
        Write-Error-Msg "  lil-dude command not found after installation."
        Write-Error-Msg ""
        Write-Error-Msg "  This usually means the npm global bin directory is not in your PATH."
        Write-Error-Msg "  Run: npm config get prefix"
        Write-Error-Msg "  Then add the bin directory to your PATH."
        exit 3
    }

    $installedVersion = & lil-dude --version 2>$null
    if (-not $installedVersion) {
        $installedVersion = "unknown"
    }
    Write-Success "  lil-dude v${installedVersion} is installed"
}

# --- Step 6: Run doctor ---
function Invoke-Doctor {
    Write-Host ""
    Write-Info "  Running system health check..."
    Write-Host ""

    try {
        & lil-dude doctor
    }
    catch {
        Write-Warn "  Doctor check completed with warnings."
    }
}

# --- Step 7: Prompt for onboarding ---
function Show-NextSteps {
    Write-Host ""
    Write-Success "  Installation complete!"
    Write-Host ""
    Write-Info "  Next step: Set up your assistant by running:"
    Write-Host ""
    Write-Host "    lil-dude onboard" -ForegroundColor White
    Write-Host ""
    Write-Info "  This will guide you through:"
    Write-Info "    - Choosing an AI provider (Anthropic, OpenAI, etc.)"
    Write-Info "    - Setting your security level"
    Write-Info "    - Configuring your monthly budget"
    Write-Info "    - Connecting messaging channels"
    Write-Host ""

    if ($Yes) {
        return
    }

    $reply = Read-Host "  Run onboard now? [Y/n]"
    if ($reply -match '^[nN]') {
        Write-Info "  You can run 'lil-dude onboard' anytime."
    }
    else {
        & lil-dude onboard
    }
}

# --- Main flow ---
Test-NodeVersion
Test-NpmAvailable
Install-Package
Test-Installation
Invoke-Doctor
Show-NextSteps

exit 0
