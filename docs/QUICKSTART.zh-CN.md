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

| 模式 | 适用场景 |
| --- | --- |
| `minimal` | 只保留最小项目/编辑器检查能力 |
| `lite` | 默认模式，覆盖项目、场景、节点、脚本、编辑器、输入、运行时、InputMap |
| `3d` | 在 `lite` 基础上加入 3D 场景、物理、导航等能力 |
| `full` | 暴露公开插件迁移来的全量工具 |

## 4. 配置 MCP 客户端

如果客户端使用 stdio 启动命令，配置为：

```json
{
  "mcpServers": {
    "godot-mcp-mypro": {
      "command": "node",
      "args": [
        "/Users/chenhuan/Desktop/AIGame/godot-mcp-mypro/build/index.js",
        "--mode",
        "lite",
        "--port",
        "6505"
      ],
      "env": {
        "GODOT_PATH": "/Applications/Godot_mono.app/Contents/MacOS/Godot"
      }
    }
  }
}
```

如果已经全局安装并能找到 `godot-mcp` bin，也可以把 `command` 改成 `godot-mcp`，并移除 `build/index.js` 路径。

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

## 6. 常见问题

### Godot 插件连不上 server

确认 MCP server 的 `--port` 和 Godot 插件扫描端口一致。默认 server 监听 `6505`，插件会扫描 `6505-6514`。

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
