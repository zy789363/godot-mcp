import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type ToolInputSchema = Tool['inputSchema'] & {
  additionalProperties?: boolean;
};

const GODOT_VARIANT_SCHEMA = {
  description: 'Any Godot Variant-compatible JSON value.',
};

const PROPERTIES_MAP_SCHEMA = {
  type: 'object',
  description: 'Node properties to set after creation. Keys are Godot property names.',
  additionalProperties: true,
};

const STRING_ARRAY_SCHEMA = {
  type: 'array',
  items: { type: 'string' },
};

export const TOOL_INPUT_SCHEMAS: Record<string, ToolInputSchema> = {
  launch_editor: schema(
    {
      projectPath: {
        type: 'string',
        description: 'Absolute filesystem path to a Godot project directory containing project.godot.',
      },
    },
    ['projectPath'],
  ),
  run_project: schema(
    {
      projectPath: {
        type: 'string',
        description: 'Absolute filesystem path to a Godot project directory containing project.godot.',
      },
      scene: {
        type: 'string',
        description: 'Optional scene path to run instead of the project main scene.',
      },
    },
    ['projectPath'],
  ),
  list_projects: schema(
    {
      directory: {
        type: 'string',
        description: 'Directory to scan for Godot project.godot files.',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to search subdirectories.',
        default: false,
      },
    },
    ['directory'],
  ),
  get_project_info: schema(),
  create_scene: schema(
    {
      path: {
        type: 'string',
        description: 'Godot resource path for the new scene, for example res://scenes/Main.tscn.',
      },
      root_type: {
        type: 'string',
        description: 'Godot class name for the root node.',
        default: 'Node2D',
      },
      root_name: {
        type: 'string',
        description: 'Optional root node name. Defaults to the scene file basename.',
      },
    },
    ['path'],
  ),
  open_scene: schema(
    {
      path: {
        type: 'string',
        description: 'Godot resource path to an existing .tscn scene.',
      },
    },
    ['path'],
  ),
  save_scene: schema({
    path: {
      type: 'string',
      description: 'Optional Godot resource path. Omit to save the current scene to its existing path.',
    },
  }),
  add_node: schema(
    {
      type: {
        type: 'string',
        description: 'Godot node class or project script class_name to instantiate.',
      },
      parent_path: {
        type: 'string',
        description: 'Path to the parent node within the edited scene. Use "." for the root.',
        default: '.',
      },
      name: {
        type: 'string',
        description: 'Optional name for the new node.',
      },
      properties: PROPERTIES_MAP_SCHEMA,
    },
    ['type'],
  ),
  update_property: schema(
    {
      node_path: {
        type: 'string',
        description: 'Path to the node within the edited scene. Use get_scene_tree to inspect paths.',
      },
      property: {
        type: 'string',
        description: 'Godot property name to update.',
      },
      value: GODOT_VARIANT_SCHEMA,
    },
    ['node_path', 'property', 'value'],
  ),
  get_node_properties: schema(
    {
      node_path: {
        type: 'string',
        description: 'Path to the node within the edited scene. Use get_scene_tree to inspect paths.',
      },
      category: {
        type: 'string',
        description: 'Optional property name prefix filter.',
      },
    },
    ['node_path'],
  ),
  create_script: schema(
    {
      path: {
        type: 'string',
        description: 'Godot resource path for the script, for example res://scripts/Player.gd.',
      },
      content: {
        type: 'string',
        description: 'Full script contents. Omit to generate a small template.',
      },
      extends: {
        type: 'string',
        description: 'Base class for generated GDScript content when content is omitted.',
        default: 'Node',
      },
      class_name: {
        type: 'string',
        description: 'Optional GDScript class_name for generated content.',
      },
    },
    ['path'],
  ),
  edit_script: schema(
    {
      path: {
        type: 'string',
        description: 'Godot resource path to an existing script.',
      },
      content: {
        type: 'string',
        description: 'Full replacement script contents.',
      },
      replacements: {
        type: 'array',
        description: 'Search-and-replace operations to apply in order.',
        items: {
          type: 'object',
          properties: {
            search: { type: 'string' },
            replace: { type: 'string' },
            regex: { type: 'boolean', default: false },
          },
          required: ['search', 'replace'],
          additionalProperties: false,
        },
      },
      insert_at_line: {
        type: 'integer',
        description: 'Zero-based line index where text should be inserted.',
        minimum: 0,
      },
      text: {
        type: 'string',
        description: 'Text to insert when insert_at_line is provided.',
      },
    },
    ['path'],
  ),
  read_script: schema(
    {
      path: {
        type: 'string',
        description: 'Godot resource path to an existing script.',
      },
    },
    ['path'],
  ),
  validate_script: schema(
    {
      path: {
        type: 'string',
        description: 'Godot resource path to a GDScript file to compile-check.',
      },
    },
    ['path'],
  ),
  play_scene: schema({
    mode: {
      type: 'string',
      description: 'Use "main", "current", or a Godot scene path to run a custom scene.',
      default: 'main',
    },
  }),
  get_game_node_properties: schema(
    {
      node_path: {
        type: 'string',
        description: 'Runtime node path from get_game_scene_tree.',
      },
      properties: {
        ...STRING_ARRAY_SCHEMA,
        description: 'Optional list of property names to return.',
      },
    },
    ['node_path'],
  ),
  set_game_node_property: schema(
    {
      node_path: {
        type: 'string',
        description: 'Runtime node path from get_game_scene_tree.',
      },
      property: {
        type: 'string',
        description: 'Runtime node property name to update.',
      },
      value: GODOT_VARIANT_SCHEMA,
    },
    ['node_path', 'property', 'value'],
  ),
  simulate_key: schema(
    {
      keycode: {
        type: 'string',
        description: 'Godot key name such as KEY_SPACE, KEY_ENTER, or KEY_A.',
      },
      pressed: {
        type: 'boolean',
        default: true,
      },
      shift: {
        type: 'boolean',
        default: false,
      },
      ctrl: {
        type: 'boolean',
        default: false,
      },
      alt: {
        type: 'boolean',
        default: false,
      },
    },
    ['keycode'],
  ),
  simulate_mouse_click: schema({
    x: {
      type: 'number',
      description: 'Viewport x coordinate.',
      default: 0,
    },
    y: {
      type: 'number',
      description: 'Viewport y coordinate.',
      default: 0,
    },
    button: {
      type: 'integer',
      description: 'Godot mouse button id. 1 is left, 2 is right, 3 is middle.',
      default: 1,
    },
    pressed: {
      type: 'boolean',
      default: true,
    },
    double_click: {
      type: 'boolean',
      default: false,
    },
    auto_release: {
      type: 'boolean',
      description: 'When pressed is true, also send a release event on the following frame.',
      default: true,
    },
  }),
  simulate_action: schema(
    {
      action: {
        type: 'string',
        description: 'Input action name from the project Input Map.',
      },
      pressed: {
        type: 'boolean',
        default: true,
      },
      strength: {
        type: 'number',
        default: 1,
        minimum: 0,
      },
    },
    ['action'],
  ),
  set_active_project: schema(
    {
      projectPath: {
        type: 'string',
        description: 'Absolute filesystem path to the target Godot project directory.',
      },
    },
    ['projectPath'],
  ),
  get_active_project: schema(),
  doctor_connection: schema({
    include_plugin_status: {
      type: 'boolean',
      description: 'Also query the connected Godot plugin for status when a plugin is connected.',
      default: false,
    },
  }),
  get_mcp_plugin_status: schema(),
  cleanup_mcp_project_state: schema({
    confirm: {
      type: 'boolean',
      description: 'Required when the server is running with --safety strict.',
      default: false,
    },
  }),
  list_tool_groups: schema({
    mode: {
      type: 'string',
      enum: ['minimal', 'lite', '3d', 'full'],
      description: 'Optional tool mode to summarize.',
    },
    include_tools: {
      type: 'boolean',
      description: 'Whether to include tool names in each group.',
      default: true,
    },
  }),
  describe_tool: schema(
    {
      tool_name: {
        type: 'string',
        description: 'Exact MCP tool name to describe.',
      },
    },
    ['tool_name'],
  ),
  suggest_workflow: schema(
    {
      goal: {
        type: 'string',
        description: 'Short description of the Godot task, such as create a scene, edit a script, or test UI input.',
      },
      mode: {
        type: 'string',
        enum: ['minimal', 'lite', '3d', 'full'],
        description: 'Optional current tool mode.',
      },
      project_state: {
        type: 'string',
        description: 'Optional current state, such as no editor open, scene open, or game running.',
      },
    },
    ['goal'],
  ),
  get_project_capabilities: schema({
    mode: {
      type: 'string',
      enum: ['minimal', 'lite', '3d', 'full'],
      description: 'Optional tool mode to inspect.',
    },
    project_path: {
      type: 'string',
      description: 'Optional project directory for capability notes that depend on local project access.',
    },
  }),
};

function schema(
  properties: Record<string, object> = {},
  required: string[] = [],
): ToolInputSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}
