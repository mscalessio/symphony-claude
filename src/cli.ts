import { Command } from "commander";

export interface CliArgs {
  workflowPath: string;
  port: number | null;
  tui: boolean;
  logFile: string;
}

export function parseCli(argv: string[]): CliArgs {
  const program = new Command();

  program
    .name("symphony")
    .description("Long-running orchestration service that polls Linear for issues and runs Claude Code CLI sessions")
    .version("0.0.1")
    .argument("[workflow]", "Path to WORKFLOW.md file", "./WORKFLOW.md")
    .option("-p, --port <port>", "HTTP server port (overrides server.port in workflow)")
    .option("--no-tui", "Disable terminal dashboard (logs go to stdout)")
    .option("--log-file <path>", "Log file path when TUI is active", "symphony.log")
    .parse(argv);

  const workflowPath = program.args[0] ?? "./WORKFLOW.md";
  const opts = program.opts();
  const port = opts.port ? parseInt(opts.port, 10) : null;

  if (port !== null && (isNaN(port) || port < 0 || port > 65535)) {
    console.error(`Invalid port: ${opts.port}`);
    process.exit(1);
  }

  return {
    workflowPath,
    port,
    tui: opts.tui !== false,
    logFile: opts.logFile ?? "symphony.log",
  };
}
