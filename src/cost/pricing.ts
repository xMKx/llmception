/** Pricing per 1k tokens (USD) for known models. */
export const MODEL_PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  "claude-sonnet-4-20250514": { inputPer1k: 0.003, outputPer1k: 0.015 },
  "claude-opus-4-20250514": { inputPer1k: 0.015, outputPer1k: 0.075 },
  "claude-haiku-4-5-20251001": { inputPer1k: 0.001, outputPer1k: 0.005 },
  "gpt-4o": { inputPer1k: 0.0025, outputPer1k: 0.01 },
  "gpt-4o-mini": { inputPer1k: 0.00015, outputPer1k: 0.0006 },
};

/**
 * Estimate cost in USD for a given model and token counts.
 * Returns 0 for unknown models.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1000) * pricing.inputPer1k + (outputTokens / 1000) * pricing.outputPer1k;
}
