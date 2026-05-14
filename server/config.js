const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT, '.runtime');

const CONFIG = {
  root: ROOT,
  configPath: path.join(ROOT, 'accounts.config.json'),
  runtimeDir: RUNTIME_DIR,
  logDir: path.join(RUNTIME_DIR, 'logs'),
  dailyCultivationStatePath: path.join(RUNTIME_DIR, 'daily-cultivation.json'),
  roleStatePath: path.join(RUNTIME_DIR, 'role-states.json'),
  port: Number(process.env.XIUXIAN_DASHBOARD_PORT || 4177),
  host: process.env.XIUXIAN_DASHBOARD_HOST || '127.0.0.1',
  logMaxBytes: Number(process.env.XIUXIAN_LOG_MAX_BYTES || 256 * 1024),
  logCleanupCron: process.env.XIUXIAN_LOG_CLEANUP_CRON || '0 0 * * * *',
  logCleanupMaxLines: Number(process.env.XIUXIAN_LOG_CLEANUP_MAX_LINES || 100),
  gameOrigin: process.env.XIUXIAN_GAME_ORIGIN || 'https://xx.liulabinfo.org',
  schedulerEnabled: process.env.XIUXIAN_SCHEDULER_ENABLED !== 'false',
  timezone: process.env.XIUXIAN_TIMEZONE || 'Asia/Shanghai',
  dailyCultivationCron: process.env.XIUXIAN_DAILY_CULTIVATION_CRON || '0 5 0 * * *',
  dailyCultivationIncludeDisabled: process.env.XIUXIAN_DAILY_CULTIVATION_INCLUDE_DISABLED !== 'false',
  roleStateRefreshCron: process.env.XIUXIAN_ROLE_STATE_REFRESH_CRON || '0 */5 * * * *',
  scriptAllowlist: new Set([
    'auto-priority.js',
    'auto-xiulian.js',
    'auto-fudi.js',
    'auto-danger.js',
    'auto-forage.js',
  ]),
};

module.exports = CONFIG;
