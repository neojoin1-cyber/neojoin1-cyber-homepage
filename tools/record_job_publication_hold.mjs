import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { buildFeedHealth } from './fetch_vocational_jobs.mjs';

// A rejected candidate is not the published feed. Keep public counters tied to Git's last accepted snapshot.
const published = JSON.parse(execFileSync('git', ['show', 'HEAD:assets/job-feed.json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true }));
let attempted = {};
try { attempted = JSON.parse(await fs.readFile('assets/job-feed-health.json', 'utf8')); } catch { /* First-run diagnostic. */ }
const health = buildFeedHealth(published, published.publicationSafety, 'degraded-held');
health.publicationHold = {
  heldAt: new Date().toISOString(), previousFeedPreserved: true,
  reason: 'Collection or publication verification failed; the last accepted public feed is retained.',
  attemptedFeedGeneratedAt: attempted.feedGeneratedAt || null,
  attemptedSummary: attempted.summary || null
};
await fs.writeFile('assets/job-feed-health.json', `${JSON.stringify(health, null, 2)}\n`);
console.log('Recorded publication hold against the last accepted feed; rejected candidate was not published.');
