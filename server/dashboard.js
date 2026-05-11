const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const express = require('express');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'accounts.config.json');
const RUNTIME_DIR = path.join(ROOT, '.runtime');
const LOG_DIR = path.join(RUNTIME_DIR, 'logs');
const PORT = Number(process.env.XIUXIAN_DASHBOARD_PORT || 4177);
const HOST = process.env.XIUXIAN_DASHBOARD_HOST || '127.0.0.1';
const LOG_MAX_BYTES = Number(process.env.XIUXIAN_LOG_MAX_BYTES || 256 * 1024);
const GAME_ORIGIN = process.env.XIUXIAN_GAME_ORIGIN || 'https://xx.liulabinfo.org';
const SCRIPT_ALLOWLIST = new Set(['auto-priority.js', 'auto-xiulian.js', 'auto-fudi.js', 'auto-danger.js', 'auto-forage.js']);

const jobs = new Map();
const subscribers = new Set();

function nowIso() {
  return new Date().toISOString();
}

function safeName(name) {
  return String(name || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function maskSecret(value) {
  const secret = String(value || '');
  if (!secret) return '';
  if (secret.length <= 18) return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
  return `${secret.slice(0, 10)}...${secret.slice(-8)}`;
}

function trimTextBytes(text, maxBytes) {
  const buffer = Buffer.from(text);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || buffer.length <= maxBytes) return text;

  const sliced = buffer.subarray(buffer.length - maxBytes).toString();
  const firstBreak = sliced.indexOf('\n');
  return firstBreak >= 0 ? sliced.slice(firstBreak + 1) : sliced;
}

function parseArgs(args) {
  if (Array.isArray(args)) return args.map(String).filter(Boolean);
  if (typeof args !== 'string') return [];
  return args.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeJob(raw) {
  const job = raw && typeof raw === 'object' ? raw : {};
  const name = String(job.name || '').trim();
  const script = String(job.script || '').trim();

  if (name.length < 1 || name.length > 80 || /[\/\\\0]/.test(name)) {
    throw new Error(`任务名不合法：${name || '(empty)'}`);
  }
  if (!SCRIPT_ALLOWLIST.has(script)) throw new Error(`脚本不在白名单：${script}`);

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

async function ensureRuntime() {
  await fsp.mkdir(LOG_DIR, { recursive: true });
}

async function readConfig() {
  try {
    const text = await fsp.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeJob);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeConfig(config) {
  const normalized = config.map(normalizeJob);
  const seen = new Set();

  for (const job of normalized) {
    if (seen.has(job.name)) throw new Error(`任务名重复：${job.name}`);
    seen.add(job.name);
  }

  await fsp.writeFile(CONFIG_PATH, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  return normalized;
}

function publish(type, payload = {}) {
  const event = JSON.stringify({ type, at: nowIso(), ...payload });

  for (const res of subscribers) {
    res.write(`data: ${event}\n\n`);
  }
}

function logPath(name) {
  return path.join(LOG_DIR, `${safeName(name)}.log`);
}

async function appendLog(name, chunk) {
  const text = chunk.toString();
  const file = logPath(name);
  await fsp.appendFile(file, text);
  await trimLogFile(file);
  publish('log', { name, text });
}

async function trimLogFile(file) {
  if (!Number.isFinite(LOG_MAX_BYTES) || LOG_MAX_BYTES <= 0) return;

  try {
    const stat = await fsp.stat(file);
    if (stat.size <= LOG_MAX_BYTES) return;

    const text = await fsp.readFile(file, 'utf8');
    await fsp.writeFile(file, trimTextBytes(text, LOG_MAX_BYTES));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function runtimeStatus(name) {
  const runtime = jobs.get(name);
  if (!runtime) return { running: false };

  return {
    running: true,
    pid: runtime.child.pid,
    startedAt: runtime.startedAt,
    script: runtime.job.script,
    restarts: runtime.restarts,
  };
}

function publicJob(job) {
  return {
    ...job,
    recoveryIdMasked: maskSecret(job.recoveryId),
    hasRecoveryId: Boolean(job.recoveryId),
    token: undefined,
    tokenMasked: maskSecret(job.token),
    hasToken: Boolean(job.token),
    runtime: runtimeStatus(job.name),
  };
}

async function listJobs() {
  const config = await readConfig();
  return config.map(publicJob);
}

async function findJob(name) {
  const config = await readConfig();
  return config.find((job) => job.name === name) || null;
}

async function startJob(name, options = {}) {
  const job = await findJob(name);
  if (!job) throw new Error(`任务不存在：${name}`);
  if (!job.enabled && !options.force) throw new Error(`任务未启用：${name}`);
  if (jobs.has(name)) return runtimeStatus(name);

  const scriptPath = path.join(ROOT, job.script);
  if (!fs.existsSync(scriptPath)) throw new Error(`脚本不存在：${job.script}`);

  const runtime = {
    job,
    child: null,
    startedAt: nowIso(),
    restarts: 0,
  };

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

  const child = spawn(process.execPath, [scriptPath, ...job.args], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  runtime.child = child;
  jobs.set(name, runtime);

  await appendLog(name, `\n[dashboard ${nowIso()}] started pid=${child.pid} script=${job.script}\n`);
  publish('status', { name, status: runtimeStatus(name) });

  child.stdout.on('data', (chunk) => appendLog(name, chunk).catch(() => {}));
  child.stderr.on('data', (chunk) => appendLog(name, chunk).catch(() => {}));
  child.on('exit', async (code, signal) => {
    jobs.delete(name);
    await appendLog(name, `[dashboard ${nowIso()}] exited code=${code ?? '-'} signal=${signal ?? '-'}\n`);
    publish('status', { name, status: runtimeStatus(name) });
  });

  return runtimeStatus(name);
}

async function stopJob(name) {
  const runtime = jobs.get(name);
  if (!runtime) return { running: false };

  await appendLog(name, `[dashboard ${nowIso()}] stopping pid=${runtime.child.pid}\n`);

  runtime.child.kill('SIGTERM');

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (jobs.has(name)) runtime.child.kill('SIGKILL');
      resolve();
    }, 3000);
    runtime.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  return runtimeStatus(name);
}

async function startAll() {
  const config = await readConfig();
  const results = [];

  for (const job of config.filter((item) => item.enabled)) {
    try {
      results.push({ name: job.name, status: await startJob(job.name) });
    } catch (error) {
      results.push({ name: job.name, error: error.message });
    }
  }

  return results;
}

async function stopAll() {
  const names = [...jobs.keys()];
  const results = [];

  for (const name of names) {
    results.push({ name, status: await stopJob(name) });
  }

  return results;
}

async function readLogs(name, limit = 300) {
  const file = logPath(name);

  try {
    const text = await fsp.readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - limit)).join('\n');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

async function clearLogs(name) {
  await fsp.writeFile(logPath(name), '');
  publish('log_reset', { name });
}

function patchGameAsset(text) {
  return text
    .replace(
      /function\s+([A-Za-z_$][\w$]*)\(\)\{const\s+([A-Za-z_$][\w$]*)=Ps\(\);return\s+\2==="xx\.liulabinfo\.org"\?"xxapi\.liulabinfo\.org":\2\|\|"127\.0\.0\.1"\}/g,
      'function $1(){return"xxapi.liulabinfo.org"}',
    )
    .replace(
      /function\s+([A-Za-z_$][\w$]*)\(\)\{return\s+[A-Za-z_$][\w$]*\(Ps\(\)\)\?"443":"7350"\}/g,
      'function $1(){return"443"}',
    )
    .replace(
      /function\s+([A-Za-z_$][\w$]*)\(\)\{return\s+[A-Za-z_$][\w$]*\(Ps\(\)\)\}/g,
      'function $1(){return true}',
    )
    .replace(
      /new\s+([A-Za-z_$][\w$]*)\("supersecret_dev_key",[A-Za-z_$][\w$]*\(\),[A-Za-z_$][\w$]*\(\),[A-Za-z_$][\w$]*\)/g,
      'new $1("supersecret_dev_key","xxapi.liulabinfo.org","443",true)',
    );
}

async function proxyGameAsset(req, res, next) {
  try {
    const assetPath = req.params[0] || '';
    const upstream = new URL(`/assets/${assetPath}`, GAME_ORIGIN);
    const response = await fetch(upstream);
    const type = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await response.arrayBuffer());

    res.set('Cache-Control', 'no-store');
    res.type(type);
    if (type.includes('javascript')) {
      res.send(patchGameAsset(buffer.toString('utf8')));
    } else {
      res.send(buffer);
    }
  } catch (error) {
    next(error);
  }
}

async function proxyGamePage(req, res, next) {
  try {
    const upstream = new URL('/', GAME_ORIGIN);
    const response = await fetch(upstream);
    let html = await response.text();
    html = html
      .replace(/(src|href)=["']\/assets\//g, '$1="/game-assets/')
      .replace(/<base[^>]*>/gi, '');
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html);
  } catch (error) {
    next(error);
  }
}

function gameBootstrapPage(recoveryId) {
  const encodedRecoveryId = JSON.stringify(String(recoveryId || ''));
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>修仙 WebView</title>
  </head>
  <body>
    <script>
      const recoveryId = ${encodedRecoveryId};
      if (recoveryId) {
        localStorage.setItem('xiuxian.device.id', recoveryId);
        localStorage.removeItem('xiuxian.session.token');
        localStorage.removeItem('xiuxian.session.refresh');
      }
      location.replace('/game-proxy/');
    </script>
  </body>
</html>`;
}

async function createServer() {
  await ensureRuntime();

  const app = express();
  let server = null;
  let vite = null;

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/scripts', (req, res) => {
    res.json([...SCRIPT_ALLOWLIST]);
  });

  app.get('/api/jobs', async (req, res, next) => {
    try {
      res.json(await listJobs());
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/jobs', async (req, res, next) => {
    try {
      const previous = await readConfig();
      const previousByName = new Map(previous.map((job) => [job.name, job]));
      const before = new Set(previous.map((job) => job.name));
      const incoming = Array.isArray(req.body?.jobs) ? req.body.jobs : [];
      const merged = incoming.map((job) => {
        const previousJob = previousByName.get(String(job?.name || '').trim())
          || previousByName.get(String(job?.previousName || '').trim());
        if (!previousJob) return job;

        return {
          ...job,
          recoveryId: Object.prototype.hasOwnProperty.call(job, 'recoveryId') ? job.recoveryId : previousJob.recoveryId,
          token: Object.prototype.hasOwnProperty.call(job, 'token') ? job.token : previousJob.token,
        };
      });
      const updated = await writeConfig(merged);
      const after = new Set(updated.map((job) => job.name));

      for (const name of before) {
        if (!after.has(name)) await stopJob(name);
      }

      publish('config', { jobs: updated.map(publicJob) });
      res.json(updated.map(publicJob));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jobs/:name/start', async (req, res, next) => {
    try {
      res.json(await startJob(req.params.name, { force: true }));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jobs/:name/stop', async (req, res, next) => {
    try {
      res.json(await stopJob(req.params.name));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jobs/start-all', async (req, res, next) => {
    try {
      res.json(await startAll());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jobs/stop-all', async (req, res, next) => {
    try {
      res.json(await stopAll());
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/jobs/:name/logs', async (req, res, next) => {
    try {
      res.type('text/plain').send(await readLogs(req.params.name, Number(req.query.limit || 300)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jobs/:name/logs/clear', async (req, res, next) => {
    try {
      await clearLogs(req.params.name);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/game', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('html').send(gameBootstrapPage(req.query.recoveryId));
  });

  app.get(/^\/game-assets\/(.+)/, proxyGameAsset);
  app.get(/^\/game-proxy\/?$/, proxyGamePage);

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');
    subscribers.add(res);
    req.on('close', () => subscribers.delete(res));
  });

  if (process.env.NODE_ENV === 'production') {
    const dist = path.join(ROOT, 'dist');
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    const { createServer: createViteServer } = await import('vite');
    server = http.createServer(app);
    vite = await createViteServer({
      root: ROOT,
      server: {
        middlewareMode: true,
        hmr: { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(400).json({ error: error.message || String(error) });
  });

  if (!server) server = http.createServer(app);

  server.listen(PORT, HOST, () => {
    console.log(`Xiuxian dashboard: http://${HOST}:${PORT}`);
  });

  const shutdown = async () => {
    await stopAll();
    await vite?.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 4000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

createServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
