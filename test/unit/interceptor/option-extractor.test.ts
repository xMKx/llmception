import { describe, it, expect } from "vitest";
import { OptionExtractor } from "../../../src/interceptor/option-extractor.js";
import type { AnswerOption } from "../../../src/types.js";

describe("OptionExtractor", () => {
  describe("normalize", () => {
    it("should cap options at maxWidth", () => {
      const options: AnswerOption[] = [
        { label: "A", description: "Desc A", answerText: "A. Desc A" },
        { label: "B", description: "Desc B", answerText: "B. Desc B" },
        { label: "C", description: "Desc C", answerText: "C. Desc C" },
        { label: "D", description: "Desc D", answerText: "D. Desc D" },
      ];

      const normalized = OptionExtractor.normalize(options, 2);
      expect(normalized).toHaveLength(2);
      expect(normalized[0].label).toBe("A");
      expect(normalized[1].label).toBe("B");
    });

    it("should return all options when fewer than maxWidth", () => {
      const options: AnswerOption[] = [
        { label: "A", description: "Desc A", answerText: "A. Desc A" },
      ];

      const normalized = OptionExtractor.normalize(options, 5);
      expect(normalized).toHaveLength(1);
    });

    it("should fill missing label with default", () => {
      const options: AnswerOption[] = [
        { label: "", description: "Has desc", answerText: "" },
      ];

      const normalized = OptionExtractor.normalize(options, 5);
      expect(normalized[0].label).toBe("Option 1");
      expect(normalized[0].description).toBe("Has desc");
    });

    it("should fill missing description with label", () => {
      const options: AnswerOption[] = [
        { label: "MyLabel", description: "", answerText: "" },
      ];

      const normalized = OptionExtractor.normalize(options, 5);
      expect(normalized[0].label).toBe("MyLabel");
      expect(normalized[0].description).toBe("MyLabel");
    });

    it("should fill missing answerText", () => {
      const options: AnswerOption[] = [
        { label: "OAuth2", description: "Use OAuth2", answerText: "" },
      ];

      const normalized = OptionExtractor.normalize(options, 5);
      expect(normalized[0].answerText).toBe("OAuth2. Use OAuth2");
    });

    it("should fill all defaults when all fields are empty", () => {
      const options: AnswerOption[] = [
        { label: "", description: "", answerText: "" },
      ];

      const normalized = OptionExtractor.normalize(options, 5);
      expect(normalized[0].label).toBe("Option 1");
      expect(normalized[0].description).toBe("Option 1");
      expect(normalized[0].answerText).toBe("Option 1. Option 1");
    });

    it("should preserve valid fields", () => {
      const options: AnswerOption[] = [
        { label: "JWT", description: "Token auth", answerText: "Use JWT tokens" },
      ];

      const normalized = OptionExtractor.normalize(options, 5);
      expect(normalized[0]).toEqual({
        label: "JWT",
        description: "Token auth",
        answerText: "Use JWT tokens",
      });
    });

    it("should handle empty options array", () => {
      expect(OptionExtractor.normalize([], 5)).toEqual([]);
    });
  });

  describe("fromToolInput", () => {
    it("should extract options from valid tool input", () => {
      const input = {
        questions: [
          {
            header: "Auth",
            question: "Which auth?",
            options: [
              { label: "OAuth2", description: "Use OAuth2 with provider login" },
              { label: "JWT", description: "Use JWT tokens" },
            ],
          },
        ],
      };

      const options = OptionExtractor.fromToolInput(input);
      expect(options).toHaveLength(2);
      expect(options[0].label).toBe("OAuth2");
      expect(options[0].description).toBe("Use OAuth2 with provider login");
      expect(options[0].answerText).toBe("OAuth2. Use OAuth2 with provider login");
      expect(options[1].label).toBe("JWT");
      expect(options[1].answerText).toBe("JWT. Use JWT tokens");
    });

    it("should return empty array for null input", () => {
      expect(OptionExtractor.fromToolInput(null)).toEqual([]);
    });

    it("should return empty array for undefined input", () => {
      expect(OptionExtractor.fromToolInput(undefined)).toEqual([]);
    });

    it("should return empty array for string input", () => {
      expect(OptionExtractor.fromToolInput("not an object")).toEqual([]);
    });

    it("should return empty array for input without questions", () => {
      expect(OptionExtractor.fromToolInput({ foo: "bar" })).toEqual([]);
    });

    it("should return empty array for empty questions array", () => {
      expect(OptionExtractor.fromToolInput({ questions: [] })).toEqual([]);
    });

    it("should return empty array when first question has no options", () => {
      const input = {
        questions: [{ header: "Q", question: "Q?" }],
      };
      expect(OptionExtractor.fromToolInput(input)).toEqual([]);
    });

    it("should skip options with both label and description empty", () => {
      const input = {
        questions: [
          {
            options: [
              { label: "", description: "" },
              { label: "Valid", description: "Has content" },
            ],
          },
        ],
      };

      const options = OptionExtractor.fromToolInput(input);
      expect(options).toHaveLength(1);
      expect(options[0].label).toBe("Valid");
    });

    it("should handle option with only label", () => {
      const input = {
        questions: [
          {
            options: [{ label: "OnlyLabel" }],
          },
        ],
      };

      const options = OptionExtractor.fromToolInput(input);
      expect(options).toHaveLength(1);
      expect(options[0].label).toBe("OnlyLabel");
      expect(options[0].description).toBe("OnlyLabel");
      expect(options[0].answerText).toBe("OnlyLabel. OnlyLabel");
    });

    it("should handle option with only description", () => {
      const input = {
        questions: [
          {
            options: [{ description: "OnlyDesc" }],
          },
        ],
      };

      const options = OptionExtractor.fromToolInput(input);
      expect(options).toHaveLength(1);
      expect(options[0].label).toBe("OnlyDesc");
      expect(options[0].description).toBe("OnlyDesc");
    });

    it("should handle null items in options array", () => {
      const input = {
        questions: [
          {
            options: [null, { label: "Valid", description: "OK" }, undefined],
          },
        ],
      };

      const options = OptionExtractor.fromToolInput(input);
      expect(options).toHaveLength(1);
      expect(options[0].label).toBe("Valid");
    });
  });

  describe("fromNumberedList", () => {
    it("should parse '1. Label - description' format", () => {
      const text = "1. OAuth2 - Use OAuth2 with Google\n2. JWT - Use JSON Web Tokens";
      const options = OptionExtractor.fromNumberedList(text);
      expect(options).toHaveLength(2);
      expect(options[0].label).toBe("OAuth2");
      expect(options[0].description).toBe("Use OAuth2 with Google");
      expect(options[1].label).toBe("JWT");
      expect(options[1].description).toBe("Use JSON Web Tokens");
    });

    it("should parse '1) Label: description' format", () => {
      const text = "1) React: Frontend framework\n2) Vue: Progressive framework";
      const options = OptionExtractor.fromNumberedList(text);
      expect(options).toHaveLength(2);
      expect(options[0].label).toBe("React");
      expect(options[0].description).toBe("Frontend framework");
      expect(options[1].label).toBe("Vue");
    });

    it("should parse items without separator as label = description", () => {
      const text = "1. Simple option\n2. Another option";
      const options = OptionExtractor.fromNumberedList(text);
      expect(options).toHaveLength(2);
      expect(options[0].label).toBe("Simple option");
      expect(options[0].description).toBe("Simple option");
    });

    it("should skip non-matching lines", () => {
      const text = "Some preamble\n1. First item\nSome middle text\n2. Second item";
      const options = OptionExtractor.fromNumberedList(text);
      expect(options).toHaveLength(2);
    });

    it("should return empty array for text without numbered items", () => {
      const text = "No numbered items here at all.";
      expect(OptionExtractor.fromNumberedList(text)).toEqual([]);
    });

    it("should handle indented numbered items", () => {
      const text = "  1. Indented first\n  2. Indented second";
      const options = OptionExtractor.fromNumberedList(text);
      expect(options).toHaveLength(2);
      expect(options[0].label).toBe("Indented first");
    });

    it("should set answerText as 'label. description'", () => {
      const text = "1. OAuth2 - Provider login";
      const options = OptionExtractor.fromNumberedList(text);
      expect(options[0].answerText).toBe("OAuth2. Provider login");
    });
  });

  describe("fromBulletList", () => {
    it("should parse '- Label: description' format", () => {
      const text = "- React: Frontend framework\n- Vue: Progressive framework";
      const options = OptionExtractor.fromBulletList(text);
      expect(options).toHaveLength(2);
      expect(options[0].label).toBe("React");
      expect(options[0].description).toBe("Frontend framework");
    });

    it("should parse '* Label: description' format", () => {
      const text = "* PostgreSQL: Relational database\n* MongoDB: Document store";
      const options = OptionExtractor.fromBulletList(text);
      expect(options).toHaveLength(2);
      expect(options[0].label).toBe("PostgreSQL");
      expect(options[0].description).toBe("Relational database");
    });

    it("should parse '- Label - description' format", () => {
      const text = "- REST - Traditional API style\n- GraphQL - Flexible queries";
      const options = OptionExtractor.fromBulletList(text);
      expect(options).toHaveLength(2);
      expect(options[0].label).toBe("REST");
      expect(options[0].description).toBe("Traditional API style");
    });

    it("should parse items without separator", () => {
      const text = "- Simple item\n- Another item";
      const options = OptionExtractor.fromBulletList(text);
      expect(options).toHaveLength(2);
      expect(options[0].label).toBe("Simple item");
      expect(options[0].description).toBe("Simple item");
    });

    it("should return empty array for text without bullet items", () => {
      expect(OptionExtractor.fromBulletList("No bullets here.")).toEqual([]);
    });

    it("should skip non-matching lines", () => {
      const text = "Preamble text\n- First\nMiddle text\n- Second\nEnd text";
      const options = OptionExtractor.fromBulletList(text);
      expect(options).toHaveLength(2);
    });

    it("should set answerText as 'label. description'", () => {
      const text = "- TypeScript: Typed JavaScript";
      const options = OptionExtractor.fromBulletList(text);
      expect(options[0].answerText).toBe("TypeScript. Typed JavaScript");
    });
  });
});
