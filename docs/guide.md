# 使用与开发

选中主聊天中的文字，点击「侧边提问」。侧聊继承父级对话快照；在侧聊内继续选中文字，可以展开下一层。关闭某层会同时关闭其后续层。

## 模型与图表

- 模型列表来自 DSH 已注册的服务商，选定后由 DSH 自身的模型接口发送请求。密钥和认证仍由 DSH 管理。
- v0.2.0 移除了 Codex 进程、账号登录检查和专用模型适配器。不需要安装 Codex，也不再执行文件或命令工具。
- 要交互图表，可以说「用可操作的 HTML 图表解释」。完整的 `html` 围栏代码块会直接显示为预览。脚本和样式必须内联，不支持 CDN、联网或打开新窗口。
- 旧的本地 HTML 链接仍可选用：在 `~/.config/dsh-sidequest/config.json` 中设置 `workspace`，仅允许读取该目录内不超过 2 MB 的 HTML。普通侧聊和新图表不需要此配置。
- 对话文字会发送给所选服务商；临时侧聊描述的是插件的本地存储行为，不代表服务商的数据保留政策。

## 兼容范围

v0.2.0 已在独立的 macOS / DSH `0.2.2-rc.3` 测试副本中，使用 DSH 配置的 Gemini 4 Argon 完成真实联网验证：侧聊继承主聊天上下文、HTML 图表显示、滑块操作及数值更新均正常。六组自动测试和独立安装包启动检查通过。其他 DSH 版本、其他系统和全新机器尚未完成实机验证。

已知问题：部分使用 `$…$` 的行内公式仍会显示为源码；不影响图表交互。

宿主需提供 `llm.listProviders`、`llm.listModels`、`llm.prepareCall`，以及会话与选中文字的界面插槽。其他插件若覆盖相同插槽，可能冲突。旧版私有侧聊插件应先停用。

## 开发

需要 Node.js 22+。

```sh
npm ci
npm test
npm run format:check
npm run test:package
```

```text
src/
  adapters/     DSH 模型与会话接口
  client/       侧聊界面、状态、渲染、样式
  server/       插件入口、本地通信、可选图表目录配置
tests/          自动测试
scripts/        构建脚本
docs/           使用说明与实机截图
```

`index.js` 是服务端入口；浏览器代码从 `src/client/index.js` 构建到 `dist/client.js`。安装包包含构建产物，源码检出需先运行 `npm run build`。
