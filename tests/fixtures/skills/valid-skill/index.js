/**
 * Test skill implementation for stock-checker.
 * Provides minimal plan/execute functions for testing the loader.
 */

export async function plan(userInput, context) {
  return {
    steps: [
      {
        type: 'api_call',
        description: 'Fetch stock price',
        params: { ticker: 'AAPL', input: userInput },
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: { ticker: 'AAPL', context },
  };
}

export async function execute(skillPlan) {
  return {
    success: true,
    output: `Executed ${skillPlan.steps.length} step(s)`,
  };
}

export async function validate(result) {
  return {
    valid: result.success,
    feedback: result.success ? undefined : 'Execution failed',
  };
}
