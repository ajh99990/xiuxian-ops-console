export const LOG_LINE_LIMIT = 700;

export const emptyDailyCultivation = {
  dayKey: '',
  updatedAt: '',
  lastRunAt: '',
  records: [],
  runs: [],
};

export const emptyRoleStates = {
  updatedAt: '',
  lastRefreshAt: '',
  records: [],
  refreshes: [],
};

export const defaultScripts = [
  'auto-priority.js',
  'auto-danger.js',
  'auto-fudi.js',
  'auto-forage.js',
  'auto-xiulian.js',
];

export const makeUiId = () => (
  globalThis.crypto?.randomUUID?.() || `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

export const stableJobId = (job) => `job:${job.name || makeUiId()}`;

export const withUiId = (job) => ({
  ...job,
  _uiId: job._uiId || stableJobId(job),
  previousName: job.previousName || job.name,
});

export const emptyJob = (scripts) => ({
  _uiId: makeUiId(),
  name: `角色-${Math.floor(Date.now() % 100000)}`,
  script: scripts[0] || 'auto-danger.js',
  enabled: true,
  args: [],
  env: {},
  notes: '',
  recoveryId: '',
  recoveryIdMasked: '',
  hasRecoveryId: false,
  tokenMasked: '',
  hasToken: false,
  runtime: { running: false },
});

export function logNameForJob(job) {
  return job ? (job.previousName || job.name || '') : '';
}

export function emptyLogView(name = '', loading = false) {
  return { name, text: '', loading };
}

export function envToText(env) {
  return Object.entries(env || {}).map(([key, value]) => `${key}=${value}`).join('\n');
}

export function textToEnv(text) {
  const env = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return env;
}

export function argsToText(args) {
  return Array.isArray(args) ? args.join(' ') : String(args || '');
}

export function textToArgs(text) {
  return String(text || '').split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

export function trimLogLines(text, limit = LOG_LINE_LIMIT) {
  const lines = String(text || '').split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - limit)).join('\n');
}

export function formatDayKey(dayKey) {
  const value = String(dayKey || '');
  if (!/^\d{8}$/.test(value)) return value || '-';
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

export function dailyStatusText(status) {
  return {
    failed: '失败',
    missing_recovery: '缺续玩编号',
    never: '未执行',
    running: '执行中',
    skipped: '已跳过',
    success: '已完成',
  }[status] || status || '未执行';
}

export function statusText(job) {
  if (job?.runtime?.running) return `运行中 · pid ${job.runtime.pid}`;
  if (job?.enabled === false) return '已停用';
  return '待命';
}

export function scriptLabel(script) {
  return {
    'auto-priority.js': '综合优先',
    'auto-danger.js': '凶地探索',
    'auto-fudi.js': '福地探索',
    'auto-forage.js': '采药捕兽',
    'auto-xiulian.js': '修炼闭关',
  }[script] || script;
}

export function scriptSigil(script) {
  return {
    'auto-priority.js': '策',
    'auto-danger.js': '凶',
    'auto-fudi.js': '福',
    'auto-forage.js': '采',
    'auto-xiulian.js': '修',
  }[script] || '令';
}
