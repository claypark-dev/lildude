export interface QuickStartTab {
  id: string
  label: string
  code: string
}

export const quickstartTabs: QuickStartTab[] = [
  {
    id: 'macos',
    label: 'macOS / Linux',
    code: `# Install
curl -fsSL https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install.sh | bash

# Launch — opens web wizard on first run
lil-dude start

# Open http://localhost:18421 to set up`,
  },
  {
    id: 'windows',
    label: 'Windows',
    code: `# Install (PowerShell)
irm https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install.ps1 | iex

# Launch — opens web wizard on first run
lil-dude start

# Open http://localhost:18421 to set up`,
  },
  {
    id: 'source',
    label: 'From Source',
    code: `git clone https://github.com/claypark-dev/lildude.git
cd lildude
npm install
npm run build
npm start

# Open http://localhost:18421 to set up`,
  },
]
