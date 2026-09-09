// Reviewed official attachment evidence, scoped to one notice and immutable document bytes.
// A changed/missing attachment must go back to review, never inherit an earlier approval.
export const reviewedNotices = {
  '304432': {
    sha256: '9b3462d7c9ca67d42df65197fc76a9601db6a395a67bd38ae3dec5f857682c35',
    anchors: ['고교', '학교장', '2027'],
    roles: ['고교 경영금융', '고교 정보통신'],
    qualification: '고졸 신입 고교 경영금융 및 고교 정보통신 전형. 2026.9.16. 기준 특성화고·마이스터고·일반고(종합고)에 재학 중이며 2027.2월까지 졸업 가능한 자. 학교장 추천 필수(채용단위별 학교당 3명 이하, 초과 시 해당 학교 지원자 전원 불합격). HIFIVE 등록 학교 기준. 입사지원 시 학교장 직인이 있는 추천서 제출. 학력·연령·성별·전공 제한 없음이나 접수마감일 기준 만 60세 초과 지원 불가. 2026년 12월 말 채용확정 후 전일 근무 가능(입사 유예 불가). 채용제한 사유에 해당하지 않고 병역의무 불이행 사실이 없는 자. 복무 중이면 채용확정일 이전 전역 가능해야 함.',
    conditions: ['2027년 2월까지 졸업 가능한 재학생', '학교장 추천: 전형별 학교당 3명 이하', '12월 말 전일 근무·추천서 제출 필수'],
    excluded: ['5급 전형은 이 고졸 판정에 포함하지 않음']
  },
  '304717': {
    sha256: '8da0df7a70adacd5c5da2cbd9a722130ed0167de90861bf7011e78d8ce4cf6f4',
    anchors: ['최종 학력이 고졸 또는 졸업예정', '면접전형 시작일 이전 전역', '최종학기 재학중'],
    roles: ['고졸 사무'],
    qualification: '고졸 사무 신입 전형. 최종 학력이 고졸 또는 졸업예정(최종학기 재학 중)인 자. 전문대·대학 재학생은 지원 가능하지만 졸업예정자는 지원 불가. 입사예정일 근무 가능하고 정년에 도달하지 않은 자. 회사 인사규정 제8조 결격사유에 해당하지 않는 자. 현재 군 복무 중이면 면접전형 시작일 이전 전역 가능해야 함.',
    conditions: ['고졸 또는 고교 최종학기 졸업예정자', '대학 졸업예정자 지원 불가', '입사일 근무 가능·복무 중이면 면접 전 전역'],
    excluded: ['대졸수준·보훈·장애인 공고는 별도 자격 확인']
  },
  '304810': {
    sha256: 'af2326eac8a428593c955c432ab1641f0029f51aa1eb779a9b65c4fefac5636f',
    anchors: ['회계수납/', '고등학교장 추천을 받은 자', '병역기피 사실이 없는 자'],
    roles: ['7급 사무원 회계수납(고졸 학교장추천)'],
    qualification: '고졸 신입 7급 사무원 회계수납 학교장 추천 전형. 최종 학력이 고등학교 졸업자 또는 2027년 2월까지 졸업 완료 예정인 자. HIFIVE에 등록된 학교의 학교장 추천 필수, 학교당 2명까지 추천 가능하며 초과 시 추천 인원 모두 불합격. 호남·제주권 근무. 입사예정일 기준 만 58세 미만, 인사규정 제20조 결격사유에 해당하지 않는 자. 병역대상자로서 병역기피 사실이 없는 자. 현역 군인은 2026.12.28. 이전 전역 가능해야 하고 같은 날 즉시 교육입소 및 근무 가능해야 함.',
    conditions: ['고졸·2027년 2월까지 졸업예정자', '학교장 추천: 학교당 2명 이하', '호남·제주권 근무·12월 28일 교육입소'],
    excluded: ['검사·점검 기술원은 별도 검사원 자격 확인 필요', '석사 이상 기술연구는 학생 추천에서 제외']
  }
};

const compact = (text) => String(text || '').normalize('NFKC').replace(/\s+/g, '');
export function verifiedAttachmentReview(raw) {
  if (raw.source !== 'job-alio-openapi') return null;
  const review = reviewedNotices[String(raw.sourceId)];
  if (!review) return null;
  const document = raw.qualificationAttachments?.find((doc) => doc.sha256 === review.sha256
    && doc.status === 'text-extracted-needs-role-review'
    && /^https:\/\/(?:www\.)?alio\.go\.kr\//.test(doc.url || '')
    && review.anchors.every((anchor) => compact(doc.text).includes(compact(anchor))));
  return document ? { ...review, url: document.url, document: document.entryName || document.title } : null;
}

export function applyReviewedAttachment(raw) {
  const review = verifiedAttachmentReview(raw);
  if (!review) return raw;
  return { ...raw, originalQualification: raw.originalQualification || raw.qualification,
    qualification: review.qualification, qualificationText: review.qualification,
    qualificationEvidenceIncomplete: false, recruitField: review.roles.join(','),
    education: '고졸', career: '신입',
    description: [review.qualification, raw.processText].filter(Boolean).join(' '),
    reviewedAttachment: { sha256: review.sha256, url: review.url, document: review.document },
    studentConditions: review.conditions };
}
