import type { OrchestratorState, WorkflowConfig } from "../types.js";
import { renderFrame, type RenderOpts } from "./renderer.js";

const ENTER_ALT_SCREEN = "\x1b[?1049h";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CURSOR_HOME = "\x1b[H";
const CLEAR_SCREEN = "\x1b[2J";

export interface DashboardDeps {
  getState: () => OrchestratorState;
  getConfig: () => WorkflowConfig;
  projectSlug?: string;
}

/**
 * Terminal dashboard that renders orchestrator state in an alternate screen buffer.
 * Uses raw ANSI escape codes — no TUI library dependency.
 */
export class TerminalDashboard {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly deps: DashboardDeps;
  private resizeHandler: (() => void) | null = null;

  constructor(deps: DashboardDeps) {
    this.deps = deps;
  }

  start(): void {
    // Enter alternate screen, hide cursor
    process.stdout.write(ENTER_ALT_SCREEN + HIDE_CURSOR);

    // Initial render
    this.render();

    // 1-second refresh timer
    this.timer = setInterval(() => this.render(), 1000);

    // Re-render on terminal resize
    this.resizeHandler = () => this.render();
    process.stdout.on("resize", this.resizeHandler);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.resizeHandler) {
      process.stdout.removeListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    // Restore terminal: show cursor, leave alternate screen
    process.stdout.write(SHOW_CURSOR + LEAVE_ALT_SCREEN);
  }

  private render(): void {
    const cols = process.stdout.columns || 120;
    const rows = process.stdout.rows || 40;

    const opts: RenderOpts = {
      cols,
      rows,
      projectSlug: this.deps.projectSlug,
    };

    const frame = renderFrame(
      this.deps.getState(),
      this.deps.getConfig(),
      opts,
    );

    // Move cursor home and clear, then write frame
    process.stdout.write(CURSOR_HOME + CLEAR_SCREEN + frame);
  }
}
