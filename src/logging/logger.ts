// ─── Structured Pino Logger for Symphony Orchestration Service ───

import pino from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Fields that must never appear in log output.
 * Any key matching these names is replaced with "[REDACTED]".
 */
const REDACTED_PATHS = [
  "api_key",
  "apiKey",
  "token",
  "secret",
  "password",
  "authorization",
  "Authorization",
];

/**
 * Create a root pino logger.
 *
 * - In production: structured JSON, no colour, no fancy formatting.
 * - In development: uses pino-pretty for human-readable output.
 */
export function createLogger(name = "symphony", logFile?: string): pino.Logger {
  if (logFile) {
    // When a log file is specified (e.g. TUI mode), write structured JSON
    // to the file instead of stdout to avoid corrupting terminal output.
    return pino({
      name,
      level: LOG_LEVEL,
      redact: {
        paths: REDACTED_PATHS,
        censor: "[REDACTED]",
      },
    }, pino.destination(logFile));
  }

  const transport: pino.TransportSingleOptions | undefined = IS_PRODUCTION
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
          ignore: "pid,hostname",
        },
      };

  return pino({
    name,
    level: LOG_LEVEL,
    redact: {
      paths: REDACTED_PATHS,
      censor: "[REDACTED]",
    },
    ...(transport ? { transport } : {}),
  });
}

/**
 * Create a child logger that carries issue-scoped context on every line.
 *
 * Typical usage:
 * ```ts
 * const log = createChildLogger(rootLogger, {
 *   issue_id: issue.id,
 *   issue_identifier: issue.identifier,
 *   session_id: sessionId,
 * });
 * log.info("starting agent run");
 * ```
 */
export function createChildLogger(
  parent: pino.Logger,
  context: {
    issue_id?: string;
    issue_identifier?: string;
    session_id?: string;
  },
): pino.Logger {
  return parent.child(context);
}
