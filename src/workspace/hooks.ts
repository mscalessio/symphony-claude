import { spawn } from "node:child_process";
import type pino from "pino";

const MAX_OUTPUT_BYTES = 10 * 1024; // 10 KB

/**
 * Execute a shell hook script in the workspace directory.
 * Uses `sh -lc <script>` with the workspace as cwd.
 *
 * @param script - The shell script to execute
 * @param cwd - Working directory (workspace path)
 * @param timeoutMs - Maximum execution time before abort
 * @param logger - Logger instance
 * @returns Promise that resolves on exit code 0, rejects otherwise
 */
export async function runHook(
  script: string,
  cwd: string,
  timeoutMs: number,
  logger: pino.Logger,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  logger.info({ script, cwd, timeoutMs }, "hook:start");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  return new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn("sh", ["-lc", script], {
        cwd,
        signal: ac.signal,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutChunks: Buffer[] = [];
      let stdoutLen = 0;
      const stderrChunks: Buffer[] = [];
      let stderrLen = 0;

      child.stdout.on("data", (chunk: Buffer) => {
        if (stdoutLen < MAX_OUTPUT_BYTES) {
          const remaining = MAX_OUTPUT_BYTES - stdoutLen;
          stdoutChunks.push(chunk.subarray(0, remaining));
          stdoutLen += chunk.length;
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        if (stderrLen < MAX_OUTPUT_BYTES) {
          const remaining = MAX_OUTPUT_BYTES - stderrLen;
          stderrChunks.push(chunk.subarray(0, remaining));
          stderrLen += chunk.length;
        }
      });

      child.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.name === "AbortError" || ac.signal.aborted) {
          logger.error({ script, timeoutMs }, "hook:timeout");
          reject(
            new Error(
              `Hook timed out after ${timeoutMs}ms: ${script}`,
            ),
          );
        } else {
          logger.error({ err, script }, "hook:error");
          reject(err);
        }
      });

      child.on("close", (code: number | null) => {
        clearTimeout(timer);

        const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");
        const exitCode = code ?? 1;

        if (exitCode === 0) {
          logger.info({ script, exitCode }, "hook:done");
          resolve({ exitCode, stdout, stderr });
        } else {
          logger.error({ script, exitCode, stderr }, "hook:failed");
          const err = new Error(
            `Hook exited with code ${exitCode}: ${stderr.slice(0, 200)}`,
          );
          (err as Error & { exitCode: number }).exitCode = exitCode;
          reject(err);
        }
      });
    },
  );
}
