#!/usr/bin/env node

const {
  envNumber,
  envString,
  fetchState,
  getExploreEndTime,
  getPosition,
  getStamina,
  isExploring,
  makeNakamaConfig,
  now,
  sleep,
} = require('./xiuxian-common');
const {
  assertNumber,
  createStopController,
  parseArgs,
  runMain,
  runScript,
} = require('./lib/runtime');
const {
  hasArrived,
  moveToTarget,
  summarizeActionResult,
} = require('./lib/map');
const {
  interactElement,
  isStarSeaElement,
  refreshElementTarget,
  starSeaTargets,
} = require('./lib/elements');
const {
  createPatrol,
  patrolStep,
} = require('./lib/patrol');
const {
  claimGatherIfNeeded,
  gatherHerb,
  handleBeast,
  isHerbReady,
  refreshResourceTarget,
  targetLabel: resourceTargetLabel,
  visibleBeasts,
  visibleHerbs,
} = require('./lib/resources');
const {
  createZoneIgnoreList,
  isZoneUnavailableError,
  zoneUnavailableReason,
  zoneTargets: makeZoneTargets,
} = require('./lib/zones');

const flags = parseArgs();
const stopController = createStopController();
const patrol = createPatrol();

const CONFIG = {
  ...makeNakamaConfig({
    cidPrefix: 'priority',
    tokenEnvNames: ['XIUXIAN_TOKEN', 'XIULIAN_TOKEN'],
    verbose: flags.verbose,
  }),
  beastAction: envString(['XIUXIAN_PRIORITY_BEAST_ACTION', 'XIUXIAN_BEAST_ACTION'], flags.value('--beast-action', 'capture')),
  moveDelayMs: envNumber(['XIUXIAN_PRIORITY_MOVE_DELAY_MS', 'XIUXIAN_MOVE_DELAY_MS'], 1000),
  exploreWaitMs: envNumber(['XIUXIAN_PRIORITY_EXPLORE_WAIT_MS', 'XIUXIAN_EXPLORE_WAIT_MS'], 61000),
  gatherWaitMs: envNumber(['XIUXIAN_PRIORITY_GATHER_WAIT_MS', 'XIUXIAN_GATHER_WAIT_MS'], 31000),
  retryDelayMs: envNumber(['XIUXIAN_PRIORITY_RETRY_DELAY_MS', 'XIUXIAN_RETRY_DELAY_MS'], 5000),
  staminaRecoverMs: envNumber(['XIUXIAN_PRIORITY_STAMINA_RECOVER_MS', 'XIUXIAN_STAMINA_RECOVER_MS'], 10000),
  ignoredZoneTtlMs: envNumber(['XIUXIAN_PRIORITY_IGNORED_ZONE_TTL_MS', 'XIUXIAN_IGNORED_ZONE_TTL_MS'], 10 * 60 * 1000),
  searchMode: envString(['XIUXIAN_PRIORITY_SEARCH_MODE', 'XIUXIAN_ZONE_SEARCH_MODE'], 'patrol'),
  starSeaEnabled: envString(['XIUXIAN_PRIORITY_STAR_SEA_ENABLED', 'XIUXIAN_STAR_SEA_ENABLED'], 'true') !== 'false',
  starSeaOffsetMs: envNumber(['XIUXIAN_PRIORITY_STAR_SEA_OFFSET_MS', 'XIUXIAN_STAR_SEA_OFFSET_MS'], 1000),
  starSeaWindowMs: envNumber(['XIUXIAN_PRIORITY_STAR_SEA_WINDOW_MS', 'XIUXIAN_STAR_SEA_WINDOW_MS'], 90 * 1000),
};
const ignoredZones = createZoneIgnoreList({ ttlMs: CONFIG.ignoredZoneTtlMs });
const starSeaSchedule = { lastAttemptHour: '' };

const PRIORITIES = [
  { zoneType: 'treasure', priority: 0, kind: 'zone', label: '仙宝' },
  { elementType: 'star-sea', priority: 1, kind: 'element', label: '星海幻境' },
  { zoneType: 'danger', priority: 2, kind: 'zone', label: '凶地' },
  { zoneType: 'blessed', priority: 3, kind: 'zone', label: '福地' },
  { resourceKind: 'herb', priority: 4, kind: 'herb', label: '采药' },
  { resourceKind: 'beast', priority: 5, kind: 'beast', label: '捕兽' },
];

function localHourKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day} ${hour}`;
}

function localHourStart(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function isStarSeaWindowOpen(timestamp = Date.now()) {
  if (!CONFIG.starSeaEnabled) return false;
  const elapsed = timestamp - localHourStart(timestamp);
  return elapsed >= CONFIG.starSeaOffsetMs && elapsed < CONFIG.starSeaOffsetMs + CONFIG.starSeaWindowMs;
}

function shouldAttemptStarSea(timestamp = Date.now()) {
  return isStarSeaWindowOpen(timestamp) && !hasAttemptedStarSea(timestamp);
}

function hasAttemptedStarSea(timestamp = Date.now()) {
  return starSeaSchedule.lastAttemptHour === localHourKey(timestamp);
}

function markStarSeaAttempt(timestamp = Date.now()) {
  starSeaSchedule.lastAttemptHour = localHourKey(timestamp);
}

function isStarSeaTarget(target) {
  return target?.kind === 'element' && target.elementType === 'star-sea';
}

function starSeaWindowStatus(timestamp = Date.now()) {
  if (!CONFIG.starSeaEnabled) return 'disabled';
  const hourKey = localHourKey(timestamp);
  if (starSeaSchedule.lastAttemptHour === hourKey) return `${hourKey} 已尝试`;
  if (isStarSeaWindowOpen(timestamp)) return `${hourKey} 窗口开启`;

  const hourStart = localHourStart(timestamp);
  const elapsed = timestamp - hourStart;
  const next = elapsed < CONFIG.starSeaOffsetMs
    ? hourStart + CONFIG.starSeaOffsetMs
    : hourStart + 60 * 60 * 1000 + CONFIG.starSeaOffsetMs;
  return `下次 ${new Date(next).toLocaleString('zh-CN', { hour12: false })}`;
}

function validateConfig() {
  if (!['capture', 'hunt'].includes(CONFIG.beastAction)) throw new Error('invalid beast action, expected capture/hunt');
  if (!['patrol', 'wait'].includes(CONFIG.searchMode)) throw new Error('invalid search mode, expected patrol/wait');
  assertNumber('move delay', CONFIG.moveDelayMs, { min: 0 });
  assertNumber('explore wait', CONFIG.exploreWaitMs, { min: 0, inclusive: false });
  assertNumber('gather wait', CONFIG.gatherWaitMs, { min: 0, inclusive: false });
  assertNumber('retry delay', CONFIG.retryDelayMs, { min: 0, inclusive: false });
  assertNumber('stamina recover delay', CONFIG.staminaRecoverMs, { min: 0, inclusive: false });
  assertNumber('ignored zone ttl', CONFIG.ignoredZoneTtlMs, { min: 0, inclusive: false });
  assertNumber('star sea offset', CONFIG.starSeaOffsetMs, { min: 0 });
  assertNumber('star sea window', CONFIG.starSeaWindowMs, { min: 0, inclusive: false });
}

function priorityTargets(state) {
  const treasure = makeZoneTargets(state, PRIORITIES[0], ignoredZones);
  const starSea = shouldAttemptStarSea() ? starSeaTargets(state, PRIORITIES[1]) : [];
  const danger = makeZoneTargets(state, PRIORITIES[2], ignoredZones);
  const blessed = makeZoneTargets(state, PRIORITIES[3], ignoredZones);
  const herbs = visibleHerbs(state)
    .filter(isHerbReady)
    .map((herb) => ({
      ...herb,
      priority: PRIORITIES[4].priority,
      priorityLabel: PRIORITIES[4].label,
    }));
  const beasts = visibleBeasts(state)
    .map((beast) => ({
      ...beast,
      priority: PRIORITIES[5].priority,
      priorityLabel: PRIORITIES[5].label,
    }));

  return [...treasure, ...starSea, ...danger, ...blessed, ...herbs, ...beasts]
    .sort((a, b) => a.priority - b.priority || a.distance_to_player - b.distance_to_player);
}

function choosePriorityTarget(state) {
  return priorityTargets(state)[0] || null;
}

function chooseTreasureTarget(state) {
  return makeZoneTargets(state, PRIORITIES[0], ignoredZones)[0] || null;
}

function chooseStarSeaTarget(state) {
  return shouldAttemptStarSea() ? starSeaTargets(state, PRIORITIES[1])[0] || null : null;
}

function targetKey(target) {
  if (!target) return '';
  const stableId = target.id || `${target.tile_x},${target.tile_y}`;
  return `${target.kind}:${target.zoneType || target.elementType || ''}:${stableId}`;
}

function sameTarget(left, right) {
  return targetKey(left) === targetKey(right);
}

function targetLabel(target) {
  if (target.kind === 'zone') return `${target.priorityLabel} ${target.name || target.id}`;
  if (target.kind === 'element') return `${target.priorityLabel} ${target.name || target.element_label || target.id}`;
  return `${target.priorityLabel} ${resourceTargetLabel(target)}`;
}

function formatTarget(target) {
  return `${targetLabel(target)} at=(${target.tile_x},${target.tile_y}) distance=${target.distance_to_player}`;
}

function refreshPriorityTarget(state, target) {
  if (!target) return null;

  if (target.kind === 'zone') {
    const definition = PRIORITIES.find((item) => item.zoneType === target.zoneType);
    return definition
      ? makeZoneTargets(state, definition, ignoredZones).find((zone) => sameTarget(zone, target)) || null
      : null;
  }

  if (target.kind === 'element') {
    const fresh = refreshElementTarget(state, target);
    if (!fresh || !fresh.can_interact || !isStarSeaElement(fresh)) return null;
    const definition = PRIORITIES.find((item) => item.elementType === target.elementType);
    return {
      ...fresh,
      elementType: target.elementType,
      priority: definition?.priority || target.priority,
      priorityLabel: definition?.label || target.priorityLabel,
    };
  }

  const fresh = refreshResourceTarget(state, target);
  if (!fresh) return null;

  const definition = PRIORITIES.find((item) => item.resourceKind === fresh.kind);
  return {
    ...fresh,
    priority: definition?.priority || target.priority,
    priorityLabel: definition?.label || target.priorityLabel,
  };
}

function printTargetGroup(title, targets) {
  if (!targets.length) {
    console.log(`[${now()}] 当前状态里没有可处理的${title}。`);
    return;
  }

  for (const target of targets) {
    console.log(`[${now()}] ${formatTarget(target)} id=${target.id}`);
  }
}

function printState(state) {
  const player = state?.player;
  const position = getPosition(player);

  console.log(`[${now()}] position=(${position.x},${position.y}) stamina=${getStamina(player) ?? '-'} exploring=${isExploring(player)} ignored_zones=${ignoredZones.size} star_sea=${starSeaWindowStatus()}`);
  printTargetGroup('仙宝', makeZoneTargets(state, PRIORITIES[0], ignoredZones));
  printTargetGroup('星海幻境', starSeaTargets(state, PRIORITIES[1]));
  printTargetGroup('凶地', makeZoneTargets(state, PRIORITIES[2], ignoredZones));
  printTargetGroup('福地', makeZoneTargets(state, PRIORITIES[3], ignoredZones));
  printTargetGroup('成熟灵植', visibleHerbs(state).filter(isHerbReady).map((herb) => ({
    ...herb,
    priority: PRIORITIES[4].priority,
    priorityLabel: PRIORITIES[4].label,
  })));
  printTargetGroup('灵兽', visibleBeasts(state).map((beast) => ({
    ...beast,
    priority: PRIORITIES[5].priority,
    priorityLabel: PRIORITIES[5].label,
  })));

  const best = choosePriorityTarget(state);
  console.log(`[${now()}] 当前最优目标：${best ? formatTarget(best) : '无'}`);
}

async function waitForExplorationIfNeeded(player) {
  if (!isExploring(player)) return;

  const endTime = getExploreEndTime(player);
  const remaining = endTime ? Math.max(1000, endTime - Date.now() + 1000) : CONFIG.exploreWaitMs;
  console.log(`[${now()}] 正在探索中，等待 ${Math.ceil(remaining / 1000)} 秒。`);
  await sleep(remaining);
}

async function exploreZone(client, state, zone) {
  if (flags.dryRun) {
    console.log(`[${now()}] dry-run: 将探索${targetLabel(zone)} (${zone.id})。`);
    return { state, skipped: false };
  }

  let result;
  try {
    result = await client.rpc('action.explore_zone', { zone_id: zone.id });
  } catch (error) {
    if (!isZoneUnavailableError(error)) throw error;

    const reason = zoneUnavailableReason(error);
    ignoredZones.mark(zone, reason);
    console.log(`[${now()}] ${targetLabel(zone)} ${reason}，已加入本次运行的忽略列表，继续寻找下一个目标。`);
    return { state, skipped: true };
  }

  const summary = summarizeActionResult(result);

  const action = zone.zoneType === 'treasure' ? '夺取' : '开始探索';
  console.log(`[${now()}] ${action}${targetLabel(zone)} (${zone.id})${summary ? ` | ${summary}` : ''}`);
  return { state: { ...state, ...result }, skipped: false };
}

async function actOnTarget(client, state, target) {
  if (!hasArrived(state.player, target)) {
    console.log(`[${now()}] 尚未到达 ${targetLabel(target)}，本轮稍后重试。`);
    if (!flags.dryRun) await sleep(CONFIG.retryDelayMs);
    return { state, acted: false };
  }

  const fresh = refreshPriorityTarget(state, target);
  if (!fresh) {
    console.log(`[${now()}] ${targetLabel(target)} 已不在可见范围内，重新寻找。`);
    if (!flags.dryRun) await sleep(CONFIG.retryDelayMs);
    return { state, acted: false };
  }

  if (fresh.kind === 'zone') {
    const explored = await exploreZone(client, state, fresh);
    if (explored.skipped) return { state: explored.state, acted: false };
    if (!flags.once && !flags.dryRun && isExploring(explored.state.player)) {
      await waitForExplorationIfNeeded(explored.state.player);
    }
    return { state: explored.state, acted: true };
  }

  if (fresh.kind === 'element') {
    const interacted = await interactElement(client, state, fresh, {
      dryRun: flags.dryRun,
      label: fresh.priorityLabel || '地图元素',
    });
    if (fresh.elementType === 'star-sea' && !flags.dryRun) markStarSeaAttempt();
    return { state: interacted.state, acted: !interacted.skipped };
  }

  if (fresh.kind === 'herb') {
    const nextState = await gatherHerb(client, state, fresh, {
      dryRun: flags.dryRun,
      gatherWaitMs: CONFIG.gatherWaitMs,
    });
    return { state: nextState, acted: true };
  }

  const nextState = await handleBeast(client, state, fresh, {
    dryRun: flags.dryRun,
    beastAction: CONFIG.beastAction,
  });
  return { state: nextState, acted: true };
}

async function searchForTarget(client, state, cycle) {
  if (CONFIG.searchMode !== 'patrol') {
    console.log(`[${now()}] #${cycle} 没找到优先目标，${Math.ceil(CONFIG.retryDelayMs / 1000)} 秒后重试。`);
    if (!flags.dryRun) await sleep(CONFIG.retryDelayMs);
    return state;
  }

  const result = await patrolStep(client, state, {
    dryRun: flags.dryRun,
    moveDelayMs: CONFIG.moveDelayMs,
    staminaRecoverMs: CONFIG.staminaRecoverMs,
    label: '优先目标',
    patrol,
  });
  return result.state;
}

async function settleBusyState(client, state) {
  await waitForExplorationIfNeeded(state.player);

  let nextState = await fetchState(client);
  const treasure = chooseTreasureTarget(nextState);
  if (treasure) {
    console.log(`[${now()}] 发现仙宝 ${treasure.name || treasure.id}，跳过非必要等待，立即转入夺宝优先级。`);
    return { state: nextState, claimedGather: false };
  }

  const starSea = chooseStarSeaTarget(nextState);
  if (starSea) {
    console.log(`[${now()}] 星海幻境窗口开启，发现 ${starSea.name || starSea.id}，立即转入星海幻境优先级。`);
    return { state: nextState, claimedGather: false };
  }

  const gather = await claimGatherIfNeeded(client, nextState, {
    dryRun: flags.dryRun,
    gatherWaitMs: CONFIG.gatherWaitMs,
  });
  nextState = gather.state;

  return { state: nextState, claimedGather: gather.claimed };
}

async function runCycle({ client, cycle }) {
  let state = await fetchState(client);
  const settled = await settleBusyState(client, state);
  state = settled.state;

  if (flags.once && settled.claimedGather) return true;

  state = await fetchState(client);
  let target = choosePriorityTarget(state);

  if (!target) {
    await searchForTarget(client, state, cycle);
    return false;
  }

  const position = getPosition(state.player);
  console.log(`[${now()}] #${cycle} 综合目标：${formatTarget(target)} 当前=(${position.x},${position.y})`);

  state = await moveToTarget(client, state, target, {
    stopController,
    dryRun: flags.dryRun,
    moveDelayMs: CONFIG.moveDelayMs,
    staminaRecoverMs: CONFIG.staminaRecoverMs,
    labelTarget: targetLabel,
    beforeStep: ({ state: currentState, target: currentTarget }) => {
      if (isStarSeaTarget(currentTarget) && !hasAttemptedStarSea()) {
        const treasure = chooseTreasureTarget(currentState);
        if (treasure) {
          console.log(`[${now()}] 发现仙宝，暂停星海幻境并切换为 ${formatTarget(treasure)}。`);
          target = treasure;
          return { target: treasure };
        }

        const freshStarSea = refreshPriorityTarget(currentState, currentTarget);
        if (!freshStarSea) {
          console.log(`[${now()}] 星海幻境已消失，停止本次移动并重新搜索。`);
          return { stop: true };
        }

        target = freshStarSea;
        return { target: freshStarSea };
      }

      const best = choosePriorityTarget(currentState);

      if (!best) {
        console.log(`[${now()}] 目标 ${targetLabel(currentTarget)} 已消失，停止本次移动并重新搜索。`);
        return { stop: true };
      }

      if (!sameTarget(best, currentTarget)) {
        console.log(`[${now()}] 优先级刷新，切换为 ${formatTarget(best)}。`);
        target = best;
        return { target: best };
      }

      target = refreshPriorityTarget(currentState, currentTarget) || currentTarget;
      return null;
    },
  });
  if (flags.dryRun || stopController.stopped) return false;

  state = await fetchState(client);
  if (isStarSeaTarget(target) && !hasAttemptedStarSea()) {
    const treasure = chooseTreasureTarget(state);
    if (treasure) {
      console.log(`[${now()}] 到达前发现仙宝，切换为 ${formatTarget(treasure)}。`);
      target = treasure;
      if (!hasArrived(state.player, target)) return false;
    } else {
      const freshStarSea = refreshPriorityTarget(state, target);
      if (!freshStarSea) {
        console.log(`[${now()}] 到达前星海幻境已消失，重新搜索。`);
        return false;
      }
      target = freshStarSea;
    }
  } else {
    const best = choosePriorityTarget(state);
    if (!best) {
      console.log(`[${now()}] 到达前优先目标已消失，重新搜索。`);
      return false;
    }

    if (!sameTarget(best, target)) {
      console.log(`[${now()}] 到达前发现更高优先级目标，切换为 ${formatTarget(best)}。`);
      target = best;
      if (!hasArrived(state.player, target)) return false;
    }
  }

  const action = await actOnTarget(client, state, target);
  return action.acted;
}

runMain(runScript({
  name: 'auto priority',
  config: CONFIG,
  flags,
  stopController,
  validate: validateConfig,
  printState,
  runCycle,
  startMessage: () => `auto priority started, order=仙宝>星海幻境>凶地>福地>采药>捕兽 star_sea_window=${CONFIG.starSeaWindowMs}ms beast_action=${CONFIG.beastAction} search_mode=${CONFIG.searchMode} dry_run=${flags.dryRun}`,
}));
