// Refresh links only; preserve collection dates, eligibility decisions and recruitment inventory.
import fs from 'node:fs/promises';
import path from 'node:path';
import { enrichEmployerNotices } from './employer_notice_resolver.mjs';
import { auditJobAttachments } from './job_attachment_audit.mjs';
import { cacheJobAttachments } from './job_attachment_cache.mjs';
import { buildProtectedJobArtifacts, buildPreviousZipDetailsByUrl, enhanceZipAttachmentsForItems } from './fetch_vocational_jobs.mjs';

const directory = path.resolve(process.argv.slice(2).find((arg) => !arg.startsWith('--')) || 'assets');
const feed = JSON.parse(await fs.readFile(path.join(directory, 'job-feed.json'), 'utf8'));
const items = ['items', 'supplementalItems', 'archiveItems'].flatMap((key) => feed[key] || []);
const zipCache = buildPreviousZipDetailsByUrl(items);
if (!process.argv.includes('--cache-only')) {
  if (!process.argv.includes('--attachments-only')) feed.employerNoticeResolution = await enrichEmployerNotices(items);
  feed.attachmentAudit = await auditJobAttachments(items);
}
feed.attachmentCache = await cacheJobAttachments(items, { directory: path.join(directory, 'job-attachment-files', 'originals') });
const zipSummary = await enhanceZipAttachmentsForItems(items, zipCache);
Object.assign(feed.summary, { zipAttachmentsScanned: zipSummary.scanned, zipAttachmentEntries: zipSummary.entryCount,
  zipAttachmentScanFailures: zipSummary.failed, zipAttachmentCachedScans: zipSummary.cached });
feed.employerNoticeResolution.checkedAt = new Date().toISOString();
feed.summary.companyNoticeChecked = feed.items.filter((item) => item.employerNotice?.status === 'verified').length;
const artifacts = buildProtectedJobArtifacts(feed);
for (const [name, data] of [['job-feed.json', artifacts.publicPayload], ['job-detail-vault.json', artifacts.vault]]) {
  const file = path.join(directory, name);
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
}
console.log(JSON.stringify({ attachmentAudit: feed.attachmentAudit, attachmentCache: feed.attachmentCache }));
