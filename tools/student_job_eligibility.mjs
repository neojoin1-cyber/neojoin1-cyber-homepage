// Eligibility is decided from requirements, never from a job title or an API's education checklist.
import { verifiedAttachmentReview } from './reviewed_job_evidence.mjs';
export const ELIGIBILITY_VERSION = 3;
const clean = (value) => String(value || '').normalize('NFKC').replace(/ᄋ/g, 'ㅇ').replace(/\s+/g, ' ').trim();
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const school = /고졸|고등학교|특성화고|마이스터고|직업계고|고교/;
const openEducation = /학력.{0,40}(?:무관|제한\s*없|불문)/;
const beginner = /신입|경력\s*(?:무관|제한\s*없|불문)|경험\s*무관|자격\s*(?:무관|제한\s*없)|졸업\s*예정/;
const degree = /(?:전문학사|학사|석사|박사)\s*(?:학위|이상|소지|취득|졸업|수준)|(?:전문대|대학(?:교)?)\s*졸업(?:자|이상|예정)|대졸\s*(?:이상|수준)|[석박]사/;
const experience = /(?:\d+|[일이삼사오육칠팔구십한두세네])\s*(?:년|개월)\s*(?:이상\s*)?(?:의\s*)?(?:[가-힣·/]+\s*){0,8}(?:경력|경험|근무한|재직)|(?:경력|경험).{0,24}(?:\d+|[일이삼사오육칠팔구십한두세네])\s*(?:년|개월)\s*이상|경력직\s*(?:채용|모집)|경력자\s*(?:에\s*한|만\s*지원)/;
const license = /(?:산업기사|(?<!산업)기사|기능장|기술사|간호사|방사선사|임상병리사|물리치료사|작업치료사|약사|의사|변호사|회계사|정교사|교원)\s*(?:자격(?:증)?|면허(?:증)?)?\s*(?:등\s*)?(?:소지|보유|취득|필수|이상)/;
const unresolved = /(?:첨부|붙임).{0,30}(?:참조|참고|확인)|(?:공고문|모집공고|지원자격).{0,30}(?:참조|참고|확인)|별첨|세부.{0,15}별도|자격.{0,10}원문\s*확인|채용분야별.{0,25}일부\s*예외/;

export function qualificationEvidence(raw = {}) {
  if (raw.qualificationText || raw.qualification) return clean(raw.qualificationText || raw.qualification);
  const briefing = raw.teacherBriefing?.schoolCheckSections?.find((x) => /학년|졸업예정|학력|지원.*자격/.test(x.title))?.text;
  return clean(raw.description || [briefing, raw.detailText].filter(Boolean).join(' '));
}

function mandatoryText(value) {
  // Preference and disqualification sections are not minimum entry requirements.
  return clean(value)
    .replace(/(?:※\s*)?(?:우대사항|우대조건|우대내용|가점사항)\s*[:：]?[\s\S]*?(?=(?:지원자격|응시자격|필수자격|자격요건|필수)\s*[:：]|$)/g, ' ')
    .replace(/[^.。;○ㅇ▪■□]*?(?:우대|가점)[^.。;○ㅇ▪■□]*(?:[.。;]|$)/g, (clause) =>
      /지원자격|응시자격|필수|요건/.test(clause) ? clause : ' ');
}

function restrictions(value) {
  const text = mandatoryText(value);
  const result = [];
  if (degree.test(text)) result.push('대학 학위 요구');
  if (experience.test(text) || /경력\s*\(?\s*\d+\s*년\s*이상|(?:실무|현장|정비|수행|관련).{0,30}경력\s*(?:보유|소지|필수)|(?:정비|업무|분야|실무)\s*유경험자/.test(text)) result.push('실무 경력 요구');
  if (license.test(text)) result.push('학생 취득이 어려운 자격·면허 요구');
  else if (/사회복지사\s*[12]급\s*자격증?\s*(?:소지|보유)/.test(text)) result.push('학생 취득이 어려운 자격·면허 요구');
  else if (/자격증.{0,24}(?:소지|보유)자.{0,300}(?:기사|기술사|기능장)/.test(text)) result.push('학생 취득이 어려운 자격·면허 요구');
  return result;
}

export function assessStudentEligibility(raw = {}) {
  const reviewed = verifiedAttachmentReview(raw);
  if (reviewed) return {
    version: ELIGIBILITY_VERSION, status: 'eligible', completeEvidence: true,
    reasons: ['공식 첨부문서 지문·직렬별 자격 대조 완료'], explicitHighSchool: true,
    educationChecklist: false, eligibleRoles: reviewed.roles, eligibleEvidence: reviewed.qualification,
    roleEvidence: reviewed.roles.map((role) => ({ role, status: 'eligible', reasons: [], text: reviewed.qualification })),
    evidence: reviewed.qualification, evidenceUrl: reviewed.url
  };
  if (raw.reviewedAttachment) return {
    version: ELIGIBILITY_VERSION, status: 'review', completeEvidence: false,
    reasons: ['검토된 첨부문서 변경 또는 근거 누락'], explicitHighSchool: false,
    eligibleRoles: [], eligibleEvidence: '', roleEvidence: [], evidence: '', evidenceUrl: ''
  };
  const title = clean(raw.baseTitle || raw.title);
  const education = clean(raw.education);
  const career = clean(raw.career);
  const evidence = qualificationEvidence(raw);
  const mandatory = mandatoryText(evidence);
  const roles = [...new Set(clean(raw.recruitField || raw.jobField || raw.workField || raw.position)
    .split(/[,/·ㆍ;|]/).map(clean).filter((s) => s.length >= 2 && s.length <= 60))];
  const educationChecklist = /대졸|학사|석사|박사|전문대/.test(education) && school.test(education);
  const explicitSchool = school.test(title) || school.test(mandatory)
    || (school.test(education) && !educationChecklist);
  const educationAllowed = explicitSchool || (!educationChecklist && openEducation.test(education)) || openEducation.test(mandatory);
  const entryAllowed = beginner.test(title + ' ' + mandatory) || /신입|경력\s*무관/.test(career);
  const barriers = restrictions(evidence);
  if (/^경력(?:직)?$/.test(career)) barriers.push('경력직 전용');
  if (!educationChecklist && /대졸|전문대|학사|석사|박사/.test(education) && !openEducation.test(education)) barriers.push('학력 조건 제한');

  // Keep same-name jobs (e.g. A08 and B10) separate. A safe role must have its own evidence.
  const boundaries = [];
  for (const pattern of [
    /(?:\d+\.\s*)?(공개경쟁채용)\s*[:：]/g,
    /[○□]\s*(\d+급\s*공채)/g,
    /\d+\.\s*([가-힣]+\([가-힣]+\))\s*[:：]/g,
    /\d+\)\s*([가-힣]+(?:\([^)]{1,40}\))?)\s*[:：]/g,
    /\((\d+급(?:보)?\s+[^)]{2,50})\)/g,
    /(?:[가-하]\.\s*)?(\d+급(?:보)?\s*\([^)]{2,50}\))\s*[:：]/g,
    /[○□]\s*((?:\d+급)?[가-힣·]+(?:\([^)]{1,40}\))?)\s*(?=[:：-]|[○□])/g
  ]) {
    for (const match of evidence.matchAll(pattern)) {
      if (!/공통|지원자격|응시자격|기타|성별|병역|연령|학력|전공|자격사항|근무조건/.test(match[1])) boundaries.push({ index: match.index, end: match.index + match[0].length, role: match[1] });
    }
  }
  for (const role of roles) {
    const rolePattern = role.split(/\s+/).map(escape).join('[\\s()]*');
    const pattern = new RegExp(`${rolePattern}\\)?(?=\\s*(?:[:：(（]|\\d+\\s*급|지원자격|응시자격))`, 'g');
    for (const match of evidence.matchAll(pattern)) {
      // A qualification parenthesis such as "학력(사무직 6급보 제외)" is not a new role.
      const before = evidence.slice(0, match.index);
      if (before.lastIndexOf('(') > before.lastIndexOf(')')
        && /^[^)]{0,60}제외\)/.test(evidence.slice(match.index))) continue;
      if (!boundaries.some((b) => match.index >= b.index && match.index < b.end)) boundaries.push({ index: match.index, role });
    }
  }
  boundaries.sort((a, b) => a.index - b.index);
  const shared = boundaries.length ? evidence.slice(0, boundaries[0].index) : evidence;
  const sharedBarriers = restrictions(shared);
  const roleEvidence = boundaries.map((boundary, index) => {
    const text = evidence.slice(boundary.index, boundaries[index + 1]?.index ?? evidence.length).trim();
    const blockedBy = [...sharedBarriers, ...restrictions(text)];
    const local = mandatoryText(text);
    const localAccess = school.test(local) || openEducation.test(local) || /자격\s*(?:무관|제한\s*없)/.test(local)
      || /공개경쟁채용\s*[:：]\s*제한\s*없/.test(local)
      || (educationAllowed && /공통\s*지원자격\s*외\s*별도의\s*응시자격\s*없음/.test(local));
    const localEntry = beginner.test(local);
    const safeShared = !barriers.length && educationAllowed && entryAllowed
      && !/(?:아래|다음).{0,20}(?:하나|해당|자격)|소지자|대상자/.test(local);
    const limitedRole = /보훈|장애|사회형평|자립준비|국가유공자/.test(boundary.role);
    const headcountOnly = /^[:：\s]*\d+\s*명[.\s]*$/.test(text.slice(boundary.role.length + text.indexOf(boundary.role)));
    const eligible = !headcountOnly && !blockedBy.length && !limitedRole && !unresolved.test(shared) && !unresolved.test(local)
      && (localAccess && (localEntry || entryAllowed) || safeShared);
    return { role: boundary.role, status: eligible ? 'eligible' : blockedBy.length ? 'ineligible' : 'review', reasons: blockedBy, text };
  });
  // If any post with the same name is ambiguous, don't label that whole name as eligible.
  const eligibleRoles = [...new Set(roleEvidence.map((x) => x.role))].filter((role) => {
    const entries = roleEvidence.filter((x) => x.role === role);
    return entries.length && entries.every((x) => x.status === 'eligible');
  });
  const individuallyEligible = roleEvidence.filter((x) => x.status === 'eligible');
  const completeEvidence = Boolean((raw.qualificationText || raw.qualification || raw.description)
    && evidence && !/…|\.\.\.$/.test(evidence) && !raw.qualificationEvidenceIncomplete);
  let status = 'review';
  const reasons = [];
  if (barriers.length) {
    status = completeEvidence && individuallyEligible.length && !sharedBarriers.length ? 'eligible' : 'ineligible';
    reasons.push(...barriers);
  } else if (completeEvidence && (individuallyEligible.length || educationAllowed && entryAllowed && !unresolved.test(mandatory))) {
    status = 'eligible';
  } else {
    reasons.push('고졸 신입 지원 자격 근거 확인 필요');
  }
  if (!completeEvidence && status === 'eligible') status = 'review';
  if (roleEvidence.length && !eligibleRoles.length && status === 'eligible') status = 'review';
  if (!completeEvidence) reasons.push('자격 원문 누락 또는 잘림');
  if (status === 'eligible') reasons.push(individuallyEligible.length && barriers.length ? '직렬별 지원 가능 근거 확인' : '고졸·학력무관 및 신입 지원 근거 확인');
  const limitedEligibility = !eligibleRoles.length && /(?:의한|따른|해당하는)\s*장애인|장애인\s*(?:증명서|에\s*해당|으로\s*응시제한)|복지카드.{0,10}소지|취업지원대상자.{0,25}(?:해당|증명서)|자립지원\s*대상자/.test(mandatory);
  return {
    version: ELIGIBILITY_VERSION, status, limitedEligibility, reasons: [...new Set(reasons)],
    explicitHighSchool: status === 'eligible' && (roleEvidence.length
      ? individuallyEligible.some((entry) => school.test(mandatoryText(entry.text))) : explicitSchool),
    educationChecklist, completeEvidence, eligibleRoles,
    eligibleEvidence: roleEvidence.length ? [shared, ...individuallyEligible.filter((entry) => eligibleRoles.includes(entry.role)).map((entry) => entry.text)].join(' ') : evidence,
    roleEvidence, evidence, evidenceUrl: raw.sourceDetailUrl || raw.sourceOfficialUrl || raw.originalUrl || raw.url || ''
  };
}
