import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { GodotToolDefinition, ToolCategory, ToolMode } from './types.js';

const MODE_VALUES = new Set<ToolMode>(['minimal', 'lite', '3d', 'full']);

const GENERIC_OBJECT_SCHEMA: Tool['inputSchema'] = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

const LOCAL_TOOLS: GodotToolDefinition[] = [
  tool('launch_editor', 'local', '启动指定 Godot 项目的编辑器。', true),
  tool('run_project', 'local', '运行指定 Godot 项目并采集调试输出。', true),
  tool('get_debug_output', 'local', '读取当前由 server 启动的 Godot 进程输出。', true),
  tool('stop_project', 'local', '停止当前由 server 启动的 Godot 进程。', true),
  tool('get_godot_version', 'local', '读取本机 Godot 可执行文件版本。', true),
  tool('list_projects', 'local', '在目录中查找 Godot project.godot 项目。', true),
];

const PLUGIN_TOOLS: GodotToolDefinition[] = [
  ...group('project', [
    'get_project_info',
    'get_filesystem_tree',
    'search_files',
    'search_in_files',
    'get_project_settings',
    'set_project_setting',
    'uid_to_project_path',
    'project_path_to_uid',
    'add_autoload',
    'remove_autoload',
  ]),
  ...group('scene', [
    'get_scene_tree',
    'get_scene_file_content',
    'create_scene',
    'open_scene',
    'delete_scene',
    'add_scene_instance',
    'play_scene',
    'stop_scene',
    'save_scene',
    'get_scene_exports',
  ]),
  ...group('node', [
    'add_node',
    'delete_node',
    'duplicate_node',
    'move_node',
    'update_property',
    'get_node_properties',
    'add_resource',
    'set_anchor_preset',
    'rename_node',
    'connect_signal',
    'disconnect_signal',
    'get_node_groups',
    'set_node_groups',
    'find_nodes_in_group',
  ]),
  ...group('script', [
    'list_scripts',
    'read_script',
    'create_script',
    'edit_script',
    'attach_script',
    'get_open_scripts',
    'validate_script',
  ]),
  ...group('editor', [
    'get_editor_errors',
    'get_output_log',
    'get_editor_screenshot',
    'get_game_screenshot',
    'execute_editor_script',
    'clear_output',
    'reload_plugin',
    'reload_project',
    'get_signals',
    'compare_screenshots',
    'set_auto_dismiss',
    'get_editor_camera',
    'set_editor_camera',
  ]),
  ...group('input', [
    'simulate_key',
    'simulate_mouse_click',
    'simulate_mouse_move',
    'simulate_action',
    'simulate_sequence',
  ]),
  ...group('runtime', [
    'get_game_scene_tree',
    'get_game_node_properties',
    'set_game_node_property',
    'capture_frames',
    'monitor_properties',
    'execute_game_script',
    'start_recording',
    'stop_recording',
    'replay_recording',
    'find_nodes_by_script',
    'get_autoload',
    'batch_get_properties',
    'find_ui_elements',
    'click_button_by_text',
    'wait_for_node',
    'find_nearby_nodes',
    'navigate_to',
    'move_to',
    'watch_signals',
  ]),
  ...group('input_map', ['get_input_actions', 'set_input_action']),
  ...group('animation', [
    'list_animations',
    'create_animation',
    'add_animation_track',
    'set_animation_keyframe',
    'get_animation_info',
    'remove_animation',
  ]),
  ...group('animation_tree', [
    'create_animation_tree',
    'get_animation_tree_structure',
    'add_state_machine_state',
    'remove_state_machine_state',
    'add_state_machine_transition',
    'remove_state_machine_transition',
    'set_blend_tree_node',
    'set_tree_parameter',
  ]),
  ...group('audio', [
    'get_audio_bus_layout',
    'add_audio_bus',
    'set_audio_bus',
    'add_audio_bus_effect',
    'add_audio_player',
    'get_audio_info',
  ]),
  ...group('batch', [
    'find_nodes_by_type',
    'find_signal_connections',
    'batch_set_property',
    'batch_add_nodes',
    'find_node_references',
    'get_scene_dependencies',
    'cross_scene_set_property',
  ]),
  ...group('export', ['list_export_presets', 'export_project', 'get_export_info']),
  ...group('navigation', [
    'setup_navigation_region',
    'bake_navigation_mesh',
    'setup_navigation_agent',
    'set_navigation_layers',
    'get_navigation_info',
  ]),
  ...group('particle', [
    'create_particles',
    'set_particle_material',
    'set_particle_color_gradient',
    'apply_particle_preset',
    'get_particle_info',
  ]),
  ...group('physics', [
    'setup_collision',
    'set_physics_layers',
    'get_physics_layers',
    'add_raycast',
    'setup_physics_body',
    'get_collision_info',
  ]),
  ...group('profiling', ['get_performance_monitors', 'get_editor_performance']),
  ...group('resource', [
    'read_resource',
    'edit_resource',
    'create_resource',
    'get_resource_preview',
  ]),
  ...group('scene_3d', [
    'add_mesh_instance',
    'setup_lighting',
    'set_material_3d',
    'setup_environment',
    'setup_camera_3d',
    'add_gridmap',
  ]),
  ...group('shader', [
    'create_shader',
    'read_shader',
    'edit_shader',
    'assign_shader_material',
    'set_shader_param',
    'get_shader_params',
  ]),
  ...group('test', [
    'run_test_scenario',
    'assert_node_state',
    'assert_screen_text',
    'run_stress_test',
    'get_test_report',
  ]),
  ...group('theme', [
    'create_theme',
    'set_theme_color',
    'set_theme_constant',
    'set_theme_font_size',
    'set_theme_stylebox',
    'setup_control',
    'get_theme_info',
  ]),
  ...group('tilemap', [
    'tilemap_set_cell',
    'tilemap_fill_rect',
    'tilemap_get_cell',
    'tilemap_clear',
    'tilemap_get_info',
    'tilemap_get_used_cells',
  ]),
  ...group('analysis', [
    'find_unused_resources',
    'analyze_signal_flow',
    'analyze_scene_complexity',
    'find_script_references',
    'detect_circular_dependencies',
    'get_project_statistics',
  ]),
  ...group('android', ['list_android_devices', 'get_android_preset_info', 'deploy_to_android']),
];

const LITE_CATEGORIES = new Set<ToolCategory>([
  'local',
  'project',
  'scene',
  'node',
  'script',
  'editor',
  'input',
  'runtime',
  'input_map',
]);

const MINIMAL_NAMES = new Set([
  'launch_editor',
  'run_project',
  'get_debug_output',
  'stop_project',
  'get_godot_version',
  'list_projects',
  'get_project_info',
  'get_filesystem_tree',
  'get_scene_tree',
  'create_scene',
  'open_scene',
  'save_scene',
  'play_scene',
  'stop_scene',
  'add_node',
  'delete_node',
  'update_property',
  'get_node_properties',
  'create_script',
  'edit_script',
  'read_script',
  'validate_script',
  'get_editor_errors',
  'get_output_log',
  'simulate_key',
  'simulate_action',
  'simulate_mouse_click',
  'get_game_scene_tree',
  'get_game_node_properties',
  'set_game_node_property',
  'get_input_actions',
  'set_input_action',
]);

const THREE_D_EXTRA_CATEGORIES = new Set<ToolCategory>([
  'physics',
  'animation_tree',
  'navigation',
  'scene_3d',
]);

export const ALL_TOOLS = dedupeTools([...LOCAL_TOOLS, ...PLUGIN_TOOLS]);

export function normalizeMode(mode: string | undefined): ToolMode {
  return MODE_VALUES.has(mode as ToolMode) ? (mode as ToolMode) : 'lite';
}

export function getToolsForMode(mode: string | undefined): GodotToolDefinition[] {
  const normalized = normalizeMode(mode);

  if (normalized === 'full') {
    return ALL_TOOLS;
  }

  if (normalized === 'minimal') {
    return ALL_TOOLS.filter((toolDefinition) => MINIMAL_NAMES.has(toolDefinition.name));
  }

  if (normalized === '3d') {
    return ALL_TOOLS.filter(
      (toolDefinition) =>
        LITE_CATEGORIES.has(toolDefinition.category) ||
        THREE_D_EXTRA_CATEGORIES.has(toolDefinition.category),
    );
  }

  return ALL_TOOLS.filter((toolDefinition) => LITE_CATEGORIES.has(toolDefinition.category));
}

export function toMcpTool(toolDefinition: GodotToolDefinition): Tool {
  return {
    name: toolDefinition.name,
    description: toolDefinition.description,
    inputSchema: toolDefinition.inputSchema ?? GENERIC_OBJECT_SCHEMA,
  };
}

export function isLocalTool(name: string): boolean {
  return ALL_TOOLS.some((toolDefinition) => toolDefinition.name === name && toolDefinition.local);
}

function tool(
  name: string,
  category: ToolCategory,
  description: string,
  local = false,
): GodotToolDefinition {
  return {
    name,
    category,
    description,
    inputSchema: GENERIC_OBJECT_SCHEMA,
    local,
  };
}

function group(category: ToolCategory, names: string[]): GodotToolDefinition[] {
  return names.map((name) =>
    tool(name, category, `通过 Godot 编辑器插件执行 ${name}。`),
  );
}

function dedupeTools(tools: GodotToolDefinition[]): GodotToolDefinition[] {
  const seen = new Map<string, GodotToolDefinition>();
  for (const toolDefinition of tools) {
    seen.set(toolDefinition.name, toolDefinition);
  }
  return [...seen.values()];
}
