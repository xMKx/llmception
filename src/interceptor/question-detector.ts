import type { StreamEvent, InterceptedQuestion, AnswerOption } from "../types.js";
import { OptionExtractor } from "./option-extractor.js";

/**
 * Patterns that signal a decision question in free text.
 */
const DECISION_PATTERNS = [
  /should\s+I/i,
  /would\s+you\s+prefer/i,
  /which\s+option/i,
  /which\s+approach/i,
  /which\s+one/i,
  /do\s+you\s+want/i,
  /would\s+you\s+like/i,
  /please\s+choose/i,
  /please\s+select/i,
  /pick\s+one/i,
  /choose\s+between/i,
  /select\s+one/i,
  /option\s+\d/i,
  /alternative\s+\d/i,
];

/**
 * Detects questions in stream events and free text.
 */
export class QuestionDetector {
  /**
   * Scan events for an ask_user event and return the intercepted question if found.
   */
  static detectInStream(events: StreamEvent[]): InterceptedQuestion | null {
    for (const event of events) {
      if (event.type === "ask_user") {
        return event.question;
      }
    }
    return null;
  }

  /**
   * Heuristic fallback: returns true if text looks like it is asking a
   * decision question. Checks for "?" combined with decision language,
   * or numbered/bulleted option lists.
   */
  static detectInText(text: string): boolean {
    const hasQuestionMark = text.includes("?");

    if (hasQuestionMark) {
      for (const pattern of DECISION_PATTERNS) {
        if (pattern.test(text)) {
          return true;
        }
      }
    }

    // Check for numbered option lists (e.g. "1. ...\n2. ...")
    const numberedListMatch = text.match(/^\s*\d+[.)]\s+\S/gm);
    if (numberedListMatch && numberedListMatch.length >= 2 && hasQuestionMark) {
      return true;
    }

    // Check for "Option A:" / "Option 1:" patterns with a question mark
    if (hasQuestionMark && /option\s+[a-z\d]/i.test(text)) {
      return true;
    }

    return false;
  }

  /**
   * Best-effort extraction of answer options from free text.
   * Tries numbered lists first, then bullet lists.
   */
  static extractOptionsFromText(text: string): AnswerOption[] {
    // Try numbered list first
    const numbered = OptionExtractor.fromNumberedList(text);
    if (numbered.length > 0) {
      return numbered;
    }

    // Try bullet list
    const bulleted = OptionExtractor.fromBulletList(text);
    if (bulleted.length > 0) {
      return bulleted;
    }

    return [];
  }
}
