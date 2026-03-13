import { describe, it, expect } from "vitest";
import { describeEvent } from "../../src/tui/event-description.js";
import type {
  ClaudeSystemEvent,
  ClaudeAssistantEvent,
  ClaudeResultEvent,
} from "../../src/types.js";

describe("describeEvent", () => {
  it("describes system init event", () => {
    const event: ClaudeSystemEvent = { type: "system", subtype: "init", session_id: "sess-1" };
    expect(describeEvent(event)).toBe("session started");
  });

  it("describes other system subtypes", () => {
    const event: ClaudeSystemEvent = { type: "system", subtype: "heartbeat" };
    expect(describeEvent(event)).toBe("system: heartbeat");
  });

  it("describes tool_use in assistant event", () => {
    const event: ClaudeAssistantEvent = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "I'll check the file" },
          { type: "tool_use", name: "Read", tool_use_id: "tu-1", input: {} },
        ],
      },
    };
    expect(describeEvent(event)).toBe("tool call: Read");
  });

  it("describes text content in assistant event", () => {
    const event: ClaudeAssistantEvent = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello world" }],
      },
    };
    expect(describeEvent(event)).toBe("Hello world");
  });

  it("truncates long text content", () => {
    const longText = "A".repeat(100);
    const event: ClaudeAssistantEvent = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: longText }],
      },
    };
    const result = describeEvent(event);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).toContain("\u2026");
  });

  it("describes empty content as thinking", () => {
    const event: ClaudeAssistantEvent = {
      type: "assistant",
      message: { role: "assistant", content: [] },
    };
    expect(describeEvent(event)).toBe("thinking...");
  });

  it("describes successful result", () => {
    const event: ClaudeResultEvent = {
      type: "result",
      subtype: "success",
      session_id: "sess-1",
      is_error: false,
    };
    expect(describeEvent(event)).toBe("result: success");
  });

  it("describes error result", () => {
    const event: ClaudeResultEvent = {
      type: "result",
      subtype: "error",
      session_id: "sess-1",
      is_error: true,
      result: "Rate limit exceeded",
    };
    expect(describeEvent(event)).toContain("error:");
    expect(describeEvent(event)).toContain("Rate limit exceeded");
  });

  it("collapses newlines in text", () => {
    const event: ClaudeAssistantEvent = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "line1\nline2\nline3" }],
      },
    };
    expect(describeEvent(event)).toBe("line1 line2 line3");
  });
});
