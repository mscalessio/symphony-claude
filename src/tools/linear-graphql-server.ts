#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const LINEAR_ENDPOINT = process.env.LINEAR_ENDPOINT || "https://api.linear.app/graphql";

if (!LINEAR_API_KEY) {
  console.error("LINEAR_API_KEY environment variable is required");
  process.exit(1);
}

const server = new Server(
  { name: "symphony-linear", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "linear_graphql",
      description:
        "Execute a GraphQL query against the Linear API. " +
        "Use this to read or modify issues, projects, comments, and other Linear data. " +
        "The query must be a single GraphQL operation.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "The GraphQL query string to execute",
          },
          variables: {
            type: "object",
            description: "Optional variables for the GraphQL query",
            additionalProperties: true,
          },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "linear_graphql") {
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, errors: [{ message: `Unknown tool: ${request.params.name}` }] }) }],
      isError: true,
    };
  }

  const args = request.params.arguments as { query?: string; variables?: Record<string, unknown> };

  if (!args.query || typeof args.query !== "string" || !args.query.trim()) {
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, errors: [{ message: "query parameter is required and must be non-empty" }] }) }],
      isError: true,
    };
  }

  if (args.variables !== undefined && (typeof args.variables !== "object" || args.variables === null || Array.isArray(args.variables))) {
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, errors: [{ message: "variables must be an object" }] }) }],
      isError: true,
    };
  }

  try {
    const response = await fetch(LINEAR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: LINEAR_API_KEY,
      },
      body: JSON.stringify({ query: args.query, variables: args.variables }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, errors: [{ message: `HTTP ${response.status}: ${text.slice(0, 1000)}` }] }) }],
        isError: true,
      };
    }

    const result = (await response.json()) as { data?: unknown; errors?: unknown[] };

    if (result.errors) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, errors: result.errors, data: result.data }) }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, data: result.data }) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, errors: [{ message }] }) }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
