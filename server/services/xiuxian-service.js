const {
  fetchState,
  formatError,
  logsOf,
  makeNakamaConfig,
  NakamaSocketClient,
} = require('../../xiuxian-common');

function clientConfigForJob(job, options = {}) {
  const config = makeNakamaConfig({
    cidPrefix: options.cidPrefix || 'dashboard',
    recoveryId: job.recoveryId,
    verbose: Boolean(options.verbose),
  });

  if (job.token) config.token = job.token;
  if (job.env?.XIUXIAN_REFRESH_TOKEN) config.refreshToken = job.env.XIUXIAN_REFRESH_TOKEN;
  if (job.env?.XIULIAN_REFRESH_TOKEN) config.refreshToken = job.env.XIULIAN_REFRESH_TOKEN;
  if (job.env?.XIUXIAN_SESSION_CACHE_DIR) config.sessionCacheDir = job.env.XIUXIAN_SESSION_CACHE_DIR;
  if (job.env?.XIULIAN_SESSION_CACHE_DIR) config.sessionCacheDir = job.env.XIULIAN_SESSION_CACHE_DIR;

  return config;
}

class XiuxianService {
  constructor(options = {}) {
    this.verbose = Boolean(options.verbose);
  }

  createClient(job, options = {}) {
    return new NakamaSocketClient(clientConfigForJob(job, {
      cidPrefix: options.cidPrefix,
      verbose: options.verbose ?? this.verbose,
    }));
  }

  async withClient(job, options, action) {
    const client = this.createClient(job, options);
    try {
      return await action(client);
    } finally {
      await client.close();
    }
  }

  async fetchState(job, options = {}) {
    return this.withClient(job, options, (client) => fetchState(client));
  }

  async cultivateManual(job, options = {}) {
    return this.withClient(job, options, async (client) => {
      const before = await fetchState(client);
      const result = await client.rpc('action.cultivate', { mode: 'manual' });
      return {
        before,
        result,
        state: { ...before, ...result },
      };
    });
  }
}

function summarizeCultivationResult(result) {
  const parts = [];
  if (result?.gained_exp !== undefined) parts.push(`exp=${result.gained_exp}`);
  if (result?.gained_qi !== undefined) parts.push(`qi=${result.gained_qi}`);
  const logs = logsOf(result);
  if (logs) parts.push(logs);
  return parts.join(' | ') || 'ok';
}

module.exports = {
  clientConfigForJob,
  formatError,
  summarizeCultivationResult,
  XiuxianService,
};
