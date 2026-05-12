const fsp = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_TOKEN = '';
const DEFAULT_SERVER_KEY = 'supersecret_dev_key';
const DEFAULT_SESSION_CACHE_DIR = path.join(__dirname, '.runtime', 'sessions');
const SESSION_REFRESH_WINDOW_MS = 60_000;
const CONNECT_RENEW_COOLDOWN_MS = 10_000;

function now() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonMaybe(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function unwrapRpcPayload(rpcResponse) {
  if (!rpcResponse?.payload) return {};
  const parsed = parseJsonMaybe(rpcResponse.payload);
  return parsed?.data ?? parsed;
}

function formatError(error) {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  return JSON.stringify(error);
}

function makeConnectError(message, code = 'XIUXIAN_WS_CONNECT_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function parseJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(decodeBase64Url(parts[1]));
  } catch {
    return null;
  }
}

function tokenExpiresAt(token) {
  const exp = Number(parseJwtPayload(token)?.exp);
  return Number.isFinite(exp) ? exp * 1000 : null;
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function isTokenUsable(token, refreshWindowMs = 30_000) {
  if (!token || token === 'YOUR_TOKEN_HERE') return false;

  const expiresAt = tokenExpiresAt(token);
  return expiresAt === null || expiresAt > Date.now() + refreshWindowMs;
}

function assertUsableToken(token) {
  if (!token || token === 'YOUR_TOKEN_HERE') throw new Error('missing token');

  const expiresAt = tokenExpiresAt(token);
  if (expiresAt !== null && expiresAt <= Date.now() + 30_000) {
    throw new Error(`token 已过期或即将过期，到期时间：${formatDate(expiresAt)}。请设置 XIUXIAN_RECOVERY_ID 或 XIUXIAN_TOKEN。`);
  }
}

function envNumber(names, fallback) {
  for (const name of names) {
    if (process.env[name] !== undefined) return Number(process.env[name]);
  }
  return fallback;
}

function envString(names, fallback) {
  for (const name of names) {
    if (process.env[name] !== undefined) return process.env[name];
  }
  return fallback;
}

function makeNakamaConfig(options = {}) {
  const tokenEnvNames = options.tokenEnvNames || ['XIUXIAN_TOKEN', 'XIULIAN_TOKEN'];
  const refreshTokenEnvNames = options.refreshTokenEnvNames || ['XIUXIAN_REFRESH_TOKEN', 'XIULIAN_REFRESH_TOKEN'];
  const recoveryIdEnvNames = options.recoveryIdEnvNames || ['XIUXIAN_RECOVERY_ID', 'XIULIAN_RECOVERY_ID'];

  return {
    host: envString(['XIUXIAN_HOST', 'XIULIAN_HOST'], 'xxapi.liulabinfo.org'),
    port: envString(['XIUXIAN_PORT', 'XIULIAN_PORT'], '443'),
    ssl: envString(['XIUXIAN_SSL', 'XIULIAN_SSL'], 'true') !== 'false',
    status: envString(['XIUXIAN_STATUS', 'XIULIAN_STATUS'], 'true') !== 'false',
    serverKey: envString(['XIUXIAN_SERVER_KEY', 'XIULIAN_SERVER_KEY'], DEFAULT_SERVER_KEY),
    recoveryId: envString(recoveryIdEnvNames, options.recoveryId || ''),
    token: envString(tokenEnvNames, DEFAULT_TOKEN),
    refreshToken: envString(refreshTokenEnvNames, options.refreshToken || ''),
    sessionCacheDir: envString(['XIUXIAN_SESSION_CACHE_DIR', 'XIULIAN_SESSION_CACHE_DIR'], options.sessionCacheDir || DEFAULT_SESSION_CACHE_DIR),
    authCreate: envString(['XIUXIAN_AUTH_CREATE', 'XIULIAN_AUTH_CREATE'], 'true') !== 'false',
    authVars: options.authVars || { client: 'mobile-web' },
    requestTimeoutMs: envNumber(['XIUXIAN_TIMEOUT_MS', 'XIULIAN_TIMEOUT_MS'], 12000),
    heartbeatMs: envNumber(['XIUXIAN_HEARTBEAT_MS', 'XIULIAN_HEARTBEAT_MS'], 25000),
    connectRenewCooldownMs: envNumber(['XIUXIAN_CONNECT_RENEW_COOLDOWN_MS', 'XIULIAN_CONNECT_RENEW_COOLDOWN_MS'], options.connectRenewCooldownMs ?? CONNECT_RENEW_COOLDOWN_MS),
    cidPrefix: options.cidPrefix || 'rpc',
    verbose: Boolean(options.verbose),
  };
}

function getPosition(player) {
  return {
    x: Number(player?.position?.tile_x ?? 0),
    y: Number(player?.position?.tile_y ?? 0),
  };
}

function getStamina(player) {
  const stamina = Number(player?.resources?.stamina);
  return Number.isFinite(stamina) ? stamina : null;
}

function getExploreEndTime(player) {
  const raw = player?.timers?.exploring_ends_at;
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isExploring(player) {
  return Boolean(player?.flags?.is_exploring || getExploreEndTime(player));
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function zonesByType(state, zoneType) {
  return (state?.visible_zones || [])
    .filter((zone) => zone?.zone_type === zoneType)
    .map((zone) => ({
      ...zone,
      tile_x: Number(zone.tile_x),
      tile_y: Number(zone.tile_y),
    }))
    .filter((zone) => Number.isFinite(zone.tile_x) && Number.isFinite(zone.tile_y));
}

function chooseNearestZone(state, zoneType) {
  const playerPos = getPosition(state?.player);
  return zonesByType(state, zoneType)
    .map((zone) => ({
      ...zone,
      distance_to_player: manhattan(playerPos, { x: zone.tile_x, y: zone.tile_y }),
    }))
    .sort((a, b) => a.distance_to_player - b.distance_to_player)[0] || null;
}

function nextDirectionToTarget(player, target) {
  const { x, y } = getPosition(player);
  const dx = target.tile_x - x;
  const dy = target.tile_y - y;

  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? 'east' : 'west';
  return dy > 0 ? 'south' : 'north';
}

function directionLabel(direction) {
  return {
    north: '北',
    south: '南',
    west: '西',
    east: '东',
  }[direction] || direction;
}

function logsOf(result) {
  return Array.isArray(result?.logs) ? result.logs.join('；') : '';
}

function safeFilePart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
}

function makeApiBaseUrl(config) {
  const protocol = config.ssl ? 'https' : 'http';
  return `${protocol}://${config.host}:${config.port}`;
}

function makeBasicAuth(serverKey) {
  return `Basic ${Buffer.from(`${serverKey || DEFAULT_SERVER_KEY}:`).toString('base64')}`;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

class NakamaSocketClient {
  constructor(config) {
    this.config = { ...config };
    this.socket = null;
    this.pending = new Map();
    this.cid = 0;
    this.heartbeatTimer = null;
    this.sessionLoaded = false;
    this.lastConnectRenewalAt = 0;
  }

  get url() {
    const protocol = this.config.ssl ? 'wss' : 'ws';
    const token = encodeURIComponent(this.config.token);
    const status = encodeURIComponent(String(this.config.status));
    return `${protocol}://${this.config.host}:${this.config.port}/ws?lang=en&status=${status}&token=${token}`;
  }

  get isOpen() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  nextCid() {
    this.cid += 1;
    return `${this.config.cidPrefix || 'rpc'}-${Date.now()}-${this.cid}`;
  }

  get sessionCachePath() {
    if (!this.config.recoveryId || !this.config.sessionCacheDir) return null;
    return path.join(this.config.sessionCacheDir, `${safeFilePart(this.config.recoveryId)}.json`);
  }

  async loadCachedSession() {
    if (this.sessionLoaded) return;
    this.sessionLoaded = true;

    const cachePath = this.sessionCachePath;
    if (!cachePath) return;

    try {
      const cached = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
      if (cached.recoveryId !== this.config.recoveryId) return;
      if (cached.token) this.config.token = cached.token;
      if (cached.refreshToken) this.config.refreshToken = cached.refreshToken;
    } catch (error) {
      if (error.code !== 'ENOENT' && this.config.verbose) {
        console.warn(`[${now()}] session cache read failed: ${formatError(error)}`);
      }
    }
  }

  async saveCachedSession() {
    const cachePath = this.sessionCachePath;
    if (!cachePath || !this.config.token || !this.config.refreshToken) return;

    const payload = {
      recoveryId: this.config.recoveryId,
      token: this.config.token,
      refreshToken: this.config.refreshToken,
      tokenExpiresAt: tokenExpiresAt(this.config.token),
      refreshTokenExpiresAt: tokenExpiresAt(this.config.refreshToken),
      updatedAt: new Date().toISOString(),
    };

    await fsp.mkdir(path.dirname(cachePath), { recursive: true });
    await fsp.writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  }

  async requestApi(pathname, body) {
    const response = await fetch(`${makeApiBaseUrl(this.config)}${pathname}`, {
      method: 'POST',
      headers: {
        Authorization: makeBasicAuth(this.config.serverKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(data.error || data.message || `Nakama API error ${response.status}`);
    }

    return data;
  }

  async applySession(data, action) {
    if (!data?.token) throw new Error(`${action} 未返回 token`);
    if (!data?.refresh_token) throw new Error(`${action} 未返回 refresh_token`);

    const previousToken = this.config.token;
    this.config.token = data.token;
    this.config.refreshToken = data.refresh_token;
    await this.saveCachedSession();

    if (this.config.verbose) {
      const expiresAt = tokenExpiresAt(this.config.token);
      const suffix = expiresAt ? `，到期 ${formatDate(expiresAt)}` : '';
      console.log(`[${now()}] ${action} 成功${suffix}`);
    }

    return previousToken !== this.config.token;
  }

  async authenticateWithRecoveryId() {
    if (!this.config.recoveryId) throw new Error('missing recovery id');

    const create = this.config.authCreate ? 'true' : 'false';
    const data = await this.requestApi(`/v2/account/authenticate/device?create=${create}`, {
      id: this.config.recoveryId,
      vars: this.config.authVars || { client: 'mobile-web' },
    });

    return this.applySession(data, '续玩编号登录');
  }

  async refreshSession() {
    if (!this.config.refreshToken) throw new Error('missing refresh token');

    const data = await this.requestApi('/v2/account/session/refresh', {
      token: this.config.refreshToken,
    });

    return this.applySession(data, '刷新 token');
  }

  async ensureSession() {
    await this.loadCachedSession();

    if (isTokenUsable(this.config.token, SESSION_REFRESH_WINDOW_MS)) return false;

    if (this.config.refreshToken && isTokenUsable(this.config.refreshToken, 0)) {
      try {
        return await this.refreshSession();
      } catch (error) {
        if (!this.config.recoveryId) throw error;
        if (this.config.verbose) {
          console.warn(`[${now()}] refresh token 失败，改用续玩编号登录：${formatError(error)}`);
        }
      }
    }

    if (this.config.recoveryId) return this.authenticateWithRecoveryId();

    assertUsableToken(this.config.token);
    return false;
  }

  canRenewAfterConnectError(error) {
    if (error?.code !== 'XIUXIAN_WS_CONNECT_ERROR') return false;
    if (!this.config.refreshToken && !this.config.recoveryId) return false;

    const cooldown = Number(this.config.connectRenewCooldownMs);
    if (Number.isFinite(cooldown) && cooldown > 0 && Date.now() - this.lastConnectRenewalAt < cooldown) {
      return false;
    }

    return true;
  }

  async forceRenewSessionAfterConnectError(error) {
    this.lastConnectRenewalAt = Date.now();
    await this.loadCachedSession();

    console.warn(`[${now()}] ${formatError(error)}，尝试刷新 token 后重连。`);

    if (this.config.refreshToken && isTokenUsable(this.config.refreshToken, 0)) {
      try {
        return await this.refreshSession();
      } catch (refreshError) {
        if (!this.config.recoveryId) throw refreshError;
        console.warn(`[${now()}] refresh token 失败，改用续玩编号登录：${formatError(refreshError)}`);
      }
    }

    if (this.config.recoveryId) return this.authenticateWithRecoveryId();

    throw new Error('无法刷新 token：缺少可用 refresh token 或续玩编号');
  }

  async openSocket() {
    await this.close();

    const socket = new WebSocket(this.url);
    this.socket = socket;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(makeConnectError('WebSocket connect timeout', 'XIUXIAN_WS_CONNECT_TIMEOUT'));
      }, this.config.requestTimeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
      };

      const onOpen = () => {
        cleanup();
        resolve();
      };

      const onError = (event) => {
        cleanup();
        const hint = tokenExpiresAt(this.config.token) ? '，请确认 token 仍然有效' : '';
        reject(makeConnectError(event?.message || `WebSocket connect error${hint}`));
      };

      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
    });

    socket.addEventListener('message', (event) => this.handleMessage(event.data));
    socket.addEventListener('close', () => this.handleClose());
    socket.addEventListener('error', (event) => {
      if (this.config.verbose) console.error(`[${now()}] socket error:`, event?.message || event);
    });

    this.startHeartbeat();
  }

  async connect() {
    if (typeof WebSocket === 'undefined') {
      throw new Error('当前 Node.js 版本没有内置 WebSocket，请使用 Node.js 22+ 运行。');
    }

    const sessionChanged = await this.ensureSession();
    if (this.isOpen && !sessionChanged) return;

    try {
      await this.openSocket();
    } catch (error) {
      await this.close();

      if (!this.canRenewAfterConnectError(error)) throw error;

      await this.forceRenewSessionAfterConnectError(error);
      await this.openSocket();
    }
  }

  handleMessage(data) {
    const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
    const message = parseJsonMaybe(text);

    if (this.config.verbose) console.log(`[${now()}] recv`, JSON.stringify(message));
    if (!message?.cid) return;

    const pending = this.pending.get(message.cid);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(message.cid);

    if (message.error) pending.reject(new Error(formatError(message.error)));
    else pending.resolve(message);
  }

  handleClose() {
    this.stopHeartbeat();

    for (const [cid, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`WebSocket closed before response: ${cid}`));
    }

    this.pending.clear();
  }

  request(message) {
    if (!this.isOpen) return Promise.reject(new Error('WebSocket is not connected'));

    const cid = this.nextCid();
    const body = { ...message, cid };

    if (this.config.verbose) console.log(`[${now()}] send`, JSON.stringify(body));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cid);
        reject(new Error(`request timeout: ${cid}`));
      }, this.config.requestTimeoutMs);

      this.pending.set(cid, { resolve, reject, timer });
      this.socket.send(JSON.stringify(body));
    });
  }

  async rpc(id, payload = {}) {
    await this.connect();

    const response = await this.request({
      rpc: {
        id,
        payload: JSON.stringify(payload),
      },
    });

    return unwrapRpcPayload(response.rpc);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.request({ ping: {} }).catch((error) => {
        console.error(`[${now()}] heartbeat failed: ${formatError(error)}`);
        this.socket?.close();
      });
    }, this.config.heartbeatMs);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  async close() {
    this.stopHeartbeat();

    if (!this.socket) return;

    const socket = this.socket;
    this.socket = null;

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
}

async function fetchState(client) {
  await client.connect();
  return client.rpc('player.state', {});
}

module.exports = {
  DEFAULT_TOKEN,
  DEFAULT_SERVER_KEY,
  NakamaSocketClient,
  assertUsableToken,
  chooseNearestZone,
  directionLabel,
  envNumber,
  envString,
  fetchState,
  formatDate,
  formatError,
  getExploreEndTime,
  getPosition,
  getStamina,
  isExploring,
  isTokenUsable,
  logsOf,
  makeNakamaConfig,
  manhattan,
  nextDirectionToTarget,
  now,
  parseJwtPayload,
  sleep,
  tokenExpiresAt,
  zonesByType,
};
