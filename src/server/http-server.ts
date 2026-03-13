import Fastify from "fastify";
import type pino from "pino";
import type { Orchestrator } from "../orchestrator/orchestrator.js";
import { registerRoutes } from "./api.js";

export interface HttpServerOpts {
  port: number;
  host?: string;
  orchestrator: Orchestrator;
  logger: pino.Logger;
}

export class HttpServer {
  private readonly app;
  private readonly port: number;
  private readonly host: string;

  constructor(opts: HttpServerOpts) {
    this.port = opts.port;
    this.host = opts.host ?? "127.0.0.1";

    this.app = Fastify({ logger: false });

    registerRoutes(this.app, opts.orchestrator);
  }

  async start(): Promise<{ address: string; port: number }> {
    const address = await this.app.listen({ port: this.port, host: this.host });
    return { address, port: this.app.server.address()?.toString().includes(":") ? (this.app.server.address() as any).port : this.port };
  }

  async stop(): Promise<void> {
    await this.app.close();
  }
}
