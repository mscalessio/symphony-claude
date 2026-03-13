import { describe, it, expect } from "vitest";
import {
  extractSessionId,
  extractUsage,
  isSuccessResult,
  isErrorResult,
} from "../../src/agent/stream-parser.js";
import type {
  ClaudeSystemEvent,
  ClaudeResultEvent,
  ClaudeAssistantEvent,
  ClaudeStreamEvent,
} from "../../src/types.js";

function makeSystemEvent(
  overrides?: Partial<ClaudeSystemEvent>
): ClaudeSystemEvent {
  return {
    type: "system",
    subtype: "init",
    session_id: "sess-abc-123",
    ...overrides,
  };
}

function makeResultEvent(
  overrides?: Partial<ClaudeResultEvent>
): ClaudeResultEvent {
  return {
    type: "result",
    subtype: "success",
    session_id: "sess-abc-123",
    is_error: false,
    cost_usd: 0.05,
    duration_ms: 12000,
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
    },
    ...overrides,
  };
}

function makeAssistantEvent(
  overrides?: Partial<ClaudeAssistantEvent>
): ClaudeAssistantEvent {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
    },
    ...overrides,
  };
}

describe("extractSessionId", () => {
  it("returns session_id from system events", () => {
    const event = makeSystemEvent({ session_id: "sess-xyz-789" });
    expect(extractSessionId(event)).toBe("sess-xyz-789");
  });

  it("returns null for system events without session_id", () => {
    const event = makeSystemEvent();
    delete (event as any).session_id;
    expect(extractSessionId(event)).toBeNull();
  });

  it("returns null for assistant events", () => {
    const event = makeAssistantEvent();
    expect(extractSessionId(event)).toBeNull();
  });

  it("returns null for result events", () => {
    const event = makeResultEvent();
    expect(extractSessionId(event)).toBeNull();
  });
});

describe("extractUsage", () => {
  it("extracts usage from result events", () => {
    const event = makeResultEvent({
      usage: { input_tokens: 2000, output_tokens: 800 },
      cost_usd: 0.10,
      duration_ms: 15000,
    });

    const usage = extractUsage(event);

    expect(usage).toEqual({
      input_tokens: 2000,
      output_tokens: 800,
      cost_usd: 0.10,
      duration_ms: 15000,
    });
  });

  it("defaults missing usage fields to 0", () => {
    const event = makeResultEvent();
    delete (event as any).usage;
    delete (event as any).cost_usd;
    delete (event as any).duration_ms;

    const usage = extractUsage(event);

    expect(usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      duration_ms: 0,
    });
  });

  it("returns null for system events", () => {
    const event = makeSystemEvent();
    expect(extractUsage(event)).toBeNull();
  });

  it("returns null for assistant events", () => {
    const event = makeAssistantEvent();
    expect(extractUsage(event)).toBeNull();
  });
});

describe("isSuccessResult", () => {
  it("returns true for result events with subtype 'success'", () => {
    const event = makeResultEvent({ subtype: "success", is_error: false });
    expect(isSuccessResult(event)).toBe(true);
  });

  it("returns false for result events with different subtype", () => {
    const event = makeResultEvent({ subtype: "error" });
    expect(isSuccessResult(event)).toBe(false);
  });

  it("returns false for non-result events", () => {
    const event = makeSystemEvent();
    expect(isSuccessResult(event)).toBe(false);
  });

  it("returns true even when is_error is true but subtype is success", () => {
    // The function only checks type and subtype, not is_error
    const event = makeResultEvent({ subtype: "success", is_error: true });
    expect(isSuccessResult(event)).toBe(true);
  });
});

describe("isErrorResult", () => {
  it("returns true for result events with is_error true", () => {
    const event = makeResultEvent({ is_error: true, subtype: "error" });
    expect(isErrorResult(event)).toBe(true);
  });

  it("returns false for result events with is_error false", () => {
    const event = makeResultEvent({ is_error: false });
    expect(isErrorResult(event)).toBe(false);
  });

  it("returns false for non-result events", () => {
    const event = makeSystemEvent();
    expect(isErrorResult(event)).toBe(false);
  });

  it("returns false for assistant events", () => {
    const event = makeAssistantEvent();
    expect(isErrorResult(event)).toBe(false);
  });
});
