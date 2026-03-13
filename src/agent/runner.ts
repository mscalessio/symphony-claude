import path from "node:path";
import fs from "node:fs/promises";
import type pino from "pino";
import type {
  Issue, WorkflowConfig, WorkerResult, WorkerCallback,
  TrackerAdapter, TurnResult,
} from "../types.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { runHook } from "../workspace/hooks.js";
import { buildPrompt } from "../prompt/builder.js";
import { spawnClaudeTurn } from "./claude-process.js";
import { createStallUpdate } from "./events.js";

export interface RunWorkerOpts {
  issue: Issue;
  attempt: number;
  config: WorkflowConfig;
  promptTemplate: string;
  tracker: TrackerAdapter;
  workspaceManager: WorkspaceManager;
  abortController: AbortController;
  callback: WorkerCallback;
  logger: pino.Logger;
}

/**
 * Run a complete worker lifecycle for an issue.
 * Manages workspace creation, multi-turn claude sessions, and cleanup.
 */
export async function runWorker(opts: RunWorkerOpts): Promise<WorkerResult> {
  const {
    issue, attempt, config, promptTemplate, tracker,
    workspaceManager, abortController, callback, logger,
  } = opts;

  const totalUsage = { input_tokens: 0, output_tokens: 0 };
  let totalCost = 0;
  let turnNumber = 0;
  let sessionId: string | null = null;

  const makeResult = (success: boolean, error: string | null): WorkerResult => ({
    issue_id: issue.id,
    identifier: issue.identifier,
    success,
    error,
    turns: turnNumber,
    total_usage: { ...totalUsage },
    total_cost_usd: totalCost,
  });

  // 1. Create workspace
  let wsPath: string;
  try {
    const ws = await workspaceManager.createForIssue(issue.identifier);
    wsPath = ws.path;
  } catch (err) {
    logger.error({ err }, "Failed to create workspace");
    return makeResult(false, `Workspace creation failed: ${err}`);
  }

  // 2. Generate MCP config for linear_graphql tool
  let mcpConfigPath: string | undefined;
  try {
    mcpConfigPath = await writeMcpConfig(wsPath, config);
  } catch (err) {
    logger.warn({ err }, "Failed to write MCP config, continuing without it");
  }

  // 3. Run before_run hook
  if (config.hooks.before_run) {
    try {
      await runHook(config.hooks.before_run, wsPath, config.hooks.timeout_ms, logger);
    } catch (err) {
      logger.error({ err }, "before_run hook failed");
      return makeResult(false, `before_run hook failed: ${err}`);
    }
  }

  // 4. Multi-turn loop
  try {
    while (true) {
      if (abortController.signal.aborted) {
        return makeResult(false, "Aborted");
      }

      turnNumber++;
      callback({ type: "turn_start", turn: turnNumber });

      // Build prompt
      let prompt: string;
      try {
        prompt = await buildPrompt(promptTemplate, issue, attempt, turnNumber);
      } catch (err) {
        logger.error({ err, turn: turnNumber }, "Failed to build prompt");
        return makeResult(false, `Prompt build failed: ${err}`);
      }

      logger.info({ turn: turnNumber, sessionId }, "Starting claude turn");

      // Run claude turn
      const turnResult = await spawnClaudeTurn({
        prompt,
        cwd: wsPath,
        sessionId: sessionId ?? undefined,
        permissionMode: config.codex.approval_policy,
        mcpConfigPath,
        abortSignal: abortController.signal,
        turnTimeoutMs: config.codex.turn_timeout_ms,
        command: config.codex.command,
        onPid: (pid) => callback({ type: "pid", pid }),
        onEvent: (event) => {
          callback(createStallUpdate());
          callback({ type: "event", event });

          // Extract session ID
          if (event.type === "system" && event.session_id) {
            sessionId = event.session_id;
            callback({ type: "session_id", session_id: sessionId });
          }
        },
        logger,
      });

      // Accumulate usage
      totalUsage.input_tokens += turnResult.usage.input_tokens;
      totalUsage.output_tokens += turnResult.usage.output_tokens;
      totalCost += turnResult.cost_usd;

      if (turnResult.sessionId) {
        sessionId = turnResult.sessionId;
      }

      callback({ type: "turn_complete", turn: turnNumber, result: turnResult });

      if (!turnResult.success) {
        logger.warn({ turn: turnNumber, error: turnResult.error }, "Turn failed");
        return makeResult(false, turnResult.error);
      }

      logger.info({ turn: turnNumber }, "Turn completed successfully");

      // Check if issue is still in active state
      try {
        const states = await tracker.fetchIssueStatesByIds([issue.id]);
        const current = states.get(issue.id);
        if (!current) {
          logger.warn("Issue not found during state check, stopping");
          break;
        }

        const activeStatesLower = config.tracker.active_states.map(s => s.toLowerCase());
        if (!activeStatesLower.includes(current.state.toLowerCase())) {
          logger.info({ state: current.state }, "Issue no longer in active state, stopping");
          break;
        }
      } catch (err) {
        logger.error({ err }, "Failed to fetch issue state, stopping");
        return makeResult(false, `State check failed: ${err}`);
      }

      // Check max turns
      if (turnNumber >= config.agent.max_turns) {
        logger.info({ maxTurns: config.agent.max_turns }, "Max turns reached");
        break;
      }
    }
  } finally {
    // 5. Run after_run hook (best-effort)
    if (config.hooks.after_run) {
      try {
        await runHook(config.hooks.after_run, wsPath, config.hooks.timeout_ms, logger);
      } catch (err) {
        logger.warn({ err }, "after_run hook failed (ignored)");
      }
    }
  }

  return makeResult(true, null);
}

/**
 * Write an MCP config file for the linear_graphql tool.
 * Returns the path to the config file.
 */
async function writeMcpConfig(
  wsPath: string,
  config: WorkflowConfig
): Promise<string> {
  // Find the path to our linear-graphql-server.js
  // It's bundled alongside our code in the dist directory
  const serverPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../tools/linear-graphql-server.js"
  );

  const mcpConfig = {
    mcpServers: {
      "symphony-linear": {
        command: "node",
        args: [serverPath],
        env: {
          LINEAR_API_KEY: config.tracker.api_key,
          LINEAR_ENDPOINT: config.tracker.endpoint,
        },
      },
    },
  };

  const configDir = path.join(wsPath, ".claude");
  await fs.mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, "mcp-config.json");
  await fs.writeFile(configPath, JSON.stringify(mcpConfig, null, 2));

  return configPath;
}
