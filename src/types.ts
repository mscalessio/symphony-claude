// ─── Domain Model (spec Section 4.1.1) ───

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: string;
  priority: number | null;
  created_at: string;
  labels: string[];
  blockers: BlockerRef[];
}

export interface BlockerRef {
  id: string;
  identifier: string;
  state: string;
}

// ─── Workflow Config (from WORKFLOW.md front-matter) ───

export interface WorkflowConfig {
  tracker: TrackerConfig;
  polling: PollingConfig;
  workspace: WorkspaceConfig;
  hooks: HooksConfig;
  agent: AgentConfig;
  codex: CodexConfig;
  server: ServerConfig;
  worker: WorkerConfig;
}

export interface TrackerConfig {
  kind: string;
  endpoint: string;
  api_key: string;
  project_slug: string;
  active_states: string[];
  terminal_states: string[];
}

export interface PollingConfig {
  interval_ms: number;
}

export interface WorkspaceConfig {
  root: string;
}

export interface HooksConfig {
  after_create: string | null;
  before_run: string | null;
  after_run: string | null;
  before_remove: string | null;
  timeout_ms: number;
}

export interface AgentConfig {
  max_concurrent_agents: number;
  max_turns: number;
  max_retry_backoff_ms: number;
  max_concurrent_agents_by_state: Record<string, number>;
}

export interface CodexConfig {
  command: string;
  approval_policy: string;
  turn_timeout_ms: number;
  read_timeout_ms: number;
  stall_timeout_ms: number;
}

export interface ServerConfig {
  port: number | null;
}

export interface WorkerConfig {
  ssh_hosts: string[] | null;
  max_concurrent_agents_per_host: number | null;
}

// ─── Orchestrator State (spec Section 4.1.8) ───

export interface RunningEntry {
  issue_id: string;
  identifier: string;
  state: string;
  started_at: number;
  last_codex_timestamp: number | null;
  worker_abort: AbortController;
  ssh_host: string | null;
  session_id: string | null;
  attempt: number;
  pid: number | null;
  turn: number;
  tokens: number;
  last_event_text: string | null;
}

export interface RetryEntry {
  issue_id: string;
  identifier: string;
  attempt: number;
  due_at_ms: number;
  timer_handle: ReturnType<typeof setTimeout>;
  error: string | null;
}

export interface OrchestratorState {
  poll_interval_ms: number;
  max_concurrent_agents: number;
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retry_attempts: Map<string, RetryEntry>;
  completed: Set<string>;
  codex_totals: CodexTotals;
  codex_rate_limits: Record<string, unknown> | null;
  started_at: number;
}

export interface CodexTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  seconds_running: number;
}

// ─── Claude CLI Stream Events ───

export interface ClaudeSystemEvent {
  type: "system";
  subtype: string;
  session_id?: string;
  tools?: string[];
  model?: string;
  [key: string]: unknown;
}

export interface ClaudeAssistantEvent {
  type: "assistant";
  message: {
    role: string;
    content: Array<{
      type: string;
      text?: string;
      tool_use_id?: string;
      name?: string;
      input?: unknown;
    }>;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  [key: string]: unknown;
}

export interface ClaudeResultEvent {
  type: "result";
  subtype: string;
  session_id: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error: boolean;
  total_cost_usd?: number;
  num_turns?: number;
  result?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens?: number;
  };
  [key: string]: unknown;
}

export type ClaudeStreamEvent =
  | ClaudeSystemEvent
  | ClaudeAssistantEvent
  | ClaudeResultEvent;

// ─── Worker / Agent Types ───

export interface TurnResult {
  success: boolean;
  sessionId: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  cost_usd: number;
  duration_ms: number;
  error: string | null;
}

export interface WorkerResult {
  issue_id: string;
  identifier: string;
  success: boolean;
  error: string | null;
  turns: number;
  total_usage: {
    input_tokens: number;
    output_tokens: number;
  };
  total_cost_usd: number;
}

export type WorkerCallback = (update: WorkerUpdate) => void;

export type WorkerUpdate =
  | { type: "event"; event: ClaudeStreamEvent }
  | { type: "turn_complete"; turn: number; result: TurnResult }
  | { type: "session_id"; session_id: string }
  | { type: "stall_timestamp"; timestamp: number }
  | { type: "pid"; pid: number }
  | { type: "turn_start"; turn: number };

// ─── Tracker Adapter Interface ───

export interface TrackerAdapter {
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssueStatesByIds(issueIds: string[]): Promise<Map<string, { id: string; state: string; identifier: string }>>;
  fetchIssuesByStates(stateNames: string[]): Promise<Issue[]>;
}

// ─── Parsed Workflow ───

export interface ParsedWorkflow {
  config: WorkflowConfig;
  prompt_template: string;
}

// ─── SSH Host Slot ───

export interface SshHostSlot {
  host: string;
  running_count: number;
  max_concurrent: number;
}
