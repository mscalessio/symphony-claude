import { describe, it, expect } from "vitest";
import {
  renderFrame,
  renderHeader,
  renderRunningTable,
  renderBackoffQueue,
  formatNumber,
  formatDuration,
  formatDueIn,
  pad,
} from "../../src/tui/renderer.js";
import type { OrchestratorState, RunningEntry, RetryEntry, WorkflowConfig } from "../../src/types.js";

function makeState(overrides?: Partial<OrchestratorState>): OrchestratorState {
  return {
    poll_interval_ms: 30000,
    max_concurrent_agents: 50,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set(),
    codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
    codex_rate_limits: null,
    started_at: Date.now() - 120_000, // 2 minutes ago
    ...overrides,
  };
}

function makeConfig(): WorkflowConfig {
  return {
    tracker: {
      kind: "linear",
      endpoint: "https://api.linear.app/graphql",
      api_key: "test",
      project_slug: "TEST",
      active_states: ["Todo", "In Progress"],
      terminal_states: ["Done"],
    },
    polling: { interval_ms: 30000 },
    workspace: { root: "/tmp/ws" },
    hooks: { after_create: null, before_run: null, after_run: null, before_remove: null, timeout_ms: 30000 },
    agent: { max_concurrent_agents: 50, max_turns: 10, max_retry_backoff_ms: 300000, max_concurrent_agents_by_state: {} },
    codex: { command: "claude", approval_policy: "auto", turn_timeout_ms: 600000, read_timeout_ms: 30000, stall_timeout_ms: 120000 },
    server: { port: 3000 },
    worker: { ssh_hosts: null, max_concurrent_agents_per_host: null },
  };
}

function makeRunningEntry(overrides?: Partial<RunningEntry>): RunningEntry {
  return {
    issue_id: "id-1",
    identifier: "MT-725",
    state: "Todo",
    started_at: Date.now() - 79_000,
    last_codex_timestamp: null,
    worker_abort: new AbortController(),
    ssh_host: null,
    session_id: "019cab12-abcd-1234-5678-ac5e10f00000",
    attempt: 1,
    pid: 2510350,
    turn: 1,
    tokens: 1_442_520,
    last_event_text: "tool call: check:node",
    ...overrides,
  };
}

const defaultOpts = { cols: 120, rows: 40 };

// ─── formatNumber ───

describe("formatNumber", () => {
  it("formats small numbers as-is", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(999)).toBe("999");
  });

  it("formats thousands with commas", () => {
    expect(formatNumber(1_000)).toBe("1,000");
    expect(formatNumber(9_999)).toBe("9,999");
  });

  it("formats ten-thousands with K suffix", () => {
    expect(formatNumber(10_000)).toBe("10K");
    expect(formatNumber(658_875)).toBe("659K");
  });

  it("formats millions with M suffix", () => {
    expect(formatNumber(1_000_000)).toBe("1M");
    expect(formatNumber(38_183_882)).toBe("38.2M");
  });

  it("formats billions with B suffix", () => {
    expect(formatNumber(1_000_000_000)).toBe("1B");
  });
});

// ─── formatDuration ───

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(5_000)).toBe("5s");
    expect(formatDuration(59_000)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(79_000)).toBe("1m 19s");
    expect(formatDuration(114_000)).toBe("1m 54s");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3_661_000)).toBe("1h 1m");
  });

  it("handles zero", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("handles negative by clamping to 0", () => {
    expect(formatDuration(-1000)).toBe("0s");
  });
});

// ─── pad ───

describe("pad", () => {
  it("pads short strings with spaces", () => {
    expect(pad("hi", 5)).toBe("hi   ");
  });

  it("truncates long strings", () => {
    expect(pad("hello world", 5)).toBe("hello");
  });

  it("returns exact width string unchanged", () => {
    expect(pad("abc", 3)).toBe("abc");
  });
});

// ─── renderHeader ───

describe("renderHeader", () => {
  it("includes agent count", () => {
    const running = new Map([["id-1", makeRunningEntry()]]);
    const state = makeState({ running });
    const lines = renderHeader(state, makeConfig(), defaultOpts);
    const text = lines.join("\n");
    expect(text).toContain("1/50");
  });

  it("includes SYMPHONY STATUS title", () => {
    const lines = renderHeader(makeState(), makeConfig(), defaultOpts);
    expect(lines[0]).toContain("SYMPHONY STATUS");
  });

  it("includes token totals", () => {
    const state = makeState({
      codex_totals: { input_tokens: 38_183_882, output_tokens: 368_361, total_tokens: 38_552_243, seconds_running: 100 },
    });
    const lines = renderHeader(state, makeConfig(), defaultOpts);
    const text = lines.join("\n");
    expect(text).toContain("38.2M");
  });

  it("includes project slug when provided", () => {
    const lines = renderHeader(makeState(), makeConfig(), { ...defaultOpts, projectSlug: "my-project" });
    const text = lines.join("\n");
    expect(text).toContain("my-project");
  });
});

// ─── renderRunningTable ───

describe("renderRunningTable", () => {
  it("shows empty message when no agents", () => {
    const lines = renderRunningTable(makeState(), defaultOpts);
    const text = lines.join("\n");
    expect(text).toContain("No running agents");
  });

  it("shows agent rows", () => {
    const running = new Map([["id-1", makeRunningEntry()]]);
    const state = makeState({ running });
    const lines = renderRunningTable(state, defaultOpts);
    const text = lines.join("\n");
    expect(text).toContain("MT-725");
    expect(text).toContain("Todo");
    expect(text).toContain("2510350");
    expect(text).toContain("tool call: check:node");
  });

  it("shows column headers", () => {
    const running = new Map([["id-1", makeRunningEntry()]]);
    const state = makeState({ running });
    const lines = renderRunningTable(state, defaultOpts);
    const text = lines.join("\n");
    expect(text).toContain("ID");
    expect(text).toContain("STAGE");
    expect(text).toContain("PID");
    expect(text).toContain("TOKENS");
  });
});

// ─── renderBackoffQueue ───

describe("renderBackoffQueue", () => {
  it("shows empty message when no retries", () => {
    const lines = renderBackoffQueue(makeState(), defaultOpts);
    const text = lines.join("\n");
    expect(text).toContain("No queued retries");
  });

  it("shows retry entries", () => {
    const retry: RetryEntry = {
      issue_id: "id-2",
      identifier: "MT-800",
      attempt: 3,
      due_at_ms: Date.now() + 30_000,
      timer_handle: setTimeout(() => {}, 0),
      error: "Rate limit hit",
    };
    clearTimeout(retry.timer_handle);
    const retries = new Map([["id-2", retry]]);
    const state = makeState({ retry_attempts: retries });
    const lines = renderBackoffQueue(state, defaultOpts);
    const text = lines.join("\n");
    expect(text).toContain("MT-800");
    expect(text).toContain("3");
    expect(text).toContain("Rate limit hit");
  });
});

// ─── renderFrame ───

describe("renderFrame", () => {
  it("produces a complete frame", () => {
    const state = makeState();
    const frame = renderFrame(state, makeConfig(), defaultOpts);
    expect(frame).toContain("SYMPHONY STATUS");
    expect(frame).toContain("Running");
    expect(frame).toContain("Backoff queue");
  });

  it("clips output to terminal rows", () => {
    // Create many running entries to exceed 5 rows
    const running = new Map<string, RunningEntry>();
    for (let i = 0; i < 20; i++) {
      running.set(`id-${i}`, makeRunningEntry({ issue_id: `id-${i}`, identifier: `MT-${700 + i}` }));
    }
    const state = makeState({ running });
    const frame = renderFrame(state, makeConfig(), { cols: 120, rows: 10 });
    const lineCount = frame.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(9); // rows - 1
  });
});
