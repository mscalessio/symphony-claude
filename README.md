# Symphony Claude

A TypeScript implementation of [Symphony](https://github.com/openai/symphony) that automates workflow orchestration by polling Linear for issues and launching [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI sessions to resolve them autonomously.

## How It Works

Symphony Claude is a long-running service that:

1. **Polls Linear** for issues matching configured active states in a target project.
2. **Creates an isolated workspace** for each issue (cloning the repo, running hooks).
3. **Spawns a Claude Code CLI subprocess** (`claude -p --output-format stream-json`) with the rendered prompt template and a per-workspace MCP server providing the `linear_graphql` tool.
4. **Streams structured JSON events** from the claude process, tracking turns, usage, session IDs, and stall detection.
5. **Runs multi-turn sessions** until the issue reaches a terminal state, max turns are exhausted, or an error occurs — resuming sessions via `--resume <session_id>` for continuity.

The orchestrator manages concurrency, exponential-backoff retries, workspace lifecycle hooks, hot-reloading of the `WORKFLOW.md` config, and an optional web dashboard.

## How to Use It

Symphony is a **standalone orchestrator** — it runs separately from your target codebase. It creates isolated workspace copies of your repo for each issue via the `hooks.after_create` hook (typically a `git clone`). This means you can point Symphony at any codebase on your machine (or reachable via git) without modifying it.

1. Prepare your target codebase so agents can work effectively (README, tests, CI).
2. Obtain a [Linear personal API token](https://linear.app/settings/api).
3. **Create a `WORKFLOW.md`** for your target repo — copy the included `WORKFLOW.md` as a starting point, then customize:
   - Set `tracker.project_slug` to your Linear project slug.
   - Set `hooks.after_create` to clone your target repo (e.g., `git clone --depth 1 https://github.com/you/your-repo .`).
   - Adjust the prompt template in the markdown body for your repo's conventions.
4. Optionally add `.claude/skills/` to the **target repo** for commit, push, pull, linear, land, and debug workflows.
5. Run Symphony, pointing it at your workflow file.

## Prerequisites

- **Node.js** 22+ and npm
- **Claude Code CLI** (`claude`) [installed and authenticated](https://docs.anthropic.com/en/docs/claude-code/getting-started)
- **Linear API key** — set as `LINEAR_API_KEY` environment variable
- **Git** and **GitHub CLI** (`gh`) for agent operations

## Getting Started

```bash
# 1. Install the orchestrator
git clone <this-repo>
cd symphony-claude
npm install
npm run build

# 2. Set your Linear API key
export LINEAR_API_KEY="lin_api_..."

# 3. Create a workflow file for your target codebase
#    You can place it anywhere — in the target repo, a shared config dir, etc.
cp WORKFLOW.md ~/my-project/WORKFLOW.md
# Edit ~/my-project/WORKFLOW.md:
#   - Set tracker.project_slug to your Linear project
#   - Set hooks.after_create to clone your repo
#   - Customize the prompt template

# 4. Run the orchestrator (workflow path can be absolute or relative)
npx symphony ~/my-project/WORKFLOW.md --port 3000
```

The orchestrator will:
- Poll your Linear project for issues in the configured active states
- For each issue, create a workspace under `workspace.root` and run `hooks.after_create` (cloning your repo)
- Spawn a Claude Code session inside that workspace copy to work on the issue
- Continue until the issue reaches a terminal state or max turns are exhausted

## Configuration Reference

`WORKFLOW.md` uses YAML front-matter for configuration. All fields have sensible defaults except `tracker.project_slug` which is required.

### `tracker`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `kind` | string | *(required)* | Tracker type (currently `linear`) |
| `endpoint` | string | `https://api.linear.app/graphql` | Linear GraphQL endpoint |
| `api_key` | string | `$LINEAR_API_KEY` | API key (supports `$ENV_VAR` syntax) |
| `project_slug` | string | *(required)* | Linear project slug |
| `active_states` | string[] | `["Todo", "In Progress"]` | Issue states that trigger agent sessions |
| `terminal_states` | string[] | `["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]` | Issue states that stop agent sessions |

### `polling`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `interval_ms` | number | `30000` | Polling interval in milliseconds |

### `workspace`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `root` | string | `$TMPDIR/symphony_workspaces` | Root directory for issue workspaces (supports `~` expansion) |

### `hooks`

Shell scripts executed at workspace lifecycle events. Each runs with `cwd` set to the workspace directory.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `after_create` | string \| null | `null` | Run after workspace directory is created (e.g., `git clone`) |
| `before_run` | string \| null | `null` | Run before the first claude turn |
| `after_run` | string \| null | `null` | Run after the last claude turn (best-effort) |
| `before_remove` | string \| null | `null` | Run before workspace cleanup |
| `timeout_ms` | number | `60000` | Hook execution timeout |

### `agent`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_concurrent_agents` | number | `10` | Maximum parallel agent sessions |
| `max_turns` | number | `20` | Maximum claude turns per issue session |
| `max_retry_backoff_ms` | number | `300000` | Maximum backoff for retries (5 min) |
| `max_concurrent_agents_by_state` | Record<string, number> | `{}` | Per-state concurrency limits |

### `codex`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `command` | string | `claude` | CLI command to invoke |
| `approval_policy` | string | `bypassPermissions` | Permission mode — `bypassPermissions` maps to `--dangerously-skip-permissions`, any other value maps to `--permission-mode <value>` |
| `turn_timeout_ms` | number | `3600000` | Per-turn timeout (1 hour) |
| `read_timeout_ms` | number | `5000` | Stream read timeout |
| `stall_timeout_ms` | number | `300000` | Stall detection timeout (5 min) |

### `server`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number \| null | `null` | HTTP dashboard port (disabled when null) |

### `worker`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `ssh_hosts` | string[] \| null | `null` | SSH hosts for distributed workers |
| `max_concurrent_agents_per_host` | number \| null | `null` | Per-host concurrency limit |

## Defaults

When a section is omitted entirely, the schema provides complete defaults:

- **No tracker config** → must be provided (validation fails without `project_slug`)
- **No polling** → 30-second poll interval
- **No workspace** → uses OS temp directory
- **No hooks** → all null, 60s timeout
- **No agent** → 10 concurrent, 20 max turns, 5 min retry backoff
- **No codex** → `claude` command, bypass permissions, 1 hour turn timeout, 5 min stall timeout
- **No server** → dashboard disabled
- **No worker** → local-only execution

## CLI Flags

```
symphony [workflow] [options]

Arguments:
  workflow              Path to WORKFLOW.md file (default: "./WORKFLOW.md")

Options:
  -p, --port <port>     HTTP server port (overrides server.port in workflow)
  -V, --version         Output version number
  -h, --help            Display help
```

## Environment Variables

The config resolver supports `$VAR` and `${VAR}` syntax in string values. Variables are resolved from `process.env` at startup. The `~` prefix in paths is expanded to the user's home directory.

Example:
```yaml
tracker:
  api_key: $LINEAR_API_KEY
workspace:
  root: ~/symphony-workspaces
```

## Web Dashboard

When a port is configured (via `server.port` or `--port`), Symphony starts a Fastify HTTP server with:

- `GET /` — HTML dashboard showing running agents, retry queue, completed issues, and token usage
- `GET /api/v1/state` — Full JSON state snapshot
- `GET /api/v1/:identifier` — Issue-specific runtime details (e.g., `/api/v1/MT-42`)
- `POST /api/v1/refresh` — Trigger an immediate poll cycle

## Project Structure

```
src/
├── index.ts                    # Entry point, startup orchestration
├── cli.ts                      # CLI argument parsing (commander)
├── types.ts                    # Domain model, config interfaces, stream events
├── workflow/
│   ├── schema.ts               # Zod schema for WORKFLOW.md front-matter
│   ├── loader.ts               # Parse WORKFLOW.md (gray-matter + Zod validation)
│   └── watcher.ts              # Hot-reload on file changes
├── config/
│   ├── resolver.ts             # $VAR substitution, ~ expansion
│   └── validator.ts            # Dispatch-time config validation
├── logging/
│   └── logger.ts               # Pino structured logging
├── tracker/
│   ├── adapter.ts              # TrackerAdapter interface
│   └── linear/
│       ├── client.ts           # Linear GraphQL client
│       ├── queries.ts          # GraphQL query templates
│       └── normalize.ts        # Response → Issue normalization
├── prompt/
│   └── builder.ts              # Liquid template rendering
├── agent/
│   ├── claude-process.ts       # Spawn claude CLI, parse stream-json
│   ├── stream-parser.ts        # Newline-delimited JSON stream parser
│   ├── events.ts               # Event helpers (stall detection)
│   └── runner.ts               # Worker lifecycle (workspace → turns → cleanup)
├── orchestrator/
│   ├── orchestrator.ts         # Main poll loop, concurrency, state management
│   ├── dispatcher.ts           # Issue → worker dispatch logic
│   ├── reconciler.ts           # State reconciliation (terminal detection)
│   └── retry.ts                # Exponential backoff retry logic
├── server/
│   ├── http-server.ts          # Fastify server setup
│   ├── api.ts                  # REST API routes
│   └── dashboard.ts            # HTML dashboard renderer
├── ssh/
│   ├── pool.ts                 # SSH host pool management
│   └── ssh-runner.ts           # Remote worker execution
└── tools/
    └── linear-graphql-server.ts # MCP server providing linear_graphql tool
```

## Testing

```bash
npm test              # Run all tests (vitest)
npm run test:watch    # Watch mode
npm run typecheck     # TypeScript type checking
```

The test suite covers 111 tests across all modules — workflow parsing, config resolution/validation, prompt rendering, stream parsing, orchestrator state management, retry logic, workspace management, and MCP server behavior.

## Design Rationale

### Why TypeScript + Claude CLI Subprocess

- **Claude Code CLI** provides a battle-tested agent runtime with tool use, MCP support, permission modes, and session resumption — no need to reimplement these.
- **stream-json output format** gives structured, parseable events (system init, assistant messages, tool calls, result summaries) over stdout, enabling the orchestrator to track sessions without polling.
- **`--resume <session_id>`** enables multi-turn continuity — the orchestrator can re-enter a session across turns while the agent retains its full conversation history.
- **MCP config injection** (`--mcp-config`) provides each agent with a per-workspace `linear_graphql` tool backed by the orchestrator's Linear credentials.
- **TypeScript/Node.js** offers strong typing (Zod schemas), a rich ecosystem (Fastify, pino, liquidjs), and straightforward deployment without specialized runtime requirements.

### Why Not the SDK

The Claude CLI subprocess approach was chosen over direct SDK integration because:

- The CLI handles tool execution, permission enforcement, and conversation management internally.
- Session resumption (`--resume`) provides multi-turn continuity without the orchestrator managing conversation state.
- The stream-json protocol gives the orchestrator exactly the observability it needs (session IDs, usage, results) without coupling to SDK internals.

## License

Apache 2.0
