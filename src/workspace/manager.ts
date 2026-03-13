import fs from "node:fs/promises";
import type pino from "pino";
import type { HooksConfig } from "../types.js";
import { sanitizeIdentifier, workspacePath } from "./safety.js";
import { runHook } from "./hooks.js";

export interface WorkspaceResult {
  path: string;
  created_now: boolean;
}

export class WorkspaceManager {
  constructor(
    private readonly root: string,
    private readonly hooks: HooksConfig,
    private readonly logger: pino.Logger
  ) {}

  /**
   * Create or reuse a workspace for the given issue identifier.
   * Runs after_create hook if workspace was newly created.
   */
  async createForIssue(identifier: string): Promise<WorkspaceResult> {
    const wsPath = workspacePath(this.root, identifier);
    let createdNow = false;

    try {
      await fs.access(wsPath);
      this.logger.debug({ path: wsPath }, "Reusing existing workspace");
    } catch {
      await fs.mkdir(wsPath, { recursive: true });
      createdNow = true;
      this.logger.info({ path: wsPath, identifier }, "Created workspace");
    }

    if (createdNow && this.hooks.after_create) {
      this.logger.info({ identifier }, "Running after_create hook");
      await runHook(this.hooks.after_create, wsPath, this.hooks.timeout_ms, this.logger);
    }

    return { path: wsPath, created_now: createdNow };
  }

  /**
   * Remove a workspace directory.
   * Runs before_remove hook if configured (best-effort).
   */
  async removeWorkspace(identifier: string): Promise<void> {
    const sanitized = sanitizeIdentifier(identifier);
    const wsPath = workspacePath(this.root, identifier);

    if (this.hooks.before_remove) {
      try {
        await runHook(this.hooks.before_remove, wsPath, this.hooks.timeout_ms, this.logger);
      } catch (err) {
        this.logger.warn({ err, identifier }, "before_remove hook failed, proceeding with removal");
      }
    }

    try {
      await fs.rm(wsPath, { recursive: true, force: true });
      this.logger.info({ path: wsPath, identifier }, "Removed workspace");
    } catch (err) {
      this.logger.warn({ err, identifier }, "Failed to remove workspace");
    }
  }

  /**
   * Ensure the workspace root directory exists.
   */
  async ensureRoot(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
  }
}
