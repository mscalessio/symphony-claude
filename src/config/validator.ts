import type { WorkflowConfig } from "../types.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Preflight validation before the orchestrator can dispatch.
 *
 * Checks:
 * - tracker.kind is "linear"
 * - tracker.api_key is resolved (not starting with $)
 * - tracker.project_slug is non-empty
 * - workspace.root is non-empty
 * - agent.max_concurrent_agents > 0
 * - codex.command is non-empty
 * - polling.interval_ms > 0
 * - No active_state appears in terminal_states (case-insensitive)
 */
export function validateConfig(config: WorkflowConfig): ValidationResult {
  const errors: string[] = [];

  // tracker.kind must be "linear"
  if (config.tracker.kind !== "linear") {
    errors.push(
      `tracker.kind must be "linear", got "${config.tracker.kind}"`,
    );
  }

  // tracker.api_key must be resolved (not starting with $)
  if (config.tracker.api_key.startsWith("$")) {
    errors.push(
      "tracker.api_key is unresolved (still starts with $); run resolveConfig first",
    );
  }

  // tracker.project_slug must be non-empty
  if (!config.tracker.project_slug) {
    errors.push("tracker.project_slug must be non-empty");
  }

  // workspace.root must be non-empty
  if (!config.workspace.root) {
    errors.push("workspace.root must be non-empty");
  }

  // agent.max_concurrent_agents must be > 0
  if (config.agent.max_concurrent_agents <= 0) {
    errors.push(
      `agent.max_concurrent_agents must be > 0, got ${config.agent.max_concurrent_agents}`,
    );
  }

  // codex.command must be non-empty
  if (!config.codex.command) {
    errors.push("codex.command must be non-empty");
  }

  // polling.interval_ms must be > 0
  if (config.polling.interval_ms <= 0) {
    errors.push(
      `polling.interval_ms must be > 0, got ${config.polling.interval_ms}`,
    );
  }

  // No active_state may appear in terminal_states (case-insensitive)
  const terminalLower = new Set(
    config.tracker.terminal_states.map((s) => s.toLowerCase()),
  );
  for (const active of config.tracker.active_states) {
    if (terminalLower.has(active.toLowerCase())) {
      errors.push(
        `active_state "${active}" also appears in terminal_states (overlap is not allowed)`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
