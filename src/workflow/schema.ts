import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { WorkflowConfig } from "../types.js";

// ─── Sub-schemas ───

const TrackerSchema = z.object({
  kind: z.string(),
  endpoint: z.string().default("https://api.linear.app/graphql"),
  api_key: z.string().default("$LINEAR_API_KEY"),
  project_slug: z.string(),
  active_states: z.array(z.string()).default(["Todo", "In Progress"]),
  terminal_states: z
    .array(z.string())
    .default(["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]),
});

const PollingSchema = z
  .object({
    interval_ms: z.number().int().positive().default(30_000),
  })
  .default({});

const WorkspaceSchema = z
  .object({
    root: z
      .string()
      .default(path.join(os.tmpdir(), "symphony_workspaces")),
  })
  .default({});

const HooksSchema = z
  .object({
    after_create: z.string().nullable().default(null),
    before_run: z.string().nullable().default(null),
    after_run: z.string().nullable().default(null),
    before_remove: z.string().nullable().default(null),
    timeout_ms: z.number().int().positive().default(60_000),
  })
  .default({});

const AgentSchema = z
  .object({
    max_concurrent_agents: z.number().int().positive().default(10),
    max_turns: z.number().int().positive().default(20),
    max_retry_backoff_ms: z.number().int().nonnegative().default(300_000),
    max_concurrent_agents_by_state: z.record(z.string(), z.number().int().nonnegative()).default({}),
  })
  .default({});

const CodexSchema = z
  .object({
    command: z.string().default("claude"),
    approval_policy: z.string().default("bypassPermissions"),
    turn_timeout_ms: z.number().int().positive().default(3_600_000),
    read_timeout_ms: z.number().int().positive().default(5_000),
    stall_timeout_ms: z.number().int().positive().default(300_000),
  })
  .default({});

const ServerSchema = z
  .object({
    port: z.number().int().positive().nullable().default(null),
  })
  .default({});

const WorkerSchema = z
  .object({
    ssh_hosts: z.array(z.string()).nullable().default(null),
    max_concurrent_agents_per_host: z
      .number()
      .int()
      .positive()
      .nullable()
      .default(null),
  })
  .default({});

// ─── Top-level schema ───

export const WorkflowFrontMatterSchema = z.object({
  tracker: TrackerSchema,
  polling: PollingSchema,
  workspace: WorkspaceSchema,
  hooks: HooksSchema,
  agent: AgentSchema,
  codex: CodexSchema,
  server: ServerSchema,
  worker: WorkerSchema,
});

export type WorkflowFrontMatter = z.infer<typeof WorkflowFrontMatterSchema>;

/**
 * Validate raw front-matter data against the schema and return a fully
 * defaulted {@link WorkflowConfig}.
 */
export function parseWorkflowFrontMatter(data: unknown): WorkflowConfig {
  return WorkflowFrontMatterSchema.parse(data);
}
