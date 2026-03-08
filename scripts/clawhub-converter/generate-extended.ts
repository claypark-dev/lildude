/**
 * Generate extended community waves (skills 101-1000).
 * Programmatically creates 900 skill definitions across diverse categories,
 * converts them to wave format, and outputs to waves/community/.
 *
 * Also generates:
 * - waves/community/categories.json — all waves organized by category
 * - scripts/clawhub-converter/wave-port-report.json — conversion status report
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertFromContents, type BatchResult } from './batch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SkillEntry {
  name: string;
  description: string;
  env?: string[];
  bins?: string[];
  category: string;
}

// ─── Skill Templates by Category ────────────────────────────────────────────

const SKILL_TEMPLATES: Record<string, Array<Omit<SkillEntry, 'category'>>> = {
  // ── Cloud & Infrastructure ──────────────────────────────────
  cloud: [
    { name: 'aws-ec2-status', description: 'Check AWS EC2 instance status and details', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
    { name: 'aws-lambda-invoke', description: 'Invoke AWS Lambda functions', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
    { name: 'aws-cloudwatch-logs', description: 'Query AWS CloudWatch log groups', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
    { name: 'aws-sqs-send', description: 'Send messages to AWS SQS queues', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
    { name: 'aws-sns-publish', description: 'Publish notifications via AWS SNS', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
    { name: 'aws-dynamodb-query', description: 'Query items from AWS DynamoDB tables', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
    { name: 'aws-iam-roles', description: 'List and inspect AWS IAM roles', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
    { name: 'aws-route53-dns', description: 'Manage AWS Route 53 DNS records', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
    { name: 'aws-rds-status', description: 'Check AWS RDS database instance status', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
    { name: 'aws-ecs-tasks', description: 'List and manage AWS ECS tasks', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
    { name: 'gcp-compute-list', description: 'List Google Cloud Compute Engine instances', env: ['GCP_SERVICE_ACCOUNT_KEY'] },
    { name: 'gcp-storage-list', description: 'List objects in Google Cloud Storage buckets', env: ['GCP_SERVICE_ACCOUNT_KEY'] },
    { name: 'gcp-bigquery-run', description: 'Run queries on Google BigQuery', env: ['GCP_SERVICE_ACCOUNT_KEY'] },
    { name: 'gcp-pubsub-publish', description: 'Publish messages to Google Pub/Sub topics', env: ['GCP_SERVICE_ACCOUNT_KEY'] },
    { name: 'gcp-functions-invoke', description: 'Invoke Google Cloud Functions', env: ['GCP_SERVICE_ACCOUNT_KEY'] },
    { name: 'azure-vm-status', description: 'Check Azure Virtual Machine status', env: ['AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'] },
    { name: 'azure-blob-list', description: 'List Azure Blob Storage containers and blobs', env: ['AZURE_STORAGE_CONNECTION_STRING'] },
    { name: 'azure-functions-invoke', description: 'Invoke Azure Functions', env: ['AZURE_FUNCTION_KEY'] },
    { name: 'azure-cosmos-query', description: 'Query Azure Cosmos DB documents', env: ['AZURE_COSMOS_ENDPOINT', 'AZURE_COSMOS_KEY'] },
    { name: 'azure-devops-builds', description: 'List Azure DevOps build pipelines', env: ['AZURE_DEVOPS_TOKEN'] },
    { name: 'digitalocean-droplets', description: 'List and manage DigitalOcean droplets', env: ['DIGITALOCEAN_TOKEN'] },
    { name: 'digitalocean-domains', description: 'Manage DigitalOcean DNS domains', env: ['DIGITALOCEAN_TOKEN'] },
    { name: 'cloudflare-dns', description: 'Manage Cloudflare DNS records', env: ['CLOUDFLARE_API_TOKEN'] },
    { name: 'cloudflare-workers', description: 'Deploy and manage Cloudflare Workers', env: ['CLOUDFLARE_API_TOKEN'] },
    { name: 'heroku-apps', description: 'List and manage Heroku applications', env: ['HEROKU_API_KEY'] },
    { name: 'vercel-deployments', description: 'List and manage Vercel deployments', env: ['VERCEL_TOKEN'] },
    { name: 'netlify-sites', description: 'List and manage Netlify sites', env: ['NETLIFY_AUTH_TOKEN'] },
    { name: 'terraform-plan', description: 'Run Terraform plan on infrastructure', bins: ['terraform'] },
    { name: 'terraform-state', description: 'Inspect Terraform state files', bins: ['terraform'] },
    { name: 'pulumi-status', description: 'Check Pulumi stack status', bins: ['pulumi'] },
  ],

  // ── DevOps & CI/CD ──────────────────────────────────────────
  devops: [
    { name: 'jenkins-jobs', description: 'List and trigger Jenkins build jobs', env: ['JENKINS_URL', 'JENKINS_TOKEN'] },
    { name: 'jenkins-build-status', description: 'Check Jenkins build status and logs', env: ['JENKINS_URL', 'JENKINS_TOKEN'] },
    { name: 'circleci-pipelines', description: 'List CircleCI pipeline runs', env: ['CIRCLECI_TOKEN'] },
    { name: 'travis-builds', description: 'Check Travis CI build status', env: ['TRAVIS_TOKEN'] },
    { name: 'github-actions-logs', description: 'Fetch GitHub Actions workflow logs', env: ['GITHUB_TOKEN'] },
    { name: 'drone-builds', description: 'Check Drone CI build status', env: ['DRONE_TOKEN'] },
    { name: 'ansible-playbook', description: 'Run Ansible playbooks for automation', bins: ['ansible-playbook'] },
    { name: 'ansible-inventory', description: 'List Ansible inventory hosts', bins: ['ansible'] },
    { name: 'helm-releases', description: 'List Helm chart releases in Kubernetes', bins: ['helm'] },
    { name: 'helm-install', description: 'Install Helm charts to Kubernetes', bins: ['helm'] },
    { name: 'kubectl-pods', description: 'List Kubernetes pods with status', bins: ['kubectl'] },
    { name: 'kubectl-logs', description: 'Fetch Kubernetes pod logs', bins: ['kubectl'] },
    { name: 'kubectl-describe', description: 'Describe Kubernetes resources', bins: ['kubectl'] },
    { name: 'kubectl-apply', description: 'Apply Kubernetes manifests', bins: ['kubectl'] },
    { name: 'kubectl-rollout', description: 'Manage Kubernetes deployment rollouts', bins: ['kubectl'] },
    { name: 'docker-compose-up', description: 'Start Docker Compose services', bins: ['docker'] },
    { name: 'docker-compose-logs', description: 'View Docker Compose service logs', bins: ['docker'] },
    { name: 'docker-build', description: 'Build Docker images from Dockerfiles', bins: ['docker'] },
    { name: 'docker-push', description: 'Push Docker images to registries', bins: ['docker'] },
    { name: 'docker-prune', description: 'Clean up unused Docker resources', bins: ['docker'] },
    { name: 'vagrant-status', description: 'Check Vagrant virtual machine status', bins: ['vagrant'] },
    { name: 'packer-build', description: 'Build machine images with Packer', bins: ['packer'] },
    { name: 'consul-members', description: 'List Consul cluster members', bins: ['consul'] },
    { name: 'vault-read', description: 'Read secrets from HashiCorp Vault', env: ['VAULT_ADDR', 'VAULT_TOKEN'] },
    { name: 'vault-list', description: 'List secrets in HashiCorp Vault paths', env: ['VAULT_ADDR', 'VAULT_TOKEN'] },
    { name: 'argocd-apps', description: 'List ArgoCD application deployments', env: ['ARGOCD_SERVER', 'ARGOCD_AUTH_TOKEN'] },
    { name: 'datadog-monitors', description: 'List Datadog monitoring alerts', env: ['DATADOG_API_KEY', 'DATADOG_APP_KEY'] },
    { name: 'datadog-metrics', description: 'Query Datadog metrics data', env: ['DATADOG_API_KEY', 'DATADOG_APP_KEY'] },
    { name: 'pagerduty-incidents', description: 'List PagerDuty incidents', env: ['PAGERDUTY_TOKEN'] },
    { name: 'newrelic-alerts', description: 'List New Relic alert conditions', env: ['NEWRELIC_API_KEY'] },
  ],

  // ── Database & Data ─────────────────────────────────────────
  data: [
    { name: 'postgres-query', description: 'Execute PostgreSQL database queries', env: ['DATABASE_URL'] },
    { name: 'postgres-tables', description: 'List PostgreSQL database tables and schemas', env: ['DATABASE_URL'] },
    { name: 'mysql-query', description: 'Execute MySQL database queries', env: ['MYSQL_URL'] },
    { name: 'mysql-tables', description: 'List MySQL database tables', env: ['MYSQL_URL'] },
    { name: 'mongodb-find', description: 'Find documents in MongoDB collections', env: ['MONGODB_URI'] },
    { name: 'mongodb-aggregate', description: 'Run MongoDB aggregation pipelines', env: ['MONGODB_URI'] },
    { name: 'redis-get', description: 'Get values from Redis key store', env: ['REDIS_URL'] },
    { name: 'redis-set', description: 'Set values in Redis key store', env: ['REDIS_URL'] },
    { name: 'redis-info', description: 'Get Redis server information and stats', env: ['REDIS_URL'] },
    { name: 'elasticsearch-search', description: 'Search Elasticsearch indices', env: ['ELASTICSEARCH_URL'] },
    { name: 'elasticsearch-index', description: 'Index documents in Elasticsearch', env: ['ELASTICSEARCH_URL'] },
    { name: 'sqlite-query', description: 'Execute SQLite database queries', bins: ['sqlite3'] },
    { name: 'supabase-rpc', description: 'Call Supabase RPC functions', env: ['SUPABASE_URL', 'SUPABASE_KEY'] },
    { name: 'supabase-storage', description: 'Manage Supabase storage buckets and files', env: ['SUPABASE_URL', 'SUPABASE_KEY'] },
    { name: 'firebase-auth-users', description: 'List Firebase Authentication users', env: ['FIREBASE_API_KEY'] },
    { name: 'firebase-firestore', description: 'Query Firebase Firestore documents', env: ['FIREBASE_API_KEY'] },
    { name: 'planetscale-branches', description: 'List PlanetScale database branches', env: ['PLANETSCALE_TOKEN'] },
    { name: 'neon-databases', description: 'Manage Neon serverless Postgres databases', env: ['NEON_API_KEY'] },
    { name: 'turso-query', description: 'Execute queries on Turso edge databases', env: ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'] },
    { name: 'prisma-migrate', description: 'Run Prisma database migrations', bins: ['npx'] },
    { name: 'drizzle-push', description: 'Push Drizzle ORM schema changes', bins: ['npx'] },
    { name: 'graphql-query', description: 'Execute GraphQL queries against endpoints', env: ['GRAPHQL_ENDPOINT'] },
    { name: 'influxdb-query', description: 'Query InfluxDB time series data', env: ['INFLUXDB_URL', 'INFLUXDB_TOKEN'] },
    { name: 'cassandra-query', description: 'Execute Apache Cassandra CQL queries', env: ['CASSANDRA_CONTACT_POINTS'] },
    { name: 'kafka-produce', description: 'Produce messages to Apache Kafka topics', env: ['KAFKA_BROKERS'] },
    { name: 'kafka-consume', description: 'Consume messages from Apache Kafka topics', env: ['KAFKA_BROKERS'] },
    { name: 'rabbitmq-publish', description: 'Publish messages to RabbitMQ exchanges', env: ['RABBITMQ_URL'] },
    { name: 'csv-to-json', description: 'Convert CSV files to JSON format' },
    { name: 'json-to-csv', description: 'Convert JSON data to CSV format' },
    { name: 'xml-to-json', description: 'Convert XML data to JSON format' },
  ],

  // ── Communication & Messaging ───────────────────────────────
  communication: [
    { name: 'slack-reactions', description: 'Add reactions to Slack messages', env: ['SLACK_BOT_TOKEN'] },
    { name: 'slack-file-upload', description: 'Upload files to Slack channels', env: ['SLACK_BOT_TOKEN'] },
    { name: 'slack-user-info', description: 'Get Slack user profile information', env: ['SLACK_BOT_TOKEN'] },
    { name: 'slack-reminder', description: 'Create Slack reminders for users', env: ['SLACK_BOT_TOKEN'] },
    { name: 'slack-thread-reply', description: 'Reply to Slack message threads', env: ['SLACK_BOT_TOKEN'] },
    { name: 'discord-embed', description: 'Send rich embeds to Discord channels', env: ['DISCORD_BOT_TOKEN'] },
    { name: 'discord-reactions', description: 'Add reactions to Discord messages', env: ['DISCORD_BOT_TOKEN'] },
    { name: 'discord-channel-list', description: 'List Discord server channels', env: ['DISCORD_BOT_TOKEN'] },
    { name: 'discord-user-info', description: 'Get Discord user profile information', env: ['DISCORD_BOT_TOKEN'] },
    { name: 'telegram-photo', description: 'Send photos via Telegram bot', env: ['TELEGRAM_BOT_TOKEN'] },
    { name: 'telegram-document', description: 'Send documents via Telegram bot', env: ['TELEGRAM_BOT_TOKEN'] },
    { name: 'telegram-poll', description: 'Create polls via Telegram bot', env: ['TELEGRAM_BOT_TOKEN'] },
    { name: 'email-send-smtp', description: 'Send emails via SMTP server', env: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] },
    { name: 'mailgun-send', description: 'Send emails via Mailgun API', env: ['MAILGUN_API_KEY'] },
    { name: 'postmark-send', description: 'Send transactional emails via Postmark', env: ['POSTMARK_SERVER_TOKEN'] },
    { name: 'ses-send', description: 'Send emails via Amazon SES', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
    { name: 'matrix-send', description: 'Send messages to Matrix chat rooms', env: ['MATRIX_HOMESERVER', 'MATRIX_ACCESS_TOKEN'] },
    { name: 'teams-webhook', description: 'Send messages to Microsoft Teams via webhooks', env: ['TEAMS_WEBHOOK_URL'] },
    { name: 'pushover-notify', description: 'Send push notifications via Pushover', env: ['PUSHOVER_TOKEN', 'PUSHOVER_USER'] },
    { name: 'pushbullet-push', description: 'Send push notifications via Pushbullet', env: ['PUSHBULLET_TOKEN'] },
    { name: 'twilio-call', description: 'Make phone calls via Twilio API', env: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] },
    { name: 'twilio-whatsapp', description: 'Send WhatsApp messages via Twilio', env: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] },
    { name: 'intercom-message', description: 'Send messages via Intercom', env: ['INTERCOM_TOKEN'] },
    { name: 'sendbird-message', description: 'Send messages via SendBird chat', env: ['SENDBIRD_API_TOKEN'] },
    { name: 'mailchimp-campaign', description: 'Create Mailchimp email campaigns', env: ['MAILCHIMP_API_KEY'] },
    { name: 'mailchimp-subscribe', description: 'Add subscribers to Mailchimp lists', env: ['MAILCHIMP_API_KEY'] },
    { name: 'convertkit-subscribe', description: 'Add subscribers to ConvertKit', env: ['CONVERTKIT_API_KEY'] },
    { name: 'resend-email', description: 'Send transactional emails via Resend', env: ['RESEND_API_KEY'] },
    { name: 'ntfy-notify', description: 'Send notifications via ntfy.sh', env: ['NTFY_TOPIC'] },
    { name: 'gotify-push', description: 'Send push notifications via Gotify', env: ['GOTIFY_URL', 'GOTIFY_TOKEN'] },
  ],

  // ── Productivity & Project Management ───────────────────────
  productivity: [
    { name: 'notion-search', description: 'Search across Notion workspaces', env: ['NOTION_API_KEY'] },
    { name: 'notion-block-append', description: 'Append blocks to Notion pages', env: ['NOTION_API_KEY'] },
    { name: 'trello-cards', description: 'Create and manage Trello cards', env: ['TRELLO_API_KEY', 'TRELLO_TOKEN'] },
    { name: 'trello-boards', description: 'List and manage Trello boards', env: ['TRELLO_API_KEY', 'TRELLO_TOKEN'] },
    { name: 'asana-tasks', description: 'Create and manage Asana tasks', env: ['ASANA_TOKEN'] },
    { name: 'asana-projects', description: 'List and manage Asana projects', env: ['ASANA_TOKEN'] },
    { name: 'todoist-tasks', description: 'Create and manage Todoist tasks', env: ['TODOIST_API_KEY'] },
    { name: 'todoist-projects', description: 'List and manage Todoist projects', env: ['TODOIST_API_KEY'] },
    { name: 'clickup-tasks', description: 'Create and manage ClickUp tasks', env: ['CLICKUP_API_KEY'] },
    { name: 'clickup-spaces', description: 'List ClickUp workspaces and spaces', env: ['CLICKUP_API_KEY'] },
    { name: 'monday-items', description: 'Create and manage Monday.com items', env: ['MONDAY_API_KEY'] },
    { name: 'basecamp-todos', description: 'Create and manage Basecamp to-do lists', env: ['BASECAMP_TOKEN'] },
    { name: 'google-calendar-events', description: 'List and create Google Calendar events', env: ['GOOGLE_CALENDAR_API_KEY'] },
    { name: 'google-drive-list', description: 'List files in Google Drive folders', env: ['GOOGLE_DRIVE_API_KEY'] },
    { name: 'google-sheets-read', description: 'Read data from Google Sheets', env: ['GOOGLE_SHEETS_API_KEY'] },
    { name: 'google-sheets-write', description: 'Write data to Google Sheets', env: ['GOOGLE_SHEETS_API_KEY'] },
    { name: 'google-docs-create', description: 'Create Google Docs documents', env: ['GOOGLE_DOCS_API_KEY'] },
    { name: 'dropbox-list', description: 'List files and folders in Dropbox', env: ['DROPBOX_ACCESS_TOKEN'] },
    { name: 'dropbox-upload', description: 'Upload files to Dropbox', env: ['DROPBOX_ACCESS_TOKEN'] },
    { name: 'box-files', description: 'List and manage Box cloud files', env: ['BOX_ACCESS_TOKEN'] },
    { name: 'confluence-pages', description: 'Create and manage Confluence wiki pages', env: ['CONFLUENCE_API_TOKEN'] },
    { name: 'coda-docs', description: 'Create and manage Coda documents', env: ['CODA_API_TOKEN'] },
    { name: 'obsidian-note', description: 'Create notes in Obsidian vaults', bins: ['find'] },
    { name: 'calendar-ics-parse', description: 'Parse ICS calendar file events' },
    { name: 'pomodoro-timer', description: 'Start and manage Pomodoro timer sessions' },
    { name: 'time-tracker', description: 'Track time spent on tasks and projects' },
    { name: 'meeting-scheduler', description: 'Schedule meetings across time zones' },
    { name: 'task-prioritizer', description: 'Prioritize tasks using Eisenhower matrix' },
    { name: 'standup-generator', description: 'Generate daily standup status reports' },
    { name: 'retrospective-template', description: 'Generate sprint retrospective templates' },
  ],

  // ── Development Tools ───────────────────────────────────────
  development: [
    { name: 'github-release', description: 'Create GitHub releases with changelogs', env: ['GITHUB_TOKEN'] },
    { name: 'github-labels', description: 'Manage GitHub repository labels', env: ['GITHUB_TOKEN'] },
    { name: 'github-milestones', description: 'Create and manage GitHub milestones', env: ['GITHUB_TOKEN'] },
    { name: 'github-teams', description: 'List and manage GitHub organization teams', env: ['GITHUB_TOKEN'] },
    { name: 'github-webhooks', description: 'Manage GitHub repository webhooks', env: ['GITHUB_TOKEN'] },
    { name: 'github-code-search', description: 'Search code across GitHub repositories', env: ['GITHUB_TOKEN'] },
    { name: 'github-commit-history', description: 'View detailed GitHub commit history', env: ['GITHUB_TOKEN'] },
    { name: 'github-branch-protect', description: 'Manage GitHub branch protection rules', env: ['GITHUB_TOKEN'] },
    { name: 'gitlab-issues', description: 'Create and manage GitLab issues', env: ['GITLAB_TOKEN'] },
    { name: 'gitlab-pipelines', description: 'View GitLab CI/CD pipeline status', env: ['GITLAB_TOKEN'] },
    { name: 'gitlab-snippets', description: 'Create and manage GitLab code snippets', env: ['GITLAB_TOKEN'] },
    { name: 'bitbucket-repos', description: 'List and manage Bitbucket repositories', env: ['BITBUCKET_TOKEN'] },
    { name: 'bitbucket-pipelines', description: 'View Bitbucket pipeline builds', env: ['BITBUCKET_TOKEN'] },
    { name: 'linear-projects', description: 'Create and manage Linear projects', env: ['LINEAR_API_KEY'] },
    { name: 'linear-cycles', description: 'Manage Linear project cycles', env: ['LINEAR_API_KEY'] },
    { name: 'jira-sprints', description: 'Manage Jira project sprints', env: ['JIRA_API_TOKEN'] },
    { name: 'jira-boards', description: 'List and manage Jira boards', env: ['JIRA_API_TOKEN'] },
    { name: 'sentry-issues', description: 'List and manage Sentry error issues', env: ['SENTRY_AUTH_TOKEN'] },
    { name: 'sentry-events', description: 'View Sentry error event details', env: ['SENTRY_AUTH_TOKEN'] },
    { name: 'bugsnag-errors', description: 'List Bugsnag error reports', env: ['BUGSNAG_AUTH_TOKEN'] },
    { name: 'npm-publish', description: 'Publish packages to npm registry', bins: ['npm'] },
    { name: 'npm-audit', description: 'Run npm security audit on packages', bins: ['npm'] },
    { name: 'yarn-outdated', description: 'Check for outdated yarn packages', bins: ['yarn'] },
    { name: 'pnpm-outdated', description: 'Check for outdated pnpm packages', bins: ['pnpm'] },
    { name: 'bun-run', description: 'Run scripts using Bun runtime', bins: ['bun'] },
    { name: 'deno-run', description: 'Run TypeScript scripts using Deno', bins: ['deno'] },
    { name: 'eslint-check', description: 'Run ESLint code quality checks', bins: ['npx'] },
    { name: 'prettier-format', description: 'Format code files with Prettier', bins: ['npx'] },
    { name: 'typescript-check', description: 'Run TypeScript type checking', bins: ['npx'] },
    { name: 'vitest-run', description: 'Run Vitest test suites', bins: ['npx'] },
    { name: 'jest-run', description: 'Run Jest test suites', bins: ['npx'] },
    { name: 'mocha-run', description: 'Run Mocha test suites', bins: ['npx'] },
    { name: 'playwright-test', description: 'Run Playwright browser tests', bins: ['npx'] },
    { name: 'cypress-run', description: 'Run Cypress end-to-end tests', bins: ['npx'] },
    { name: 'storybook-build', description: 'Build Storybook component library', bins: ['npx'] },
    { name: 'webpack-build', description: 'Build projects with Webpack', bins: ['npx'] },
    { name: 'vite-build', description: 'Build projects with Vite bundler', bins: ['npx'] },
    { name: 'esbuild-bundle', description: 'Bundle code with esbuild', bins: ['npx'] },
    { name: 'rollup-build', description: 'Build packages with Rollup', bins: ['npx'] },
    { name: 'turbo-run', description: 'Run Turborepo monorepo tasks', bins: ['npx'] },
    { name: 'nx-run', description: 'Run Nx monorepo project tasks', bins: ['npx'] },
    { name: 'cargo-test', description: 'Run Rust project tests with Cargo', bins: ['cargo'] },
    { name: 'cargo-clippy', description: 'Run Rust linter Clippy checks', bins: ['cargo'] },
    { name: 'cargo-doc', description: 'Generate Rust documentation', bins: ['cargo'] },
    { name: 'go-test', description: 'Run Go project tests', bins: ['go'] },
    { name: 'go-vet', description: 'Run Go static analysis checks', bins: ['go'] },
    { name: 'go-mod-tidy', description: 'Tidy Go module dependencies', bins: ['go'] },
    { name: 'python-pytest', description: 'Run Python tests with pytest', bins: ['python3'] },
    { name: 'python-mypy', description: 'Run Python type checking with mypy', bins: ['python3'] },
    { name: 'python-ruff', description: 'Lint Python code with Ruff', bins: ['python3'] },
    { name: 'python-black', description: 'Format Python code with Black', bins: ['python3'] },
    { name: 'ruby-rspec', description: 'Run Ruby tests with RSpec', bins: ['ruby'] },
    { name: 'ruby-rubocop', description: 'Lint Ruby code with RuboCop', bins: ['ruby'] },
    { name: 'swift-build', description: 'Build Swift projects', bins: ['swift'] },
    { name: 'swift-test', description: 'Run Swift project tests', bins: ['swift'] },
    { name: 'dotnet-build', description: 'Build .NET projects', bins: ['dotnet'] },
    { name: 'dotnet-test', description: 'Run .NET project tests', bins: ['dotnet'] },
    { name: 'gradle-build', description: 'Build Java projects with Gradle', bins: ['gradle'] },
    { name: 'maven-build', description: 'Build Java projects with Maven', bins: ['mvn'] },
    { name: 'elixir-test', description: 'Run Elixir project tests with Mix', bins: ['mix'] },
    { name: 'php-composer', description: 'Manage PHP dependencies with Composer', bins: ['composer'] },
    { name: 'changelog-generator', description: 'Generate changelogs from git commits', bins: ['git'] },
    { name: 'semver-bump', description: 'Bump semantic version numbers', bins: ['npm'] },
    { name: 'license-checker', description: 'Check project dependency licenses', bins: ['npx'] },
    { name: 'code-complexity', description: 'Analyze code complexity metrics', bins: ['npx'] },
    { name: 'code-coverage', description: 'Generate code coverage reports', bins: ['npx'] },
    { name: 'api-doc-generator', description: 'Generate API documentation from source', bins: ['npx'] },
  ],

  // ── AI & Machine Learning ───────────────────────────────────
  ai: [
    { name: 'openai-embeddings', description: 'Generate text embeddings with OpenAI', env: ['OPENAI_API_KEY'] },
    { name: 'openai-whisper', description: 'Transcribe audio with OpenAI Whisper', env: ['OPENAI_API_KEY'] },
    { name: 'openai-tts', description: 'Generate speech with OpenAI TTS', env: ['OPENAI_API_KEY'] },
    { name: 'openai-moderation', description: 'Moderate content with OpenAI', env: ['OPENAI_API_KEY'] },
    { name: 'openai-fine-tune-list', description: 'List OpenAI fine-tuning jobs', env: ['OPENAI_API_KEY'] },
    { name: 'anthropic-messages', description: 'Send messages to Claude via API', env: ['ANTHROPIC_API_KEY'] },
    { name: 'gemini-chat', description: 'Chat with Google Gemini models', env: ['GOOGLE_AI_API_KEY'] },
    { name: 'gemini-vision', description: 'Analyze images with Google Gemini', env: ['GOOGLE_AI_API_KEY'] },
    { name: 'mistral-chat', description: 'Chat with Mistral AI models', env: ['MISTRAL_API_KEY'] },
    { name: 'cohere-generate', description: 'Generate text with Cohere models', env: ['COHERE_API_KEY'] },
    { name: 'cohere-embed', description: 'Generate embeddings with Cohere', env: ['COHERE_API_KEY'] },
    { name: 'cohere-rerank', description: 'Rerank search results with Cohere', env: ['COHERE_API_KEY'] },
    { name: 'huggingface-inference', description: 'Run inference on Hugging Face models', env: ['HUGGINGFACE_TOKEN'] },
    { name: 'stability-image', description: 'Generate images with Stability AI', env: ['STABILITY_API_KEY'] },
    { name: 'midjourney-imagine', description: 'Generate images with Midjourney API', env: ['MIDJOURNEY_API_KEY'] },
    { name: 'elevenlabs-tts', description: 'Generate speech with ElevenLabs', env: ['ELEVENLABS_API_KEY'] },
    { name: 'elevenlabs-voices', description: 'List ElevenLabs available voices', env: ['ELEVENLABS_API_KEY'] },
    { name: 'deepgram-transcribe', description: 'Transcribe audio with Deepgram', env: ['DEEPGRAM_API_KEY'] },
    { name: 'assemblyai-transcribe', description: 'Transcribe audio with AssemblyAI', env: ['ASSEMBLYAI_API_KEY'] },
    { name: 'pinecone-upsert', description: 'Upsert vectors to Pinecone index', env: ['PINECONE_API_KEY'] },
    { name: 'pinecone-query', description: 'Query Pinecone vector database', env: ['PINECONE_API_KEY'] },
    { name: 'weaviate-search', description: 'Search Weaviate vector database', env: ['WEAVIATE_URL'] },
    { name: 'qdrant-search', description: 'Search Qdrant vector database', env: ['QDRANT_URL'] },
    { name: 'chroma-search', description: 'Search ChromaDB vector store', env: ['CHROMA_URL'] },
    { name: 'langchain-agent', description: 'Run LangChain agent chains', env: ['OPENAI_API_KEY'] },
    { name: 'llamaindex-query', description: 'Query documents with LlamaIndex', env: ['OPENAI_API_KEY'] },
    { name: 'ollama-chat', description: 'Chat with local Ollama models', env: ['OLLAMA_HOST'] },
    { name: 'ollama-list', description: 'List available Ollama models', env: ['OLLAMA_HOST'] },
    { name: 'together-chat', description: 'Chat with Together AI models', env: ['TOGETHER_API_KEY'] },
    { name: 'perplexity-search', description: 'Search with Perplexity AI', env: ['PERPLEXITY_API_KEY'] },
    { name: 'fireworks-inference', description: 'Run inference on Fireworks AI', env: ['FIREWORKS_API_KEY'] },
    { name: 'anyscale-inference', description: 'Run inference on Anyscale', env: ['ANYSCALE_API_KEY'] },
    { name: 'ocr-extract', description: 'Extract text from images using OCR', env: ['OCR_API_KEY'] },
    { name: 'image-captioner', description: 'Generate captions for images', env: ['OPENAI_API_KEY'] },
    { name: 'text-classifier', description: 'Classify text into categories', env: ['OPENAI_API_KEY'] },
    { name: 'named-entity-extractor', description: 'Extract named entities from text', env: ['OPENAI_API_KEY'] },
    { name: 'question-answerer', description: 'Answer questions from provided context', env: ['OPENAI_API_KEY'] },
    { name: 'document-summarizer', description: 'Summarize documents and articles', env: ['OPENAI_API_KEY'] },
    { name: 'code-explainer', description: 'Explain code snippets in plain language', env: ['OPENAI_API_KEY'] },
    { name: 'sql-generator', description: 'Generate SQL queries from natural language', env: ['OPENAI_API_KEY'] },
  ],

  // ── Security & Auth ─────────────────────────────────────────
  security: [
    { name: 'auth0-users', description: 'List and manage Auth0 users', env: ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID'] },
    { name: 'auth0-roles', description: 'Manage Auth0 roles and permissions', env: ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID'] },
    { name: 'okta-users', description: 'List and manage Okta users', env: ['OKTA_DOMAIN', 'OKTA_API_TOKEN'] },
    { name: 'clerk-users', description: 'List and manage Clerk users', env: ['CLERK_SECRET_KEY'] },
    { name: 'supabase-auth', description: 'Manage Supabase authentication users', env: ['SUPABASE_URL', 'SUPABASE_KEY'] },
    { name: 'jwt-generator', description: 'Generate JWT tokens for testing' },
    { name: 'jwt-verifier', description: 'Verify and validate JWT tokens' },
    { name: 'bcrypt-hash', description: 'Hash passwords using bcrypt' },
    { name: 'argon2-hash', description: 'Hash passwords using Argon2' },
    { name: 'totp-generator', description: 'Generate TOTP codes for 2FA testing' },
    { name: 'ssl-cert-generator', description: 'Generate self-signed SSL certificates', bins: ['openssl'] },
    { name: 'ssl-cert-info', description: 'Inspect SSL certificate details', bins: ['openssl'] },
    { name: 'gpg-encrypt', description: 'Encrypt files with GPG', bins: ['gpg'] },
    { name: 'gpg-decrypt', description: 'Decrypt GPG encrypted files', bins: ['gpg'] },
    { name: 'ssh-keygen', description: 'Generate SSH key pairs', bins: ['ssh-keygen'] },
    { name: 'chmod-calculator', description: 'Calculate Unix file permission modes' },
    { name: 'csp-header-gen', description: 'Generate Content Security Policy headers' },
    { name: 'cors-header-gen', description: 'Generate CORS response headers' },
    { name: 'password-strength', description: 'Analyze password strength and entropy' },
    { name: 'secret-scanner', description: 'Scan files for hardcoded secrets', bins: ['grep'] },
    { name: 'dependency-audit', description: 'Audit dependencies for vulnerabilities', bins: ['npm'] },
    { name: 'snyk-test', description: 'Run Snyk security tests on projects', env: ['SNYK_TOKEN'] },
    { name: 'sonarqube-analysis', description: 'Run SonarQube code analysis', env: ['SONAR_TOKEN'] },
    { name: 'trivy-scan', description: 'Scan containers for vulnerabilities', bins: ['trivy'] },
    { name: 'nmap-scan', description: 'Network discovery and security scanning', bins: ['nmap'] },
    { name: 'http-header-check', description: 'Check HTTP security headers for a URL' },
    { name: 'subdomain-finder', description: 'Find subdomains for a given domain' },
    { name: 'cve-lookup', description: 'Look up CVE vulnerability details' },
    { name: 'owasp-zap-scan', description: 'Run OWASP ZAP security scan', bins: ['docker'] },
    { name: 'rate-limiter-calc', description: 'Calculate rate limiting configurations' },
  ],

  // ── Analytics & Monitoring ──────────────────────────────────
  analytics: [
    { name: 'google-analytics-report', description: 'Generate Google Analytics reports', env: ['GOOGLE_ANALYTICS_API_KEY'] },
    { name: 'mixpanel-events', description: 'Query Mixpanel event analytics', env: ['MIXPANEL_TOKEN'] },
    { name: 'amplitude-events', description: 'Query Amplitude event data', env: ['AMPLITUDE_API_KEY'] },
    { name: 'segment-track', description: 'Send track events to Segment', env: ['SEGMENT_WRITE_KEY'] },
    { name: 'posthog-events', description: 'Query PostHog analytics events', env: ['POSTHOG_API_KEY'] },
    { name: 'plausible-stats', description: 'Get Plausible Analytics site stats', env: ['PLAUSIBLE_API_KEY'] },
    { name: 'hotjar-recordings', description: 'List Hotjar session recordings', env: ['HOTJAR_API_KEY'] },
    { name: 'prometheus-query', description: 'Query Prometheus metrics', env: ['PROMETHEUS_URL'] },
    { name: 'grafana-dashboards', description: 'List Grafana dashboards', env: ['GRAFANA_URL', 'GRAFANA_API_KEY'] },
    { name: 'grafana-alerts', description: 'List Grafana alert rules', env: ['GRAFANA_URL', 'GRAFANA_API_KEY'] },
    { name: 'uptimerobot-status', description: 'Check UptimeRobot monitor status', env: ['UPTIMEROBOT_API_KEY'] },
    { name: 'statuspage-update', description: 'Update Statuspage.io component status', env: ['STATUSPAGE_API_KEY'] },
    { name: 'lighthouse-audit', description: 'Run Google Lighthouse web audit', bins: ['npx'] },
    { name: 'pagespeed-check', description: 'Check Google PageSpeed Insights', env: ['GOOGLE_API_KEY'] },
    { name: 'web-vitals-check', description: 'Check Core Web Vitals metrics', env: ['GOOGLE_API_KEY'] },
    { name: 'logrocket-sessions', description: 'List LogRocket session replays', env: ['LOGROCKET_API_KEY'] },
    { name: 'heap-analytics', description: 'Query Heap Analytics data', env: ['HEAP_API_KEY'] },
    { name: 'cloudwatch-metrics', description: 'Query AWS CloudWatch metrics', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
    { name: 'splunk-search', description: 'Search Splunk log data', env: ['SPLUNK_TOKEN'] },
    { name: 'elastic-apm', description: 'Query Elastic APM performance data', env: ['ELASTICSEARCH_URL'] },
  ],

  // ── Finance & Payments ──────────────────────────────────────
  finance: [
    { name: 'stripe-customers', description: 'List and manage Stripe customers', env: ['STRIPE_SECRET_KEY'] },
    { name: 'stripe-payments', description: 'List Stripe payment intents', env: ['STRIPE_SECRET_KEY'] },
    { name: 'stripe-invoices', description: 'List and manage Stripe invoices', env: ['STRIPE_SECRET_KEY'] },
    { name: 'stripe-subscriptions', description: 'Manage Stripe subscriptions', env: ['STRIPE_SECRET_KEY'] },
    { name: 'stripe-products', description: 'List Stripe products and prices', env: ['STRIPE_SECRET_KEY'] },
    { name: 'stripe-balance', description: 'Check Stripe account balance', env: ['STRIPE_SECRET_KEY'] },
    { name: 'paypal-transactions', description: 'List PayPal transaction history', env: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'] },
    { name: 'paypal-invoices', description: 'Create PayPal invoices', env: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'] },
    { name: 'square-payments', description: 'List Square payment transactions', env: ['SQUARE_ACCESS_TOKEN'] },
    { name: 'plaid-accounts', description: 'List financial accounts via Plaid', env: ['PLAID_CLIENT_ID', 'PLAID_SECRET'] },
    { name: 'wise-transfers', description: 'List Wise money transfers', env: ['WISE_API_TOKEN'] },
    { name: 'currency-converter', description: 'Convert currencies using exchange rates' },
    { name: 'tax-calculator', description: 'Calculate sales tax for regions' },
    { name: 'invoice-generator', description: 'Generate PDF invoices' },
    { name: 'expense-tracker', description: 'Track and categorize expenses' },
    { name: 'budget-planner', description: 'Create and track budget plans' },
    { name: 'compound-interest', description: 'Calculate compound interest and returns' },
    { name: 'mortgage-calculator', description: 'Calculate mortgage payments and schedules' },
    { name: 'forex-rates', description: 'Get foreign exchange rate data' },
    { name: 'eth-balance', description: 'Check Ethereum wallet balances', env: ['ETHERSCAN_API_KEY'] },
  ],

  // ── Media & Content ─────────────────────────────────────────
  media: [
    { name: 'spotify-playlist', description: 'Create and manage Spotify playlists', env: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'] },
    { name: 'spotify-now-playing', description: 'Get currently playing Spotify track', env: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'] },
    { name: 'spotify-recommendations', description: 'Get Spotify music recommendations', env: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'] },
    { name: 'youtube-channel-stats', description: 'Get YouTube channel statistics', env: ['YOUTUBE_API_KEY'] },
    { name: 'youtube-playlist', description: 'Manage YouTube playlists', env: ['YOUTUBE_API_KEY'] },
    { name: 'youtube-transcript', description: 'Get YouTube video transcripts', env: ['YOUTUBE_API_KEY'] },
    { name: 'unsplash-search', description: 'Search for free images on Unsplash', env: ['UNSPLASH_ACCESS_KEY'] },
    { name: 'pexels-search', description: 'Search for free images on Pexels', env: ['PEXELS_API_KEY'] },
    { name: 'giphy-search', description: 'Search for GIFs on Giphy', env: ['GIPHY_API_KEY'] },
    { name: 'cloudinary-upload', description: 'Upload and transform images on Cloudinary', env: ['CLOUDINARY_URL'] },
    { name: 'cloudinary-transform', description: 'Apply transformations to Cloudinary images', env: ['CLOUDINARY_URL'] },
    { name: 'imgbb-upload', description: 'Upload images to ImgBB hosting', env: ['IMGBB_API_KEY'] },
    { name: 'tmdb-search', description: 'Search movies on The Movie Database', env: ['TMDB_API_KEY'] },
    { name: 'tmdb-trending', description: 'Get trending movies from TMDB', env: ['TMDB_API_KEY'] },
    { name: 'omdb-search', description: 'Search movie details on OMDb', env: ['OMDB_API_KEY'] },
    { name: 'podcast-search', description: 'Search for podcasts on Listen Notes', env: ['LISTENNOTES_API_KEY'] },
    { name: 'rss-reader', description: 'Parse and read RSS feed entries' },
    { name: 'atom-reader', description: 'Parse and read Atom feed entries' },
    { name: 'opengraph-parser', description: 'Parse Open Graph metadata from URLs' },
    { name: 'image-resizer', description: 'Resize images to specified dimensions', bins: ['convert'] },
    { name: 'image-optimizer', description: 'Optimize image files for web', bins: ['convert'] },
    { name: 'video-info', description: 'Get video file metadata and info', bins: ['ffprobe'] },
    { name: 'audio-converter', description: 'Convert audio between formats', bins: ['ffmpeg'] },
    { name: 'video-thumbnail', description: 'Extract thumbnails from video files', bins: ['ffmpeg'] },
    { name: 'pdf-text-extract', description: 'Extract text from PDF documents', bins: ['pdftotext'] },
    { name: 'pdf-page-count', description: 'Count pages in PDF documents', bins: ['pdfinfo'] },
    { name: 'markdown-renderer', description: 'Render Markdown to formatted output' },
    { name: 'latex-to-text', description: 'Convert LaTeX markup to plain text' },
    { name: 'svg-optimizer', description: 'Optimize SVG files for web use' },
    { name: 'favicon-generator', description: 'Generate favicons from images' },
  ],

  // ── Utilities (Extended) ────────────────────────────────────
  utilities: [
    { name: 'timezone-list', description: 'List all time zones and current times' },
    { name: 'epoch-converter', description: 'Convert between epoch timestamps and dates' },
    { name: 'ip-to-geo', description: 'Convert IP addresses to geographic locations' },
    { name: 'user-agent-parser', description: 'Parse user agent strings' },
    { name: 'mime-type-lookup', description: 'Look up MIME types for file extensions' },
    { name: 'slug-generator', description: 'Generate URL-friendly slugs from text' },
    { name: 'random-data-gen', description: 'Generate random test data records' },
    { name: 'ascii-art-gen', description: 'Generate ASCII art from text' },
    { name: 'emoji-lookup', description: 'Search and find emoji by name or description' },
    { name: 'unicode-lookup', description: 'Look up Unicode character details' },
    { name: 'html-entity-encode', description: 'Encode and decode HTML entities' },
    { name: 'url-parser', description: 'Parse and analyze URL components' },
    { name: 'url-encoder', description: 'Encode and decode URL components' },
    { name: 'cidr-calculator', description: 'Calculate CIDR subnet ranges' },
    { name: 'mac-address-lookup', description: 'Look up MAC address vendor info' },
    { name: 'hex-viewer', description: 'View file contents in hexadecimal', bins: ['xxd'] },
    { name: 'diff-viewer', description: 'View unified diff between two texts' },
    { name: 'yaml-validator', description: 'Validate YAML file syntax' },
    { name: 'toml-validator', description: 'Validate TOML file syntax' },
    { name: 'xml-validator', description: 'Validate XML document syntax' },
    { name: 'json-schema-validate', description: 'Validate JSON against JSON Schema' },
    { name: 'env-file-parser', description: 'Parse dotenv files safely' },
    { name: 'yaml-to-json', description: 'Convert YAML files to JSON format' },
    { name: 'json-to-yaml', description: 'Convert JSON data to YAML format' },
    { name: 'base32-encoder', description: 'Encode and decode Base32 strings' },
    { name: 'sha-calculator', description: 'Calculate SHA-1, SHA-256, SHA-512 hashes' },
    { name: 'hmac-generator', description: 'Generate HMAC signatures' },
    { name: 'checksum-verifier', description: 'Verify file checksums against hashes' },
    { name: 'crc32-calculator', description: 'Calculate CRC32 checksums' },
    { name: 'aes-encrypt', description: 'Encrypt text with AES encryption' },
    { name: 'rsa-keygen', description: 'Generate RSA key pairs' },
    { name: 'number-converter', description: 'Convert between number bases and formats' },
    { name: 'roman-numeral', description: 'Convert between Roman and Arabic numerals' },
    { name: 'binary-converter', description: 'Convert between binary and decimal' },
    { name: 'temperature-converter', description: 'Convert between temperature units' },
    { name: 'length-converter', description: 'Convert between length measurement units' },
    { name: 'weight-converter', description: 'Convert between weight measurement units' },
    { name: 'volume-converter', description: 'Convert between volume measurement units' },
    { name: 'speed-converter', description: 'Convert between speed measurement units' },
    { name: 'data-size-converter', description: 'Convert between data size units' },
    { name: 'bandwidth-calculator', description: 'Calculate bandwidth and transfer times' },
    { name: 'sort-lines', description: 'Sort text lines alphabetically or numerically' },
    { name: 'dedupe-lines', description: 'Remove duplicate lines from text' },
    { name: 'word-frequency', description: 'Count word frequency in text' },
    { name: 'text-case-converter', description: 'Convert text between camelCase, snake_case, etc.' },
    { name: 'string-reverse', description: 'Reverse strings and character sequences' },
    { name: 'whitespace-cleaner', description: 'Clean and normalize whitespace in text' },
    { name: 'lorem-paragraph', description: 'Generate Lorem Ipsum paragraphs' },
    { name: 'fake-name-gen', description: 'Generate random fake names and identities' },
    { name: 'fake-address-gen', description: 'Generate random fake addresses' },
    { name: 'fake-email-gen', description: 'Generate random fake email addresses' },
    { name: 'fake-phone-gen', description: 'Generate random fake phone numbers' },
    { name: 'fake-company-gen', description: 'Generate random fake company names' },
    { name: 'color-palette-gen', description: 'Generate harmonious color palettes' },
    { name: 'gradient-generator', description: 'Generate CSS gradient code' },
    { name: 'tailwind-colors', description: 'Look up Tailwind CSS color values' },
    { name: 'css-minifier', description: 'Minify CSS stylesheets' },
    { name: 'js-minifier', description: 'Minify JavaScript code' },
    { name: 'html-minifier', description: 'Minify HTML documents' },
    { name: 'html-to-markdown', description: 'Convert HTML to Markdown format' },
    { name: 'sql-formatter', description: 'Format and beautify SQL queries' },
    { name: 'xml-formatter', description: 'Format and beautify XML documents' },
    { name: 'yaml-formatter', description: 'Format and beautify YAML files' },
    { name: 'nginx-config-gen', description: 'Generate Nginx configuration files' },
    { name: 'apache-config-gen', description: 'Generate Apache configuration files' },
    { name: 'docker-compose-gen', description: 'Generate Docker Compose YAML files' },
    { name: 'gitignore-gen', description: 'Generate .gitignore files for projects' },
    { name: 'editorconfig-gen', description: 'Generate .editorconfig files' },
    { name: 'tsconfig-gen', description: 'Generate TypeScript tsconfig.json files' },
    { name: 'eslintrc-gen', description: 'Generate ESLint configuration files' },
    { name: 'prettierrc-gen', description: 'Generate Prettier configuration files' },
    { name: 'readme-gen', description: 'Generate README.md templates for projects' },
    { name: 'contributing-gen', description: 'Generate CONTRIBUTING.md templates' },
    { name: 'mit-license-gen', description: 'Generate MIT license files' },
    { name: 'apache-license-gen', description: 'Generate Apache 2.0 license files' },
    { name: 'isc-license-gen', description: 'Generate ISC license files' },
  ],

  // ── Social & CRM ────────────────────────────────────────────
  social: [
    { name: 'twitter-post', description: 'Post tweets to Twitter/X', env: ['TWITTER_API_KEY', 'TWITTER_API_SECRET'] },
    { name: 'twitter-search', description: 'Search tweets on Twitter/X', env: ['TWITTER_API_KEY', 'TWITTER_API_SECRET'] },
    { name: 'twitter-followers', description: 'List Twitter/X followers', env: ['TWITTER_API_KEY', 'TWITTER_API_SECRET'] },
    { name: 'linkedin-post', description: 'Post updates to LinkedIn', env: ['LINKEDIN_ACCESS_TOKEN'] },
    { name: 'linkedin-profile', description: 'Get LinkedIn profile information', env: ['LINKEDIN_ACCESS_TOKEN'] },
    { name: 'reddit-post', description: 'Post to Reddit subreddits', env: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'] },
    { name: 'reddit-search', description: 'Search Reddit posts and comments', env: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'] },
    { name: 'reddit-hot', description: 'Get hot posts from Reddit subreddits', env: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'] },
    { name: 'mastodon-post', description: 'Post toots to Mastodon instances', env: ['MASTODON_ACCESS_TOKEN'] },
    { name: 'mastodon-timeline', description: 'Read Mastodon home timeline', env: ['MASTODON_ACCESS_TOKEN'] },
    { name: 'bluesky-post', description: 'Post to Bluesky social network', env: ['BLUESKY_HANDLE', 'BLUESKY_PASSWORD'] },
    { name: 'instagram-media', description: 'List Instagram media posts', env: ['INSTAGRAM_ACCESS_TOKEN'] },
    { name: 'facebook-pages', description: 'Manage Facebook page posts', env: ['FACEBOOK_ACCESS_TOKEN'] },
    { name: 'hubspot-contacts', description: 'List and manage HubSpot contacts', env: ['HUBSPOT_API_KEY'] },
    { name: 'hubspot-deals', description: 'List and manage HubSpot deals', env: ['HUBSPOT_API_KEY'] },
    { name: 'hubspot-companies', description: 'List and manage HubSpot companies', env: ['HUBSPOT_API_KEY'] },
    { name: 'salesforce-leads', description: 'List and manage Salesforce leads', env: ['SALESFORCE_ACCESS_TOKEN'] },
    { name: 'salesforce-contacts', description: 'List and manage Salesforce contacts', env: ['SALESFORCE_ACCESS_TOKEN'] },
    { name: 'salesforce-opportunities', description: 'Manage Salesforce opportunities', env: ['SALESFORCE_ACCESS_TOKEN'] },
    { name: 'pipedrive-deals', description: 'List and manage Pipedrive deals', env: ['PIPEDRIVE_API_TOKEN'] },
    { name: 'freshdesk-tickets', description: 'List and manage Freshdesk tickets', env: ['FRESHDESK_API_KEY'] },
    { name: 'zendesk-tickets', description: 'List and manage Zendesk tickets', env: ['ZENDESK_API_TOKEN'] },
    { name: 'zendesk-users', description: 'List and manage Zendesk users', env: ['ZENDESK_API_TOKEN'] },
    { name: 'crisp-conversations', description: 'List Crisp chat conversations', env: ['CRISP_TOKEN'] },
    { name: 'drift-conversations', description: 'List Drift chat conversations', env: ['DRIFT_ACCESS_TOKEN'] },
    { name: 'tawk-messages', description: 'List tawk.to chat messages', env: ['TAWK_API_KEY'] },
    { name: 'buffer-schedule', description: 'Schedule social media posts via Buffer', env: ['BUFFER_ACCESS_TOKEN'] },
    { name: 'hootsuite-schedule', description: 'Schedule posts via Hootsuite', env: ['HOOTSUITE_TOKEN'] },
    { name: 'social-share-count', description: 'Get social share counts for URLs' },
    { name: 'hashtag-generator', description: 'Generate relevant hashtags for content' },
  ],

  // ── System Administration ───────────────────────────────────
  sysadmin: [
    { name: 'systemctl-status', description: 'Check systemd service status', bins: ['systemctl'] },
    { name: 'systemctl-restart', description: 'Restart systemd services', bins: ['systemctl'] },
    { name: 'journalctl-logs', description: 'Query systemd journal logs', bins: ['journalctl'] },
    { name: 'syslog-reader', description: 'Read and filter system log files', bins: ['grep'] },
    { name: 'top-processes', description: 'List top processes by resource usage', bins: ['ps'] },
    { name: 'kill-process', description: 'Kill processes by name or PID', bins: ['kill'] },
    { name: 'netstat-listen', description: 'List listening network ports', bins: ['netstat'] },
    { name: 'ss-connections', description: 'List active network connections', bins: ['ss'] },
    { name: 'iptables-list', description: 'List firewall rules', bins: ['iptables'] },
    { name: 'ufw-status', description: 'Check UFW firewall status', bins: ['ufw'] },
    { name: 'lsof-files', description: 'List open files and connections', bins: ['lsof'] },
    { name: 'strace-trace', description: 'Trace system calls for debugging', bins: ['strace'] },
    { name: 'htop-snapshot', description: 'Take htop process snapshot', bins: ['ps'] },
    { name: 'iotop-check', description: 'Check I/O usage by process', bins: ['ps'] },
    { name: 'swap-usage', description: 'Check swap memory usage details', bins: ['free'] },
    { name: 'load-average', description: 'Check system load averages', bins: ['uptime'] },
    { name: 'cpu-info', description: 'Get detailed CPU information', bins: ['uname'] },
    { name: 'disk-partitions', description: 'List disk partitions and mount points', bins: ['df'] },
    { name: 'mount-status', description: 'List current filesystem mounts', bins: ['mount'] },
    { name: 'user-list', description: 'List system user accounts', bins: ['cat'] },
    { name: 'group-list', description: 'List system user groups', bins: ['cat'] },
    { name: 'who-logged', description: 'List currently logged in users', bins: ['who'] },
    { name: 'last-logins', description: 'Show last login history', bins: ['last'] },
    { name: 'apt-list', description: 'List installed apt packages', bins: ['apt'] },
    { name: 'apt-search', description: 'Search for apt packages', bins: ['apt'] },
    { name: 'yum-list', description: 'List installed yum packages', bins: ['yum'] },
    { name: 'pacman-list', description: 'List installed pacman packages', bins: ['pacman'] },
    { name: 'snap-list', description: 'List installed snap packages', bins: ['snap'] },
    { name: 'flatpak-list', description: 'List installed flatpak applications', bins: ['flatpak'] },
    { name: 'brew-outdated', description: 'List outdated Homebrew packages', bins: ['brew'] },
  ],

  // ── Testing & QA ────────────────────────────────────────────
  testing: [
    { name: 'k6-load-test', description: 'Run load tests with k6', bins: ['k6'] },
    { name: 'artillery-test', description: 'Run load tests with Artillery', bins: ['npx'] },
    { name: 'ab-benchmark', description: 'Run Apache Benchmark HTTP tests', bins: ['ab'] },
    { name: 'wrk-benchmark', description: 'Run HTTP benchmarks with wrk', bins: ['wrk'] },
    { name: 'curl-timing', description: 'Measure HTTP request timing with curl', bins: ['curl'] },
    { name: 'http-status-check', description: 'Check HTTP status codes for URLs' },
    { name: 'broken-link-checker', description: 'Check for broken links on websites' },
    { name: 'accessibility-check', description: 'Check website accessibility compliance' },
    { name: 'html-validator', description: 'Validate HTML markup' },
    { name: 'css-validator', description: 'Validate CSS stylesheets' },
    { name: 'json-diff', description: 'Compare two JSON objects and show differences' },
    { name: 'api-mock-server', description: 'Start a mock API server for testing' },
    { name: 'fixture-generator', description: 'Generate test fixture data' },
    { name: 'snapshot-tester', description: 'Run snapshot tests on outputs' },
    { name: 'contract-tester', description: 'Test API contracts with schemas' },
    { name: 'fuzz-tester', description: 'Generate fuzz test inputs' },
    { name: 'mutation-tester', description: 'Run mutation testing on code', bins: ['npx'] },
    { name: 'visual-regression', description: 'Run visual regression tests', bins: ['npx'] },
    { name: 'browser-stack-test', description: 'Run tests on BrowserStack', env: ['BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY'] },
    { name: 'sauce-labs-test', description: 'Run tests on Sauce Labs', env: ['SAUCE_USERNAME', 'SAUCE_ACCESS_KEY'] },
  ],

  // ── Education & Learning ────────────────────────────────────
  education: [
    { name: 'flashcard-gen', description: 'Generate study flashcards from content' },
    { name: 'quiz-generator', description: 'Generate quiz questions from text' },
    { name: 'anki-deck-gen', description: 'Generate Anki flashcard deck files' },
    { name: 'reading-level', description: 'Analyze text reading level and complexity' },
    { name: 'word-definition', description: 'Look up word definitions and etymology' },
    { name: 'thesaurus-lookup', description: 'Find synonyms and antonyms for words' },
    { name: 'grammar-check', description: 'Check text for grammar errors' },
    { name: 'spell-checker', description: 'Check text for spelling errors' },
    { name: 'citation-formatter', description: 'Format citations in APA, MLA, etc.' },
    { name: 'bibliography-gen', description: 'Generate bibliography from references' },
    { name: 'abstract-writer', description: 'Generate abstracts for academic papers', env: ['OPENAI_API_KEY'] },
    { name: 'study-plan-gen', description: 'Generate study plans for topics', env: ['OPENAI_API_KEY'] },
    { name: 'mnemonic-gen', description: 'Generate mnemonics for memorization' },
    { name: 'math-solver', description: 'Solve mathematical equations step by step' },
    { name: 'statistics-calc', description: 'Calculate statistical measures for datasets' },
    { name: 'matrix-operations', description: 'Perform matrix math operations' },
    { name: 'polynomial-solver', description: 'Solve polynomial equations' },
    { name: 'probability-calc', description: 'Calculate probability and combinations' },
    { name: 'physics-formula', description: 'Look up and apply physics formulas' },
    { name: 'chemistry-balance', description: 'Balance chemical equations' },
  ],

  // ── Automation & Workflow ───────────────────────────────────
  automation: [
    { name: 'zapier-trigger', description: 'Trigger Zapier webhook automations', env: ['ZAPIER_WEBHOOK_URL'] },
    { name: 'ifttt-trigger', description: 'Trigger IFTTT webhook events', env: ['IFTTT_WEBHOOK_KEY'] },
    { name: 'make-scenario', description: 'Trigger Make.com scenario webhooks', env: ['MAKE_WEBHOOK_URL'] },
    { name: 'n8n-workflow', description: 'Trigger n8n workflow webhooks', env: ['N8N_WEBHOOK_URL'] },
    { name: 'pipedream-trigger', description: 'Trigger Pipedream workflow events', env: ['PIPEDREAM_TOKEN'] },
    { name: 'temporal-workflow', description: 'Start Temporal workflow executions', env: ['TEMPORAL_ADDRESS'] },
    { name: 'airflow-dag-trigger', description: 'Trigger Apache Airflow DAG runs', env: ['AIRFLOW_URL'] },
    { name: 'prefect-flow', description: 'Trigger Prefect flow runs', env: ['PREFECT_API_KEY'] },
    { name: 'cron-job-checker', description: 'Verify cron job schedules and next runs' },
    { name: 'webhook-tester', description: 'Test webhook endpoints and payloads' },
    { name: 'retry-handler', description: 'Execute HTTP requests with retry logic' },
    { name: 'batch-processor', description: 'Process items in parallel batches' },
    { name: 'queue-monitor', description: 'Monitor message queue depth and health' },
    { name: 'schedule-calculator', description: 'Calculate recurring schedule dates' },
    { name: 'workflow-diagram', description: 'Generate workflow diagrams in text' },
    { name: 'state-machine-gen', description: 'Generate state machine definitions' },
    { name: 'event-schema-gen', description: 'Generate event schema definitions' },
    { name: 'api-client-gen', description: 'Generate API client code from specs', env: ['OPENAI_API_KEY'] },
    { name: 'openapi-validate', description: 'Validate OpenAPI specification files' },
    { name: 'graphql-schema-gen', description: 'Generate GraphQL schemas from types' },
  ],

  // ── Design & UX ─────────────────────────────────────────────
  design: [
    { name: 'figma-files', description: 'List Figma design files', env: ['FIGMA_TOKEN'] },
    { name: 'figma-components', description: 'List Figma component library', env: ['FIGMA_TOKEN'] },
    { name: 'figma-comments', description: 'List comments on Figma designs', env: ['FIGMA_TOKEN'] },
    { name: 'dribbble-shots', description: 'Search Dribbble design shots', env: ['DRIBBBLE_TOKEN'] },
    { name: 'icon-search', description: 'Search icons across icon libraries' },
    { name: 'font-search', description: 'Search for web fonts by name or style' },
    { name: 'color-contrast', description: 'Check color contrast accessibility ratios' },
    { name: 'responsive-check', description: 'Check responsive breakpoints for URLs' },
    { name: 'css-grid-gen', description: 'Generate CSS Grid layout code' },
    { name: 'flexbox-gen', description: 'Generate CSS Flexbox layout code' },
    { name: 'box-shadow-gen', description: 'Generate CSS box-shadow values' },
    { name: 'border-radius-gen', description: 'Generate CSS border-radius values' },
    { name: 'animation-gen', description: 'Generate CSS animation keyframes' },
    { name: 'transition-gen', description: 'Generate CSS transition properties' },
    { name: 'media-query-gen', description: 'Generate CSS media queries' },
    { name: 'wireframe-gen', description: 'Generate ASCII wireframe layouts' },
    { name: 'component-spec-gen', description: 'Generate component specification docs' },
    { name: 'design-token-gen', description: 'Generate design token JSON files' },
    { name: 'spacing-scale-gen', description: 'Generate spacing scale systems' },
    { name: 'typography-scale-gen', description: 'Generate typography scale systems' },
  ],

  // ── Miscellaneous ───────────────────────────────────────────
  misc: [
    { name: 'country-info', description: 'Get country information and facts' },
    { name: 'language-detect', description: 'Detect language of text content' },
    { name: 'barcode-generator', description: 'Generate barcodes from data' },
    { name: 'ean-validator', description: 'Validate EAN product barcodes' },
    { name: 'isbn-validator', description: 'Validate ISBN book numbers' },
    { name: 'iban-validator', description: 'Validate IBAN bank account numbers' },
    { name: 'vat-validator', description: 'Validate European VAT numbers' },
    { name: 'credit-card-validator', description: 'Validate credit card number formats' },
    { name: 'phone-validator', description: 'Validate international phone numbers' },
    { name: 'email-validator', description: 'Validate email address formats' },
    { name: 'domain-validator', description: 'Validate domain name formats' },
    { name: 'ip-validator', description: 'Validate IPv4 and IPv6 addresses' },
    { name: 'semver-validator', description: 'Validate semantic version strings' },
    { name: 'url-validator', description: 'Validate URL format and reachability' },
    { name: 'ascii-table', description: 'Display ASCII character reference table' },
    { name: 'periodic-table', description: 'Look up periodic table elements' },
    { name: 'unit-constants', description: 'Look up physical constants and units' },
    { name: 'dice-roller', description: 'Roll dice with standard RPG notation' },
    { name: 'coin-flipper', description: 'Flip coins with fair randomness' },
    { name: 'countdown-timer', description: 'Create countdown timers to dates' },
  ],
};

// ─── Helper Functions ───────────────────────────────────────────────────────

/** Get all existing skill names from the top 100 list to avoid duplicates. */
function getExistingSkillNames(): Set<string> {
  const top100Path = join(__dirname, 'skill-list-top100.json');
  if (!existsSync(top100Path)) return new Set();
  const top100 = JSON.parse(readFileSync(top100Path, 'utf-8')) as SkillEntry[];
  return new Set(top100.map(s => s.name));
}

/** Generate a SKILL.md content string from a skill entry. */
function generateSkillMd(entry: SkillEntry): string {
  const requires: string[] = [];
  if (entry.env && entry.env.length > 0) {
    requires.push(`      env: [${entry.env.join(', ')}]`);
  }
  if (entry.bins && entry.bins.length > 0) {
    requires.push(`      bins: [${entry.bins.join(', ')}]`);
  }

  const requiresBlock = requires.length > 0
    ? `\n    requires:\n${requires.join('\n')}`
    : '';

  return `---
name: ${entry.name}
description: ${entry.description}
version: 1.0.0
metadata:
  openclaw:${requiresBlock}
    emoji: "⚡"
---
# ${entry.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}

${entry.description}.

## Category
${entry.category}
`;
}

/** Load supplemental skill list from JSON file. */
function loadSupplementalSkills(): SkillEntry[] {
  const supplementalPath = join(__dirname, 'skill-list-supplemental.json');
  if (!existsSync(supplementalPath)) return [];
  return JSON.parse(readFileSync(supplementalPath, 'utf-8')) as SkillEntry[];
}

/** Build the full skill list (101-1000) by flattening templates, supplemental list, and deduping. */
export function buildExtendedSkillList(): SkillEntry[] {
  const existing = getExistingSkillNames();
  const skills: SkillEntry[] = [];
  const seen = new Set<string>();

  for (const [category, templates] of Object.entries(SKILL_TEMPLATES)) {
    for (const template of templates) {
      if (existing.has(template.name) || seen.has(template.name)) continue;
      seen.add(template.name);
      skills.push({ ...template, category });
    }
  }

  // Add supplemental skills
  for (const entry of loadSupplementalSkills()) {
    if (existing.has(entry.name) || seen.has(entry.name)) continue;
    seen.add(entry.name);
    skills.push(entry);
  }

  return skills;
}

/**
 * Generate extended community waves from skills 101-1000.
 * Skips any skill names that already exist as directories in the output.
 *
 * @param outputDir - Base output directory for wave directories.
 * @returns Generation result with counts.
 */
export function generateExtended(outputDir: string): {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
} {
  const skillList = buildExtendedSkillList();

  // Check which waves already exist
  const existingDirs = new Set<string>();
  if (existsSync(outputDir)) {
    for (const entry of readdirSync(outputDir)) {
      existingDirs.add(entry);
    }
  }

  // Filter out already-generated waves
  const newSkills = skillList.filter(s => !existingDirs.has(s.name));
  const skipped = skillList.length - newSkills.length;

  const skills = newSkills.map((entry) => ({
    name: entry.name,
    content: generateSkillMd(entry),
  }));

  const result = convertFromContents(skills, outputDir, 'clawhub-community');

  return {
    total: result.total + skipped,
    succeeded: result.succeeded + skipped,
    failed: result.failed,
    skipped,
  };
}

/**
 * Build categories.json from all wave directories.
 *
 * @param wavesDir - The waves/community directory.
 * @returns Category map.
 */
export function buildCategoriesJson(wavesDir: string): Record<string, string[]> {
  const categories: Record<string, string[]> = {};

  if (!existsSync(wavesDir)) return categories;

  for (const entry of readdirSync(wavesDir)) {
    const manifestPath = join(wavesDir, entry, 'wave.json');
    if (!existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      const category = manifest.category || 'uncategorized';
      if (!categories[category]) categories[category] = [];
      categories[category].push(manifest.name);
    } catch {
      // Skip invalid manifests
    }
  }

  // Sort categories and names
  const sorted: Record<string, string[]> = {};
  for (const key of Object.keys(categories).sort()) {
    sorted[key] = categories[key].sort();
  }

  return sorted;
}

/**
 * Build a port report from all wave directories.
 *
 * @param wavesDir - The waves/community directory.
 * @returns Port report data.
 */
export function buildPortReport(wavesDir: string): {
  totalWaves: number;
  byCategory: Record<string, number>;
  bySafetyTier: Record<string, number>;
  byMinTier: Record<string, number>;
  apiOnly: number;
  shellBased: number;
  noExternal: number;
} {
  const report = {
    totalWaves: 0,
    byCategory: {} as Record<string, number>,
    bySafetyTier: {} as Record<string, number>,
    byMinTier: {} as Record<string, number>,
    apiOnly: 0,
    shellBased: 0,
    noExternal: 0,
  };

  if (!existsSync(wavesDir)) return report;

  for (const entry of readdirSync(wavesDir)) {
    const manifestPath = join(wavesDir, entry, 'wave.json');
    if (!existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      report.totalWaves++;

      const category = manifest.category || 'uncategorized';
      report.byCategory[category] = (report.byCategory[category] || 0) + 1;

      const safetyTier = manifest.safetyTier || 'observe';
      report.bySafetyTier[safetyTier] = (report.bySafetyTier[safetyTier] || 0) + 1;

      const minTier = manifest.minTier || 'basic';
      report.byMinTier[minTier] = (report.byMinTier[minTier] || 0) + 1;

      const domains = manifest.permissions?.domains || [];
      const shell = manifest.permissions?.shell || [];

      if (domains.length > 0 && shell.length === 0) report.apiOnly++;
      else if (shell.length > 0) report.shellBased++;
      else report.noExternal++;
    } catch {
      // Skip invalid manifests
    }
  }

  return report;
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────

if (process.argv[1] === __filename) {
  const projectRoot = join(__dirname, '../..');
  const outputDir = join(projectRoot, 'waves/community');
  mkdirSync(outputDir, { recursive: true });

  console.log('Generating extended community waves (101-1000)...');
  const result = generateExtended(outputDir);
  console.log(`Waves: ${result.succeeded}/${result.total} succeeded, ${result.failed} failed, ${result.skipped} skipped (already existed)`);

  // Build categories.json
  const categories = buildCategoriesJson(outputDir);
  writeFileSync(
    join(outputDir, 'categories.json'),
    JSON.stringify(categories, null, 2) + '\n',
  );
  const totalCategorized = Object.values(categories).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`Categories: ${Object.keys(categories).length} categories, ${totalCategorized} waves total`);

  // Build port report
  const report = buildPortReport(outputDir);
  writeFileSync(
    join(__dirname, 'wave-port-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(`Port report: ${report.totalWaves} total waves`);
  console.log(`  API-only: ${report.apiOnly}, Shell: ${report.shellBased}, No external: ${report.noExternal}`);
}
