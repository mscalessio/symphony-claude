import fs from "node:fs";
import type pino from "pino";
import { loadWorkflow } from "./loader.js";
import type { ParsedWorkflow, WorkflowConfig } from "../types.js";

/**
 * Watch a workflow file for changes with debounced reloading.
 *
 * On change:
 * - Re-parse and validate the workflow file
 * - If valid: call onReload with new config + prompt
 * - If invalid: log error, keep last known good config
 *
 * Uses fs.watch() with 500ms debounce to avoid rapid re-reads.
 */
export class WorkflowWatcher {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs = 500;

  constructor(
    private readonly filePath: string,
    private readonly onReload: (workflow: ParsedWorkflow) => void,
    private readonly logger: pino.Logger
  ) {}

  start(): void {
    this.logger.info({ file: this.filePath }, "Starting workflow file watcher");
    this.watcher = fs.watch(this.filePath, (eventType) => {
      if (eventType === "change") {
        this.scheduleReload();
      }
    });

    this.watcher.on("error", (err) => {
      this.logger.error({ err }, "Workflow watcher error");
    });
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.reload();
    }, this.debounceMs);
  }

  private reload(): void {
    try {
      const workflow = loadWorkflow(this.filePath);
      this.logger.info("Workflow file reloaded successfully");
      this.onReload(workflow);
    } catch (err) {
      this.logger.error({ err }, "Failed to reload workflow file, keeping last known good config");
    }
  }
}
