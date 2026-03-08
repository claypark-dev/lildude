/**
 * Known ClawHub env var → lildude config mappings.
 * Maps common ClawHub environment variable names to their
 * lildude equivalent config paths or descriptions.
 */

export interface EnvVarMapping {
  /** The lildude config path (e.g., 'providers.openai.apiKey'). */
  configPath?: string;
  /** Human-readable description of the env var. */
  description: string;
  /** The domain this env var is for (for permissions.domains). */
  domain?: string;
  /** Category for organizing skills. */
  category?: string;
}

/** Known env var mappings from ClawHub to lildude. */
export const ENV_VAR_MAPPINGS: Record<string, EnvVarMapping> = {
  // Search / Web
  TAVILY_API_KEY: {
    description: 'Tavily search API key',
    domain: 'api.tavily.com',
    category: 'utilities',
  },
  SERPER_API_KEY: {
    description: 'Serper.dev Google search API key',
    domain: 'google.serper.dev',
    category: 'utilities',
  },
  GOOGLE_API_KEY: {
    description: 'Google API key',
    domain: 'googleapis.com',
    category: 'utilities',
  },
  GOOGLE_CSE_ID: {
    description: 'Google Custom Search Engine ID',
    domain: 'googleapis.com',
    category: 'utilities',
  },

  // AI / LLM
  OPENAI_API_KEY: {
    configPath: 'providers.openai.apiKey',
    description: 'OpenAI API key',
    domain: 'api.openai.com',
    category: 'ai',
  },
  ANTHROPIC_API_KEY: {
    configPath: 'providers.anthropic.apiKey',
    description: 'Anthropic API key',
    domain: 'api.anthropic.com',
    category: 'ai',
  },
  GROQ_API_KEY: {
    description: 'Groq API key',
    domain: 'api.groq.com',
    category: 'ai',
  },
  REPLICATE_API_TOKEN: {
    description: 'Replicate API token',
    domain: 'api.replicate.com',
    category: 'ai',
  },

  // Communication
  SLACK_BOT_TOKEN: {
    description: 'Slack bot OAuth token',
    domain: 'slack.com',
    category: 'communication',
  },
  SLACK_WEBHOOK_URL: {
    description: 'Slack incoming webhook URL',
    domain: 'hooks.slack.com',
    category: 'communication',
  },
  DISCORD_BOT_TOKEN: {
    description: 'Discord bot token',
    domain: 'discord.com',
    category: 'communication',
  },
  TELEGRAM_BOT_TOKEN: {
    description: 'Telegram bot token',
    domain: 'api.telegram.org',
    category: 'communication',
  },
  TWILIO_ACCOUNT_SID: {
    description: 'Twilio account SID',
    domain: 'api.twilio.com',
    category: 'communication',
  },
  TWILIO_AUTH_TOKEN: {
    description: 'Twilio auth token',
    domain: 'api.twilio.com',
    category: 'communication',
  },
  SENDGRID_API_KEY: {
    description: 'SendGrid email API key',
    domain: 'api.sendgrid.com',
    category: 'communication',
  },

  // Code & DevOps
  GITHUB_TOKEN: {
    description: 'GitHub personal access token',
    domain: 'api.github.com',
    category: 'development',
  },
  GITHUB_API_TOKEN: {
    description: 'GitHub API token',
    domain: 'api.github.com',
    category: 'development',
  },
  GITLAB_TOKEN: {
    description: 'GitLab API token',
    domain: 'gitlab.com',
    category: 'development',
  },
  JIRA_API_TOKEN: {
    description: 'Jira API token',
    domain: 'atlassian.net',
    category: 'development',
  },
  LINEAR_API_KEY: {
    description: 'Linear API key',
    domain: 'api.linear.app',
    category: 'development',
  },

  // Data & Storage
  AWS_ACCESS_KEY_ID: {
    description: 'AWS access key ID',
    domain: 'amazonaws.com',
    category: 'cloud',
  },
  AWS_SECRET_ACCESS_KEY: {
    description: 'AWS secret access key',
    domain: 'amazonaws.com',
    category: 'cloud',
  },
  SUPABASE_URL: {
    description: 'Supabase project URL',
    category: 'data',
  },
  SUPABASE_KEY: {
    description: 'Supabase API key',
    category: 'data',
  },
  FIREBASE_API_KEY: {
    description: 'Firebase API key',
    domain: 'firebaseio.com',
    category: 'data',
  },

  // Weather & Location
  OPENWEATHER_API_KEY: {
    description: 'OpenWeatherMap API key',
    domain: 'api.openweathermap.org',
    category: 'utilities',
  },
  WEATHERAPI_KEY: {
    description: 'WeatherAPI key',
    domain: 'api.weatherapi.com',
    category: 'utilities',
  },

  // Finance
  ALPHA_VANTAGE_API_KEY: {
    description: 'Alpha Vantage stock data API key',
    domain: 'www.alphavantage.co',
    category: 'finance',
  },
  COINMARKETCAP_API_KEY: {
    description: 'CoinMarketCap API key',
    domain: 'pro-api.coinmarketcap.com',
    category: 'finance',
  },

  // Media
  SPOTIFY_CLIENT_ID: {
    description: 'Spotify client ID',
    domain: 'api.spotify.com',
    category: 'media',
  },
  SPOTIFY_CLIENT_SECRET: {
    description: 'Spotify client secret',
    domain: 'api.spotify.com',
    category: 'media',
  },
  YOUTUBE_API_KEY: {
    description: 'YouTube Data API key',
    domain: 'www.googleapis.com',
    category: 'media',
  },

  // Misc
  NOTION_API_KEY: {
    description: 'Notion API key',
    domain: 'api.notion.com',
    category: 'productivity',
  },
  AIRTABLE_API_KEY: {
    description: 'Airtable API key',
    domain: 'api.airtable.com',
    category: 'productivity',
  },
};

/**
 * Look up domains for a list of environment variables.
 */
export function getDomainsForEnvVars(envVars: string[]): string[] {
  const domains = new Set<string>();
  for (const envVar of envVars) {
    const mapping = ENV_VAR_MAPPINGS[envVar];
    if (mapping?.domain) {
      domains.add(mapping.domain);
    }
  }
  return Array.from(domains);
}

/**
 * Infer category from environment variables.
 */
export function inferCategory(envVars: string[]): string {
  const categories: Record<string, number> = {};
  for (const envVar of envVars) {
    const mapping = ENV_VAR_MAPPINGS[envVar];
    if (mapping?.category) {
      categories[mapping.category] = (categories[mapping.category] ?? 0) + 1;
    }
  }

  let best = 'utilities';
  let bestCount = 0;
  for (const [cat, count] of Object.entries(categories)) {
    if (count > bestCount) {
      best = cat;
      bestCount = count;
    }
  }
  return best;
}
