# Godot MCP MyPro 快速上手

这份文档用于把本仓库的自研 TypeScript MCP server 接入本机 Godot 项目。推荐基线是 Godot `4.6.2.stable.mono`，当前默认连接端口是 `6505`。

## 1. 准备环境

```bash
cd /Users/chenhuan/Desktop/AIGame/godot-mcp-mypro
npm ci
npm run build
```

如果 Godot 没有安装在默认位置，先设置路径：

```bash
export GODOT_PATH="/Applications/Godot_mono.app/Contents/MacOS/Godot"
```

也可以在启动时用 `--godot` 显式传入。

## 2. 安装 Godot 插件到项目

```bash
node build/index.js --install-addon /path/to/your-godot-project
```

以本机测试项目为例：

```bash
node build/index.js --install-addon /Users/chenhuan/Desktop/AIGame/p01
```

打开 Godot 后进入：

```text
Project -> Project Settings -> Plugins
```

启用 `Godot MCP MyPro`。底部面板出现 `MCP MyPro`，并看到连接端口 `6505-6514`，说明插件侧已加载。

## 3. 启动 MCP Server

本地开发推荐先用 `lite`：

```bash
node build/index.js --mode lite --port 6505
```

全量工具测试或迁移验证使用 `full`：

```bash
node build/index.js --mode full --port 6505 --godot "$GODOT_PATH"
```

可用模式：

| 模式 | 工具数 | 适用场景 |
| --- | ---: | --- |
| `minimal` | 39 | 只保留最小项目/编辑器检查能力 |
| `lite` | 95 | 默认模式，覆盖项目、场景、节点、脚本、编辑器、输入、运行时、InputMap |
| `3d` | 120 | 在 `lite` 基础上加入 3D 场景、物理、导航、动画树等能力 |
| `full` | 186 | 暴露公开插件迁移来的全量工具，适合全工具巡检 |

当前活跃项目由连接到该端口的 Godot 编辑器决定。多项目并行时，建议每个编辑器和 MCP server 使用不同端口，避免 server 连到非目标项目。

## 4. 配置 Codex MCP 客户端

默认以 Codex 为运行环境，在 `~/.codex/config.toml` 中加入：

```toml
[mcp_servers.godot-mcp-mypro]
command = "node"
args = [
  "/Users/chenhuan/Desktop/AIGame/godot-mcp-mypro/build/index.js",
  "--mode",
  "lite",
  "--port",
  "6505"
]
env = { GODOT_PATH = "/Applications/Godot_mono.app/Contents/MacOS/Godot" }
```

如果已经全局安装并能找到 `godot-mcp` bin，也可以把 `command` 改成 `godot-mcp`，并从 `args` 中移除 `build/index.js` 路径。

项目技能默认放到 Codex skill 目录：

```bash
mkdir -p ~/.codex/skills/godot-mcp-mypro
cp addons/godot_mcp/skills.zh.md ~/.codex/skills/godot-mcp-mypro/SKILL.md
```

其他 MCP 客户端仍可使用等价的 stdio 配置，但本文档默认展示 Codex。

## 5. 验证接入

先确认 Godot 版本：

```bash
/Applications/Godot_mono.app/Contents/MacOS/Godot --version
```

再跑仓库检查：

```bash
npm run check
npm run test:e2e
```

对 `/Users/chenhuan/Desktop/AIGame/p01` 做全工具巡检：

```bash
npm run test:p01
```

报告会写入：

```text
/Users/chenhuan/Desktop/AIGame/p01/docs/mcp-mypro/reports/p01_full_tool_report.json
```

对任意项目做同样的 `full` 模式巡检：

```bash
npm run test:project -- /path/to/your-godot-project
```

也可以用环境变量固定重度测试配置：

```bash
MCP_TEST_PROJECT=/path/to/your-godot-project \
MCP_TEST_PORT=6506 \
MCP_TEST_RUN_ID=nightly_001 \
MCP_TEST_REPORT_DIR=/path/to/reports \
npm run test:project
```

常用参数和环境变量：

| 参数/环境变量 | 作用 |
| --- | --- |
| `--project` / `MCP_TEST_PROJECT` / `P01_PROJECT` | 目标 Godot 项目路径；`test:p01` 会默认设置为本机 p01 |
| `--godot` / `GODOT_PATH` | Godot 可执行文件路径 |
| `--port` / `MCP_TEST_PORT` | 测试 server 端口，默认 `6506`，避免和日常 `6505` 冲突 |
| `--run-id` / `MCP_TEST_RUN_ID` | 测试资源目录名的一部分，默认 `run_<timestamp>` |
| `--report-dir` / `MCP_TEST_REPORT_DIR` | 报告目录，默认 `<project>/docs/mcp-mypro/reports` |
| `--report` / `MCP_TEST_REPORT_PATH` | 精确报告文件路径，会覆盖报告目录 |

报告内会记录 `activeProject`、端口、运行 id、工具总数、实际调用数、失败项和安全策略。

### 安全模式与清理

全工具巡检默认采用 `--safety normal`：删除类工具只用缺失或无效参数做覆盖，脚本执行类工具会显式传 `confirm:true`，非删除工具会在 `res://mcp_mypro_test/<run-id>` 下创建测试资源。需要清理时，可以在 Godot 项目里删除 `res://mcp_mypro_test/`，或固定 `MCP_TEST_RUN_ID` 后只删除对应目录。

Godot 插件底部面板的 Tools 页支持逐项禁用工具，也支持 `Disable All` / `Enable All`。如果禁用了工具，巡检报告会出现 disabled tool 错误；跑全量巡检前请确认目标工具已启用。

常用排障入口已经注册为 MCP 工具：`doctor_connection` 会覆盖端口、Godot 路径/版本、插件连接、活跃项目、模式工具数等检查；`get_mcp_plugin_status` 会返回插件侧项目路径、端口扫描、autoload 和临时状态；`cleanup_mcp_project_state` 会清理 MCP 插件可识别的 autoload 和临时状态，保留用户资源。

## 6. 常见问题

### Godot 插件连不上 server

确认 MCP server 的 `--port` 和 Godot 插件扫描端口一致。默认 server 监听 `6505`，插件会扫描 `6505-6514`。如果同时打开多个 Godot 项目，请给每个项目分配不同端口，并用报告里的 `activeProject` 确认连接的是目标项目。

### `tsc: command not found`

先执行：

```bash
npm ci
```

不要只依赖全局 TypeScript；本项目使用本地 devDependencies。

### 找不到 Godot

优先级是：

1. `--godot /path/to/Godot`
2. `GODOT_PATH`
3. `/Applications/Godot_mono.app/Contents/MacOS/Godot`
4. 其他常见 Godot 安装路径

### p01 出现 examples 解析错误

`/Users/chenhuan/Desktop/AIGame/p01/examples` 下存在与 MCP 无关的示例脚本缺类型/缺 placeholder 资源问题。MCP 插件和 server 测试不依赖这些示例脚本。

## 7. 日常开发命令

```bash
npm run build
npm test
npm run test:godot
npm run test:e2e
npm run check
```

修改 Godot 插件代码后，重新安装到目标项目：

```bash
npm run build
node build/index.js --install-addon /path/to/your-godot-project
```
