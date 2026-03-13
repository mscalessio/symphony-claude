import { describe, it, expect } from "vitest";
import { normalizeIssue } from "../../src/tracker/linear/normalize.js";

describe("normalizeIssue", () => {
  it("maps all fields correctly from raw Linear data", () => {
    const raw = {
      id: "abc-123",
      identifier: "PROJ-42",
      title: "Fix the bug",
      description: "There is a bug in the login flow.",
      state: { name: "In Progress" },
      priority: 2,
      createdAt: "2025-06-01T12:00:00Z",
      labels: {
        nodes: [{ name: "bug" }, { name: "urgent" }],
      },
      inverseRelations: {
        nodes: [],
      },
    };

    const issue = normalizeIssue(raw);

    expect(issue).toEqual({
      id: "abc-123",
      identifier: "PROJ-42",
      title: "Fix the bug",
      description: "There is a bug in the login flow.",
      state: "In Progress",
      priority: 2,
      created_at: "2025-06-01T12:00:00Z",
      labels: ["bug", "urgent"],
      blockers: [],
    });
  });

  it("defaults description to null when missing", () => {
    const raw = {
      id: "abc-123",
      identifier: "PROJ-1",
      title: "No description issue",
      state: { name: "Todo" },
      priority: 1,
      createdAt: "2025-01-01T00:00:00Z",
      labels: { nodes: [] },
      inverseRelations: { nodes: [] },
    };

    const issue = normalizeIssue(raw);

    expect(issue.description).toBeNull();
  });

  it("defaults priority to null when missing", () => {
    const raw = {
      id: "abc-123",
      identifier: "PROJ-1",
      title: "No priority issue",
      description: "Some desc",
      state: { name: "Todo" },
      createdAt: "2025-01-01T00:00:00Z",
      labels: { nodes: [] },
      inverseRelations: { nodes: [] },
    };

    const issue = normalizeIssue(raw);

    expect(issue.priority).toBeNull();
  });

  it("defaults state to 'Unknown' when state object is missing", () => {
    const raw = {
      id: "abc-123",
      identifier: "PROJ-1",
      title: "Missing state",
      description: null,
      createdAt: "2025-01-01T00:00:00Z",
      labels: { nodes: [] },
      inverseRelations: { nodes: [] },
    };

    const issue = normalizeIssue(raw);

    expect(issue.state).toBe("Unknown");
  });

  it("defaults labels to empty array when labels.nodes is missing", () => {
    const raw = {
      id: "abc-123",
      identifier: "PROJ-1",
      title: "No labels",
      description: null,
      state: { name: "Todo" },
      priority: 1,
      createdAt: "2025-01-01T00:00:00Z",
      inverseRelations: { nodes: [] },
    };

    const issue = normalizeIssue(raw);

    expect(issue.labels).toEqual([]);
  });

  it("defaults blockers to empty when inverseRelations is missing", () => {
    const raw = {
      id: "abc-123",
      identifier: "PROJ-1",
      title: "No blockers",
      description: null,
      state: { name: "Todo" },
      priority: 1,
      createdAt: "2025-01-01T00:00:00Z",
      labels: { nodes: [] },
    };

    const issue = normalizeIssue(raw);

    expect(issue.blockers).toEqual([]);
  });

  it("normalizes blockers from inverseRelations", () => {
    const raw = {
      id: "abc-123",
      identifier: "PROJ-1",
      title: "Blocked issue",
      description: null,
      state: { name: "Todo" },
      priority: 1,
      createdAt: "2025-01-01T00:00:00Z",
      labels: { nodes: [] },
      inverseRelations: {
        nodes: [
          {
            issue: {
              id: "blocker-1",
              identifier: "PROJ-10",
              state: { name: "In Progress" },
            },
          },
          {
            issue: {
              id: "blocker-2",
              identifier: "PROJ-11",
              state: { name: "Done" },
            },
          },
        ],
      },
    };

    const issue = normalizeIssue(raw);

    expect(issue.blockers).toEqual([
      { id: "blocker-1", identifier: "PROJ-10", state: "In Progress" },
      { id: "blocker-2", identifier: "PROJ-11", state: "Done" },
    ]);
  });

  it("defaults blocker state to 'Unknown' when state is missing", () => {
    const raw = {
      id: "abc-123",
      identifier: "PROJ-1",
      title: "Blocked issue",
      description: null,
      state: { name: "Todo" },
      priority: 1,
      createdAt: "2025-01-01T00:00:00Z",
      labels: { nodes: [] },
      inverseRelations: {
        nodes: [
          {
            issue: {
              id: "blocker-1",
              identifier: "PROJ-10",
              // state is missing
            },
          },
        ],
      },
    };

    const issue = normalizeIssue(raw);

    expect(issue.blockers[0].state).toBe("Unknown");
  });

  it("handles multiple labels correctly", () => {
    const raw = {
      id: "abc-123",
      identifier: "PROJ-1",
      title: "Multi label",
      description: null,
      state: { name: "Todo" },
      priority: 1,
      createdAt: "2025-01-01T00:00:00Z",
      labels: {
        nodes: [{ name: "bug" }, { name: "p0" }, { name: "backend" }],
      },
      inverseRelations: { nodes: [] },
    };

    const issue = normalizeIssue(raw);

    expect(issue.labels).toEqual(["bug", "p0", "backend"]);
  });
});
