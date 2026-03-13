// ─── Linear GraphQL Query Strings ───

/**
 * Fetch candidate issues filtered by project slug and state names.
 * Uses cursor-based pagination (50 per page).
 */
export const CANDIDATE_ISSUES_QUERY = /* GraphQL */ `
  query CandidateIssues($projectSlug: String!, $stateNames: [String!]!, $after: String) {
    issues(
      first: 50
      after: $after
      filter: {
        project: { slugId: { eq: $projectSlug } }
        state: { name: { in: $stateNames } }
      }
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        identifier
        title
        description
        priority
        createdAt
        state {
          id
          name
        }
        labels {
          nodes {
            name
          }
        }
        inverseRelations(type: "blocks") {
          nodes {
            issue {
              id
              identifier
              state {
                name
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Fetch issues by their GraphQL node IDs (minimal fields for state refresh).
 */
export const ISSUES_BY_IDS_QUERY = /* GraphQL */ `
  query IssuesByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Issue {
        id
        identifier
        state {
          name
        }
      }
    }
  }
`;

/**
 * Fetch issues by state names for a project (used for terminal cleanup).
 * Uses cursor-based pagination (50 per page).
 */
export const ISSUES_BY_STATES_QUERY = /* GraphQL */ `
  query IssuesByStates($projectSlug: String!, $stateNames: [String!]!, $after: String) {
    issues(
      first: 50
      after: $after
      filter: {
        project: { slugId: { eq: $projectSlug } }
        state: { name: { in: $stateNames } }
      }
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        identifier
        state {
          name
        }
      }
    }
  }
`;
