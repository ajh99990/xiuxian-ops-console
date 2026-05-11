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
    cidPrefix: 'fudi',
    tokenEnvNames: ['XIUXIAN_TOKEN', 'XIULIAN_TOKEN'],
    verbose: flags.verbose,
  }),
  moveDelayMs: envNumber(['XIUXIAN_MOVE_DELAY_MS'], 1000),
  exploreWaitMs: envNumber(['XIUXIAN_EXPLORE_WAIT_MS'], 61000),
  retryDelayMs: envNumber(['XIUXIAN_RETRY_DELAY_MS'], 5000),
  staminaRecoverMs: envNumber(['XIUXIAN_STAMINA_RECOVER_MS'], 10000),
  ignoredZoneTtlMs: envNumber(['XIUXIAN_FUDI_IGNORED_ZONE_TTL_MS', 'XIUXIAN_IGNORED_ZONE_TTL_MS'], 10 * 60 * 1000),
  searchMode: envString(['XIUXIAN_FUDI_SEARCH_MODE', 'XIUXIAN_ZONE_SEARCH_MODE'], 'patrol'),
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
  zoneType: 'blessed',
  label: '福地',
  config: CONFIG,
  flags,
  stopController,
});

runMain(runScript({
  name: 'auto fudi',
  config: CONFIG,
  flags,
  stopController,
  validate: validateConfig,
  printState: explorer.printState,
  runCycle: explorer.runCycle,
  startMessage: () => `auto fudi started, move_delay=${CONFIG.moveDelayMs}ms explore_wait=${CONFIG.exploreWaitMs}ms search_mode=${CONFIG.searchMode} dry_run=${flags.dryRun}`,
}));
