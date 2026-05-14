const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const config = require('./config');
const { createDashboardApp } = require('./app');
const { createEventBus } = require('./event-bus');
const { createGameProxy } = require('./game-proxy');
const { createScheduler } = require('./scheduler');
const { createScheduledTasks } = require('./scheduler/tasks');
const { AccountStore } = require('./services/account-store');
const { DailyCultivationService } = require('./services/daily-cultivation-service');
const { JobManager } = require('./services/job-manager');
const { JsonStore } = require('./services/json-store');
const { LogService } = require('./services/log-service');
const { RoleStateService } = require('./services/role-state-service');
const { XiuxianService } = require('./services/xiuxian-service');

async function ensureRuntime() {
  await fsp.mkdir(config.runtimeDir, { recursive: true });
}

function attachFrontend(app, server) {
  if (process.env.NODE_ENV === 'production') {
    const dist = path.join(config.root, 'dist');
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
    return Promise.resolve(null);
  }

  return import('vite').then(async ({ createServer: createViteServer }) => {
    const vite = await createViteServer({
      root: config.root,
      server: {
        middlewareMode: true,
        hmr: { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    return vite;
  });
}

function attachErrorHandler(app) {
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(400).json({ error: error.message || String(error) });
  });
}

async function createRuntime() {
  await ensureRuntime();

  const eventBus = createEventBus();
  const accountStore = new AccountStore({
    configPath: config.configPath,
    scriptAllowlist: config.scriptAllowlist,
  });
  const logService = new LogService({
    logDir: config.logDir,
    maxBytes: config.logMaxBytes,
    eventBus,
  });
  await logService.ensure();

  const jobManager = new JobManager({
    root: config.root,
    accountStore,
    logService,
    eventBus,
    roleStateReportUrl: process.env.XIUXIAN_ROLE_STATE_REPORT_URL || `http://${config.host}:${config.port}/api/role-states/report`,
  });
  const xiuxianService = new XiuxianService();
  const dailyCultivationService = new DailyCultivationService({
    accountStore,
    eventBus,
    includeDisabled: config.dailyCultivationIncludeDisabled,
    logService,
    store: new JsonStore({
      filePath: config.dailyCultivationStatePath,
      defaultValue: { version: 1, accounts: {}, runs: [] },
    }),
    timezone: config.timezone,
    xiuxianService,
  });
  const roleStateService = new RoleStateService({
    accountStore,
    eventBus,
    jobManager,
    logService,
    store: new JsonStore({
      filePath: config.roleStatePath,
      defaultValue: { version: 1, roles: {}, refreshes: [] },
    }),
    xiuxianService,
  });
  const scheduler = createScheduler({
    accountStore,
    dailyCultivationService,
    eventBus,
    jobManager,
    logService,
    logger: console,
    timezone: config.timezone,
  });
  scheduler.registerMany(createScheduledTasks({
    accountStore,
    dailyCultivationCron: config.dailyCultivationCron,
    dailyCultivationService,
    eventBus,
    jobManager,
    logCleanupCron: config.logCleanupCron,
    logCleanupMaxLines: config.logCleanupMaxLines,
    logService,
    roleStateRefreshCron: config.roleStateRefreshCron,
    roleStateService,
    timezone: config.timezone,
  }));

  const app = createDashboardApp({
    accountStore,
    eventBus,
    gameProxy: createGameProxy({ origin: config.gameOrigin }),
    jobManager,
    dailyCultivationService,
    logService,
    roleStateService,
    scheduler,
  });

  return {
    accountStore,
    app,
    dailyCultivationService,
    eventBus,
    jobManager,
    logService,
    roleStateService,
    scheduler,
    xiuxianService,
  };
}

async function startServer() {
  const runtime = await createRuntime();
  const server = http.createServer(runtime.app);
  const vite = await attachFrontend(runtime.app, server);
  attachErrorHandler(runtime.app);

  await new Promise((resolve) => {
    server.listen(config.port, config.host, () => {
      console.log(`Xiuxian dashboard: http://${config.host}:${config.port}`);
      resolve();
    });
  });

  if (config.schedulerEnabled) {
    runtime.scheduler.startAll();
  } else {
    console.log('[scheduler] disabled by XIUXIAN_SCHEDULER_ENABLED=false');
  }

  const shutdown = async () => {
    runtime.scheduler.stopAll();
    await runtime.jobManager.stopAll();
    await vite?.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 4000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return {
    ...runtime,
    server,
    vite,
  };
}

module.exports = {
  createRuntime,
  startServer,
};
