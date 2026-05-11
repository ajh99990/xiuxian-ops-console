#!/usr/bin/env node

const {
  envNumber,
  envString,
  makeNakamaConfig,
} = require('./xiuxian-common');
const {
  assertNumber,
  createStopController,
  parseArgs,
  runMain,
  runScript,
} = require('./lib/runtime');
const { createZoneExplorer } = require('./lib/zone-explorer');

const flags = parseArgs();
const stopController = createStopController();

const CONFIG = {
  ...makeNakamaConfig({
    cidPrefix: 'danger',
    tokenEnvNames: ['XIUXIAN_TOKEN', 'XIULIAN_TOKEN'],
    verbose: flags.verbose,
  }),
  moveDelayMs: envNumber(['XIUXIAN_DANGER_MOVE_DELAY_MS', 'XIUXIAN_MOVE_DELAY_MS'], 1000),
  exploreWaitMs: envNumber(['XIUXIAN_DANGER_EXPLORE_WAIT_MS', 'XIUXIAN_EXPLORE_WAIT_MS'], 61000),
  retryDelayMs: envNumber(['XIUXIAN_DANGER_RETRY_DELAY_MS', 'XIUXIAN_RETRY_DELAY_MS'], 5000),
  staminaRecoverMs: envNumber(['XIUXIAN_DANGER_STAMINA_RECOVER_MS', 'XIUXIAN_STAMINA_RECOVER_MS'], 10000),
  ignoredZoneTtlMs: envNumber(['XIUXIAN_DANGER_IGNORED_ZONE_TTL_MS', 'XIUXIAN_IGNORED_ZONE_TTL_MS'], 10 * 60 * 1000),
  searchMode: envString(['XIUXIAN_DANGER_SEARCH_MODE', 'XIUXIAN_ZONE_SEARCH_MODE'], 'patrol'),
};

function validateConfig() {
  if (!['patrol', 'wait'].includes(CONFIG.searchMode)) throw new Error('invalid search mode, expected patrol/wait');
  assertNumber('move delay', CONFIG.moveDelayMs, { min: 0 });
  assertNumber('explore wait', CONFIG.exploreWaitMs, { min: 0, inclusive: false });
  assertNumber('retry delay', CONFIG.retryDelayMs, { min: 0, inclusive: false });
  assertNumber('stamina recover delay', CONFIG.staminaRecoverMs, { min: 0, inclusive: false });
  assertNumber('ignored zone ttl', CONFIG.ignoredZoneTtlMs, { min: 0, inclusive: false });
}

const explorer = createZoneExplorer({
  zoneType: 'danger',
  label: '凶地',
  config: CONFIG,
  flags,
  stopController,
});

runMain(runScript({
  name: 'auto danger',
  config: CONFIG,
  flags,
  stopController,
  validate: validateConfig,
  printState: explorer.printState,
  runCycle: explorer.runCycle,
  startMessage: () => `auto danger started, move_delay=${CONFIG.moveDelayMs}ms explore_wait=${CONFIG.exploreWaitMs}ms search_mode=${CONFIG.searchMode} dry_run=${flags.dryRun}`,
}));
