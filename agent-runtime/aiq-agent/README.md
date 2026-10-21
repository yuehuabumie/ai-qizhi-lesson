# AIQ 备课智能体（开发中）

基于 DSH `0.2.1-rc.2` 源码裁剪的独立 SDK 运行时。当前用于本地兼容性验证，尚未替换生产环境。

## 来源与许可

- 上游：<https://github.com/deepseek-ai/deepseek-harness>
- 固定提交：`687f282e8625c6b8d11ff58211a90524be2e4317`
- `vendor/` 保留所需源码包；`UPSTREAM.json` 记录包来源。
- 保留 MIT 许可及第三方声明，见 `UPSTREAM-LICENSE`、`UPSTREAM-THIRD-PARTY.md` 和各包 `LICENSE`。
- 保留上游内部包名以兼容协议和插件，不表示这是 DeepSeek 官方产品。

## 本地验证

需要 Node.js 24 或更新版本。在本目录执行：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
```

`vendor/` 源码已提交，生成的 `lib/` 和 `node_modules/` 不提交。`npm run vendor` 仅用于首次从固定上游源码及父目录已安装的同版本包抽取，已有目标目录时会拒绝覆盖。

在父目录 `agent-runtime/` 运行 MCP 离线兼容性测试：

```powershell
$env:PREP_AGENT_ENGINE = 'aiq'
node tests/smoke-mcp.mjs
Remove-Item Env:PREP_AGENT_ENGINE
```

## 当前边界

- 已验证源码构建、启动、持久会话恢复，以及真实工具链经过本地模型响应夹具完成 MCP 调用、虚拟会话和凭据脱敏。
- 离线模型回复是固定测试数据，不代表真实模型质量验收。
- `runtime-engine.mjs` 默认仍加载原 DSH；只有明确设置 `PREP_AGENT_ENGINE=aiq` 才选择本实现。
- 原 Dockerfile 仍只打包原运行时，不能直接开启 `aiq`；独立镜像和端到端工具验收尚未完成。
- 后续继续验证教学确认写入、文件生成/交付、Skills、子任务、联网、取消和旧会话双向兼容。
- 当前构建仅供 JavaScript 运行使用，未生成 TypeScript 声明和被裁掉的 GUI 远程接口入口。

生产替换前必须完成兼容性与隔离环境验收，不改变宿主 broker、任务令牌、教师确认和会话归属边界。
