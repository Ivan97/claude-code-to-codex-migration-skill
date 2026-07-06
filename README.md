# Claude Code 到 Codex 迁移 Skill

这个仓库提供一个 Codex skill，用来安全检查、规划并协助把 Claude Code 的配置迁移到 Codex。

它的核心原则是：先检查、先出计划、先让用户确认，然后才执行任何写入。默认只复制，不移动；不删除 Claude Code 源文件；不静默覆盖已有 Codex 配置。

## 适用场景

当你想把下面这些 Claude Code 配置迁移到 Codex 时使用这个 skill：

- 用户级和项目级 instructions / memory：`CLAUDE.md`、`CLAUDE.local.md`
- Claude Code settings：`~/.claude/settings.json`、`<project>/.claude/settings.json`
- MCP servers：`~/.claude.json`、`.mcp.json`、settings 中的 `mcpServers`
- Slash commands：`.claude/commands/`
- Skills：`.claude/skills/`
- Agents：`.claude/agents/`
- Hooks、permissions、output styles、plugins / marketplaces
- `~/.claude.json#projects[*]` 中记录过的多个项目 memory

## 安装

本仓库根目录本身就是 skill 目录，包含 `SKILL.md`。

可以把它 clone 到 Codex skills 目录：

```bash
git clone git@gitlab.alibaba-inc.com:fliggy-fai/claude-code-to-codex-migration-skill.git ~/.codex/skills/claude-code-to-codex-migration
```

如果你的 Codex 使用了其他 `CODEX_HOME`，放到对应的 `skills/claude-code-to-codex-migration` 下即可。

## 使用方式

在需要迁移的项目目录中，让 Codex 使用这个 skill：

```text
使用 claude-code-to-codex-migration，帮我把当前项目的 Claude Code 配置迁移到 Codex。请先生成迁移计划，等我确认后再执行。
```

如果希望同时检查 Claude Code 记录过的所有项目里的 memory，可以明确说明：

```text
使用 claude-code-to-codex-migration，检查所有已知 Claude Code 项目的 CLAUDE.md / CLAUDE.local.md，并规划迁移到 Codex。
```

skill 会优先运行只读 inspector：

```bash
node <skill-dir>/scripts/inspect-migration.mjs --project "$PWD"
```

需要机器可读结果时：

```bash
node <skill-dir>/scripts/inspect-migration.mjs --project "$PWD" --format json
```

需要扫描 `~/.claude.json#projects[*]` 中所有已知项目 memory 时：

```bash
node <skill-dir>/scripts/inspect-migration.mjs --project "$PWD" --include-known-project-memories
```

当迁移计划里有冲突或待确认项时，可以生成对比：

```bash
node <skill-dir>/scripts/resolve-migration.mjs diff --plan plan.json
```

用户确认后，可以用 approvals 文件执行支持的自动合并：

```bash
node <skill-dir>/scripts/resolve-migration.mjs apply --plan plan.json --approvals approvals.json
```

## 行为

这个 skill 会按下面的顺序工作：

1. 只读检查 Claude Code 源配置和 Codex 目标位置。
2. 生成迁移计划，并明确说明一共分为几部分或几步。
3. 按 scope 拆分迁移计划：用户级、项目共享级、项目本地级、已知项目 memory。
4. 对每个部分标注适配性：适合迁移、不适合迁移、需要手动转换、已经兼容，并说明理由。
5. 列出可迁移项、需要确认项、冲突项、只报告项、不支持项、未知字段和空值跳过项。
6. 对高风险资源单独要求确认：permissions、hooks、MCP secrets/env/headers、插件/marketplace、所有冲突。
7. 对冲突和待确认项生成 diff，让用户先看差异。
8. 只执行用户批准的迁移项；如果用户授权自动合并，使用 approvals 文件执行。
9. 输出最终迁移报告。

迁移计划不会只问“是否全部迁移”。它必须先让用户看到完整计划，并让用户能逐部分确认；未确认的部分不会执行。例如：

- Part 1: Memory / instructions
- Part 2: MCP servers
- Part 3: Settings and permissions
- Part 4: Hooks
- Part 5: Skills
- Part 6: Agents
- Part 7: Commands and output styles
- Part 8: Plugins and marketplaces
- Part 9: Known-project memories, only when requested

## 能力边界

这个 skill 能做：

- 发现 Claude Code 配置来源和 Codex 目标位置。
- 规划 `CLAUDE.md` 到 `AGENTS.md` 的迁移。
- 规划用户级、项目级、项目本地级 memory 的迁移。
- 可选扫描 `~/.claude.json` 中所有已知项目的 `CLAUDE.md` / `CLAUDE.local.md`。
- 对冲突文件和待确认项目生成 redacted diff。
- 在用户授权后，对支持的低风险项自动合并，并在写入前备份目标文件。
- 识别 MCP server 冲突和敏感字段。
- 识别 hooks、permissions、plugins 等高风险资源。
- 对已存在目标文件给出跳过、追加、并列副本、手动合并等选择。

这个 skill 不会自动做：

- 不迁移 auth/session/OAuth tokens。
- 不迁移 managed settings、remote settings、trust caches、runtime caches。
- 不静默覆盖任何 Codex 文件。
- 不把 Claude JSON settings 直接粘贴进 Codex TOML。
- 不把 Claude slash commands 假装成 Codex 原生 slash commands。
- 不把 Claude agents 假装成 Codex agent schema；需要转换或确认。
- 不自动合并 `~/.codex/config.toml`、hooks、agents、commands、plugins、auth/session/cache/keybindings 等高风险或非等价内容。
- 不自动安装 plugins 或 marketplaces。
- 不假定 Claude 模型名、provider、auth 环境变量在 Codex 中可用。

## 原理

`scripts/inspect-migration.mjs` 是确定性的只读扫描器。它读取常见 Claude Code 源文件，并和常见 Codex 目标位置做对比。

主要映射规则在 `references/mapping.md`：

- `~/.claude/CLAUDE.md` -> `~/.codex/AGENTS.md`
- `<project>/CLAUDE.md` -> `<project>/AGENTS.md`
- `<project>/CLAUDE.local.md` -> `<project>/AGENTS.local.md`
- Claude MCP -> Codex `~/.codex/config.toml` 或项目 `.mcp.json`
- Claude hooks -> Codex `~/.codex/hooks.json`
- Claude skills -> Codex `~/.codex/skills/`，前提是格式兼容或已转换

扫描器不会写文件、不会安装插件、不会访问网络。它只输出计划，让 Codex 和用户基于计划继续决策。

`scripts/resolve-migration.mjs` 负责对比和授权后的合并：

- `diff` 模式只读，输出 source / target / suitability / recommended action / risk / reason / diff。
- `diff --format json` 输出对象中只支持 `entries` 作为数组字段。
- `apply` 模式需要 approvals 文件，只执行 `approved: true` 的条目。
- 支持的动作是 `copy`、`append`、`side-by-side`、`structured-json-merge`、`skip`。
- 修改已有目标前会创建备份，默认在 `.codex-migration-backups/`。
- diff 输出会尽量隐藏 token、authorization、password、secret、API key 等敏感值。

approvals 文件示例：

```json
{
  "approvals": [
    {
      "source": "/path/to/CLAUDE.md",
      "target": "/path/to/AGENTS.md",
      "action": "append",
      "approved": true
    }
  ]
}
```

## 预期效果

运行后，你会得到一份迁移检查报告，通常包含：

- 这次迁移一共分几部分或几步。
- 发现了哪些 Claude Code 源配置。
- 哪些内容已经在 Codex 兼容位置。
- 哪些内容可以低风险复制。
- 哪些内容需要确认或手动转换。
- 哪些内容不适合迁移，以及为什么。
- 哪些目标文件已经存在冲突。
- 哪些字段未知、不支持或只适合报告。
- 如果请求全项目 memory 扫描，会列出已知项目中的 `CLAUDE.md` / `CLAUDE.local.md` 迁移计划。

这个报告的目标不是“一键盲迁”，而是让迁移过程可审计、可回滚、风险可见。

## 验证

可以运行 inspector 的帮助命令：

```bash
node scripts/inspect-migration.mjs --help
```

也可以在任意项目上做只读检查：

```bash
node scripts/inspect-migration.mjs --project /path/to/project
```

如需验证全项目 memory 扫描：

```bash
node scripts/inspect-migration.mjs --project /path/to/project --include-known-project-memories
```

如需验证 diff 能力：

```bash
node scripts/inspect-migration.mjs --project /path/to/project --format json > plan.json
node scripts/resolve-migration.mjs diff --plan plan.json
```
