import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function freshPrimarySource(feed, startedAt) {
  const start = Date.parse(startedAt);
  const source = feed?.sourceStatus?.find(item => item.id === 'job-alio-openapi');
  return Number.isFinite(start) && source?.ok === true
    && Date.parse(feed.generatedAt) >= start
    && Date.parse(source.checkedAt) >= start
    && source.scannedCount > 0 && source.scanTargetCount > 0 && source.rawItemCount > 0;
}

export async function preflight(fetcher = fetch, delay = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetcher('https://job.alio.go.kr/recruit.do?pageNo=1', {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'gyo6-job-feed/1.0 (+https://gyo6.kr/jobs.html)' }
      });
      if (response.ok && /recruitview\.do\?idx=\d+/.test(await response.text())) return true;
    } catch { /* A failed connection is not evidence of an empty job market. */ }
    if (attempt < 2) await delay(2000);
  }
  return false;
}

async function main() {
  const mode = process.argv[2];
  const ready = mode === 'preflight'
    ? await preflight()
    : mode === 'freshness'
      ? freshPrimarySource(JSON.parse(await fs.readFile('assets/job-feed.json', 'utf8')), process.env.JOB_FEED_RUN_STARTED_AT)
      : false;
  console.log(JSON.stringify({ gate: mode, ready, checkedAt: new Date().toISOString() }));
  if (!ready) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
