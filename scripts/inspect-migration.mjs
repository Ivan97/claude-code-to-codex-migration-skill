#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MCP_FIELDS = new Set([
  'command',
  'args',
  'env',
  'cwd',
  'url',
  'headers',
  'tcp',
  'type',
  'timeout',
  'trust',
  'description',
  'includeTools',
  'excludeTools',
  'extension',
  'oauth',
  'disabled',
  'headersHelper',
  'alwaysAllow',
]);

const SETTINGS_HANDLED = new Set([
  '$schema',
  'mcpServers',
  'permissions',
  'hooks',
  'outputStyle',
  'enabledPlugins',
  'extraKnownMarketplaces',
  'env',
  'model',
  'fallbackModel',
]);

const IGNORED_DIR_ENTRIES = new Set(['.DS_Store', '.git', 'node_modules']);

function parseArgs(argv) {
  const opts = {
    project: process.cwd(),
    home: os.homedir(),
    format: 'markdown',
    includeKnownProjectMemories: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project') opts.project = argv[++i];
    else if (arg === '--home') opts.home = argv[++i];
    else if (arg === '--format') opts.format = argv[++i];
    else if (arg === '--include-known-project-memories') opts.includeKnownProjectMemories = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('用法: inspect-migration.mjs [--project PATH] [--home PATH] [--format markdown|json] [--include-known-project-memories]');
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  opts.project = path.resolve(opts.project);
  opts.home = path.resolve(opts.home);
  if (!['markdown', 'json'].includes(opts.format)) {
    throw new Error('--format 必须是 markdown 或 json');
  }
  return opts;
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function stripJsonComments(input) {
  let out = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function readJson(pathname) {
  if (!exists(pathname)) return { exists: false };
  try {
    const raw = fs.readFileSync(pathname, 'utf8');
    const parsed = JSON.parse(stripJsonComments(raw));
    return { exists: true, parsed, raw };
  } catch (error) {
    return { exists: true, error: error.message };
  }
}

function readMcpServersFromJsonFile(pathname) {
  const result = readJson(pathname);
  if (!result.exists) return { exists: false, servers: {} };
  if (result.error) return { exists: true, servers: {}, error: result.error };
  const mcpServers = result.parsed?.mcpServers;
  if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) {
    return { exists: true, servers: {} };
  }
  return { exists: true, servers: mcpServers };
}

function readCodexMcpServersFromToml(pathname) {
  if (!exists(pathname)) return { exists: false, servers: {} };
  try {
    const raw = fs.readFileSync(pathname, 'utf8');
    const servers = {};
    const re = /^\s*\[mcp_servers\.([^\]\s]+)\]\s*$/gm;
    let match;
    while ((match = re.exec(raw))) servers[match[1].replace(/^"|"$/g, '')] = true;
    return { exists: true, servers };
  } catch (error) {
    return { exists: true, servers: {}, error: error.message };
  }
}

function listFiles(dir) {
  if (!isDir(dir)) return [];
  const result = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const p = path.join(current, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) result.push(p);
    }
  };
  walk(dir);
  return result.sort();
}

function listTopLevelItems(dir) {
  if (!isDir(dir)) return [];
  const items = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIR_ENTRIES.has(entry.name)) continue;
    const itemPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      items.push({
        name: entry.name,
        path: itemPath,
        files: listFiles(itemPath),
        kind: 'directory',
      });
    } else if (entry.isFile()) {
      items.push({
        name: entry.name,
        path: itemPath,
        files: [itemPath],
        kind: 'file',
      });
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function projectEntryCandidates(project) {
  const candidates = new Set([project]);
  try {
    candidates.add(fs.realpathSync(project));
  } catch {
    // ignore
  }
  let current = project;
  while (current && current !== path.dirname(current)) {
    if (exists(path.join(current, '.git'))) candidates.add(current);
    current = path.dirname(current);
  }
  return [...candidates];
}

function normalizeProjectKeyForMatch(value) {
  let normalized = String(value).replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return normalized;
}

function projectKeyMatches(key, candidates) {
  const normalizedKey = normalizeProjectKeyForMatch(key);
  return candidates.some(
    (candidate) => normalizeProjectKeyForMatch(candidate) === normalizedKey,
  );
}

function codexHome(home) {
  if (process.env.CODEX_CONFIG_DIR) return path.resolve(process.env.CODEX_CONFIG_DIR);
  const base = process.env.CODEX_CLI_HOME ? path.resolve(process.env.CODEX_CLI_HOME) : home;
  return path.join(base, '.codex');
}

function claudeSettingsHome(home) {
  if (process.env.CLAUDE_CONFIG_DIR) return path.resolve(process.env.CLAUDE_CONFIG_DIR);
  return path.join(home, '.claude');
}

function claudeStatePath(home) {
  if (process.env.CLAUDE_CONFIG_DIR) return path.join(path.resolve(process.env.CLAUDE_CONFIG_DIR), '.claude.json');
  return path.join(home, '.claude.json');
}

function claudeProjectsHome(home) {
  return path.join(claudeSettingsHome(home), 'projects');
}

function encodeClaudeProjectPath(projectPath) {
  return normalizeProjectKeyForMatch(projectPath).replace(/\//g, '-');
}

function claudeProjectMemoryDir(home, projectPath) {
  return path.join(claudeProjectsHome(home), encodeClaudeProjectPath(projectPath), 'memory');
}

function add(plan, section, item) {
  plan[section].push(item);
}

function scopeLabel(scope) {
  return {
    user: '用户级',
    project: '项目级',
    local: '项目本地',
  }[scope] || scope;
}

function addTargetMcpFile(plan, index, label, pathname) {
  const result = readMcpServersFromJsonFile(pathname);
  if (!result.exists) return;
  if (result.error) {
    add(plan, 'unsupported', {
      source: pathname,
      path: 'mcpServers',
      reason: `目标 MCP 更新/冲突检查已跳过: ${result.error}`,
    });
    return;
  }
  if (!index[label]) index[label] = {};
  for (const name of Object.keys(result.servers)) {
    if (!index[label][name]) index[label][name] = [];
    index[label][name].push(pathname);
  }
}

function addTargetCodexMcpToml(plan, index, label, pathname) {
  const result = readCodexMcpServersFromToml(pathname);
  if (!result.exists) return;
  if (result.error) {
    add(plan, 'unsupported', {
      source: pathname,
      path: 'mcp_servers',
      reason: `目标 Codex MCP 更新/冲突检查已跳过: ${result.error}`,
    });
    return;
  }
  if (!index[label]) index[label] = {};
  for (const name of Object.keys(result.servers)) {
    if (!index[label][name]) index[label][name] = [];
    index[label][name].push(pathname);
  }
}

function buildTargetMcpIndex(plan, qHome, qProject, project) {
  const index = {};
  addTargetCodexMcpToml(plan, index, '~/.codex/config.toml', path.join(qHome, 'config.toml'));
  addTargetMcpFile(
    plan,
    index,
    '<project>/.mcp.json',
    path.join(project, '.mcp.json'),
  );
  return index;
}

function existingMcpTargets(targetMcpIndex, target, serverName) {
  return targetMcpIndex?.[target]?.[serverName] ?? [];
}

function summarizeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `数组(${value.length})`;
  if (typeof value === 'object') return `对象(${Object.keys(value).length})`;
  return {
    string: '字符串',
    number: '数字',
    boolean: '布尔值',
    bigint: 'bigint',
    undefined: 'undefined',
    symbol: 'symbol',
    function: 'function',
  }[typeof value] || typeof value;
}

function emptyValue(value) {
  if (value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function pluginScope(targetScope) {
  return targetScope === 'project' ? 'project' : targetScope === 'local' ? 'local' : 'user';
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function marketplaceCommandSource(value) {
  const source = value?.source && typeof value.source === 'object' ? value.source : value;
  if (typeof source === 'string') return source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  if (source.source === 'github' && typeof source.repo === 'string') {
    return source.ref ? `${source.repo}@${source.ref}` : source.repo;
  }
  if (source.source === 'git' && typeof source.url === 'string') return source.url;
  if (source.source === 'url' && typeof source.url === 'string') return source.url;
  if (source.source === 'path' && typeof source.path === 'string') return source.path;
  if (typeof source.repo === 'string') return source.repo;
  if (typeof source.url === 'string') return source.url;
  if (typeof source.path === 'string') return source.path;
  return null;
}

function stringifyForSearch(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function includesOfficialClaudeMarketplace(value) {
  return stringifyForSearch(value).includes('anthropics/claude-plugins-official') ||
    stringifyForSearch(value).includes('claude-plugins-official');
}

function enabledPluginIds(value) {
  if (Array.isArray(value)) return value.filter((x) => typeof x === 'string');
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, enabled]) => enabled !== false)
      .map(([pluginId]) => pluginId);
  }
  if (typeof value === 'string') return [value];
  return [];
}

function pluginPlanDetails(key, value, targetScope) {
  const scope = pluginScope(targetScope);
  const notes = [
    '不要复制 Claude 插件缓存、installed_plugins 或 marketplace state',
    'Codex 插件/marketplace 状态应通过 Codex 当前提供的插件安装流程处理；本 inspector 只列计划，不执行命令',
  ];
  if (includesOfficialClaudeMarketplace(value)) {
    notes.push('检测到 Claude 官方插件市场引用；需要确认 Codex 是否有等价 marketplace 或插件来源');
  }
  if (key === 'extraKnownMarketplaces' && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const entry of Object.values(value)) {
      const source = marketplaceCommandSource(entry);
      if (source) {
        notes.push(`候选 marketplace: ${shellQuote(source)} (scope: ${scope})`);
      }
    }
  }
  if (key === 'enabledPlugins') {
    for (const pluginId of enabledPluginIds(value)) {
      notes.push(`候选 plugin: ${shellQuote(pluginId)} (scope: ${scope})`);
    }
    if (enabledPluginIds(value).length === 0) {
      notes.push('enabledPlugins 形态无法直接生成插件名；需要人工确认具体插件 ID');
    }
  }
  return {
    recommendation: '列出 Codex 插件迁移计划；默认不执行，不直接编辑插件状态文件',
    commands: [],
    notes: [...new Set(notes)],
  };
}

function analyzeMcpServers(plan, sourcePath, sourceScope, target, servers, options = {}) {
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    add(plan, 'unsupported', {
      source: sourcePath,
      path: 'mcpServers',
      reason: 'mcpServers 不是对象',
    });
    return;
  }
  const names = Object.keys(servers);
  if (names.length === 0) {
    add(plan, 'emptySkipped', { source: sourcePath, path: 'mcpServers' });
    return;
  }

  for (const name of names) {
    const cfg = servers[name];
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
      add(plan, 'unsupported', {
        source: sourcePath,
        path: `mcpServers.${name}`,
        reason: 'server 配置不是对象',
      });
      continue;
    }
    const unsupported = Object.keys(cfg).filter((key) => !MCP_FIELDS.has(key));
    const sensitive = ['env', 'headers', 'headersHelper'].filter((key) => cfg[key] !== undefined);
    const item = {
      source: sourcePath,
      sourceScope,
      target,
      server: name,
      sensitive,
      unsupportedFields: unsupported,
    };
    const existingTargets = existingMcpTargets(
      options.targetMcpIndex,
      target,
      name,
    );
    if (options.compatibleInPlace) add(plan, 'compatibleInPlace', item);
    else if (existingTargets.length) {
      const updateItem = {
        ...item,
        existingTargets,
        changeType: 'update',
        reason: '目标中已存在同名 MCP server；需要确认是保留、替换、重命名还是跳过。仅凭同名不能判定为冲突',
      };
      add(plan, 'needsDecision', updateItem);
      add(plan, 'updates', {
        source: sourcePath,
        target,
        label: `MCP server ${name}`,
        server: name,
        existingTargets,
        changeType: 'update',
        reason: updateItem.reason,
        choices: ['保留目标', '替换目标', '重命名源 server', '跳过'],
      });
    } else add(plan, sensitive.length ? 'needsDecision' : 'migratable', item);
    for (const field of unsupported) {
      add(plan, 'unsupported', {
        source: sourcePath,
        path: `mcpServers.${name}.${field}`,
        reason: '不支持的 MCP server 字段',
      });
    }
  }
}

function analyzeSettings(plan, sourcePath, sourceScope, targetScope, settings, targetMcpIndex) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    add(plan, 'unsupported', {
      source: sourcePath,
      path: '',
      reason: 'settings 文件不是 JSON 对象',
    });
    return;
  }
  for (const [key, value] of Object.entries(settings)) {
    if (emptyValue(value)) {
      add(plan, 'emptySkipped', { source: sourcePath, path: key });
      continue;
    }
    if (key === '$schema') continue;
    if (key === 'mcpServers') {
      const target =
        targetScope === 'project' ? '<project>/.mcp.json' :
        targetScope === 'local' ? '~/.codex/config.toml' :
        '~/.codex/config.toml';
      analyzeMcpServers(plan, sourcePath, sourceScope, target, value, {
        targetMcpIndex,
      });
      continue;
    }
    if (key === 'permissions') {
      add(plan, 'needsDecision', {
        source: sourcePath,
        sourceScope,
        target: targetScope === 'user' ? '~/.codex/config.toml' : targetScope === 'local' ? '~/.codex/config.toml' : '<project>/AGENTS.md 或 ~/.codex/config.toml',
        path: 'permissions',
        reason: '会改变工具访问或信任边界',
      });
      continue;
    }
    if (key === 'hooks') {
      add(plan, 'needsDecision', {
        source: sourcePath,
        sourceScope,
        target: '~/.codex/hooks.json',
        path: 'hooks',
        reason: 'hooks 会执行命令或触发评估；需要用户确认执行风险',
        transform: '仅自动替换 $CLAUDE_PROJECT_DIR -> $CODEX_PROJECT_DIR；其他字段、token、命令、matcher、timeout、type、事件名和顺序保持原样',
      });
      continue;
    }
    if (key === 'outputStyle') {
      add(plan, 'needsDecision', {
        source: sourcePath,
        sourceScope,
        target: '~/.codex/config.toml',
        path: 'outputStyle',
        reason: '仅在对应 style 文件存在后才设置 active style',
      });
      continue;
    }
    if (key === 'enabledPlugins' || key === 'extraKnownMarketplaces') {
      const details = pluginPlanDetails(key, value, targetScope);
      add(plan, 'pluginPlan', {
        source: sourcePath,
        sourceScope,
        path: key,
        ...details,
      });
      continue;
    }
    if (key === 'env') {
      add(plan, 'reportOnly', {
        source: sourcePath,
        path: 'env',
        reason: 'Codex settings 没有等价的顶层 env 注入字段',
      });
      continue;
    }
    if (key === 'model' || key === 'fallbackModel') {
      add(plan, 'reportOnly', {
        source: sourcePath,
        path: key,
        reason: '模型、provider 或 auth 语义不同',
      });
      continue;
    }
    if (!SETTINGS_HANDLED.has(key)) {
      add(plan, 'unknown', {
        source: sourcePath,
        path: key,
        summary: summarizeValue(value),
      });
    }
  }
}

function compareDir(plan, source, target, label) {
  const items = listTopLevelItems(source);
  if (items.length === 0) return;
  for (const item of items) {
    const targetPath = path.join(target, item.name);
    const updateFiles = [];
    if (exists(targetPath)) {
      updateFiles.push(targetPath);
    } else {
      for (const file of item.files) {
        const rel = path.relative(source, file);
        const candidate = path.join(target, rel);
        if (exists(candidate)) updateFiles.push(candidate);
      }
    }
    const planItem = {
      source: item.path,
      target: targetPath,
      label: `${label}: ${item.name}`,
      item: item.name,
      itemKind: item.kind,
      files: item.files.length,
      updates: updateFiles.length,
      updateFiles,
      changeType: updateFiles.length ? 'update' : 'add',
      reason: updateFiles.length ? '目标已存在或存在同路径文件；需要确认更新/并列副本/手动合并，不能仅凭路径存在判定为冲突' : undefined,
      rule: '只复制；保留相对路径；绝不覆盖',
    };
    add(plan, updateFiles.length ? 'needsDecision' : 'migratable', planItem);
    if (updateFiles.length) {
      add(plan, 'updates', {
        source: item.path,
        target: targetPath,
        label: `${label}: ${item.name}`,
        item: item.name,
        count: updateFiles.length,
        updateFiles,
        changeType: 'update',
        reason: planItem.reason,
        choices: ['跳过', '重命名源副本', '手动合并'],
      });
    }
  }
}

function reportDirItems(plan, source, target, label, reason) {
  const items = listTopLevelItems(source);
  if (items.length === 0) return;
  for (const item of items) {
    add(plan, 'reportOnly', {
      source: item.path,
      target: path.join(target, item.name),
      label: `${label}: ${item.name}`,
      item: item.name,
      itemKind: item.kind,
      files: item.files.length,
      reason,
    });
  }
}

function decisionDirItems(plan, source, target, label, reason) {
  const items = listTopLevelItems(source);
  if (items.length === 0) return;
  for (const item of items) {
    add(plan, 'needsDecision', {
      source: item.path,
      target: path.join(target, item.name),
      label: `${label}: ${item.name}`,
      item: item.name,
      itemKind: item.kind,
      files: item.files.length,
      reason,
      choices: ['转换为 Codex agent', '转换为 skill/reference', '跳过', '手动处理'],
    });
  }
}

function compareFile(plan, source, target, label, options = {}) {
  if (!exists(source)) return;
  if (exists(target)) {
    const reason = options.reason || '目标已存在；这是更新候选，除非能明确识别语义不一致，否则不标记为冲突';
    add(plan, 'needsDecision', {
      source,
      target,
      label,
      changeType: 'update',
      reason,
      choices: options.choices || ['跳过', '追加', '另存并列文件', '手动合并'],
    });
    add(plan, 'updates', { source, target, label, changeType: 'update', reason });
  } else {
    add(plan, 'migratable', {
      source,
      target,
      label,
      changeType: 'add',
      rule: '只复制',
    });
  }
}

function compareProjectMemoryDir(plan, memoryDir, projectPath, labelPrefix) {
  const files = listTopLevelItems(memoryDir).filter((item) =>
    item.kind === 'file' && item.name.endsWith('.md'),
  );
  for (const item of files) {
    compareFile(
      plan,
      item.path,
      path.join(projectPath, 'AGENTS.md'),
      `${labelPrefix}: ${item.name}`,
      {
        reason: '目标 AGENTS.md 已存在；需要确认是否追加 Claude 项目 memory',
        choices: ['跳过', '追加', '另存并列文件', '手动合并'],
      },
    );
  }
}

function analyzeClaudeState(plan, statePath, project, candidates, targetMcpIndex) {
  const result = readJson(statePath);
  if (!result.exists) return;
  add(plan, 'sourcesFound', { path: statePath, kind: 'Claude 状态文件' });
  if (result.error) {
    add(plan, 'unsupported', { source: statePath, path: '', reason: result.error });
    return;
  }
  const state = result.parsed;
  if (state?.mcpServers) {
    analyzeMcpServers(plan, statePath, 'user', '~/.codex/config.toml', state.mcpServers, {
      targetMcpIndex,
    });
  }
  const projects = state?.projects;
  if (projects && typeof projects === 'object' && !Array.isArray(projects)) {
    const matching = Object.keys(projects).filter((p) =>
      projectKeyMatches(p, candidates),
    );
    if (matching.length === 0) {
      const projectCount = Object.keys(projects).length;
      if (projectCount > 0) {
        add(plan, 'reportOnly', {
          source: statePath,
          path: 'projects',
          reason: `发现 ${projectCount} 个项目条目，但没有匹配当前项目`,
        });
      }
    } else if (matching.length > 1) {
      add(plan, 'needsDecision', {
        source: statePath,
        path: 'projects',
        reason: '多个项目条目匹配当前项目；需要用户选择一个',
        choices: matching,
      });
    }
    for (const key of matching) {
      const entry = projects[key];
      if (entry?.mcpServers) {
        analyzeMcpServers(
          plan,
          `${statePath}#projects[${key}]`,
          'local',
          '~/.codex/config.toml',
          entry.mcpServers,
          { targetMcpIndex },
        );
      }
    }
  }
}

function analyzeKnownProjectMemories(plan, statePath, currentProject) {
  const result = readJson(statePath);
  if (!result.exists || result.error) return;
  const projects = result.parsed?.projects;
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return;

  const current = normalizeProjectKeyForMatch(currentProject);
  const seen = new Set();
  for (const projectPath of Object.keys(projects).sort()) {
    const normalized = normalizeProjectKeyForMatch(projectPath);
    if (seen.has(normalized) || normalized === current) continue;
    seen.add(normalized);
    if (!isDir(projectPath)) {
      add(plan, 'reportOnly', {
        source: `${statePath}#projects[${projectPath}]`,
        path: 'projects',
        reason: '已知 Claude 项目路径不存在或当前不可访问；跳过项目 memory 检查',
      });
      continue;
    }
    compareFile(
      plan,
      path.join(projectPath, 'CLAUDE.md'),
      path.join(projectPath, 'AGENTS.md'),
      `已知项目记忆文件: ${projectPath}`,
    );
    compareFile(
      plan,
      path.join(projectPath, 'CLAUDE.local.md'),
      path.join(projectPath, 'AGENTS.local.md'),
      `已知项目本地记忆文件: ${projectPath}`,
    );
    compareProjectMemoryDir(
      plan,
      claudeProjectMemoryDir(path.dirname(statePath), projectPath),
      projectPath,
      `已知项目 Claude project memory: ${projectPath}`,
    );
  }
}

function inspect(opts) {
  const home = opts.home;
  const project = opts.project;
  const cHome = claudeSettingsHome(home);
  const qHome = codexHome(home);
  const cProject = path.join(project, '.claude');
  const qProject = path.join(project, '.codex');
  const plan = {
    project,
    home,
    codexHome: qHome,
    generatedAt: new Date().toISOString(),
    sourcesFound: [],
    compatibleInPlace: [],
    migratable: [],
    updates: [],
    needsDecision: [],
    conflicts: [],
    reportOnly: [],
    unsupported: [],
    unknown: [],
    emptySkipped: [],
    pluginPlan: [],
  };

  const candidates = projectEntryCandidates(project);
  const targetMcpIndex = buildTargetMcpIndex(plan, qHome, qProject, project);

  const settingSources = [
    { path: path.join(cHome, 'settings.json'), sourceScope: 'user', targetScope: 'user' },
    { path: path.join(cProject, 'settings.json'), sourceScope: 'project', targetScope: 'project' },
    { path: path.join(cProject, 'settings.local.json'), sourceScope: 'local', targetScope: 'local' },
  ];
  for (const source of settingSources) {
    const result = readJson(source.path);
    if (!result.exists) continue;
    add(plan, 'sourcesFound', { path: source.path, kind: `${scopeLabel(source.sourceScope)} settings` });
    if (result.error) {
      add(plan, 'unsupported', { source: source.path, path: '', reason: result.error });
    } else {
      analyzeSettings(
        plan,
        source.path,
        source.sourceScope,
        source.targetScope,
        result.parsed,
        targetMcpIndex,
      );
    }
  }

  analyzeClaudeState(plan, claudeStatePath(home), project, candidates, targetMcpIndex);
  if (opts.includeKnownProjectMemories) {
    analyzeKnownProjectMemories(plan, claudeStatePath(home), project);
  }

  const legacyCodexJson = path.join(home, '.codex.json');
  if (exists(legacyCodexJson)) {
    add(plan, 'reportOnly', {
      source: legacyCodexJson,
      path: '',
      reason: '当前 Claude Code -> Codex 迁移目标不包含该文件；不会读取或写入',
    });
  }

  const rootMcp = path.join(project, '.mcp.json');
  const rootMcpResult = readJson(rootMcp);
  if (rootMcpResult.exists) {
    add(plan, 'sourcesFound', { path: rootMcp, kind: '项目 MCP' });
    if (rootMcpResult.error) {
      add(plan, 'unsupported', { source: rootMcp, path: '', reason: rootMcpResult.error });
    } else if (rootMcpResult.parsed?.mcpServers) {
      analyzeMcpServers(plan, rootMcp, 'project', rootMcp, rootMcpResult.parsed.mcpServers, {
        compatibleInPlace: true,
      });
    } else {
      add(plan, 'unsupported', {
        source: rootMcp,
        path: 'mcpServers',
        reason: '缺少顶层 mcpServers 对象',
      });
    }
  }

  compareFile(plan, path.join(cHome, 'CLAUDE.md'), path.join(qHome, 'AGENTS.md'), '用户级记忆文件');
  compareFile(plan, path.join(project, 'CLAUDE.md'), path.join(project, 'AGENTS.md'), '项目级记忆文件');
  compareFile(plan, path.join(project, 'CLAUDE.local.md'), path.join(project, 'AGENTS.local.md'), '项目本地记忆文件');
  compareProjectMemoryDir(
    plan,
    claudeProjectMemoryDir(home, project),
    project,
    '当前项目 Claude project memory',
  );

  compareDir(plan, path.join(cHome, 'skills'), path.join(qHome, 'skills'), '用户级 skills');
  compareDir(plan, path.join(cProject, 'skills'), path.join(qProject, 'skills'), '项目级 skills');

  decisionDirItems(plan, path.join(cHome, 'agents'), path.join(qHome, 'agents'), '用户级 agents', 'Claude agent Markdown 与 Codex agent TOML/schema 不一定兼容，需要转换或确认');
  decisionDirItems(plan, path.join(cProject, 'agents'), path.join(qProject, 'agents'), '项目级 agents', 'Claude agent Markdown 与 Codex agent TOML/schema 不一定兼容，需要转换或确认');

  reportDirItems(plan, path.join(cHome, 'commands'), path.join(qHome, 'commands'), '用户级 commands', 'Claude slash command 没有直接 Codex 等价；应转换为 Codex skill 或 AGENTS.md 说明');
  reportDirItems(plan, path.join(cProject, 'commands'), path.join(qProject, 'commands'), '项目级 commands', 'Claude slash command 没有直接 Codex 等价；应转换为 Codex skill 或 AGENTS.md 说明');
  reportDirItems(plan, path.join(cHome, 'output-styles'), path.join(qHome, 'output-styles'), '用户级 output-styles', 'Codex output style 支持不保证等价；默认只报告');
  reportDirItems(plan, path.join(cProject, 'output-styles'), path.join(qProject, 'output-styles'), '项目级 output-styles', 'Codex output style 支持不保证等价；默认只报告');

  const keybindings = path.join(cHome, 'keybindings.json');
  if (exists(keybindings)) {
    add(plan, 'reportOnly', {
      source: keybindings,
      path: '',
      reason: 'keybindings schema 不兼容，需要手动重映射',
    });
  }

  return plan;
}

function renderList(items, renderItem) {
  if (!items.length) return '- 无\n';
  return items.map((item) => `- ${renderItem(item)}`).join('\n') + '\n';
}

function renderMarkdown(plan) {
  const lines = [];
  lines.push('# Claude Code 到 Codex 迁移检查');
  lines.push('');
  lines.push(`项目: \`${plan.project}\``);
  lines.push(`Codex 配置目录: \`${plan.codexHome}\``);
  lines.push(`生成时间: \`${plan.generatedAt}\``);
  lines.push('');
  lines.push('## 发现的源文件');
  lines.push(renderList(plan.sourcesFound, (x) => `\`${x.path}\` (${x.kind})`));
  lines.push('## 已在兼容位置');
  lines.push(renderList(plan.compatibleInPlace, (x) => x.server ? `MCP server \`${x.server}\` 已位于 Codex 可读取的项目 MCP 位置: \`${x.source}\`` : JSON.stringify(x)));
  lines.push('## 可迁移');
  lines.push(renderList(plan.migratable, (x) => x.server ? `MCP server \`${x.server}\`: \`${x.source}\` -> \`${x.target}\`` : `${x.label || x.path || '条目'}: \`${x.source}\` -> \`${x.target}\`${x.files ? ` (${x.files} 个文件)` : ''}`));
  lines.push('## 更新');
  lines.push(renderList(plan.updates, (x) => `${x.label || x.path || x.server || '条目'}: \`${x.source}\`${x.target ? ` -> \`${x.target}\`` : ''}${x.count ? ` (${x.count} 个待更新路径)` : ''}${x.reason ? ` (${x.reason})` : ''}${x.existingTargets ? `；已存在: ${x.existingTargets.map((p) => `\`${p}\``).join(', ')}` : ''}`));
  lines.push('## 需要确认');
  lines.push(renderList(plan.needsDecision, (x) => `${x.label || x.path || x.server || '条目'} 来自 \`${x.source}\`${x.target ? ` -> \`${x.target}\`` : ''}${x.reason ? ` (${x.reason})` : ''}${x.existingTargets ? `；已存在: ${x.existingTargets.map((p) => `\`${p}\``).join(', ')}` : ''}`));
  lines.push('## 冲突');
  lines.push(renderList(plan.conflicts, (x) => `${x.label || '条目'}: \`${x.source}\` -> \`${x.target}\`${x.count ? ` (${x.count} 个明确冲突)` : ''}${x.reason ? ` (${x.reason})` : ''}${x.existingTargets ? `；已存在: ${x.existingTargets.map((p) => `\`${p}\``).join(', ')}` : ''}`));
  lines.push('## 插件计划');
  lines.push(renderList(plan.pluginPlan, (x) => {
    let text = `\`${x.path}\` 位于 \`${x.source}\`: ${x.recommendation}`;
    if (x.commands?.length) {
      text += `\n  建议命令:\n${x.commands.map((cmd) => `  - \`${cmd}\``).join('\n')}`;
    }
    if (x.notes?.length) {
      text += `\n  说明:\n${x.notes.map((note) => `  - ${note}`).join('\n')}`;
    }
    return text;
  }));
  lines.push('## 只报告');
  lines.push(renderList(plan.reportOnly, (x) => `\`${x.source}\`${x.path ? ` ${x.path}` : ''}: ${x.reason}`));
  lines.push('## 不支持');
  lines.push(renderList(plan.unsupported, (x) => `\`${x.source}\`${x.path ? ` ${x.path}` : ''}: ${x.reason}`));
  lines.push('## 未知');
  lines.push(renderList(plan.unknown, (x) => `\`${x.source}\` ${x.path}: ${x.summary}`));
  lines.push('## 空值已跳过');
  lines.push(renderList(plan.emptySkipped, (x) => `\`${x.source}\` ${x.path}`));
  lines.push('## 确认要求');
  lines.push('- 按用户级、项目共享级、项目本地级分别列出要迁移和不迁移的内容，并让用户确认对应源路径、目标路径和资源类型。');
  lines.push('- permissions、hooks、MCP secrets/env/headers、插件 marketplace/install 命令、所有更新候选和所有明确冲突必须单独确认。');
  lines.push('');
  lines.push('## 模型配置提醒');
  lines.push('- 如果 skills、agents、hooks、commands、plugins 或 output styles 中有 Claude 模型名、provider、auth 或模型相关环境变量，需要转换成 Codex 支持的模型配置，不能假定两边相同。');
  lines.push('');
  lines.push('## 下一步');
  lines.push('把这个计划展示给用户。用户确认相关资源组之前，不要写文件或运行插件命令。');
  lines.push('');
  return lines.join('\n');
}

try {
  const opts = parseArgs(process.argv.slice(2));
  const plan = inspect(opts);
  if (opts.format === 'json') console.log(JSON.stringify(plan, null, 2));
  else process.stdout.write(renderMarkdown(plan));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
