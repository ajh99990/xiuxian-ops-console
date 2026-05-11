#!/usr/bin/env node

const {
  envNumber,
  fetchState,
  formatError,
  getPosition,
  getStamina,
  logsOf,
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

const flags = parseArgs();
const stopController = createStopController();

const CONFIG = {
  ...makeNakamaConfig({
    cidPrefix: 'xiulian',
    tokenEnvNames: ['XIULIAN_TOKEN', 'XIUXIAN_TOKEN'],
    verbose: flags.verbose,
  }),
  intervalMs: envNumber(['XIULIAN_INTERVAL_MS', 'XIUXIAN_INTERVAL_MS'], 1000),
  mode: process.env.XIULIAN_MODE || 'manual',
  seclusionStaminaMin: envNumber(['XIULIAN_SECLUSION_STAMINA_MIN', 'XIUXIAN_SECLUSION_STAMINA_MIN'], 12),
  breakthroughRetryMs: envNumber(['XIULIAN_BREAKTHROUGH_RETRY_MS', 'XIUXIAN_BREAKTHROUGH_RETRY_MS'], 30000),
  breakthroughPillId: process.env.XIULIAN_BREAKTHROUGH_PILL_ID || process.env.XIUXIAN_BREAKTHROUGH_PILL_ID || '',
  safeTeleportId: process.env.XIULIAN_SAFE_TELEPORT_ID || process.env.XIUXIAN_SAFE_TELEPORT_ID || 'safe_zone',
  minLifespanRemainingYears: envNumber(['XIULIAN_MIN_LIFESPAN_REMAINING_YEARS', 'XIUXIAN_MIN_LIFESPAN_REMAINING_YEARS'], 5),
};

let currentPlayer = null;
let currentState = null;
let lastBreakthroughFailureAt = 0;

const NEXT_REALM_BY_ID = {
  realm_qi_refining: 'realm_foundation',
  realm_foundation: 'realm_core',
  realm_core: 'realm_nascent_soul',
  realm_nascent_soul: 'realm_deity',
  realm_deity: 'realm_tribulation',
};

const BREAKTHROUGH_PILL_BY_TARGET_REALM = {
  realm_foundation: 'pill_foundation',
  realm_core: 'pill_core_forming',
};

function validateConfig() {
  assertNumber('interval', CONFIG.intervalMs, { min: 0, inclusive: false });
  assertNumber('seclusion stamina threshold', CONFIG.seclusionStaminaMin, { min: 0 });
  assertNumber('breakthrough retry delay', CONFIG.breakthroughRetryMs, { min: 0, inclusive: false });
  assertNumber('minimum lifespan remaining years', CONFIG.minLifespanRemainingYears, { min: 0 });
}

function chooseCultivationMode(player) {
  const stamina = getStamina(player);
  if (stamina !== null && stamina >= CONFIG.seclusionStaminaMin) return 'seclusion';
  return CONFIG.mode;
}

function formatMode(mode) {
  return mode === 'seclusion' ? '闭关' : '修炼';
}

function isProgressFull(player) {
  const exp = Number(player?.progression?.exp);
  const expToNext = Number(player?.progression?.exp_to_next);
  return Number.isFinite(exp) && Number.isFinite(expToNext) && expToNext > 0 && exp >= expToNext;
}

function lifespanRemainingYears(player) {
  const max = Number(player?.progression?.lifespan_max);
  const used = Number(player?.progression?.lifespan_used);
  if (!Number.isFinite(max) || !Number.isFinite(used)) return null;
  return max - used;
}

function shouldStopForLifespan(player) {
  const remaining = lifespanRemainingYears(player);
  return remaining !== null && remaining < CONFIG.minLifespanRemainingYears;
}

function nextRealmId(player) {
  return player?.progression?.next_realm_id
    || NEXT_REALM_BY_ID[player?.progression?.realm_id]
    || '';
}

function inventoryCount(player, itemId) {
  const item = (player?.inventory?.items || []).find((entry) => entry?.item_id === itemId);
  return Number(item?.count || 0);
}

function breakthroughRecipe(state, targetRealm) {
  return (state?.pill_recipes || []).find((recipe) => (
    recipe?.type === 'breakthrough' && recipe?.target_realm === targetRealm
  )) || null;
}

function chooseBreakthroughPill(state, targetRealm) {
  if (CONFIG.breakthroughPillId) return CONFIG.breakthroughPillId;

  const recipe = breakthroughRecipe(state, targetRealm);
  if (recipe?.pill_id) return recipe.pill_id;

  return BREAKTHROUGH_PILL_BY_TARGET_REALM[targetRealm] || '';
}

function shouldRethrowBreakthroughError(error) {
  return /WebSocket|timeout|closed before response|connect|token/i.test(formatError(error));
}

function isMinorRealmGateError(error) {
  return /尚未达到当前境界最高层|无法冲击下一大境界/.test(formatError(error));
}

function isSeclusionUnsafeAreaError(error) {
  return /闭关需在安全区域内进行|安全区域/.test(formatError(error));
}

function summarizeCultivation(result) {
  const exp = result?.gained_exp ?? result?.player?.progression?.exp;
  const qi = result?.gained_qi ?? result?.player?.resources?.qi;
  const stamina = getStamina(result?.player);
  const logs = logsOf(result);
  const parts = [];

  if (exp !== undefined) parts.push(`exp=${exp}`);
  if (qi !== undefined) parts.push(`qi=${qi}`);
  if (stamina !== null) parts.push(`stamina=${stamina}`);
  if (logs) parts.push(logs);

  return parts.join(' | ') || 'ok';
}

function summarizeTeleport(result) {
  const stamina = getStamina(result?.player);
  const logs = logsOf(result);
  const parts = [];

  if (stamina !== null) parts.push(`stamina=${stamina}`);
  if (logs) parts.push(logs);

  return parts.join(' | ') || 'ok';
}

function summarizeBreakthrough(result) {
  const logs = logsOf(result);
  const realm = result?.new_realm_id || result?.player?.progression?.realm_id;
  const stage = result?.player?.progression?.realm_stage;
  const parts = [];

  if (realm) parts.push(`realm=${realm}`);
  if (stage !== undefined) parts.push(`stage=${stage}`);
  if (logs) parts.push(logs);

  return parts.join(' | ') || 'ok';
}

function printState(state) {
  const player = state?.player;
  const name = player?.profile?.name || player?.profile?.username || 'unknown';
  const realm = player?.progression?.realm_id || 'unknown';
  const exp = player?.progression?.exp;
  const expToNext = player?.progression?.exp_to_next;
  const qi = player?.resources?.qi;
  const stamina = getStamina(player);
  const targetRealm = nextRealmId(player);

  console.log(`[${now()}] connected`);
  console.log(`[${now()}] player=${name} realm=${realm} exp=${exp ?? '-'}/${expToNext ?? '-'} full=${isProgressFull(player)} target_realm=${targetRealm || '-'} qi=${qi ?? '-'} stamina=${stamina ?? '-'} lifespan_remaining=${lifespanRemainingYears(player) ?? '-'}`);
}

function stopIfLifespanLow(state, cycle, phase) {
  const remaining = lifespanRemainingYears(state?.player);
  if (remaining === null || !shouldStopForLifespan(state?.player)) return false;

  console.log(`[${now()}] #${cycle} 寿元剩余 ${remaining} 年，低于 ${CONFIG.minLifespanRemainingYears} 年阈值，停止修炼脚本。phase=${phase}`);
  stopController.stop();
  return true;
}

async function teleportToSafeZone(client, state, cycle) {
  const before = getPosition(state?.player);
  const result = await client.rpc('action.teleport', { landmark_id: CONFIG.safeTeleportId });
  const nextState = { ...state, ...result };
  const after = getPosition(nextState?.player);

  currentPlayer = result?.player ?? currentPlayer;
  currentState = nextState;

  console.log(`[${now()}] #${cycle} 传送回安全区 landmark_id=${CONFIG.safeTeleportId} (${before.x},${before.y}) -> (${after.x},${after.y}) | ${summarizeTeleport(result)}`);
  return nextState;
}

async function cultivateOnce(client, state, cycle, options = {}) {
  const {
    mode = chooseCultivationMode(state?.player),
    label,
    fallbackSeclusion = true,
  } = options;

  const staminaBefore = getStamina(state?.player);
  let workingState = state;
  let actualMode = mode;
  let result;

  try {
    result = await client.rpc('action.cultivate', { mode });
  } catch (error) {
    if (mode === 'seclusion' && isSeclusionUnsafeAreaError(error)) {
      console.log(`[${now()}] 闭关失败，需要先回安全区: ${formatError(error)}`);
      workingState = await teleportToSafeZone(client, state, cycle);

      try {
        result = await client.rpc('action.cultivate', { mode: 'seclusion' });
      } catch (retryError) {
        if (!fallbackSeclusion) throw retryError;

        console.error(`[${now()}] 回到安全区后闭关仍失败，改为普通修炼: ${formatError(retryError)}`);
        actualMode = 'manual';
        result = await client.rpc('action.cultivate', { mode: 'manual' });
      }
    } else {
      if (!fallbackSeclusion || mode !== 'seclusion') throw error;

      console.error(`[${now()}] 闭关失败，改为普通修炼: ${formatError(error)}`);
      actualMode = 'manual';
      result = await client.rpc('action.cultivate', { mode: 'manual' });
    }
  }

  const nextState = { ...workingState, ...result };
  currentPlayer = result?.player ?? currentPlayer;
  currentState = nextState;

  console.log(`[${now()}] #${cycle} ${label || formatMode(actualMode)} stamina_before=${staminaBefore ?? '-'} | ${summarizeCultivation(result)}`);
  return nextState;
}

async function repairMinorRealmAdvance(client, state, cycle, breakthroughError) {
  console.log(`[${now()}] #${cycle} 大境界突破暂不可用：${formatError(breakthroughError)}。补发一次普通修炼以触发小境界晋升。`);

  try {
    const nextState = await cultivateOnce(client, state, cycle, {
      mode: 'manual',
      label: '补修触发小境界',
      fallbackSeclusion: false,
    });
    lastBreakthroughFailureAt = 0;
    return { state: nextState, attempted: true, success: true };
  } catch (error) {
    if (shouldRethrowBreakthroughError(error)) throw error;

    console.error(`[${now()}] #${cycle} 补修触发小境界失败: ${formatError(error)}`);
    return { state, attempted: true, success: false };
  }
}

async function maybeBreakthrough(client, state, cycle, reason = '修为已满') {
  const player = state?.player;
  if (!isProgressFull(player)) return { state, attempted: false, success: false };

  const targetRealm = nextRealmId(player);
  if (!targetRealm) {
    console.log(`[${now()}] #${cycle} ${reason}，但找不到下一境界，跳过突破。`);
    return { state, attempted: true, success: false };
  }

  const nowMs = Date.now();
  const retryRemaining = CONFIG.breakthroughRetryMs - (nowMs - lastBreakthroughFailureAt);
  if (lastBreakthroughFailureAt && retryRemaining > 0) {
    console.log(`[${now()}] #${cycle} ${reason}，突破失败冷却中，${Math.ceil(retryRemaining / 1000)} 秒后再试。`);
    await sleep(Math.min(retryRemaining, CONFIG.intervalMs));
    return { state, attempted: true, success: false };
  }

  const pillId = chooseBreakthroughPill(state, targetRealm);
  const pillCount = pillId ? inventoryCount(player, pillId) : 0;
  const pillPart = pillId ? ` consumed_pill_id=${pillId} count=${pillCount}` : ' consumed_pill_id=-';

  try {
    const result = await client.rpc('action.breakthrough', {
      target_realm: targetRealm,
      consumed_pill_id: pillId,
    });
    const nextState = { ...state, ...result };
    currentPlayer = result?.player ?? currentPlayer;
    currentState = nextState;
    lastBreakthroughFailureAt = 0;
    console.log(`[${now()}] #${cycle} 突破 target_realm=${targetRealm}${pillPart} | ${summarizeBreakthrough(result)}`);
    return { state: nextState, attempted: true, success: true };
  } catch (error) {
    if (shouldRethrowBreakthroughError(error)) throw error;
    if (isMinorRealmGateError(error)) return repairMinorRealmAdvance(client, state, cycle, error);

    lastBreakthroughFailureAt = Date.now();
    console.error(`[${now()}] #${cycle} 突破失败 target_realm=${targetRealm}${pillPart}: ${formatError(error)}`);
    return { state, attempted: true, success: false };
  }
}

async function runCycle({ client, cycle }) {
  await client.connect();

  const startedAt = Date.now();
  if (!currentState) currentState = await fetchState(client);
  currentPlayer = currentState?.player ?? currentPlayer;
  if (stopIfLifespanLow(currentState, cycle, 'before_action')) return;

  const beforeBreakthrough = await maybeBreakthrough(client, currentState, cycle, '修炼进度已满');
  currentState = beforeBreakthrough.state;
  if (stopIfLifespanLow(currentState, cycle, 'after_breakthrough_check')) return;
  if (beforeBreakthrough.attempted) {
    if (flags.once || stopController.stopped) return;
    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(0, CONFIG.intervalMs - elapsed));
    return;
  }

  const mode = chooseCultivationMode(currentPlayer);
  currentState = await cultivateOnce(client, currentState, cycle, { mode });
  if (stopIfLifespanLow(currentState, cycle, 'after_cultivation')) return;

  const afterBreakthrough = await maybeBreakthrough(client, currentState, cycle, '本轮修炼后进度已满');
  currentState = afterBreakthrough.state;
  if (stopIfLifespanLow(currentState, cycle, 'after_breakthrough')) return;

  if (flags.once || stopController.stopped) return;

  const elapsed = Date.now() - startedAt;
  await sleep(Math.max(0, CONFIG.intervalMs - elapsed));
}

runMain(runScript({
  name: 'auto cultivate',
  config: CONFIG,
  flags,
  stopController,
  validate: validateConfig,
  printState,
  runCycle,
  onError: () => {
    currentPlayer = null;
    currentState = null;
  },
  startMessage: () => `auto cultivate started, interval=${CONFIG.intervalMs}ms mode=${CONFIG.mode} seclusion_stamina_min=${CONFIG.seclusionStaminaMin} breakthrough_retry=${CONFIG.breakthroughRetryMs}ms safe_teleport=${CONFIG.safeTeleportId} min_lifespan_remaining=${CONFIG.minLifespanRemainingYears}`,
}));
