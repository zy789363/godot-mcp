import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const explicitGodot = process.env.GODOT_PATH;
const candidates = [
  explicitGodot,
  '/Applications/Godot_mono.app/Contents/MacOS/Godot',
  '/Applications/Godot.app/Contents/MacOS/Godot',
  'godot',
].filter(Boolean);

const godotPath = candidates.find((candidate) => {
  if (candidate === 'godot') {
    try {
      execFileSync(candidate, ['--version'], { encoding: 'utf8' });
      return true;
    } catch {
      return false;
    }
  }
  return fs.existsSync(candidate);
});

if (!godotPath) {
  console.error('Godot executable not found. Set GODOT_PATH or install Godot.');
  process.exit(1);
}

const version = execFileSync(godotPath, ['--version'], { encoding: 'utf8' }).trim();
console.log(`Godot: ${godotPath}`);
console.log(`Version: ${version}`);

if (!version.startsWith('4.6.2')) {
  console.error(`Expected Godot 4.6.2 for this local baseline, got ${version}`);
  process.exit(1);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const addonSource = path.join(root, 'addons', 'godot_mcp');
const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'godot-mcp-mypro-'));

fs.ensureDirSync(path.join(tempProject, 'addons'));
fs.copySync(addonSource, path.join(tempProject, 'addons', 'godot_mcp'));
fs.writeFileSync(
  path.join(tempProject, 'project.godot'),
  [
    'config_version=5',
    '',
    '[application]',
    'config/name="godot-mcp-mypro-test"',
    'config/features=PackedStringArray("4.6", "Forward Plus")',
    '',
    '[editor_plugins]',
    'enabled=PackedStringArray("res://addons/godot_mcp/plugin.cfg")',
    '',
  ].join('\n'),
);

const pluginStateTestScript = path.join(tempProject, 'plugin_state_test.gd');
fs.writeFileSync(
  pluginStateTestScript,
  [
    'extends SceneTree',
    '',
    'func _init() -> void:',
    '\tvar state = load("res://addons/godot_mcp/utils/plugin_state.gd").new()',
    '\tProjectSettings.set_setting("autoload/MCPScreenshot", "*res://addons/godot_mcp/mcp_screenshot_service.gd")',
    '\tProjectSettings.set_setting("autoload/MCPInputService", "*res://custom/project_owned_input.gd")',
    '\tvar temp_path := OS.get_user_data_dir().path_join("mcp_screenshot.png")',
    '\tvar temp_file := FileAccess.open(temp_path, FileAccess.WRITE)',
    '\tif temp_file == null:',
    '\t\t_fail("could not create MCP temp file")',
    '\t\treturn',
    '\ttemp_file.store_string("fixture")',
    '\ttemp_file.close()',
    '\tvar status: Dictionary = state.get_status()',
    '\t_assert(status.get("autoloads", []).size() == 3, "status should describe known autoloads")',
    '\t_assert(status.get("temp_files", []).size() >= 1, "status should include MCP temp files")',
    '\tvar cleanup: Dictionary = state.cleanup_project_state()',
    '\t_assert(not ProjectSettings.has_setting("autoload/MCPScreenshot"), "cleanup should remove MCP runtime autoloads")',
    '\t_assert(ProjectSettings.get_setting("autoload/MCPInputService", "") == "*res://custom/project_owned_input.gd", "cleanup should preserve project-owned autoloads")',
    '\t_assert(not FileAccess.file_exists(temp_path), "cleanup should remove MCP temp files")',
    '\t_assert(cleanup.get("autoloads_removed", []).size() == 1, "cleanup should report removed MCP autoload")',
    '\t_assert(_has_skip_reason(cleanup.get("autoloads_skipped", []), "value_mismatch"), "cleanup should report skipped project-owned autoload")',
    '\tprint("Plugin state cleanup fixture passed")',
    '\tquit(0)',
    '',
    'func _has_skip_reason(items: Array, reason: String) -> bool:',
    '\tfor item in items:',
    '\t\tif item is Dictionary and item.get("reason", "") == reason:',
    '\t\t\treturn true',
    '\treturn false',
    '',
    'func _assert(condition: bool, message: String) -> void:',
    '\tif not condition:',
    '\t\t_fail(message)',
    '',
    'func _fail(message: String) -> void:',
    '\tpush_error(message)',
    '\tquit(1)',
    '',
  ].join('\n'),
);

try {
  execFileSync(godotPath, ['--headless', '--editor', '--path', tempProject, '--quit'], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 60_000,
  });
  console.log(`Plugin fixture loaded: ${tempProject}`);
  const stateTestOutput = execFileSync(godotPath, ['--headless', '--path', tempProject, '--script', pluginStateTestScript], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 60_000,
  });
  if (!stateTestOutput.includes('Plugin state cleanup fixture passed')) {
    throw new Error(`Plugin state cleanup fixture did not report success.\n${stateTestOutput}`);
  }
  console.log('Plugin state cleanup fixture passed');
} catch (error) {
  console.error('Godot plugin load check failed.');
  console.error(error.stdout?.toString() ?? '');
  console.error(error.stderr?.toString() ?? '');
  process.exit(1);
} finally {
  fs.removeSync(tempProject);
}
