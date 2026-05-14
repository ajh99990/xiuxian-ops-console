const {
  dayKey,
  maskSecret,
  nowIso,
  stableHash,
} = require('../utils');
const {
  formatError,
  summarizeCultivationResult,
} = require('./xiuxian-service');

const LOG_NAME = 'daily-cultivation';
const RUNNING_ATTEMPT_STALE_MS = 10 * 60 * 1000;

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cultivationSnapshot(player) {
  const streak = numberOrNull(player?.meta?.cultivation_streak) || 0;
  const bonusPercent = Math.min(streak * 5, 50);

  return {
    playerName: player?.profile?.display_name || player?.profile?.name || '',
    realmId: player?.progression?.realm_id || '',
    realmStage: numberOrNull(player?.progression?.realm_stage),
    exp: numberOrNull(player?.progression?.exp),
    expToNext: numberOrNull(player?.progression?.exp_to_next),
    cultivationRate: numberOrNull(player?.progression?.cultivation_rate),
    cultivationStreak: streak,
    cultivationBonusPercent: bonusPercent,
    lastCultivationDay: String(player?.meta?.last_cultivation_day || ''),
    lastCultivationTickAt: player?.timers?.last_cultivation_tick_at || '',
  };
}

function accountKey(job) {
  return `acc_${stableHash(job.recoveryId || job.name)}`;
}

function isStaleRunningAttempt(record, now = Date.now()) {
  if (record?.status !== 'running') return false;
  const startedAt = Date.parse(record.lastAttemptAt || '');
  return !Number.isFinite(startedAt) || now - startedAt > RUNNING_ATTEMPT_STALE_MS;
}

function publicRecord(record) {
  if (!record) return null;
  return {
    ...record,
    recoveryId: undefined,
  };
}

class DailyCultivationService {
  constructor(options = {}) {
    this.accountStore = options.accountStore;
    this.eventBus = options.eventBus;
    this.includeDisabled = options.includeDisabled !== false;
    this.logService = options.logService;
    this.store = options.store;
    this.timezone = options.timezone || 'Asia/Shanghai';
    this.xiuxianService = options.xiuxianService;
    this.activeRun = null;
  }

  today() {
    return dayKey(new Date(), this.timezone);
  }

  async readState() {
    return this.normalizeState(await this.store.read());
  }

  normalizeState(state = {}) {
    const source = state && typeof state === 'object' ? state : {};
    return {
      version: 1,
      accounts: {},
      runs: [],
      ...source,
      accounts: source.accounts || {},
      runs: Array.isArray(source.runs) ? source.runs : [],
    };
  }

  async writeState(state) {
    return this.store.write({
      ...this.normalizeState(state),
      updatedAt: nowIso(),
    });
  }

  async updateState(mutator) {
    let result;
    const state = await this.store.update(async (current) => {
      const next = this.normalizeState(current);
      result = await mutator(next);
      return {
        ...next,
        updatedAt: nowIso(),
      };
    });
    return { state, result };
  }

  async publishStatus() {
    this.eventBus?.publish('daily_cultivation', await this.status());
  }

  async accountJobs() {
    const jobs = await this.accountStore.read();
    const seen = new Set();
    const result = [];

    for (const job of jobs) {
      if (!job.recoveryId) continue;
      if (!this.includeDisabled && job.enabled === false) continue;
      const key = accountKey(job);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ job, key });
    }

    return result;
  }

  async status() {
    const [state, accounts] = await Promise.all([
      this.readState(),
      this.accountJobs(),
    ]);
    const today = this.today();
    const configuredKeys = new Set(accounts.map((account) => account.key));

    const records = accounts.map(({ job, key }) => {
      const stored = state.accounts[key] || {};
      const isCurrentDay = stored.lastAttemptDay === today;
      const staleRunning = isCurrentDay && isStaleRunningAttempt(stored);
      const status = isCurrentDay ? (staleRunning ? 'failed' : stored.status || 'never') : 'never';
      const error = isCurrentDay
        ? (staleRunning ? stored.error || '上次执行异常中断，可重新执行。' : stored.error || '')
        : '';
      return publicRecord({
        key,
        name: job.name,
        script: job.script,
        enabled: job.enabled !== false,
        recoveryIdMasked: maskSecret(job.recoveryId),
        status: 'never',
        ...stored,
        name: stored.name || job.name,
        script: stored.script || job.script,
        enabled: job.enabled !== false,
        recoveryIdMasked: maskSecret(job.recoveryId),
        status,
        error,
      });
    });

    for (const [key, record] of Object.entries(state.accounts)) {
      if (!configuredKeys.has(key)) records.push(publicRecord({ key, removed: true, ...record }));
    }

    return {
      dayKey: today,
      updatedAt: state.updatedAt || '',
      lastRunAt: state.lastRunAt || '',
      records: records.sort((a, b) => (
        (b.cultivationBonusPercent || 0) - (a.cultivationBonusPercent || 0)
        || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
      )),
      runs: state.runs.slice(0, 20),
    };
  }

  async persistRecord(key, patch) {
    let record;
    await this.updateState((state) => {
      state.accounts[key] = {
        ...(state.accounts[key] || {}),
        ...patch,
        updatedAt: nowIso(),
      };
      record = state.accounts[key];
    });
    await this.publishStatus();
    return record;
  }

  async reserveAttempt(job, key, runDay, options = {}) {
    const attemptedAt = nowIso();
    let reservation;

    await this.updateState((state) => {
      const existing = state.accounts[key] || {};
      const staleRunning = isStaleRunningAttempt(existing);
      if (!options.force && existing.lastAttemptDay === runDay && !staleRunning) {
        reservation = {
          reserved: false,
          key,
          name: job.name,
          status: 'skipped',
          reason: existing.status === 'running' ? 'running' : 'already-attempted',
        };
        return;
      }

      state.accounts[key] = {
        ...existing,
        name: job.name,
        script: job.script,
        recoveryIdMasked: maskSecret(job.recoveryId),
        lastAttemptDay: runDay,
        lastAttemptAt: attemptedAt,
        status: 'running',
        error: '',
        updatedAt: attemptedAt,
      };
      reservation = {
        reserved: true,
        record: state.accounts[key],
      };
    });

    if (reservation?.reserved) await this.publishStatus();
    return reservation;
  }

  async cultivateAccount(job, key, runDay, options = {}) {
    const reservation = await this.reserveAttempt(job, key, runDay, options);
    if (!reservation?.reserved) {
      return {
        ...reservation,
        key,
        name: job.name,
      };
    }

    try {
      const { result, state: nextState } = await this.xiuxianService.cultivateManual(job, {
        cidPrefix: 'daily-cultivate',
      });
      const snapshot = cultivationSnapshot(nextState.player);
      const record = await this.persistRecord(key, {
        ...snapshot,
        name: job.name,
        script: job.script,
        recoveryIdMasked: maskSecret(job.recoveryId),
        lastAttemptDay: runDay,
        lastSuccessDay: runDay,
        lastSuccessAt: nowIso(),
        gainedExp: numberOrNull(result?.gained_exp),
        gainedQi: numberOrNull(result?.gained_qi),
        status: 'success',
        summary: summarizeCultivationResult(result),
        error: '',
      });

      await this.logService.append(LOG_NAME, `[${nowIso()}] ${job.name} 修炼完成 streak=${record.cultivationStreak} bonus=${record.cultivationBonusPercent}% | ${record.summary}\n`);
      return {
        key,
        name: job.name,
        status: 'success',
        record: publicRecord(record),
      };
    } catch (error) {
      const record = await this.persistRecord(key, {
        name: job.name,
        script: job.script,
        recoveryIdMasked: maskSecret(job.recoveryId),
        lastAttemptDay: runDay,
        lastFailureAt: nowIso(),
        status: 'failed',
        error: formatError(error),
      });

      await this.logService.append(LOG_NAME, `[${nowIso()}] ${job.name} 修炼失败: ${record.error}\n`);
      return {
        key,
        name: job.name,
        status: 'failed',
        error: record.error,
        record: publicRecord(record),
      };
    }
  }

  async runAll(options = {}) {
    if (this.activeRun) {
      const skippedAt = nowIso();
      await this.logService.append(LOG_NAME, `[${skippedAt}] 每日修炼跳过: 已有执行中的批次 trigger=${options.trigger || 'manual'}\n`);
      return {
        dayKey: options.dayKey || this.today(),
        trigger: options.trigger || 'manual',
        startedAt: skippedAt,
        finishedAt: skippedAt,
        skipped: true,
        reason: 'running',
        results: [],
      };
    }

    this.activeRun = this.runAllLocked(options).finally(() => {
      this.activeRun = null;
    });
    return this.activeRun;
  }

  async runAllLocked(options = {}) {
    const runDay = options.dayKey || this.today();
    const accounts = await this.accountJobs();
    const startedAt = nowIso();
    const results = [];

    await this.logService.append(LOG_NAME, `\n[${startedAt}] 每日修炼开始 day=${runDay} accounts=${accounts.length} force=${Boolean(options.force)}\n`);

    for (const { job, key } of accounts) {
      results.push(await this.cultivateAccount(job, key, runDay, options));
    }

    const run = {
      dayKey: runDay,
      trigger: options.trigger || 'manual',
      startedAt,
      finishedAt: nowIso(),
      total: results.length,
      success: results.filter((item) => item.status === 'success').length,
      failed: results.filter((item) => item.status === 'failed').length,
      skipped: results.filter((item) => item.status === 'skipped').length,
    };

    await this.updateState((state) => {
      state.lastRunAt = run.finishedAt;
      state.runs = [run, ...state.runs].slice(0, 50);
    });
    await this.publishStatus();
    await this.logService.append(LOG_NAME, `[${run.finishedAt}] 每日修炼结束 success=${run.success} failed=${run.failed} skipped=${run.skipped}\n`);

    return {
      ...run,
      results,
    };
  }
}

module.exports = {
  DailyCultivationService,
  cultivationSnapshot,
  isStaleRunningAttempt,
  LOG_NAME,
};
