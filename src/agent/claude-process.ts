import { spawn, type ChildProcess } from "node:child_process";
import type pino from "pino";
import type { ClaudeStreamEvent, TurnResult } from "../types.js";
import { createStreamParser, extractSessionId, extractUsage, isSuccessResult } from "./stream-parser.js";

export interface SpawnClaudeTurnOpts {
  prompt: string;
  cwd: string;
  sessionId?: string;
  permissionMode: string;
  model?: string;
  mcpConfigPath?: string;
  abortSignal: AbortSignal;
  turnTimeoutMs: number;
  command: string;
  onEvent: (event: ClaudeStreamEvent) => void;
  onPid?: (pid: number) => void;
  logger: pino.Logger;
}

export function spawnClaudeTurn(opts: SpawnClaudeTurnOpts): Promise<TurnResult> {
  const {
    prompt, cwd, sessionId, permissionMode, model,
    mcpConfigPath, abortSignal, turnTimeoutMs, command,
    onEvent, logger,
  } = opts;

  return new Promise<TurnResult>((resolve, reject) => {
    if (abortSignal.aborted) {
      return reject(new Error("Aborted before spawn"));
    }

    // Always pass the prompt via stdin to avoid Claude CLI treating
    // positional args as file paths when --mcp-config is present.
    const args: string[] = ["-p", "--verbose", "--output-format", "stream-json"];

    if (permissionMode === "bypassPermissions") {
      args.push("--dangerously-skip-permissions");
    } else {
      args.push("--permission-mode", permissionMode);
    }

    if (sessionId) {
      args.push("--resume", sessionId);
    }
    if (model) {
      args.push("--model", model);
    }
    if (mcpConfigPath) {
      args.push("--mcp-config", mcpConfigPath);
    }

    const shellCmd = `${command} ${args.map(shellEscape).join(" ")}`;

    logger.debug({ shellCmd: shellCmd.slice(0, 500) }, "Spawning claude turn");

    let child: ChildProcess;
    try {
      child = spawn("bash", ["-lc", shellCmd], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (err) {
      return reject(new Error(`Failed to spawn claude process: ${err}`));
    }

    if (child.pid != null) {
      opts.onPid?.(child.pid);
    }

    let resultEvent: ClaudeStreamEvent | null = null;
    let detectedSessionId: string | null = sessionId ?? null;
    let lastUsage = { input_tokens: 0, output_tokens: 0 };
    let lastCost = 0;
    let lastDuration = 0;
    let settled = false;

    function settle(result: TurnResult) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    function settleError(error: string) {
      if (settled) return;
      settled = true;
      resolve({
        success: false,
        sessionId: detectedSessionId,
        usage: lastUsage,
        cost_usd: lastCost,
        duration_ms: lastDuration,
        error,
      });
    }

    // Timeout handling
    const turnTimer = setTimeout(() => {
      logger.warn("Turn timeout reached, killing process");
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
      settleError("Turn timeout exceeded");
    }, turnTimeoutMs);

    // Abort handling
    const onAbort = () => {
      logger.info("Abort signal received, killing claude process");
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
      settleError("Aborted");
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });

    // Parse stdout stream
    if (child.stdout) {
      createStreamParser(
        child.stdout,
        (event) => {
          try {
            onEvent(event);

            const sid = extractSessionId(event);
            if (sid) detectedSessionId = sid;

            const usage = extractUsage(event);
            if (usage) {
              lastUsage = { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };
              lastCost = usage.cost_usd;
              lastDuration = usage.duration_ms;
            }

            if (event.type === "result") {
              resultEvent = event;
            }
          } catch (err) {
            logger.error({ err }, "Error processing stream event");
          }
        },
        (err) => {
          logger.error({ err }, "Stream parser error");
        }
      );
    }

    // Log stderr
    const stderrChunks: Buffer[] = [];
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
    }

    // Write prompt to stdin
    if (child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }

    child.on("error", (err) => {
      clearTimeout(turnTimer);
      abortSignal.removeEventListener("abort", onAbort);
      settleError(`Process error: ${err.message}`);
    });

    child.on("close", (code) => {
      clearTimeout(turnTimer);
      abortSignal.removeEventListener("abort", onAbort);

      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
      if (stderr) {
        logger.debug({ stderr: stderr.slice(0, 2000) }, "Claude stderr output");
      }

      if (resultEvent && isSuccessResult(resultEvent)) {
        settle({
          success: true,
          sessionId: detectedSessionId,
          usage: lastUsage,
          cost_usd: lastCost,
          duration_ms: lastDuration,
          error: null,
        });
      } else if (resultEvent) {
        const errMsg = (resultEvent as any).result ?? `Claude exited with error (code ${code})`;
        settleError(errMsg);
      } else {
        settleError(`Claude process exited without result event (code ${code})${stderr ? `: ${stderr.slice(0, 500)}` : ""}`);
      }
    });
  });
}

function shellEscape(arg: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
