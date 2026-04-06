import { describe, it, expect } from "vitest";
import { QuestionDetector } from "../../../src/interceptor/question-detector.js";
import type { StreamEvent, InterceptedQuestion } from "../../../src/types.js";

function makeAskUserEvent(question: InterceptedQuestion): StreamEvent {
  return { type: "ask_user", question };
}

function makeTextEvent(text: string): StreamEvent {
  return { type: "text", text };
}

function makeToolUseEvent(name: string): StreamEvent {
  return { type: "tool_use", name, input: {}, toolUseId: "tool-1" };
}

const sampleQuestion: InterceptedQuestion = {
  header: "Database choice",
  question: "Which database should I use?",
  options: [
    { label: "PostgreSQL", description: "Relational DB", answerText: "PostgreSQL. Relational DB" },
    { label: "MongoDB", description: "Document DB", answerText: "MongoDB. Document DB" },
  ],
};

describe("QuestionDetector", () => {
  describe("detectInStream", () => {
    it("should find ask_user event and return the question", () => {
      const events: StreamEvent[] = [
        makeTextEvent("I have a question for you."),
        makeAskUserEvent(sampleQuestion),
      ];

      const result = QuestionDetector.detectInStream(events);
      expect(result).toEqual(sampleQuestion);
    });

    it("should return null when no ask_user events exist", () => {
      const events: StreamEvent[] = [
        makeTextEvent("Just some text."),
        makeToolUseEvent("Read"),
        makeTextEvent("More text."),
      ];

      const result = QuestionDetector.detectInStream(events);
      expect(result).toBeNull();
    });

    it("should return the first ask_user event when multiple exist", () => {
      const secondQuestion: InterceptedQuestion = {
        header: "Second",
        question: "Second question?",
        options: [],
      };

      const events: StreamEvent[] = [
        makeAskUserEvent(sampleQuestion),
        makeAskUserEvent(secondQuestion),
      ];

      const result = QuestionDetector.detectInStream(events);
      expect(result).toEqual(sampleQuestion);
    });

    it("should return null for empty events array", () => {
      expect(QuestionDetector.detectInStream([])).toBeNull();
    });
  });

  describe("detectInText", () => {
    it("should detect 'should I' with question mark", () => {
      expect(
        QuestionDetector.detectInText("Should I use OAuth2 or JWT?"),
      ).toBe(true);
    });

    it("should detect 'would you prefer' with question mark", () => {
      expect(
        QuestionDetector.detectInText("Would you prefer REST or GraphQL?"),
      ).toBe(true);
    });

    it("should detect 'which option' with question mark", () => {
      expect(
        QuestionDetector.detectInText("Which option would work best for this?"),
      ).toBe(true);
    });

    it("should detect 'do you want' with question mark", () => {
      expect(
        QuestionDetector.detectInText("Do you want me to use TypeScript?"),
      ).toBe(true);
    });

    it("should detect 'would you like' with question mark", () => {
      expect(
        QuestionDetector.detectInText("Would you like me to add tests?"),
      ).toBe(true);
    });

    it("should detect 'please choose' with question mark", () => {
      expect(
        QuestionDetector.detectInText("Please choose your preferred framework?"),
      ).toBe(true);
    });

    it("should detect 'which approach' with question mark", () => {
      expect(
        QuestionDetector.detectInText("Which approach should we take?"),
      ).toBe(true);
    });

    it("should detect numbered list with question mark", () => {
      const text = "Which one do you prefer?\n1. React\n2. Vue\n3. Angular";
      expect(QuestionDetector.detectInText(text)).toBe(true);
    });

    it("should detect 'option 1' pattern with question mark", () => {
      expect(
        QuestionDetector.detectInText("Do you want option 1 or option 2?"),
      ).toBe(true);
    });

    it("should reject plain text without question mark", () => {
      expect(
        QuestionDetector.detectInText("I will implement the login feature now."),
      ).toBe(false);
    });

    it("should reject question mark without decision language", () => {
      expect(
        QuestionDetector.detectInText("What is 2 + 2?"),
      ).toBe(false);
    });

    it("should reject empty text", () => {
      expect(QuestionDetector.detectInText("")).toBe(false);
    });

    it("should reject text that only has decision language without question mark", () => {
      expect(
        QuestionDetector.detectInText("I should use React for the frontend."),
      ).toBe(false);
    });
  });

  describe("extractOptionsFromText", () => {
    it("should extract numbered list options", () => {
      const text = "1. OAuth2 - Use OAuth2 with Google\n2. JWT - Use JWT tokens\n3. Session - Use session cookies";
      const options = QuestionDetector.extractOptionsFromText(text);
      expect(options).toHaveLength(3);
      expect(options[0].label).toBe("OAuth2");
      expect(options[0].description).toBe("Use OAuth2 with Google");
      expect(options[1].label).toBe("JWT");
      expect(options[2].label).toBe("Session");
    });

    it("should extract bullet list options", () => {
      const text = "- React: Frontend framework by Meta\n- Vue: Progressive framework\n- Angular: Full framework by Google";
      const options = QuestionDetector.extractOptionsFromText(text);
      expect(options).toHaveLength(3);
      expect(options[0].label).toBe("React");
      expect(options[0].description).toBe("Frontend framework by Meta");
    });

    it("should prefer numbered list over bullet list", () => {
      const text = "1. First option\n- Bullet option";
      const options = QuestionDetector.extractOptionsFromText(text);
      // Should find the numbered option
      expect(options.length).toBeGreaterThanOrEqual(1);
      expect(options[0].label).toBe("First option");
    });

    it("should extract bullet list when no numbered list is present", () => {
      const text = "Some preamble text.\n- Alpha: first\n- Beta: second";
      const options = QuestionDetector.extractOptionsFromText(text);
      expect(options).toHaveLength(2);
      expect(options[0].label).toBe("Alpha");
      expect(options[1].label).toBe("Beta");
    });

    it("should return empty array when no options found", () => {
      const text = "This is just a regular paragraph with no options.";
      const options = QuestionDetector.extractOptionsFromText(text);
      expect(options).toEqual([]);
    });

    it("should handle mixed format text", () => {
      const text = "Here are the options:\n1. REST API - Traditional approach\n2. GraphQL - Flexible queries";
      const options = QuestionDetector.extractOptionsFromText(text);
      expect(options).toHaveLength(2);
      expect(options[0].label).toBe("REST API");
      expect(options[1].label).toBe("GraphQL");
    });
  });
});
