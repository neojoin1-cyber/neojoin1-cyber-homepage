// Recheck a collected snapshot without pretending that sources were fetched again.
import fs from 'node:fs/promises';
import path from 'node:path';
import { assessStudentEligibility } from './student_job_eligibility.mjs';
import { applyPublicationSafetyGuards, buildProtectedJobArtifacts, buildFeedHealth } from './fetch_vocational_jobs.mjs';

const directory = path.resolve(process.argv[2] || 'assets');
const feed = JSON.parse(await fs.readFile(path.join(directory, 'job-feed.json'), 'utf8'));
const lists = ['items', 'supplementalItems', 'archiveItems'];
const original = lists.flatMap((key) => feed[key] || []);
const review = new Map((feed.qualificationReview || []).map((item) => [`${item.source}:${item.sourceId || item.id}`, item]));
for (const item of original) {
  const assessment = assessStudentEligibility(item);
  if (assessment.status === 'eligible') continue;
  review.set(`${item.source}:${item.sourceId || item.id}`, {
    source: item.source, sourceId: item.sourceId, title: item.title, company: item.company,
    url: item.originalUrl || item.url, deadline: item.deadline,
    status: assessment.status, reasons: assessment.reasons,
    evidence: assessment.evidence, roleEvidence: assessment.roleEvidence,
    attachments: item.qualificationAttachments || []
  });
}
const safe = applyPublicationSafetyGuards(feed.items, feed.archiveItems, feed.supplementalItems);
for (const key of lists) feed[key] = safe[key];
feed.eligibilityRevalidatedAt = new Date().toISOString();
feed.qualificationReview = [...review.values()];
feed.publicationSafety = safe.report;
const count = (predicate) => feed.items.filter(predicate).length;
Object.assign(feed.summary, {
  total: feed.items.length, supplemental: feed.supplementalItems.length,
  archivedPublicRecruit: feed.archiveItems.length,
  active: count((item) => item.status === 'active'),
  deadlineSoon: count((item) => item.status === 'deadline_soon'),
  applicationClosed: count((item) => item.status === 'application_closed'),
  examFormal: count((item) => item.processTrack === 'exam-formal'),
  directInterview: count((item) => item.processTrack === 'direct-interview'),
  companyNoticeChecked: count((item) => ['company_notice_confirmed', 'company_notice_reachable', 'job_alio_detail_confirmed'].includes(item.sourceVerification?.doubleCheckStatus)),
  briefingReady: count((item) => item.teacherBriefing?.teacherShareText),
  detailedPublicRecruit: count((item) => item.detailLevel === 'detailed-public-recruit'),
  briefDirect: count((item) => item.detailLevel === 'brief-company-contact'),
  regionalEducationVerified: count((item) => item.regionalEducationVerification?.count > 0),
  regionalEducationVerificationLinked: count((item) => item.regionalEducationVerification?.count > 0),
  firstDayCollected: count((item) => item.collectionAudit?.firstDayCollected),
  lateDetected: count((item) => item.collectionAudit?.firstDayStatus === 'late_detected'),
  missedReviewNeeded: count((item) => item.collectionAudit?.missedReviewNeeded),
  publicationBlocked: safe.report.blockedCount, publicationRepaired: safe.report.repairedCount,
  studentRecruitSafetyReview: safe.report.studentRecruitReviewCount,
  staleFallbackItems: count((item) => item.staleSourceFallback),
  sourceFallbackProtected: count((item) => item.collectionAudit?.sourceFallback)
});
const artifacts = buildProtectedJobArtifacts(feed);
for (const [name, payload] of [
  ['job-feed.json', artifacts.publicPayload],
  ['job-detail-vault.json', artifacts.vault],
  ['job-feed-health.json', buildFeedHealth(feed, safe.report)]
]) {
  const destination = path.join(directory, name);
  await fs.writeFile(`${destination}.tmp`, JSON.stringify(payload, null, 2) + '\n');
  await fs.rename(`${destination}.tmp`, destination);
}
console.log(JSON.stringify({ before: original.length, after: lists.reduce((sum, key) => sum + feed[key].length, 0), blocked: safe.report.blockedCount, revalidatedAt: feed.eligibilityRevalidatedAt }));
