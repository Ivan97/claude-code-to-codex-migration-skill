# Claude Code 到 Codex 迁移 Skill

这个仓库提供一个 Codex skill，用来安全检查、规划并协助把 Claude Code 的配置迁移到 Codex。

它的核心原则是：先检查、先出计划、先让用户确认，然后才执行任何写入。默认只复制，不移动；不删除 Claude Code 源文件；不静默覆盖已有 Codex 配置。

## 适用场景

当你想把下面这些 Claude Code 配置迁移到 Codex 时使用这个 skill：

- 用户级和项目级 instructions / memory：`CLAUDE.md`、`CLAUDE.local.md`
- Claude Code 项目 memory：`~/.claude/projects/<encoded-project>/memory/*.md`
- Claude Code settings：`~/.claude/settings.json`、`<project>/.claude/settings.json`
- MCP servers：`~/.claude.json`、`.mcp.json`、settings 中的 `mcpServers`
- Slash commands：`.claude/commands/`
- Skills：`.claude/skills/`
- Agents：`.claude/agents/`
- Hooks、permissions、output styles、plugins / marketplaces
- `~/.claude.json#projects[*]` 中记录过的多个项目 memory，包括对应的 `.claude/projects/.../memory/*.md`

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
使用 claude-code-to-codex-migration，检查所有已知 Claude Code 项目的 CLAUDE.md / CLAUDE.local.md 和 .claude/projects project memory，并规划迁移到 Codex。
```

skill 会优先运行只读 inspector：

```bash
node <skill-dir>/scripts/inspect-migration.mjs --project "$PWD"
```

需要机器可读结果时：

```bash
node <skill-dir>/scripts/inspect-migration.mjs --project "$PWD" --format json
```

需要扫描 `~/.claude.json#projects[*]` 中所有已知项目 memory 和对应的 `~/.claude/projects/<encoded-project>/memory/*.md` 时：

```bash
node <skill-dir>/scripts/inspect-migration.mjs --project "$PWD" --include-known-project-memories
```

当迁移计划里有更新、明确冲突或待确认项时，可以生成对比：

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
5. 列出可迁移项、更新项、需要确认项、明确冲突项、只报告项、不支持项、未知字段和空值跳过项。
6. 对高风险资源单独要求确认：permissions、hooks、MCP secrets/env/headers、插件/marketplace、所有更新候选和所有明确冲突。
7. 对更新、明确冲突和待确认项生成 diff，让用户先看差异。
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

## 变化类型定义

- 新增：目标不存在，迁移会创建新文件、目录、server、字段或条目。新增不是冲突。
- 更新：目标或相关信息已存在，迁移可能追加、合并、替换、重命名或改变它。如果无法明确识别冲突，统一描述为更新。
- 删除：源不存在、不可访问，或用户批准跳过后保持不迁移。skill 不会自动删除 Claude Code 源文件。
- 冲突：新信息与已有信息或元信息明确不一致、对立，或者同一语义位置存在不同取值，必须选择其一才能继续。

仅仅“目标文件已存在”“同名 MCP server 已存在”“同路径文件已存在”不等于冲突；这些默认是更新候选，需要对比和用户确认。

## 统计字段说明

inspector 输出里的数字单位是迁移计划条目，不一定是文件数、最终步骤数，也不一定互斥。一个资源可能同时出现在多个分类里，例如已有目标的 memory 既是 `updates`，也需要用户确认，所以也会出现在 `needsDecision`。

- `migratable`：目标不存在，通常可低风险复制或创建的条目。
- `updates`：目标或相关信息已存在，可能需要追加、合并、替换、重命名或改变的条目。
- `needsDecision`：需要用户确认的条目，包括更新、高风险资源、敏感字段、本地作用域选择和非等价转换。
- `conflicts`：当前 inspector 已明确证明存在同一语义或元信息位置不一致、对立或取值不同的条目。
- `reportOnly`：只报告、不自动迁移的条目。
- `unsupported`：已知不支持的结构或字段。
- `unknown`：迁移协议未覆盖、意义未知的字段。
- `emptySkipped`：按策略跳过的空对象、空数组或 null。
- `pluginPlan`：插件或 marketplace 候选计划条目，不代表已经安装。

复核说明：这些统计字段都是 agent 基于当前迁移协议和可读取文件生成的分类结果，用于辅助决策，不是权威结论。它们可能不完整、偏保守，或者与项目维护者基于业务经验和上下文知识作出的判断不同。执行写入前，应结合迁移计划和 resolver diff 仔细核对每一类条目，尤其是 memory 文本、hooks、permissions、MCP servers、settings 和插件相关内容。

迁移流程本身按可审计、可恢复设计：inspect 和 diff 阶段只读，Claude Code 源文件不会被移动或删除；对已有目标执行授权写入时，默认会在 `.codex-migration-backups/` 下保留历史快照。即使某个条目的分类不完全符合人工判断，原始信息仍会保留下来，可继续对比、回滚或手动合并。

## 能力边界

这个 skill 能做：

- 发现 Claude Code 配置来源和 Codex 目标位置。
- 规划 `CLAUDE.md` 到 `AGENTS.md` 的迁移。
- 规划用户级、项目级、项目本地级 memory 的迁移。
- 默认扫描当前项目的 `~/.claude/projects/<encoded-project>/memory/*.md`。
- 可选扫描 `~/.claude.json` 中所有已知项目的 `CLAUDE.md` / `CLAUDE.local.md` 和 Claude project memory。
- 对更新、明确冲突和待确认项目生成 redacted diff。
- 在用户授权后，对支持的低风险项自动合并，并在写入前备份目标文件。
- 识别 MCP server 更新候选、明确冲突和敏感字段。
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
- `~/.claude/projects/<encoded-project>/memory/*.md` -> `<project>/AGENTS.md`
- Claude MCP -> Codex `~/.codex/config.toml` 或项目 `.mcp.json`
- Claude hooks -> Codex `~/.codex/hooks.json`
- Claude skills -> Codex `~/.codex/skills/`，前提是格式兼容或已转换

扫描器不会写文件、不会安装插件、不会访问网络。它只输出计划，让 Codex 和用户基于计划继续决策。

`scripts/resolve-migration.mjs` 负责对比和授权后的合并：

- `diff` 模式只读，输出 source / target / change type / suitability / recommended action / risk / reason / diff。
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
- 哪些目标已有内容需要更新或合并。
- 哪些项目存在明确冲突，以及冲突理由。
- 哪些字段未知、不支持或只适合报告。
- 如果请求全项目 memory 扫描，会列出已知项目中的 `CLAUDE.md` / `CLAUDE.local.md` 和 `.claude/projects/.../memory/*.md` 迁移计划。

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
