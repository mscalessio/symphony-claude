import fs from "node:fs";
import matter from "gray-matter";
import { ZodError } from "zod";
import { parseWorkflowFrontMatter } from "./schema.js";
import type { ParsedWorkflow } from "../types.js";

export class WorkflowError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkflowError";
  }
}

/**
 * Load and validate a WORKFLOW.md file.
 *
 * 1. Reads the file from disk.
 * 2. Splits YAML front-matter from the markdown body via `gray-matter`.
 * 3. Validates the front-matter through the Zod schema.
 * 4. Returns the parsed config together with the prompt template.
 */
export function loadWorkflow(filePath: string): ParsedWorkflow {
  // 1. Read file
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err: unknown) {
    throw new WorkflowError(
      `Workflow file not found: ${filePath}`,
      "missing_workflow_file",
      { cause: err },
    );
  }

  // 2. Parse with gray-matter
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err: unknown) {
    throw new WorkflowError(
      `Failed to parse YAML front-matter in ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      "workflow_parse_error",
      { cause: err },
    );
  }

  const { data, content } = parsed;

  // 3. Validate front-matter is a plain object (not null, not an array)
  if (data === null || data === undefined || Array.isArray(data) || typeof data !== "object") {
    throw new WorkflowError(
      `Front-matter in ${filePath} must be a YAML mapping, got ${data === null ? "null" : Array.isArray(data) ? "array" : typeof data}`,
      "workflow_front_matter_not_a_map",
    );
  }

  // 4. Parse through Zod schema
  let config;
  try {
    config = parseWorkflowFrontMatter(data);
  } catch (err: unknown) {
    const detail =
      err instanceof ZodError
        ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        : String(err);
    throw new WorkflowError(
      `Invalid workflow front-matter in ${filePath}: ${detail}`,
      "workflow_parse_error",
      { cause: err },
    );
  }

  // 5. Return parsed workflow
  return { config, prompt_template: content };
}
