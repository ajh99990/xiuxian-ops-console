const fsp = require('node:fs/promises');
const path = require('node:path');

class JsonStore {
  constructor(options = {}) {
    this.filePath = options.filePath;
    this.defaultValue = options.defaultValue ?? {};
    this.queue = Promise.resolve();
  }

  async ensureDir() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
  }

  async read() {
    try {
      return JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(this.defaultValue);
      throw error;
    }
  }

  async write(value) {
    await this.ensureDir();
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fsp.rename(tempPath, this.filePath);
    return value;
  }

  async update(updater) {
    const operation = this.queue.then(async () => {
      const current = await this.read();
      const next = await updater(current);
      return this.write(next);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

module.exports = {
  JsonStore,
};
