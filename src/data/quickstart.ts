export interface QuickStartTab {
  id: string
  label: string
  code: string
}

export const quickstartTabs: QuickStartTab[] = [
  {
    id: 'macos',
    label: 'macOS',
    code: `# Install + auto-start on login (LaunchAgent)
bash <(curl -fsSL https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install-macos.sh)

# Or install without auto-start
curl -fsSL https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install.sh | bash
lil-dude start

# Open http://localhost:18421 to set up`,
  },
  {
    id: 'linux',
    label: 'Linux',
    code: `# Install + auto-start on login (systemd)
bash <(curl -fsSL https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install-linux.sh)

# Or install without auto-start
curl -fsSL https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install.sh | bash
lil-dude start

# Open http://localhost:18421 to set up`,
  },
  {
    id: 'windows',
    label: 'Windows',
    code: `# Install + auto-start on login (Scheduled Task)
irm https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install-windows.ps1 | iex

# Or install without auto-start
irm https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install.ps1 | iex
lil-dude start

# Open http://localhost:18421 to set up`,
  },
  {
    id: 'docker',
    label: 'Docker',
    code: `git clone https://github.com/claypark-dev/lildude.git
cd lildude

# Build and start
docker compose up -d

# View logs
docker compose logs -f lildude

# Open http://localhost:18421 to set up`,
  },
]
