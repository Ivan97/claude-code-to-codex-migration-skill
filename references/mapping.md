# Claude Code to Codex Migration Mapping

This file is the migration contract. Fields not listed here are unknown by default: report them, do not automatically migrate them.

## Target Model

Common Codex targets:

| Scope | Target |
|---|---|
| User instructions | `~/.codex/AGENTS.md` |
| Project shared instructions | `<project>/AGENTS.md` |
| Project local instructions | `<project>/AGENTS.local.md` when supported by local convention; otherwise report and ask |
| User config, MCP, models, projects, plugins/marketplaces | `~/.codex/config.toml` |
| Hooks | `~/.codex/hooks.json` |
| User skills | `~/.codex/skills/` |
| User agents | `~/.codex/agents/` |
| Project-local copied commands/skills/agents/output styles | `<project>/.codex/<type>/` as a migration staging target; verify discovery before relying on it |
| Project MCP | `<project>/.mcp.json` when already present; otherwise prefer user-confirmed Codex MCP configuration |

## Source Model

Common Claude Code sources:

| Source | Meaning |
|---|---|
| `~/.claude/settings.json` | User settings |
| `~/.claude.json` | User/project state, MCP, auth/session/cache state |
| `<project>/.claude/settings.json` | Project shared settings |
| `<project>/.claude/settings.local.json` | Project local settings |
| `<project>/.mcp.json` | Project MCP, already in a common compatible location |
| `~/.claude/commands/`, `<project>/.claude/commands/` | Slash commands |
| `~/.claude/skills/`, `<project>/.claude/skills/` | Skills |
| `~/.claude/agents/`, `<project>/.claude/agents/` | Agents |
| `~/.claude/output-styles/`, `<project>/.claude/output-styles/` | Output styles |
| `~/.claude/CLAUDE.md`, `<project>/CLAUDE.md` | Memory / instructions |
| `<project>/CLAUDE.local.md` | Project local memory / instructions |
| `~/.claude.json#projects[*]` | Known project paths used to discover each project's `CLAUDE.md` / `CLAUDE.local.md` when full-project memory scanning is requested |
| `~/.claude/keybindings.json` | Keybindings, not directly compatible |

## Scope Confirmation Rules

Migration plans and confirmations must be separated by scope:

- User-level: usually `~/.claude/**` or top-level `~/.claude.json`; target usually `~/.codex/**`.
- Project-shared: usually `<project>/.claude/settings.json`, `<project>/.claude/**`, or `<project>/CLAUDE.md`; target usually `<project>/AGENTS.md`, `<project>/.mcp.json`, or a clearly marked project `.codex/` staging path.
- Project-local: usually `<project>/.claude/settings.local.json`, `<project>/CLAUDE.local.md`, or `~/.claude.json#projects[project]`; target depends on local Codex support and must be confirmed.
- All known projects: only scan when the user asks for every project's memory or the inspector is run with `--include-known-project-memories`.

Confirmation must list resource type, source path, target path, and conflicts for each scope. Do not replace this with a vague "migrate all" confirmation.

## Migration Plan Requirements

Every migration plan must be numbered and explicit:

- State the total number of parts or steps.
- Give each part a name and scope.
- List source path, target path, proposed action, and required confirmation.
- Classify each part as `suitable`, `not suitable`, `requires manual conversion`, or `already compatible`.
- Explain the reason for that classification.
- Put all report-only, unsupported, unknown, empty, risky, or skipped items in a separate section with reasons.
- Ask the user to approve specific part numbers or resource groups before writing anything.

Recommended high-level parts:

1. Memory / instructions.
2. MCP servers.
3. Settings and permissions.
4. Hooks.
5. Skills.
6. Agents.
7. Commands and output styles.
8. Plugins and marketplaces.
9. Known-project memories, only when requested.

## Conflict Comparison and Approved Merge

Conflicts and confirmation-required items must go through a compare step before writing:

```bash
node <skill-dir>/scripts/resolve-migration.mjs diff --plan <plan.json>
```

The comparison must include source, target, suitability, recommended action, risk, reason, and a redacted diff when possible. Secrets in `env`, `headers`, authorization values, tokens, passwords, and API keys must not be printed in full.

Automatic merge is allowed only after the user approves explicit items through an approvals file:

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

Supported apply actions:

| Action | Use for | Notes |
|---|---|---|
| `copy` | Target does not exist | Fails if target already exists. |
| `append` | `CLAUDE.md` / `CLAUDE.local.md` into `AGENTS.md` / `AGENTS.local.md` | Adds a `migrated-from-claude-code` marker. |
| `side-by-side` | Existing target with uncertain schema | Writes a `.claude-migrated` sibling file. |
| `structured-json-merge` | JSON object files only | Adds non-conflicting keys; fails on conflicting values. |
| `skip` | Approved no-op | Records the skip in apply output. |

Do not automatically merge:

- `~/.codex/config.toml`; generate a patch or manual instructions instead.
- `~/.codex/hooks.json` unless each hook is explicitly approved and reviewed.
- Claude agents into Codex agents without schema conversion.
- Claude slash commands into Codex commands; convert them into skills or instructions.
- Plugins, marketplaces, auth, session, cache, keybindings, unknown state, or model/provider settings.

Before changing an existing target, the resolver must create a backup under `.codex-migration-backups/` unless the caller provides a backup directory.

## MCP

Recommended handling:

| Source | Target | Decision |
|---|---|---|
| `<project>/.mcp.json` | Same file | Do not copy. Validate and report as compatible-in-place when it has `mcpServers`. |
| `~/.claude.json` top-level `mcpServers` | `~/.codex/config.toml` `[mcp_servers.<name>]` | Confirm before converting JSON shape to TOML. |
| `~/.claude.json#projects[project].mcpServers` | Usually `~/.codex/config.toml`; project-local support varies | Confirm and explain scope implications. |
| `<project>/.claude/settings.json` `mcpServers` | Prefer `<project>/.mcp.json` when no file exists; otherwise confirm merge | Do not overwrite same-name servers. |
| `<project>/.claude/settings.local.json` `mcpServers` | Usually report or convert to user Codex config after confirmation | Project-local MCP parity varies. |

Supported Claude MCP server fields to preserve when converting:

`command`, `args`, `env`, `cwd`, `url`, `headers`, `tcp`, `type`, `timeout`, `trust`, `description`, `includeTools`, `excludeTools`, `extension`, `oauth`, `disabled`, `headersHelper`, `alwaysAllow`.

Rules:

- Preserve supported fields unless a Codex TOML conversion requires syntax changes.
- Treat `env`, `headers`, and `headersHelper` as sensitive. Show key names and target location, not full secret values, unless the user asks.
- If the target already has a same-name server, stop and ask: keep target, replace target, rename source server, or skip.
- Report unsupported fields with source path and server name.
- Do not migrate OAuth tokens, approval state, or connection state.

## Settings

| Field | Migration strategy |
|---|---|
| `permissions.allow`, `permissions.deny`, `permissions.ask` | Confirm. Codex permission and sandbox behavior is not one-to-one with Claude Code. |
| `permissions.additionalDirectories`, `permissions.trustDirectories` | Confirm. These expand trust or filesystem access. |
| `hooks` | Confirm separately. Target is usually `~/.codex/hooks.json`; hooks execute commands and are high risk. |
| `outputStyle` | Report/confirm only. Active output-style support may differ. |
| `enabledPlugins`, `extraKnownMarketplaces` | Generate a plugin/marketplace plan. Do not copy plugin state or run install steps automatically. |
| `mcpServers` | Handle by MCP rules. |
| `env` | Report only. There is no guaranteed equivalent top-level Codex env injection field. |
| `model`, `fallbackModel`, provider/auth/model fields | Report only. Model/provider/auth semantics differ. |
| managed or policy fields | Do not migrate; report only. |
| Empty objects, empty arrays, `null` | Skip and list as empty skipped. |
| Unknown fields | Report only. |

## Hooks

Allowed automatic variable replacement:

| Claude token | Codex token |
|---|---|
| `$CLAUDE_PROJECT_DIR` | `$CODEX_PROJECT_DIR` |

Rules:

- Show hook event name, matcher, command/prompt, target file, and diff before writing.
- Only replace the token above automatically. Keep other variables, command names, matcher, timeout, type, event name, and hook order unchanged.
- If a hook contains other `CLAUDE_*` tokens, calls `claude`, reads Claude state files, or depends on Claude-only plugin paths, report it instead of migrating unless the user approves an explicit edit.
- If `~/.codex/hooks.json` already exists, ask whether to append, replace, or skip.

## Memory / Instructions

| Source | Target | Default behavior |
|---|---|---|
| `~/.claude/CLAUDE.md` | `~/.codex/AGENTS.md` | Copy if target does not exist; ask if it exists. |
| `<project>/CLAUDE.md` | `<project>/AGENTS.md` | Copy if target does not exist; ask if it exists. |
| `<project>/CLAUDE.local.md` | `<project>/AGENTS.local.md` | Copy only after confirming local convention. |
| `~/.claude.json#projects[*]` discovered `CLAUDE.md` | `<known-project>/AGENTS.md` | Inspect only when full-project memory scanning is requested. |
| `~/.claude.json#projects[*]` discovered `CLAUDE.local.md` | `<known-project>/AGENTS.local.md` | Inspect only when full-project memory scanning is requested; copy only after confirming local convention. |

When the target exists, never overwrite. Offer skip, append, side-by-side copy, or manual merge.

## Commands, Skills, Agents, Output Styles

- User skills can copy to `~/.codex/skills/` when the source is already a Codex-compatible skill folder or after conversion.
- User agents can copy/adapt to `~/.codex/agents/` when TOML/schema compatibility is verified.
- Claude slash commands do not have direct Codex slash-command parity; migrate them into Codex skills or instruction sections.
- Project-level commands, skills, agents, and output styles may be staged under `<project>/.codex/<type>/`, but verify whether the current Codex environment discovers them before claiming they are active.
- Preserve relative paths and never overwrite existing files.

If commands, skills, agents, hooks, plugins, or output styles contain Claude model names, provider names, auth variables, or `CLAUDE_*` paths, report those locations and require Codex-specific edits.

## Keybindings

Do not migrate. Claude Code keybindings and Codex keybindings are not directly compatible. Report the source file and recommend manual remapping if needed.

## Plugins

Default behavior is detect and report. Do not copy plugin cache/state files, `installed_plugins`, marketplace state, or plugin cache.

When the user approves plugin migration:

- Use the current Codex plugin installation path available in the environment.
- Prefer `tool_search` or app/plugin install tools when available.
- Do not invent CLI commands if the current Codex CLI does not expose them.
- Treat marketplace add/install as high risk because it may download or run third-party code.

Report these risks:

- Claude plugin contribution points may not exist in Codex.
- Plugin commands/hooks/skills may hard-code `CLAUDE_*` variables or Claude-specific paths.
- Dependencies may be unavailable or blocked by local policy.

## Never Automatically Migrate

- Auth/session tokens
- OAuth state
- Managed settings and remote settings
- Trust caches and project approval choices
- Runtime caches
- Unknown per-project state from `~/.claude.json`
- Keybindings
- Top-level `env`
- Claude model names, provider names, auth fields, or model environment variables
- Unsupported or unknown fields
