const {
  formatError,
  zonesByType,
} = require('../xiuxian-common');
const { targetDistance } = require('./map');

const DEFAULT_IGNORED_ZONE_TTL_MS = 10 * 60 * 1000;

function zoneKey(zone) {
  const zoneType = zone?.zoneType || zone?.zone_type || '';
  const stableId = zone?.id || `${zone?.tile_x},${zone?.tile_y}`;
  return `${zoneType}:${stableId}`;
}

function isZoneTakenError(error) {
  const message = formatError(error);
  return /机缘已被他人先一步夺取|已被他人先一步夺取|被他人.*夺取/.test(message);
}

function normalizeZoneTarget(state, zone, definition = {}) {
  return {
    ...zone,
    kind: 'zone',
    zoneType: definition.zoneType || zone.zone_type,
    priority: definition.priority,
    priorityLabel: definition.label,
    distance_to_player: targetDistance(state?.player, zone),
  };
}

function createZoneIgnoreList(options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_IGNORED_ZONE_TTL_MS;
  const ignored = new Map();

  function prune() {
    const now = Date.now();
    for (const [key, entry] of ignored.entries()) {
      if (entry.expiresAt <= now) ignored.delete(key);
    }
  }

  return {
    mark(zone, reason = '已失效') {
      prune();
      const key = zoneKey(zone);
      ignored.set(key, {
        reason,
        zone,
        expiresAt: Date.now() + ttlMs,
      });
      return key;
    },
    has(zone) {
      prune();
      return ignored.has(zoneKey(zone));
    },
    reason(zone) {
      prune();
      return ignored.get(zoneKey(zone))?.reason || '';
    },
    get size() {
      prune();
      return ignored.size;
    },
  };
}

function zoneTargets(state, definition, ignoreList) {
  return zonesByType(state, definition.zoneType)
    .map((zone) => normalizeZoneTarget(state, zone, definition))
    .filter((zone) => !ignoreList?.has(zone))
    .sort((a, b) => a.distance_to_player - b.distance_to_player);
}

function chooseNearestZoneTarget(state, definition, ignoreList) {
  return zoneTargets(state, definition, ignoreList)[0] || null;
}

module.exports = {
  DEFAULT_IGNORED_ZONE_TTL_MS,
  chooseNearestZoneTarget,
  createZoneIgnoreList,
  isZoneTakenError,
  normalizeZoneTarget,
  zoneKey,
  zoneTargets,
};
