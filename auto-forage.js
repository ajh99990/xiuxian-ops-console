#!/usr/bin/env node

const {
  envNumber,
  envString,
  fetchState,
  getPosition,
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
} = require('./lib/map');
const {
  claimGatherIfNeeded,
  gatherHerb,
  handleBeast,
  isHerbReady,
  nextHerbWaitSeconds,
  printResourceState,
  refreshResourceTarget,
  targetLabel,
  visibleBeasts,
  visibleHerbs,
} = require('./lib/resources');

const flags = parseArgs();
const stopController = createStopController();

const CONFIG = {
  ...makeNakamaConfig({
    cidPrefix: 'forage',
    tokenEnvNames: ['XIUXIAN_TOKEN', 'XIULIAN_TOKEN'],
    verbose: flags.verbose,
  }),
  mode: envString(['XIUXIAN_FORAGE_MODE'], flags.value('--mode', 'both')),
  prefer: envString(['XIUXIAN_FORAGE_PREFER'], flags.value('--prefer', 'nearest')),
  beastAction: envString(['XIUXIAN_FORAGE_BEAST_ACTION', 'XIUXIAN_BEAST_ACTION'], flags.value('--beast-action', 'capture')),
  moveDelayMs: envNumber(['XIUXIAN_FORAGE_MOVE_DELAY_MS', 'XIUXIAN_MOVE_DELAY_MS'], 1000),
  gatherWaitMs: envNumber(['XIUXIAN_FORAGE_GATHER_WAIT_MS', 'XIUXIAN_GATHER_WAIT_MS'], 31000),
  retryDelayMs: envNumber(['XIUXIAN_FORAGE_RETRY_DELAY_MS', 'XIUXIAN_RETRY_DELAY_MS'], 5000),
  staminaRecoverMs: envNumber(['XIUXIAN_FORAGE_STAMINA_RECOVER_MS', 'XIUXIAN_STAMINA_RECOVER_MS'], 10000),
};

function validateConfig() {
  if (!['herb', 'beast', 'both'].includes(CONFIG.mode)) throw new Error('invalid mode, expected herb/beast/both');
  if (!['herb', 'beast', 'nearest'].includes(CONFIG.prefer)) throw new Error('invalid prefer, expected herb/beast/nearest');
  if (!['capture', 'hunt'].includes(CONFIG.beastAction)) throw new Error('invalid beast action, expected capture/hunt');
  assertNumber('move delay', CONFIG.moveDelayMs, { min: 0 });
  assertNumber('gather wait', CONFIG.gatherWaitMs, { min: 0, inclusive: false });
  assertNumber('retry delay', CONFIG.retryDelayMs, { min: 0, inclusive: false });
  assertNumber('stamina recover delay', CONFIG.staminaRecoverMs, { min: 0, inclusive: false });
}

function printState(state) {
  printResourceState(state, { mode: CONFIG.mode });
}

function chooseTarget(state) {
  const herbs = CONFIG.mode === 'beast' ? [] : visibleHerbs(state).filter(isHerbReady);
  const beasts = CONFIG.mode === 'herb' ? [] : visibleBeasts(state);

  if (CONFIG.prefer === 'herb') return herbs[0] || beasts[0] || null;
  if (CONFIG.prefer === 'beast') return beasts[0] || herbs[0] || null;

  return [...herbs, ...beasts]
    .sort((a, b) => a.distance_to_player - b.distance_to_player)[0] || null;
}

async function actOnTarget(client, state, target) {
  if (!hasArrived(state.player, target)) {
    console.log(`[${now()}] 尚未到达 ${targetLabel(target)}，本轮稍后重试。`);
    await sleep(CONFIG.retryDelayMs);
    return state;
  }

  const fresh = refreshResourceTarget(state, target);
  if (!fresh) {
    console.log(`[${now()}] ${targetLabel(target)} 已不在可见范围内，重新寻找。`);
    await sleep(CONFIG.retryDelayMs);
    return state;
  }

  if (fresh.kind === 'herb') return gatherHerb(client, state, fresh, {
    dryRun: flags.dryRun,
    gatherWaitMs: CONFIG.gatherWaitMs,
  });

  return handleBeast(client, state, fresh, {
    dryRun: flags.dryRun,
    beastAction: CONFIG.beastAction,
  });
}

async function runCycle({ client, cycle }) {
  let state = await fetchState(client);
  const gather = await claimGatherIfNeeded(client, state, {
    dryRun: flags.dryRun,
    gatherWaitMs: CONFIG.gatherWaitMs,
  });
  state = gather.state;
  if (flags.once && gather.claimed) return true;

  state = await fetchState(client);
  const target = chooseTarget(state);

  if (!target) {
    const waitSeconds = CONFIG.mode !== 'beast' ? nextHerbWaitSeconds(state) : 0;
    const waitMs = waitSeconds > 0 ? Math.min(waitSeconds * 1000 + 1000, CONFIG.retryDelayMs) : CONFIG.retryDelayMs;
    const detail = waitSeconds > 0 ? `，最近灵植还需 ${waitSeconds} 秒` : '';
    console.log(`[${now()}] #${cycle} 没找到可处理的灵植/灵兽${detail}，${Math.ceil(waitMs / 1000)} 秒后重试。`);
    if (!flags.dryRun) await sleep(waitMs);
    return false;
  }

  const position = getPosition(state.player);
  console.log(`[${now()}] #${cycle} 目标：${targetLabel(target)} at=(${target.tile_x},${target.tile_y}) 当前=(${position.x},${position.y}) 距离=${target.distance_to_player}`);

  state = await moveToTarget(client, state, target, {
    stopController,
    dryRun: flags.dryRun,
    moveDelayMs: CONFIG.moveDelayMs,
    staminaRecoverMs: CONFIG.staminaRecoverMs,
    labelTarget: targetLabel,
  });
  if (flags.dryRun || stopController.stopped) return false;

  state = await fetchState(client);
  await actOnTarget(client, state, target);
  return true;
}

runMain(runScript({
  name: 'auto forage',
  config: CONFIG,
  flags,
  stopController,
  validate: validateConfig,
  printState,
  runCycle,
  startMessage: () => `auto forage started, mode=${CONFIG.mode} prefer=${CONFIG.prefer} beast_action=${CONFIG.beastAction} dry_run=${flags.dryRun}`,
}));
