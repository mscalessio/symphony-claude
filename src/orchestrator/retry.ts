import type pino from "pino";
import type { OrchestratorState, RetryEntry, Issue } from "../types.js";

export type RetryDispatchFn = (issueId: string) => void;

/**
 * Queue a normal (continuation) retry after a successful worker exit.
 * Delay: 1000ms, attempt: 1
 */
export function queueNormalRetry(
  issueId: string,
  identifier: string,
  state: OrchestratorState,
  onRetry: RetryDispatchFn,
  logger: pino.Logger
): void {
  cancelExistingRetry(issueId, state);

  const delay = 1000;
  const attempt = 1;

  logger.info({ issue_id: issueId, identifier, delay, attempt }, "Queuing normal retry");

  const timer = setTimeout(() => {
    state.retry_attempts.delete(issueId);
    onRetry(issueId);
  }, delay);

  state.retry_attempts.set(issueId, {
    issue_id: issueId,
    identifier,
    attempt,
    due_at_ms: Date.now() + delay,
    timer_handle: timer,
    error: null,
  });
}

/**
 * Queue an abnormal (error) retry with exponential backoff.
 * Delay: min(10000 * 2^(attempt-1), max_retry_backoff_ms)
 */
export function queueAbnormalRetry(
  issueId: string,
  identifier: string,
  attempt: number,
  maxBackoffMs: number,
  error: string,
  state: OrchestratorState,
  onRetry: RetryDispatchFn,
  logger: pino.Logger
): void {
  cancelExistingRetry(issueId, state);

  const delay = Math.min(10_000 * Math.pow(2, attempt - 1), maxBackoffMs);

  logger.info({ issue_id: issueId, identifier, delay, attempt, error }, "Queuing abnormal retry");

  const timer = setTimeout(() => {
    state.retry_attempts.delete(issueId);
    onRetry(issueId);
  }, delay);

  state.retry_attempts.set(issueId, {
    issue_id: issueId,
    identifier,
    attempt,
    due_at_ms: Date.now() + delay,
    timer_handle: timer,
    error,
  });
}

/**
 * Cancel an existing retry timer for the given issue.
 */
export function cancelExistingRetry(
  issueId: string,
  state: OrchestratorState
): void {
  const existing = state.retry_attempts.get(issueId);
  if (existing) {
    clearTimeout(existing.timer_handle);
    state.retry_attempts.delete(issueId);
  }
}

/**
 * Release a claim on an issue (remove from claimed set).
 */
export function releaseClaim(issueId: string, state: OrchestratorState): void {
  state.claimed.delete(issueId);
}

/**
 * Cancel all pending retry timers. Used during shutdown.
 */
export function cancelAllRetries(state: OrchestratorState): void {
  for (const [, entry] of state.retry_attempts) {
    clearTimeout(entry.timer_handle);
  }
  state.retry_attempts.clear();
}
