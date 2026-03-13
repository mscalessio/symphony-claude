import type { ClaudeStreamEvent } from "../types.js";

/**
 * Map a ClaudeStreamEvent to a short human-readable description
 * suitable for the TUI dashboard's EVENT column.
 */
export function describeEvent(event: ClaudeStreamEvent): string {
  switch (event.type) {
    case "system": {
      if (event.subtype === "init") return "session started";
      return `system: ${event.subtype}`;
    }
    case "assistant": {
      const content = event.message?.content;
      if (!content || content.length === 0) return "thinking...";
      const last = content[content.length - 1];
      if (last.type === "tool_use" && last.name) {
        return `tool call: ${last.name}`;
      }
      if (last.type === "text" && last.text) {
        return truncate(last.text, 50);
      }
      return "assistant message";
    }
    case "result": {
      if (event.is_error) return `error: ${truncate(event.result ?? "unknown", 40)}`;
      return `result: ${event.subtype}`;
    }
    default:
      return "unknown event";
  }
}

function truncate(s: string, max: number): string {
  // Collapse newlines to spaces for single-line display
  const flat = s.replace(/\n/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1) + "\u2026";
}
