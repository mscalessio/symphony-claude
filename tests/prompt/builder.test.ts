import { describe, it, expect } from "vitest";
import { buildPrompt } from "../../src/prompt/builder.js";
import type { Issue } from "../../src/types.js";

function makeIssue(overrides?: Partial<Issue>): Issue {
  return {
    id: "issue-1",
    identifier: "PROJ-42",
    title: "Implement login feature",
    description: "Add OAuth2 login flow",
    state: "Todo",
    priority: 1,
    created_at: "2025-01-15T10:00:00Z",
    labels: ["feature", "auth"],
    blockers: [],
    ...overrides,
  };
}

describe("buildPrompt", () => {
  it("renders template with issue data on turn 1", async () => {
    const template =
      "Work on {{ issue.identifier }}: {{ issue.title }}. Priority: {{ issue.priority }}.";
    const issue = makeIssue();

    const result = await buildPrompt(template, issue, 1, 1);

    expect(result).toBe(
      "Work on PROJ-42: Implement login feature. Priority: 1."
    );
  });

  it("provides attempt variable to the template", async () => {
    const template = "Attempt {{ attempt }} for {{ issue.identifier }}.";
    const issue = makeIssue();

    const result = await buildPrompt(template, issue, 3, 1);

    expect(result).toBe("Attempt 3 for PROJ-42.");
  });

  it("returns continuation prompt on turn 2+", async () => {
    const template = "This should NOT be rendered on turn > 1.";
    const issue = makeIssue();

    const result = await buildPrompt(template, issue, 1, 2);

    expect(result).toContain("Continue working on PROJ-42");
    expect(result).toContain("Implement login feature");
    expect(result).not.toContain("This should NOT be rendered");
  });

  it("returns continuation prompt on turn 5", async () => {
    const issue = makeIssue();

    const result = await buildPrompt("any template", issue, 1, 5);

    expect(result).toContain("Continue working on PROJ-42");
  });

  it("returns fallback prompt when template is empty", async () => {
    const issue = makeIssue();

    const result = await buildPrompt("", issue, 1, 1);

    expect(result).toBe("You are working on an issue from Linear.");
  });

  it("returns fallback prompt when template is whitespace only", async () => {
    const issue = makeIssue();

    const result = await buildPrompt("   \n\t  ", issue, 1, 1);

    expect(result).toBe("You are working on an issue from Linear.");
  });

  it("throws descriptive error for invalid Liquid template", async () => {
    const template = "{{ issue.identifier | nonexistent_filter }}";
    const issue = makeIssue();

    await expect(buildPrompt(template, issue, 1, 1)).rejects.toThrow(
      /Failed to render Liquid prompt template for issue PROJ-42/
    );
  });

  it("throws descriptive error for undefined variable with strict mode", async () => {
    const template = "{{ undefined_var }}";
    const issue = makeIssue();

    await expect(buildPrompt(template, issue, 1, 1)).rejects.toThrow(
      /Failed to render Liquid prompt template for issue PROJ-42/
    );
  });

  it("renders issue labels in template", async () => {
    const template =
      "Labels: {% for label in issue.labels %}{{ label }}{% unless forloop.last %}, {% endunless %}{% endfor %}";
    const issue = makeIssue({ labels: ["bug", "urgent"] });

    const result = await buildPrompt(template, issue, 1, 1);

    expect(result).toBe("Labels: bug, urgent");
  });
});
