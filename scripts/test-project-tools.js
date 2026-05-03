#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { evaluateToolCallOk } from './project-test-result.js';

const DEFAULT_PROJECT = '/Users/chenhuan/Desktop/AIGame/p01';
const DEFAULT_GODOT = '/Applications/Godot_mono.app/Contents/MacOS/Godot';
const DEFAULT_SERVER_PORT = 6506;

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(helpText());
  process.exit(0);
}

const projectPath = path.resolve(
  options.project ?? process.env.MCP_TEST_PROJECT ?? process.env.P01_PROJECT ?? DEFAULT_PROJECT,
);
const godotPath = options.godot ?? process.env.GODOT_PATH ?? DEFAULT_GODOT;
const SERVER_PORT = parsePort(options.port ?? process.env.MCP_TEST_PORT);
const runId = options.runId ?? process.env.MCP_TEST_RUN_ID ?? `run_${Date.now()}`;
const TEST_BASE = `res://mcp_mypro_test/${runId}`;
const reportDir = path.resolve(
  options.reportDir ?? process.env.MCP_TEST_REPORT_DIR ?? path.join(projectPath, 'docs', 'mcp-mypro', 'reports'),
);
const reportPath = path.resolve(
  options.reportPath ??
    process.env.MCP_TEST_REPORT_PATH ??
    path.join(reportDir, `${sanitizeReportName(path.basename(projectPath) || 'project')}_full_tool_report.json`),
);
const serverEntry = path.resolve('build/index.js');
const destructiveToolsPolicy =
  'Safety mode: deletion-capable tools are only called with missing/invalid parameters unless explicitly covered by non-deleting operations.';

const results = [];
const called = new Set();
let sequence = 0;

function parseArgs(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--project') {
      parsed.project = requireValue(arg, next);
      i += 1;
    } else if (arg === '--godot') {
      parsed.godot = requireValue(arg, next);
      i += 1;
    } else if (arg === '--port') {
      parsed.port = requireValue(arg, next);
      i += 1;
    } else if (arg === '--run-id') {
      parsed.runId = requireValue(arg, next);
      i += 1;
    } else if (arg === '--report-dir') {
      parsed.reportDir = requireValue(arg, next);
      i += 1;
    } else if (arg === '--report') {
      parsed.reportPath = requireValue(arg, next);
      i += 1;
    } else if (arg.startsWith('--project=')) {
      parsed.project = arg.slice('--project='.length);
    } else if (arg.startsWith('--godot=')) {
      parsed.godot = arg.slice('--godot='.length);
    } else if (arg.startsWith('--port=')) {
      parsed.port = arg.slice('--port='.length);
    } else if (arg.startsWith('--run-id=')) {
      parsed.runId = arg.slice('--run-id='.length);
    } else if (arg.startsWith('--report-dir=')) {
      parsed.reportDir = arg.slice('--report-dir='.length);
    } else if (arg.startsWith('--report=')) {
      parsed.reportPath = arg.slice('--report='.length);
    } else if (!arg.startsWith('-') && !parsed.project) {
      parsed.project = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function requireValue(option, value) {
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function helpText() {
  return [
    'Run the full Godot MCP tool coverage suite against a target project.',
    '',
    'Usage:',
    '  node scripts/test-project-tools.js /path/to/godot-project',
    '  node scripts/test-project-tools.js --project /path/to/godot-project',
    '',
    'Options:',
    '  --project      Godot project path. Defaults to MCP_TEST_PROJECT, P01_PROJECT, then the local p01 baseline.',
    '  --godot        Godot executable path. Defaults to GODOT_PATH, then the local Mono baseline.',
    '  --port         WebSocket port for the test server. Defaults to MCP_TEST_PORT or 6506.',
    '  --run-id       Stable test run id. Defaults to MCP_TEST_RUN_ID or run_<timestamp>.',
    '  --report-dir   Directory for the JSON report. Defaults to <project>/docs/mcp-mypro/reports.',
    '  --report       Exact JSON report path. Overrides --report-dir.',
  ].join('\n');
}

function parsePort(value) {
  const parsed = Number(value ?? DEFAULT_SERVER_PORT);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid MCP test port: ${value}`);
  }
  return parsed;
}

function sanitizeReportName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'project';
}

function validateConfig() {
  if (!existsSync(serverEntry)) {
    throw new Error(`Built server entry not found: ${serverEntry}. Run npm run build first.`);
  }
  if (!existsSync(projectPath)) {
    throw new Error(`Godot project path does not exist: ${projectPath}`);
  }
  if (!existsSync(path.join(projectPath, 'project.godot'))) {
    throw new Error(`Not a Godot project: ${projectPath} is missing project.godot`);
  }
}

function parseContent(response) {
  const text = (response.content ?? [])
    .map((item) => (item.type === 'text' ? item.text : JSON.stringify(item)))
    .join('\n');
  try {
    return { text, parsed: JSON.parse(text) };
  } catch {
    return { text, parsed: undefined };
  }
}

function resultPayload(callResult) {
  return callResult.parsed?.result ?? callResult.parsed;
}

function compact(value) {
  const json = JSON.stringify(value ?? {});
  return json.length > 600 ? `${json.slice(0, 600)}...` : json;
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function callTool(client, name, args = {}, options = {}) {
  called.add(name);
  const started = Date.now();
  const record = {
    index: ++sequence,
    name,
    phase: options.phase ?? 'coverage',
    expectation: options.expectError ? 'expected_error' : 'success',
    args: compact(args),
  };

  try {
    const response = await withTimeout(
      client.callTool({ name, arguments: args }),
      options.timeoutMs ?? 35000,
      name,
    );
    const { text, parsed } = parseContent(response);
    const isError = response.isError === true;
    const ok = evaluateToolCallOk({ isError, text }, options);
    record.status = ok ? 'pass' : 'fail';
    record.isError = isError;
    record.durationMs = Date.now() - started;
    record.summary = compact(parsed ?? text);
    results.push(record);
    return { ok, isError, text, parsed };
  } catch (error) {
    record.status = 'fail';
    record.isError = true;
    record.durationMs = Date.now() - started;
    record.summary = error instanceof Error ? error.message : String(error);
    results.push(record);
    return { ok: false, isError: true, text: record.summary, parsed: undefined };
  }
}

async function waitForPlugin(client) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const probe = await callTool(client, 'get_project_info', {}, {
      phase: 'connect',
      allowInfrastructureError: true,
      timeoutMs: 10000,
    });
    if (!probe.isError) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Godot plugin did not connect to port ${SERVER_PORT}.`);
}

async function runCuratedCases(client) {
  const projectName = '新建游戏项目';
  const testScript = `${TEST_BASE}/test_actor.gd`;
  const scene2d = `${TEST_BASE}/mcp_2d_test.tscn`;
  const childScene = `${TEST_BASE}/mcp_child_instance.tscn`;
  const scene3d = `${TEST_BASE}/mcp_3d_test.tscn`;
  const shaderPath = `${TEST_BASE}/mcp_test_shader.gdshader`;
  const themePath = `${TEST_BASE}/mcp_test_theme.tres`;
  const materialPath = `${TEST_BASE}/mcp_test_material.tres`;
  const gradientPath = `${TEST_BASE}/mcp_test_gradient.tres`;
  const editorShot = `${TEST_BASE}/editor_screenshot.png`;
  const gameShot = `${TEST_BASE}/game_screenshot.png`;
  const busName = `MCPBus_${Date.now()}`;

  await callTool(client, 'get_godot_version', {}, { phase: 'local' });
  await callTool(client, 'list_projects', { directory: path.dirname(projectPath), recursive: false }, { phase: 'local' });
  await callTool(client, 'get_debug_output', {}, { phase: 'local' });
  await callTool(client, 'stop_project', {}, { phase: 'local' });
  await callTool(client, 'set_active_project', { projectPath }, { phase: 'local' });
  await callTool(client, 'get_active_project', {}, { phase: 'local' });
  await callTool(client, 'doctor_connection', { include_plugin_status: true }, { phase: 'local' });
  await callTool(client, 'list_tool_groups', { mode: 'full', include_tools: false }, { phase: 'local' });
  await callTool(client, 'describe_tool', { tool_name: 'create_scene' }, { phase: 'local' });
  await callTool(client, 'suggest_workflow', { goal: 'create and validate a Godot test scene', mode: 'full' }, { phase: 'local' });
  await callTool(client, 'get_project_capabilities', { mode: 'full', project_path: projectPath }, { phase: 'local' });
  await callTool(client, 'get_mcp_plugin_status', {}, { phase: 'editor' });

  await callTool(client, 'get_filesystem_tree', { path: 'res://', max_depth: 1 }, { phase: 'project' });
  await callTool(client, 'search_files', { query: 'project', path: 'res://', max_results: 5 }, { phase: 'project' });
  await callTool(client, 'search_in_files', { query: 'Godot', path: 'res://docs', max_results: 5 }, { phase: 'project' });
  await callTool(client, 'get_project_settings', { key: 'application/config/name' }, { phase: 'project' });
  await callTool(client, 'set_project_setting', { key: 'application/config/name', value: projectName }, { phase: 'project' });
  const uid = await callTool(client, 'project_path_to_uid', { path: 'res://icon.svg' }, { phase: 'project' });
  const uidValue = resultPayload(uid)?.uid;
  if (uidValue) {
    await callTool(client, 'uid_to_project_path', { uid: uidValue }, { phase: 'project' });
  } else {
    await callTool(client, 'uid_to_project_path', { uid: 'uid://missing' }, { phase: 'project', expectError: true });
  }

  await callTool(client, 'create_scene', { path: childScene, root_type: 'Node2D', root_name: 'MCPChildInstance' }, { phase: 'scene' });
  await callTool(client, 'create_scene', { path: scene2d, root_type: 'Node2D', root_name: 'MCP2DTest' }, { phase: 'scene' });
  await callTool(client, 'open_scene', { path: scene2d }, { phase: 'scene' });
  await callTool(client, 'get_scene_tree', { max_depth: 2 }, { phase: 'scene' });
  await callTool(client, 'get_scene_file_content', { path: scene2d }, { phase: 'scene' });
  await callTool(client, 'add_scene_instance', { scene_path: childScene, parent_path: '.', name: 'ChildInstance' }, { phase: 'scene' });

  const scriptContent = `extends CharacterBody2D

var clicked := false

func _ready() -> void:
\tpass

func _on_test_button_pressed() -> void:
\tclicked = true
`;
  await callTool(client, 'create_script', { path: testScript, content: scriptContent }, { phase: 'script' });
  await callTool(client, 'list_scripts', { path: TEST_BASE, recursive: true }, { phase: 'script' });
  await callTool(client, 'read_script', { path: testScript }, { phase: 'script' });
  await callTool(client, 'edit_script', {
    path: testScript,
    replacements: [{ search: 'clicked = true', replace: 'clicked = true\n\tprint("mcp button clicked")' }],
  }, { phase: 'script' });
  await callTool(client, 'validate_script', { path: testScript }, { phase: 'script' });

  await callTool(client, 'add_node', { type: 'CharacterBody2D', name: 'Player', parent_path: '.' }, { phase: 'node' });
  await callTool(client, 'attach_script', { node_path: 'Player', script_path: testScript }, { phase: 'script' });
  await callTool(client, 'add_node', {
    type: 'Label',
    name: 'TestLabel',
    parent_path: '.',
    properties: { text: 'MCP Test Label', position: 'Vector2(64, 64)' },
  }, { phase: 'node' });
  await callTool(client, 'add_node', {
    type: 'Button',
    name: 'TestButton',
    parent_path: '.',
    properties: { text: 'MCP Test Button', position: 'Vector2(64, 120)' },
  }, { phase: 'node' });
  await callTool(client, 'add_node', { type: 'Node2D', name: 'GroupSource', parent_path: '.' }, { phase: 'node' });
  await callTool(client, 'add_node', { type: 'AnimationPlayer', name: 'AnimPlayer', parent_path: '.' }, { phase: 'node' });
  await callTool(client, 'add_node', { type: 'TileMapLayer', name: 'TestTileMap', parent_path: '.' }, { phase: 'node' });
  await callTool(client, 'add_node', { type: 'CollisionShape2D', name: 'ManualCollision', parent_path: 'Player' }, { phase: 'node' });
  await callTool(client, 'add_resource', {
    node_path: 'Player/ManualCollision',
    property: 'shape',
    resource_type: 'RectangleShape2D',
    resource_properties: { size: 'Vector2(24, 24)' },
  }, { phase: 'node' });
  await callTool(client, 'duplicate_node', { node_path: 'GroupSource', name: 'DuplicateNode' }, { phase: 'node' });
  await callTool(client, 'move_node', { node_path: 'DuplicateNode', new_parent_path: 'Player' }, { phase: 'node' });
  await callTool(client, 'update_property', { node_path: 'TestLabel', property: 'text', value: 'MCP Runtime OK' }, { phase: 'node' });
  await callTool(client, 'get_node_properties', { node_path: 'TestLabel', category: 'text' }, { phase: 'node' });
  await callTool(client, 'set_anchor_preset', { node_path: 'TestLabel', preset: 'center', keep_offsets: true }, { phase: 'node' });
  await callTool(client, 'rename_node', { node_path: 'GroupSource', new_name: 'GroupSourceRenamed' }, { phase: 'node' });
  await callTool(client, 'set_node_groups', { node_path: 'GroupSourceRenamed', groups: ['mcp_mypro_group'] }, { phase: 'node' });
  await callTool(client, 'get_node_groups', { node_path: 'GroupSourceRenamed' }, { phase: 'node' });
  await callTool(client, 'find_nodes_in_group', { group: 'mcp_mypro_group' }, { phase: 'node' });
  await callTool(client, 'connect_signal', {
    source_path: 'TestButton',
    signal_name: 'pressed',
    target_path: 'Player',
    method_name: '_on_test_button_pressed',
  }, { phase: 'node' });
  await callTool(client, 'get_signals', { node_path: 'TestButton' }, { phase: 'editor' });

  await callTool(client, 'create_theme', { path: themePath, default_font_size: 18 }, { phase: 'theme' });
  await callTool(client, 'set_theme_color', { node_path: 'TestLabel', name: 'font_color', color: '#66ccff' }, { phase: 'theme' });
  await callTool(client, 'set_theme_constant', { node_path: 'TestLabel', name: 'outline_size', value: 1 }, { phase: 'theme' });
  await callTool(client, 'set_theme_font_size', { node_path: 'TestLabel', name: 'font_size', size: 20 }, { phase: 'theme' });
  await callTool(client, 'set_theme_stylebox', { node_path: 'TestButton', name: 'normal', bg_color: '#223344', border_color: '#88ccff', border_width: 1, corner_radius: 4, padding: 4 }, { phase: 'theme' });
  await callTool(client, 'setup_control', { node_path: 'TestButton', anchor_preset: 'center', min_size: 'Vector2(180, 42)' }, { phase: 'theme' });
  await callTool(client, 'get_theme_info', { node_path: 'TestLabel' }, { phase: 'theme' });

  await callTool(client, 'create_particles', { parent_path: '.', name: 'MCPParticles2D', amount: 8, lifetime: 0.5 }, { phase: 'particle' });
  await callTool(client, 'set_particle_material', { node_path: 'MCPParticles2D', spread: 45, color: '#ffcc33', initial_velocity_min: 20, initial_velocity_max: 40 }, { phase: 'particle' });
  await callTool(client, 'set_particle_color_gradient', { node_path: 'MCPParticles2D', stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#ff660000' }] }, { phase: 'particle' });
  await callTool(client, 'apply_particle_preset', { node_path: 'MCPParticles2D', preset: 'sparks' }, { phase: 'particle' });
  await callTool(client, 'get_particle_info', { node_path: 'MCPParticles2D' }, { phase: 'particle' });

  await callTool(client, 'create_animation', { node_path: 'AnimPlayer', name: 'pulse', length: 1, loop_mode: 1 }, { phase: 'animation' });
  await callTool(client, 'add_animation_track', { node_path: 'AnimPlayer', animation: 'pulse', track_path: 'TestLabel:text', track_type: 'value' }, { phase: 'animation' });
  await callTool(client, 'set_animation_keyframe', { node_path: 'AnimPlayer', animation: 'pulse', track_index: 0, time: 0, value: 'MCP Runtime OK' }, { phase: 'animation' });
  await callTool(client, 'list_animations', { node_path: 'AnimPlayer' }, { phase: 'animation' });
  await callTool(client, 'get_animation_info', { node_path: 'AnimPlayer', animation: 'pulse' }, { phase: 'animation' });

  await callTool(client, 'setup_collision', { node_path: 'Player', shape: 'rectangle', width: 24, height: 24 }, { phase: 'physics' });
  await callTool(client, 'setup_physics_body', { node_path: 'Player', max_slides: 4, floor_snap_length: 4 }, { phase: 'physics' });
  await callTool(client, 'set_physics_layers', { node_path: 'Player', collision_layer: [1, 2], collision_mask: [1] }, { phase: 'physics' });
  await callTool(client, 'get_physics_layers', { node_path: 'Player' }, { phase: 'physics' });
  await callTool(client, 'add_raycast', { node_path: 'Player', name: 'GroundRay', target_y: 32 }, { phase: 'physics' });
  await callTool(client, 'get_collision_info', { node_path: 'Player' }, { phase: 'physics' });

  await callTool(client, 'tilemap_get_info', { node_path: 'TestTileMap' }, { phase: 'tilemap' });
  await callTool(client, 'tilemap_set_cell', { node_path: 'TestTileMap', x: 0, y: 0, source_id: -1 }, { phase: 'tilemap' });
  await callTool(client, 'tilemap_fill_rect', { node_path: 'TestTileMap', x1: 0, y1: 0, x2: 1, y2: 1, source_id: -1 }, { phase: 'tilemap' });
  await callTool(client, 'tilemap_get_cell', { node_path: 'TestTileMap', x: 0, y: 0 }, { phase: 'tilemap' });
  await callTool(client, 'tilemap_get_used_cells', { node_path: 'TestTileMap', max_count: 10 }, { phase: 'tilemap' });

  await callTool(client, 'set_input_action', { action: 'mcp_mypro_test_action', events: [{ type: 'key', keycode: 'M' }], deadzone: 0.5 }, { phase: 'input_map' });
  await callTool(client, 'get_input_actions', { filter: 'mcp_mypro', include_builtin: false }, { phase: 'input_map' });

  await callTool(client, 'save_scene', { path: scene2d }, { phase: 'scene' });
  await callTool(client, 'get_scene_exports', { path: scene2d }, { phase: 'scene' });
  await callTool(client, 'get_scene_dependencies', { path: scene2d }, { phase: 'batch' });
  await callTool(client, 'find_nodes_by_type', { type: 'Label' }, { phase: 'batch' });
  await callTool(client, 'find_signal_connections', { signal_name: 'pressed' }, { phase: 'batch' });
  await callTool(client, 'batch_set_property', { type: 'Label', property: 'text', value: 'MCP Runtime OK' }, { phase: 'batch' });
  await callTool(client, 'batch_add_nodes', { nodes: [{ type: 'Node2D', name: 'BatchNode', parent_path: '.' }] }, { phase: 'batch' });
  await callTool(client, 'find_node_references', { pattern: 'MCP2DTest' }, { phase: 'batch' });
  await callTool(client, 'cross_scene_set_property', { type: 'Label', property: 'text', value: 'MCP Runtime OK', path_filter: TEST_BASE }, { phase: 'batch' });

  await callTool(client, 'create_resource', { path: materialPath, type: 'StandardMaterial3D', overwrite: true, properties: { albedo_color: '#4466cc' } }, { phase: 'resource' });
  await callTool(client, 'read_resource', { path: materialPath }, { phase: 'resource' });
  await callTool(client, 'edit_resource', { path: materialPath, properties: { albedo_color: '#cc6644' } }, { phase: 'resource' });
  await callTool(client, 'create_resource', { path: gradientPath, type: 'Gradient', overwrite: true }, { phase: 'resource' });
  await callTool(client, 'get_resource_preview', { path: 'res://icon.svg', max_size: 64 }, { phase: 'resource' });

  await callTool(client, 'get_editor_errors', { max_lines: 20 }, { phase: 'editor' });
  await callTool(client, 'get_output_log', { max_lines: 20 }, { phase: 'editor' });
  await callTool(client, 'get_open_scripts', {}, { phase: 'editor' });
  await callTool(client, 'get_performance_monitors', {}, { phase: 'profiling' });
  await callTool(client, 'get_editor_performance', {}, { phase: 'profiling' });
  await callTool(client, 'get_editor_screenshot', { save_path: editorShot }, { phase: 'editor' });
  await callTool(client, 'compare_screenshots', { image_a: editorShot, image_b: editorShot, threshold: 0 }, { phase: 'editor' });
  await callTool(client, 'execute_editor_script', { code: '_mcp_print("editor script ok")', confirm: true }, { phase: 'editor' });
  await callTool(client, 'clear_output', {}, { phase: 'editor' });
  await callTool(client, 'set_auto_dismiss', { enabled: false }, { phase: 'editor' });
  await callTool(client, 'reload_project', {}, { phase: 'editor' });

  await callTool(client, 'play_scene', { mode: 'current' }, { phase: 'runtime', timeoutMs: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await callTool(client, 'get_game_scene_tree', { max_depth: 3 }, { phase: 'runtime' });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await callTool(client, 'wait_for_node', { node_path: '/root/MCP2DTest/TestLabel', timeout: 6, poll_frames: 2 }, { phase: 'runtime', timeoutMs: 12000 });
  await callTool(client, 'get_game_node_properties', { node_path: '/root/MCP2DTest/TestLabel', properties: ['text'] }, { phase: 'runtime' });
  await callTool(client, 'set_game_node_property', { node_path: '/root/MCP2DTest/TestLabel', property: 'text', value: 'Runtime Changed' }, { phase: 'runtime' });
  await callTool(client, 'batch_get_properties', { nodes: [{ path: '/root/MCP2DTest/TestLabel', properties: ['text'] }] }, { phase: 'runtime' });
  await callTool(client, 'find_ui_elements', { type_filter: 'Label' }, { phase: 'runtime' });
  await callTool(client, 'assert_node_state', { node_path: '/root/MCP2DTest/TestLabel', property: 'text', expected: 'Runtime Changed', operator: 'eq' }, { phase: 'test' });
  await callTool(client, 'assert_screen_text', { text: 'Runtime Changed', partial: true, case_sensitive: true }, { phase: 'test' });
  await callTool(client, 'execute_game_script', { code: '_mcp_print("runtime script ok")', confirm: true }, { phase: 'runtime' });
  await callTool(client, 'find_nodes_by_script', { script: 'test_actor.gd', properties: ['clicked'] }, { phase: 'runtime' });
  await callTool(client, 'get_autoload', { name: 'MCPGameInspector', properties: ['name'] }, { phase: 'runtime' });
  await callTool(client, 'find_nearby_nodes', { position: { x: 0, y: 0, z: 0 }, radius: 500, max_results: 5 }, { phase: 'runtime' });
  await callTool(client, 'capture_frames', { count: 1, frame_interval: 1, half_resolution: true }, { phase: 'runtime', timeoutMs: 10000 });
  await callTool(client, 'monitor_properties', { node_path: '/root/MCP2DTest/TestLabel', properties: ['text'], frame_count: 2, frame_interval: 1 }, { phase: 'runtime', timeoutMs: 10000 });
  await callTool(client, 'start_recording', {}, { phase: 'runtime' });
  await callTool(client, 'simulate_action', { action: 'mcp_mypro_test_action', pressed: true, strength: 1 }, { phase: 'input' });
  await callTool(client, 'simulate_key', { keycode: 'M', pressed: true }, { phase: 'input' });
  await callTool(client, 'simulate_mouse_move', { x: 80, y: 80 }, { phase: 'input' });
  await callTool(client, 'simulate_mouse_click', { x: 80, y: 80, button: 1, auto_release: true }, { phase: 'input' });
  await callTool(client, 'simulate_sequence', { events: [{ type: 'action', action: 'mcp_mypro_test_action', pressed: true }, { type: 'action', action: 'mcp_mypro_test_action', pressed: false }], frame_delay: 1 }, { phase: 'input' });
  const recording = await callTool(client, 'stop_recording', {}, { phase: 'runtime', timeoutMs: 10000 });
  const recordedEvents = resultPayload(recording)?.events ?? [];
  await callTool(client, 'replay_recording', { events: recordedEvents.slice(0, 5), speed: 2 }, { phase: 'runtime', timeoutMs: 10000 });
  await callTool(client, 'click_button_by_text', { text: 'MCP Test Button', partial: true }, { phase: 'runtime' });
  await callTool(client, 'watch_signals', { node_paths: ['/root/MCP2DTest/TestButton'], signal_filter: ['pressed'], duration_ms: 200 }, { phase: 'runtime', timeoutMs: 10000 });
  await callTool(client, 'run_test_scenario', { steps: [{ type: 'wait', seconds: 0.1 }, { type: 'assert', node_path: '/root/MCP2DTest/TestLabel', property: 'text', expected: 'Runtime Changed', operator: 'eq' }] }, { phase: 'test', timeoutMs: 10000 });
  await callTool(client, 'run_stress_test', { duration: 0.2, actions: ['mcp_mypro_test_action'] }, { phase: 'test', timeoutMs: 10000 });
  await callTool(client, 'get_test_report', { clear: false }, { phase: 'test' });
  await callTool(client, 'get_game_screenshot', { save_path: gameShot }, { phase: 'editor', timeoutMs: 10000 });
  await callTool(client, 'stop_scene', {}, { phase: 'runtime' });

  await callTool(client, 'create_scene', { path: scene3d, root_type: 'Node3D', root_name: 'MCP3DTest' }, { phase: 'scene_3d' });
  await callTool(client, 'open_scene', { path: scene3d }, { phase: 'scene_3d' });
  await callTool(client, 'add_mesh_instance', { parent_path: '.', name: 'Cube', mesh_type: 'BoxMesh', position: { x: 0, y: 0, z: 0 } }, { phase: 'scene_3d' });
  await callTool(client, 'setup_lighting', { parent_path: '.', preset: 'sun', name: 'Sun' }, { phase: 'scene_3d' });
  await callTool(client, 'setup_environment', { parent_path: '.', name: 'WorldEnv', background_mode: 'color', background_color: '#334455' }, { phase: 'scene_3d' });
  await callTool(client, 'setup_camera_3d', { parent_path: '.', name: 'Camera3D', current: true, position: { x: 0, y: 2, z: 5 }, look_at: { x: 0, y: 0, z: 0 } }, { phase: 'scene_3d' });
  await callTool(client, 'set_material_3d', { node_path: 'Cube', albedo_color: '#55aaee', metallic: 0.1, roughness: 0.7 }, { phase: 'scene_3d' });
  await callTool(client, 'add_gridmap', { parent_path: '.', name: 'GridMap', cell_size: { x: 2, y: 2, z: 2 } }, { phase: 'scene_3d' });
  await callTool(client, 'get_editor_camera', {}, { phase: 'editor' });
  await callTool(client, 'set_editor_camera', { position: { x: 2, y: 2, z: 4 }, look_at: { x: 0, y: 0, z: 0 }, fov: 70 }, { phase: 'editor' });

  await callTool(client, 'create_shader', {
    path: shaderPath,
    shader_type: 'spatial',
    content: 'shader_type spatial;\nuniform vec4 tint : source_color = vec4(1.0, 0.2, 0.2, 1.0);\nvoid fragment() { ALBEDO = tint.rgb; }\n',
  }, { phase: 'shader' });
  await callTool(client, 'read_shader', { path: shaderPath }, { phase: 'shader' });
  await callTool(client, 'edit_shader', { path: shaderPath, replacements: [{ search: 'tint.rgb', replace: 'vec3(tint.r, tint.g, tint.b)' }] }, { phase: 'shader' });
  await callTool(client, 'assign_shader_material', { node_path: 'Cube', shader_path: shaderPath }, { phase: 'shader' });
  await callTool(client, 'set_shader_param', { node_path: 'Cube', param: 'tint', value: 'Color(0.2, 1.0, 0.4, 1.0)' }, { phase: 'shader' });
  await callTool(client, 'get_shader_params', { node_path: 'Cube' }, { phase: 'shader' });

  await callTool(client, 'add_node', { type: 'RigidBody3D', name: 'PhysicsBody3D', parent_path: '.' }, { phase: 'physics' });
  await callTool(client, 'setup_collision', { node_path: 'PhysicsBody3D', shape: 'box', width: 1, height: 1, depth: 1 }, { phase: 'physics' });
  await callTool(client, 'setup_physics_body', { node_path: 'PhysicsBody3D', mass: 2, gravity_scale: 1 }, { phase: 'physics' });
  await callTool(client, 'add_raycast', { node_path: 'PhysicsBody3D', dimension: '3d', name: 'ForwardRay', target_z: -2 }, { phase: 'physics' });
  await callTool(client, 'setup_navigation_region', { node_path: '.', mode: '3d', name: 'NavigationRegion3D' }, { phase: 'navigation' });
  await callTool(client, 'bake_navigation_mesh', { node_path: 'NavigationRegion3D' }, { phase: 'navigation' });
  await callTool(client, 'setup_navigation_agent', { node_path: '.', mode: '3d', name: 'NavigationAgent3D', radius: 0.5, max_speed: 3 }, { phase: 'navigation' });
  await callTool(client, 'set_navigation_layers', { node_path: 'NavigationAgent3D', layer_bits: [1] }, { phase: 'navigation' });
  await callTool(client, 'get_navigation_info', { node_path: '.' }, { phase: 'navigation' });

  await callTool(client, 'create_particles', { parent_path: '.', name: 'MCPParticles3D', is_3d: true, amount: 8 }, { phase: 'particle' });
  await callTool(client, 'set_particle_material', { node_path: 'MCPParticles3D', spread: 30, color: '#88ccff' }, { phase: 'particle' });
  await callTool(client, 'get_particle_info', { node_path: 'MCPParticles3D' }, { phase: 'particle' });

  await callTool(client, 'add_node', { type: 'AnimationPlayer', name: 'AnimPlayer3D', parent_path: '.' }, { phase: 'animation_tree' });
  await callTool(client, 'create_animation_tree', { node_path: '.', name: 'AnimTree', anim_player: 'AnimPlayer3D' }, { phase: 'animation_tree' });
  await callTool(client, 'add_state_machine_state', { node_path: 'AnimTree', state_name: 'Idle', state_type: 'animation', position_x: 0, position_y: 0 }, { phase: 'animation_tree' });
  await callTool(client, 'add_state_machine_state', { node_path: 'AnimTree', state_name: 'Blend', state_type: 'blend_tree', position_x: 160, position_y: 0 }, { phase: 'animation_tree' });
  await callTool(client, 'add_state_machine_transition', { node_path: 'AnimTree', from_state: 'Idle', to_state: 'Blend', switch_mode: 'immediate', advance_mode: 'enabled' }, { phase: 'animation_tree' });
  await callTool(client, 'set_blend_tree_node', { node_path: 'AnimTree', blend_tree_state: 'Blend', bt_node_name: 'IdleAnim', bt_node_type: 'Animation', position_x: 0, position_y: 0 }, { phase: 'animation_tree' });
  await callTool(client, 'set_tree_parameter', { node_path: 'AnimTree', parameter: 'conditions/mcp_test', value: true }, { phase: 'animation_tree' });
  await callTool(client, 'get_animation_tree_structure', { node_path: 'AnimTree' }, { phase: 'animation_tree' });

  await callTool(client, 'get_audio_bus_layout', {}, { phase: 'audio' });
  await callTool(client, 'add_audio_bus', { name: busName, volume_db: -6 }, { phase: 'audio' });
  await callTool(client, 'set_audio_bus', { name: busName, volume_db: -3, mute: false }, { phase: 'audio' });
  await callTool(client, 'add_audio_bus_effect', { bus: busName, effect_type: 'reverb', params: { room_size: 0.2, wet: 0.1 } }, { phase: 'audio' });
  await callTool(client, 'add_audio_player', { node_path: '.', name: 'AudioProbe', type: 'AudioStreamPlayer3D', bus: busName, volume_db: -6 }, { phase: 'audio' });
  await callTool(client, 'get_audio_info', { node_path: '.' }, { phase: 'audio' });

  await callTool(client, 'find_unused_resources', { path: TEST_BASE, include_addons: false }, { phase: 'analysis' });
  await callTool(client, 'analyze_signal_flow', {}, { phase: 'analysis' });
  await callTool(client, 'analyze_scene_complexity', { path: scene3d }, { phase: 'analysis' });
  await callTool(client, 'find_script_references', { query: 'test_actor', path: TEST_BASE }, { phase: 'analysis' });
  await callTool(client, 'detect_circular_dependencies', { path: TEST_BASE }, { phase: 'analysis' });
  await callTool(client, 'get_project_statistics', { path: TEST_BASE, include_addons: false }, { phase: 'analysis' });

  await callTool(client, 'list_export_presets', {}, { phase: 'export' });
  await callTool(client, 'get_export_info', {}, { phase: 'export' });
  await callTool(client, 'export_project', {}, { phase: 'export', expectError: true });
  await callTool(client, 'list_android_devices', {}, { phase: 'android', expectError: true, timeoutMs: 10000 });
  await callTool(client, 'get_android_preset_info', {}, { phase: 'android', expectError: true });
  await callTool(client, 'deploy_to_android', { skip_export: true, launch: false }, { phase: 'android', expectError: true });

  await callTool(client, 'save_scene', { path: scene3d }, { phase: 'scene' });
}

async function coverRemainingTools(client, toolNames) {
  const skipSuccessfulDelete = new Set([
    'delete_scene',
    'delete_node',
    'remove_animation',
    'remove_autoload',
    'remove_state_machine_state',
    'remove_state_machine_transition',
    'tilemap_clear',
    'disconnect_signal',
  ]);

  for (const name of toolNames) {
    if (called.has(name)) {
      continue;
    }
    if (name === 'reload_plugin') {
      continue;
    }
    if (name === 'cleanup_mcp_project_state') {
      continue;
    }
    const args = skipSuccessfulDelete.has(name) ? {} : {};
    await callTool(client, name, args, {
      phase: skipSuccessfulDelete.has(name) ? 'destructive_validation' : 'coverage',
      expectError: true,
      timeoutMs: 15000,
    });
  }

  if (!called.has('reload_plugin')) {
    await callTool(client, 'reload_plugin', {}, { phase: 'editor', timeoutMs: 10000 });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await callTool(client, 'get_project_info', {}, { phase: 'reconnect_after_reload' });
  }

  if (!called.has('cleanup_mcp_project_state')) {
    await callTool(client, 'cleanup_mcp_project_state', {}, { phase: 'cleanup', timeoutMs: 10000 });
  }
}

async function main() {
  validateConfig();

  const client = new Client({ name: 'godot-mcp-mypro-project-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: 'node',
    args: [
      serverEntry,
      '--mode',
      'full',
      '--port',
      String(SERVER_PORT),
      '--godot',
      godotPath,
      '--safety',
      'normal',
    ],
    stderr: 'pipe',
  });

  await client.connect(transport);
  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name);

  try {
    await waitForPlugin(client);
    await callTool(client, 'reload_plugin', {}, { phase: 'preflight', timeoutMs: 10000 });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await waitForPlugin(client);
    await runCuratedCases(client);
    await coverRemainingTools(client, toolNames);
  } finally {
    await client.close();
  }

  const failed = results.filter((item) => item.status !== 'pass');
  const report = {
    projectPath,
    godotPath,
    port: SERVER_PORT,
    mode: 'full',
    runId,
    testBase: TEST_BASE,
    activeProject: projectPath,
    toolCount: toolNames.length,
    calledToolCount: called.size,
    passed: results.length - failed.length,
    failed: failed.length,
    failedItems: failed,
    safetyMode: {
      enabled: true,
      destructiveToolsPolicy,
    },
    destructiveToolsPolicy,
    results,
  };

  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    reportPath,
    toolCount: report.toolCount,
    calledToolCount: report.calledToolCount,
    passed: report.passed,
    failed: report.failed,
    failedNames: failed.map((item) => item.name),
  }, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
