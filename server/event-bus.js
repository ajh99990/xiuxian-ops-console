const { nowIso } = require('./utils');

function createEventBus() {
  const subscribers = new Set();

  function publish(type, payload = {}) {
    const event = JSON.stringify({ type, at: nowIso(), ...payload });

    for (const res of subscribers) {
      res.write(`data: ${event}\n\n`);
    }
  }

  function handleEvents(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');
    subscribers.add(res);
    req.on('close', () => subscribers.delete(res));
  }

  return {
    publish,
    handleEvents,
    get subscriberCount() {
      return subscribers.size;
    },
  };
}

module.exports = {
  createEventBus,
};
