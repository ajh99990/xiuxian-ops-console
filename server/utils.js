const crypto = require('node:crypto');

function nowIso() {
  return new Date().toISOString();
}

function safeName(name) {
  const raw = String(name || 'log').trim() || 'log';
  const cleaned = raw
    .normalize('NFKC')
    .replace(/[\/\\:\0-\x1F]/g, '_')
    .slice(0, 96)
    .trim() || 'log';

  return cleaned === raw ? cleaned : `${cleaned}-${stableHash(raw, 8)}`;
}

function maskSecret(value) {
  const secret = String(value || '');
  if (!secret) return '';
  if (secret.length <= 18) return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
  return `${secret.slice(0, 10)}...${secret.slice(-8)}`;
}

function trimTextBytes(text, maxBytes) {
  const buffer = Buffer.from(text);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || buffer.length <= maxBytes) return text;

  const sliced = buffer.subarray(buffer.length - maxBytes).toString();
  const firstBreak = sliced.indexOf('\n');
  return firstBreak >= 0 ? sliced.slice(firstBreak + 1) : sliced;
}

function parseArgs(args) {
  if (Array.isArray(args)) return args.map(String).filter(Boolean);
  if (typeof args !== 'string') return [];
  return args.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function stableHash(value, length = 16) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function dayKey(date = new Date(), timezone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

module.exports = {
  dayKey,
  maskSecret,
  nowIso,
  parseArgs,
  safeName,
  stableHash,
  trimTextBytes,
};
