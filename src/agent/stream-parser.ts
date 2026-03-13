import { createInterface, type Interface } from "node:readline";
import type { Readable } from "node:stream";
import type { ClaudeStreamEvent } from "../types.js";

/**
 * Parse line-delimited JSON from a readable stream (claude CLI stdout).
 * Each line is a JSON object with a `type` field.
 * Emits parsed events via the callback.
 */
export function createStreamParser(
  stream: Readable,
  onEvent: (event: ClaudeStreamEvent) => void,
  onError: (error: Error) => void
): Interface {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && "type" in parsed) {
        onEvent(parsed as ClaudeStreamEvent);
      }
    } catch {
      // Not valid JSON — skip (could be non-protocol output)
    }
  });

  rl.on("error", onError);

  return rl;
}

/**
 * Extract session ID from a system init event.
 */
export function extractSessionId(event: ClaudeStreamEvent): string | null {
  if (event.type === "system" && event.session_id) {
    return event.session_id;
  }
  return null;
}

/**
 * Extract usage from a result event.
 */
export function extractUsage(event: ClaudeStreamEvent): {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number;
} | null {
  if (event.type === "result") {
    return {
      input_tokens: event.usage?.input_tokens ?? 0,
      output_tokens: event.usage?.output_tokens ?? 0,
      cost_usd: event.cost_usd ?? 0,
      duration_ms: event.duration_ms ?? 0,
    };
  }
  return null;
}

/**
 * Check if a result event indicates success.
 */
export function isSuccessResult(event: ClaudeStreamEvent): boolean {
  return event.type === "result" && event.subtype === "success";
}

/**
 * Check if a result event indicates an error.
 */
export function isErrorResult(event: ClaudeStreamEvent): boolean {
  return event.type === "result" && event.is_error === true;
}
