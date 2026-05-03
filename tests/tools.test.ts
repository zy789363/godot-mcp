import { describe, expect, it } from 'vitest';

import { ALL_TOOLS, getToolsForMode, normalizeMode } from '../src/tools';

const TOOL_NAVIGATION_NAMES = [
  'set_active_project',
  'get_active_project',
  'doctor_connection',
  'list_tool_groups',
  'describe_tool',
  'suggest_workflow',
  'get_project_capabilities',
];

const HIGH_FREQUENCY_REQUIRED_FIELDS: Record<string, string[]> = {
  launch_editor: ['projectPath'],
  run_project: ['projectPath'],
  list_projects: ['directory'],
  get_project_info: [],
  create_scene: ['path'],
  open_scene: ['path'],
  save_scene: [],
  add_node: ['type'],
  update_property: ['node_path', 'property', 'value'],
  get_node_properties: ['node_path'],
  create_script: ['path'],
  edit_script: ['path'],
  read_script: ['path'],
  validate_script: ['path'],
  play_scene: [],
  get_game_node_properties: ['node_path'],
  set_game_node_property: ['node_path', 'property', 'value'],
  simulate_key: ['keycode'],
  simulate_mouse_click: [],
  simulate_action: ['action'],
  set_active_project: ['projectPath'],
  get_active_project: [],
  doctor_connection: [],
  get_mcp_plugin_status: [],
  cleanup_mcp_project_state: [],
};

function toolByName(name: string) {
  const match = ALL_TOOLS.find((tool) => tool.name === name);
  if (!match) {
    throw new Error(`Missing tool: ${name}`);
  }
  return match;
}

describe('tool mode filtering', () => {
  it('defaults unknown modes to lite', () => {
    expect(normalizeMode(undefined)).toBe('lite');
    expect(normalizeMode('surprise')).toBe('lite');
  });

  it('exposes exact tool counts per mode', () => {
    expect(getToolsForMode('minimal')).toHaveLength(39);
    expect(getToolsForMode('lite')).toHaveLength(95);
    expect(getToolsForMode('3d')).toHaveLength(120);
    expect(getToolsForMode('full')).toHaveLength(186);
  });

  it('lite mode exposes the core editor workflow but excludes content-specialist tools', () => {
    const names = getToolsForMode('lite').map((tool) => tool.name);

    expect(names).toContain('get_project_info');
    expect(names).toContain('create_scene');
    expect(names).toContain('add_node');
    expect(names).toContain('create_script');
    expect(names).toContain('simulate_key');
    expect(names).toContain('get_game_scene_tree');
    expect(names).toContain('get_input_actions');
    expect(names).toContain('doctor_connection');
    expect(names).toContain('get_mcp_plugin_status');
    expect(names).toContain('cleanup_mcp_project_state');
    expect(names).not.toContain('create_particles');
    expect(names).not.toContain('deploy_to_android');
  });

  it('exposes local tool navigation helpers in every mode', () => {
    for (const mode of ['minimal', 'lite', '3d', 'full']) {
      const names = getToolsForMode(mode).map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining(TOOL_NAVIGATION_NAMES));
    }

    for (const name of TOOL_NAVIGATION_NAMES) {
      expect(toolByName(name).local).toBe(true);
      expect(toolByName(name).inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
    }
  });

  it('defines precise schemas for high-frequency user tools', () => {
    for (const [name, required] of Object.entries(HIGH_FREQUENCY_REQUIRED_FIELDS)) {
      const inputSchema = toolByName(name).inputSchema;

      expect(inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
      expect(inputSchema?.required ?? []).toEqual(required);
    }
  });

  it('full mode exposes migrated pro plugin tools', () => {
    const names = getToolsForMode('full').map((tool) => tool.name);

    expect(names).toContain('create_particles');
    expect(names).toContain('set_material_3d');
    expect(names).toContain('get_audio_bus_layout');
    expect(names).toContain('run_test_scenario');
    expect(names).toContain('deploy_to_android');
    expect(names).toHaveLength(186);
  });
});
