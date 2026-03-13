import type { OrchestratorState, WorkflowConfig } from "../types.js";

/**
 * Render an HTML dashboard showing orchestrator state.
 */
export function renderDashboard(state: OrchestratorState, config: WorkflowConfig): string {
  const running = Array.from(state.running.values());
  const retries = Array.from(state.retry_attempts.values());

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Symphony Dashboard</title>
<meta http-equiv="refresh" content="10">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
  h1 { font-size: 1.5rem; margin-bottom: 1.5rem; color: #f8fafc; }
  h2 { font-size: 1.1rem; margin-bottom: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .card { background: #1e293b; border-radius: 8px; padding: 1rem; }
  .card .label { font-size: 0.75rem; color: #64748b; text-transform: uppercase; }
  .card .value { font-size: 1.5rem; font-weight: 600; margin-top: 0.25rem; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; }
  th { text-align: left; font-size: 0.75rem; color: #64748b; text-transform: uppercase; padding: 0.5rem; border-bottom: 1px solid #334155; }
  td { padding: 0.5rem; border-bottom: 1px solid #1e293b; font-size: 0.875rem; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; }
  .badge-green { background: #065f46; color: #6ee7b7; }
  .badge-yellow { background: #78350f; color: #fbbf24; }
  .badge-red { background: #7f1d1d; color: #fca5a5; }
  .empty { color: #475569; font-style: italic; padding: 1rem 0; }
</style>
</head>
<body>
<h1>Symphony Orchestrator</h1>

<div class="grid">
  <div class="card">
    <div class="label">Running</div>
    <div class="value">${running.length} / ${state.max_concurrent_agents}</div>
  </div>
  <div class="card">
    <div class="label">Claimed</div>
    <div class="value">${state.claimed.size}</div>
  </div>
  <div class="card">
    <div class="label">Retries Pending</div>
    <div class="value">${retries.length}</div>
  </div>
  <div class="card">
    <div class="label">Completed</div>
    <div class="value">${state.completed.size}</div>
  </div>
  <div class="card">
    <div class="label">Input Tokens</div>
    <div class="value">${formatNumber(state.codex_totals.input_tokens)}</div>
  </div>
  <div class="card">
    <div class="label">Output Tokens</div>
    <div class="value">${formatNumber(state.codex_totals.output_tokens)}</div>
  </div>
  <div class="card">
    <div class="label">Total Tokens</div>
    <div class="value">${formatNumber(state.codex_totals.total_tokens)}</div>
  </div>
  <div class="card">
    <div class="label">Poll Interval</div>
    <div class="value">${state.poll_interval_ms / 1000}s</div>
  </div>
</div>

<h2>Running Sessions</h2>
${running.length === 0 ? '<p class="empty">No running sessions</p>' : `
<table>
  <thead><tr><th>Identifier</th><th>State</th><th>PID</th><th>Turn</th><th>Tokens</th><th>Attempt</th><th>Started</th><th>Last Activity</th><th>Host</th><th>Event</th></tr></thead>
  <tbody>
    ${running.map(r => `<tr>
      <td>${esc(r.identifier)}</td>
      <td><span class="badge badge-green">${esc(r.state)}</span></td>
      <td>${r.pid ?? "—"}</td>
      <td>${r.turn}</td>
      <td>${formatNumber(r.tokens)}</td>
      <td>${r.attempt}</td>
      <td>${formatAge(r.started_at)}</td>
      <td>${r.last_codex_timestamp ? formatAge(r.last_codex_timestamp) : "—"}</td>
      <td>${r.ssh_host ? esc(r.ssh_host) : "local"}</td>
      <td>${r.last_event_text ? esc(r.last_event_text) : "—"}</td>
    </tr>`).join("")}
  </tbody>
</table>`}

<h2>Retry Queue</h2>
${retries.length === 0 ? '<p class="empty">No pending retries</p>' : `
<table>
  <thead><tr><th>Identifier</th><th>Attempt</th><th>Due In</th><th>Error</th></tr></thead>
  <tbody>
    ${retries.map(r => `<tr>
      <td>${esc(r.identifier)}</td>
      <td>${r.attempt}</td>
      <td>${formatAge(r.due_at_ms, true)}</td>
      <td>${r.error ? esc(r.error.slice(0, 100)) : "—"}</td>
    </tr>`).join("")}
  </tbody>
</table>`}

<h2>Configuration</h2>
<div class="card" style="max-width: 600px;">
  <table>
    <tr><td>Project</td><td>${esc(config.tracker.project_slug)}</td></tr>
    <tr><td>Active States</td><td>${config.tracker.active_states.map(s => `<span class="badge badge-green">${esc(s)}</span>`).join(" ")}</td></tr>
    <tr><td>Terminal States</td><td>${config.tracker.terminal_states.map(s => `<span class="badge badge-red">${esc(s)}</span>`).join(" ")}</td></tr>
    <tr><td>Max Concurrent</td><td>${config.agent.max_concurrent_agents}</td></tr>
    <tr><td>Max Turns</td><td>${config.agent.max_turns}</td></tr>
    <tr><td>Agent Command</td><td>${esc(config.codex.command)}</td></tr>
  </table>
</div>

</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function formatAge(timestampMs: number, future = false): string {
  const diff = future ? timestampMs - Date.now() : Date.now() - timestampMs;
  const seconds = Math.floor(Math.abs(diff) / 1000);
  if (seconds < 60) return `${seconds}s${future ? "" : " ago"}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${future ? "" : " ago"}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m${future ? "" : " ago"}`;
}
