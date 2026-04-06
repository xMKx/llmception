import { describe, it, expect } from "vitest";
import { buildOverrides } from "../../../src/commands/explore.js";

describe("buildOverrides", () => {
  it("should return empty object for no options", () => {
    const overrides = buildOverrides({});
    expect(overrides).toEqual({});
  });

  it("should parse depth as integer", () => {
    const overrides = buildOverrides({ depth: "5" });
    expect(overrides.maxDepth).toBe(5);
  });

  it("should parse width as integer", () => {
    const overrides = buildOverrides({ width: "3" });
    expect(overrides.maxWidth).toBe(3);
  });

  it("should parse budget as float and set budget config", () => {
    const overrides = buildOverrides({ budget: "10.50" });
    expect(overrides.budget).toEqual({
      totalUsd: 10.5,
      perBranchUsd: 10.5,
      mode: "hard",
    });
  });

  it("should set model string directly", () => {
    const overrides = buildOverrides({ model: "opus" });
    expect(overrides.model).toBe("opus");
  });

  it("should set provider string directly", () => {
    const overrides = buildOverrides({ provider: "openai" });
    expect(overrides.provider).toBe("openai");
  });

  it("should parse concurrency as integer", () => {
    const overrides = buildOverrides({ concurrency: "8" });
    expect(overrides.concurrency).toBe(8);
  });

  it("should parse nodeBudget as integer", () => {
    const overrides = buildOverrides({ nodeBudget: "50" });
    expect(overrides.nodeBudget).toBe(50);
  });

  it("should handle all options at once", () => {
    const overrides = buildOverrides({
      depth: "4",
      width: "6",
      budget: "20",
      model: "haiku",
      provider: "anthropic",
      concurrency: "10",
      nodeBudget: "100",
    });
    expect(overrides.maxDepth).toBe(4);
    expect(overrides.maxWidth).toBe(6);
    expect(overrides.budget?.totalUsd).toBe(20);
    expect(overrides.model).toBe("haiku");
    expect(overrides.provider).toBe("anthropic");
    expect(overrides.concurrency).toBe(10);
    expect(overrides.nodeBudget).toBe(100);
  });

  it("should ignore NaN values for numeric fields", () => {
    const overrides = buildOverrides({
      depth: "abc",
      width: "xyz",
      budget: "not-a-number",
      concurrency: "",
      nodeBudget: "nope",
    });
    expect(overrides.maxDepth).toBeUndefined();
    expect(overrides.maxWidth).toBeUndefined();
    expect(overrides.budget).toBeUndefined();
    expect(overrides.concurrency).toBeUndefined();
    expect(overrides.nodeBudget).toBeUndefined();
  });
});
