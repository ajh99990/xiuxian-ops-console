function createScheduledTasks(context = {}) {
  const tasks = [];

  if (context.dailyCultivationService) {
    tasks.push({
      name: 'daily-cultivate',
      schedule: context.dailyCultivationCron || '0 5 0 * * *',
      timezone: context.timezone || 'Asia/Shanghai',
      noOverlap: true,
      async run({ trigger }) {
        return context.dailyCultivationService.runAll({ trigger });
      },
    });
  }

  if (context.roleStateService) {
    tasks.push({
      name: 'role-state-refresh',
      schedule: context.roleStateRefreshCron || '0 */5 * * * *',
      timezone: context.timezone || 'Asia/Shanghai',
      noOverlap: true,
      async run({ trigger }) {
        return context.roleStateService.refreshAll({ trigger });
      },
    });
  }

  if (context.logService) {
    tasks.push({
      name: 'log-cleanup',
      schedule: context.logCleanupCron || '0 0 * * * *',
      timezone: context.timezone || 'Asia/Shanghai',
      noOverlap: true,
      async run() {
        return context.logService.cleanup({ maxLines: context.logCleanupMaxLines || 100 });
      },
    });
  }

  return tasks;
}

module.exports = {
  createScheduledTasks,
};
