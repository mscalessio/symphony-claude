import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  queueNormalRetry,
  queueAbnormalRetry,
  cancelExistingRetry,
  cancelAllRetries,
} from "../../src/orchestrator/retry.js";
import type { OrchestratorState, RetryEntry } from "../../src/types.js";

function makeState(): OrchestratorState {
  return {
    poll_interval_ms: 30000,
    max_concurrent_agents: 5,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set(),
    codex_totals: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      seconds_running: 0,
    },
    codex_rate_limits: null,
  };
}

function makeLogger(): any {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("queueNormalRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets a retry with 1000ms delay", () => {
    const state = makeState();
    const logger = makeLogger();
    const onRetry = vi.fn();

    queueNormalRetry("issue-1", "PROJ-1", state, onRetry, logger);

    expect(state.retry_attempts.has("issue-1")).toBe(true);
    const entry = state.retry_attempts.get("issue-1")!;
    expect(entry.attempt).toBe(1);
    expect(entry.error).toBeNull();

    // Should not fire before 1000ms
    vi.advanceTimersByTime(999);
    expect(onRetry).not.toHaveBeenCalled();

    // Should fire at 1000ms
    vi.advanceTimersByTime(1);
    expect(onRetry).toHaveBeenCalledWith("issue-1");
  });

  it("cleans up retry_attempts after timer fires", () => {
    const state = makeState();
    const logger = makeLogger();
    const onRetry = vi.fn();

    queueNormalRetry("issue-1", "PROJ-1", state, onRetry, logger);

    vi.advanceTimersByTime(1000);

    expect(state.retry_attempts.has("issue-1")).toBe(false);
  });

  it("cancels existing retry before creating new one", () => {
    const state = makeState();
    const logger = makeLogger();
    const onRetry1 = vi.fn();
    const onRetry2 = vi.fn();

    queueNormalRetry("issue-1", "PROJ-1", state, onRetry1, logger);
    queueNormalRetry("issue-1", "PROJ-1", state, onRetry2, logger);

    vi.advanceTimersByTime(1000);

    // Only the second retry should fire
    expect(onRetry1).not.toHaveBeenCalled();
    expect(onRetry2).toHaveBeenCalledWith("issue-1");
  });
});

describe("queueAbnormalRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses exponential backoff: 10000 * 2^(attempt-1)", () => {
    const state = makeState();
    const logger = makeLogger();
    const onRetry = vi.fn();
    const maxBackoff = 300_000;

    // attempt 1: 10000 * 2^0 = 10000ms
    queueAbnormalRetry(
      "issue-1",
      "PROJ-1",
      1,
      maxBackoff,
      "some error",
      state,
      onRetry,
      logger
    );

    vi.advanceTimersByTime(9999);
    expect(onRetry).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("doubles delay with each attempt", () => {
    const state = makeState();
    const logger = makeLogger();
    const maxBackoff = 300_000;

    // attempt 2: 10000 * 2^1 = 20000ms
    const onRetry2 = vi.fn();
    queueAbnormalRetry(
      "issue-2",
      "PROJ-2",
      2,
      maxBackoff,
      "error",
      state,
      onRetry2,
      logger
    );

    vi.advanceTimersByTime(19999);
    expect(onRetry2).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRetry2).toHaveBeenCalledTimes(1);

    // attempt 3: 10000 * 2^2 = 40000ms
    const onRetry3 = vi.fn();
    queueAbnormalRetry(
      "issue-3",
      "PROJ-3",
      3,
      maxBackoff,
      "error",
      state,
      onRetry3,
      logger
    );

    vi.advanceTimersByTime(39999);
    expect(onRetry3).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRetry3).toHaveBeenCalledTimes(1);
  });

  it("caps delay at maxBackoffMs", () => {
    const state = makeState();
    const logger = makeLogger();
    const onRetry = vi.fn();
    const maxBackoff = 60_000;

    // attempt 10: 10000 * 2^9 = 5_120_000 -> capped at 60000
    queueAbnormalRetry(
      "issue-1",
      "PROJ-1",
      10,
      maxBackoff,
      "error",
      state,
      onRetry,
      logger
    );

    vi.advanceTimersByTime(59999);
    expect(onRetry).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("stores error in retry entry", () => {
    const state = makeState();
    const logger = makeLogger();
    const onRetry = vi.fn();

    queueAbnormalRetry(
      "issue-1",
      "PROJ-1",
      1,
      300_000,
      "process crashed",
      state,
      onRetry,
      logger
    );

    const entry = state.retry_attempts.get("issue-1")!;
    expect(entry.error).toBe("process crashed");
  });

  it("cancels existing retry before creating new one", () => {
    const state = makeState();
    const logger = makeLogger();
    const onRetry1 = vi.fn();
    const onRetry2 = vi.fn();

    queueAbnormalRetry(
      "issue-1",
      "PROJ-1",
      1,
      300_000,
      "err1",
      state,
      onRetry1,
      logger
    );
    queueAbnormalRetry(
      "issue-1",
      "PROJ-1",
      2,
      300_000,
      "err2",
      state,
      onRetry2,
      logger
    );

    // Fast-forward past the longer delay (attempt 2 = 20000ms)
    vi.advanceTimersByTime(20000);

    expect(onRetry1).not.toHaveBeenCalled();
    expect(onRetry2).toHaveBeenCalledWith("issue-1");
  });
});

describe("cancelExistingRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels timer and removes entry from map", () => {
    const state = makeState();
    const logger = makeLogger();
    const onRetry = vi.fn();

    queueNormalRetry("issue-1", "PROJ-1", state, onRetry, logger);
    expect(state.retry_attempts.has("issue-1")).toBe(true);

    cancelExistingRetry("issue-1", state);

    expect(state.retry_attempts.has("issue-1")).toBe(false);

    // Timer should not fire
    vi.advanceTimersByTime(2000);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("is a no-op when no retry exists for the issue", () => {
    const state = makeState();
    expect(() => cancelExistingRetry("nonexistent", state)).not.toThrow();
  });
});

describe("cancelAllRetries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears all pending retry timers", () => {
    const state = makeState();
    const logger = makeLogger();
    const onRetry = vi.fn();

    queueNormalRetry("issue-1", "PROJ-1", state, onRetry, logger);
    queueNormalRetry("issue-2", "PROJ-2", state, onRetry, logger);
    queueAbnormalRetry(
      "issue-3",
      "PROJ-3",
      1,
      300_000,
      "err",
      state,
      onRetry,
      logger
    );

    expect(state.retry_attempts.size).toBe(3);

    cancelAllRetries(state);

    expect(state.retry_attempts.size).toBe(0);

    // No timers should fire
    vi.advanceTimersByTime(300_000);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("is safe to call when no retries are pending", () => {
    const state = makeState();
    expect(() => cancelAllRetries(state)).not.toThrow();
    expect(state.retry_attempts.size).toBe(0);
  });
});
