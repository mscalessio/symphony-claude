import type { FastifyInstance } from "fastify";
import type { Orchestrator } from "../orchestrator/orchestrator.js";
import { renderDashboard } from "./dashboard.js";

/**
 * Register REST API routes on the Fastify instance.
 */
export function registerRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  // HTML Dashboard
  app.get("/", async (_req, reply) => {
    const state = orchestrator.getState();
    const config = orchestrator.getConfig();
    const html = renderDashboard(state, config);
    return reply.type("text/html").send(html);
  });

  // Full state snapshot
  app.get("/api/v1/state", async () => {
    const state = orchestrator.getState();
    return {
      poll_interval_ms: state.poll_interval_ms,
      max_concurrent_agents: state.max_concurrent_agents,
      running: Object.fromEntries(
        Array.from(state.running.entries()).map(([id, entry]) => [
          id,
          {
            issue_id: entry.issue_id,
            identifier: entry.identifier,
            state: entry.state,
            started_at: entry.started_at,
            last_codex_timestamp: entry.last_codex_timestamp,
            ssh_host: entry.ssh_host,
            session_id: entry.session_id,
            attempt: entry.attempt,
          },
        ])
      ),
      claimed: Array.from(state.claimed),
      retry_queue: Array.from(state.retry_attempts.entries()).map(([id, entry]) => ({
        issue_id: entry.issue_id,
        identifier: entry.identifier,
        attempt: entry.attempt,
        due_at_ms: entry.due_at_ms,
        error: entry.error,
      })),
      completed: Array.from(state.completed),
      codex_totals: state.codex_totals,
      codex_rate_limits: state.codex_rate_limits,
    };
  });

  // Issue-specific runtime details
  app.get<{ Params: { identifier: string } }>("/api/v1/:identifier", async (req, reply) => {
    const { identifier } = req.params;
    const state = orchestrator.getState();

    // Search running
    for (const entry of state.running.values()) {
      if (entry.identifier === identifier) {
        return {
          issue_id: entry.issue_id,
          identifier: entry.identifier,
          status: "running",
          state: entry.state,
          started_at: entry.started_at,
          last_codex_timestamp: entry.last_codex_timestamp,
          ssh_host: entry.ssh_host,
          session_id: entry.session_id,
          attempt: entry.attempt,
        };
      }
    }

    // Search retry queue
    for (const entry of state.retry_attempts.values()) {
      if (entry.identifier === identifier) {
        return {
          issue_id: entry.issue_id,
          identifier: entry.identifier,
          status: "retry_pending",
          attempt: entry.attempt,
          due_at_ms: entry.due_at_ms,
          error: entry.error,
        };
      }
    }

    // Check completed
    // We only have IDs in completed, but we can still report it
    return reply.code(404).send({
      error: { code: "not_found", message: `Issue ${identifier} not found in running, retry, or completed state` },
    });
  });

  // Trigger immediate poll
  app.post("/api/v1/refresh", async (_req, reply) => {
    orchestrator.triggerPoll();
    return reply.code(202).send({ status: "accepted", message: "Poll cycle triggered" });
  });
}
