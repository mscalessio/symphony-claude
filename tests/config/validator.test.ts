import { describe, it, expect } from "vitest";
import { validateConfig } from "../../src/config/validator.js";
import type { WorkflowConfig } from "../../src/types.js";

function makeValidConfig(overrides?: Record<string, any>): WorkflowConfig {
  const base: WorkflowConfig = {
    tracker: {
      kind: "linear",
      endpoint: "https://api.linear.app/graphql",
      api_key: "lin_api_resolved_key",
      project_slug: "my-project",
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

  if (overrides) {
    return JSON.parse(
      JSON.stringify(base, (key, value) =>
        key in overrides ? overrides[key] : value
      )
    );
  }
  return base;
}

describe("validateConfig", () => {
  it("accepts a valid config with no errors", () => {
    const config = makeValidConfig();
    const result = validateConfig(config);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects invalid tracker.kind", () => {
    const config = makeValidConfig();
    config.tracker.kind = "jira";

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('tracker.kind must be "linear"')
    );
  });

  it("rejects unresolved api_key starting with $", () => {
    const config = makeValidConfig();
    config.tracker.api_key = "$LINEAR_API_KEY";

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("tracker.api_key is unresolved")
    );
  });

  it("rejects empty project_slug", () => {
    const config = makeValidConfig();
    config.tracker.project_slug = "";

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("tracker.project_slug must be non-empty")
    );
  });

  it("rejects empty workspace.root", () => {
    const config = makeValidConfig();
    config.workspace.root = "";

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("workspace.root must be non-empty")
    );
  });

  it("rejects max_concurrent_agents <= 0", () => {
    const config = makeValidConfig();
    config.agent.max_concurrent_agents = 0;

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("agent.max_concurrent_agents must be > 0")
    );
  });

  it("rejects negative max_concurrent_agents", () => {
    const config = makeValidConfig();
    config.agent.max_concurrent_agents = -1;

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("agent.max_concurrent_agents must be > 0")
    );
  });

  it("rejects empty codex.command", () => {
    const config = makeValidConfig();
    config.codex.command = "";

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("codex.command must be non-empty")
    );
  });

  it("rejects polling.interval_ms <= 0", () => {
    const config = makeValidConfig();
    config.polling.interval_ms = 0;

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("polling.interval_ms must be > 0")
    );
  });

  it("rejects active_state that appears in terminal_states", () => {
    const config = makeValidConfig();
    config.tracker.active_states = ["Todo", "Done"];
    config.tracker.terminal_states = ["Done", "Cancelled"];

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'active_state "Done" also appears in terminal_states'
      )
    );
  });

  it("detects active/terminal overlap case-insensitively", () => {
    const config = makeValidConfig();
    config.tracker.active_states = ["todo", "DONE"];
    config.tracker.terminal_states = ["done", "Cancelled"];

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'active_state "DONE" also appears in terminal_states'
      )
    );
  });

  it("reports multiple errors at once", () => {
    const config = makeValidConfig();
    config.tracker.kind = "jira";
    config.tracker.api_key = "$UNRESOLVED";
    config.tracker.project_slug = "";
    config.agent.max_concurrent_agents = 0;

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});
