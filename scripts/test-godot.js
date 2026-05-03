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

try {
  execFileSync(godotPath, ['--headless', '--editor', '--path', tempProject, '--quit'], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 60_000,
  });
  console.log(`Plugin fixture loaded: ${tempProject}`);
} catch (error) {
  console.error('Godot plugin load check failed.');
  console.error(error.stdout?.toString() ?? '');
  console.error(error.stderr?.toString() ?? '');
  process.exit(1);
} finally {
  fs.removeSync(tempProject);
}
