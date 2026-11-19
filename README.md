# SideQuest · 侧边追问

给 DeepSeek Harness 加一个「旁边聊」：**选中文字 → 侧边提问 → 继续往下追问**，不用打断主聊天，也不用反复复制上下文。

![DSH 实机演示：主聊天旁连续展开两层中文追问](docs/images/dsh-sidequest-demo.png)

侧聊会带上父级上下文，可以继续展开下一层，没有预设层数上限。支持公式和可操作的 HTML 图表。

## 安装

需要 Node.js 22+、DSH，以及已登录 ChatGPT 的本地 Codex。

1. 下载并解压 [最新安装包](https://github.com/Keiyui0521/dsh-sidequest/releases)。
2. 在 `~/.config/dsh-sidequest/config.json` 填写工作区和 Codex 路径：

   ```json
   {
     "workspace": "/你的工作区绝对路径",
     "codexBin": "/codex可执行文件的绝对路径"
   }
   ```
3. 在 DSH「插件」中安装解压后的目录（`file:/绝对路径/package`），启用并重启。

侧聊是临时的，关闭或重启后不保留。所有侧聊使用配置的工作区；Codex 的文件操作权限独立于 DSH 主界面设置。

目前为实验版，基于 macOS / DSH 0.2.2-rc.3 验证。[详细说明](docs/guide.md) · [MIT](LICENSE)
