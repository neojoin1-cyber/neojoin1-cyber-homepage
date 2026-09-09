import fs from 'node:fs/promises';
import { fetchJobAlioDetail } from './fetch_vocational_jobs.mjs';
import { assessStudentEligibility } from './student_job_eligibility.mjs';

const source = process.argv[2] || 'assets/job-feed.json';
const destination = process.argv[3] || 'output/job-audit/eligibility-audit.json';
const feed = JSON.parse(await fs.readFile(source, 'utf8'));
const items = [...feed.items, ...(feed.supplementalItems || []), ...(feed.archiveItems || [])];
const records = [];
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < items.length) {
    const item = items[cursor++];
    let raw = item;
    let fetchError = '';
    if (item.source === 'job-alio-openapi' && /^\d+$/.test(item.sourceId)) {
      try {
        raw = await fetchJobAlioDetail({ idx: item.sourceId, title: item.baseTitle || item.title,
          company: item.company, deadline: item.deadline, eligibilityAuditOnly: true });
      } catch (error) { fetchError = error.message; }
    }
    records.push({ id: item.id, sourceId: item.sourceId, company: item.company, title: item.title,
      previousTier: item.studentPriority?.tier, assessment: assessStudentEligibility(raw), raw, fetchError });
    if (records.length % 25 === 0) console.log(`Official qualification audit: ${records.length}/${items.length}`);
  }
}));
records.sort((a, b) => a.id.localeCompare(b.id));
const summary = { total: records.length, eligible: 0, ineligible: 0, review: 0, fetchFailed: 0 };
for (const record of records) { summary[record.assessment.status]++; if (record.fetchError) summary.fetchFailed++; }
await fs.writeFile(destination, JSON.stringify({ generatedAt: new Date().toISOString(), summary, records }, null, 2) + '\n');
console.log(JSON.stringify(summary));
