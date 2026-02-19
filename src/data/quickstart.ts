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

# Set up your assistant
lil-dude onboard

# Launch
lil-dude start`,
  },
  {
    id: 'windows',
    label: 'Windows',
    code: `# Install (PowerShell)
irm https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install.ps1 | iex

# Set up your assistant
lil-dude onboard

# Launch
lil-dude start`,
  },
  {
    id: 'source',
    label: 'From Source',
    code: `git clone https://github.com/claypark-dev/lildude.git
cd lildude
npm install
npm run build
npm run onboard
npm run start`,
  },
]
