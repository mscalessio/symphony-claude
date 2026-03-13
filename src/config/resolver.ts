import * as os from "node:os";
import type { WorkflowConfig } from "../types.js";

/**
 * Resolve $VAR references in string values by looking them up in process.env.
 * Expand ~ to os.homedir() in path values.
 *
 * Specifically:
 * - tracker.api_key: if starts with "$", resolve from process.env (throw if not set)
 * - workspace.root: expand leading "~" to os.homedir()
 *
 * Returns a new config with resolved values; the original is not mutated.
 */
export function resolveConfig(config: WorkflowConfig): WorkflowConfig {
  // Deep clone to avoid mutating the original
  const resolved: WorkflowConfig = JSON.parse(JSON.stringify(config));

  // Resolve $VAR in tracker.api_key
  if (resolved.tracker.api_key.startsWith("$")) {
    const envName = resolved.tracker.api_key.slice(1);
    const envValue = process.env[envName];
    if (envValue === undefined || envValue === "") {
      throw new Error(
        `Environment variable "${envName}" is not set (referenced by tracker.api_key)`,
      );
    }
    resolved.tracker.api_key = envValue;
  }

  // Expand ~ in workspace.root
  if (resolved.workspace.root.startsWith("~")) {
    resolved.workspace.root =
      os.homedir() + resolved.workspace.root.slice(1);
  }

  return resolved;
}
