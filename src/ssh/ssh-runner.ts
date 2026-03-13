import { spawn } from "node:child_process";
import type pino from "pino";
import type { ClaudeStreamEvent, TurnResult } from "../types.js";
import { createStreamParser, extractSessionId, extractUsage, isSuccessResult } from "../agent/stream-parser.js";

export interface SshTurnOpts {
  host: string;
  prompt: string;
  cwd: string;
  sessionId?: string;
  permissionMode: string;
  model?: string;
  abortSignal: AbortSignal;
  turnTimeoutMs: number;
  command: string;
  onEvent: (event: ClaudeStreamEvent) => void;
  onPid?: (pid: number) => void;
  logger: pino.Logger;
}

/**
 * Run a claude turn on a remote host via SSH.
 * The workspace root is interpreted on the remote host.
 */
export function spawnSshClaudeTurn(opts: SshTurnOpts): Promise<TurnResult> {
  const {
    host, prompt, cwd, sessionId, permissionMode, model,
    abortSignal, turnTimeoutMs, command, onEvent, logger,
  } = opts;

  return new Promise<TurnResult>((resolve) => {
    if (abortSignal.aborted) {
      return resolve({
        success: false, sessionId: null,
        usage: { input_tokens: 0, output_tokens: 0 },
        cost_usd: 0, duration_ms: 0, error: "Aborted before spawn",
      });
    }

    const args: string[] = ["-p", "--output-format", "stream-json"];

    if (permissionMode === "bypassPermissions") {
      args.push("--dangerously-skip-permissions");
    } else {
      args.push("--permission-mode", permissionMode);
    }

    if (sessionId) args.push("--resume", sessionId);
    if (model) args.push("--model", model);

    // Use stdin for prompt to avoid arg length issues over SSH
    // cd into the workspace on the remote host before running claude
    const remoteCmd = `cd ${shellEscape(cwd)} && ${command} ${args.map(shellEscape).join(" ")}`;
    const sshArgs = [host, "--", "bash", "-lc", remoteCmd];

    logger.debug({ host, remoteCmd: remoteCmd.slice(0, 500) }, "Spawning SSH claude turn");

    const child = spawn("ssh", sshArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

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

    const turnTimer = setTimeout(() => {
      child.kill("SIGTERM");
      settle({
        success: false, sessionId: detectedSessionId,
        usage: lastUsage, cost_usd: lastCost, duration_ms: lastDuration,
        error: "Turn timeout exceeded (SSH)",
      });
    }, turnTimeoutMs);

    const onAbort = () => {
      child.kill("SIGTERM");
      settle({
        success: false, sessionId: detectedSessionId,
        usage: lastUsage, cost_usd: lastCost, duration_ms: lastDuration,
        error: "Aborted",
      });
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });

    if (child.stdout) {
      createStreamParser(
        child.stdout,
        (event) => {
          onEvent(event);
          const sid = extractSessionId(event);
          if (sid) detectedSessionId = sid;
          const usage = extractUsage(event);
          if (usage) {
            lastUsage = { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };
            lastCost = usage.cost_usd;
            lastDuration = usage.duration_ms;
          }
          if (event.type === "result") resultEvent = event;
        },
        (err) => logger.error({ err }, "SSH stream parser error")
      );
    }

    // Pipe prompt to stdin
    if (child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }

    child.on("close", (code) => {
      clearTimeout(turnTimer);
      abortSignal.removeEventListener("abort", onAbort);

      if (resultEvent && isSuccessResult(resultEvent)) {
        settle({
          success: true, sessionId: detectedSessionId,
          usage: lastUsage, cost_usd: lastCost, duration_ms: lastDuration,
          error: null,
        });
      } else {
        settle({
          success: false, sessionId: detectedSessionId,
          usage: lastUsage, cost_usd: lastCost, duration_ms: lastDuration,
          error: (resultEvent as any)?.result ?? `SSH claude process exited (code ${code})`,
        });
      }
    });

    child.on("error", (err) => {
      clearTimeout(turnTimer);
      abortSignal.removeEventListener("abort", onAbort);
      settle({
        success: false, sessionId: detectedSessionId,
        usage: lastUsage, cost_usd: lastCost, duration_ms: lastDuration,
        error: `SSH process error: ${err.message}`,
      });
    });
  });
}

function shellEscape(arg: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
