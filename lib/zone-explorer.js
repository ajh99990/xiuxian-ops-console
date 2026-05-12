const {
  fetchState,
  getExploreEndTime,
  getPosition,
  getStamina,
  isExploring,
  now,
  sleep,
} = require('../xiuxian-common');
const {
  hasArrived,
  moveToTarget,
  summarizeActionResult,
} = require('./map');
const {
  createPatrol,
  patrolStep,
} = require('./patrol');
const {
  chooseNearestZoneTarget,
  createZoneIgnoreList,
  isZoneUnavailableError,
  zoneUnavailableReason,
  zoneTargets,
} = require('./zones');

function createZoneExplorer(options) {
  const {
    zoneType,
    label,
    config,
    flags,
    stopController,
  } = options;
  const patrol = createPatrol();
  const ignoredZones = createZoneIgnoreList({ ttlMs: config.ignoredZoneTtlMs });
  const zoneDefinition = { zoneType, label };

  function labelTarget(zone) {
    return `${label} ${zone.name || zone.id}`;
  }

  function printState(state) {
    const player = state?.player;
    const position = getPosition(player);
    const zones = zoneTargets(state, zoneDefinition, ignoredZones);

    console.log(`[${now()}] position=(${position.x},${position.y}) stamina=${getStamina(player) ?? '-'} exploring=${isExploring(player)} ignored_zones=${ignoredZones.size}`);

    if (!zones.length) {
      console.log(`[${now()}] 当前状态里没有可处理的 visible_zones ${label}。`);
      return;
    }

    for (const zone of zones) {
      console.log(`[${now()}] ${label} ${zone.name || zone.id} id=${zone.id} at=(${zone.tile_x},${zone.tile_y}) distance=${zone.distance_to_player}`);
    }
  }

  async function waitForExplorationIfNeeded(player) {
    const endTime = getExploreEndTime(player);
    if (!isExploring(player)) return;

    const remaining = endTime ? Math.max(1000, endTime - Date.now() + 1000) : config.exploreWaitMs;
    console.log(`[${now()}] 正在探索中，等待 ${Math.ceil(remaining / 1000)} 秒。`);
    await sleep(remaining);
  }

  async function exploreZone(client, state, zone) {
    if (flags.dryRun) {
      console.log(`[${now()}] dry-run: 将探索${label} ${zone.name || zone.id} (${zone.id})。`);
      return { state, skipped: false };
    }

    let result;
    try {
      result = await client.rpc('action.explore_zone', { zone_id: zone.id });
    } catch (error) {
      if (!isZoneUnavailableError(error)) throw error;

      const reason = zoneUnavailableReason(error);
      ignoredZones.mark(zone, reason);
      console.log(`[${now()}] ${label} ${zone.name || zone.id} ${reason}，已加入本次运行的忽略列表，继续寻找下一个${label}。`);
      return { state, skipped: true };
    }

    const summary = summarizeActionResult(result);
    console.log(`[${now()}] 开始探索${label} ${zone.name || zone.id} (${zone.id})${summary ? ` | ${summary}` : ''}`);

    return { state: { ...state, ...result }, skipped: false };
  }

  function sameTarget(left, right) {
    return left?.id && right?.id && left.id === right.id;
  }

  async function searchForZone(client, state, cycle) {
    if ((config.searchMode || 'wait') !== 'patrol') {
      console.log(`[${now()}] #${cycle} 没找到${label}，${Math.ceil(config.retryDelayMs / 1000)} 秒后重试。`);
      if (!flags.dryRun) await sleep(config.retryDelayMs);
      return state;
    }

    const result = await patrolStep(client, state, {
      dryRun: flags.dryRun,
      moveDelayMs: config.moveDelayMs,
      staminaRecoverMs: config.staminaRecoverMs,
      label,
      patrol,
    });
    return result.state;
  }

  async function runCycle({ client, cycle }) {
    let state = await fetchState(client);

    await waitForExplorationIfNeeded(state.player);

    state = await fetchState(client);
    let zone = chooseNearestZoneTarget(state, zoneDefinition, ignoredZones);

    if (!zone) {
      await searchForZone(client, state, cycle);
      return false;
    }

    const position = getPosition(state.player);
    console.log(`[${now()}] #${cycle} 目标${label}：${zone.name || zone.id} at=(${zone.tile_x},${zone.tile_y}) 当前=(${position.x},${position.y}) 距离=${zone.distance_to_player}`);

    state = await moveToTarget(client, state, zone, {
      stopController,
      dryRun: flags.dryRun,
      moveDelayMs: config.moveDelayMs,
      staminaRecoverMs: config.staminaRecoverMs,
      labelTarget,
      beforeStep: ({ state: currentState, target }) => {
        const nearest = chooseNearestZoneTarget(currentState, zoneDefinition, ignoredZones);

        if (!nearest) {
          console.log(`[${now()}] 目标${label} ${target.name || target.id} 已消失，停止本次移动并重新搜索。`);
          return { stop: true };
        }

        if (!sameTarget(nearest, target)) {
          console.log(`[${now()}] 发现新的${label}目标，切换为 ${nearest.name || nearest.id} at=(${nearest.tile_x},${nearest.tile_y}) 距离=${nearest.distance_to_player}`);
          zone = nearest;
          return { target: nearest };
        }

        zone = nearest;
        return null;
      },
    });
    if (flags.dryRun || stopController.stopped) return false;

    state = await fetchState(client);
    const freshZone = chooseNearestZoneTarget(state, zoneDefinition, ignoredZones);
    if (!freshZone) {
      console.log(`[${now()}] 到达前目标${label}已消失，重新搜索。`);
      return false;
    }
    if (!sameTarget(freshZone, zone)) {
      console.log(`[${now()}] 到达前发现更合适的${label}目标，切换为 ${freshZone.name || freshZone.id}。`);
      zone = freshZone;
    }

    if (!hasArrived(state.player, zone)) {
      console.log(`[${now()}] 尚未到达目标${label}，本轮稍后重试。`);
      await sleep(config.retryDelayMs);
      return false;
    }

    const explored = await exploreZone(client, state, zone);
    state = explored.state;
    if (explored.skipped) return false;
    if (flags.once) return true;

    console.log(`[${now()}] 等待 ${Math.ceil(config.exploreWaitMs / 1000)} 秒后继续探索。`);
    await sleep(config.exploreWaitMs);
    return true;
  }

  return {
    printState,
    runCycle,
  };
}

module.exports = {
  createZoneExplorer,
};
