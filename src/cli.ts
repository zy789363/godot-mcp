import type { CliOptions } from './types.js';
import { normalizeMode } from './tools.js';

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: 'lite',
    port: 6505,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--mode':
        options.mode = normalizeMode(next);
        i += 1;
        break;
      case '--godot':
        options.godotPath = next;
        i += 1;
        break;
      case '--port':
        options.port = parsePort(next);
        i += 1;
        break;
      case '--install-addon':
        options.installAddon = next;
        i += 1;
        break;
      default:
        if (arg.startsWith('--mode=')) {
          options.mode = normalizeMode(arg.slice('--mode='.length));
        } else if (arg.startsWith('--godot=')) {
          options.godotPath = arg.slice('--godot='.length);
        } else if (arg.startsWith('--port=')) {
          options.port = parsePort(arg.slice('--port='.length));
        } else if (arg.startsWith('--install-addon=')) {
          options.installAddon = arg.slice('--install-addon='.length);
        }
        break;
    }
  }

  return options;
}

export function helpText(): string {
  return [
    'godot-mcp 自研 MCP/WebSocket server',
    '',
    'Usage:',
    '  godot-mcp [--mode full|3d|lite|minimal] [--port 6505] [--godot /path/to/Godot]',
    '  godot-mcp --install-addon /path/to/godot-project',
    '',
    'Options:',
    '  --mode            工具模式，默认 lite',
    '  --port            监听 Godot 插件连接的 WebSocket 端口，默认 6505',
    '  --godot           Godot 可执行文件路径，优先于自动检测',
    '  --install-addon   将 addons/godot_mcp 安装到指定 Godot 项目',
  ].join('\n');
}

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return 6505;
  }
  return port;
}
