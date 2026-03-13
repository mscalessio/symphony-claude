import type { OrchestratorState, WorkflowConfig, RunningEntry, RetryEntry } from "../types.js";

// ─── ANSI helpers ───

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const WHITE = "\x1b[37m";
const GRAY = "\x1b[90m";

const BOX_TOP = "\u250c";
const BOX_MID = "\u251c";
const BOX_PIPE = "\u2502";
const BULLET = "\u2022";

// ─── Public API ───

export interface RenderOpts {
  cols: number;
  rows: number;
  projectSlug?: string;
}

/**
 * Render a complete TUI frame as a string.
 * Pure function: state + config + terminal size → string.
 */
export function renderFrame(
  state: OrchestratorState,
  config: WorkflowConfig,
  opts: RenderOpts,
): string {
  const lines: string[] = [];

  lines.push(...renderHeader(state, config, opts));
  lines.push(...renderRunningTable(state, opts));
  lines.push(...renderBackoffQueue(state, opts));

  // Clip to terminal height (leave 1 line for cursor)
  const maxLines = Math.max(1, opts.rows - 1);
  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  return lines.join("\n");
}

// ─── Header ───

export function renderHeader(
  state: OrchestratorState,
  config: WorkflowConfig,
  opts: RenderOpts,
): string[] {
  const running = state.running.size;
  const max = state.max_concurrent_agents;
  const totals = state.codex_totals;
  const tps = totals.seconds_running > 0
    ? Math.round(totals.total_tokens / totals.seconds_running)
    : 0;
  const runtime = formatDuration(Date.now() - state.started_at);

  const lines: string[] = [];
  lines.push(`${BOLD}${CYAN}${BOX_TOP} SYMPHONY STATUS${RESET}`);
  lines.push(`${CYAN}${BOX_PIPE}${RESET} ${BOLD}Agents:${RESET} ${running}/${max}`);
  lines.push(`${CYAN}${BOX_PIPE}${RESET} ${BOLD}Throughput:${RESET} ${formatNumber(tps)} tps`);
  lines.push(`${CYAN}${BOX_PIPE}${RESET} ${BOLD}Runtime:${RESET} ${runtime}`);
  lines.push(`${CYAN}${BOX_PIPE}${RESET} ${BOLD}Tokens:${RESET} in ${formatNumber(totals.input_tokens)} | out ${formatNumber(totals.output_tokens)} | total ${formatNumber(totals.total_tokens)}`);

  if (opts.projectSlug) {
    lines.push(`${CYAN}${BOX_PIPE}${RESET} ${BOLD}Project:${RESET} ${opts.projectSlug}`);
  }

  lines.push(`${CYAN}${BOX_PIPE}${RESET} ${BOLD}Next refresh:${RESET} 1s`);

  return lines;
}

// ─── Running table ───

const RUNNING_COLUMNS = [
  { key: "identifier", label: "ID", width: 10 },
  { key: "state", label: "STAGE", width: 14 },
  { key: "pid", label: "PID", width: 9 },
  { key: "age_turn", label: "AGE / TURN", width: 14 },
  { key: "tokens", label: "TOKENS", width: 12 },
  { key: "session", label: "SESSION", width: 15 },
  { key: "event", label: "EVENT", width: 0 }, // fills remaining
] as const;

export function renderRunningTable(
  state: OrchestratorState,
  opts: RenderOpts,
): string[] {
  const lines: string[] = [];
  lines.push(`${BOLD}${CYAN}${BOX_MID} Running${RESET}`);

  const entries = Array.from(state.running.values());

  if (entries.length === 0) {
    lines.push(`${CYAN}${BOX_PIPE}${RESET}   ${DIM}No running agents${RESET}`);
    return lines;
  }

  // Header row
  const fixedWidth = RUNNING_COLUMNS.slice(0, -1).reduce((s, c) => s + c.width, 0);
  const eventWidth = Math.max(10, opts.cols - fixedWidth - 6); // 6 = prefix + spacing

  const headerParts = RUNNING_COLUMNS.map(c => {
    const w = c.key === "event" ? eventWidth : c.width;
    return pad(c.label, w);
  });
  lines.push(`${CYAN}${BOX_PIPE}${RESET}   ${DIM}${headerParts.join("")}${RESET}`);

  // Data rows
  for (const entry of entries) {
    const row = formatRunningRow(entry, eventWidth);
    lines.push(`${CYAN}${BOX_PIPE}${RESET} ${GREEN}${BULLET}${RESET} ${row}`);
  }

  return lines;
}

function formatRunningRow(entry: RunningEntry, eventWidth: number): string {
  const age = formatDuration(Date.now() - entry.started_at);
  const ageTurn = `${age} / ${entry.turn}`;
  const sessionShort = entry.session_id
    ? entry.session_id.slice(0, 4) + "\u2026" + entry.session_id.slice(-6)
    : "\u2014";
  const eventText = entry.last_event_text ?? "\u2014";

  const cols = [
    pad(entry.identifier, RUNNING_COLUMNS[0].width),
    pad(entry.state, RUNNING_COLUMNS[1].width),
    pad(entry.pid != null ? String(entry.pid) : "\u2014", RUNNING_COLUMNS[2].width),
    pad(ageTurn, RUNNING_COLUMNS[3].width),
    pad(formatNumber(entry.tokens), RUNNING_COLUMNS[4].width),
    pad(sessionShort, RUNNING_COLUMNS[5].width),
    pad(eventText, eventWidth),
  ];

  return cols.join("");
}

// ─── Backoff queue ───

export function renderBackoffQueue(
  state: OrchestratorState,
  opts: RenderOpts,
): string[] {
  const lines: string[] = [];
  lines.push(`${BOLD}${CYAN}${BOX_MID} Backoff queue${RESET}`);

  const retries = Array.from(state.retry_attempts.values());

  if (retries.length === 0) {
    lines.push(`${CYAN}${BOX_PIPE}${RESET}   ${DIM}No queued retries${RESET}`);
    return lines;
  }

  lines.push(`${CYAN}${BOX_PIPE}${RESET}   ${DIM}${pad("ID", 12)}${pad("ATTEMPT", 10)}${pad("DUE IN", 12)}ERROR${RESET}`);

  for (const entry of retries) {
    const dueIn = formatDueIn(entry.due_at_ms);
    const error = entry.error ? truncate(entry.error, Math.max(20, opts.cols - 40)) : "\u2014";
    const row = `${pad(entry.identifier, 12)}${pad(String(entry.attempt), 10)}${pad(dueIn, 12)}${error}`;
    lines.push(`${CYAN}${BOX_PIPE}${RESET} ${YELLOW}${BULLET}${RESET} ${row}`);
  }

  return lines;
}

// ─── Formatting helpers (exported for testing) ───

export function formatNumber(n: number): string {
  if (n < 0) return "-" + formatNumber(-n);
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return Math.round(n / 1_000).toLocaleString("en-US") + "K";
  if (n >= 1_000) return n.toLocaleString("en-US");
  return String(n);
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hrs = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hrs}h ${remMin}m`;
}

export function formatDueIn(dueAtMs: number): string {
  const diff = dueAtMs - Date.now();
  if (diff <= 0) return "now";
  return formatDuration(diff);
}

export function pad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + " ".repeat(width - s.length);
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\n/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1) + "\u2026";
}
