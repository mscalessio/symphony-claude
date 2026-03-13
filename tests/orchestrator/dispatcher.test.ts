import { describe, it, expect } from "vitest";
import {
  shouldDispatch,
  sortForDispatch,
  hasGlobalSlot,
  hasStateSlot,
} from "../../src/orchestrator/dispatcher.js";
import type {
  Issue,
  OrchestratorState,
  RunningEntry,
  WorkflowConfig,
} from "../../src/types.js";

function makeIssue(overrides?: Partial<Issue>): Issue {
  return {
    id: "issue-1",
    identifier: "PROJ-1",
    title: "Test Issue",
    description: null,
    state: "Todo",
    priority: 1,
    created_at: "2025-01-01T00:00:00Z",
    labels: [],
    blockers: [],
    ...overrides,
  };
}

function makeRunningEntry(overrides?: Partial<RunningEntry>): RunningEntry {
  return {
    issue_id: "running-1",
    identifier: "PROJ-99",
    state: "In Progress",
    started_at: Date.now(),
    last_codex_timestamp: null,
    worker_abort: new AbortController(),
    ssh_host: null,
    session_id: null,
    attempt: 1,
    ...overrides,
  };
}

function makeState(overrides?: Partial<OrchestratorState>): OrchestratorState {
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
    ...overrides,
  };
}

function makeConfig(overrides?: Record<string, any>): WorkflowConfig {
  return {
    tracker: {
      kind: "linear",
      endpoint: "https://api.linear.app/graphql",
      api_key: "resolved_key",
      project_slug: "proj",
      active_states: ["Todo", "In Progress"],
      terminal_states: ["Done", "Cancelled"],
    },
    polling: { interval_ms: 30000 },
    workspace: { root: "/tmp/workspaces" },
    hooks: {
      after_create: null,
      before_run: null,
      after_run: null,
      before_remove: null,
      timeout_ms: 60000,
    },
    agent: {
      max_concurrent_agents: 5,
      max_turns: 20,
      max_retry_backoff_ms: 300000,
      max_concurrent_agents_by_state: {},
      ...overrides?.agent,
    },
    codex: {
      command: "claude",
      approval_policy: "bypassPermissions",
      turn_timeout_ms: 3600000,
      read_timeout_ms: 5000,
      stall_timeout_ms: 300000,
    },
    server: { port: null },
    worker: { ssh_hosts: null, max_concurrent_agents_per_host: null },
  };
}

describe("shouldDispatch", () => {
  it("returns true for an eligible issue", () => {
    const issue = makeIssue({ state: "Todo" });
    const state = makeState();
    const config = makeConfig();

    expect(shouldDispatch(issue, state, config)).toBe(true);
  });

  it("returns false when issue is already running", () => {
    const issue = makeIssue({ id: "issue-1", state: "Todo" });
    const running = new Map<string, RunningEntry>();
    running.set("issue-1", makeRunningEntry({ issue_id: "issue-1" }));
    const state = makeState({ running });
    const config = makeConfig();

    expect(shouldDispatch(issue, state, config)).toBe(false);
  });

  it("returns false when issue is claimed", () => {
    const issue = makeIssue({ id: "issue-1", state: "Todo" });
    const state = makeState({ claimed: new Set(["issue-1"]) });
    const config = makeConfig();

    expect(shouldDispatch(issue, state, config)).toBe(false);
  });

  it("returns false when issue is completed", () => {
    const issue = makeIssue({ id: "issue-1", state: "Todo" });
    const state = makeState({ completed: new Set(["issue-1"]) });
    const config = makeConfig();

    expect(shouldDispatch(issue, state, config)).toBe(false);
  });

  it("returns false when issue state is terminal", () => {
    const issue = makeIssue({ state: "Done" });
    const state = makeState();
    // "Done" is in terminal_states but also needs to be in active_states
    // to pass the active check. Since it is NOT in active_states, it fails.
    const config = makeConfig();

    expect(shouldDispatch(issue, state, config)).toBe(false);
  });

  it("returns false when issue state is not in active_states", () => {
    const issue = makeIssue({ state: "Backlog" });
    const state = makeState();
    const config = makeConfig();

    expect(shouldDispatch(issue, state, config)).toBe(false);
  });

  it("returns false when no global slots available", () => {
    const issue = makeIssue({ state: "Todo" });
    const running = new Map<string, RunningEntry>();
    for (let i = 0; i < 5; i++) {
      running.set(`r-${i}`, makeRunningEntry({ issue_id: `r-${i}` }));
    }
    const state = makeState({ running, max_concurrent_agents: 5 });
    const config = makeConfig();

    expect(shouldDispatch(issue, state, config)).toBe(false);
  });

  it("returns false when no per-state slots available", () => {
    const issue = makeIssue({ state: "Todo" });
    const running = new Map<string, RunningEntry>();
    running.set("r-0", makeRunningEntry({ issue_id: "r-0", state: "Todo" }));
    const state = makeState({ running });
    const config = makeConfig({
      agent: {
        max_concurrent_agents: 5,
        max_turns: 20,
        max_retry_backoff_ms: 300000,
        max_concurrent_agents_by_state: { todo: 1 },
      },
    });

    expect(shouldDispatch(issue, state, config)).toBe(false);
  });

  it("returns false for todo issue with unresolved blockers", () => {
    const issue = makeIssue({
      state: "Todo",
      blockers: [
        { id: "blocker-1", identifier: "PROJ-10", state: "In Progress" },
      ],
    });
    const state = makeState();
    const config = makeConfig();

    expect(shouldDispatch(issue, state, config)).toBe(false);
  });

  it("returns true for todo issue when all blockers are in terminal states", () => {
    const issue = makeIssue({
      state: "Todo",
      blockers: [
        { id: "blocker-1", identifier: "PROJ-10", state: "Done" },
        { id: "blocker-2", identifier: "PROJ-11", state: "Cancelled" },
      ],
    });
    const state = makeState();
    const config = makeConfig();

    expect(shouldDispatch(issue, state, config)).toBe(true);
  });

  it("handles case-insensitive state matching for active states", () => {
    const issue = makeIssue({ state: "todo" });
    const state = makeState();
    const config = makeConfig();

    expect(shouldDispatch(issue, state, config)).toBe(true);
  });
});

describe("sortForDispatch", () => {
  it("sorts by priority ascending", () => {
    const issues = [
      makeIssue({ id: "a", identifier: "A", priority: 3 }),
      makeIssue({ id: "b", identifier: "B", priority: 1 }),
      makeIssue({ id: "c", identifier: "C", priority: 2 }),
    ];

    const sorted = sortForDispatch(issues);

    expect(sorted.map((i) => i.priority)).toEqual([1, 2, 3]);
  });

  it("places null priority last", () => {
    const issues = [
      makeIssue({ id: "a", identifier: "A", priority: null }),
      makeIssue({ id: "b", identifier: "B", priority: 2 }),
      makeIssue({ id: "c", identifier: "C", priority: 1 }),
    ];

    const sorted = sortForDispatch(issues);

    expect(sorted.map((i) => i.priority)).toEqual([1, 2, null]);
  });

  it("uses created_at as tiebreaker (oldest first)", () => {
    const issues = [
      makeIssue({
        id: "a",
        identifier: "A",
        priority: 1,
        created_at: "2025-03-01T00:00:00Z",
      }),
      makeIssue({
        id: "b",
        identifier: "B",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
      }),
      makeIssue({
        id: "c",
        identifier: "C",
        priority: 1,
        created_at: "2025-02-01T00:00:00Z",
      }),
    ];

    const sorted = sortForDispatch(issues);

    expect(sorted.map((i) => i.identifier)).toEqual(["B", "C", "A"]);
  });

  it("uses identifier as final tiebreaker (lexicographic)", () => {
    const ts = "2025-01-01T00:00:00Z";
    const issues = [
      makeIssue({ id: "c", identifier: "PROJ-3", priority: 1, created_at: ts }),
      makeIssue({ id: "a", identifier: "PROJ-1", priority: 1, created_at: ts }),
      makeIssue({ id: "b", identifier: "PROJ-2", priority: 1, created_at: ts }),
    ];

    const sorted = sortForDispatch(issues);

    expect(sorted.map((i) => i.identifier)).toEqual([
      "PROJ-1",
      "PROJ-2",
      "PROJ-3",
    ]);
  });

  it("does not mutate the original array", () => {
    const issues = [
      makeIssue({ id: "b", identifier: "B", priority: 2 }),
      makeIssue({ id: "a", identifier: "A", priority: 1 }),
    ];
    const original = [...issues];

    sortForDispatch(issues);

    expect(issues.map((i) => i.id)).toEqual(original.map((i) => i.id));
  });

  it("handles empty array", () => {
    expect(sortForDispatch([])).toEqual([]);
  });
});

describe("hasGlobalSlot", () => {
  it("returns true when running count is below max", () => {
    const state = makeState({ max_concurrent_agents: 3 });
    expect(hasGlobalSlot(state)).toBe(true);
  });

  it("returns false when running count equals max", () => {
    const running = new Map<string, RunningEntry>();
    running.set("a", makeRunningEntry({ issue_id: "a" }));
    running.set("b", makeRunningEntry({ issue_id: "b" }));
    const state = makeState({ running, max_concurrent_agents: 2 });

    expect(hasGlobalSlot(state)).toBe(false);
  });

  it("returns false when running count exceeds max", () => {
    const running = new Map<string, RunningEntry>();
    running.set("a", makeRunningEntry({ issue_id: "a" }));
    running.set("b", makeRunningEntry({ issue_id: "b" }));
    running.set("c", makeRunningEntry({ issue_id: "c" }));
    const state = makeState({ running, max_concurrent_agents: 2 });

    expect(hasGlobalSlot(state)).toBe(false);
  });

  it("returns true when no agents are running", () => {
    const state = makeState({ max_concurrent_agents: 1 });
    expect(hasGlobalSlot(state)).toBe(true);
  });
});

describe("hasStateSlot", () => {
  it("returns true when no per-state limit is configured", () => {
    const state = makeState();
    const config = makeConfig();

    expect(hasStateSlot("Todo", state, config)).toBe(true);
  });

  it("returns true when running count for state is below limit", () => {
    const running = new Map<string, RunningEntry>();
    running.set("a", makeRunningEntry({ issue_id: "a", state: "Todo" }));
    const state = makeState({ running });
    const config = makeConfig({
      agent: {
        max_concurrent_agents: 5,
        max_turns: 20,
        max_retry_backoff_ms: 300000,
        max_concurrent_agents_by_state: { todo: 2 },
      },
    });

    expect(hasStateSlot("Todo", state, config)).toBe(true);
  });

  it("returns false when running count for state equals limit", () => {
    const running = new Map<string, RunningEntry>();
    running.set("a", makeRunningEntry({ issue_id: "a", state: "Todo" }));
    running.set("b", makeRunningEntry({ issue_id: "b", state: "Todo" }));
    const state = makeState({ running });
    const config = makeConfig({
      agent: {
        max_concurrent_agents: 5,
        max_turns: 20,
        max_retry_backoff_ms: 300000,
        max_concurrent_agents_by_state: { todo: 2 },
      },
    });

    expect(hasStateSlot("Todo", state, config)).toBe(false);
  });

  it("matches state names case-insensitively", () => {
    const running = new Map<string, RunningEntry>();
    running.set("a", makeRunningEntry({ issue_id: "a", state: "TODO" }));
    const state = makeState({ running });
    const config = makeConfig({
      agent: {
        max_concurrent_agents: 5,
        max_turns: 20,
        max_retry_backoff_ms: 300000,
        max_concurrent_agents_by_state: { todo: 1 },
      },
    });

    expect(hasStateSlot("Todo", state, config)).toBe(false);
  });

  it("does not count running entries in different states", () => {
    const running = new Map<string, RunningEntry>();
    running.set(
      "a",
      makeRunningEntry({ issue_id: "a", state: "In Progress" })
    );
    running.set(
      "b",
      makeRunningEntry({ issue_id: "b", state: "In Progress" })
    );
    const state = makeState({ running });
    const config = makeConfig({
      agent: {
        max_concurrent_agents: 5,
        max_turns: 20,
        max_retry_backoff_ms: 300000,
        max_concurrent_agents_by_state: { todo: 1 },
      },
    });

    expect(hasStateSlot("Todo", state, config)).toBe(true);
  });
});
