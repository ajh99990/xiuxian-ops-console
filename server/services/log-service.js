const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  safeName,
  trimTextBytes,
} = require('../utils');

class LogService {
  constructor(options = {}) {
    this.logDir = options.logDir;
    this.maxBytes = options.maxBytes;
    this.eventBus = options.eventBus;
  }

  async ensure() {
    await fsp.mkdir(this.logDir, { recursive: true });
  }

  pathFor(name) {
    return path.join(this.logDir, `${safeName(name)}.log`);
  }

  async append(name, chunk) {
    const text = chunk.toString();
    const file = this.pathFor(name);
    await fsp.appendFile(file, text);
    await this.trim(file);
    this.eventBus?.publish('log', { name, text });
  }

  async trim(file) {
    if (!Number.isFinite(this.maxBytes) || this.maxBytes <= 0) return;

    try {
      const stat = await fsp.stat(file);
      if (stat.size <= this.maxBytes) return;

      const text = await fsp.readFile(file, 'utf8');
      await fsp.writeFile(file, trimTextBytes(text, this.maxBytes));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async trimLines(file, maxLines) {
    const limit = Number(maxLines);
    if (!Number.isFinite(limit) || limit <= 0) return false;

    try {
      const text = await fsp.readFile(file, 'utf8');
      const hasFinalNewline = text.endsWith('\n');
      const lines = text.split(/\r?\n/);
      if (hasFinalNewline) lines.pop();
      if (lines.length <= limit) return false;

      const nextText = lines.slice(-limit).join('\n') + (hasFinalNewline ? '\n' : '');
      await fsp.writeFile(file, nextText);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async cleanup(options = {}) {
    const maxLines = Number(options.maxLines ?? 100);
    await this.ensure();

    const entries = await fsp.readdir(this.logDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
      .map((entry) => path.join(this.logDir, entry.name));

    let trimmed = 0;
    for (const file of files) {
      if (await this.trimLines(file, maxLines)) trimmed += 1;
    }

    return {
      files: files.length,
      maxLines,
      trimmed,
    };
  }

  async read(name, limit = 300) {
    const file = this.pathFor(name);

    try {
      const text = await fsp.readFile(file, 'utf8');
      const lines = text.split(/\r?\n/);
      return lines.slice(Math.max(0, lines.length - limit)).join('\n');
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      throw error;
    }
  }

  async clear(name) {
    await fsp.writeFile(this.pathFor(name), '');
    this.eventBus?.publish('log_reset', { name });
  }
}

module.exports = {
  LogService,
};
