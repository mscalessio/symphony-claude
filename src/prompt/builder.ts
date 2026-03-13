import { Liquid } from "liquidjs";
import type { Issue } from "../types.js";

const engine = new Liquid({ strictVariables: true, strictFilters: true });

/**
 * Build the prompt for a given turn.
 *
 * Turn 1: Renders the full template with issue data.
 * Turn 2+: Returns a continuation prompt.
 * Empty template: Returns a fallback prompt.
 *
 * @param template - Liquid template string (from WORKFLOW.md body)
 * @param issue - The normalized issue object
 * @param attempt - Current attempt number (1-based) or null
 * @param turnNumber - Current turn number (1-based)
 * @returns The rendered prompt string
 */
export async function buildPrompt(
  template: string,
  issue: Issue,
  attempt: number | null,
  turnNumber: number,
): Promise<string> {
  if (turnNumber > 1) {
    return `Continue working on ${issue.identifier}: "${issue.title}". Check the current state of the workspace and proceed with the implementation.`;
  }

  const trimmed = template.trim();
  if (!trimmed) {
    return "You are working on an issue from Linear.";
  }

  try {
    return await engine.parseAndRender(trimmed, { issue, attempt });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to render Liquid prompt template for issue ${issue.identifier}: ${message}`,
      { cause: error },
    );
  }
}
