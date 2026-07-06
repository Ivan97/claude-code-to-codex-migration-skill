---
name: claude-code-to-codex-migration
description: Safely inspect, plan, and assist migration from Claude Code to Codex. Use when the user asks to migrate Claude Code settings, MCP servers, slash commands, skills, agents, hooks, memory/instruction files, output styles, permissions, or plugins into Codex AGENTS.md, ~/.codex/config.toml, ~/.codex/hooks.json, ~/.codex/skills, ~/.codex/agents, or project-local Codex files.
---

# Claude Code to Codex Migration

Use only for Claude Code -> Codex migration. The first priority is protecting the user's existing environment: copy only, never move; do not delete source files; do not silently overwrite Codex files.

## Non-Negotiable Rules

- Start with a read-only inspection. Do not write files or run install commands before presenting a migration plan.
- Default to the current working directory as the project context. If `~/.claude.json` has multiple matching project entries, ask the user to choose.
- Require confirmation before any write. Confirm high-risk resources separately: permissions, hooks, MCP secrets/env/headers, plugin or marketplace changes, and all conflicts.
- Explain the plan by scope: user-level, project-shared, and project-local. List what migrates, what is skipped, where it goes, and any conflicts.
- The migration plan must explicitly say how many parts or steps it contains. For each part, state whether it is suitable to migrate, not suitable to migrate, or requires manual conversion, and include the reason.
- Never migrate auth state, OAuth/session files, managed settings, remote settings, trust caches, approval state, runtime caches, or unknown state/cache files.
- Only write targets listed in `references/mapping.md`. Report unknown, unsupported, invalid, and empty fields unless the mapping gives an explicit migration rule.
- Generate a final migration report whether or not files were written.

## Workflow

1. Run the read-only inspector:

```bash
node <skill-dir>/scripts/inspect-migration.mjs --project "$PWD"
```

Use `--format json` when machine-readable output is useful. When the user asks to include memory from every known Claude Code project, add `--include-known-project-memories`; this scans `~/.claude.json` project paths for `CLAUDE.md` and `CLAUDE.local.md` and plans matching `AGENTS.md` targets without writing files. If Node.js is unavailable, do not skip inspection; manually inspect the source and target files listed in `references/mapping.md`, then produce the same migration-plan categories.

2. Before interpreting the inspector output or editing files, read `references/mapping.md` and follow its scope rules, field mappings, and known gaps.

3. Present a migration plan containing:

- Total number of migration parts or steps.
- A numbered section for each part.
- Source files found.
- Target files that would be touched.
- User-level, project-shared, and project-local resources to migrate or skip.
- Known-project memory files when `--include-known-project-memories` was requested.
- Suitability for each resource group: suitable to migrate, not suitable to migrate, or requires manual conversion.
- Reasons for every skipped, report-only, unsupported, unknown, risky, or manual-conversion item.
- Resources already in Codex-compatible locations.
- Recommended project and target paths.
- Conflicts and choices.
- Report-only, unsupported, unknown, and empty fields.
- Plugin or marketplace candidates without executing installation.
- Hook event names, matchers, commands/prompts, target file, and allowed variable replacements.

4. Ask for confirmation. Low-risk copy-only items can be grouped by scope. High-risk resources require separate confirmation. Do not ask only "migrate everything"; show the source, target, scope, and resource type.

5. For conflicts or any item needing confirmation, generate a comparison before asking the user to approve writes:

```bash
node <skill-dir>/scripts/resolve-migration.mjs diff --plan <plan.json>
```

Use `--format json` when a structured diff is easier to process. The diff must be shown before applying any merge.
JSON diff output uses `{ "entries": [...] }` and also includes `{ "items": [...] }` as a compatibility alias. Prefer `entries` in new automation.

## Migration Plan Format

Use this structure when presenting the plan:

```markdown
## Migration Plan

This migration is divided into <N> parts.

### Part 1: <name>
- Scope: <user-level | project-shared | project-local | known-project memory>
- Source: `<path or source description>`
- Target: `<path or target description>`
- Suitability: <suitable | not suitable | requires manual conversion | already compatible>
- Reason: <why this classification is correct>
- Proposed action: <copy | convert | report only | skip | ask user to choose>
- Risk/confirmation: <none | requires confirmation | high-risk separate confirmation>

### Part 2: <name>
...

## Items Not Suitable For Migration
- `<source>`: <reason>

## Confirmation Request
- Confirm each approved part by number. Do not proceed on unconfirmed parts.
```

6. Execute only approved items. If the user authorizes automatic merge, create an approval file and run:

```bash
node <skill-dir>/scripts/resolve-migration.mjs apply --plan <plan.json> --approvals <approvals.json>
```

- Copy files/directories; never move.
- Do not overwrite existing targets. On conflicts, ask whether to skip, append, rename the copy, or manually merge.
- Use automatic merge only for supported actions: `copy`, `append`, `side-by-side`, and `structured-json-merge`.
- Create backups before changing existing targets. The resolver writes backups under `.codex-migration-backups/` by default.
- Project MCP in `<project>/.mcp.json` is already in a common compatible location; validate and report it rather than copying it.
- Codex MCP configuration commonly lives in `~/.codex/config.toml` under `[mcp_servers.<name>]`; do not blindly paste Claude JSON into TOML.
- Codex hooks commonly live in `~/.codex/hooks.json`; migrate only after explicit risk confirmation.
- Plugins and marketplaces are report-only unless the current Codex environment exposes a verified install flow.

7. Output a final report containing:

- Migrated items.
- Skipped items and reasons.
- Conflicts and user choices.
- Unsupported or unknown fields.
- Report-only items.
- Plugin or marketplace candidates.
- New files or backup files.
- Recommended manual follow-up.
- Reminder: if migrated skills, agents, hooks, commands, plugins, or output styles hard-code Claude model names, provider names, auth variables, or `CLAUDE_*` paths, adjust them for Codex before relying on them.

## Resources

- `references/mapping.md`: The migration contract. Read before explaining a plan or modifying files.
- `scripts/inspect-migration.mjs`: Deterministic read-only scanner. It must not write files, install plugins, or access the network.
- `scripts/resolve-migration.mjs`: Diff and approved-merge helper. It can write files only in `apply` mode with an explicit approvals file.
