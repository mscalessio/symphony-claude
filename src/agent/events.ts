import type { ClaudeStreamEvent, WorkerUpdate } from "../types.js";
import { extractSessionId } from "./stream-parser.js";

/**
 * Map a parsed Claude stream event to an orchestrator WorkerUpdate.
 * Returns the appropriate update type or null if the event doesn't
 * map to an orchestrator-relevant update.
 */
export function mapEventToUpdate(event: ClaudeStreamEvent): WorkerUpdate | null {
  // Every event updates the stall timestamp
  const stallUpdate: WorkerUpdate = {
    type: "stall_timestamp",
    timestamp: Date.now(),
  };

  // Session ID extraction
  const sessionId = extractSessionId(event);
  if (sessionId) {
    return { type: "session_id", session_id: sessionId };
  }

  // Forward all events to orchestrator for logging/monitoring
  return { type: "event", event };
}

/**
 * Always emit a stall timestamp update for any event received.
 * This is called separately to ensure stall detection stays current.
 */
export function createStallUpdate(): WorkerUpdate {
  return { type: "stall_timestamp", timestamp: Date.now() };
}
