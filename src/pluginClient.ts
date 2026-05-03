import { WebSocketServer, type WebSocket } from 'ws';

import type { JsonRpcRequest, JsonRpcResponse } from './types.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface GodotPluginBridgeOptions {
  port: number;
  host?: string;
  requestTimeoutMs?: number;
}

export class JsonRpcBridgeError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'JsonRpcBridgeError';
  }
}

export class GodotPluginBridge {
  private server?: WebSocketServer;
  private clients = new Set<WebSocket>();
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private readonly requestedPort: number;
  private readonly host: string;
  private readonly requestTimeoutMs: number;

  public port: number;

  constructor(options: GodotPluginBridgeOptions) {
    this.requestedPort = options.port;
    this.port = options.port;
    this.host = options.host ?? '127.0.0.1';
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = new WebSocketServer({
      host: this.host,
      port: this.requestedPort,
    });

    this.server.on('connection', (client) => {
      this.clients.add(client);
      client.on('message', (data) => this.handleMessage(data.toString()));
      client.on('close', () => this.clients.delete(client));
      client.on('error', () => this.clients.delete(client));
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('listening', () => {
        const address = this.server?.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
        }
        resolve();
      });
      this.server?.once('error', reject);
    });
  }

  async stop(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Godot bridge stopped before the command completed.'));
    }
    this.pending.clear();

    for (const client of this.clients) {
      client.close(1000, 'Server shutting down');
    }
    this.clients.clear();

    const server = this.server;
    this.server = undefined;
    if (!server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  get connectedClientCount(): number {
    return [...this.clients].filter((client) => client.readyState === client.OPEN).length;
  }

  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const client = this.firstOpenClient();
    if (!client) {
      throw new Error(
        `Godot 插件尚未连接。请在 Godot 项目中安装并启用 addons/godot_mcp，然后确认插件连接到端口 ${this.port}。`,
      );
    }

    const id = this.nextId;
    this.nextId += 1;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Godot command timed out: ${method}`));
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });
    });

    client.send(JSON.stringify(request));
    return result;
  }

  private handleMessage(text: string): void {
    let response: JsonRpcResponse;
    try {
      response = JSON.parse(text) as JsonRpcResponse;
    } catch {
      return;
    }

    if (typeof response.id !== 'number') {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(new JsonRpcBridgeError(
        response.error.message,
        response.error.code,
        response.error.data,
      ));
      return;
    }

    pending.resolve(response.result ?? {});
  }

  private firstOpenClient(): WebSocket | undefined {
    return [...this.clients].find((client) => client.readyState === client.OPEN);
  }
}
