import { access, cp, mkdir, readFile, readdir, stat } from 'fs/promises';
import { constants, existsSync } from 'fs';
import { dirname, join, normalize } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

export interface CandidateOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  explicitPath?: string;
}

export interface ResolveOptions {
  candidates?: string[];
  exists?: (candidate: string) => Promise<boolean>;
  execVersion?: (candidate: string) => Promise<string>;
}

export interface ResolvedGodot {
  path: string;
  version: string;
}

export function getGodotCandidates(options: CandidateOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const candidates: string[] = [];

  if (options.explicitPath) {
    candidates.push(options.explicitPath);
  }

  if (env.GODOT_PATH) {
    candidates.push(env.GODOT_PATH);
  }

  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Godot_mono.app/Contents/MacOS/Godot',
      '/Applications/Godot.app/Contents/MacOS/Godot',
      '/Applications/Godot_4.app/Contents/MacOS/Godot',
      `${env.HOME}/Applications/Godot_mono.app/Contents/MacOS/Godot`,
      `${env.HOME}/Applications/Godot.app/Contents/MacOS/Godot`,
      `${env.HOME}/Applications/Godot_4.app/Contents/MacOS/Godot`,
      `${env.HOME}/Library/Application Support/Steam/steamapps/common/Godot Engine/Godot.app/Contents/MacOS/Godot`,
    );
  } else if (platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Godot\\Godot.exe',
      'C:\\Program Files\\Godot_v4.6-stable_mono_win64\\Godot_v4.6-stable_mono_win64.exe',
      'C:\\Program Files (x86)\\Godot\\Godot.exe',
      `${env.USERPROFILE}\\Godot\\Godot.exe`,
    );
  } else {
    candidates.push(
      '/usr/bin/godot',
      '/usr/local/bin/godot',
      '/snap/bin/godot',
      `${env.HOME}/.local/bin/godot`,
    );
  }

  candidates.push('godot');

  return [...new Set(candidates.filter(Boolean).map((candidate) => normalize(candidate)))];
}

export async function resolveGodotPath(options: ResolveOptions = {}): Promise<ResolvedGodot | null> {
  const candidates = options.candidates ?? getGodotCandidates();
  const exists = options.exists ?? executableExists;
  const execVersion = options.execVersion ?? readGodotVersion;

  for (const candidate of candidates) {
    if (!(await exists(candidate))) {
      continue;
    }

    try {
      const version = await execVersion(candidate);
      return { path: candidate, version };
    } catch {
      continue;
    }
  }

  return null;
}

export async function readGodotVersion(godotPath: string): Promise<string> {
  const { stdout } = await execFileAsync(godotPath, ['--version']);
  return stdout.trim();
}

export async function installAddon(projectPath: string, addonSource = defaultAddonSource()): Promise<string> {
  const projectFile = join(projectPath, 'project.godot');
  await access(projectFile, constants.R_OK);

  const target = join(projectPath, 'addons', 'godot_mcp');
  await mkdir(dirname(target), { recursive: true });
  await cp(addonSource, target, { recursive: true, force: true });
  return target;
}

export async function listGodotProjects(directory: string, recursive = false): Promise<Array<{ path: string; name: string }>> {
  const projects: Array<{ path: string; name: string }> = [];

  async function visit(dir: string): Promise<void> {
    try {
      await access(join(dir, 'project.godot'), constants.R_OK);
      projects.push({ path: dir, name: dir.split(/[\\/]/).pop() ?? dir });
      return;
    } catch {
      // Not a project root; continue into children when requested.
    }

    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      const child = join(dir, entry.name);
      if (recursive) {
        await visit(child);
      } else {
        try {
          await access(join(child, 'project.godot'), constants.R_OK);
          projects.push({ path: child, name: entry.name });
        } catch {
          // Not a project.
        }
      }
    }
  }

  await visit(directory);
  return projects;
}

export async function readProjectName(projectPath: string): Promise<string> {
  const contents = await readFile(join(projectPath, 'project.godot'), 'utf8');
  const match = contents.match(/config\/name=\"(.+?)\"/);
  return match?.[1] ?? projectPath.split(/[\\/]/).pop() ?? 'Godot Project';
}

async function executableExists(candidate: string): Promise<boolean> {
  if (candidate === 'godot') {
    return true;
  }

  try {
    const info = await stat(candidate);
    if (!info.isFile()) {
      return false;
    }
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultAddonSource(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), 'addons', 'godot_mcp'),
    join(moduleDir, 'addons', 'godot_mcp'),
    join(moduleDir, '..', 'addons', 'godot_mcp'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ?? candidates[0];
}
