import { describe, it, expect } from "vitest";
import { MODEL_PRICING, estimateCost } from "../../../src/cost/pricing.js";

describe("MODEL_PRICING", () => {
  it("should have pricing for claude-sonnet-4-20250514", () => {
    const p = MODEL_PRICING["claude-sonnet-4-20250514"];
    expect(p).toBeDefined();
    expect(p.inputPer1k).toBeGreaterThan(0);
    expect(p.outputPer1k).toBeGreaterThan(0);
  });

  it("should have pricing for claude-opus-4-20250514", () => {
    const p = MODEL_PRICING["claude-opus-4-20250514"];
    expect(p).toBeDefined();
    expect(p.inputPer1k).toBeGreaterThan(0);
    expect(p.outputPer1k).toBeGreaterThan(0);
  });

  it("should have pricing for claude-haiku-4-5-20251001", () => {
    const p = MODEL_PRICING["claude-haiku-4-5-20251001"];
    expect(p).toBeDefined();
    expect(p.inputPer1k).toBeGreaterThan(0);
    expect(p.outputPer1k).toBeGreaterThan(0);
  });

  it("should have pricing for gpt-4o", () => {
    const p = MODEL_PRICING["gpt-4o"];
    expect(p).toBeDefined();
    expect(p.inputPer1k).toBeGreaterThan(0);
    expect(p.outputPer1k).toBeGreaterThan(0);
  });

  it("should have pricing for gpt-4o-mini", () => {
    const p = MODEL_PRICING["gpt-4o-mini"];
    expect(p).toBeDefined();
    expect(p.inputPer1k).toBeGreaterThan(0);
    expect(p.outputPer1k).toBeGreaterThan(0);
  });
});

describe("estimateCost", () => {
  it("should calculate cost correctly for a known model", () => {
    // claude-sonnet-4: $0.003/1k input, $0.015/1k output
    const cost = estimateCost("claude-sonnet-4-20250514", 1000, 1000);
    expect(cost).toBeCloseTo(0.003 + 0.015, 6);
  });

  it("should handle zero tokens", () => {
    const cost = estimateCost("claude-sonnet-4-20250514", 0, 0);
    expect(cost).toBe(0);
  });

  it("should scale linearly with token count", () => {
    const cost1k = estimateCost("claude-sonnet-4-20250514", 1000, 0);
    const cost10k = estimateCost("claude-sonnet-4-20250514", 10000, 0);
    expect(cost10k).toBeCloseTo(cost1k * 10, 10);
  });

  it("should return 0 for an unknown model", () => {
    const cost = estimateCost("unknown-model-xyz", 5000, 3000);
    expect(cost).toBe(0);
  });

  it("should calculate mixed input/output cost for gpt-4o", () => {
    // gpt-4o: $0.0025/1k input, $0.01/1k output
    const cost = estimateCost("gpt-4o", 2000, 500);
    const expected = (2000 / 1000) * 0.0025 + (500 / 1000) * 0.01;
    expect(cost).toBeCloseTo(expected, 10);
  });
});
