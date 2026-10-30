# dsh-tool-policy

DSH（DeepSeek Harness）的 Agent 预设 bundle：提供一个 **「交付模式」** 预设，在 `tools/pre-execute` 阶段按规则拦截或询问工具调用，让“生产写动作必须由人批准”成为机制而不是提示词约定。

- 只有切到「交付模式」的会话才挂这个门禁；标准 / PTC / 极简 / 创造模式完全不受影响。
- `deny`：调用不执行，模型收到“被策略阻止、不要重试”的失败结果。
- `ask`：走 DSH 审批面板，用户当场批准才执行；会话 approval 策略为 `never` 时等同拒绝。
- 未命中任何规则的调用行为不变（继续 `next()`）。

## 安装

### 方式一：从仓库装（桌面版插件管理器）

在 DSH 的插件管理器里添加 Bundle：

```text
https://codeload.github.com/SophiaData/dsh-tool-policy/tar.gz/refs/heads/main
```

### 方式二：本地 link（开发时）

1. 插件目录加入 profile 依赖（desktop profile 由 Electron 管理，编辑 `%DSH_HOME%\profiles\desktop\package.json`）：

   ```json
   "dependencies": {
     "dsh-tool-policy": "link:E:/dev-day/dsh-tool-policy"
   }
   ```

2. 在 profile 目录执行 `pnpm install`，让 `node_modules/dsh-tool-policy` 指向上面的目录。

3. 把包名加进 profile 的 bundle 列表：

   ```json
   "dsh": { "profile": { "bundles": [ "...", "dsh-tool-policy" ] } }
   ```

安装脚本 `scripts/profile-edit.mjs <profileDir> dep|bundle` 做同样两处编辑，幂等、锚点缺失即报错；`bundle` 步骤会先确认 dependency 已存在。

安装后重启 DSH，在 **设置 → Agent 预设 → 自定义** 里会出现「交付模式」；点「设为默认」即可让新任务默认用它。已存在的会话保留原组合，需要新开会话才切换。

## 开发

```sh
node test/policy.test.mjs
```

纯 `node:test`，无第三方依赖；`policy.js` 是决策逻辑，`index.js` 只做 Cordis 接线。

## 预设内容

`cordis.patch.yml` 只插入一条 `@deepseek-ai/dsh-agent-preset`（`config.id: delivery`），它的 `plugins` 是标准模式的工具面加上本插件作为最后一项。标准模式的工具面与 `@deepseek-ai/dsh-web-app/presets/standard.patch.yml` 保持一致（22 项，同序），新增第 23 项：

```yaml
- id: tool-policy
  name: dsh-tool-policy
  config: { onError: allow, rules: [...] }
```

预设是组合层，不会修改其它预设，也不会在 profile 根层注册全局规则。

## 规则配置

规则写在 `cordis.patch.yml` 的 `preset-delivery → plugins[tool-policy] → config`。字段：

| 字段 | 含义 |
|---|---|
| `rules[].tools` | 工具名或通配模式（`*` 匹配任意字符），必填 |
| `rules[].pattern` | 可选正则。先匹配工具名，工具名未命中再匹配命令文本（`command` / `text` / `code` / `script`）；这些字段都为空时才退回参数 JSON。命令字段非空时**不会**再看其它参数（例如 `ddl_sql`） |
| `rules[].flags` | 正则标志，默认 `i`；带状态标志 `g` / `y` 会被移除并告警，避免跨调用交替命中 |
| `rules[].action` | `deny` 或 `ask`，必填 |
| `rules[].reason` | 给模型的说明（`ask` 时同时作为审批理由） |
| `rules[].displayReason` | 审批面板展示文案；`en` 必须存在（缺省时自动补默认英文），`zh` 可选 |
| `rules[].disabled` | 置 `true` 临时停用该条 |
| `onError` | 规则评估抛错时兜底：`allow`（默认）或 `deny` |

非法配置（action 写错、tools 为空、正则编译失败、`rules` 不是数组、`onError` 取值非法）只记配置告警并跳过，不会导致插件加载失败；规则按书写顺序，第一条命中即生效。

## 局限

- 只拦“工具调用”。PTC 程序或脚本里直接发 HTTP 请求的原始网络调用不经过工具管线，拦不到。
- `pwsh` / `terminal_send` 的命令文本靠关键字正则识别，换个不沾关键词的脚本名就漏；这是提示层判断，不是沙箱。
- 浏览器类 MCP（chrome-devtools / playwright）的 `click`、`fill` 无法区分是否在点生产发布按钮，默认不拦。
- `pattern` 退回参数 JSON 时可能误判（读操作参数里带关键词也会命中）。
- `data-mcp` 的 `update_cookie` 用 `ask` 而不是 `deny`：Cookie 刷新是你主动运维时才会发生，直接禁掉会阻断自动刷新流程。
- 规则评估异常默认放行（`onError: allow`），避免规则 bug 阻断日常操作；要严格可改成 `deny`。
- 审批依赖 DSH 的 approval 服务与应答者；无应答者时 `ask` 会以“无审批通道”拒绝。

## 验证

- 单元测试：`node test/policy.test.mjs`（纯决策逻辑，不需要 DSH 运行时）。
- 实机验证：新开会话并切到「交付模式」后，让 Agent 执行一条含 `publish` 的 `pwsh` 命令 → 应弹审批；让它调用 `mcp__data-mcp__execute_ddl` → 应被拒绝且模型收到“未执行、不要重试”。

## 卸载

从 profile 的 `dependencies` 与 `dsh.profile.bundles` 中移除本包，再执行 `pnpm install`；或者保留安装、只把 `cordis.patch.yml` 里 `preset-delivery` 行标 `disabled: true`。
