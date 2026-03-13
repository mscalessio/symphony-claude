#!/usr/bin/env node

import path from "node:path";
import { parseCli } from "./cli.js";
import { loadWorkflow } from "./workflow/loader.js";
import { resolveConfig } from "./config/resolver.js";
import { validateConfig } from "./config/validator.js";
import { createLogger } from "./logging/logger.js";
import { WorkflowWatcher } from "./workflow/watcher.js";
import { LinearClient } from "./tracker/linear/client.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { HttpServer } from "./server/http-server.js";

async function main(): Promise<void> {
  // 1. Parse CLI args
  const args = parseCli(process.argv);

  // 2. Load + validate WORKFLOW.md
  const workflowPath = path.resolve(args.workflowPath);
  const workflow = loadWorkflow(workflowPath);

  // 3. Resolve config ($VAR substitution, ~ expansion)
  const resolvedConfig = resolveConfig(workflow.config);

  // 4. Configure logging
  const logger = createLogger("symphony");

  // 5. Validate dispatch config
  const validation = validateConfig(resolvedConfig);
  if (!validation.valid) {
    logger.error({ errors: validation.errors }, "Config validation failed at startup");
    process.exit(1);
  }

  logger.info({
    project: resolvedConfig.tracker.project_slug,
    activeStates: resolvedConfig.tracker.active_states,
    maxConcurrent: resolvedConfig.agent.max_concurrent_agents,
    pollInterval: resolvedConfig.polling.interval_ms,
  }, "Symphony starting");

  // 6. Create Linear client
  const tracker = new LinearClient({
    endpoint: resolvedConfig.tracker.endpoint,
    apiKey: resolvedConfig.tracker.api_key,
    projectSlug: resolvedConfig.tracker.project_slug,
    activeStates: resolvedConfig.tracker.active_states,
    logger: logger.child({ component: "linear" }),
  });

  // 7. Create orchestrator
  const orchestrator = new Orchestrator({
    config: resolvedConfig,
    promptTemplate: workflow.prompt_template,
    tracker,
    logger: logger.child({ component: "orchestrator" }),
  });

  // 8. Start workflow file watcher
  const watcher = new WorkflowWatcher(
    workflowPath,
    (updated) => {
      try {
        const newConfig = resolveConfig(updated.config);
        const newValidation = validateConfig(newConfig);
        if (newValidation.valid) {
          orchestrator.updateWorkflow({ config: newConfig, prompt_template: updated.prompt_template });
        } else {
          logger.warn({ errors: newValidation.errors }, "Reloaded config invalid, keeping previous");
        }
      } catch (err) {
        logger.error({ err }, "Error resolving reloaded config");
      }
    },
    logger.child({ component: "watcher" })
  );
  watcher.start();

  // 9. Start HTTP server if configured
  let httpServer: HttpServer | null = null;
  const serverPort = args.port ?? resolvedConfig.server.port;
  if (serverPort !== null) {
    httpServer = new HttpServer({
      port: serverPort,
      orchestrator,
      logger: logger.child({ component: "http" }),
    });
    const { address } = await httpServer.start();
    logger.info({ address }, "HTTP server started");
  }

  // 10. Start orchestrator
  await orchestrator.start();

  // 11. Graceful shutdown
  let shutdownInProgress = false;
  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    logger.info({ signal }, "Shutdown signal received");

    watcher.stop();

    await orchestrator.stop();

    if (httpServer) {
      await httpServer.stop();
    }

    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
