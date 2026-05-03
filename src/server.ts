import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { existsSync } from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  type CallToolResult,
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { getToolsForMode, isLocalTool, toMcpTool } from './tools.js';
import { listGodotProjects, readGodotVersion, readProjectName } from './godot.js';
import type { ToolMode } from './types.js';

export interface BridgeLike {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface ToolExecutorDeps {
  bridge: BridgeLike;
  getGodotVersion: () => Promise<string>;
  launchEditor?: (args: Record<string, unknown>) => Promise<unknown>;
  runProject?: (args: Record<string, unknown>) => Promise<unknown>;
  getDebugOutput?: () => Promise<unknown>;
  stopProject?: () => Promise<unknown>;
  listProjects?: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ServerOptions {
  mode: ToolMode;
  bridge: BridgeLike;
  runtime: LocalGodotRuntime;
}

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;

export class LocalGodotRuntime {
  private activeProcess?: {
    process: ChildProcessWithoutNullStreams;
    output: string[];
    errors: string[];
  };

  constructor(private readonly godotPath?: string) {}

  async getGodotVersion(): Promise<string> {
    if (!this.godotPath) {
      throw new Error('未找到 Godot。请设置 GODOT_PATH 或使用 --godot 指定可执行文件。');
    }
    return readGodotVersion(this.godotPath);
  }

  async launchEditor(args: Record<string, unknown>): Promise<unknown> {
    const projectPath = requireString(args, 'projectPath');
    this.ensureGodotPath();
    this.ensureProject(projectPath);

    const child = spawn(this.godotPath!, ['--path', projectPath, '--editor'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    return {
      message: 'Godot 编辑器已启动。',
      projectPath,
      godotPath: this.godotPath,
    };
  }

  async runProject(args: Record<string, unknown>): Promise<unknown> {
    const projectPath = requireString(args, 'projectPath');
    this.ensureGodotPath();
    this.ensureProject(projectPath);

    await this.stopProject();

    const runArgs = ['--path', projectPath, '--debug'];
    if (typeof args.scene === 'string' && args.scene.length > 0) {
      runArgs.push(args.scene);
    }

    const child = spawn(this.godotPath!, runArgs);
    const output: string[] = [];
    const errors: string[] = [];
    child.stdout.on('data', (data) => output.push(data.toString()));
    child.stderr.on('data', (data) => errors.push(data.toString()));
    this.activeProcess = { process: child, output, errors };

    return {
      message: 'Godot 项目已启动。',
      projectPath,
      scene: args.scene ?? null,
    };
  }

  async getDebugOutput(): Promise<unknown> {
    if (!this.activeProcess) {
      return {
        output: [],
        errors: [],
        running: false,
      };
    }

    return {
      output: this.activeProcess.output,
      errors: this.activeProcess.errors,
      running: !this.activeProcess.process.killed,
    };
  }

  async stopProject(): Promise<unknown> {
    if (!this.activeProcess) {
      return {
        stopped: false,
        message: '没有由 server 启动的 Godot 进程。',
      };
    }

    this.activeProcess.process.kill();
    this.activeProcess = undefined;
    return {
      stopped: true,
    };
  }

  async listProjects(args: Record<string, unknown>): Promise<unknown> {
    const directory = requireString(args, 'directory');
    return {
      projects: await listGodotProjects(directory, Boolean(args.recursive)),
    };
  }

  async getBasicProjectInfo(args: Record<string, unknown>): Promise<unknown> {
    const projectPath = requireString(args, 'projectPath');
    this.ensureProject(projectPath);
    return {
      name: await readProjectName(projectPath),
      path: projectPath,
    };
  }

  private ensureGodotPath(): void {
    if (!this.godotPath) {
      throw new Error('未找到 Godot。请设置 GODOT_PATH 或使用 --godot 指定可执行文件。');
    }
  }

  private ensureProject(projectPath: string): void {
    if (!existsSync(`${projectPath}/project.godot`)) {
      throw new Error(`不是有效的 Godot 项目: ${projectPath}`);
    }
  }
}

export function createToolExecutor(deps: ToolExecutorDeps): ToolExecutor {
  return async (name: string, rawArgs: Record<string, unknown> = {}) => {
    const args = normalizeArgs(rawArgs);

    try {
      if (name === 'get_godot_version') {
        return textResult(await deps.getGodotVersion());
      }

      if (name === 'launch_editor' && deps.launchEditor) {
        return jsonResult(await deps.launchEditor(args));
      }

      if (name === 'run_project' && deps.runProject) {
        return jsonResult(await deps.runProject(args));
      }

      if (name === 'get_debug_output' && deps.getDebugOutput) {
        return jsonResult(await deps.getDebugOutput());
      }

      if (name === 'stop_project' && deps.stopProject) {
        return jsonResult(await deps.stopProject());
      }

      if (name === 'list_projects' && deps.listProjects) {
        return jsonResult(await deps.listProjects(args));
      }

      const pluginResult = await deps.bridge.call(name, rawArgs);
      return jsonResult(pluginResult);
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  };
}

export function createMcpServer(options: ServerOptions): Server {
  const server = new Server(
    {
      name: 'godot-mcp-mypro',
      version: '0.2.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const tools = getToolsForMode(options.mode);
  const enabledToolNames = new Set(tools.map((tool) => tool.name));
  const executeTool = createToolExecutor({
    bridge: options.bridge,
    getGodotVersion: () => options.runtime.getGodotVersion(),
    launchEditor: (args) => options.runtime.launchEditor(args),
    runProject: (args) => options.runtime.runProject(args),
    getDebugOutput: () => options.runtime.getDebugOutput(),
    stopProject: () => options.runtime.stopProject(),
    listProjects: (args) => options.runtime.listProjects(args),
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(toMcpTool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    if (!enabledToolNames.has(toolName)) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
    }

    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    if (toolName === 'get_project_info' && isLocalTool(toolName)) {
      return jsonResult(await options.runtime.getBasicProjectInfo(args));
    }

    return executeTool(toolName, args);
  });

  server.onerror = (error) => {
    console.error('[MCP Error]', error);
  };

  return server;
}

export function textResult(text: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

export function jsonResult(value: unknown): CallToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

export function errorResult(message: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
    isError: true,
  };
}

function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    result[key] = value;
    if (key.includes('_')) {
      result[toCamelCase(key)] = value;
    }
  }
  return result;
}

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function requireString(args: Record<string, unknown>, key: string): string {
  const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const value = args[key] ?? args[snakeKey];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`缺少必需参数: ${key}`);
  }
  return value;
}
