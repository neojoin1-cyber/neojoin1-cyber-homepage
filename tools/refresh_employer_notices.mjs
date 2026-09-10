// Refresh links only; preserve collection dates, eligibility decisions and recruitment inventory.
import fs from 'node:fs/promises';
import path from 'node:path';
import { enrichEmployerNotices } from './employer_notice_resolver.mjs';
import { buildProtectedJobArtifacts } from './fetch_vocational_jobs.mjs';

const directory = path.resolve(process.argv[2] || 'assets');
const feed = JSON.parse(await fs.readFile(path.join(directory, 'job-feed.json'), 'utf8'));
const items = ['items', 'supplementalItems', 'archiveItems'].flatMap((key) => feed[key] || []);
feed.employerNoticeResolution = await enrichEmployerNotices(items);
feed.employerNoticeResolution.checkedAt = new Date().toISOString();
const artifacts = buildProtectedJobArtifacts(feed);
for (const [name, data] of [['job-feed.json', artifacts.publicPayload], ['job-detail-vault.json', artifacts.vault]]) {
  const file = path.join(directory, name);
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
}
console.log(JSON.stringify(feed.employerNoticeResolution));
