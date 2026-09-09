// Collection completeness and student eligibility are separate assertions.
export async function collectPages({ fetchPage, recordKey, pageSize = 100, maxPages = 40 }) {
  const records = new Map();
  const pages = [];
  const issues = [];
  let expectedTotal = null;
  let complete = false;
  for (let page = 1; page <= maxPages; page += 1) {
    let result;
    try { result = await fetchPage(page, pageSize); }
    catch {
      // Provider errors can contain credential-bearing URLs. Never persist them here.
      issues.push({ type: 'page-failed', page });
      break;
    }
    if (!Array.isArray(result.records)) throw new Error('Invalid collection page');
    const total = Number(result.totalCount);
    if (result.totalCount != null && Number.isFinite(total) && total >= 0) {
      if (expectedTotal != null && expectedTotal !== total) issues.push({ type: 'total-changed', page });
      expectedTotal = Math.max(expectedTotal ?? 0, total);
    }
    const before = records.size;
    for (const row of result.records) {
      const key = String(recordKey(row) || '');
      if (!key) { issues.push({ type: 'missing-id', page }); continue; }
      records.set(key, row);
    }
    pages.push({ page, received: result.records.length, added: records.size - before });
    if (expectedTotal != null && records.size >= expectedTotal) { complete = true; break; }
    if (!result.records.length) {
      complete = expectedTotal == null;
      if (!complete) issues.push({ type: 'premature-empty-page', page });
      break;
    }
    if (before === records.size) { issues.push({ type: 'repeated-page', page }); break; }
    // A server may clamp numOfRows. Only an empty page or totalCount proves the end.
    if (page === maxPages) issues.push({ type: 'page-limit', page });
  }
  return { records: [...records.values()], pages, expectedTotal, complete: complete && !issues.length,
    issues, missingCount: expectedTotal == null ? null : Math.max(0, expectedTotal - records.size) };
}

export const recordIdentity = (x) => `${x.source}:${x.sourceId || x.id}`;
const duplicateKey = (x) => [x.baseTitle || x.title, x.company, x.deadline || ''].join('|').toLowerCase();
const canonicalDate = (value) => String(value || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3').slice(0, 10);

export function buildCollectionAudit({ discovered, assessed, candidates, published, sources, publicationReasons = {}, previous = {}, generatedAt }) {
  const assessment = new Map(assessed.map((x) => [recordIdentity(x), x]));
  const publishedIds = new Map(published.map((x) => [recordIdentity(x), x]));
  const equivalent = new Map(published.map((x) => [duplicateKey(x), x]));
  const candidateIds = new Set(candidates.map(recordIdentity));
  const prior = new Map((previous.records || []).map((x) => [x.key, x]));
  const inventory = new Map();
  for (const row of [...discovered, ...assessed]) {
    const key = recordIdentity(row);
    inventory.set(key, { ...inventory.get(key), ...row });
  }
  const records = [...inventory.entries()].map(([key, row]) => {
    const item = assessment.get(key);
    const decision = item?.studentChannelAssessment?.qualificationAssessment;
    const match = item && (publishedIds.get(key) || equivalent.get(duplicateKey(item)));
    let disposition;
    let reasons = decision?.reasons || [];
    if (match) disposition = publishedIds.has(key) ? 'published' : 'duplicate';
    else if (row.collectionDisposition) disposition = row.collectionDisposition;
    else if (!item) disposition = 'unexplained';
    else if (['expired', 'application_closed'].includes(item.status)) disposition = 'closed';
    else if (decision?.status === 'ineligible') disposition = 'ineligible';
    else if (decision?.status !== 'eligible') disposition = 'needs-review';
    else if (publicationReasons[key]) {
      disposition = 'policy-excluded';
      reasons = [...reasons, publicationReasons[key]];
    }
    else if (item.studentChannelAssessment?.hardBlocked || !candidateIds.has(key)) {
      disposition = 'policy-excluded';
      reasons = [...reasons, 'Student-channel/source publication rules'];
    } else disposition = 'publication-review';
    const unresolved = ['unexplained', 'needs-review', 'detail-failed', 'deferred', 'publication-review'].includes(disposition);
    const old = prior.get(key);
    return { key, source: row.source, sourceId: String(row.sourceId || row.id), title: row.title, company: row.company,
      url: row.originalUrl || row.url || '', deadline: canonicalDate(row.deadline), disposition, reasons,
      retrievalDisposition: row.collectionDisposition || (item ? 'assessed' : 'unprocessed'),
      publishedId: match?.id || null, firstSeenAt: old?.firstSeenAt || generatedAt, checkedAt: generatedAt,
      unresolvedSince: unresolved ? old?.unresolvedSince || generatedAt : null,
      consecutiveUnresolved: unresolved ? (old?.consecutiveUnresolved || 0) + 1 : 0,
      priority: /고졸|고등학교|특성화|마이스터|학교장|지역인재/.test(row.title || '') ? 'high' : 'normal' };
  });
  const counts = {};
  for (const row of records) counts[row.disposition] = (counts[row.disposition] || 0) + 1;
  const sourceCoverage = sources.map((source) => ({ id: source.id, name: source.name, configured: source.configured, ok: source.ok,
    pagination: source.pagination || null, failedUrlCount: source.failedUrlCount || 0,
    discoveryIncompleteCount: source.discoveryIncompleteCount || 0,
    watchFailures: source.watchFailures || [],
    reachabilityOnlyEmployers: source.reachabilityOnlyEmployers || [],
    scope: source.collectionScope || 'Configured discovery/parser scope; not an exhaustive site crawl',
    discovered: records.filter((x) => x.source === source.id).length }));
  // Keep unresolved disappearances across runs, until rediscovered or the deadline passes.
  const priorInventory = new Map([...(previous.records || []), ...(previous.disappearedActive || [])].map((x) => [x.key, x]));
  const missingFromCurrentDiscovery = [...priorInventory.values()].filter((x) => !inventory.has(x.key)
    && x.deadline && canonicalDate(x.deadline) >= generatedAt.slice(0, 10));
  return { version: 1, generatedAt, exhaustive: false,
    summary: { discovered: records.length, counts,
      unexplained: counts.unexplained || 0,
      highPriorityReview: records.filter((x) => x.priority === 'high' && x.unresolvedSince).length,
      disappearedActive: missingFromCurrentDiscovery.length,
      incompletePagination: sourceCoverage.filter((x) => x.pagination && !x.pagination.complete).length },
    sources: sourceCoverage, disappearedActive: missingFromCurrentDiscovery.map((x) => ({ key: x.key,
      title: x.title, url: x.url, deadline: canonicalDate(x.deadline),
      missingSince: x.missingSince || generatedAt, consecutiveMissing: (x.consecutiveMissing || 0) + 1 })), records };
}

export function assertCollectionAudit(audit) {
  if (!audit?.records?.length) throw new Error('Collection inventory is empty');
  if (new Set(audit.records.map((x) => x.key)).size !== audit.records.length) throw new Error('Duplicate audit identities');
  if (audit.records.some((x) => !x.disposition || x.disposition === 'unexplained' || x.disposition === 'publication-review')) throw new Error('Unaccounted discovered notices');
  if (Object.values(audit.summary.counts).reduce((a, b) => a + b, 0) !== audit.records.length) throw new Error('Collection reconciliation mismatch');
}
