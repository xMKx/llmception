import { describe, it, expect } from "vitest";
import { SessionForker } from "../../../src/forker/session-forker.js";
import type { LlmceptionConfig } from "../../../src/types.js";

function makeConfig(
  overrides: Partial<LlmceptionConfig> = {},
): LlmceptionConfig {
  return {
    provider: "claude-cli",
    maxDepth: 5,
    maxWidth: 3,
    nodeBudget: 20,
    concurrency: 2,
    budget: { perBranchUsd: 1, totalUsd: 10, mode: "hard" },
    branchTimeoutMs: 300_000,
    model: "sonnet",
    permissionMode: "auto",
    claudeCodePath: "claude",
    providers: {},
    ...overrides,
  };
}

describe("SessionForker", () => {
  describe("buildExecuteArgs()", () => {
    it("returns correct base args", () => {
      const forker = new SessionForker(makeConfig());

      const args = forker.buildExecuteArgs({
        prompt: "Build a thing",
        cwd: "/tmp/work",
        systemPrompt: "System instructions here",
      });

      expect(args).toContain("--print");
      expect(args).toContain("--output-format");
      expect(args).toContain("stream-json");
      expect(args).toContain("--verbose");
      expect(args).toContain("--append-system-prompt");
      expect(args).toContain("System instructions here");
      expect(args).toContain("--model");
      expect(args).toContain("sonnet");
      expect(args).toContain("--max-turns");
      expect(args).toContain("50");
      // Prompt should be last
      expect(args[args.length - 1]).toBe("Build a thing");
    });

    it("includes budget flag when provider is metered", () => {
      const forker = new SessionForker(
        makeConfig({ provider: "anthropic" }),
      );

      const args = forker.buildExecuteArgs({
        prompt: "Do stuff",
        cwd: "/tmp/work",
        systemPrompt: "sys",
        maxBudgetUsd: 2.5,
      });

      const budgetIdx = args.indexOf("--max-budget-usd");
      expect(budgetIdx).toBeGreaterThan(-1);
      expect(args[budgetIdx + 1]).toBe("2.5");
    });

    it("omits budget flag for subscription provider", () => {
      const forker = new SessionForker(
        makeConfig({ provider: "claude-cli" }),
      );

      const args = forker.buildExecuteArgs({
        prompt: "Do stuff",
        cwd: "/tmp/work",
        systemPrompt: "sys",
        maxBudgetUsd: 2.5,
      });

      expect(args).not.toContain("--max-budget-usd");
    });

    it("uses model override when provided", () => {
      const forker = new SessionForker(makeConfig({ model: "sonnet" }));

      const args = forker.buildExecuteArgs({
        prompt: "task",
        cwd: "/tmp",
        systemPrompt: "sys",
        model: "opus",
      });

      const modelIdx = args.indexOf("--model");
      expect(args[modelIdx + 1]).toBe("opus");
    });

    it("falls back to config model when no override", () => {
      const forker = new SessionForker(makeConfig({ model: "haiku" }));

      const args = forker.buildExecuteArgs({
        prompt: "task",
        cwd: "/tmp",
        systemPrompt: "sys",
      });

      const modelIdx = args.indexOf("--model");
      expect(args[modelIdx + 1]).toBe("haiku");
    });
  });

  describe("buildForkArgs()", () => {
    it("includes --resume and session ID", () => {
      const forker = new SessionForker(makeConfig());

      const args = forker.buildForkArgs({
        parentSessionId: "session-abc-123",
        answer: "Use JWT authentication",
        systemPrompt: "sys prompt",
      });

      expect(args).toContain("--resume");
      const resumeIdx = args.indexOf("--resume");
      expect(args[resumeIdx + 1]).toBe("session-abc-123");
      // Answer should be last
      expect(args[args.length - 1]).toBe("Use JWT authentication");
    });

    it("includes budget for metered provider", () => {
      const forker = new SessionForker(
        makeConfig({ provider: "openai" }),
      );

      const args = forker.buildForkArgs({
        parentSessionId: "sess-1",
        answer: "answer",
        systemPrompt: "sys",
        maxBudgetUsd: 1.0,
      });

      expect(args).toContain("--max-budget-usd");
    });

    it("does not include --resume for execute but does for fork", () => {
      const forker = new SessionForker(makeConfig());

      const execArgs = forker.buildExecuteArgs({
        prompt: "task",
        cwd: "/tmp",
        systemPrompt: "sys",
      });
      const forkArgs = forker.buildForkArgs({
        parentSessionId: "sess-1",
        answer: "answer",
        systemPrompt: "sys",
      });

      expect(execArgs).not.toContain("--resume");
      expect(forkArgs).toContain("--resume");
    });
  });

  describe("getPermissionFlag()", () => {
    it("returns empty array for auto mode", () => {
      const forker = new SessionForker(
        makeConfig({ permissionMode: "auto" }),
      );
      expect(forker.getPermissionFlag()).toEqual([]);
    });

    it("returns allowedTools for acceptEdits mode", () => {
      const forker = new SessionForker(
        makeConfig({ permissionMode: "acceptEdits" }),
      );
      const flags = forker.getPermissionFlag();
      expect(flags).toEqual([
        "--allowedTools",
        "Edit,Write,Read,Glob,Grep,Bash",
      ]);
    });

    it("returns dangerously-skip-permissions for bypassPermissions mode", () => {
      const forker = new SessionForker(
        makeConfig({ permissionMode: "bypassPermissions" }),
      );
      const flags = forker.getPermissionFlag();
      expect(flags).toEqual(["--dangerously-skip-permissions"]);
    });
  });

  describe("permission flags in built args", () => {
    it("includes acceptEdits flags in execute args", () => {
      const forker = new SessionForker(
        makeConfig({ permissionMode: "acceptEdits" }),
      );

      const args = forker.buildExecuteArgs({
        prompt: "task",
        cwd: "/tmp",
        systemPrompt: "sys",
      });

      expect(args).toContain("--allowedTools");
      expect(args).toContain("Edit,Write,Read,Glob,Grep,Bash");
    });

    it("includes bypassPermissions flag in fork args", () => {
      const forker = new SessionForker(
        makeConfig({ permissionMode: "bypassPermissions" }),
      );

      const args = forker.buildForkArgs({
        parentSessionId: "sess-1",
        answer: "answer",
        systemPrompt: "sys",
      });

      expect(args).toContain("--dangerously-skip-permissions");
    });
  });
});
