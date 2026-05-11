const {
  directionLabel,
  fetchState,
  getPosition,
  getStamina,
  logsOf,
  manhattan,
  nextDirectionToTarget,
  now,
  sleep,
} = require('../xiuxian-common');

function targetDistance(player, target) {
  return manhattan(getPosition(player), { x: target.tile_x, y: target.tile_y });
}

function withDistance(target, player) {
  return {
    ...target,
    distance_to_player: target.distance_to_player ?? targetDistance(player, target),
  };
}

function chooseNearest(targets, player) {
  return targets
    .map((target) => withDistance(target, player))
    .sort((a, b) => a.distance_to_player - b.distance_to_player)[0] || null;
}

function hasArrived(player, target) {
  const position = getPosition(player);
  return position.x === target.tile_x && position.y === target.tile_y;
}

function defaultTargetLabel(target) {
  return target?.name || target?.id || `(${target?.tile_x},${target?.tile_y})`;
}

function summarizeRewards(result) {
  if (!Array.isArray(result?.rewards) || !result.rewards.length) return '';
  return result.rewards.map((item) => `${item.item_name || item.item_id}x${item.count ?? 1}`).join('、');
}

function summarizeCapture(result) {
  const capture = result?.capture_result;
  if (!capture) return '';
  const name = capture.target_name || capture.beast_name || '灵兽';
  return capture.success ? `捕获成功：${name}` : `捕获失败：${name}`;
}

function summarizeActionResult(result) {
  const parts = [];
  const logs = logsOf(result);
  const rewards = summarizeRewards(result);
  const capture = summarizeCapture(result);
  if (logs) parts.push(logs);
  if (rewards) parts.push(`获得：${rewards}`);
  if (capture) parts.push(capture);
  return parts.join(' | ');
}

async function moveToTarget(client, initialState, target, options = {}) {
  const {
    stopController,
    dryRun = false,
    moveDelayMs = 0,
    staminaRecoverMs = 10000,
    labelTarget = defaultTargetLabel,
    summarize = summarizeActionResult,
    beforeStep,
    afterStep,
  } = options;

  let state = initialState;
  let player = state.player;
  let currentTarget = target;
  let steps = 0;

  while (!stopController?.stopped) {
    const beforeDecision = await beforeStep?.({
      client,
      state,
      player,
      target: currentTarget,
      steps,
    });

    if (beforeDecision?.state) {
      state = beforeDecision.state;
      player = state.player || player;
    }
    if (beforeDecision?.target) currentTarget = beforeDecision.target;
    if (beforeDecision?.stop) return state;

    const direction = nextDirectionToTarget(player, currentTarget);
    if (!direction) return state;

    const stamina = getStamina(player);
    if (stamina !== null && stamina < 1) {
      console.log(`[${now()}] 体力不足，等待 ${Math.ceil(staminaRecoverMs / 1000)} 秒恢复后继续移动。`);
      await sleep(staminaRecoverMs);
      state = await fetchState(client);
      player = state.player;
      continue;
    }

    if (dryRun) {
      console.log(`[${now()}] dry-run: 将向${directionLabel(direction)}移动，目标 ${labelTarget(currentTarget)} (${currentTarget.tile_x},${currentTarget.tile_y})。`);
      return state;
    }

    const before = getPosition(player);
    const result = await client.rpc('action.move', { direction });
    steps += 1;
    state = { ...state, ...result };
    player = result?.player || state.player || player;

    const after = getPosition(player);
    const summary = summarize(result);
    console.log(`[${now()}] 移动 #${steps} 向${directionLabel(direction)} (${before.x},${before.y}) -> (${after.x},${after.y}) stamina=${getStamina(player) ?? '-'}${summary ? ` | ${summary}` : ''}`);

    const afterDecision = await afterStep?.({
      client,
      state,
      player,
      target: currentTarget,
      steps,
      result,
    });

    if (afterDecision?.state) {
      state = afterDecision.state;
      player = state.player || player;
    }
    if (afterDecision?.target) currentTarget = afterDecision.target;
    if (afterDecision?.stop) return state;

    if (moveDelayMs > 0) await sleep(moveDelayMs);
  }

  return state;
}

module.exports = {
  chooseNearest,
  defaultTargetLabel,
  hasArrived,
  moveToTarget,
  summarizeActionResult,
  summarizeCapture,
  summarizeRewards,
  targetDistance,
  withDistance,
};
