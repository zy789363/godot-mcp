import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type ToolMode = 'minimal' | 'lite' | '3d' | 'full';

export type ToolCategory =
  | 'local'
  | 'project'
  | 'scene'
  | 'node'
  | 'script'
  | 'editor'
  | 'input'
  | 'runtime'
  | 'input_map'
  | 'animation'
  | 'animation_tree'
  | 'audio'
  | 'batch'
  | 'export'
  | 'navigation'
  | 'particle'
  | 'physics'
  | 'profiling'
  | 'resource'
  | 'scene_3d'
  | 'shader'
  | 'test'
  | 'theme'
  | 'tilemap'
  | 'analysis'
  | 'android';

export interface CliOptions {
  mode: ToolMode;
  port: number;
  godotPath?: string;
  installAddon?: string;
  help: boolean;
}

export interface GodotToolDefinition {
  name: string;
  category: ToolCategory;
  description: string;
  inputSchema?: Tool['inputSchema'];
  local?: boolean;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}
