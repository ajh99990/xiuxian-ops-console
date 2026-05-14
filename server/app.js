const express = require('express');

function mergeJobsWithExistingSecrets(incoming, previous) {
  const previousByName = new Map(previous.map((job) => [job.name, job]));

  return incoming.map((job) => {
    const previousJob = previousByName.get(String(job?.name || '').trim())
      || previousByName.get(String(job?.previousName || '').trim());
    if (!previousJob) return job;

    return {
      ...job,
      recoveryId: Object.prototype.hasOwnProperty.call(job, 'recoveryId') ? job.recoveryId : previousJob.recoveryId,
      token: Object.prototype.hasOwnProperty.call(job, 'token') ? job.token : previousJob.token,
    };
  });
}

function createDashboardApp(options = {}) {
  const {
    accountStore,
    dailyCultivationService,
    eventBus,
    gameProxy,
    jobManager,
    logService,
    roleStateService,
    scheduler,
  } = options;

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/scripts', (req, res) => {
    res.json(accountStore.scripts());
  });

  app.get('/api/jobs', async (req, res, next) => {
    try {
      res.json(await jobManager.list());
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/jobs', async (req, res, next) => {
    try {
      const previous = await accountStore.read();
      const before = new Set(previous.map((job) => job.name));
      const incoming = Array.isArray(req.body?.jobs) ? req.body.jobs : [];
      const merged = mergeJobsWithExistingSecrets(incoming, previous);
      const updated = await accountStore.write(merged);
      const after = new Set(updated.map((job) => job.name));

      for (const name of before) {
        if (!after.has(name)) await jobManager.stop(name);
      }
      for (const job of updated) {
        if (job.enabled === false) await jobManager.stop(job.name);
      }

      const publicJobs = updated.map((job) => jobManager.publicJob(job));
      eventBus.publish('config', { jobs: publicJobs });
      res.json(publicJobs);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jobs/:name/start', async (req, res, next) => {
    try {
      res.json(await jobManager.start(req.params.name, { force: true }));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jobs/:name/stop', async (req, res, next) => {
    try {
      res.json(await jobManager.stop(req.params.name));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jobs/start-all', async (req, res, next) => {
    try {
      res.json(await jobManager.startAll());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jobs/stop-all', async (req, res, next) => {
    try {
      res.json(await jobManager.stopAll());
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/jobs/:name/logs', async (req, res, next) => {
    try {
      res.type('text/plain').send(await logService.read(req.params.name, Number(req.query.limit || 300)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jobs/:name/logs/clear', async (req, res, next) => {
    try {
      await logService.clear(req.params.name);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/schedules', (req, res) => {
    res.json(scheduler?.list?.() || []);
  });

  app.post('/api/schedules/:name/run', async (req, res, next) => {
    try {
      if (!scheduler) throw new Error('scheduler is not available');
      res.json(await scheduler.runNow(req.params.name));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/daily-cultivation', async (req, res, next) => {
    try {
      if (!dailyCultivationService) throw new Error('daily cultivation service is not available');
      res.json(await dailyCultivationService.status());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/daily-cultivation/run', async (req, res, next) => {
    try {
      if (!dailyCultivationService) throw new Error('daily cultivation service is not available');
      res.json(await dailyCultivationService.runAll({
        force: Boolean(req.body?.force),
        trigger: 'manual',
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/role-states', async (req, res, next) => {
    try {
      if (!roleStateService) throw new Error('role state service is not available');
      res.json(await roleStateService.status());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/role-states/refresh', async (req, res, next) => {
    try {
      if (!roleStateService) throw new Error('role state service is not available');
      res.json(await roleStateService.refreshAll({ trigger: 'manual' }));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/role-states/report', async (req, res, next) => {
    try {
      if (!roleStateService) throw new Error('role state service is not available');
      res.json(await roleStateService.recordReport(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/events', (req, res) => {
    eventBus.handleEvents(req, res);
  });

  app.get('/game', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('html').send(gameProxy.gameBootstrapPage(req.query.recoveryId));
  });

  app.get(/^\/game-assets\/(.+)/, gameProxy.proxyAsset);
  app.get(/^\/game-proxy\/?$/, gameProxy.proxyPage);

  return app;
}

module.exports = {
  createDashboardApp,
  mergeJobsWithExistingSecrets,
};
