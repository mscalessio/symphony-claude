import type pino from "pino";
import type { OrchestratorState, TrackerAdapter, WorkflowConfig } from "../types.js";
import type { WorkspaceManager } from "../workspace/manager.js";

/**
 * Reconcile running workers against tracker state and stall detection.
 * Runs every tick before dispatch.
 */
export async function reconcile(
  state: OrchestratorState,
  config: WorkflowConfig,
  tracker: TrackerAdapter,
  workspaceManager: WorkspaceManager,
  onStall: (issueId: string, identifier: string, attempt: number) => void,
  logger: pino.Logger
): Promise<void> {
  // Part A: Stall detection
  detectStalls(state, config, onStall, logger);

  // Part B: Tracker state refresh
  await refreshTrackerState(state, config, tracker, workspaceManager, logger);
}

/**
 * Part A: Detect stalled workers.
 * If elapsed time since last activity > stall_timeout_ms, signal stall.
 */
function detectStalls(
  state: OrchestratorState,
  config: WorkflowConfig,
  onStall: (issueId: string, identifier: string, attempt: number) => void,
  logger: pino.Logger
): void {
  if (config.codex.stall_timeout_ms <= 0) return;

  const now = Date.now();

  for (const [issueId, entry] of state.running) {
    const lastActivity = entry.last_codex_timestamp ?? entry.started_at;
    const elapsed = now - lastActivity;

    if (elapsed > config.codex.stall_timeout_ms) {
      logger.warn(
        { issue_id: issueId, identifier: entry.identifier, elapsed_ms: elapsed },
        "Worker stalled, triggering abort"
      );

      // Abort the worker
      entry.worker_abort.abort();

      // Remove from running
      state.running.delete(issueId);

      // Signal stall for retry
      onStall(issueId, entry.identifier, entry.attempt);
    }
  }
}

/**
 * Part B: Refresh tracker state for running workers.
 * Terminal state → kill + clean workspace
 * Active state → update snapshot
 * Neither → kill, no cleanup
 * Fetch failure → keep workers, try next tick
 */
async function refreshTrackerState(
  state: OrchestratorState,
  config: WorkflowConfig,
  tracker: TrackerAdapter,
  workspaceManager: WorkspaceManager,
  logger: pino.Logger
): Promise<void> {
  const runningIds = Array.from(state.running.keys());
  if (runningIds.length === 0) return;

  let issueStates: Map<string, { id: string; state: string; identifier: string }>;
  try {
    issueStates = await tracker.fetchIssueStatesByIds(runningIds);
  } catch (err) {
    logger.warn({ err }, "Failed to fetch tracker states for reconciliation, will retry next tick");
    return;
  }

  const terminalStatesLower = config.tracker.terminal_states.map(s => s.toLowerCase());
  const activeStatesLower = config.tracker.active_states.map(s => s.toLowerCase());

  for (const [issueId, entry] of state.running) {
    const current = issueStates.get(issueId);
    if (!current) continue;

    const currentStateLower = current.state.toLowerCase();

    if (terminalStatesLower.includes(currentStateLower)) {
      logger.info(
        { issue_id: issueId, identifier: entry.identifier, state: current.state },
        "Issue reached terminal state, killing worker and cleaning workspace"
      );

      entry.worker_abort.abort();
      state.running.delete(issueId);
      state.claimed.delete(issueId);
      state.completed.add(issueId);

      // Clean workspace (best-effort)
      try {
        await workspaceManager.removeWorkspace(entry.identifier);
      } catch (err) {
        logger.warn({ err, identifier: entry.identifier }, "Failed to remove workspace during reconciliation");
      }
    } else if (activeStatesLower.includes(currentStateLower)) {
      // Update in-memory state snapshot
      entry.state = current.state;
    } else {
      // Neither active nor terminal — kill worker, no cleanup
      logger.info(
        { issue_id: issueId, identifier: entry.identifier, state: current.state },
        "Issue in unexpected state, killing worker"
      );
      entry.worker_abort.abort();
      state.running.delete(issueId);
      state.claimed.delete(issueId);
    }
  }
}
