const {
  formatError,
} = require('./xiuxian-service');
const {
  maskSecret,
  nowIso,
  stableHash,
} = require('../utils');

const LOG_NAME = 'role-states';

const REALM_LABELS = {
  realm_mortal: '凡人',
  realm_qi_refining: '炼气',
  realm_foundation: '筑基',
  realm_core: '金丹',
  realm_nascent_soul: '元婴',
  realm_deity: '化神',
  realm_tribulation: '渡劫',
};

const SPIRITUAL_ROOT_LABELS = {
  root_five_elements: '五行灵根',
  root_single_earth: '土灵根',
  root_single_fire: '火灵根',
  root_single_metal: '金灵根',
  root_single_water: '水灵根',
  root_single_wood: '木灵根',
};

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function roleKey(job) {
  return `role_${stableHash(job.recoveryId || job.name)}`;
}

function inventoryCount(player, itemIds = []) {
  const ids = new Set(itemIds);
  let total = 0;
  for (const item of player?.inventory?.items || []) {
    if (!ids.has(item?.item_id) && !ids.has(item?.id)) continue;
    total += numberOrNull(item.count ?? item.quantity ?? item.amount) || 0;
  }
  return total || null;
}

function objectLabel(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return value.label || value.name || value.id || JSON.stringify(value);
}

function spiritualRootLabel(value) {
  const raw = objectLabel(value);
  return SPIRITUAL_ROOT_LABELS[raw] || raw;
}

function resolveCombatPower(normalized, player, progression, attributes, stats, profile) {
  return numberOrNull(firstDefined(
    normalized.combat_power,
    normalized.combatPower,
    normalized.power,
    normalized.stats?.combat_power,
    normalized.stats?.combatPower,
    normalized.stats?.power,
    progression.combat_power,
    progression.combatPower,
    attributes.combat_power,
    attributes.combatPower,
    stats.combat_power,
    stats.combatPower,
    stats.power,
    profile.combat_power,
    profile.combatPower,
    player.combat_power,
    player.combatPower,
    player.power,
  ));
}

function normalizePlayerState(state = {}) {
  return state?.player ? state : { player: state };
}

function summarizePlayerState(state = {}) {
  const normalized = normalizePlayerState(state);
  const player = normalized.player || {};
  const progression = player.progression || {};
  const resources = player.resources || {};
  const profile = player.profile || {};
  const attributes = player.attributes || {};
  const stats = player.stats || {};
  const position = player.position || {};

  const realmId = String(progression.realm_id || '');
  const realmStage = numberOrNull(progression.realm_stage);
  const lifespanMax = numberOrNull(progression.lifespan_max);
  const lifespanUsed = numberOrNull(progression.lifespan_used);
  const lifespanRemaining = lifespanMax !== null && lifespanUsed !== null ? Math.max(0, lifespanMax - lifespanUsed) : null;
  const spiritStones = numberOrNull(firstDefined(
    resources.spirit_stones,
    resources.spiritStone,
    resources.lingshi,
    resources.stones,
    player.wallet?.spirit_stones,
    player.wallet?.lingshi,
  )) ?? inventoryCount(player, ['spirit_stone', 'item_spirit_stone', 'lingshi']);

  return {
    playerName: profile.display_name || profile.name || profile.username || '',
    realmId,
    realmLabel: REALM_LABELS[realmId] || realmId || '-',
    realmStage,
    spiritualRoot: spiritualRootLabel(firstDefined(
      profile.root_type,
      profile.spiritual_root,
      profile.spirit_root,
      progression.root_type,
      progression.spiritual_root,
      progression.spirit_root,
      attributes.root_type,
      profile.spiritual_root,
      attributes.spiritual_root,
      player.meta?.root_type,
      player.meta?.spiritual_root,
      player.cultivation?.root_type,
      player.cultivation?.spiritual_root,
    )),
    spiritStones,
    combatPower: resolveCombatPower(normalized, player, progression, attributes, stats, profile),
    lifespanMax,
    lifespanUsed,
    lifespanRemaining,
    exp: numberOrNull(progression.exp),
    expToNext: numberOrNull(progression.exp_to_next),
    cultivationRate: numberOrNull(progression.cultivation_rate),
    qi: numberOrNull(resources.qi),
    stamina: numberOrNull(resources.stamina),
    staminaMax: numberOrNull(resources.stamina_max),
    position: {
      x: numberOrNull(position.tile_x ?? position.x),
      y: numberOrNull(position.tile_y ?? position.y),
      region: position.region_id || position.region || '',
    },
    flags: player.flags || {},
  };
}

function publicRecord(record) {
  if (!record) return null;
  return {
    ...record,
    recoveryId: undefined,
  };
}

class RoleStateService {
  constructor(options = {}) {
    this.accountStore = options.accountStore;
    this.eventBus = options.eventBus;
    this.jobManager = options.jobManager;
    this.logService = options.logService;
    this.store = options.store;
    this.xiuxianService = options.xiuxianService;
    this.activeRefresh = null;
  }

  normalizeState(state = {}) {
    const source = state && typeof state === 'object' ? state : {};
    return {
      version: 1,
      roles: {},
      refreshes: [],
      ...source,
      roles: source.roles || {},
      refreshes: Array.isArray(source.refreshes) ? source.refreshes : [],
    };
  }

  async readState() {
    return this.normalizeState(await this.store.read());
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
    this.eventBus?.publish('role_states', await this.status());
  }

  async roleJobs() {
    const jobs = await this.accountStore.read();
    return jobs.map((job) => ({
      job,
      key: roleKey(job),
      runtime: this.jobManager?.status?.(job.name) || { running: false },
    }));
  }

  async status() {
    const [state, roles] = await Promise.all([
      this.readState(),
      this.roleJobs(),
    ]);
    const configuredKeys = new Set(roles.map((role) => role.key));
    const records = roles.map(({ job, key, runtime }) => {
      const stored = state.roles[key] || {};
      const hasRecoveryId = Boolean(job.recoveryId);
      return publicRecord({
        key,
        name: job.name,
        script: job.script,
        enabled: job.enabled !== false,
        hasRecoveryId,
        recoveryIdMasked: maskSecret(job.recoveryId),
        status: hasRecoveryId ? 'never' : 'missing_recovery',
        runtime,
        ...stored,
        name: job.name,
        script: job.script,
        enabled: job.enabled !== false,
        hasRecoveryId,
        recoveryIdMasked: maskSecret(job.recoveryId),
        runtime,
      });
    });

    for (const [key, record] of Object.entries(state.roles)) {
      if (!configuredKeys.has(key)) records.push(publicRecord({ key, removed: true, ...record }));
    }

    return {
      updatedAt: state.updatedAt || '',
      lastRefreshAt: state.lastRefreshAt || '',
      records,
      refreshes: state.refreshes.slice(0, 20),
    };
  }

  async persistRoleState(key, patch) {
    let record;
    await this.updateState((state) => {
      state.roles[key] = {
        ...(state.roles[key] || {}),
        ...patch,
        updatedAt: nowIso(),
      };
      record = state.roles[key];
    });
    await this.publishStatus();
    return record;
  }

  async refreshRole(job, key, options = {}) {
    if (!job.recoveryId) {
      return this.persistRoleState(key, {
        name: job.name,
        script: job.script,
        enabled: job.enabled !== false,
        hasRecoveryId: false,
        recoveryIdMasked: '',
        status: 'missing_recovery',
        error: '缺少续玩编号',
      });
    }

    await this.persistRoleState(key, {
      name: job.name,
      script: job.script,
      enabled: job.enabled !== false,
      hasRecoveryId: true,
      recoveryIdMasked: maskSecret(job.recoveryId),
      status: 'refreshing',
      refreshStartedAt: nowIso(),
      error: '',
    });

    try {
      const state = await this.xiuxianService.fetchState(job, {
        cidPrefix: options.cidPrefix || 'role-state',
      });
      const summary = summarizePlayerState(state);
      const record = await this.persistRoleState(key, {
        name: job.name,
        script: job.script,
        enabled: job.enabled !== false,
        hasRecoveryId: true,
        recoveryIdMasked: maskSecret(job.recoveryId),
        status: 'success',
        syncedAt: nowIso(),
        source: options.trigger || 'refresh',
        summary,
        raw: normalizePlayerState(state),
        error: '',
      });
      return publicRecord(record);
    } catch (error) {
      const record = await this.persistRoleState(key, {
        name: job.name,
        script: job.script,
        enabled: job.enabled !== false,
        hasRecoveryId: true,
        recoveryIdMasked: maskSecret(job.recoveryId),
        status: 'failed',
        failureAt: nowIso(),
        error: formatError(error),
      });
      return publicRecord(record);
    }
  }

  async refreshAll(options = {}) {
    if (this.activeRefresh) {
      return {
        skipped: true,
        reason: 'running',
      };
    }

    this.activeRefresh = this.refreshAllLocked(options).finally(() => {
      this.activeRefresh = null;
    });
    return this.activeRefresh;
  }

  async refreshAllLocked(options = {}) {
    const startedAt = nowIso();
    const roles = await this.roleJobs();
    const results = [];

    for (const { job, key } of roles) {
      try {
        const record = await this.refreshRole(job, key, options);
        results.push({ name: job.name, status: record.status, key });
      } catch (error) {
        results.push({ name: job.name, status: 'failed', error: formatError(error), key });
      }
    }

    const refresh = {
      trigger: options.trigger || 'manual',
      startedAt,
      finishedAt: nowIso(),
      total: results.length,
      success: results.filter((item) => item.status === 'success').length,
      failed: results.filter((item) => item.status === 'failed').length,
      missingRecovery: results.filter((item) => item.status === 'missing_recovery').length,
    };

    await this.updateState((state) => {
      state.lastRefreshAt = refresh.finishedAt;
      state.refreshes = [refresh, ...state.refreshes].slice(0, 50);
    });
    await this.publishStatus();
    await this.logService?.append?.(LOG_NAME, `[${refresh.finishedAt}] 角色状态同步 trigger=${refresh.trigger} success=${refresh.success} failed=${refresh.failed} missing_recovery=${refresh.missingRecovery}\n`);

    return {
      ...refresh,
      results,
    };
  }

  async recordReport(payload = {}) {
    const name = String(payload.name || payload.roleName || '').trim();
    if (!name) throw new Error('missing role name');
    const job = await this.accountStore.find(name);
    if (!job) throw new Error(`角色不存在：${name}`);

    const state = payload.state || payload.raw || (payload.player ? { player: payload.player } : {});
    const key = roleKey(job);
    const summary = summarizePlayerState(state);
    const previousSummary = (await this.readState()).roles[key]?.summary || {};
    if (summary.combatPower === null && previousSummary.combatPower !== null && previousSummary.combatPower !== undefined) {
      summary.combatPower = previousSummary.combatPower;
    }
    const record = await this.persistRoleState(key, {
      name: job.name,
      script: job.script,
      enabled: job.enabled !== false,
      hasRecoveryId: Boolean(job.recoveryId),
      recoveryIdMasked: maskSecret(job.recoveryId),
      status: 'success',
      syncedAt: nowIso(),
      source: payload.source || 'script',
      summary,
      raw: normalizePlayerState(state),
      error: '',
    });

    return publicRecord(record);
  }
}

module.exports = {
  LOG_NAME,
  RoleStateService,
  roleKey,
  summarizePlayerState,
};
