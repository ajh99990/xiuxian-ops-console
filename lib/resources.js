const {
  fetchState,
  getPosition,
  getStamina,
  now,
  sleep,
} = require('../xiuxian-common');
const {
  summarizeActionResult,
  targetDistance,
} = require('./map');

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeHerb(herb, player) {
  const nodeId = herb?.node_instance_id || herb?.id;
  const tileX = Number(herb?.tile_x);
  const tileY = Number(herb?.tile_y);
  if (!nodeId || !Number.isFinite(tileX) || !Number.isFinite(tileY)) return null;

  const timeRemainingSeconds = finiteNumber(herb?.time_remaining_seconds, 0);
  const status = String(herb?.status || (timeRemainingSeconds > 0 ? 'growing' : 'ready'));

  return {
    ...herb,
    kind: 'herb',
    id: nodeId,
    tile_x: tileX,
    tile_y: tileY,
    status,
    time_remaining_seconds: timeRemainingSeconds,
    distance_to_player: targetDistance(player, { tile_x: tileX, tile_y: tileY }),
  };
}

function normalizeBeast(beast, player) {
  const beastId = beast?.beast_instance_id || beast?.id;
  const tileX = Number(beast?.tile_x);
  const tileY = Number(beast?.tile_y);
  if (!beastId || !Number.isFinite(tileX) || !Number.isFinite(tileY)) return null;

  return {
    ...beast,
    kind: 'beast',
    id: beastId,
    tile_x: tileX,
    tile_y: tileY,
    distance_to_player: targetDistance(player, { tile_x: tileX, tile_y: tileY }),
  };
}

function visibleHerbs(state) {
  return (state?.visible_herbs || [])
    .map((herb) => normalizeHerb(herb, state?.player))
    .filter(Boolean)
    .sort((a, b) => a.distance_to_player - b.distance_to_player);
}

function visibleBeasts(state) {
  return (state?.visible_beasts || [])
    .map((beast) => normalizeBeast(beast, state?.player))
    .filter(Boolean)
    .sort((a, b) => a.distance_to_player - b.distance_to_player);
}

function isHerbReady(herb) {
  return herb.status !== 'growing' && herb.status !== 'depleted' && herb.time_remaining_seconds <= 0;
}

function getGatherEndTime(player) {
  const timestamp = Date.parse(player?.timers?.gathering_ends_at || '');
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isGathering(player) {
  return Boolean(player?.flags?.is_gathering || getGatherEndTime(player));
}

function gatherNodeIdFromState(state) {
  const note = String(state?.player?.meta?.notes || '');
  const match = note.match(/^gather:(.+)$/);
  if (match?.[1]) return match[1];

  const position = getPosition(state?.player);
  const current = visibleHerbs(state).find((herb) => herb.tile_x === position.x && herb.tile_y === position.y);
  return current?.id || visibleHerbs(state)[0]?.id || '';
}

function targetLabel(target) {
  if (target.kind === 'herb') return `灵植 ${target.name || target.id}`;
  if (target.kind === 'beast') return `灵兽 ${target.name || target.id}`;
  return target?.name || target?.id || '目标';
}

function nextHerbWaitSeconds(state) {
  const growing = visibleHerbs(state)
    .filter((herb) => herb.time_remaining_seconds > 0)
    .sort((a, b) => a.time_remaining_seconds - b.time_remaining_seconds)[0];
  return growing?.time_remaining_seconds || 0;
}

function refreshResourceTarget(state, target) {
  const list = target.kind === 'herb' ? visibleHerbs(state) : visibleBeasts(state);
  return list.find((item) => item.id === target.id) || null;
}

function printResourceState(state, options = {}) {
  const { mode = 'both' } = options;
  const player = state?.player;
  const position = getPosition(player);
  const herbs = visibleHerbs(state);
  const beasts = visibleBeasts(state);

  console.log(`[${now()}] position=(${position.x},${position.y}) stamina=${getStamina(player) ?? '-'} gathering=${isGathering(player)} mode=${mode}`);

  if (!herbs.length) console.log(`[${now()}] 当前状态里没有 visible_herbs 灵植。`);
  for (const herb of herbs) {
    const wait = herb.time_remaining_seconds > 0 ? ` wait=${herb.time_remaining_seconds}s` : '';
    console.log(`[${now()}] 灵植 ${herb.name || herb.id} id=${herb.id} status=${herb.status} at=(${herb.tile_x},${herb.tile_y}) distance=${herb.distance_to_player}${wait}`);
  }

  if (!beasts.length) console.log(`[${now()}] 当前状态里没有 visible_beasts 灵兽。`);
  for (const beast of beasts) {
    const tier = beast.tier !== undefined ? ` tier=${beast.tier}` : '';
    console.log(`[${now()}] 灵兽 ${beast.name || beast.id} id=${beast.id}${tier} at=(${beast.tile_x},${beast.tile_y}) distance=${beast.distance_to_player}`);
  }
}

async function claimGatherIfNeeded(client, state, options = {}) {
  const {
    dryRun = false,
    gatherWaitMs = 31000,
  } = options;

  if (!isGathering(state?.player)) return { state, claimed: false };

  const endTime = getGatherEndTime(state.player);
  const remaining = endTime ? Math.max(1000, endTime - Date.now() + 1000) : gatherWaitMs;
  console.log(`[${now()}] 正在采集中，等待 ${Math.ceil(remaining / 1000)} 秒后领取。`);
  await sleep(remaining);

  state = await fetchState(client);
  const nodeId = gatherNodeIdFromState(state);
  if (!nodeId) {
    console.log(`[${now()}] 找不到当前采集节点，稍后重新读取状态。`);
    return { state, claimed: false };
  }

  if (dryRun) {
    console.log(`[${now()}] dry-run: 将领取采集节点 ${nodeId}。`);
    return { state, claimed: true };
  }

  const result = await client.rpc('action.claim_gather', { node_instance_id: nodeId });
  const summary = summarizeActionResult(result);
  console.log(`[${now()}] 采集领取完成 node=${nodeId}${summary ? ` | ${summary}` : ''}`);

  return { state: { ...state, ...result }, claimed: true };
}

async function gatherHerb(client, state, herb, options = {}) {
  const {
    dryRun = false,
    gatherWaitMs = 31000,
  } = options;

  if (dryRun) {
    console.log(`[${now()}] dry-run: 将开始采集 ${targetLabel(herb)} (${herb.id})。`);
    return state;
  }

  const start = await client.rpc('action.start_gather', { node_instance_id: herb.id });
  let nextState = { ...state, ...start };
  const startSummary = summarizeActionResult(start);
  console.log(`[${now()}] 开始采集 ${targetLabel(herb)} (${herb.id})${startSummary ? ` | ${startSummary}` : ''}`);

  const endTime = getGatherEndTime(nextState.player) || Date.parse(start?.gathering_ends_at || '');
  const waitMs = Number.isFinite(endTime) ? Math.max(1000, endTime - Date.now() + 1000) : gatherWaitMs;
  console.log(`[${now()}] 等待 ${Math.ceil(waitMs / 1000)} 秒后收取灵植。`);
  await sleep(waitMs);

  nextState = await fetchState(client);
  const result = await client.rpc('action.claim_gather', { node_instance_id: herb.id });
  const claimSummary = summarizeActionResult(result);
  console.log(`[${now()}] 收取灵植 ${herb.name || herb.id}${claimSummary ? ` | ${claimSummary}` : ''}`);

  return { ...nextState, ...result };
}

async function handleBeast(client, state, beast, options = {}) {
  const {
    dryRun = false,
    beastAction = 'capture',
  } = options;

  if (dryRun) {
    console.log(`[${now()}] dry-run: 将${beastAction === 'hunt' ? '猎杀' : '捕捉'} ${targetLabel(beast)} (${beast.id})。`);
    return state;
  }

  const rpc = beastAction === 'hunt' ? 'action.hunt_beast' : 'action.capture_beast';
  const result = await client.rpc(rpc, { beast_instance_id: beast.id });
  const summary = summarizeActionResult(result);
  console.log(`[${now()}] ${beastAction === 'hunt' ? '猎兽' : '捕兽'} ${beast.name || beast.id}${summary ? ` | ${summary}` : ''}`);

  return { ...state, ...result };
}

module.exports = {
  claimGatherIfNeeded,
  finiteNumber,
  gatherHerb,
  gatherNodeIdFromState,
  getGatherEndTime,
  handleBeast,
  isGathering,
  isHerbReady,
  nextHerbWaitSeconds,
  normalizeBeast,
  normalizeHerb,
  printResourceState,
  refreshResourceTarget,
  targetLabel,
  visibleBeasts,
  visibleHerbs,
};
