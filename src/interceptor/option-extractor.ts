import type { AnswerOption } from "../types.js";

/**
 * Extracts and normalizes answer options from various input formats.
 */
export class OptionExtractor {
  /**
   * Cap options at maxWidth and ensure each has non-empty label, description, and answerText.
   */
  static normalize(options: AnswerOption[], maxWidth: number): AnswerOption[] {
    const capped = options.slice(0, maxWidth);
    return capped.map((opt, i) => ({
      label: opt.label || `Option ${i + 1}`,
      description: opt.description || opt.label || `Option ${i + 1}`,
      answerText: opt.answerText || `${opt.label || `Option ${i + 1}`}. ${opt.description || opt.label || `Option ${i + 1}`}`,
    }));
  }

  /**
   * Extract options from AskUserQuestion tool input shape.
   * Handles malformed input gracefully by returning an empty array.
   *
   * Expected shape:
   * { questions: [{ options: [{ label, description }] }] }
   */
  static fromToolInput(input: unknown): AnswerOption[] {
    if (input == null || typeof input !== "object") {
      return [];
    }

    const obj = input as Record<string, unknown>;
    const questions = obj.questions;
    if (!Array.isArray(questions) || questions.length === 0) {
      return [];
    }

    const first = questions[0] as Record<string, unknown>;
    if (first == null || typeof first !== "object") {
      return [];
    }

    const rawOptions = first.options;
    if (!Array.isArray(rawOptions)) {
      return [];
    }

    const options: AnswerOption[] = [];
    for (const raw of rawOptions) {
      if (raw == null || typeof raw !== "object") {
        continue;
      }
      const entry = raw as Record<string, unknown>;
      const label = typeof entry.label === "string" ? entry.label : "";
      const description = typeof entry.description === "string" ? entry.description : "";

      if (label === "" && description === "") {
        continue;
      }

      options.push({
        label: label || description,
        description: description || label,
        answerText: `${label || description}. ${description || label}`,
      });
    }

    return options;
  }

  /**
   * Parse numbered list patterns from text.
   *
   * Supported formats:
   * - "1. Label - description"
   * - "1) Label: description"
   * - "1. Label"
   */
  static fromNumberedList(text: string): AnswerOption[] {
    const lines = text.split("\n");
    const options: AnswerOption[] = [];
    const pattern = /^\s*(\d+)[.)]\s+(.+)$/;

    for (const line of lines) {
      const match = pattern.exec(line);
      if (!match) {
        continue;
      }

      const content = match[2].trim();
      const { label, description } = splitLabelDescription(content);

      options.push({
        label,
        description,
        answerText: `${label}. ${description}`,
      });
    }

    return options;
  }

  /**
   * Parse bullet list patterns from text.
   *
   * Supported formats:
   * - "- Label: description"
   * - "- Label - description"
   * - "* Label: description"
   * - "- Label"
   */
  static fromBulletList(text: string): AnswerOption[] {
    const lines = text.split("\n");
    const options: AnswerOption[] = [];
    const pattern = /^\s*[-*]\s+(.+)$/;

    for (const line of lines) {
      const match = pattern.exec(line);
      if (!match) {
        continue;
      }

      const content = match[1].trim();
      const { label, description } = splitLabelDescription(content);

      options.push({
        label,
        description,
        answerText: `${label}. ${description}`,
      });
    }

    return options;
  }
}

/**
 * Split a content string into label and description using common delimiters.
 * Tries ": ", " - ", " -- " as separators. Falls back to using the full string
 * as both label and description.
 */
function splitLabelDescription(content: string): {
  label: string;
  description: string;
} {
  // Try ": " separator
  const colonIdx = content.indexOf(": ");
  if (colonIdx > 0 && colonIdx < content.length - 2) {
    return {
      label: content.slice(0, colonIdx).trim(),
      description: content.slice(colonIdx + 2).trim(),
    };
  }

  // Try " - " separator
  const dashIdx = content.indexOf(" - ");
  if (dashIdx > 0 && dashIdx < content.length - 3) {
    return {
      label: content.slice(0, dashIdx).trim(),
      description: content.slice(dashIdx + 3).trim(),
    };
  }

  // Try " -- " separator
  const doubleDashIdx = content.indexOf(" -- ");
  if (doubleDashIdx > 0 && doubleDashIdx < content.length - 4) {
    return {
      label: content.slice(0, doubleDashIdx).trim(),
      description: content.slice(doubleDashIdx + 4).trim(),
    };
  }

  // No separator found — use full string as both
  return {
    label: content,
    description: content,
  };
}
