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

import { ALL_TOOLS, getToolsForMode, isLocalTool, normalizeMode, toMcpTool } from './tools.js';
import { listGodotProjects, readGodotVersion, readProjectName } from './godot.js';
import { JsonRpcBridgeError } from './pluginClient.js';
import type { GodotToolDefinition, SafetyMode, ToolMode } from './types.js';

export interface BridgeLike {
  port?: number;
  connectedClientCount?: number;
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
  mode?: ToolMode;
  safety?: SafetyMode;
  allowScriptExec?: boolean;
}

export interface ServerOptions {
  mode: ToolMode;
  bridge: BridgeLike;
  runtime: LocalGodotRuntime;
  safety?: SafetyMode;
  allowScriptExec?: boolean;
}

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;

const SESSION_TOOL_NAMES = new Set(['set_active_project', 'get_active_project', 'doctor_connection']);
const SCRIPT_EXECUTION_TOOLS = new Set(['execute_editor_script', 'execute_game_script']);
const SAFETY_VALUES = new Set<SafetyMode>(['strict', 'normal', 'permissive']);

const DESTRUCTIVE_TOOL_PREFIXES = [
  'clear_',
  'cleanup_',
  'delete_',
  'disconnect_',
  'reload_',
  'remove_',
  'stop_',
];

const DESTRUCTIVE_TOOL_NAMES = new Set([
  'deploy_to_android',
  'export_project',
]);

const READ_ONLY_PLUGIN_TOOL_NAMES = new Set([
  'analyze_scene_complexity',
  'analyze_signal_flow',
  'assert_node_state',
  'assert_screen_text',
  'batch_get_properties',
  'compare_screenshots',
  'detect_circular_dependencies',
  'find_node_references',
  'find_nodes_by_script',
  'find_nodes_by_type',
  'find_nodes_in_group',
  'find_nearby_nodes',
  'find_script_references',
  'find_signal_connections',
  'find_ui_elements',
  'find_unused_resources',
  'get_animation_info',
  'get_animation_tree_structure',
  'get_android_preset_info',
  'get_audio_bus_layout',
  'get_audio_info',
  'get_autoload',
  'get_collision_info',
  'get_editor_camera',
  'get_editor_errors',
  'get_editor_performance',
  'get_export_info',
  'get_filesystem_tree',
  'get_game_node_properties',
  'get_game_scene_tree',
  'get_input_actions',
  'get_mcp_plugin_status',
  'get_navigation_info',
  'get_node_groups',
  'get_node_properties',
  'get_output_log',
  'get_particle_info',
  'get_performance_monitors',
  'get_physics_layers',
  'get_project_info',
  'get_project_settings',
  'get_project_statistics',
  'get_resource_preview',
  'get_scene_dependencies',
  'get_scene_exports',
  'get_scene_file_content',
  'get_scene_tree',
  'get_shader_params',
  'get_signals',
  'get_test_report',
  'get_theme_info',
  'list_animations',
  'list_android_devices',
  'list_export_presets',
  'list_scripts',
  'monitor_properties',
  'project_path_to_uid',
  'read_resource',
  'read_script',
  'read_shader',
  'search_files',
  'search_in_files',
  'tilemap_get_cell',
  'tilemap_get_info',
  'tilemap_get_used_cells',
  'uid_to_project_path',
  'validate_script',
]);

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
  const safety = deps.safety ?? 'normal';
  let activeProject: string | undefined;

  return async (name: string, rawArgs: Record<string, unknown> = {}) => {
    const args = normalizeArgs(rawArgs);

    try {
      if (name === 'set_active_project') {
        activeProject = requireString(args, 'projectPath');
        return jsonResult({
          active_project: activeProject,
        });
      }

      if (name === 'get_active_project') {
        return jsonResult({
          active_project: activeProject ?? null,
        });
      }

      if (name === 'doctor_connection') {
        return jsonResult(await buildDoctorConnectionReport(deps, safety, activeProject, args));
      }

      if (name === 'list_tool_groups') {
        return jsonResult(buildToolGroups(args, deps.mode));
      }

      if (name === 'describe_tool') {
        return jsonResult(describeTool(args));
      }

      if (name === 'suggest_workflow') {
        return jsonResult(suggestWorkflow(args, deps.mode));
      }

      if (name === 'get_project_capabilities') {
        return jsonResult(await getProjectCapabilities(args, deps, safety, activeProject));
      }

      const safetyError = getSafetyError(name, args, safety, deps.allowScriptExec);
      if (safetyError) {
        return errorResult(safetyError);
      }

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

      if (activeProject && shouldVerifyActiveProject(name)) {
        await assertActiveProjectMatches(deps.bridge, activeProject, name);
      }

      const pluginResult = await deps.bridge.call(name, rawArgs);
      return jsonResult(pluginResult);
    } catch (error) {
      return errorResult(formatError(error));
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

  const safety = options.safety ?? readSafetyFromArgv(process.argv.slice(2));
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
    mode: options.mode,
    safety,
    allowScriptExec: options.allowScriptExec,
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(toMcpTool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    if (!enabledToolNames.has(toolName) && !SESSION_TOOL_NAMES.has(toolName)) {
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

async function buildDoctorConnectionReport(
  deps: ToolExecutorDeps,
  safety: SafetyMode,
  activeProject: string | undefined,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  let godot: Record<string, unknown>;
  try {
    godot = {
      available: true,
      version: await deps.getGodotVersion(),
    };
  } catch (error) {
    godot = {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const report: Record<string, unknown> = {
    bridge: {
      port: typeof deps.bridge.port === 'number' ? deps.bridge.port : null,
      connected_clients:
        typeof deps.bridge.connectedClientCount === 'number' ? deps.bridge.connectedClientCount : null,
    },
    godot,
    active_project: activeProject ?? null,
  };

  if (deps.mode) {
    report.mode = deps.mode;
  }

  report.safety = safety;
  report.tool_count = getToolsForMode(deps.mode).length;

  if (args.includePluginStatus === true) {
    try {
      report.plugin = {
        available: true,
        status: await deps.bridge.call('get_mcp_plugin_status', {}),
      };
    } catch (error) {
      report.plugin = {
        available: false,
        error: formatError(error),
      };
    }
  }

  return report;
}

function buildToolGroups(
  args: Record<string, unknown>,
  defaultMode: ToolMode | undefined,
): Record<string, unknown> {
  const mode = normalizeMode(typeof args.mode === 'string' ? args.mode : defaultMode);
  const includeTools = args.includeTools !== false;
  const tools = getToolsForMode(mode);
  const grouped = groupTools(tools);

  return {
    mode,
    total: tools.length,
    groups: Object.fromEntries(
      [...grouped.entries()].map(([category, categoryTools]) => [
        category,
        includeTools
          ? {
              count: categoryTools.length,
              tools: categoryTools.map((tool) => tool.name),
            }
          : {
              count: categoryTools.length,
            },
      ]),
    ),
  };
}

function describeTool(args: Record<string, unknown>): Record<string, unknown> {
  const toolName = requireString(args, 'toolName');
  const toolDefinition = ALL_TOOLS.find((tool) => tool.name === toolName);
  if (!toolDefinition) {
    throw new Error(`未知工具: ${toolName}`);
  }

  return {
    name: toolDefinition.name,
    category: toolDefinition.category,
    local: toolDefinition.local === true,
    description: toolDefinition.description,
    input_schema: toolDefinition.inputSchema,
    modes: modeNames().filter((mode) =>
      getToolsForMode(mode).some((tool) => tool.name === toolDefinition.name),
    ),
  };
}

function suggestWorkflow(
  args: Record<string, unknown>,
  defaultMode: ToolMode | undefined,
): Record<string, unknown> {
  const goal = requireString(args, 'goal');
  const mode = normalizeMode(typeof args.mode === 'string' ? args.mode : defaultMode);
  const normalizedGoal = goal.toLowerCase();
  const steps: Array<Record<string, unknown>> = [
    step('doctor_connection', '先确认 Godot 路径、端口、插件连接和安全模式。', {
      include_plugin_status: true,
    }),
  ];

  if (matchesAny(normalizedGoal, ['3d', 'mesh', 'camera', 'light', 'material', '材质', '相机', '灯光'])) {
    steps.push(
      step('create_scene', '创建 Node3D 根场景。'),
      step('add_mesh_instance', '加入可见网格对象。'),
      step('setup_lighting', '设置基础光照。'),
      step('setup_camera_3d', '设置可预览的 3D 相机。'),
      step('save_scene', '保存 3D 场景。'),
    );
  } else if (matchesAny(normalizedGoal, ['shader', 'particle', 'audio', 'theme', '特效', '粒子', '音频', '主题'])) {
    steps.push(
      step('open_scene', '打开目标场景。'),
      step('create_shader', '创建或更新视觉效果资源。'),
      step('create_particles', '需要粒子时创建粒子节点。'),
      step('add_audio_bus_effect', '需要音频效果时添加 bus effect。'),
      step('save_scene', '保存内容改动。'),
    );
  } else if (matchesAny(normalizedGoal, ['script', 'gdscript', '脚本', '代码'])) {
    steps.push(
      step('create_script', '创建脚本或补齐脚本模板。'),
      step('edit_script', '按需求编辑脚本内容。'),
      step('validate_script', '保存前做 GDScript 校验。'),
      step('attach_script', '把脚本挂到目标节点。'),
    );
  } else if (matchesAny(normalizedGoal, ['test', '测试', 'input', '运行', 'runtime'])) {
    steps.push(
      step('play_scene', '启动当前或主场景。'),
      step('get_game_scene_tree', '检查运行时节点树。'),
      step('simulate_action', '发送输入动作。'),
      step('assert_node_state', '断言关键节点状态。'),
      step('stop_scene', '结束运行场景。'),
    );
  } else if (matchesAny(normalizedGoal, ['cleanup', '清理', 'reset', '恢复'])) {
    steps.push(
      step('get_mcp_plugin_status', '查看插件状态和已知临时资源。'),
      step('cleanup_mcp_project_state', '清理 MCP 插件可识别的项目状态。'),
      step('doctor_connection', '清理后再次检查连接。'),
    );
  } else {
    steps.push(
      step('get_project_info', '读取项目基础信息。'),
      step('create_scene', '创建或准备目标场景。'),
      step('add_node', '添加必要节点。'),
      step('save_scene', '保存场景。'),
    );
  }

  return {
    goal,
    mode,
    project_state: typeof args.projectState === 'string' ? args.projectState : null,
    steps: steps.filter((item) => toolAvailableInMode(String(item.tool), mode)),
  };
}

async function getProjectCapabilities(
  args: Record<string, unknown>,
  deps: ToolExecutorDeps,
  safety: SafetyMode,
  activeProject: string | undefined,
): Promise<Record<string, unknown>> {
  const mode = normalizeMode(typeof args.mode === 'string' ? args.mode : deps.mode);
  const tools = getToolsForMode(mode);
  const projectPath = typeof args.projectPath === 'string' ? args.projectPath : activeProject;
  const categories = Object.fromEntries(
    [...groupTools(tools).entries()].map(([category, categoryTools]) => [
      category,
      categoryTools.length,
    ]),
  );
  const project: Record<string, unknown> | null = projectPath
    ? {
        path: projectPath,
        has_project_file: existsSync(`${projectPath}/project.godot`),
      }
    : null;

  if (project && projectPath && project.has_project_file === true) {
    try {
      project.name = await readProjectName(projectPath);
    } catch (error) {
      project.name_error = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    mode,
    safety,
    active_project: activeProject ?? null,
    project,
    tool_count: tools.length,
    categories,
    local_tools: tools.filter((tool) => tool.local).map((tool) => tool.name),
    plugin_tools: tools.filter((tool) => !tool.local).length,
  };
}

function groupTools(tools: GodotToolDefinition[]): Map<string, GodotToolDefinition[]> {
  const grouped = new Map<string, GodotToolDefinition[]>();
  for (const toolDefinition of tools) {
    const current = grouped.get(toolDefinition.category) ?? [];
    current.push(toolDefinition);
    grouped.set(toolDefinition.category, current);
  }
  return grouped;
}

function step(
  toolName: string,
  why: string,
  args?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    tool: toolName,
    why,
    ...(args ? { args } : {}),
  };
}

function matchesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function toolAvailableInMode(toolName: string, mode: ToolMode): boolean {
  return getToolsForMode(mode).some((toolDefinition) => toolDefinition.name === toolName);
}

function modeNames(): ToolMode[] {
  return ['minimal', 'lite', '3d', 'full'];
}

function getSafetyError(
  name: string,
  args: Record<string, unknown>,
  safety: SafetyMode,
  allowScriptExec: boolean | undefined,
): string | undefined {
  const confirm = args.confirm === true;
  const scriptTool = SCRIPT_EXECUTION_TOOLS.has(name);

  if (safety === 'strict' && (scriptTool || isDestructiveTool(name)) && !confirm) {
    return `Tool "${name}" requires confirm:true in strict safety mode.`;
  }

  if (!scriptTool || safety === 'permissive' || confirm) {
    return undefined;
  }

  if (safety === 'normal' && (allowScriptExec || args.allowScriptExec === true)) {
    return undefined;
  }

  return `Tool "${name}" executes arbitrary script code. Pass confirm:true for this call, pass allowScriptExec:true, or start with --safety permissive.`;
}

function shouldVerifyActiveProject(name: string): boolean {
  return !SESSION_TOOL_NAMES.has(name) && !isLocalTool(name) && !READ_ONLY_PLUGIN_TOOL_NAMES.has(name);
}

async function assertActiveProjectMatches(
  bridge: BridgeLike,
  activeProject: string,
  toolName: string,
): Promise<void> {
  const projectInfo = await bridge.call('get_project_info', {});
  const pluginProject = extractProjectPath(projectInfo);

  if (!pluginProject) {
    throw new Error(
      `Active project is set to "${activeProject}", but get_project_info did not return project_path. Refusing to run "${toolName}".`,
    );
  }

  if (normalizeProjectPath(pluginProject) !== normalizeProjectPath(activeProject)) {
    throw new Error(
      `Active project mismatch: active project is "${activeProject}", but Godot plugin reports "${pluginProject}". Refusing to run "${toolName}".`,
    );
  }
}

function extractProjectPath(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const projectInfo = value as Record<string, unknown>;
  const projectPath = projectInfo.project_path ?? projectInfo.projectPath ?? projectInfo.path;
  return typeof projectPath === 'string' && projectPath.length > 0 ? projectPath : undefined;
}

function normalizeProjectPath(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function isDestructiveTool(name: string): boolean {
  return (
    DESTRUCTIVE_TOOL_NAMES.has(name) ||
    DESTRUCTIVE_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

function readSafetyFromArgv(argv: string[]): SafetyMode {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--safety') {
      return normalizeSafety(argv[i + 1]);
    }
    if (arg.startsWith('--safety=')) {
      return normalizeSafety(arg.slice('--safety='.length));
    }
  }
  return 'normal';
}

function normalizeSafety(value: string | undefined): SafetyMode {
  return SAFETY_VALUES.has(value as SafetyMode) ? (value as SafetyMode) : 'normal';
}

function formatError(error: unknown): string {
  if (error instanceof JsonRpcBridgeError) {
    const details: Record<string, unknown> = {
      message: error.message,
      code: error.code,
    };
    if (error.data !== undefined) {
      details.data = error.data;
    }
    return JSON.stringify(details, null, 2);
  }

  return error instanceof Error ? error.message : String(error);
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
