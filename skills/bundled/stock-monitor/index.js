/**
 * Stock Monitor Skill — check stock prices and set price alerts.
 * DETERMINISTIC: no LLM calls needed for execution.
 * Uses Yahoo Finance API for real-time price data.
 *
 * Exports: plan, execute, validate
 */

// ── Zod-like validation (inline, no TS dependency) ──────────────────────────

/**
 * Validate that a stock symbol is a non-empty uppercase string.
 * @param {unknown} symbol - The symbol to validate.
 * @returns {{ valid: boolean, value?: string, error?: string }}
 */
function validateSymbol(symbol) {
  if (typeof symbol !== 'string' || symbol.trim().length === 0) {
    return { valid: false, error: 'Stock symbol must be a non-empty string' };
  }
  const cleaned = symbol.trim().toUpperCase();
  if (!/^[A-Z.]{1,10}$/.test(cleaned)) {
    return { valid: false, error: `Invalid stock symbol: "${cleaned}"` };
  }
  return { valid: true, value: cleaned };
}

/**
 * Validate that a price is a positive number.
 * @param {unknown} price - The price to validate.
 * @returns {{ valid: boolean, value?: number, error?: string }}
 */
function validatePrice(price) {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (typeof num !== 'number' || isNaN(num) || num <= 0) {
    return { valid: false, error: 'Price must be a positive number' };
  }
  return { valid: true, value: num };
}

/**
 * Validate alert condition string.
 * @param {unknown} condition - The condition to validate.
 * @returns {{ valid: boolean, value?: string, error?: string }}
 */
function validateCondition(condition) {
  if (typeof condition !== 'string') {
    return { valid: false, error: 'Condition must be a string' };
  }
  const normalized = condition.trim().toLowerCase();
  const validConditions = ['above', 'below', 'crosses_above', 'crosses_below'];
  if (!validConditions.includes(normalized)) {
    return { valid: false, error: `Condition must be one of: ${validConditions.join(', ')}` };
  }
  return { valid: true, value: normalized };
}

// ── Intent detection ────────────────────────────────────────────────────────

/**
 * Detect whether user input is a check_stock or set_alert intent.
 * @param {Record<string, unknown>} params - Extracted params from LLM.
 * @returns {'check_stock' | 'set_alert'}
 */
function detectIntent(params) {
  if (params.condition || params.price || params.alert) {
    return 'set_alert';
  }
  return 'check_stock';
}

/**
 * Extract one or more stock symbols from params.
 * Supports "symbol" (single) or "symbols" (comma-separated or array).
 * @param {Record<string, unknown>} params - Extracted params.
 * @returns {string[]}
 */
function extractSymbols(params) {
  const raw = params.symbol || params.symbols || params.ticker || params.tickers;
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw
      .map((s) => validateSymbol(s))
      .filter((r) => r.valid)
      .map((r) => /** @type {string} */ (r.value));
  }

  if (typeof raw === 'string') {
    return raw
      .split(/[,\s]+/)
      .map((s) => validateSymbol(s))
      .filter((r) => r.valid)
      .map((r) => /** @type {string} */ (r.value));
  }

  return [];
}

// ── Yahoo Finance fetch ─────────────────────────────────────────────────────

/** @typedef {{ symbol: string, price: number, previousClose: number, change: number, changePercent: number, currency: string, marketState: string }} StockQuote */

/**
 * Fetch stock quote from Yahoo Finance API.
 * @param {string} symbol - The stock symbol (e.g., "AAPL").
 * @returns {Promise<StockQuote>}
 */
async function fetchStockQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'lil-dude/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance API returned ${response.status} for ${symbol}`);
  }

  const data = /** @type {unknown} */ (await response.json());

  if (
    typeof data !== 'object' ||
    data === null ||
    !('chart' in data)
  ) {
    throw new Error(`Unexpected response structure for ${symbol}`);
  }

  const chart = /** @type {Record<string, unknown>} */ (data).chart;
  if (
    typeof chart !== 'object' ||
    chart === null ||
    !('result' in chart)
  ) {
    throw new Error(`Missing chart.result for ${symbol}`);
  }

  const chartObj = /** @type {Record<string, unknown>} */ (chart);
  const resultArray = chartObj.result;

  if (!Array.isArray(resultArray) || resultArray.length === 0) {
    const errorObj = /** @type {Record<string, unknown>} */ (chartObj);
    if (errorObj.error) {
      const errDetail = /** @type {Record<string, unknown>} */ (errorObj.error);
      throw new Error(`Yahoo Finance error for ${symbol}: ${errDetail.description || 'Unknown error'}`);
    }
    throw new Error(`No data found for symbol: ${symbol}`);
  }

  const result = /** @type {Record<string, unknown>} */ (resultArray[0]);
  const meta = /** @type {Record<string, unknown>} */ (result.meta);

  if (!meta || typeof meta !== 'object') {
    throw new Error(`Missing meta data for ${symbol}`);
  }

  const regularMarketPrice = typeof meta.regularMarketPrice === 'number'
    ? meta.regularMarketPrice
    : 0;
  const previousClose = typeof meta.chartPreviousClose === 'number'
    ? meta.chartPreviousClose
    : typeof meta.previousClose === 'number'
      ? meta.previousClose
      : regularMarketPrice;
  const currency = typeof meta.currency === 'string' ? meta.currency : 'USD';
  const marketState = typeof meta.marketState === 'string' ? meta.marketState : 'UNKNOWN';

  const change = regularMarketPrice - previousClose;
  const changePercent = previousClose > 0
    ? (change / previousClose) * 100
    : 0;

  return {
    symbol: symbol.toUpperCase(),
    price: regularMarketPrice,
    previousClose,
    change,
    changePercent,
    currency,
    marketState,
  };
}

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * Format a stock quote into a human-readable string.
 * Uses template strings with up/down arrows. NO LLM call for formatting.
 * @param {StockQuote} quote - The stock quote data.
 * @returns {string}
 */
function formatQuote(quote) {
  const arrow = quote.change >= 0 ? '\u25B2' : '\u25BC';
  const sign = quote.change >= 0 ? '+' : '';
  const priceStr = quote.price.toFixed(2);
  const changeStr = `${sign}${quote.change.toFixed(2)}`;
  const percentStr = `${sign}${quote.changePercent.toFixed(2)}%`;

  return `${quote.symbol}: $${priceStr} ${arrow} ${changeStr} (${percentStr})`;
}

// ── Skill exports ───────────────────────────────────────────────────────────

/**
 * Plan the skill execution by parsing extracted params.
 * For a deterministic skill, the executor calls this only as a fallback;
 * normally the executor extracts params via LLM and calls execute() directly.
 *
 * @param {string} userInput - The raw user message.
 * @param {Record<string, unknown>} _context - Conversation context (unused).
 * @returns {Promise<import('../../../src/types/index.js').SkillPlan>}
 */
export async function plan(userInput, _context) {
  const lowerInput = userInput.toLowerCase();

  /** @type {Record<string, unknown>} */
  const extractedParams = {};

  // Simple regex-based extraction for common patterns
  const symbolMatch = userInput.match(/\b([A-Z]{1,5})\b/g);
  if (symbolMatch) {
    extractedParams.symbol = symbolMatch.length === 1
      ? symbolMatch[0]
      : symbolMatch.join(',');
  }

  // Detect alert intent
  const alertMatch = lowerInput.match(
    /(?:alert|notify|tell me).*(?:if|when).*(?:drops?|falls?|goes?\s+below|below|under)\s+\$?([\d.]+)/,
  );
  const alertAboveMatch = lowerInput.match(
    /(?:alert|notify|tell me).*(?:if|when).*(?:rises?|goes?\s+above|above|over|exceeds?)\s+\$?([\d.]+)/,
  );

  if (alertMatch) {
    extractedParams.condition = 'below';
    extractedParams.price = parseFloat(alertMatch[1]);
  } else if (alertAboveMatch) {
    extractedParams.condition = 'above';
    extractedParams.price = parseFloat(alertAboveMatch[1]);
  }

  const intent = detectIntent(extractedParams);

  return {
    steps: [
      {
        type: 'api_call',
        description: intent === 'check_stock'
          ? 'Fetch current stock price from Yahoo Finance'
          : 'Set up price alert with cron job',
        params: extractedParams,
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams,
  };
}

/**
 * Execute the stock monitor skill.
 * Routes to check_stock or set_alert based on extracted params.
 *
 * @param {import('../../../src/types/index.js').SkillPlan} skillPlan - The execution plan.
 * @returns {Promise<import('../../../src/types/index.js').ToolResult>}
 */
export async function execute(skillPlan) {
  const params = skillPlan.extractedParams;
  const intent = detectIntent(params);

  try {
    if (intent === 'set_alert') {
      return await executeSetAlert(params);
    }
    return await executeCheckStock(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: `Failed to ${intent === 'set_alert' ? 'set alert' : 'check stock'}: ${message}`,
      error: message,
    };
  }
}

/**
 * Check one or more stock prices.
 * @param {Record<string, unknown>} params - Must include symbol or symbols.
 * @returns {Promise<import('../../../src/types/index.js').ToolResult>}
 */
async function executeCheckStock(params) {
  const symbols = extractSymbols(params);

  if (symbols.length === 0) {
    return {
      success: false,
      output: 'No valid stock symbol provided. Please specify a ticker symbol (e.g., AAPL, MSFT).',
      error: 'missing_symbol',
    };
  }

  /** @type {string[]} */
  const lines = [];
  /** @type {StockQuote[]} */
  const quotes = [];
  /** @type {string[]} */
  const errors = [];

  for (const symbol of symbols) {
    try {
      const quote = await fetchStockQuote(symbol);
      quotes.push(quote);
      lines.push(formatQuote(quote));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${symbol}: ${message}`);
    }
  }

  if (quotes.length === 0) {
    return {
      success: false,
      output: `Failed to fetch stock data:\n${errors.join('\n')}`,
      error: errors.join('; '),
    };
  }

  const output = lines.join('\n');
  const hasErrors = errors.length > 0;

  return {
    success: true,
    output: hasErrors ? `${output}\n\nErrors:\n${errors.join('\n')}` : output,
    metadata: {
      quotes,
      symbols,
      fetchedAt: new Date().toISOString(),
    },
  };
}

/**
 * Set a price alert by creating a cron job.
 * The cron job checks every 30 minutes.
 * @param {Record<string, unknown>} params - Must include symbol, condition, price.
 * @returns {Promise<import('../../../src/types/index.js').ToolResult>}
 */
async function executeSetAlert(params) {
  const symbols = extractSymbols(params);

  if (symbols.length === 0) {
    return {
      success: false,
      output: 'No valid stock symbol provided for alert.',
      error: 'missing_symbol',
    };
  }

  const symbol = symbols[0];
  const conditionResult = validateCondition(params.condition || 'below');
  if (!conditionResult.valid) {
    return {
      success: false,
      output: conditionResult.error || 'Invalid condition',
      error: 'invalid_condition',
    };
  }

  const priceResult = validatePrice(params.price);
  if (!priceResult.valid) {
    return {
      success: false,
      output: priceResult.error || 'Invalid price',
      error: 'invalid_price',
    };
  }

  const condition = /** @type {string} */ (conditionResult.value);
  const targetPrice = /** @type {number} */ (priceResult.value);
  const conditionLabel = condition === 'below' || condition === 'crosses_below'
    ? 'drops below'
    : 'rises above';

  // Return metadata signaling that a cron job should be created.
  // The orchestrator or caller creates the actual cron job via the persistence layer.
  return {
    success: true,
    output: `Price alert set: notify when ${symbol} ${conditionLabel} $${targetPrice.toFixed(2)}. Checking every 30 minutes.`,
    metadata: {
      action: 'create_cron_job',
      cronSchedule: '*/30 * * * *',
      symbol,
      condition,
      targetPrice,
      taskDescription: `Stock alert: ${symbol} ${conditionLabel} $${targetPrice.toFixed(2)}`,
      skillId: 'stock-monitor',
      usesAi: false,
      estimatedCostPerRun: 0,
    },
  };
}

/**
 * Validate the execution result.
 * Checks that the output contains at least one stock symbol and a price (for check_stock)
 * or a confirmation message (for set_alert).
 *
 * @param {import('../../../src/types/index.js').ToolResult} result - The execution result.
 * @returns {Promise<{ valid: boolean, feedback?: string }>}
 */
export async function validate(result) {
  if (!result.success) {
    return { valid: true }; // Errors are already handled; don't double-flag
  }

  const output = result.output;

  // Alert confirmation
  if (output.includes('Price alert set')) {
    return { valid: true };
  }

  // Stock quote: must contain a symbol pattern and a dollar amount
  const hasSymbol = /\b[A-Z]{1,5}\b/.test(output);
  const hasPrice = /\$\d+\.\d{2}/.test(output);

  if (!hasSymbol || !hasPrice) {
    return {
      valid: false,
      feedback: 'Output missing expected stock symbol or price format',
    };
  }

  return { valid: true };
}
