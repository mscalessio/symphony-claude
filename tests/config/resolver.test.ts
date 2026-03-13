import os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveConfig } from "../../src/config/resolver.js";
import type { WorkflowConfig } from "../../src/types.js";

function makeMinimalConfig(overrides?: Partial<{
  api_key: string;
  root: string;
}>): WorkflowConfig {
  return {
    tracker: {
      kind: "linear",
      endpoint: "https://api.linear.app/graphql",
      api_key: overrides?.api_key ?? "$TEST_API_KEY",
      project_slug: "my-project",
      active_states: ["Todo", "In Progress"],
      terminal_states: ["Done", "Cancelled"],
    },
    polling: { interval_ms: 30000 },
    workspace: { root: overrides?.root ?? "/tmp/workspaces" },
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
}

describe("resolveConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("resolves $VAR in api_key from environment variable", () => {
    process.env.TEST_API_KEY = "lin_api_secret_123";
    const config = makeMinimalConfig({ api_key: "$TEST_API_KEY" });

    const resolved = resolveConfig(config);

    expect(resolved.tracker.api_key).toBe("lin_api_secret_123");
  });

  it("throws when the referenced environment variable is not set", () => {
    delete process.env.MISSING_VAR;
    const config = makeMinimalConfig({ api_key: "$MISSING_VAR" });

    expect(() => resolveConfig(config)).toThrow(
      'Environment variable "MISSING_VAR" is not set'
    );
  });

  it("throws when the referenced environment variable is empty string", () => {
    process.env.EMPTY_VAR = "";
    const config = makeMinimalConfig({ api_key: "$EMPTY_VAR" });

    expect(() => resolveConfig(config)).toThrow(
      'Environment variable "EMPTY_VAR" is not set'
    );
  });

  it("expands ~ in workspace.root to home directory", () => {
    process.env.TEST_API_KEY = "some-key";
    const config = makeMinimalConfig({ root: "~/my-workspaces" });

    const resolved = resolveConfig(config);

    expect(resolved.workspace.root).toBe(
      os.homedir() + "/my-workspaces"
    );
  });

  it("does not expand ~ when root does not start with ~", () => {
    process.env.TEST_API_KEY = "some-key";
    const config = makeMinimalConfig({ root: "/absolute/path" });

    const resolved = resolveConfig(config);

    expect(resolved.workspace.root).toBe("/absolute/path");
  });

  it("returns a new object and does not mutate the original", () => {
    process.env.TEST_API_KEY = "secret";
    const config = makeMinimalConfig({ api_key: "$TEST_API_KEY" });
    const originalApiKey = config.tracker.api_key;

    const resolved = resolveConfig(config);

    // Original should be unchanged
    expect(config.tracker.api_key).toBe(originalApiKey);
    expect(config.tracker.api_key).toBe("$TEST_API_KEY");

    // Resolved should be different object
    expect(resolved).not.toBe(config);
    expect(resolved.tracker.api_key).toBe("secret");
  });

  it("passes through api_key that does not start with $", () => {
    const config = makeMinimalConfig({ api_key: "literal_key_value" });

    const resolved = resolveConfig(config);

    expect(resolved.tracker.api_key).toBe("literal_key_value");
  });
});
