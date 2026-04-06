import type { InterceptedQuestion, AnswerOption, DecisionStep } from "../types.js";

/**
 * Builds prompts and context strings for LLM sessions.
 * The system prompt forces the LLM to surface design decisions via AskUserQuestion.
 */
export class ContextBuilder {
  /**
   * Return the system prompt that instructs the LLM to use AskUserQuestion
   * for all meaningful decision points.
   */
  static buildSystemPrompt(): string {
    return [
      "IMPORTANT INSTRUCTION: Decision Interception Protocol",
      "",
      "When you encounter ANY of the following during implementation, you MUST use the AskUserQuestion tool to present the decision:",
      "- Architectural choices (e.g. monolith vs microservices, REST vs GraphQL)",
      "- Library or framework selection (e.g. which ORM, which auth library)",
      "- Design pattern decisions (e.g. repository pattern vs active record)",
      "- Data modeling ambiguities (e.g. how to structure relationships)",
      "- API design choices (e.g. pagination strategy, error format)",
      "- Security approach decisions (e.g. JWT vs session, OAuth flow)",
      "- Any ambiguity in the requirements that could be resolved multiple ways",
      "",
      "For each decision, present 2-4 distinct, well-differentiated options with clear tradeoffs.",
      "Do NOT make assumptions about user preferences.",
      "Do NOT default to the most common or popular choice without asking.",
      "",
      "After receiving an answer to a decision, proceed confidently with that choice. Do not second-guess or re-ask.",
      "",
      "If a decision has already been made earlier in the conversation history, do not ask about it again. Use the previously chosen option.",
      "",
      "Focus on meaningful architectural and design decisions. Do not ask about trivial matters like variable naming conventions, code formatting, or import ordering.",
    ].join("\n");
  }

  /**
   * Return a prompt that tells the LLM the answer to a specific question
   * and instructs it to continue implementing.
   */
  static buildAnswerPrompt(
    question: InterceptedQuestion,
    chosenOption: AnswerOption,
  ): string {
    return [
      `For the question: "${question.question}"`,
      "",
      `The answer is: ${chosenOption.answerText}`,
      "",
      "Continue implementing with this decision. Do not re-ask this question.",
    ].join("\n");
  }

  /**
   * Return a summary of all prior decisions for context injection.
   * Returns empty string if there are no prior decisions.
   */
  static buildDecisionContext(decisionPath: DecisionStep[]): string {
    if (decisionPath.length === 0) {
      return "";
    }

    const lines = decisionPath.map(
      (step, i) => `${i + 1}. ${step.question}: ${step.answer}`,
    );

    return `Previously decided:\n${lines.join("\n")}`;
  }

  /**
   * Combine the original task with any prior decision context into a single prompt.
   * Used for fresh (non-fork) execution where decisions need to be pre-loaded.
   */
  static buildFullPrompt(task: string, decisionPath: DecisionStep[]): string {
    const context = ContextBuilder.buildDecisionContext(decisionPath);

    if (!context) {
      return task;
    }

    return `${context}\n\nTask: ${task}`;
  }
}
