#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function usage() {
  console.log(`Usage:
  resolve-migration.mjs diff --plan plan.json [--format markdown|json]
  resolve-migration.mjs apply --plan plan.json --approvals approvals.json [--backup-dir DIR]

Approval file shape:
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

Supported apply actions: copy, append, side-by-side, structured-json-merge, skip.
`);
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    process.exit(0);
  }
  const opts = {
    command: argv[0],
    format: 'markdown',
  };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--plan') opts.plan = argv[++i];
    else if (arg === '--approvals') opts.approvals = argv[++i];
    else if (arg === '--backup-dir') opts.backupDir = argv[++i];
    else if (arg === '--format') opts.format = argv[++i];
    else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!['diff', 'apply'].includes(opts.command)) {
    throw new Error('First argument must be diff or apply');
  }
  if (!opts.plan) throw new Error('--plan is required');
  if (opts.command === 'apply' && !opts.approvals) {
    throw new Error('--approvals is required for apply');
  }
  if (!['markdown', 'json'].includes(opts.format)) {
    throw new Error('--format must be markdown or json');
  }
  return opts;
}

function readJson(file) {
  const resolved = expandHome(file);
  let raw;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read JSON file ${resolved}: ${error.message}`);
  }
  if (!raw.trim()) {
    throw new Error(`JSON file is empty: ${resolved}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${resolved}: ${error.message}`);
  }
}

function expandHome(value) {
  if (!value || typeof value !== 'string') return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function exists(file) {
  try {
    return fs.existsSync(expandHome(file));
  } catch {
    return false;
  }
}

function isFile(file) {
  try {
    return fs.statSync(expandHome(file)).isFile();
  } catch {
    return false;
  }
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function planItems(plan) {
  const items = [];
  for (const section of ['conflicts', 'needsDecision', 'migratable']) {
    for (const item of plan[section] || []) {
      if (!item.source || !item.target) continue;
      items.push({ ...item, section });
    }
  }
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.source}\n${item.target}\n${item.label || item.server || item.path || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classify(item) {
  const source = expandHome(item.source);
  const target = expandHome(item.target);
  const label = item.label || item.server || item.path || path.basename(source);
  const sourceExists = exists(source);
  const targetExists = exists(target);
  const sourceFile = isFile(source);
  const targetFile = isFile(target);

  if (!sourceExists) {
    return {
      ...item,
      source,
      target,
      label,
      diffKind: 'missing-source',
      suitable: 'not suitable',
      recommendedAction: 'skip',
      reason: 'Source does not exist or is not accessible.',
    };
  }

  if (item.section === 'migratable' && !targetExists) {
    return {
      ...item,
      source,
      target,
      label,
      diffKind: sourceFile ? 'new-file' : 'new-directory',
      suitable: 'suitable',
      recommendedAction: 'copy',
      reason: 'Target does not exist and the inspector classified this item as migratable.',
    };
  }

  if (sourceFile && targetFile && isMemoryFile(source, target)) {
    return {
      ...item,
      source,
      target,
      label,
      diffKind: 'text-file',
      suitable: 'suitable',
      recommendedAction: 'append',
      reason: 'Instruction memory files can be appended with a migration marker after user confirmation.',
    };
  }

  if (sourceFile && targetFile && source.endsWith('.json') && target.endsWith('.json')) {
    return {
      ...item,
      source,
      target,
      label,
      diffKind: 'json-file',
      suitable: 'requires manual conversion',
      recommendedAction: 'structured-json-merge',
      reason: 'Both files are JSON; a structured merge can preserve target keys and add non-conflicting source keys.',
    };
  }

  if (sourceFile && targetFile) {
    return {
      ...item,
      source,
      target,
      label,
      diffKind: 'text-file',
      suitable: 'requires manual conversion',
      recommendedAction: 'side-by-side',
      reason: 'Both files exist. A side-by-side copy is safer unless the user approves a specific merge.',
    };
  }

  return {
    ...item,
    source,
    target,
    label,
    diffKind: 'path',
    suitable: 'requires manual conversion',
    recommendedAction: 'side-by-side',
    reason: 'Path types or schemas are not safely mergeable without user review.',
  };
}

function isMemoryFile(source, target) {
  const s = path.basename(source);
  const t = path.basename(target);
  return (s === 'CLAUDE.md' || s === 'CLAUDE.local.md') &&
    (t === 'AGENTS.md' || t === 'AGENTS.local.md');
}

function makeDiff(item) {
  if (!isFile(item.source)) return 'Source is not a regular file; no textual diff available.';
  if (!exists(item.target)) {
    const text = fs.readFileSync(item.source, 'utf8');
    return text.split('\n').slice(0, 80).map((line) => `+${line}`).join('\n');
  }
  if (!isFile(item.target)) return 'Target is not a regular file; no textual diff available.';

  const result = spawnSync('git', ['diff', '--no-index', '--', item.target, item.source], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });
  const diff = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (diff) return redactSecrets(diff);
  return 'No textual diff.';
}

function redactSecrets(text) {
  return text
    .replace(/("?(?:token|api[_-]?key|authorization|secret|password)"?\s*[:=]\s*)"[^"\n]+"/gi, '$1"<redacted>"')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1<redacted>');
}

function buildDiff(plan) {
  return planItems(plan).map((item) => {
    const classified = classify(item);
    return {
      label: classified.label,
      section: classified.section,
      source: classified.source,
      target: classified.target,
      suitability: classified.suitable,
      recommendedAction: classified.recommendedAction,
      reason: classified.reason,
      risk: riskFor(classified),
      diff: makeDiff(classified),
    };
  });
}

function riskFor(item) {
  const text = `${item.label || ''} ${item.source || ''} ${item.target || ''} ${item.path || ''}`.toLowerCase();
  if (text.includes('hook') || text.includes('permission') || text.includes('headers') || text.includes('env')) {
    return 'high';
  }
  if (item.section === 'conflicts' || item.section === 'needsDecision') return 'medium';
  return 'low';
}

function renderMarkdown(entries) {
  const lines = ['# Migration Diff', ''];
  lines.push(`This diff contains ${entries.length} item(s).`);
  lines.push('');
  entries.forEach((entry, index) => {
    lines.push(`## Item ${index + 1}: ${entry.label}`);
    lines.push(`- Source: \`${entry.source}\``);
    lines.push(`- Target: \`${entry.target}\``);
    lines.push(`- Suitability: ${entry.suitability}`);
    lines.push(`- Recommended action: ${entry.recommendedAction}`);
    lines.push(`- Risk: ${entry.risk}`);
    lines.push(`- Reason: ${entry.reason}`);
    lines.push('');
    lines.push('```diff');
    lines.push(entry.diff);
    lines.push('```');
    lines.push('');
  });
  return lines.join('\n');
}

function approvalKey(source, target) {
  return `${expandHome(source)}\n${expandHome(target)}`;
}

function loadApprovals(file) {
  const raw = readJson(file);
  const approvals = new Map();
  for (const item of raw.approvals || []) {
    if (!item.approved) continue;
    approvals.set(approvalKey(item.source, item.target), item);
  }
  return approvals;
}

function backupPathFor(file, backupRoot) {
  const abs = path.resolve(expandHome(file));
  const rel = abs.replace(/^\/+/, '');
  return path.join(backupRoot, rel);
}

function backupExisting(file, backupRoot) {
  const target = expandHome(file);
  if (!exists(target)) return null;
  const backup = backupPathFor(target, backupRoot);
  mkdirp(path.dirname(backup));
  fs.cpSync(target, backup, { recursive: true, force: false });
  return backup;
}

function atomicWrite(file, content) {
  const target = expandHome(file);
  mkdirp(path.dirname(target));
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, target);
}

function copyRecursive(source, target) {
  mkdirp(path.dirname(target));
  fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
}

function appendMemory(source, target) {
  const sourceText = fs.readFileSync(source, 'utf8').trimEnd();
  const targetText = exists(target) ? fs.readFileSync(target, 'utf8').trimEnd() : '';
  const marker = `\n\n<!-- migrated-from-claude-code:start source=${source} -->\n${sourceText}\n<!-- migrated-from-claude-code:end -->\n`;
  atomicWrite(target, `${targetText}${marker}`);
}

function sideBySide(source, target) {
  const parsed = path.parse(target);
  const out = path.join(parsed.dir, `${parsed.name}.claude-migrated${parsed.ext}`);
  if (exists(out)) throw new Error(`Side-by-side target already exists: ${out}`);
  copyRecursive(source, out);
  return out;
}

function mergeJson(source, target) {
  const sourceJson = readJson(source);
  const targetJson = exists(target) ? readJson(target) : {};
  const conflicts = [];
  const merged = deepMerge(targetJson, sourceJson, conflicts, '');
  if (conflicts.length) {
    throw new Error(`JSON merge has conflicting keys: ${conflicts.join(', ')}`);
  }
  atomicWrite(target, `${JSON.stringify(merged, null, 2)}\n`);
}

function deepMerge(target, source, conflicts, prefix) {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    if (JSON.stringify(target) !== JSON.stringify(source)) conflicts.push(prefix || '<root>');
    return target;
  }
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (!(key in out)) {
      out[key] = value;
    } else if (isPlainObject(out[key]) && isPlainObject(value)) {
      out[key] = deepMerge(out[key], value, conflicts, next);
    } else if (JSON.stringify(out[key]) !== JSON.stringify(value)) {
      conflicts.push(next);
    }
  }
  return out;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function applyApproved(plan, approvalFile, backupDir) {
  const approvals = loadApprovals(approvalFile);
  const backupRoot = backupDir
    ? expandHome(backupDir)
    : path.join(process.cwd(), '.codex-migration-backups', new Date().toISOString().replace(/[:.]/g, '-'));
  const results = [];

  for (const rawItem of planItems(plan)) {
    const item = classify(rawItem);
    const approval = approvals.get(approvalKey(item.source, item.target));
    if (!approval) continue;
    const action = approval.action || item.recommendedAction;
    if (!['copy', 'append', 'side-by-side', 'structured-json-merge', 'skip'].includes(action)) {
      throw new Error(`Unsupported action for ${item.source}: ${action}`);
    }
    if (action === 'skip') {
      results.push({ source: item.source, target: item.target, action, status: 'skipped' });
      continue;
    }
    const backup = backupExisting(item.target, backupRoot);
    if (action === 'copy') copyRecursive(item.source, item.target);
    else if (action === 'append') appendMemory(item.source, item.target);
    else if (action === 'side-by-side') {
      const out = sideBySide(item.source, item.target);
      results.push({ source: item.source, target: out, originalTarget: item.target, action, backup, status: 'written' });
      continue;
    } else if (action === 'structured-json-merge') mergeJson(item.source, item.target);
    results.push({ source: item.source, target: item.target, action, backup, status: 'written' });
  }
  return { backupRoot, results };
}

try {
  const opts = parseArgs(process.argv.slice(2));
  const plan = readJson(opts.plan);
  if (opts.command === 'diff') {
    const entries = buildDiff(plan);
    if (opts.format === 'json') console.log(JSON.stringify({ entries }, null, 2));
    else process.stdout.write(renderMarkdown(entries));
  } else {
    const result = applyApproved(plan, opts.approvals, opts.backupDir);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
