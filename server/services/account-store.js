const fsp = require('node:fs/promises');
const {
  maskSecret,
  parseArgs,
} = require('../utils');

class AccountStore {
  constructor(options = {}) {
    this.configPath = options.configPath;
    this.scriptAllowlist = options.scriptAllowlist || new Set();
  }

  scripts() {
    return [...this.scriptAllowlist];
  }

  normalize(raw) {
    const job = raw && typeof raw === 'object' ? raw : {};
    const name = String(job.name || '').trim();
    const script = String(job.script || '').trim();

    if (name.length < 1 || name.length > 80 || /[\/\\\0]/.test(name)) {
      throw new Error(`任务名不合法：${name || '(empty)'}`);
    }
    if (!this.scriptAllowlist.has(script)) throw new Error(`脚本不在白名单：${script}`);

    const env = job.env && typeof job.env === 'object' && !Array.isArray(job.env) ? job.env : {};

    return {
      name,
      script,
      enabled: job.enabled !== false,
      recoveryId: String(job.recoveryId || ''),
      token: String(job.token || ''),
      args: parseArgs(job.args),
      env: Object.fromEntries(Object.entries(env).map(([key, value]) => [String(key), String(value)])),
      notes: String(job.notes || ''),
    };
  }

  async read() {
    try {
      const text = await fsp.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((job) => this.normalize(job));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async write(config) {
    const normalized = config.map((job) => this.normalize(job));
    const seen = new Set();

    for (const job of normalized) {
      if (seen.has(job.name)) throw new Error(`任务名重复：${job.name}`);
      seen.add(job.name);
    }

    await fsp.writeFile(this.configPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
    return normalized;
  }

  async find(name) {
    const config = await this.read();
    return config.find((job) => job.name === name) || null;
  }

  publicJob(job, runtime = { running: false }) {
    return {
      ...job,
      recoveryIdMasked: maskSecret(job.recoveryId),
      hasRecoveryId: Boolean(job.recoveryId),
      token: undefined,
      tokenMasked: maskSecret(job.token),
      hasToken: Boolean(job.token),
      runtime,
    };
  }
}

module.exports = {
  AccountStore,
};
