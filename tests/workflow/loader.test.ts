import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { loadWorkflow, WorkflowError } from "../../src/workflow/loader.js";

const tmpFiles: string[] = [];

function writeTmpFile(content: string, filename = "WORKFLOW.md"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-test-"));
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  tmpFiles.push(dir);
  return filePath;
}

afterEach(() => {
  for (const dir of tmpFiles) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpFiles.length = 0;
});

describe("loadWorkflow", () => {
  it("parses a valid WORKFLOW.md correctly", () => {
    const content = `---
tracker:
  kind: linear
  project_slug: my-proj
---
You are working on {{ issue.identifier }}.
`;
    const filePath = writeTmpFile(content);

    const result = loadWorkflow(filePath);

    expect(result.config.tracker.kind).toBe("linear");
    expect(result.config.tracker.project_slug).toBe("my-proj");
    // Default values should be filled in by Zod schema
    expect(result.config.tracker.api_key).toBe("$LINEAR_API_KEY");
    expect(result.config.agent.max_concurrent_agents).toBe(10);
    expect(result.prompt_template).toContain(
      "You are working on {{ issue.identifier }}."
    );
  });

  it("preserves all default values from Zod schema", () => {
    const content = `---
tracker:
  kind: linear
  project_slug: test-project
---
Prompt body here.
`;
    const filePath = writeTmpFile(content);

    const result = loadWorkflow(filePath);

    expect(result.config.polling.interval_ms).toBe(30000);
    expect(result.config.agent.max_turns).toBe(20);
    expect(result.config.codex.command).toBe("claude");
    expect(result.config.codex.approval_policy).toBe("bypassPermissions");
    expect(result.config.hooks.after_create).toBeNull();
    expect(result.config.server.port).toBeNull();
  });

  it("throws with code missing_workflow_file when file does not exist", () => {
    const nonexistent = path.join(os.tmpdir(), "nonexistent-symphony-test", "WORKFLOW.md");

    try {
      loadWorkflow(nonexistent);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowError);
      expect((err as WorkflowError).code).toBe("missing_workflow_file");
      expect((err as WorkflowError).message).toContain("Workflow file not found");
    }
  });

  it("throws with code workflow_parse_error for invalid front-matter", () => {
    // Missing required fields in the schema should cause a parse error
    const content = `---
tracker:
  kind: linear
  # missing project_slug (required by Zod)
---
Body here.
`;
    const filePath = writeTmpFile(content);

    try {
      loadWorkflow(filePath);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowError);
      expect((err as WorkflowError).code).toBe("workflow_parse_error");
    }
  });

  it("throws with code workflow_front_matter_not_a_map for non-map front-matter", () => {
    // gray-matter parses "---\nnull\n---" with data = null
    // However, gray-matter typically returns {} for null front-matter.
    // We need to craft content that gray-matter parses as non-object.
    // An array YAML will be parsed as data = [...]:
    const content = `---
- item1
- item2
---
Body text.
`;
    const filePath = writeTmpFile(content);

    try {
      loadWorkflow(filePath);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowError);
      expect((err as WorkflowError).code).toBe(
        "workflow_front_matter_not_a_map"
      );
      expect((err as WorkflowError).message).toContain("must be a YAML mapping");
    }
  });

  it("includes the file path in error messages", () => {
    const nonexistent = path.join(
      os.tmpdir(),
      "symphony-missing-path-12345",
      "WORKFLOW.md"
    );

    try {
      loadWorkflow(nonexistent);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as WorkflowError).message).toContain(nonexistent);
    }
  });
});
