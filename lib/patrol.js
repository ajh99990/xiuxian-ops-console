const {
  directionLabel,
  getPosition,
  getStamina,
  now,
  sleep,
} = require('../xiuxian-common');
const { summarizeActionResult } = require('./map');

function createPatrol() {
  const patrol = {
    directionIndex: 0,
    horizontal: 'east',
    legLength: 1,
    stepsRemaining: 1,
    legsCompleted: 0,
  };

  function chooseDirection(state) {
    const player = state?.player;
    const position = getPosition(player);
    const map = state?.visible_map || {};
    const width = Number(map.width);
    const height = Number(map.height);
    const finite = map.infinite !== true && Number.isFinite(width) && Number.isFinite(height) && width > 1 && height > 1;

    if (finite) {
      if (patrol.horizontal === 'east') {
        if (position.x < width - 1) return 'east';
        if (position.y < height - 1) {
          patrol.horizontal = 'west';
          return 'south';
        }
        return null;
      }

      if (position.x > 0) return 'west';
      if (position.y < height - 1) {
        patrol.horizontal = 'east';
        return 'south';
      }
      return null;
    }

    const directions = ['east', 'south', 'west', 'north'];
    const direction = directions[patrol.directionIndex % directions.length];
    patrol.stepsRemaining -= 1;
    if (patrol.stepsRemaining <= 0) {
      patrol.directionIndex += 1;
      patrol.legsCompleted += 1;
      if (patrol.legsCompleted % 2 === 0) patrol.legLength += 1;
      patrol.stepsRemaining = patrol.legLength;
    }
    return direction;
  }

  return {
    chooseDirection,
  };
}

async function patrolStep(client, state, options = {}) {
  const {
    dryRun = false,
    moveDelayMs = 0,
    staminaRecoverMs = 10000,
    label = '目标',
    patrol = createPatrol(),
  } = options;

  const direction = patrol.chooseDirection(state);
  if (!direction) {
    console.log(`[${now()}] 没找到${label}，当前位置没有可巡游方向。`);
    return { state, moved: false };
  }

  const stamina = getStamina(state?.player);
  if (stamina !== null && stamina < 1) {
    console.log(`[${now()}] 体力不足，等待 ${Math.ceil(staminaRecoverMs / 1000)} 秒恢复后继续巡游。`);
    await sleep(staminaRecoverMs);
    return { state, moved: false };
  }

  if (dryRun) {
    console.log(`[${now()}] 没找到${label}，dry-run: 将向${directionLabel(direction)}巡游搜索。`);
    return { state, moved: false };
  }

  const before = getPosition(state.player);
  const result = await client.rpc('action.move', { direction });
  const nextState = { ...state, ...result };
  const after = getPosition(nextState.player);
  const summary = summarizeActionResult(result);

  console.log(`[${now()}] 没找到${label}，巡游向${directionLabel(direction)} (${before.x},${before.y}) -> (${after.x},${after.y}) stamina=${getStamina(nextState.player) ?? '-'}${summary ? ` | ${summary}` : ''}`);
  if (moveDelayMs > 0) await sleep(moveDelayMs);

  return { state: nextState, moved: true };
}

module.exports = {
  createPatrol,
  patrolStep,
};
