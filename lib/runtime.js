const {
  NakamaSocketClient,
  fetchState,
  formatError,
  now,
  sleep,
} = require('../xiuxian-common');

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);

  function has(name) {
    return args.has(name);
  }

  function value(name, fallback = '') {
    const prefix = `${name}=`;
    const found = argv.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
  }

  return {
    raw: argv,
    args,
    has,
    value,
    once: has('--once'),
    stateOnly: has('--state'),
    dryRun: has('--dry-run'),
    verbose: has('--verbose'),
  };
}

function createStopController() {
  let stopped = false;

  const handleSigint = () => {
    stopped = true;
    console.log(`\n[${now()}] stopping...`);
  };
  const handleSigterm = () => {
    stopped = true;
  };

  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);

  return {
    get stopped() {
      return stopped;
    },
    stop() {
      stopped = true;
    },
    dispose() {
      process.off('SIGINT', handleSigint);
      process.off('SIGTERM', handleSigterm);
    },
  };
}

function assertNumber(name, value, options = {}) {
  const { min = Number.NEGATIVE_INFINITY, inclusive = true } = options;
  const valid = Number.isFinite(value) && (inclusive ? value >= min : value > min);
  if (!valid) throw new Error(`invalid ${name}`);
}

async function runScript(options) {
  const {
    name,
    config,
    flags,
    stopController = createStopController(),
    validate,
    printState,
    runCycle,
    startMessage,
    onError,
    stopAfterCycle,
    rethrowErrors,
  } = options;

  validate?.();

  const client = new NakamaSocketClient(config);

  try {
    if (flags.stateOnly) {
      if (!printState) throw new Error(`${name || 'script'} missing state printer`);
      await printState(await fetchState(client), { client, config, flags, stopController });
      return;
    }

    const message = typeof startMessage === 'function'
      ? startMessage({ config, flags })
      : startMessage || `${name || 'script'} started`;
    console.log(`[${now()}] ${message}`);

    let cycle = 0;
    let reconnectDelayMs = 1000;

    while (!stopController.stopped) {
      try {
        cycle += 1;
        await runCycle({ client, cycle, config, flags, stopController });
        reconnectDelayMs = 1000;

        const shouldStop = stopAfterCycle
          ? stopAfterCycle({ cycle, config, flags, stopController })
          : flags.once || flags.dryRun;
        if (shouldStop) break;
      } catch (error) {
        console.error(`[${now()}] failed: ${formatError(error)}`);
        await onError?.(error, { client, config, flags, stopController });
        await client.close();

        const shouldRethrow = rethrowErrors
          ? rethrowErrors(error, { config, flags, stopController })
          : flags.once || flags.stateOnly;
        if (shouldRethrow) throw error;

        await sleep(reconnectDelayMs);
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, 15000);
      }
    }
  } finally {
    await client.close();
    stopController.dispose?.();
  }
}

function runMain(promise) {
  promise.catch((error) => {
    console.error(`[${now()}] fatal: ${formatError(error)}`);
    process.exit(1);
  });
}

module.exports = {
  assertNumber,
  createStopController,
  parseArgs,
  runMain,
  runScript,
};
