import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const DEFAULT_DIR = fileURLToPath(new URL('../assets/job-attachment-files/originals/', import.meta.url));
const MAX_BYTES = 20 * 1024 * 1024;
const TTL = 24 * 60 * 60 * 1000;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function validateAttachment(bytes, title) {
  const ext = String(title).match(/\.(pdf|hwp|hwpx|docx?|xlsx?|pptx?|zip|png|jpe?g|gif)\s*$/i)?.[1]?.toLowerCase();
  const magic = bytes.subarray(0, 8).toString('hex');
  const pdf = magic.startsWith('25504446') && /%%EOF\s*$/.test(bytes.subarray(-1024).toString('latin1'));
  const ole = magic.startsWith('d0cf11e0a1b11ae1') && bytes.length >= 512 && bytes.length % 512 === 0;
  const zip = magic.startsWith('504b0304') && bytes.subarray(-65557).includes(Buffer.from('504b0506', 'hex'));
  const valid = ext === 'pdf' ? pdf : /^(hwp|doc|xls|ppt)$/.test(ext || '') ? ole
    : /^(hwpx|docx|xlsx|pptx|zip)$/.test(ext || '') ? zip
    : ext === 'png' ? magic.startsWith('89504e470d0a1a0a')
    : /^jpe?g$/.test(ext || '') ? magic.startsWith('ffd8ff')
    : ext === 'gif' ? magic.startsWith('47494638') : false;
  if (!valid || bytes.length > MAX_BYTES) throw new Error('Invalid, incomplete or unsupported attachment');
  return ext;
}

export async function downloadAttachment(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'Mozilla/5.0 Gyo6AttachmentCache/1.0' } });
  if (response.status !== 200 || /text\/html/i.test(response.headers.get('content-type') || '')
    || Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error(`Attachment HTTP ${response.status} or invalid content`);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('Attachment size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function cacheJobAttachments(items, { directory = DEFAULT_DIR, download = downloadAttachment,
  now = () => new Date().toISOString() } = {}) {
  await fs.mkdir(directory, { recursive: true });
  const files = items.flatMap((item) => item.attachments || []);
  const pending = new Map();
  const unavailableHosts = new Set();
  const checkedAt = now();
  const materialize = async (file) => {
    let old = null;
    if (/^assets\/job-attachment-files\/originals\/[a-f0-9]{64}\.[a-z0-9]+$/.test(file.cachedUrl || '')) {
      try {
        const bytes = await fs.readFile(path.join(directory, path.basename(file.cachedUrl)));
        validateAttachment(bytes, file.title);
        if (hash(bytes) === file.cacheCheck?.sha256 && bytes.length === file.cacheCheck?.bytes
          && file.cacheCheck.originalUrl === file.url) old = file;
      } catch { /* Missing or corrupt caches must be rebuilt, never advertised. */ }
    }
    const age = Date.parse(checkedAt) - Date.parse(old?.cacheCheck?.checkedAt || '');
    if (old && age >= 0 && age < TTL) return { cachedUrl: old.cachedUrl, cacheCheck: old.cacheCheck };
    try {
      const host = new URL(file.url).host;
      let bytes;
      let recoveredAt = '';
      try {
        if (unavailableHosts.has(host)) throw new Error('Source host connection unavailable this run');
        bytes = await download(file.url);
      } catch (error) {
        if (error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' || error.name === 'TimeoutError') unavailableHosts.add(host);
        // Reuse an exact-URL qualification download, not a similarly named document.
        const extension = String(file.title).match(/\.(pdf|hwpx|zip)$/i)?.[1]?.toLowerCase();
        if (!extension) throw error;
        const prior = path.resolve(directory, '../../.qualification-cache', `${hash(file.url).slice(0, 18)}.${extension}`);
        try {
          bytes = await fs.readFile(prior);
          recoveredAt = (await fs.stat(prior)).mtime.toISOString();
        } catch { throw error; }
      }
      const ext = validateAttachment(bytes, file.title);
      const sha256 = hash(bytes);
      const name = `${sha256}.${ext}`;
      // Content-addressed files keep previous downloads valid across feed refreshes.
      const temporary = path.join(directory, `${name}.${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, bytes);
        await fs.rename(temporary, path.join(directory, name));
      } finally { await fs.rm(temporary, { force: true }); }
      return { cachedUrl: `assets/job-attachment-files/originals/${name}`,
        cacheCheck: { status: recoveredAt ? 'retained' : 'stored', checkedAt: recoveredAt || checkedAt,
          ...(recoveredAt ? { retryAt: checkedAt, recoveredFrom: 'qualification-cache' } : {}),
          sha256, bytes: bytes.length, originalUrl: file.url } };
    } catch (error) {
      return { cachedUrl: old?.cachedUrl || '', cacheCheck: old
        ? { ...old.cacheCheck, status: 'retained', retryAt: checkedAt }
        : { status: 'retry-required', checkedAt, reason: error.message } };
    }
  };
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, files.length) }, async () => {
    while (cursor < files.length) {
      const file = files[cursor++];
      if (!pending.has(file.url)) pending.set(file.url, materialize(file));
      Object.assign(file, await pending.get(file.url));
    }
  }));
  return { checkedAt, total: files.length, stored: files.filter((f) => f.cachedUrl).length,
    retained: files.filter((f) => f.cacheCheck?.status === 'retained').length,
    retryRequired: files.filter((f) => !f.cachedUrl).length };
}

export async function assertCachedAttachments(items, summary, directory = DEFAULT_DIR) {
  const files = items.flatMap((item) => item.attachments || []);
  const cached = files.filter((file) => file.cachedUrl);
  if (summary.total !== files.length || summary.stored !== cached.length
    || summary.retryRequired !== files.length - cached.length) throw new Error('Attachment cache reconciliation mismatch');
  const checked = new Set();
  for (const file of cached) {
    if (file.cacheCheck?.originalUrl !== file.url
      || !['stored', 'retained'].includes(file.cacheCheck?.status)
      || !/^assets\/job-attachment-files\/originals\/[a-f0-9]{64}\.[a-z0-9]+$/.test(file.cachedUrl)) {
      throw new Error('Invalid attachment cache provenance');
    }
    const key = `${file.cachedUrl}:${file.cacheCheck.sha256}:${file.cacheCheck.bytes}`;
    if (checked.has(key)) continue;
    const bytes = await fs.readFile(path.join(directory, path.basename(file.cachedUrl)));
    const ext = validateAttachment(bytes, file.title);
    if (hash(bytes) !== file.cacheCheck.sha256 || bytes.length !== file.cacheCheck.bytes
      || path.basename(file.cachedUrl) !== `${file.cacheCheck.sha256}.${ext}`) throw new Error('Attachment cache integrity mismatch');
    checked.add(key);
  }
}
