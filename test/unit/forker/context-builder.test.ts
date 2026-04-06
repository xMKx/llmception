import { describe, it, expect } from "vitest";
import { ContextBuilder } from "../../../src/forker/context-builder.js";
import type { InterceptedQuestion, AnswerOption, DecisionStep } from "../../../src/types.js";

describe("ContextBuilder", () => {
  describe("buildSystemPrompt()", () => {
    it("returns non-empty string containing key phrases", () => {
      const prompt = ContextBuilder.buildSystemPrompt();

      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain("AskUserQuestion");
      expect(prompt).toContain("decision");
      expect(prompt).toContain("options");
    });

    it("instructs not to make assumptions", () => {
      const prompt = ContextBuilder.buildSystemPrompt();

      expect(prompt).toContain("Do NOT make assumptions");
    });

    it("instructs to present 2-4 options", () => {
      const prompt = ContextBuilder.buildSystemPrompt();

      expect(prompt).toContain("2-4");
    });
  });

  describe("buildAnswerPrompt()", () => {
    const question: InterceptedQuestion = {
      question: "Which authentication method should we use?",
      header: "Auth Method",
      options: [
        {
          label: "JWT",
          description: "Stateless tokens",
          answerText: "Use JWT-based authentication",
        },
        {
          label: "Session",
          description: "Server-side sessions",
          answerText: "Use session-based authentication",
        },
      ],
    };

    const chosenOption: AnswerOption = {
      label: "JWT",
      description: "Stateless tokens",
      answerText: "Use JWT-based authentication",
    };

    it("formats question and answer correctly", () => {
      const prompt = ContextBuilder.buildAnswerPrompt(question, chosenOption);

      expect(prompt).toContain(question.question);
      expect(prompt).toContain(chosenOption.answerText);
      expect(prompt).toContain("Continue implementing");
    });

    it("includes instruction not to re-ask", () => {
      const prompt = ContextBuilder.buildAnswerPrompt(question, chosenOption);

      expect(prompt).toContain("Do not re-ask");
    });
  });

  describe("buildDecisionContext()", () => {
    it("with empty path returns empty string", () => {
      const context = ContextBuilder.buildDecisionContext([]);
      expect(context).toBe("");
    });

    it("with single decision formats correctly", () => {
      const path: DecisionStep[] = [
        { question: "Auth method", answer: "JWT" },
      ];

      const context = ContextBuilder.buildDecisionContext(path);

      expect(context).toContain("Previously decided:");
      expect(context).toContain("1. Auth method: JWT");
    });

    it("with multiple decisions formats correctly", () => {
      const path: DecisionStep[] = [
        { question: "Auth method", answer: "JWT" },
        { question: "Signing algorithm", answer: "RS256" },
        { question: "Token expiry", answer: "15 minutes" },
      ];

      const context = ContextBuilder.buildDecisionContext(path);

      expect(context).toContain("Previously decided:");
      expect(context).toContain("1. Auth method: JWT");
      expect(context).toContain("2. Signing algorithm: RS256");
      expect(context).toContain("3. Token expiry: 15 minutes");
    });
  });

  describe("buildFullPrompt()", () => {
    it("returns just the task when no decisions", () => {
      const result = ContextBuilder.buildFullPrompt("Build a REST API", []);
      expect(result).toBe("Build a REST API");
    });

    it("combines task and decisions", () => {
      const decisions: DecisionStep[] = [
        { question: "Framework", answer: "Express" },
        { question: "Database", answer: "PostgreSQL" },
      ];

      const result = ContextBuilder.buildFullPrompt(
        "Build a REST API",
        decisions,
      );

      expect(result).toContain("Previously decided:");
      expect(result).toContain("1. Framework: Express");
      expect(result).toContain("2. Database: PostgreSQL");
      expect(result).toContain("Task: Build a REST API");
    });

    it("puts decisions before the task", () => {
      const decisions: DecisionStep[] = [
        { question: "Language", answer: "TypeScript" },
      ];

      const result = ContextBuilder.buildFullPrompt("Do the thing", decisions);

      const contextIndex = result.indexOf("Previously decided:");
      const taskIndex = result.indexOf("Task:");
      expect(contextIndex).toBeLessThan(taskIndex);
    });
  });
});
