const { createScheduledTask } = require('./create-scheduled-task');

function createScheduler(context = {}) {
  const tasks = new Map();

  function register(definition) {
    if (tasks.has(definition.name)) throw new Error(`scheduled task duplicated: ${definition.name}`);
    const task = createScheduledTask(definition, context);
    tasks.set(definition.name, task);
    return task;
  }

  function registerMany(definitions = []) {
    return definitions.map(register);
  }

  function startAll() {
    for (const task of tasks.values()) task.start();
  }

  function stopAll() {
    for (const task of tasks.values()) task.stop();
  }

  function list() {
    return [...tasks.values()].map((task) => task.status());
  }

  async function runNow(name) {
    const task = tasks.get(name);
    if (!task) throw new Error(`scheduled task not found: ${name}`);
    return task.execute('manual');
  }

  return {
    list,
    register,
    registerMany,
    runNow,
    startAll,
    stopAll,
  };
}

module.exports = {
  createScheduler,
};
