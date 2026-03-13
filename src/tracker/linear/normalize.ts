import type { Issue, BlockerRef } from "../../types.js";

/**
 * Normalize a raw Linear GraphQL issue node into the domain Issue model.
 */
export function normalizeIssue(raw: Record<string, any>): Issue {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description: raw.description ?? null,
    state: raw.state?.name ?? "Unknown",
    priority: raw.priority ?? null,
    created_at: raw.createdAt,
    labels: (raw.labels?.nodes ?? []).map((l: any) => l.name),
    blockers: normalizeBlockers(raw.inverseRelations?.nodes ?? []),
  };
}

/**
 * Normalize inverse "blocks" relations into BlockerRef entries.
 * Filters to only include relations of type "blocks".
 */
function normalizeBlockers(relations: any[]): BlockerRef[] {
  return relations
    .filter((r: any) => r.type === "blocks")
    .map((r: any) => ({
      id: r.issue.id,
      identifier: r.issue.identifier,
      state: r.issue.state?.name ?? "Unknown",
    }));
}
