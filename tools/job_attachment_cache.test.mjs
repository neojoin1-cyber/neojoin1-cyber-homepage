import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cacheJobAttachments, validateAttachment, downloadAttachment, assertCachedAttachments } from './job_attachment_cache.mjs';
import { collectJobAttachments } from '../assets/job-attachments.mjs';
import http from 'node:http';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
test('reject HTML errors, wrong extension and truncated full-file downloads', () => {
  assert.throws(() => validateAttachment(Buffer.from('<html>maintenance</html>'), '공고.pdf'));
  assert.throws(() => validateAttachment(Buffer.from('%PDF-1.4 truncated'), '공고.pdf'));
  assert.throws(() => validateAttachment(pdf, '추천서.hwp'));
  assert.equal(validateAttachment(pdf, '공고.pdf'), 'pdf');
});

test('store full files even after successful probes; prefer cache and deduplicate source lines', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'job-cache-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const url = 'https://www.alio.go.kr/download/download.json?fileNo=3071828';
  const rows = [{ attachments: [{ title: '공고.pdf', url, downloadCheck: { status: 'verified' } }],
    teacherBriefing: { attachmentLines: [`공고.pdf: ${url}`] } }];
  let calls = 0;
  const download = async () => { calls++; return pdf; };
  const result = await cacheJobAttachments(rows, { directory, download, now: () => '2026-09-10T01:00:00Z' });
  assert.equal(result.stored, 1);
  await assertCachedAttachments(rows, result, directory);
  const links = collectJobAttachments(rows[0]);
  assert.equal(links.length, 1);
  assert.match(links[0].url, /^https:\/\/gyo6.kr\/assets\/job-attachment-files\/originals\//);
  assert.equal(links[0].originalUrl, url);
  const duplicate = collectJobAttachments({ attachments: [...rows[0].attachments,
    { title: '공고.pdf', url: 'https://employer.example/other-download' }] });
  assert.equal(duplicate.length, 1);
  await cacheJobAttachments(rows, { directory, download, now: () => '2026-09-10T02:00:00Z' });
  assert.equal(calls, 1);
  const retained = await cacheJobAttachments(rows, { directory, download: async () => { throw Error('offline'); },
    now: () => '2026-09-12T00:00:00Z' });
  assert.equal(retained.retained, 1);
  assert.equal(retained.stored, 1);
  await fs.writeFile(path.join(directory, path.basename(rows[0].attachments[0].cachedUrl)), 'corrupt');
  await assert.rejects(assertCachedAttachments(rows, retained, directory));
  const failed = await cacheJobAttachments(rows, { directory, download: async () => { throw Error('offline'); } });
  assert.equal(failed.stored, 0);
  assert.equal(collectJobAttachments(rows[0])[0].url, url);
});

test('full downloader refuses partial responses and HTML, accepts binary 200', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/partial') { res.writeHead(206); res.end(pdf); }
    else if (req.url === '/html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>Error</html>'); }
    else { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end(pdf); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(downloadAttachment(base + '/partial'));
  await assert.rejects(downloadAttachment(base + '/html'));
  assert.deepEqual(await downloadAttachment(base + '/file'), pdf);
});
