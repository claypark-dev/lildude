# Shorebreak Community Hub — Human Actions Checklist

> Actions that require manual setup by the project owner.
> Code changes are handled by the agent; this doc covers everything else.

---

## Before Sprint 22 (Do First)

### 1. Create the Wave Registry Repository

```bash
# On GitHub, create: lildude-community/wave-registry
# Or use the gh CLI:
gh repo create lildude-community/wave-registry \
  --public \
  --description "Community wave registry for Lil Dude" \
  --license MIT
```

**Settings to configure:**
- Enable "Allow merge commits" (disable squash/rebase for clean history)
- Branch protection on `main`:
  - Require PR reviews (1 reviewer minimum)
  - Require status checks: `validate` (added by CI workflow)
  - Dismiss stale reviews on new pushes
- Add a `shorebreak-bot` machine user or use your own PAT for CI commits

### 2. Generate a GitHub Personal Access Token (PAT)

The `lil-dude publish` command needs a PAT to fork the registry repo and open PRs.

1. Go to https://github.com/settings/tokens?type=beta (fine-grained tokens)
2. Create a token with:
   - **Repository access:** `lildude-community/wave-registry` (and forks)
   - **Permissions:**
     - Contents: Read and Write
     - Pull Requests: Read and Write
     - Metadata: Read
3. Save the token — you'll set it in your Lil Dude config:

```bash
# Option A: Environment variable
export GITHUB_TOKEN=github_pat_xxx

# Option B: Config file (~/.lil-dude/config.json)
# The agent will add a "community" section to the config schema
```

### 3. Create the GitHub Organization (if not exists)

If `lildude-community` doesn't exist as a GitHub org yet:

1. Go to https://github.com/organizations/plan
2. Create a free organization named `lildude-community`
3. Add yourself as owner

---

## After Sprint 22 (Code Is Ready)

### 4. Initialize the Wave Registry Repo Structure

After the agent creates the `scripts/build-registry.js` and CI workflow files,
you'll need to push them to the registry repo:

```bash
# Clone the empty registry repo
git clone git@github.com:lildude-community/wave-registry.git
cd wave-registry

# Copy the generated structure (agent will output the path)
# The agent will create these files in a staging directory or provide them

# Initial commit
git add .
git commit -m "feat: initial registry structure with CI"
git push origin main
```

### 5. Seed the Registry with Existing Waves

The agent will create a migration script. You'll run:

```bash
cd wave-registry
node scripts/build-registry.js
git add registry.json waves/
git commit -m "feat: seed registry with 5 initial waves"
git push
```

### 6. Enable GitHub Actions on the Registry Repo

1. Go to `lildude-community/wave-registry` > Settings > Actions
2. Ensure "Allow all actions and reusable workflows" is selected
3. Under "Workflow permissions," set:
   - Read and write permissions (for `rebuild-registry.yml` to push commits)
   - Allow GitHub Actions to create and approve pull requests

### 7. Set Up Repository Secrets (Registry Repo)

For the CI rebuild workflow to commit and push:

```
# In wave-registry > Settings > Secrets > Actions
# If using the default GITHUB_TOKEN, no extra secrets needed.
# If using a bot account:
BOT_TOKEN=github_pat_xxx   # (optional, for shorebreak-bot commits)
```

---

## After Sprint 23 (API + Registry v3)

### 8. Configure Your Lil Dude Instance

Add community settings to your local config:

```bash
# Edit ~/.lil-dude/config.json and add:
{
  "community": {
    "registryRepo": "lildude-community/wave-registry",
    "githubToken": null,
    "autoVerifyHash": true,
    "installTrustMinimum": "new",
    "rescanOnInstall": false
  }
}
```

Or set via the API:
```bash
curl -X PUT http://localhost:18421/api/v1/config \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key": "community.registryRepo", "value": "lildude-community/wave-registry"}'
```

### 9. Test the Full Publish Flow

```bash
# Create a test wave
mkdir /tmp/test-wave
cat > /tmp/test-wave/wave.json << 'EOF'
{
  "name": "hello-world",
  "version": "1.0.0",
  "description": "A simple test wave",
  "author": "your-github-username",
  "permissions": { "domains": [], "shell": [], "directories": [] },
  "triggers": ["hello", "hi"],
  "deterministic": true,
  "tools": [],
  "minTier": "basic",
  "entryPoint": "index.js"
}
EOF

cat > /tmp/test-wave/index.js << 'EOF'
var execute = async function(params) {
  return "Hello, world!";
};
module.exports = { execute };
EOF

# Dry run (validates without opening PR)
lil-dude wave publish /tmp/test-wave --dry-run

# Full publish (opens PR on wave-registry)
GITHUB_TOKEN=github_pat_xxx lil-dude wave publish /tmp/test-wave
```

---

## After Sprint 24 (Frontend)

### 10. Verify the Web Panel

1. Start Lil Dude: `lil-dude start`
2. Open http://localhost:18421
3. Navigate to Skills Hub
4. Verify:
   - [ ] Trust badges appear on community wave cards
   - [ ] "Publish" button visible in Skills Hub header
   - [ ] Install confirmation dialog shows for different trust tiers
   - [ ] Author profile pages load when clicking author names

---

## Ongoing Maintenance

### Moderating Community Submissions

When PRs arrive on `wave-registry`:

1. CI will auto-validate (security scan + sandbox + manifest check)
2. Review the PR:
   - Check the wave name isn't misleading or offensive
   - Review the code for any patterns the scanner might miss
   - Check that `wave.json` description accurately reflects behavior
3. Merge or request changes

### Updating Scanner Rules

When new attack patterns are discovered:

1. Update `src/waves/security-scanner.ts` with new `SCAN_RULES`
2. The CI workflow installs the latest `lildude` — new rules apply on next PR

### Managing Featured Waves

```bash
# Feature a community wave
curl -X POST http://localhost:18421/api/v1/hub/featured \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"waveName": "popular-wave", "reason": "High quality and useful"}'

# Unfeature
curl -X DELETE http://localhost:18421/api/v1/hub/featured/popular-wave \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Quick Reference: What the Agent Builds vs What You Set Up

| Item | Agent Builds | You Set Up |
|------|-------------|-----------|
| `lil-dude publish` CLI command | Yes | - |
| `lil-dude validate-wave` CLI command | Yes | - |
| Community API routes | Yes | - |
| Migration 018 (DB tables) | Yes | - |
| Trust scoring engine | Yes | - |
| Frontend trust badges & publish wizard | Yes | - |
| GitHub organization (`lildude-community`) | - | Yes |
| Wave registry repo | - | Yes |
| GitHub PAT for publishing | - | Yes |
| GitHub Actions enablement | - | Yes |
| Branch protection rules | - | Yes |
| Registry repo secrets | - | Yes |
| Initial wave seeding | - | Yes (run script) |
| Community config in `config.json` | - | Yes |
