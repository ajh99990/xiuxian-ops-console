const {
  formatError,
  now,
} = require('../xiuxian-common');
const {
  summarizeActionResult,
  targetDistance,
} = require('./map');

function normalizeElement(element, player) {
  const nodeId = element?.node_instance_id || element?.id;
  const tileX = Number(element?.tile_x);
  const tileY = Number(element?.tile_y);
  if (!nodeId || !Number.isFinite(tileX) || !Number.isFinite(tileY)) return null;

  return {
    ...element,
    kind: 'element',
    id: nodeId,
    tile_x: tileX,
    tile_y: tileY,
    can_interact: element?.can_interact !== false,
    distance_to_player: targetDistance(player, { tile_x: tileX, tile_y: tileY }),
  };
}

function visibleElements(state) {
  return (state?.visible_elements || [])
    .map((element) => normalizeElement(element, state?.player))
    .filter(Boolean)
    .sort((a, b) => a.distance_to_player - b.distance_to_player);
}

function elementText(element) {
  return [
    element?.name,
    element?.element_label,
    element?.template_id,
    element?.element_type,
    element?.node_type,
    element?.type,
    element?.summary,
    element?.id,
    element?.node_instance_id,
  ].filter(Boolean).join('|').toLowerCase();
}

function isStarSeaElement(element) {
  const text = elementText(element);
  return /星海|幻境|xinghai|star.?sea|starsea/.test(text);
}

function starSeaTargets(state, definition) {
  return visibleElements(state)
    .filter((element) => element.can_interact && isStarSeaElement(element))
    .map((element) => ({
      ...element,
      elementType: 'star-sea',
      priority: definition.priority,
      priorityLabel: definition.label,
    }))
    .sort((a, b) => a.distance_to_player - b.distance_to_player);
}

function refreshElementTarget(state, target) {
  return visibleElements(state).find((element) => element.id === target.id) || null;
}

function isElementUnavailableError(error) {
  const message = formatError(error);
  return /已被.*(?:触发|夺取|领取|探索)|已经.*(?:触发|领取|探索)|不可交互|无法交互|未找到|不存在|已消失|等待下次刷新/.test(message);
}

async function interactElement(client, state, element, options = {}) {
  const {
    dryRun = false,
    label = '地图元素',
  } = options;

  if (dryRun) {
    console.log(`[${now()}] dry-run: 将交互${label} ${element.name || element.id} (${element.id})。`);
    return { state, skipped: false };
  }

  let result;
  try {
    result = await client.rpc('action.interact_element', { node_instance_id: element.id });
  } catch (error) {
    if (!isElementUnavailableError(error)) throw error;

    console.log(`[${now()}] ${label} ${element.name || element.id} 暂不可交互：${formatError(error)}，本小时不再重复尝试。`);
    return { state, skipped: true };
  }

  const summary = summarizeActionResult(result);
  console.log(`[${now()}] 已交互${label} ${element.name || element.id} (${element.id})${summary ? ` | ${summary}` : ''}`);
  return { state: { ...state, ...result }, skipped: false };
}

module.exports = {
  interactElement,
  isElementUnavailableError,
  isStarSeaElement,
  normalizeElement,
  refreshElementTarget,
  starSeaTargets,
  visibleElements,
};
