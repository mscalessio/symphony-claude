import type pino from "pino";
import type {
  Issue, WorkflowConfig, OrchestratorState, ParsedWorkflow,
  TrackerAdapter, RunningEntry, WorkerResult,
} from "../types.js";
import { shouldDispatch, sortForDispatch, hasGlobalSlot } from "./dispatcher.js";
import { reconcile } from "./reconciler.js";
import {
  queueNormalRetry, queueAbnormalRetry, cancelExistingRetry,
  releaseClaim, cancelAllRetries,
} from "./retry.js";
import { describeEvent } from "../tui/event-description.js";
import { validateConfig } from "../config/validator.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { runWorker } from "../agent/runner.js";

export interface OrchestratorOpts {
  config: WorkflowConfig;
  promptTemplate: string;
  tracker: TrackerAdapter;
  logger: pino.Logger;
}

export class Orchestrator {
  private state: OrchestratorState;
  private config: WorkflowConfig;
  private promptTemplate: string;
  private readonly tracker: TrackerAdapter;
  private readonly logger: pino.Logger;
  private workspaceManager: WorkspaceManager;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private shuttingDown = false;
  private observers: Array<(state: OrchestratorState) => void> = [];

  constructor(opts: OrchestratorOpts) {
    this.config = opts.config;
    this.promptTemplate = opts.promptTemplate;
    this.tracker = opts.tracker;
    this.logger = opts.logger;

    this.state = {
      poll_interval_ms: this.config.polling.interval_ms,
      max_concurrent_agents: this.config.agent.max_concurrent_agents,
      running: new Map(),
      claimed: new Set(),
      retry_attempts: new Map(),
      completed: new Set(),
      codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
      codex_rate_limits: null,
      started_at: Date.now(),
    };

    this.workspaceManager = new WorkspaceManager(
      this.config.workspace.root,
      this.config.hooks,
      this.logger
    );
  }

  /**
   * Start the orchestrator poll loop.
   */
  async start(): Promise<void> {
    this.logger.info("Starting orchestrator");

    // Ensure workspace root exists
    await this.workspaceManager.ensureRoot();

    // Startup terminal workspace cleanup
    await this.startupCleanup();

    // Schedule immediate first tick
    this.scheduleTick(0);
  }

  /**
   * Stop the orchestrator gracefully.
   */
  async stop(): Promise<void> {
    this.logger.info("Stopping orchestrator");
    this.shuttingDown = true;

    // Clear poll timer
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Cancel all retries
    cancelAllRetries(this.state);

    // Abort all running workers
    for (const [, entry] of this.state.running) {
      entry.worker_abort.abort();
    }

    // Wait for workers to finish (with timeout)
    const waitStart = Date.now();
    const shutdownTimeout = 30_000;
    while (this.state.running.size > 0 && Date.now() - waitStart < shutdownTimeout) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (this.state.running.size > 0) {
      this.logger.warn({ remaining: this.state.running.size }, "Some workers did not exit during shutdown");
    }

    this.logger.info("Orchestrator stopped");
  }

  /**
   * Update config and prompt template (called by workflow watcher).
   */
  updateWorkflow(workflow: ParsedWorkflow): void {
    this.config = workflow.config;
    this.promptTemplate = workflow.prompt_template;
    this.state.poll_interval_ms = this.config.polling.interval_ms;
    this.state.max_concurrent_agents = this.config.agent.max_concurrent_agents;
    this.workspaceManager = new WorkspaceManager(
      this.config.workspace.root,
      this.config.hooks,
      this.logger
    );
    this.logger.info("Workflow config updated");
  }

  /**
   * Trigger an immediate poll cycle (e.g., from API).
   */
  triggerPoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.scheduleTick(0);
  }

  /**
   * Get a snapshot of current state (for API/dashboard).
   */
  getState(): OrchestratorState {
    return this.state;
  }

  /**
   * Get the current config (for API/dashboard).
   */
  getConfig(): WorkflowConfig {
    return this.config;
  }

  /**
   * Register an observer for state changes.
   */
  onStateChange(fn: (state: OrchestratorState) => void): void {
    this.observers.push(fn);
  }

  // ── Private ──

  private scheduleTick(delayMs: number): void {
    if (this.shuttingDown) return;
    this.pollTimer = setTimeout(() => this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.shuttingDown) return;

    try {
      // 1. Reconcile
      await reconcile(
        this.state,
        this.config,
        this.tracker,
        this.workspaceManager,
        (issueId, identifier, attempt) => {
          // Stall handler → queue abnormal retry
          queueAbnormalRetry(
            issueId, identifier, attempt + 1,
            this.config.agent.max_retry_backoff_ms,
            "Worker stalled",
            this.state,
            (id) => this.handleRetryFire(id),
            this.logger
          );
        },
        this.logger
      );

      // 2. Validate config
      const validation = validateConfig(this.config);
      if (!validation.valid) {
        this.logger.warn({ errors: validation.errors }, "Config validation failed, skipping dispatch");
        this.scheduleTick(this.state.poll_interval_ms);
        return;
      }

      // 3. Fetch candidate issues
      let issues: Issue[];
      try {
        issues = await this.tracker.fetchCandidateIssues();
      } catch (err) {
        this.logger.error({ err }, "Failed to fetch candidate issues");
        this.scheduleTick(this.state.poll_interval_ms);
        return;
      }

      // 4. Sort for dispatch
      const sorted = sortForDispatch(issues);

      // 5. Dispatch eligible issues
      for (const issue of sorted) {
        if (!hasGlobalSlot(this.state)) break;
        if (shouldDispatch(issue, this.state, this.config)) {
          this.dispatch(issue);
        }
      }

      // 6. Notify observers
      this.notifyObservers();
    } catch (err) {
      this.logger.error({ err }, "Tick error");
    }

    // 7. Schedule next tick
    this.scheduleTick(this.state.poll_interval_ms);
  }

  private dispatch(issue: Issue): void {
    const abortController = new AbortController();

    // Claim the issue
    this.state.claimed.add(issue.id);

    // Create running entry
    const entry: RunningEntry = {
      issue_id: issue.id,
      identifier: issue.identifier,
      state: issue.state,
      started_at: Date.now(),
      last_codex_timestamp: null,
      worker_abort: abortController,
      ssh_host: null,
      session_id: null,
      attempt: 1,
      pid: null,
      turn: 0,
      tokens: 0,
      last_event_text: null,
    };

    // Check if there's a retry entry to get attempt number
    const retryEntry = this.state.retry_attempts.get(issue.id);
    if (retryEntry) {
      entry.attempt = retryEntry.attempt;
      cancelExistingRetry(issue.id, this.state);
    }

    this.state.running.set(issue.id, entry);

    this.logger.info(
      { issue_id: issue.id, identifier: issue.identifier, state: issue.state, attempt: entry.attempt },
      "Dispatching worker"
    );

    // Fire-and-forget worker
    runWorker({
      issue,
      attempt: entry.attempt,
      config: this.config,
      promptTemplate: this.promptTemplate,
      tracker: this.tracker,
      workspaceManager: this.workspaceManager,
      abortController,
      callback: (update) => {
        const running = this.state.running.get(issue.id);
        if (!running) return;

        if (update.type === "stall_timestamp") {
          running.last_codex_timestamp = update.timestamp;
        }
        if (update.type === "session_id") {
          running.session_id = update.session_id;
        }
        if (update.type === "pid") {
          running.pid = update.pid;
        }
        if (update.type === "turn_start") {
          running.turn = update.turn;
        }
        if (update.type === "event") {
          running.last_event_text = describeEvent(update.event);
          if (update.event.type === "assistant" && update.event.message?.usage) {
            running.tokens += update.event.message.usage.input_tokens
                           + update.event.message.usage.output_tokens;
          }
        }
      },
      logger: this.logger.child({ issue_id: issue.id, issue_identifier: issue.identifier }),
    })
      .then((result) => this.handleWorkerComplete(result))
      .catch((err) => this.handleWorkerError(issue.id, issue.identifier, entry.attempt, err));
  }

  private handleWorkerComplete(result: WorkerResult): void {
    const { issue_id, identifier, success, error, turns } = result;

    // Remove from running
    this.state.running.delete(issue_id);

    // Update totals
    this.state.codex_totals.input_tokens += result.total_usage.input_tokens;
    this.state.codex_totals.output_tokens += result.total_usage.output_tokens;
    this.state.codex_totals.total_tokens += result.total_usage.input_tokens + result.total_usage.output_tokens;

    if (success) {
      this.logger.info({ issue_id, identifier, turns }, "Worker completed successfully");
      // Queue normal retry (continuation)
      queueNormalRetry(
        issue_id, identifier, this.state,
        (id) => this.handleRetryFire(id),
        this.logger
      );
    } else {
      this.logger.warn({ issue_id, identifier, error, turns }, "Worker failed");
      const attempt = (this.state.retry_attempts.get(issue_id)?.attempt ?? 0) + 1;
      queueAbnormalRetry(
        issue_id, identifier, attempt,
        this.config.agent.max_retry_backoff_ms,
        error ?? "Unknown error",
        this.state,
        (id) => this.handleRetryFire(id),
        this.logger
      );
    }

    this.notifyObservers();
  }

  private handleWorkerError(issueId: string, identifier: string, attempt: number, err: unknown): void {
    this.logger.error({ err, issue_id: issueId, identifier }, "Worker threw unexpected error");
    this.state.running.delete(issueId);

    queueAbnormalRetry(
      issueId, identifier, attempt + 1,
      this.config.agent.max_retry_backoff_ms,
      String(err),
      this.state,
      (id) => this.handleRetryFire(id),
      this.logger
    );

    this.notifyObservers();
  }

  private async handleRetryFire(issueId: string): Promise<void> {
    if (this.shuttingDown) {
      releaseClaim(issueId, this.state);
      return;
    }

    try {
      // Fetch fresh candidate list
      const issues = await this.tracker.fetchCandidateIssues();
      const issue = issues.find(i => i.id === issueId);

      if (!issue) {
        this.logger.info({ issue_id: issueId }, "Retry: issue not found in candidates, releasing claim");
        releaseClaim(issueId, this.state);
        return;
      }

      if (!hasGlobalSlot(this.state)) {
        this.logger.info({ issue_id: issueId }, "Retry: no available slots, re-queuing");
        const retryEntry = this.state.retry_attempts.get(issueId);
        queueAbnormalRetry(
          issueId, issue.identifier, (retryEntry?.attempt ?? 0) + 1,
          this.config.agent.max_retry_backoff_ms,
          "No available orchestrator slots",
          this.state,
          (id) => this.handleRetryFire(id),
          this.logger
        );
        return;
      }

      if (shouldDispatch(issue, this.state, this.config)) {
        this.dispatch(issue);
      } else {
        this.logger.info({ issue_id: issueId }, "Retry: issue not eligible, releasing claim");
        releaseClaim(issueId, this.state);
      }
    } catch (err) {
      this.logger.error({ err, issue_id: issueId }, "Retry handler failed, releasing claim");
      releaseClaim(issueId, this.state);
    }
  }

  private async startupCleanup(): Promise<void> {
    this.logger.info("Running startup terminal workspace cleanup");
    try {
      const terminalIssues = await this.tracker.fetchIssuesByStates(this.config.tracker.terminal_states);
      for (const issue of terminalIssues) {
        try {
          await this.workspaceManager.removeWorkspace(issue.identifier);
        } catch {
          // Workspace may not exist, that's fine
        }
      }
      this.logger.info({ count: terminalIssues.length }, "Startup cleanup complete");
    } catch (err) {
      this.logger.warn({ err }, "Startup terminal cleanup failed, continuing");
    }
  }

  private notifyObservers(): void {
    for (const fn of this.observers) {
      try {
        fn(this.state);
      } catch {
        // Ignore observer errors
      }
    }
  }
}
