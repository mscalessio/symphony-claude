import type { Issue, OrchestratorState, WorkflowConfig } from "../types.js";

/**
 * Determine if an issue is eligible for dispatch.
 */
export function shouldDispatch(
  issue: Issue,
  state: OrchestratorState,
  config: WorkflowConfig
): boolean {
  const { running, claimed, completed } = state;

  // Already running or claimed
  if (running.has(issue.id) || claimed.has(issue.id)) return false;

  // Already completed in this session
  if (completed.has(issue.id)) return false;

  // Check state is active and not terminal
  const activeStatesLower = config.tracker.active_states.map(s => s.toLowerCase());
  const terminalStatesLower = config.tracker.terminal_states.map(s => s.toLowerCase());
  const issueStateLower = issue.state.toLowerCase();

  if (!activeStatesLower.includes(issueStateLower)) return false;
  if (terminalStatesLower.includes(issueStateLower)) return false;

  // Global concurrency check
  if (!hasGlobalSlot(state)) return false;

  // Per-state concurrency check
  if (!hasStateSlot(issue.state, state, config)) return false;

  // Todo blocker rule: if state is "todo", all blockers must be in terminal states
  if (issueStateLower === "todo" && issue.blockers.length > 0) {
    const allBlockersTerminal = issue.blockers.every(b =>
      terminalStatesLower.includes(b.state.toLowerCase())
    );
    if (!allBlockersTerminal) return false;
  }

  return true;
}

/**
 * Check if there's a global concurrency slot available.
 */
export function hasGlobalSlot(state: OrchestratorState): boolean {
  return state.running.size < state.max_concurrent_agents;
}

/**
 * Check if there's a per-state concurrency slot available.
 */
export function hasStateSlot(
  issueState: string,
  state: OrchestratorState,
  config: WorkflowConfig
): boolean {
  const stateLower = issueState.toLowerCase();
  const limit = config.agent.max_concurrent_agents_by_state[stateLower];
  if (limit === undefined) return true; // No per-state limit

  let count = 0;
  for (const entry of state.running.values()) {
    if (entry.state.toLowerCase() === stateLower) count++;
  }

  return count < limit;
}

/**
 * Sort issues for dispatch priority.
 * Order: priority asc (null last) → created_at oldest first → identifier lexicographic
 */
export function sortForDispatch(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    // Priority: ascending, null last
    const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;

    // Created at: oldest first
    const ca = new Date(a.created_at).getTime();
    const cb = new Date(b.created_at).getTime();
    if (ca !== cb) return ca - cb;

    // Identifier: lexicographic
    return a.identifier.localeCompare(b.identifier);
  });
}
