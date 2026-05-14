const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { nowIso } = require('../utils');

class JobManager {
  constructor(options = {}) {
    this.root = options.root;
    this.accountStore = options.accountStore;
    this.logService = options.logService;
    this.eventBus = options.eventBus;
    this.roleStateReportUrl = options.roleStateReportUrl;
    this.jobs = new Map();
  }

  status(name) {
    const runtime = this.jobs.get(name);
    if (!runtime) return { running: false };

    return {
      running: true,
      pid: runtime.child.pid,
      startedAt: runtime.startedAt,
      script: runtime.job.script,
      restarts: runtime.restarts,
    };
  }

  publicJob(job) {
    return this.accountStore.publicJob(job, this.status(job.name));
  }

  async list() {
    const config = await this.accountStore.read();
    return config.map((job) => this.publicJob(job));
  }

  buildEnv(job) {
    const env = {
      ...process.env,
      ...job.env,
    };

    if (job.token) {
      env.XIUXIAN_TOKEN = job.token;
      env.XIULIAN_TOKEN = job.token;
    }

    if (job.recoveryId) {
      env.XIUXIAN_RECOVERY_ID = job.recoveryId;
      env.XIULIAN_RECOVERY_ID = job.recoveryId;
    }

    if (this.roleStateReportUrl) {
      env.XIUXIAN_ROLE_NAME = job.name;
      env.XIUXIAN_ROLE_STATE_REPORT_URL = this.roleStateReportUrl;
    }

    return env;
  }

  async start(name, options = {}) {
    const job = await this.accountStore.find(name);
    if (!job) throw new Error(`任务不存在：${name}`);
    if (!job.enabled && !options.force) throw new Error(`任务未启用：${name}`);
    if (this.jobs.has(name)) return this.status(name);

    const scriptPath = path.join(this.root, job.script);
    if (!fs.existsSync(scriptPath)) throw new Error(`脚本不存在：${job.script}`);

    const runtime = {
      job,
      child: null,
      startedAt: nowIso(),
      restarts: 0,
    };

    const child = spawn(process.execPath, [scriptPath, ...job.args], {
      cwd: this.root,
      env: this.buildEnv(job),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    runtime.child = child;
    this.jobs.set(name, runtime);

    await this.logService.append(name, `\n[dashboard ${nowIso()}] started pid=${child.pid} script=${job.script}\n`);
    this.eventBus.publish('status', { name, status: this.status(name) });

    child.stdout.on('data', (chunk) => this.logService.append(name, chunk).catch(() => {}));
    child.stderr.on('data', (chunk) => this.logService.append(name, chunk).catch(() => {}));
    child.on('exit', async (code, signal) => {
      this.jobs.delete(name);
      await this.logService.append(name, `[dashboard ${nowIso()}] exited code=${code ?? '-'} signal=${signal ?? '-'}\n`);
      this.eventBus.publish('status', { name, status: this.status(name) });
    });

    return this.status(name);
  }

  async stop(name) {
    const runtime = this.jobs.get(name);
    if (!runtime) return { running: false };

    await this.logService.append(name, `[dashboard ${nowIso()}] stopping pid=${runtime.child.pid}\n`);

    runtime.child.kill('SIGTERM');

    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.jobs.has(name)) runtime.child.kill('SIGKILL');
        resolve();
      }, 3000);
      runtime.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    return this.status(name);
  }

  async startAll() {
    const config = await this.accountStore.read();
    const results = [];

    for (const job of config.filter((item) => item.enabled)) {
      try {
        results.push({ name: job.name, status: await this.start(job.name) });
      } catch (error) {
        results.push({ name: job.name, error: error.message });
      }
    }

    return results;
  }

  async stopAll() {
    const names = [...this.jobs.keys()];
    const results = [];

    for (const name of names) {
      results.push({ name, status: await this.stop(name) });
    }

    return results;
  }
}

module.exports = {
  JobManager,
};
