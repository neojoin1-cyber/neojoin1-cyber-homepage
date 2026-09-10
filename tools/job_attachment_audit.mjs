import { fetchNoticePage, noticeAttachments } from './employer_notice_resolver.mjs';
import { referenceNoticeUrl, isEmployerDetailUrl } from '../assets/job-official-links.mjs';

const identity = (item) => `${item.source}:${item.sourceId || item.id}:${item.deadline || ''}`;

export async function probeAttachment(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000),
    headers: { Range: 'bytes=0-1023', 'User-Agent': 'Mozilla/5.0 Gyo6AttachmentCheck/1.0' } });
  const reader = response.body?.getReader();
  const chunk = reader ? await reader.read() : { value: null };
  await reader?.cancel();
  const bytes = Buffer.from(chunk.value || []);
  const type = response.headers.get('content-type') || '';
  const prefix = bytes.subarray(0, 128).toString('utf8');
  const signature = /^(?:25504446|d0cf11e0|504b0304|89504e47|ffd8ff|47494638)/i.test(bytes.subarray(0, 8).toString('hex'));
  const attachment = /attachment/i.test(response.headers.get('content-disposition') || '');
  return { ok: response.ok && bytes.length > 0 && !/text\/html/i.test(type)
      && !/^\s*(?:<!doctype|<html)/i.test(prefix) && (signature || attachment), httpStatus: response.status };
}

export async function auditJobAttachments(items, { previousItems = [], fetchPage = fetchNoticePage,
  probe = probeAttachment, now = () => new Date().toISOString() } = {}) {
  const previous = new Map([...previousItems].map((item) => [identity(item), item]));
  const pages = new Map();
  const probes = new Map();
  const get = (cache, key, action) => {
    if (!cache.has(key)) cache.set(key, action(key).catch(() => null));
    return cache.get(key);
  };
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      const checkedAt = now();
      const old = previous.get(identity(item));
      const files = new Map();
      for (const file of [...(old?.attachments || []), ...(item.attachments || [])]) {
        const url = String(file.url || '').replace(/;jsessionid=[^?&#/]*/gi, '');
        if (/^https?:\/\//.test(url) && file.title !== '회사·기관 공식 공고문'
          && !/\/preview\./i.test(new URL(url).pathname)) files.set(url, { ...files.get(url), ...file, url });
      }
      const source = referenceNoticeUrl(item);
      const exactSource = /^https:\/\/job\.alio\.go\.kr\/(?:mobile2021\/recruit\/recruitView|recruitview)\.do\?idx=\d+$/i.test(source)
        || isEmployerDetailUrl(source);
      const page = exactSource ? await get(pages, source, fetchPage) : null;
      const employerUrl = item.employerNotice?.status === 'verified' && isEmployerDetailUrl(item.employerNotice.url)
        ? item.employerNotice.url : '';
      const employerPage = employerUrl && employerUrl !== source ? await get(pages, employerUrl, fetchPage) : null;
      const discovered = [page, employerPage].filter(Boolean).flatMap((p) => noticeAttachments(p.html, p.url));
      for (const file of discovered) files.set(file.url, { ...files.get(file.url), ...file });
      const failures = [];
      for (const [url, file] of files) {
        // Reuse a recent successful binary probe, not a mere page/title check.
        const age = Date.parse(checkedAt) - Date.parse(file.downloadCheck?.checkedAt || '');
        if (file.downloadCheck?.status === 'verified' && age >= 0 && age < 24 * 60 * 60 * 1000) continue;
        const result = await get(probes, url, probe);
        if (result?.ok) files.set(url, { ...file, downloadCheck: { status: 'verified', checkedAt, httpStatus: result.httpStatus } });
        else {
          // Preserve the link and last proof on transient failure; never erase known documents.
          files.set(url, { ...file, downloadCheck: { status: 'retry-required', checkedAt,
            lastVerifiedAt: file.downloadCheck?.status === 'verified' ? file.downloadCheck.checkedAt : file.downloadCheck?.lastVerifiedAt || null } });
          failures.push(url);
        }
      }
      item.attachments = [...files.values()];
      const verified = item.attachments.filter((f) => f.downloadCheck.status === 'verified').length;
      item.attachmentAudit = { checkedAt, status: verified && !failures.length ? 'verified'
        : files.size ? 'retry-required' : 'missing-review', referenceUrl: source,
      referenceRead: Boolean(page), discovered: discovered.length, total: files.size, verified, failures };
      if (item.teacherBriefing) {
        item.teacherBriefing.attachmentLines = item.attachments.map((f) => `${f.title}: ${f.url}`);
        const text = item.teacherBriefing.teacherShareText;
        if (text?.includes('[원문·첨부]')) item.teacherBriefing.teacherShareText = text.split('[원문·첨부]')[0]
          + '[원문·첨부]\n' + [...(item.teacherBriefing.sourceLines || []), ...item.teacherBriefing.attachmentLines].map((x) => `- ${x}`).join('\n');
      }
    }
  }));
  const summary = { checkedAt: now(), total: items.length, verified: 0, retryRequired: 0, missingReview: 0,
    files: 0, verifiedFiles: 0, unresolved: [] };
  for (const item of items) {
    const audit = item.attachmentAudit;
    summary.files += audit.total;
    summary.verifiedFiles += audit.verified;
    if (audit.status === 'verified') summary.verified++;
    else {
      if (audit.status === 'retry-required') summary.retryRequired++;
      else summary.missingReview++;
      summary.unresolved.push({ source: item.source, sourceId: item.sourceId, company: item.company,
        title: item.title, status: audit.status, url: audit.referenceUrl });
    }
  }
  assertAttachmentAudit(items, summary);
  return summary;
}

export function assertAttachmentAudit(items, summary) {
  if (summary.total !== items.length || items.some((item) => !item.attachmentAudit)) throw new Error('Attachment audit missing');
  if (items.some((item) => item.attachmentAudit.status === 'verified'
    && (!item.attachments.length || item.attachments.some((f) => f.downloadCheck?.status !== 'verified')))) throw new Error('Unverified attachment publication');
  if (summary.verified + summary.retryRequired + summary.missingReview !== items.length) throw new Error('Attachment reconciliation mismatch');
}
