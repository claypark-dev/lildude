/**
 * Wave publisher for the community registry.
 * Publishes packaged waves to the org-lil/wave-registry
 * GitHub repo by creating a pull request via the GitHub REST API.
 *
 * Uses fetch() against api.github.com — no external dependencies.
 */

import type { PackageResult } from './packager.js';
import { createModuleLogger } from '../utils/logger.js';

const publisherLogger = createModuleLogger('wave-publisher');

/** Default registry repository. */
const DEFAULT_REGISTRY_REPO = 'org-lil/wave-registry';

/** GitHub API base URL. */
const GITHUB_API = 'https://api.github.com';

/** Result of a successful publish operation. */
export interface PublishResult {
  /** URL of the created pull request. */
  prUrl: string;
  /** PR number in the registry repo. */
  prNumber: number;
  /** Branch name created in the fork. */
  branch: string;
}

/** Options for the publish operation. */
export interface PublishOptions {
  /** GitHub personal access token for API authentication. */
  githubToken: string;
  /** Override the registry repo (default: org-lil/wave-registry). */
  registryRepo?: string;
  /** If true, validate but do not create a PR. */
  dryRun?: boolean;
}

/**
 * Make an authenticated request to the GitHub API.
 *
 * @param path - API endpoint path (e.g., /repos/owner/repo).
 * @param token - GitHub PAT.
 * @param options - Additional fetch options.
 * @returns The parsed JSON response.
 * @throws Error if the request fails.
 */
async function githubApi(
  path: string,
  token: string,
  options?: RequestInit,
): Promise<unknown> {
  const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options?.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `GitHub API error (${response.status}): ${errorBody}`,
    );
  }

  return response.json();
}

/**
 * Get the authenticated user's GitHub username.
 *
 * @param token - GitHub PAT.
 * @returns The username.
 */
async function getAuthenticatedUser(token: string): Promise<string> {
  const user = await githubApi('/user', token) as { login: string };
  return user.login;
}

/**
 * Ensure a fork of the registry repo exists for the authenticated user.
 * Returns the fork's full name (e.g., "username/wave-registry").
 *
 * @param registryRepo - The upstream registry repo (e.g., "org-lil/wave-registry").
 * @param token - GitHub PAT.
 * @returns The full name of the fork.
 */
async function ensureFork(
  registryRepo: string,
  token: string,
): Promise<string> {
  const username = await getAuthenticatedUser(token);
  const repoName = registryRepo.split('/')[1];
  const forkName = `${username}/${repoName}`;

  try {
    // Check if fork already exists
    await githubApi(`/repos/${forkName}`, token);
    publisherLogger.debug({ fork: forkName }, 'Fork already exists');
    return forkName;
  } catch {
    // Fork doesn't exist — create it
    publisherLogger.info({ upstream: registryRepo }, 'Creating fork');
    const fork = await githubApi(
      `/repos/${registryRepo}/forks`,
      token,
      { method: 'POST', body: JSON.stringify({}) },
    ) as { full_name: string };
    return fork.full_name;
  }
}

/**
 * Get the SHA of the default branch's HEAD in the upstream repo.
 *
 * @param registryRepo - The upstream registry repo.
 * @param token - GitHub PAT.
 * @returns The SHA of the HEAD commit.
 */
async function getDefaultBranchSha(
  registryRepo: string,
  token: string,
): Promise<string> {
  const repo = await githubApi(
    `/repos/${registryRepo}`,
    token,
  ) as { default_branch: string };

  const ref = await githubApi(
    `/repos/${registryRepo}/git/refs/heads/${repo.default_branch}`,
    token,
  ) as { object: { sha: string } };

  return ref.object.sha;
}

/**
 * Create a branch in the fork from the upstream HEAD.
 *
 * @param forkRepo - The fork repo full name.
 * @param branchName - The new branch name.
 * @param baseSha - The SHA to base the branch on.
 * @param token - GitHub PAT.
 */
async function createBranch(
  forkRepo: string,
  branchName: string,
  baseSha: string,
  token: string,
): Promise<void> {
  await githubApi(
    `/repos/${forkRepo}/git/refs`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    },
  );
}

/**
 * Create or update a file in the fork via the Contents API.
 *
 * @param forkRepo - The fork repo full name.
 * @param filePath - Path in the repo (e.g., "waves/my-wave/wave.json").
 * @param content - File content as a UTF-8 string.
 * @param branch - The branch to commit to.
 * @param commitMessage - The commit message.
 * @param token - GitHub PAT.
 */
async function createFileInRepo(
  forkRepo: string,
  filePath: string,
  content: string,
  branch: string,
  commitMessage: string,
  token: string,
): Promise<void> {
  const encoded = Buffer.from(content).toString('base64');

  await githubApi(
    `/repos/${forkRepo}/contents/${filePath}`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({
        message: commitMessage,
        content: encoded,
        branch,
      }),
    },
  );
}

/**
 * Build the PR body from a package result.
 *
 * @param pkg - The package result.
 * @returns Markdown-formatted PR body.
 */
function buildPrBody(pkg: PackageResult): string {
  const scanSummary = pkg.scanResult.passed
    ? 'Passed (no critical findings)'
    : `Failed (${pkg.scanResult.summary.critical} critical)`;

  const sandboxSummary = pkg.sandboxResult
    ? (pkg.sandboxResult.success ? 'Passed' : `Failed: ${pkg.sandboxResult.error}`)
    : 'Skipped';

  return [
    `## New Wave: \`${pkg.manifest.name}\` v${pkg.manifest.version}`,
    '',
    `**Description:** ${pkg.manifest.description}`,
    `**Author:** ${pkg.manifest.author}`,
    `**Safety Tier:** ${pkg.manifest.safetyTier ?? 'observe'}`,
    `**Deterministic:** ${pkg.manifest.deterministic ? 'Yes' : 'No'}`,
    `**Category:** ${pkg.manifest.category ?? 'uncategorized'}`,
    '',
    '### Validation Results',
    '',
    `| Check | Result |`,
    `|-------|--------|`,
    `| Security Scan | ${scanSummary} |`,
    `| Sandbox Test | ${sandboxSummary} |`,
    `| Package Size | ${Math.round(pkg.totalSizeBytes / 1024)}KB |`,
    `| File Count | ${pkg.files.length} |`,
    `| Package Hash | \`${pkg.packageHash.slice(0, 16)}...\` |`,
    '',
    '### Scan Details',
    '',
    `- Critical: ${pkg.scanResult.summary.critical}`,
    `- High: ${pkg.scanResult.summary.high}`,
    `- Medium: ${pkg.scanResult.summary.medium}`,
    `- Low: ${pkg.scanResult.summary.low}`,
    '',
    '### Permissions',
    '',
    `- Domains: ${pkg.manifest.permissions.domains.length > 0 ? pkg.manifest.permissions.domains.join(', ') : 'None'}`,
    `- Shell: ${pkg.manifest.permissions.shell.length > 0 ? pkg.manifest.permissions.shell.join(', ') : 'None'}`,
    `- Directories: ${pkg.manifest.permissions.directories.length > 0 ? pkg.manifest.permissions.directories.join(', ') : 'None'}`,
    `- Browser: ${pkg.manifest.permissions.requiresBrowser ? 'Required' : 'Not required'}`,
    '',
    '### Maintainer Review Checklist',
    '',
    '- [ ] Wave name is appropriate and non-misleading',
    '- [ ] Description accurately reflects behavior',
    '- [ ] Permissions are reasonable for the stated purpose',
    '- [ ] Code has been reviewed manually',
    '',
    '---',
    '*Submitted via `lil-dude publish`*',
  ].join('\n');
}

/**
 * Publish a packaged wave to the community registry via GitHub PR.
 *
 * Steps:
 * 1. Ensure a fork of the registry repo exists
 * 2. Get the upstream HEAD SHA
 * 3. Create a branch in the fork
 * 4. Commit all wave files to the branch
 * 5. Open a PR from the fork branch to the upstream main
 *
 * @param packageResult - The validated and scanned package.
 * @param options - Publish options (token, repo, dryRun).
 * @returns A PublishResult with the PR URL and number.
 * @throws Error if any GitHub API call fails.
 */
export async function publishToRegistry(
  packageResult: PackageResult,
  options: PublishOptions,
): Promise<PublishResult> {
  const registryRepo = options.registryRepo ?? DEFAULT_REGISTRY_REPO;
  const waveName = packageResult.manifest.name;
  const version = packageResult.manifest.version;
  const branch = `wave/${waveName}-${version}`;

  if (options.dryRun) {
    publisherLogger.info({ waveName, version }, 'Dry run — skipping PR creation');
    return {
      prUrl: `https://github.com/${registryRepo}/pulls (dry run)`,
      prNumber: 0,
      branch,
    };
  }

  try {
    // 1. Ensure fork
    const forkRepo = await ensureFork(registryRepo, options.githubToken);
    publisherLogger.info({ forkRepo }, 'Fork ready');

    // 2. Get upstream HEAD
    const baseSha = await getDefaultBranchSha(registryRepo, options.githubToken);

    // 3. Create branch in fork
    await createBranch(forkRepo, branch, baseSha, options.githubToken);
    publisherLogger.info({ branch }, 'Branch created');

    // 4. Commit files
    for (const file of packageResult.files) {
      const repoPath = `waves/${waveName}/${file.relativePath}`;
      await createFileInRepo(
        forkRepo,
        repoPath,
        file.content,
        branch,
        `feat: add ${waveName} v${version} — ${file.relativePath}`,
        options.githubToken,
      );
    }

    // Also add .scan-result.json
    const scanResultContent = JSON.stringify({
      passed: packageResult.scanResult.passed,
      summary: packageResult.scanResult.summary,
      packageHash: packageResult.packageHash,
      scannedAt: new Date().toISOString(),
    }, null, 2);

    await createFileInRepo(
      forkRepo,
      `waves/${waveName}/.scan-result.json`,
      scanResultContent,
      branch,
      `chore: add scan results for ${waveName}`,
      options.githubToken,
    );

    publisherLogger.info(
      { fileCount: packageResult.files.length + 1 },
      'Files committed',
    );

    // 5. Open PR
    const prBody = buildPrBody(packageResult);
    const pr = await githubApi(
      `/repos/${registryRepo}/pulls`,
      options.githubToken,
      {
        method: 'POST',
        body: JSON.stringify({
          title: `feat: add ${waveName} v${version}`,
          body: prBody,
          head: `${forkRepo.split('/')[0]}:${branch}`,
          base: 'main',
        }),
      },
    ) as { html_url: string; number: number };

    publisherLogger.info(
      { prUrl: pr.html_url, prNumber: pr.number },
      'Pull request created',
    );

    return {
      prUrl: pr.html_url,
      prNumber: pr.number,
      branch,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    publisherLogger.error({ error: message, waveName }, 'Failed to publish wave');
    throw new Error(`Failed to publish wave: ${message}`);
  }
}
