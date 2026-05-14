const cron = require('node-cron');

function createScheduledTask(definition, context = {}) {
  const {
    name,
    schedule,
    timezone = context.timezone || 'Asia/Shanghai',
    disabled = false,
    immediate = false,
    noOverlap = true,
    run,
  } = definition;

  if (!name) throw new Error('scheduled task missing name');
  if (!schedule) throw new Error(`scheduled task ${name} missing cron schedule`);
  if (typeof run !== 'function') throw new Error(`scheduled task ${name} missing run()`);
  if (!cron.validate(schedule)) throw new Error(`scheduled task ${name} has invalid cron: ${schedule}`);

  let task = null;
  let running = false;
  let started = false;
  let lastStartedAt = null;
  let lastFinishedAt = null;
  let lastError = null;

  async function execute(trigger = 'cron') {
    if (disabled) return { skipped: true, reason: 'disabled' };
    if (noOverlap && running) return { skipped: true, reason: 'running' };

    running = true;
    lastStartedAt = new Date().toISOString();
    lastError = null;

    try {
      const result = await run({ ...context, trigger, taskName: name });
      return { ok: true, result };
    } catch (error) {
      lastError = error.message || String(error);
      context.logger?.error?.(`[scheduler] ${name} failed: ${lastError}`);
      return { ok: false, error: lastError };
    } finally {
      running = false;
      lastFinishedAt = new Date().toISOString();
    }
  }

  function start() {
    if (disabled || started) return;
    task = cron.createTask(schedule, () => execute('cron'), { name, timezone });
    task.start();
    started = true;
    context.logger?.log?.(`[scheduler] started ${name} cron="${schedule}" timezone=${timezone}`);
    if (immediate) execute('immediate');
  }

  function stop() {
    if (!task) return;
    task.stop();
    task.destroy();
    task = null;
    started = false;
    context.logger?.log?.(`[scheduler] stopped ${name}`);
  }

  function status() {
    return {
      name,
      schedule,
      timezone,
      disabled,
      started,
      running,
      lastStartedAt,
      lastFinishedAt,
      lastError,
    };
  }

  return {
    execute,
    start,
    status,
    stop,
  };
}

module.exports = {
  createScheduledTask,
};
