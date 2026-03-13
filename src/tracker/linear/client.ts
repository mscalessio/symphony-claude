import type pino from "pino";
import type { Issue, TrackerAdapter } from "../../types.js";
import {
  CANDIDATE_ISSUES_QUERY,
  ISSUES_BY_IDS_QUERY,
  ISSUES_BY_STATES_QUERY,
} from "./queries.js";
import { normalizeIssue } from "./normalize.js";

// ─── GraphQL response shapes ───

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface IssuesResponse {
  issues: {
    pageInfo: PageInfo;
    nodes: Record<string, any>[];
  };
}

// ─── LinearClient ───

export class LinearClient implements TrackerAdapter {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly projectSlug: string;
  private readonly activeStates: string[];
  private readonly logger: pino.Logger;
  private readonly timeoutMs = 30_000;

  constructor(opts: {
    endpoint: string;
    apiKey: string;
    projectSlug: string;
    activeStates: string[];
    logger: pino.Logger;
  }) {
    this.endpoint = opts.endpoint;
    this.apiKey = opts.apiKey;
    this.projectSlug = opts.projectSlug;
    this.activeStates = opts.activeStates;
    this.logger = opts.logger;
  }

  /**
   * Fetch all candidate issues matching the configured project and active
   * state names.  Pages through results 50 at a time and normalises each
   * node into the domain Issue model.
   */
  async fetchCandidateIssues(): Promise<Issue[]> {
    const allIssues: Issue[] = [];
    let after: string | null = null;

    do {
      const variables: Record<string, unknown> = {
        projectSlug: this.projectSlug,
        stateNames: this.activeStates,
        ...(after ? { after } : {}),
      };

      const data = await this.graphql<IssuesResponse>(
        CANDIDATE_ISSUES_QUERY,
        variables,
      );

      const { nodes, pageInfo } = data.issues;
      for (const node of nodes) {
        allIssues.push(normalizeIssue(node));
      }

      this.logger.debug(
        { fetched: nodes.length, total: allIssues.length, hasNextPage: pageInfo.hasNextPage },
        "fetched candidate issues page",
      );

      after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    } while (after);

    return allIssues;
  }

  /**
   * Fetch current state information for a list of issue IDs.
   * Returns a Map keyed by issue id.
   */
  async fetchIssueStatesByIds(
    issueIds: string[],
  ): Promise<Map<string, { id: string; state: string; identifier: string }>> {
    const result = new Map<string, { id: string; state: string; identifier: string }>();

    if (issueIds.length === 0) return result;

    const data = await this.graphql<IssuesResponse>(ISSUES_BY_IDS_QUERY, {
      ids: issueIds,
    });

    for (const node of data.issues.nodes) {
      if (node && node.id) {
        result.set(node.id, {
          id: node.id,
          state: node.state?.name ?? "Unknown",
          identifier: node.identifier,
        });
      }
    }

    this.logger.debug(
      { requested: issueIds.length, resolved: result.size },
      "fetched issue states by ids",
    );

    return result;
  }

  /**
   * Fetch all issues matching the given state names for the configured
   * project.  Used at startup for terminal-state cleanup.
   */
  async fetchIssuesByStates(stateNames: string[]): Promise<Issue[]> {
    const allIssues: Issue[] = [];
    let after: string | null = null;

    do {
      const variables: Record<string, unknown> = {
        projectSlug: this.projectSlug,
        stateNames,
        ...(after ? { after } : {}),
      };

      const data = await this.graphql<IssuesResponse>(
        ISSUES_BY_STATES_QUERY,
        variables,
      );

      const { nodes, pageInfo } = data.issues;
      for (const node of nodes) {
        // ISSUES_BY_STATES_QUERY returns minimal fields; build a light Issue
        allIssues.push({
          id: node.id,
          identifier: node.identifier,
          title: "",
          description: null,
          state: node.state?.name ?? "Unknown",
          priority: null,
          created_at: "",
          labels: [],
          blockers: [],
        });
      }

      this.logger.debug(
        { fetched: nodes.length, total: allIssues.length, hasNextPage: pageInfo.hasNextPage },
        "fetched issues by states page",
      );

      after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    } while (after);

    return allIssues;
  }

  // ─── Private helpers ───

  /**
   * Execute a raw GraphQL request against the Linear API.
   */
  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "<unreadable>");
        throw new Error(
          `Linear API HTTP ${response.status}: ${body}`,
        );
      }

      const json = (await response.json()) as {
        data?: T;
        errors?: Array<{ message: string }>;
      };

      if (json.errors && json.errors.length > 0) {
        const messages = json.errors.map((e) => e.message).join("; ");
        throw new Error(`Linear GraphQL errors: ${messages}`);
      }

      if (!json.data) {
        throw new Error("Linear GraphQL response missing data field");
      }

      return json.data;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(
          `Linear API request timed out after ${this.timeoutMs}ms`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}
