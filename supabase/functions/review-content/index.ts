import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const REVIEW_EMAIL_ENABLED = (Deno.env.get("REVIEW_EMAIL_ENABLED") ?? "false").toLowerCase() === "true";
const REVIEW_ACCESS_ENABLED = (Deno.env.get("REVIEW_ACCESS_ENABLED") ?? "false").toLowerCase() === "true";
const REVIEW_LAUNCH_ENABLED = (Deno.env.get("REVIEW_LAUNCH_ENABLED") ?? "false").toLowerCase() === "true";
const REVIEW_EMAIL_FROM = Deno.env.get("REVIEW_EMAIL_FROM") ?? "유한회사 설탕과소금 <review@gyo6.kr>";
const REVIEW_APP_URL = Deno.env.get("REVIEW_APP_URL") ?? "https://gyo6.kr/review/";
const REVIEW_OPERATIONS_EMAIL = Deno.env.get("REVIEW_OPERATIONS_EMAIL") ?? "admin@gyo6.kr";
const REVIEW_EMAIL_PROVIDER = BREVO_API_KEY ? "brevo" : (RESEND_API_KEY ? "resend" : "");
const ALLOWED_ORIGINS = (Deno.env.get("REVIEW_ALLOWED_ORIGINS") ?? "https://gyo6.kr,http://127.0.0.1:4175,http://localhost:4175")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const MAX_REQUEST_CHARS = 200_000;
const OTP_COOLDOWN_MS = 60_000;
const OTP_WINDOW_MS = 15 * 60_000;
const OTP_DAILY_MS = 24 * 60 * 60_000;
const OTP_WINDOW_LIMIT = 3;
const OTP_DAILY_LIMIT = 10;
const ALLOWED_REVIEW_EVENTS = new Set([
  "workroom_enter", "document_open", "assignment_change", "annotation_created",
  "annotation_deleted", "document_completed", "assignment_submitted",
  "review_report_exported", "copy_blocked", "context_menu_blocked",
  "print_attempt", "window_hidden", "window_visible"
]);

function cors(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin"
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}

function bearer(request: Request) {
  const value = request.headers.get("Authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function cleanText(value: unknown, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeEmail(value: unknown) {
  return cleanText(value, 254).toLowerCase();
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function clientIpHash(request: Request) {
  const forwarded = request.headers.get("CF-Connecting-IP")
    ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    ?? "unknown";
  return (await sha256Hex(`${SUPABASE_SERVICE_ROLE_KEY}:${forwarded}`)).slice(0, 24);
}

function reportValue(value: unknown) {
  return String(value ?? "").replace(/\r?\n/g, " ").trim();
}

function reportFilePart(value: unknown) {
  return reportValue(value).replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "_").slice(0, 80) || "report";
}

function severityLabel(value: unknown) {
  return ({ critical: "필수 수정", major: "중요 보완", minor: "권고" } as Record<string, string>)[String(value)] || "해당 없음";
}

function annotationLabel(item: Record<string, unknown>) {
  if (item.kind === "issue") return reportValue(item.issue_type) || "수정 필요";
  if (item.kind === "memo") return "전문 의견";
  return `${({ yellow: "노랑", green: "초록", pink: "분홍" } as Record<string, string>)[String(item.color)] || "노랑"} 형광펜`;
}

function reviewReadingEstimate(value: unknown) {
  const text = String(value ?? "");
  const characterCount = text.replace(/\s/g, "").length;
  const complexity = /[=<>±×÷∑√^]|\b(?:제\s*\d+\s*조|판례|법률|시행령)\b/i.test(text) ? 1.25 : 1;
  return {
    characterCount,
    estimatedSeconds: Math.max(5, Math.min(180, Math.ceil((characterCount / 10) * complexity)))
  };
}

function reviewSpeedStatus(elapsedSeconds: number | null, estimatedSeconds: number, bulkCount = 1) {
  if (bulkCount >= 3) return "bulk";
  if (elapsedSeconds === null || !Number.isFinite(elapsedSeconds)) return "unknown";
  if (elapsedSeconds <= Math.max(2, estimatedSeconds * 0.18)) return "very_fast";
  if (elapsedSeconds <= Math.max(3, estimatedSeconds * 0.35)) return "fast";
  return "normal";
}

async function fetchAllPages<T>(queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>, pageSize = 1000) {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryPage(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function reviewBlockCountMap(admin: ReturnType<typeof createClient>, documentIds: string[]) {
  const counts = new Map<string, number>();
  if (!documentIds.length) return counts;
  const { data, error } = await admin.rpc("review_block_counts", { p_document_ids: documentIds });
  if (error) throw error;
  for (const row of data ?? []) counts.set(row.document_id, Number(row.block_count ?? 0));
  return counts;
}

async function buildReviewIntegrity(admin: ReturnType<typeof createClient>, userId: string, assignmentId: string) {
  const { data: links, error: linkError } = await admin.from("review_assignment_documents").select("document_id, sort_order").eq("assignment_id", assignmentId).order("sort_order");
  if (linkError) throw linkError;
  const documentIds = (links ?? []).map((item) => item.document_id);
  const { data: documents, error: documentError } = documentIds.length
    ? await admin.from("review_documents").select("id, title, kind").in("id", documentIds)
    : { data: [], error: null };
  if (documentError) throw documentError;
  const blocks = documentIds.length
    ? await fetchAllPages<any>((from, to) => admin.from("review_blocks").select("id, document_id, heading, body, sort_order").in("document_id", documentIds).order("document_id").order("sort_order").range(from, to))
    : [];
  const { data: progressRows, error: progressError } = await admin.from("review_progress").select("document_id, checked_blocks, complete").eq("assignment_id", assignmentId).eq("reviewer_user_id", userId);
  if (progressError) throw progressError;
  const { data: checkRows, error: checkError } = await admin.from("review_block_checks").select("*").eq("assignment_id", assignmentId).eq("reviewer_user_id", userId);
  if (checkError) throw checkError;

  const documentMap = new Map((documents ?? []).map((item) => [item.id, item]));
  const progressMap = new Map((progressRows ?? []).map((item) => [item.document_id, item]));
  const checkMap = new Map((checkRows ?? []).map((item) => [item.block_id, item]));
  const unchecked: any[] = [];
  const suspicious: any[] = [];
  const unknownTiming: any[] = [];
  const perDocument = documentIds.map((documentId) => {
    const document = documentMap.get(documentId) as any;
    const documentBlocks = blocks.filter((block) => block.document_id === documentId);
    const validBlockIds = new Set(documentBlocks.map((block) => String(block.id)));
    const checked = new Set(
      (Array.isArray((progressMap.get(documentId) as any)?.checked_blocks)
        ? (progressMap.get(documentId) as any).checked_blocks
        : [])
        .map((id: unknown) => String(id))
        .filter((id: string) => validBlockIds.has(id))
    );
    let checkedCharacters = 0;
    let uncheckedCharacters = 0;
    documentBlocks.forEach((block) => {
      const estimate = reviewReadingEstimate(block.body);
      const base = { documentId, documentTitle: document?.title ?? "검수 자료", blockId: block.id, heading: block.heading, excerpt: cleanText(block.body, 180), characterCount: estimate.characterCount };
      if (!checked.has(block.id)) {
        uncheckedCharacters += estimate.characterCount;
        unchecked.push(base);
        return;
      }
      checkedCharacters += estimate.characterCount;
      const check = checkMap.get(block.id) as any;
      if (!check) {
        unknownTiming.push({ ...base, reason: "확인 시각 기록 이전에 완료된 항목" });
        return;
      }
      if (["fast", "very_fast", "bulk"].includes(check.speed_status)) {
        suspicious.push({ ...base, elapsedSeconds: check.elapsed_seconds === null ? null : Number(check.elapsed_seconds), estimatedSeconds: Number(check.estimated_seconds || estimate.estimatedSeconds), speedStatus: check.speed_status, bulkCount: Number(check.bulk_count || 1), firstCheckedAt: check.first_checked_at });
      }
    });
    return {
      documentId,
      title: document?.title ?? "검수 자료",
      kind: document?.kind ?? "",
      totalBlockCount: documentBlocks.length,
      checkedBlockCount: checked.size,
      uncheckedBlockCount: Math.max(0, documentBlocks.length - checked.size),
      checkedCharacters,
      uncheckedCharacters,
      uncheckedApproxPages: Number((uncheckedCharacters / 1200).toFixed(1)),
      complete: Boolean((progressMap.get(documentId) as any)?.complete)
    };
  });
  const totalBlockCount = perDocument.reduce((sum, item) => sum + item.totalBlockCount, 0);
  const checkedBlockCount = perDocument.reduce((sum, item) => sum + item.checkedBlockCount, 0);
  const uncheckedCharacters = perDocument.reduce((sum, item) => sum + item.uncheckedCharacters, 0);
  return {
    policyVersion: "review-integrity-2026-08-v1",
    policyNote: "한글·전문 원고를 초당 10자 이하로 읽는 보수적 기준에서 예상시간을 산정하고, 그 35% 이하 또는 3개 이상 일괄 확인만 주의 기록으로 표시합니다. 이는 부정 판정이 아니라 대표 확인을 위한 검수완전성 자료입니다.",
    pageConversionNote: "분량은 공백 제외 1,200자를 A4 1쪽으로 환산한 참고치입니다.",
    totalBlockCount,
    checkedBlockCount,
    uncheckedBlockCount: Math.max(0, totalBlockCount - checkedBlockCount),
    uncheckedCharacterCount: uncheckedCharacters,
    uncheckedApproxPages: Number((uncheckedCharacters / 1200).toFixed(1)),
    suspiciousCount: suspicious.length,
    unknownTimingCount: unknownTiming.length,
    hasAttention: unchecked.length > 0 || suspicious.length > 0 || unknownTiming.length > 0,
    perDocument,
    unchecked,
    suspicious,
    unknownTiming
  };
}

function buildAiSupplement(report: any) {
  const documents = Array.isArray(report?.documents) ? report.documents : [];
  const integrity = report?.integrity ?? {};
  const allFindings = documents.flatMap((document: any) => (Array.isArray(document.findings) ? document.findings : []).map((finding: any) => ({ ...finding, documentId: document.id, documentTitle: document.title })));
  const actionable = allFindings.filter((finding: any) => finding.kind !== "highlight");
  const issues = actionable.filter((finding: any) => finding.kind === "issue");
  const professionalOpinions = actionable.filter((finding: any) => finding.kind === "memo");
  const critical = issues.filter((finding: any) => finding.severity === "critical");
  const major = issues.filter((finding: any) => finding.severity === "major");
  const minor = issues.filter((finding: any) => finding.severity === "minor");
  const incompleteDocuments = documents.filter((document: any) => !document.complete);
  const missingComment = actionable.filter((finding: any) => !cleanText(finding.reviewerComment, 5000));
  const missingQuote = actionable.filter((finding: any) => !cleanText(finding.selectedText, 5000));
  const legalUpdates = issues.filter((finding: any) => String(finding.issueType || "").includes("법령") || String(finding.issueType || "").includes("판례"));
  const priorityItems = [...critical, ...major].slice(0, 12).map((finding: any) => ({
    findingId: finding.id,
    documentId: finding.documentId,
    documentTitle: finding.documentTitle,
    location: finding.location,
    level: finding.severity === "critical" ? "필수 수정" : "중요 보완",
    issueType: finding.issueType || "내용 보완",
    excerpt: cleanText(finding.selectedText, 500),
    recommendation: cleanText(finding.reviewerComment, 2000)
  }));
  const checks = [
    { key: "integrity", label: "검수완전성", status: Number(integrity.uncheckedBlockCount || 0) || Number(integrity.suspiciousCount || 0) ? "attention" : "pass", detail: Number(integrity.uncheckedBlockCount || 0) || Number(integrity.suspiciousCount || 0) ? `미확인 ${Number(integrity.uncheckedBlockCount || 0)}개(약 ${Number(integrity.uncheckedApproxPages || 0)}쪽), 초고속·일괄 확인 주의기록 ${Number(integrity.suspiciousCount || 0)}개가 전문위원 확인 및 대표 보고 대상입니다.` : "미확인 및 초고속·일괄 확인 주의기록이 없습니다." },
    { key: "completion", label: "자료 완료성", status: incompleteDocuments.length ? "attention" : "pass", detail: incompleteDocuments.length ? `미완료 자료 ${incompleteDocuments.length}건이 있어 최종 인계 전 확인이 필요합니다.` : `위촉 자료 ${documents.length}건이 모두 완료로 기록되었습니다.` },
    { key: "traceability", label: "의견 추적성", status: missingQuote.length || missingComment.length ? "attention" : "pass", detail: missingQuote.length || missingComment.length ? `원문 인용 누락 ${missingQuote.length}건, 전문 의견 누락 ${missingComment.length}건을 확인해 주세요.` : "모든 수정·전문 의견이 원문 위치 및 인용문과 연결되어 있습니다." },
    { key: "priority", label: "수정 우선순위", status: critical.length ? "attention" : "pass", detail: critical.length ? `필수 수정 ${critical.length}건을 교재 수정의 최우선 순서로 전달해야 합니다.` : `필수 수정은 없으며 중요 보완 ${major.length}건, 권고 ${minor.length}건입니다.` },
    { key: "currency", label: "최신성 재확인", status: legalUpdates.length ? "attention" : "pass", detail: legalUpdates.length ? `법령·판례 변경 관련 의견 ${legalUpdates.length}건은 반영 시점의 최신 원문을 다시 대조하는 것이 안전합니다.` : "법령·판례 변경으로 분류된 의견은 없습니다." }
  ];
  const attentionCount = checks.filter((item) => item.status === "attention").length;
  return {
    version: "sugar-salt-ai-assist/v1",
    generatedAt: new Date().toISOString(),
    title: "AI 보조검토 의견",
    conclusion: attentionCount
      ? `교재 제작 시스템 인계 전 ${attentionCount}개 점검 항목을 우선 확인하시기 바랍니다. 전문위원 의견은 그대로 보존하고, 필수 수정과 중요 보완 순으로 반영 여부를 기록하는 방식이 적절합니다.`
      : "보고서의 완료성·추적성·우선순위 구조가 인계 가능한 상태입니다. 다만 실제 내용의 학문적 타당성은 전문위원 판단을 기준으로 유지해야 합니다.",
    counts: { actionable: actionable.length, issues: issues.length, professionalOpinions: professionalOpinions.length, critical: critical.length, major: major.length, minor: minor.length, legalUpdates: legalUpdates.length },
    checks,
    priorityItems,
    disclaimer: "본 의견은 검수 기록의 누락·우선순위·추적성을 자동 분석한 보조자료이며, 전문위원의 학문적 판단이나 대표의 최종 승인을 대체하지 않습니다."
  };
}

function buildClaudeHandoff(report: any, managerReview: any) {
  const documents = Array.isArray(report?.documents) ? report.documents : [];
  const ai = managerReview?.ai_supplement && Object.keys(managerReview.ai_supplement).length ? managerReview.ai_supplement : buildAiSupplement(report);
  const safeReviewer = {
    name: report?.reviewer?.name || "전문위원",
    organization: report?.reviewer?.organization || "",
    department: report?.reviewer?.department || "",
    positionTitle: report?.reviewer?.positionTitle || "",
    roleLabel: report?.reviewer?.roleLabel || "외부 전문위원"
  };
  const payload = {
    schema: "sugar-salt-textbook-handoff/v2",
    sourceReportId: report?.reportId,
    approvedAt: managerReview?.approved_at,
    company: report?.company,
    assignment: report?.assignment,
    reviewer: safeReviewer,
    reviewIntegrity: report?.integrity ?? {},
    representativeReview: { notes: managerReview?.manager_notes || "", status: managerReview?.status || "approved" },
    aiSupplement: ai,
    documents: documents.map((document: any) => ({
      id: document.id,
      title: document.title,
      version: document.version,
      complete: document.complete,
      overallMemo: document.overallMemo || "",
      findings: (document.findings || []).filter((finding: any) => finding.kind !== "highlight").map((finding: any) => ({
        id: finding.id,
        blockId: finding.blockId,
        location: finding.location,
        classification: finding.kind === "issue" ? "수정 필요" : "전문 의견",
        issueType: finding.issueType || null,
        severity: severityLabel(finding.severity),
        originalExcerpt: finding.selectedText || "",
        expertOpinion: finding.reviewerComment || ""
      }))
    }))
  };
  const lines = [
    `# ${reportValue(report?.assignment?.program)} · ${reportValue(report?.assignment?.subject)} 교재 수정 인계서`,
    "",
    `- 원본 검수보고서: ${reportValue(report?.reportId)}`,
    `- 대표 승인일: ${reportValue(managerReview?.approved_at)}`,
    `- 전문위원: ${reportValue(safeReviewer.name)} · ${reportValue(safeReviewer.organization)} ${reportValue(safeReviewer.positionTitle)}`,
    "",
    "## 대표 확인 의견",
    "",
    reportValue(managerReview?.manager_notes) || "별도 의견 없음",
    "",
    "## AI 보조검토",
    "",
    reportValue(ai.conclusion),
    "",
    ...((ai.checks || []).map((item: any) => `- ${reportValue(item.label)}: ${reportValue(item.detail)}`)),
    "",
    "## 검수완전성 원기록",
    "",
    `- 확인 문단: ${Number(report?.integrity?.checkedBlockCount || 0)}/${Number(report?.integrity?.totalBlockCount || 0)}개`,
    `- 미확인 문단: ${Number(report?.integrity?.uncheckedBlockCount || 0)}개 · 약 ${Number(report?.integrity?.uncheckedApproxPages || 0)}쪽`,
    `- 초고속·일괄 확인 주의기록: ${Number(report?.integrity?.suspiciousCount || 0)}개`,
    `- 판정 기준: ${reportValue(report?.integrity?.policyNote)}`,
    "",
    "## 전문위원 검수결과 및 수정 지시",
    ""
  ];
  documents.forEach((document: any, documentIndex: number) => {
    const findings = (document.findings || []).filter((finding: any) => finding.kind !== "highlight");
    lines.push(`### ${documentIndex + 1}. ${reportValue(document.title)}`, "", `- 자료 전체 의견: ${reportValue(document.overallMemo) || "별도 의견 없음"}`, "");
    if (!findings.length) lines.push("- 별도 수정·전문 의견 없음", "");
    findings.forEach((finding: any, findingIndex: number) => lines.push(
      `#### ${documentIndex + 1}-${findingIndex + 1}. ${finding.kind === "issue" ? severityLabel(finding.severity) : "전문 의견"} · ${reportValue(finding.location)}`,
      "",
      `- 의견 ID: ${reportValue(finding.id)}`,
      `- 원문: ${reportValue(finding.selectedText)}`,
      `- 전문위원 의견: ${reportValue(finding.reviewerComment)}`,
      `- 처리 기록: [ ] 반영  [ ] 보완 반영  [ ] 반려(사유 필수)`,
      ""
    ));
  });
  lines.push("## 처리 원칙", "", "1. 전문위원의 원문 의견은 수정하거나 축약하지 않습니다.", "2. 필수 수정은 반영 또는 반려 사유가 기록되어야 합니다.", "3. 수정 전후의 의견 ID·문서 ID·원문 위치 연결을 유지합니다.", "4. AI 보조검토는 누락·우선순위 점검용이며 전문위원 판단을 대체하지 않습니다.", "");
  return { json: payload, markdown: lines.join("\n") };
}

function emailHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character);
}

function buildAssignmentStartEmail(expertName: unknown, subjectName: unknown, assignment: Record<string, unknown>, documents: Array<Record<string, unknown>>) {
  const safeExpertName = emailHtml(expertName);
  const safeSubjectName = emailHtml(subjectName || "담당 과목");
  const documentRows = documents.map((item, index) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e7e1d7;color:#9a6727;font-weight:700;vertical-align:top;width:32px">${String(index + 1).padStart(2, "0")}</td><td style="padding:10px 0;border-bottom:1px solid #e7e1d7;color:#1d3552"><strong>${emailHtml(item.title)}</strong><span style="display:block;color:#718094;font-size:12px;margin-top:2px">${emailHtml(item.version || "버전 확인")}</span></td></tr>`).join("");
  const detailRow = (label: string, value: unknown) => `<tr><td style="padding:7px 12px 7px 0;color:#738092;font-size:13px;width:110px;vertical-align:top">${label}</td><td style="padding:7px 0;color:#172f4d;font-size:14px;font-weight:700">${emailHtml(value)}</td></tr>`;
  return `<!doctype html><html lang="ko"><body style="margin:0;padding:0;background:#f3f1ed;color:#27384a;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f1ed"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fff;border:1px solid #ded8cd;border-top:5px solid #173654"><tr><td style="padding:30px 34px 24px;border-bottom:1px solid #e7e1d7"><p style="margin:0 0 8px;color:#b2762e;font-size:11px;font-weight:800;letter-spacing:2px">SUGAR &amp; SALT · EXPERT REVIEW</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td><h1 style="margin:0;color:#173654;font-family:Georgia,'Noto Serif KR',serif;font-size:26px;line-height:1.35">전문위원 검수 개시 안내</h1><p style="margin:8px 0 0;color:#738092;font-size:13px">국가직 7급 공무원시험 대비 핵심요약노트·모의고사</p></td><td align="right" style="color:#b2762e;font-size:12px;font-weight:700;white-space:nowrap">공직시험 연구소</td></tr></table></td></tr><tr><td style="padding:30px 34px"><p style="margin:0 0 20px;color:#172f4d;font-size:17px;line-height:1.8"><strong>${safeExpertName} 전문위원님께</strong></p><p style="margin:0 0 24px;font-size:14px;line-height:1.9">귀한 학문적 전문성으로 함께해 주심에 깊이 감사드립니다.<br><strong style="color:#173654">${safeSubjectName}</strong> 담당 검수 원고와 전용 워크룸이 준비되어 아래와 같이 안내드립니다.</p><div style="border:1px solid #ddd6ca;background:#fbfaf8;padding:17px 20px;margin-bottom:24px"><p style="margin:0 0 10px;color:#b2762e;font-size:12px;font-weight:800;letter-spacing:1px">APPOINTMENT &amp; SCHEDULE</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${detailRow("위촉 과제", assignment.title)}${detailRow("검수 개시", String(assignment.starts_at || "").slice(0, 10))}${detailRow("1차 중간보고", String(assignment.interim_due_at || "협의일").slice(0, 10))}${detailRow("최종 완료", String(assignment.ends_at || "").slice(0, 10))}</table></div><p style="margin:0 0 8px;color:#173654;font-size:15px;font-weight:800">담당 검수 자료</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:26px">${documentRows}</table><p style="margin:0 0 12px;color:#173654;font-size:15px;font-weight:800">워크룸 이용 절차</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px"><tr><td style="padding:12px 14px;background:#f5f7f8;border-left:3px solid #b2762e;font-size:13px;line-height:1.85"><strong>01</strong> 계약서에 기재하신 이메일로 인증번호를 받아 입장합니다.<br><strong>02</strong> 위촉된 담당 과목과 최신 원고 버전을 확인합니다.<br><strong>03</strong> 문장을 선택하여 형광펜·전문 의견·수정 필요 도구로 검토합니다.<br><strong>04</strong> 저장한 의견은 자동 보관되며 최종 제출 전까지 수정·보완할 수 있습니다.<br><strong>05</strong> 자료별 검토 완료 후 지정일에 중간보고와 최종 검수의견을 제출합니다.</td></tr></table><p style="margin:0 0 22px;padding:13px 15px;background:#fff8ed;border:1px solid #ead7b9;color:#62513a;font-size:12px;line-height:1.8">원고와 전문위원님의 의견을 함께 보호하기 위해 파일 다운로드 대신 식별 워터마크가 적용된 보호 열람으로 제공됩니다. 안정적인 검수를 위해 PC 또는 태블릿 사용을 권장드립니다.</p><p style="margin:0 0 26px;text-align:center"><a href="${emailHtml(REVIEW_APP_URL)}" style="display:inline-block;padding:13px 26px;background:#173654;color:#fff;text-decoration:none;border-radius:4px;font-size:14px;font-weight:800">전문위원 검수 워크룸 입장</a></p><p style="margin:0;font-size:13px;line-height:1.85">일정이나 자료에 관하여 협의가 필요하시면 언제든 말씀해 주십시오.<br>전문위원님의 고견이 충실히 반영될 수 있도록 정중히 지원하겠습니다.</p></td></tr><tr><td style="padding:22px 34px;background:#173654;color:#dce4ec;font-size:12px;line-height:1.75"><strong style="display:block;color:#fff;font-size:14px;margin-bottom:3px">유한회사 설탕과소금</strong>공직시험 연구소 · 대표 김영희<br><a href="mailto:admin@gyo6.kr" style="color:#e1b46e;text-decoration:none">admin@gyo6.kr</a> · 010-3534-7163 · <a href="https://gyo6.kr" style="color:#e1b46e;text-decoration:none">gyo6.kr</a></td></tr></table></td></tr></table></body></html>`;
}

function examTrackFromTitle(title: unknown) {
  return String(title ?? "").includes("[지방직 7급]") ? "local" : "national";
}

function examTrackLabel(track: unknown) {
  return track === "local" ? "지방직 7급" : "국가직 7급";
}

function safeEventPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 12)) {
    const safeKey = cleanText(key, 60);
    if (!safeKey) continue;
    if (typeof item === "string") safe[safeKey] = cleanText(item, 500);
    else if (typeof item === "number" && Number.isFinite(item)) safe[safeKey] = item;
    else if (typeof item === "boolean" || item === null) safe[safeKey] = item;
  }
  return safe;
}

async function sendOperationalEmail(to: string, subject: string, html: string, idempotencyKey: string) {
  if (!REVIEW_EMAIL_ENABLED) return { sent: false, status: "paused", id: null, provider: null };
  if (!REVIEW_EMAIL_PROVIDER) return { sent: false, status: "not_configured", id: null, provider: null };
  const fromMatch = REVIEW_EMAIL_FROM.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const senderName = fromMatch?.[1]?.trim() || "유한회사 설탕과소금";
  const senderEmail = fromMatch?.[2]?.trim() || REVIEW_EMAIL_FROM.trim();
  const response = REVIEW_EMAIL_PROVIDER === "brevo"
    ? await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email: to }],
          replyTo: { name: "유한회사 설탕과소금 공직시험 연구소", email: REVIEW_OPERATIONS_EMAIL },
          subject,
          htmlContent: html,
          headers: { "Idempotency-Key": idempotencyKey.slice(0, 128) },
          tags: ["expert-review-operations"]
        })
      })
    : await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.slice(0, 256) },
        body: JSON.stringify({ from: REVIEW_EMAIL_FROM, to: [to], subject, html, reply_to: REVIEW_OPERATIONS_EMAIL })
      });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("안내 이메일 발송 서비스가 요청을 처리하지 못했습니다.");
  return { sent: true, status: "sent", id: result.messageId ?? result.id ?? null, provider: REVIEW_EMAIL_PROVIDER };
}

function buildOtpEmailHtml(code: string) {
  const safeCode = emailHtml(code);
  return `<!doctype html><html lang="ko"><body style="margin:0;padding:0;background:#f3f1ed;color:#27384a;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f1ed"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #ded8cd;border-top:5px solid #173654"><tr><td style="padding:30px 34px 22px;border-bottom:1px solid #e7e1d7"><p style="margin:0 0 8px;color:#b2762e;font-size:11px;font-weight:800;letter-spacing:2px">SUGAR &amp; SALT · SECURE REVIEW</p><h1 style="margin:0;color:#173654;font-family:Georgia,'Noto Serif KR',serif;font-size:26px;line-height:1.35">전문위원 검수 워크룸<br>인증번호 안내</h1></td></tr><tr><td style="padding:30px 34px"><p style="margin:0 0 18px;font-size:14px;line-height:1.9">전문위원 검수 워크룸에서 요청하신 인증번호입니다.</p><div style="margin:0 0 22px;padding:22px;text-align:center;background:#f5f7f8;border:1px solid #d9e0e4"><span style="display:block;margin-bottom:8px;color:#738092;font-size:12px">인증번호</span><strong style="color:#173654;font-family:Georgia,serif;font-size:34px;letter-spacing:8px">${safeCode}</strong></div><p style="margin:0 0 18px;color:#5f6d78;font-size:12px;line-height:1.8">워크룸 화면에 위 번호를 입력해 주십시오. 본인이 요청하지 않으셨다면 이 메일을 무시하셔도 됩니다. 인증번호를 다른 사람에게 전달하지 마십시오.</p><p style="margin:0;font-size:12px;line-height:1.8">이용 문의: <a href="mailto:${emailHtml(REVIEW_OPERATIONS_EMAIL)}" style="color:#173654">${emailHtml(REVIEW_OPERATIONS_EMAIL)}</a></p></td></tr><tr><td style="padding:20px 34px;background:#173654;color:#dce4ec;font-size:12px;line-height:1.75"><strong style="display:block;color:#fff;font-size:14px">유한회사 설탕과소금</strong>공직시험 연구소 · 전문위원 검수 운영</td></tr></table></td></tr></table></body></html>`;
}

async function recordAuthEvent(admin: ReturnType<typeof createClient>, userId: string, eventType: string, payload: Record<string, unknown>) {
  const { error } = await admin.from("review_events").insert({
    reviewer_user_id: userId,
    event_type: eventType,
    payload: safeEventPayload(payload),
    occurred_at: new Date().toISOString()
  });
  if (error) console.error("review auth audit insert failed", eventType, error.message);
}

async function requestReviewOtp(admin: ReturnType<typeof createClient>, request: Request, emailValue: unknown) {
  const startedAt = Date.now();
  const email = normalizeEmail(emailValue);
  const generic = { accepted: true, message: "등록된 이메일이면 인증번호 안내가 발송됩니다." };
  if (!email || !email.includes("@")) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return generic;
  }

  const { data: profile } = await admin
    .from("review_profiles")
    .select("user_id, email, role, active")
    .eq("email", email)
    .maybeSingle();
  if (!profile?.active || !["reviewer", "manager", "admin"].includes(profile.role)) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 350 - (Date.now() - startedAt))));
    return generic;
  }

  const userId = profile.user_id;
  if (profile.role === "reviewer") {
    const { data: activeAssignment } = await admin
      .from("review_assignments")
      .select("id")
      .eq("reviewer_user_id", userId)
      .in("status", ["assigned", "reviewing", "submitted", "returned", "accepted"])
      .not("started_at", "is", null)
      .limit(1)
      .maybeSingle();
    if (!activeAssignment) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 350 - (Date.now() - startedAt))));
      return generic;
    }
  }
  const now = Date.now();
  const fifteenMinutesAgo = new Date(now - OTP_WINDOW_MS).toISOString();
  const oneDayAgo = new Date(now - OTP_DAILY_MS).toISOString();
  const { data: recentRows, error: recentError } = await admin
    .from("review_events")
    .select("event_type, occurred_at")
    .eq("reviewer_user_id", userId)
    .in("event_type", ["auth_otp_requested", "auth_otp_sent"])
    .gte("occurred_at", oneDayAgo)
    .order("occurred_at", { ascending: false });
  if (recentError) throw recentError;
  const requestedRows = (recentRows ?? []).filter((item) => item.event_type === "auth_otp_requested");
  const latestRequestAt = requestedRows[0]?.occurred_at ? new Date(requestedRows[0].occurred_at).getTime() : 0;
  const windowCount = requestedRows.filter((item) => item.occurred_at >= fifteenMinutesAgo).length;
  if ((latestRequestAt && now - latestRequestAt < OTP_COOLDOWN_MS) || windowCount >= OTP_WINDOW_LIMIT || requestedRows.length >= OTP_DAILY_LIMIT) {
    await recordAuthEvent(admin, userId, "auth_otp_rate_limited", {
      reason: latestRequestAt && now - latestRequestAt < OTP_COOLDOWN_MS ? "cooldown" : windowCount >= OTP_WINDOW_LIMIT ? "window" : "daily",
      ipHash: await clientIpHash(request)
    });
    return generic;
  }

  const ipHash = await clientIpHash(request);
  await recordAuthEvent(admin, userId, "auth_otp_requested", { ipHash, channel: "email", provider: REVIEW_EMAIL_PROVIDER || "unconfigured" });
  if (!REVIEW_EMAIL_ENABLED || !REVIEW_EMAIL_PROVIDER) {
    await recordAuthEvent(admin, userId, "auth_otp_failed", { ipHash, phase: "provider_configuration" });
    throw new Error("인증메일 발송 서비스가 준비되지 않았습니다. 운영담당자에게 연락해 주세요.");
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email,
    options: { redirectTo: REVIEW_APP_URL }
  });
  const otp = cleanText(linkData?.properties?.email_otp, 12);
  if (linkError || !otp) {
    await recordAuthEvent(admin, userId, "auth_otp_failed", { ipHash, phase: "otp_generation", message: cleanText(linkError?.message, 160) });
    throw new Error("인증번호 생성이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.");
  }

  try {
    const delivery = await sendOperationalEmail(
      profile.email,
      "[유한회사 설탕과소금] 전문위원 검수 워크룸 인증번호",
      buildOtpEmailHtml(otp),
      `review-auth-${userId}-${now}`
    );
    await recordAuthEvent(admin, userId, "auth_otp_sent", { ipHash, channel: "email", provider: delivery.provider, providerMessageId: delivery.id, status: delivery.status });
  } catch (error) {
    await recordAuthEvent(admin, userId, "auth_otp_failed", { ipHash, phase: "email_delivery", message: cleanText(error instanceof Error ? error.message : "인증메일 발송 실패", 160) });
    throw error;
  }
  return generic;
}

function buildSupplementalGuideText(expertName: unknown, subjectName: unknown) {
  const name = cleanText(expertName, 80) || "전문위원";
  const subject = cleanText(subjectName, 80) || "담당 과목";
  return `${name} 전문위원님께

안녕하십니까. 유한회사 설탕과소금 공직시험 연구소입니다.
${subject} 검수를 위한 워크룸 이용 방법을 아래와 같이 보충 안내드립니다.

1. 워크룸 입장
   https://gyo6.kr/review/
   계약서에 기재하신 이메일을 입력하시면 인증번호가 전문위원님의 해당 이메일로 직접 발송됩니다. 대표가 별도로 인증번호를 전달하지 않습니다.

2. 담당 자료 확인
   로그인 후 ${subject} 담당 자료만 표시됩니다. 좌측 목록에서 자료를 선택하여 최신 버전과 검수 범위를 확인해 주십시오.

3. 문장별 검수 기록
   검토할 문장을 선택하면 형광펜·전문 의견·수정 필요 도구가 바로 표시됩니다. 기록한 의견은 우측 ‘전문 검수의견’에 자동 저장되며 최종 제출 전까지 수정하거나 삭제할 수 있습니다.

4. 확인 및 큰 화면 이용
   내용 확인 후 문단 또는 표의 ‘확인’ 버튼을 눌러 주십시오. 화면 상단의 큰 화면 검수를 이용하면 원고 중심으로 넓게 볼 수 있으며, 같은 버튼으로 기본 화면으로 돌아올 수 있습니다.

5. 중간보고와 최종 제출
   1차 중간보고와 최종 검수의견은 워크룸의 해당 버튼에서 미리보기로 확인한 뒤 제출해 주십시오. 미확인 문단과 빠른 확인 주의기록이 있으면 제출 전에 안내됩니다.

6. 이용 중 도움이 필요한 경우
   admin@gyo6.kr / 010-3534-7163으로 연락 주시면 확인 후 정중히 지원하겠습니다.

귀한 학문적 전문성으로 함께해 주심에 다시 한번 감사드립니다.

유한회사 설탕과소금
공직시험 연구소 · 대표 김영희
https://gyo6.kr`;
}

function buildSupplementalGuideEmail(expertName: unknown, subjectName: unknown) {
  const safeExpertName = emailHtml(expertName || "전문위원");
  const safeSubjectName = emailHtml(subjectName || "담당 과목");
  const steps = [
    ["워크룸 입장", `계약서에 기재하신 이메일로 인증번호를 직접 받아 입장합니다. 대표가 인증번호를 별도로 전달하지 않습니다.`],
    ["담당 자료 확인", `${safeSubjectName} 담당 자료만 표시되며 좌측 목록에서 최신 원고와 검수 범위를 확인합니다.`],
    ["문장별 의견 기록", `문장을 선택하면 형광펜·전문 의견·수정 필요 도구가 표시됩니다. 기록은 자동 저장되며 최종 제출 전까지 수정·삭제할 수 있습니다.`],
    ["확인·큰 화면 이용", `문단 또는 표의 확인 버튼으로 검토 범위를 기록하고, 큰 화면 검수 버튼으로 원고 중심 화면과 기본 화면을 전환합니다.`],
    ["보고서 확인·제출", `중간보고와 최종 검수의견은 미리보기에서 확인한 뒤 제출합니다. 미확인 문단과 확인 속도 주의기록도 제출 전에 안내됩니다.`]
  ].map(([title, body], index) => `<tr><td style="padding:13px 0;border-bottom:1px solid #e8e3da;color:#b2762e;font-weight:800;vertical-align:top;width:36px">${String(index + 1).padStart(2, "0")}</td><td style="padding:13px 0;border-bottom:1px solid #e8e3da"><strong style="display:block;color:#173654;font-size:14px;margin-bottom:4px">${title}</strong><span style="color:#536476;font-size:13px;line-height:1.75">${body}</span></td></tr>`).join("");
  return `<!doctype html><html lang="ko"><body style="margin:0;background:#f3f1ed;color:#27384a;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fff;border:1px solid #ded8cd;border-top:5px solid #173654"><tr><td style="padding:30px 34px 24px;border-bottom:1px solid #e7e1d7"><p style="margin:0 0 8px;color:#b2762e;font-size:11px;font-weight:800;letter-spacing:2px">SUGAR &amp; SALT · REVIEW SUPPORT</p><h1 style="margin:0;color:#173654;font-family:Georgia,'Noto Serif KR',serif;font-size:26px;line-height:1.35">전문위원 검수 워크룸<br>이용 보충 안내</h1></td></tr><tr><td style="padding:30px 34px"><p style="margin:0 0 18px;color:#172f4d;font-size:17px;line-height:1.8"><strong>${safeExpertName} 전문위원님께</strong></p><p style="margin:0 0 24px;font-size:14px;line-height:1.9">${safeSubjectName} 검수에 함께해 주심에 깊이 감사드립니다.<br>워크룸을 편안하게 이용하실 수 있도록 핵심 절차를 정리하여 안내드립니다.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px">${steps}</table><p style="margin:0 0 24px;text-align:center"><a href="${emailHtml(REVIEW_APP_URL)}" style="display:inline-block;padding:13px 26px;background:#173654;color:#fff;text-decoration:none;border-radius:4px;font-size:14px;font-weight:800">전문위원 검수 워크룸 입장</a></p><p style="margin:0;padding:14px 16px;background:#fbf6ed;border-left:3px solid #b2762e;color:#665845;font-size:12px;line-height:1.8">이용 중 도움이 필요하시면 admin@gyo6.kr 또는 010-3534-7163으로 연락해 주십시오. 전문위원님의 고견이 온전히 기록될 수 있도록 정중히 지원하겠습니다.</p></td></tr><tr><td style="padding:22px 34px;background:#173654;color:#dce4ec;font-size:12px;line-height:1.75"><strong style="display:block;color:#fff;font-size:14px;margin-bottom:3px">유한회사 설탕과소금</strong>공직시험 연구소 · 대표 김영희<br><a href="mailto:admin@gyo6.kr" style="color:#e1b46e;text-decoration:none">admin@gyo6.kr</a> · <a href="https://gyo6.kr" style="color:#e1b46e;text-decoration:none">gyo6.kr</a></td></tr></table></td></tr></table></body></html>`;
}

async function runtimeControls(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin.from("review_runtime_controls").select("access_enabled, launch_enabled, updated_by, updated_at").eq("id", "default").maybeSingle();
  if (error) throw new Error("검수 운영 잠금 상태를 확인하지 못했습니다.");
  return data ? {
    accessEnabled: Boolean(data.access_enabled),
    launchEnabled: Boolean(data.launch_enabled),
    updatedBy: data.updated_by ?? null,
    updatedAt: data.updated_at ?? null,
    source: "manager"
  } : {
    accessEnabled: REVIEW_ACCESS_ENABLED,
    launchEnabled: REVIEW_LAUNCH_ENABLED,
    updatedBy: null,
    updatedAt: null,
    source: "environment"
  };
}

async function assignmentFor(admin: ReturnType<typeof createClient>, userId: string, assignmentId: string, requireWritable = false) {
  const controls = await runtimeControls(admin);
  if (!controls.accessEnabled) throw new Error("전문위원 검수 접근은 대표님의 최종 시작 승인 전까지 안전하게 잠겨 있습니다.");
  const { data: profile } = await admin.from("review_profiles").select("active").eq("user_id", userId).single();
  if (!profile?.active) throw new Error("현재 이 검수계정의 이용이 종료되었습니다. 확인이 필요하시면 담당자에게 말씀해 주세요.");
  const { data, error } = await admin
    .from("review_assignments")
    .select("*")
    .eq("id", assignmentId)
    .eq("reviewer_user_id", userId)
    .single();
  if (error || !data) throw new Error("전문위원님께 위촉된 검수 과제가 아닙니다.");
  const now = Date.now();
  if (data.status === "prepared" || !data.started_at) throw new Error("계약과 최신 원고의 최종 확인이 진행 중입니다. 대표님의 일괄 시작 후 이용하실 수 있습니다.");
  if (data.status === "revoked") throw new Error("현재 이 검수과제의 이용이 종료되었습니다. 확인이 필요하시면 담당자에게 말씀해 주세요.");
  if (now < new Date(data.starts_at).getTime() || now > new Date(data.ends_at).getTime()) throw new Error("계약서에 정한 검수 가능 기간을 확인해 주세요. 일정 협의가 필요하시면 담당자에게 말씀해 주세요.");
  if (requireWritable && ["submitted", "accepted", "revoked"].includes(data.status)) throw new Error("최종 제출되었거나 종료된 검수 과제입니다. 추가 보완이 필요하시면 담당자에게 말씀해 주세요.");
  return data;
}

async function assertDocumentAccess(admin: ReturnType<typeof createClient>, assignmentId: string, documentId: string) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("review_assignment_documents")
    .select("assignment_id, document_id, sort_order, visible_from, visible_until")
    .eq("assignment_id", assignmentId)
    .eq("document_id", documentId)
    .single();
  if (error || !data) throw new Error("전문위원님께 위촉된 과제의 검수 자료가 아닙니다.");
  if (data.visible_from && data.visible_from > now) throw new Error("이 자료는 준비가 끝나는 즉시 제공해 드리겠습니다.");
  if (data.visible_until && data.visible_until < now) throw new Error("이 자료의 열람 기간이 종료되었습니다. 추가 확인이 필요하시면 담당자에게 말씀해 주세요.");
  return data;
}

async function markAssignmentReviewing(admin: ReturnType<typeof createClient>, userId: string, assignmentId: string) {
  const { error } = await admin
    .from("review_assignments")
    .update({ status: "reviewing" })
    .eq("id", assignmentId)
    .eq("reviewer_user_id", userId)
    .in("status", ["assigned", "returned"]);
  if (error) throw error;
}

async function bootstrap(admin: ReturnType<typeof createClient>, userId: string, previewAssignmentId = "") {
  const managerPreview = Boolean(previewAssignmentId);
  let reviewerUserId = userId;
  if (managerPreview) {
    await ensureManager(admin, userId);
    const { data: previewAssignment, error: previewError } = await admin
      .from("review_assignments")
      .select("id, reviewer_user_id, status")
      .eq("id", previewAssignmentId)
      .single();
    if (previewError || !previewAssignment) throw new Error("관리자 확인이 가능한 위촉 과제를 찾지 못했습니다.");
    reviewerUserId = previewAssignment.reviewer_user_id;
  } else if (!(await runtimeControls(admin)).accessEnabled) {
    throw new Error("전문위원 검수 접근은 대표님의 최종 시작 승인 전까지 안전하게 잠겨 있습니다.");
  }
  const { data: reviewer, error: reviewerError } = await admin
    .from("review_profiles")
    .select("user_id, email, display_name, mobile, organization, department, position_title, role, role_label, active")
    .eq("user_id", reviewerUserId)
    .single();
  if (reviewerError || !reviewer || (!managerPreview && !reviewer.active)) throw new Error("현재 이용 가능한 전문위원 계정을 확인하지 못했습니다. 담당자에게 말씀해 주세요.");

  let assignmentQuery = admin
    .from("review_assignments")
    .select("*")
    .eq("reviewer_user_id", reviewerUserId);
  assignmentQuery = managerPreview
    ? assignmentQuery.eq("id", previewAssignmentId)
    : assignmentQuery.in("status", ["assigned", "reviewing", "submitted", "returned"]);
  const { data: assignmentRows, error: assignmentError } = await assignmentQuery.order("starts_at", { ascending: true });
  if (assignmentError) throw assignmentError;

  const subjectIds = [...new Set((assignmentRows ?? []).map((row) => row.subject_id))];
  const assignmentIds = (assignmentRows ?? []).map((row) => row.id);
  const [subjectResult, linksResult, progressResult, interimResult, exportResult] = await Promise.all([
    subjectIds.length
      ? admin.from("review_subjects").select("id, program_id, code, name").in("id", subjectIds)
      : Promise.resolve({ data: [] }),
    assignmentIds.length
      ? admin.from("review_assignment_documents").select("assignment_id, document_id, sort_order").in("assignment_id", assignmentIds).order("sort_order")
      : Promise.resolve({ data: [] }),
    assignmentIds.length
      ? admin.from("review_progress").select("*").eq("reviewer_user_id", reviewerUserId).in("assignment_id", assignmentIds)
      : Promise.resolve({ data: [] }),
    assignmentIds.length
      ? admin.from("review_interim_reports").select("assignment_id, submitted_at").eq("reviewer_user_id", reviewerUserId).in("assignment_id", assignmentIds)
      : Promise.resolve({ data: [] }),
    assignmentIds.length
      ? admin.from("review_exports").select("id, assignment_id, report_id, file_name, sha256, delivery_status, created_at, delivered_at").eq("reviewer_user_id", reviewerUserId).in("assignment_id", assignmentIds)
      : Promise.resolve({ data: [] })
  ]);
  const subjectRows = subjectResult.data ?? [];
  const links = linksResult.data ?? [];
  const progressRows = progressResult.data ?? [];
  const interimRows = interimResult.data ?? [];
  const exportRows = exportResult.data ?? [];
  const programIds = [...new Set(subjectRows.map((row) => row.program_id))];
  const documentIds = [...new Set((links ?? []).map((row) => row.document_id))];
  const [programResult, documentResult] = await Promise.all([
    programIds.length
      ? admin.from("review_programs").select("id, name").in("id", programIds)
      : Promise.resolve({ data: [] }),
    documentIds.length
      ? admin.from("review_documents").select("id, kind, title, version, review_stage").in("id", documentIds)
      : Promise.resolve({ data: [] })
  ]);
  const programRows = programResult.data ?? [];
  const documents = documentResult.data ?? [];

  const subjects = new Map((subjectRows ?? []).map((row) => [row.id, row]));
  const programs = new Map((programRows ?? []).map((row) => [row.id, row]));
  const documentMap = new Map((documents ?? []).map((row) => [row.id, row]));
  const interimMap = new Map((interimRows ?? []).map((row) => [row.assignment_id, row.submitted_at]));
  const exportMap = new Map((exportRows ?? []).map((row) => [row.assignment_id, row]));
  const assignments = (assignmentRows ?? []).map((assignment) => {
    const subject = subjects.get(assignment.subject_id);
    return {
      id: assignment.id,
      program: programs.get(subject?.program_id) ?? { id: "unknown", name: "검수" },
      subject: { id: subject?.id, name: subject?.name ?? "과목" },
      title: assignment.title,
      contractReference: assignment.contract_reference,
      period: `${assignment.starts_at.slice(0, 10)} — ${assignment.ends_at.slice(0, 10)}`,
      interimDueAt: assignment.interim_due_at?.slice(0, 10) ?? null,
      interimSubmittedAt: interimMap.get(assignment.id) ?? null,
      status: assignment.status,
      watermarkCode: assignment.watermark_code,
      report: exportMap.has(assignment.id) ? {
        id: exportMap.get(assignment.id).id,
        reportId: exportMap.get(assignment.id).report_id,
        fileName: exportMap.get(assignment.id).file_name,
        sha256: exportMap.get(assignment.id).sha256,
        deliveryStatus: exportMap.get(assignment.id).delivery_status,
        createdAt: exportMap.get(assignment.id).created_at,
        deliveredAt: exportMap.get(assignment.id).delivered_at
      } : null,
      documents: (links ?? [])
        .filter((link) => link.assignment_id === assignment.id)
        .map((link) => documentMap.get(link.document_id))
        .filter(Boolean)
        .map((document) => ({
          id: document.id,
          kind: document.kind,
          title: document.title,
          version: document.version,
          stage: document.review_stage
        }))
    };
  });
  const progress: Record<string, Record<string, unknown>> = {};
  for (const item of progressRows ?? []) {
    progress[item.assignment_id] ??= {};
    progress[item.assignment_id][item.document_id] = {
      checkedBlocks: item.checked_blocks ?? [],
      memo: item.memo ?? "",
      complete: item.complete,
      completedAt: item.completed_at
    };
  }
  return {
    reviewer: { id: reviewer.user_id, name: reviewer.display_name, email: reviewer.email, mobile: reviewer.mobile, organization: reviewer.organization, department: reviewer.department, positionTitle: reviewer.position_title, role: reviewer.role, roleLabel: reviewer.role_label },
    assignments,
    progress,
    managerPreview
  };
}

async function createReviewReport(admin: ReturnType<typeof createClient>, userId: string, assignmentId: string, reportKind: "draft" | "interim" | "final" = "draft", managerOverride = false) {
  let assignment;
  if (managerOverride) {
    const { data, error } = await admin.from("review_assignments").select("*").eq("id", assignmentId).eq("reviewer_user_id", userId).single();
    if (error || !data) throw new Error("관리자 확인이 가능한 위촉 과제를 찾지 못했습니다.");
    assignment = data;
  } else {
    assignment = await assignmentFor(admin, userId, assignmentId);
  }
  if (reportKind === "final" && ["submitted", "accepted"].includes(assignment.status)) {
    const { data: existingExport, error: existingExportError } = await admin
      .from("review_exports")
      .select("report_id, file_name, markdown, json_payload, sha256, delivery_status")
      .eq("assignment_id", assignmentId)
      .eq("reviewer_user_id", userId)
      .in("delivery_status", ["ready", "delivered"])
      .maybeSingle();
    if (existingExportError) throw existingExportError;
    if (existingExport) {
      return {
        reportId: existingExport.report_id,
        fileName: existingExport.file_name,
        markdown: existingExport.markdown,
        json: existingExport.json_payload,
        sha256: existingExport.sha256,
        status: "final",
        deliveryStatus: existingExport.delivery_status
      };
    }
  }
  const { data: reviewer, error: reviewerError } = await admin
    .from("review_profiles")
    .select("user_id, email, display_name, mobile, organization, department, position_title, role_label")
    .eq("user_id", userId)
    .single();
  if (reviewerError || !reviewer) throw new Error("전문위원님의 기본 정보를 확인하지 못했습니다.");
  const { data: subject, error: subjectError } = await admin.from("review_subjects").select("id, program_id, name").eq("id", assignment.subject_id).single();
  if (subjectError || !subject) throw new Error("검수 과목을 확인하지 못했습니다.");
  const { data: program, error: programError } = await admin.from("review_programs").select("id, name").eq("id", subject.program_id).single();
  if (programError || !program) throw new Error("검수 사업을 확인하지 못했습니다.");
  const { data: links, error: linkError } = await admin.from("review_assignment_documents").select("document_id, sort_order").eq("assignment_id", assignmentId).order("sort_order");
  if (linkError) throw linkError;
  const documentIds = (links ?? []).map((item) => item.document_id);
  const { data: documents, error: documentError } = documentIds.length
    ? await admin.from("review_documents").select("id, kind, title, version, review_stage").in("id", documentIds)
    : { data: [], error: null };
  if (documentError) throw documentError;
  const blocks = documentIds.length
    ? await fetchAllPages<any>((from, to) => admin.from("review_blocks").select("id, document_id, heading, body, sort_order").in("document_id", documentIds).order("document_id").order("sort_order").range(from, to))
    : [];
  const { data: annotations, error: annotationError } = await admin.from("review_annotations").select("*").eq("assignment_id", assignmentId).eq("reviewer_user_id", userId).order("created_at");
  if (annotationError) throw annotationError;
  const { data: progressRows, error: progressError } = await admin.from("review_progress").select("*").eq("assignment_id", assignmentId).eq("reviewer_user_id", userId);
  if (progressError) throw progressError;

  const integrity = await buildReviewIntegrity(admin, userId, assignmentId);
  const generatedAt = new Date().toISOString();
  const reportPrefix = reportKind === "interim" ? "INTERIM" : "REVIEW";
  const reportId = `${reportPrefix}-${assignmentId.slice(0, 8).toUpperCase()}-${generatedAt.replace(/\D/g, "").slice(0, 14)}`;
  const documentMap = new Map((documents ?? []).map((item) => [item.id, item]));
  const blockMap = new Map(blocks.map((item) => [item.id, item]));
  const progressMap = new Map((progressRows ?? []).map((item) => [item.document_id, item]));
  const orderedDocuments = (links ?? []).map((link) => documentMap.get(link.document_id)).filter(Boolean);
  const detailDocuments = orderedDocuments.map((document: any) => {
    const progress = progressMap.get(document.id) as any;
    return {
      id: document.id,
      kind: document.kind,
      title: document.title,
      version: document.version,
      stage: document.review_stage,
      complete: Boolean(progress?.complete),
      completedAt: progress?.completed_at ?? null,
      totalBlockCount: blocks.filter((block) => block.document_id === document.id).length,
      checkedBlockCount: new Set(Array.isArray(progress?.checked_blocks) ? progress.checked_blocks : []).size,
      overallMemo: progress?.memo ?? "",
      findings: (annotations ?? []).filter((item) => item.document_id === document.id).map((item) => ({
        id: item.id,
        blockId: item.block_id,
        location: (blockMap.get(item.block_id) as any)?.heading ?? item.block_id,
        kind: item.kind,
        color: item.color,
        issueType: item.issue_type,
        severity: item.severity,
        startOffset: item.start_offset,
        endOffset: item.end_offset,
        selectedText: item.selected_text,
        reviewerComment: item.body,
        status: item.status,
        createdAt: item.created_at,
        updatedAt: item.updated_at
      }))
    };
  });
  const findings = detailDocuments.flatMap((document: any) => document.findings).filter((item: any) => item.kind !== "highlight");
  const payload = {
    schema: "sugar-salt-expert-review/v2",
    reportId,
    status: reportKind === "interim" ? "interim" : reportKind === "final" || ["submitted", "accepted"].includes(assignment.status) ? "final" : "draft",
    generatedAt,
    company: { name: "유한회사 설탕과소금", unit: program.id === "civil" ? "공직시험 연구소" : "교원임용 연구" },
    reviewer: { id: reviewer.user_id, name: reviewer.display_name, email: reviewer.email, mobile: reviewer.mobile, organization: reviewer.organization, department: reviewer.department, positionTitle: reviewer.position_title, roleLabel: reviewer.role_label },
    assignment: { id: assignment.id, program: program.name, subject: subject.name, title: assignment.title, contractReference: assignment.contract_reference, period: `${assignment.starts_at.slice(0, 10)} — ${assignment.ends_at.slice(0, 10)}`, status: assignment.status },
    summary: {
      documentCount: detailDocuments.length,
      completedDocumentCount: detailDocuments.filter((item: any) => item.complete).length,
      totalBlockCount: detailDocuments.reduce((sum: number, item: any) => sum + item.totalBlockCount, 0),
      checkedBlockCount: detailDocuments.reduce((sum: number, item: any) => sum + item.checkedBlockCount, 0),
      findingCount: findings.length,
      referenceMarkCount: (annotations ?? []).filter((item) => item.kind === "highlight").length,
      criticalCount: findings.filter((item: any) => item.kind === "issue" && item.severity === "critical").length,
      majorCount: findings.filter((item: any) => item.kind === "issue" && item.severity === "major").length,
      minorCount: findings.filter((item: any) => item.kind === "issue" && item.severity === "minor").length,
      professionalOpinionCount: findings.filter((item: any) => item.kind === "memo").length
    },
    documents: detailDocuments,
    integrity
  };
  const lines = [
    "---",
    "schema: sugar-salt-expert-review/v2",
    `report_id: ${JSON.stringify(reportId)}`,
    `status: ${payload.status}`,
    `generated_at: ${JSON.stringify(generatedAt)}`,
    `assignment_id: ${JSON.stringify(assignment.id)}`,
    `program: ${JSON.stringify(program.name)}`,
    `subject: ${JSON.stringify(subject.name)}`,
    `reviewer_name: ${JSON.stringify(reviewer.display_name)}`,
    `reviewer_email: ${JSON.stringify(reviewer.email)}`,
    `reviewer_mobile: ${JSON.stringify(reviewer.mobile ?? "")}`,
    `reviewer_organization: ${JSON.stringify(reviewer.organization ?? "")}`,
    `reviewer_department: ${JSON.stringify(reviewer.department ?? "")}`,
    `reviewer_position: ${JSON.stringify(reviewer.position_title ?? "")}`,
    `document_count: ${payload.summary.documentCount}`,
    `completed_document_count: ${payload.summary.completedDocumentCount}`,
    `finding_count: ${payload.summary.findingCount}`,
    "---",
    "",
    "# 핵심요약노트·모의고사 표준 검수의견 보고서",
    "",
    `- 발행기관: 유한회사 설탕과소금 · ${payload.company.unit}`,
    `- 보고서 번호: ${reportId}`,
    `- 위촉 검수과제: ${reportValue(assignment.title)}`,
    `- 검수분야: ${reportValue(program.name)} / ${reportValue(subject.name)}`,
    `- 용역 기준: ${reportValue(assignment.contract_reference) || "외부 전문위원 검수용역"}`,
    `- 검수기간: ${payload.assignment.period}`,
    `- 작성상태: ${payload.status === "final" ? "최종 제출" : payload.status === "interim" ? "1차 중간보고" : "작성 중 초안"}`,
    "",
    "## 1. 전문위원 기본 정보",
    "",
    "| 구분 | 내용 |",
    "|---|---|",
    `| 성명 | ${reportValue(reviewer.display_name)} |`,
    `| 역할 | ${reportValue(reviewer.role_label)} |`,
    `| 소속·부서 | ${reportValue(reviewer.organization)} ${reportValue(reviewer.department)} |`,
    `| 직위 | ${reportValue(reviewer.position_title)} |`,
    `| 이메일 | ${reportValue(reviewer.email)} |`,
    `| 휴대전화 | ${reportValue(reviewer.mobile)} |`,
    "",
    "## 2. 검수 목적·범위·기준",
    "",
    "- 목적: 위촉 범위의 핵심요약노트·모의고사 원고에 대하여 사실관계, 최신 법령·판례·정책자료, 정답 및 해설의 타당성을 확인합니다.",
    `- 범위: ${reportValue(subject.name)} 담당 원고 ${payload.summary.documentCount}건`,
    "- 기준: 원문 위치와 인용문을 보존하여 의견을 기록하고, 필수 수정·중요 보완·권고를 구분합니다.",
    "",
    "## 3. 검수 결과 요약",
    "",
    `- 자료 ${payload.summary.documentCount}건 중 ${payload.summary.completedDocumentCount}건 검수 확인`,
    `- 수정·보완 의견 ${payload.summary.findingCount}건, 참고 표시 ${payload.summary.referenceMarkCount}건`,
    `- 확인 기록 ${integrity.checkedBlockCount}/${integrity.totalBlockCount}개, 미확인 ${integrity.uncheckedBlockCount}개(약 ${integrity.uncheckedApproxPages}쪽), 초고속·일괄 확인 주의기록 ${integrity.suspiciousCount}개`,
    ""
  ];
  detailDocuments.forEach((document: any, documentIndex: number) => {
    lines.push(
      `## ${documentIndex + 4}. ${reportValue(document.kind)} — ${reportValue(document.title)}`,
      "",
      `- 문서 ID: ${document.id}`,
      `- 버전·단계: ${reportValue(document.version)} / ${reportValue(document.stage)}`,
      `- 검수 확인: ${document.complete ? `완료 (${reportValue(document.completedAt || generatedAt)})` : "미완료"}`,
      `- 자료 전체 의견: ${reportValue(document.overallMemo) || "별도 의견 없음"}`,
      ""
    );
    if (!document.findings.length) {
      lines.push("이 자료에 등록된 세부 의견이 없습니다.", "");
      return;
    }
    document.findings.forEach((item: any, index: number) => lines.push(
      `### ${documentIndex + 1}-${index + 1}. ${annotationLabel({ kind: item.kind, issue_type: item.issueType, color: item.color })}`,
      "",
      `- 의견 ID: ${item.id}`,
      `- 위치: ${reportValue(item.location)} (문자 ${item.startOffset}–${item.endOffset})`,
      `- 분류: ${reportValue(item.kind)}${item.issueType ? ` / ${reportValue(item.issueType)}` : ""}`,
      `- 중요도: ${severityLabel(item.severity)}`,
      `- 원문 인용: “${reportValue(item.selectedText)}”`,
      `- 전문 검수의견·수정 제안: ${reportValue(item.reviewerComment) || "참고 표시"}`,
      ""
    ));
  });
  lines.push(
    "## 검수완전성 확인 기록",
    "",
    `- 확인 문단: ${integrity.checkedBlockCount}/${integrity.totalBlockCount}개`,
    `- 미확인 문단: ${integrity.uncheckedBlockCount}개 · 공백 제외 ${integrity.uncheckedCharacterCount}자 · 약 ${integrity.uncheckedApproxPages}쪽`,
    `- 초고속·일괄 확인 주의기록: ${integrity.suspiciousCount}개`,
    `- 시간 판정 불가 기존 기록: ${integrity.unknownTimingCount}개`,
    `- 판정 기준: ${integrity.policyNote}`,
    ""
  );
  if (integrity.unchecked.length) {
    lines.push("### 미확인 위치", "");
    integrity.unchecked.forEach((item: any, index: number) => lines.push(`${index + 1}. ${reportValue(item.documentTitle)} / ${reportValue(item.heading)} · ${item.characterCount}자 · “${reportValue(item.excerpt)}”`));
    lines.push("");
  }
  if (integrity.suspicious.length) {
    lines.push("### 확인 속도 주의 위치", "");
    integrity.suspicious.forEach((item: any, index: number) => lines.push(`${index + 1}. ${reportValue(item.documentTitle)} / ${reportValue(item.heading)} · 실제 ${item.elapsedSeconds ?? "기록 없음"}초 / 보수적 예상 ${item.estimatedSeconds}초 · ${item.speedStatus === "bulk" ? `${item.bulkCount}개 일괄 확인` : item.speedStatus === "very_fast" ? "매우 빠른 확인" : "빠른 확인"}`));
    lines.push("");
  }
  lines.push(
    "## 전문위원 최종 확인",
    "",
    "본 보고서는 위 검수 범위에서 실제로 확인하고 기록한 의견을 원문 위치와 함께 정리한 것입니다. 최종 제출 전 미리보기에서 내용과 누락 여부를 확인합니다.",
    "",
    "## 교재 생성 시스템 인계 규칙",
    "",
    "1. `필수 수정` 의견은 반영 또는 반려 사유 기록 없이는 다음 제작 단계로 이동하지 않습니다.",
    "2. `중요 보완` 의견은 반영 여부와 처리 근거를 기록합니다.",
    "3. 의견 ID·문서 ID·원문 인용을 유지하여 수정 전후 이력을 연결합니다.",
    "4. 전문위원 기본 정보는 검수 결과의 작성자 확인 및 계약에 따라 제출된 공개 프로필 연계에 사용합니다.",
    ""
  );
  const markdown = lines.join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(markdown));
  const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const fileName = `${reportFilePart(program.name)}_${reportFilePart(subject.name)}_${reportFilePart(reviewer.display_name)}_${payload.status === "interim" ? "1차중간보고" : "검수보고서"}.md`;
  if (payload.status === "interim") {
    const { error: interimError } = await admin.from("review_interim_reports").upsert({ assignment_id: assignmentId, reviewer_user_id: userId, schema_version: payload.schema, report_id: reportId, file_name: fileName, markdown, json_payload: payload, sha256, submitted_at: generatedAt }, { onConflict: "assignment_id,reviewer_user_id" });
    if (interimError) throw interimError;
    await admin.from("review_change_history").insert({ assignment_id: assignmentId, reviewer_user_id: userId, changed_by: userId, change_type: "report_generated", target_id: reportId, after_payload: { reportId, reportKind: "interim", sha256 } });
  }
  if (payload.status === "final") {
    const { error: exportError } = await admin.from("review_exports").upsert({ assignment_id: assignmentId, reviewer_user_id: userId, schema_version: payload.schema, report_id: reportId, file_name: fileName, markdown, json_payload: payload, sha256, delivery_status: "ready", created_at: generatedAt, delivered_at: null }, { onConflict: "assignment_id,reviewer_user_id" });
    if (exportError) throw exportError;
    await admin.from("review_change_history").insert({ assignment_id: assignmentId, reviewer_user_id: userId, changed_by: userId, change_type: "report_submitted", target_id: reportId, after_payload: { reportId, reportKind: "final", sha256, deliveryStatus: "ready" } });
  }
  return { reportId, fileName, markdown, json: payload, sha256, status: payload.status, deliveryStatus: payload.status === "final" ? "ready" : payload.status === "interim" ? "submitted" : "draft" };
}

async function ensureManager(admin: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await admin.from("review_profiles").select("user_id, display_name, role, active").eq("user_id", userId).single();
  if (error || !data?.active || !["manager", "admin"].includes(data.role)) throw new Error("회사 운영담당자 권한이 필요합니다.");
  return data;
}

async function managerDashboard(admin: ReturnType<typeof createClient>, userId: string) {
  await ensureManager(admin, userId);
  const controls = await runtimeControls(admin);
  const { data: assignmentRows, error: assignmentError } = await admin.from("review_assignments").select("*").order("ends_at");
  if (assignmentError) throw assignmentError;
  const assignments = assignmentRows ?? [];
  const assignmentIds = assignments.map((item) => item.id);
  const reviewerIds = [...new Set(assignments.map((item) => item.reviewer_user_id))];
  const subjectIds = [...new Set(assignments.map((item) => item.subject_id))];
  const { data: reviewers } = reviewerIds.length ? await admin.from("review_profiles").select("user_id, email, display_name, mobile, organization, department, position_title, role_label").in("user_id", reviewerIds) : { data: [] };
  const { data: subjects } = subjectIds.length ? await admin.from("review_subjects").select("id, program_id, name").in("id", subjectIds) : { data: [] };
  const programIds = [...new Set((subjects ?? []).map((item) => item.program_id))];
  const { data: programs } = programIds.length ? await admin.from("review_programs").select("id, name").in("id", programIds) : { data: [] };
  const { data: links } = assignmentIds.length ? await admin.from("review_assignment_documents").select("assignment_id, document_id, sort_order").in("assignment_id", assignmentIds).order("sort_order") : { data: [] };
  const documentIds = [...new Set((links ?? []).map((item) => item.document_id))];
  const { data: documents } = documentIds.length ? await admin.from("review_documents").select("id, title, kind, version").in("id", documentIds) : { data: [] };
  const blockCounts = await reviewBlockCountMap(admin, documentIds);
  const { data: progressRows } = assignmentIds.length ? await admin.from("review_progress").select("assignment_id, document_id, checked_blocks, memo, complete, completed_at, updated_at").in("assignment_id", assignmentIds) : { data: [] };
  const { data: annotationRows } = assignmentIds.length ? await admin.from("review_annotations").select("assignment_id, id").in("assignment_id", assignmentIds) : { data: [] };
  const { data: eventRows } = assignmentIds.length ? await admin.from("review_events").select("assignment_id, document_id, reviewer_user_id, event_type, occurred_at, payload").in("assignment_id", assignmentIds).order("occurred_at", { ascending: false }) : { data: [] };
  const authAuditSince = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
  const { data: authEventRows } = reviewerIds.length ? await admin.from("review_events").select("reviewer_user_id, event_type, occurred_at, payload").in("reviewer_user_id", reviewerIds).in("event_type", ["auth_otp_requested", "auth_otp_sent", "auth_otp_failed", "auth_otp_rate_limited", "auth_login_succeeded"]).gte("occurred_at", authAuditSince).order("occurred_at", { ascending: false }) : { data: [] };
  const { data: exportRows } = assignmentIds.length ? await admin.from("review_exports").select("id, assignment_id, report_id, file_name, sha256, delivery_status, created_at, delivered_at").in("assignment_id", assignmentIds) : { data: [] };
  const exportIds = (exportRows ?? []).map((item) => item.id);
  const { data: managerReviewRows } = exportIds.length ? await admin.from("review_manager_reviews").select("export_id, status, reviewed_at, approved_at, updated_at").in("export_id", exportIds) : { data: [] };
  const { data: interimRows } = assignmentIds.length ? await admin.from("review_interim_reports").select("id, assignment_id, report_id, file_name, sha256, submitted_at").in("assignment_id", assignmentIds) : { data: [] };
  const reviewerMap = new Map((reviewers ?? []).map((item) => [item.user_id, item]));
  const subjectMap = new Map((subjects ?? []).map((item) => [item.id, item]));
  const programMap = new Map((programs ?? []).map((item) => [item.id, item]));
  const documentMap = new Map((documents ?? []).map((item) => [item.id, item]));
  const progressMap = new Map((progressRows ?? []).map((item) => [`${item.assignment_id}:${item.document_id}`, item]));
  const exportMap = new Map((exportRows ?? []).map((item) => [item.assignment_id, item]));
  const managerReviewMap = new Map((managerReviewRows ?? []).map((item) => [item.export_id, item]));
  const interimMap = new Map((interimRows ?? []).map((item) => [item.assignment_id, item]));
  const now = Date.now();
  const dashboardAssignments = assignments.map((assignment) => {
      const reviewer = reviewerMap.get(assignment.reviewer_user_id) as any;
      const subject = subjectMap.get(assignment.subject_id) as any;
      const program = programMap.get(subject?.program_id) as any;
      const assignmentLinks = (links ?? []).filter((item) => item.assignment_id === assignment.id);
      const detailDocuments = assignmentLinks.map((link) => {
        const document = documentMap.get(link.document_id) as any;
        const progress = progressMap.get(`${assignment.id}:${link.document_id}`) as any;
        const totalBlocks = blockCounts.get(link.document_id) ?? 0;
        const checkedBlocks = new Set(Array.isArray(progress?.checked_blocks) ? progress.checked_blocks : []).size;
        return { id: link.document_id, title: document?.title ?? "검수 자료", kind: document?.kind ?? "", version: document?.version ?? "", totalBlocks, checkedBlocks: Math.min(totalBlocks, checkedBlocks), complete: Boolean(progress?.complete), completedAt: progress?.completed_at ?? null };
      });
      const reviewerEvents = (eventRows ?? []).filter((event) => event.assignment_id === assignment.id && event.reviewer_user_id === assignment.reviewer_user_id);
      const eventTimes = (types: string[]) => reviewerEvents.filter((event) => types.includes(event.event_type)).map((event) => event.occurred_at).filter(Boolean).sort();
      const firstEventAt = (types: string[]) => eventTimes(types)[0] ?? null;
      const reviewerAuthEvents = (authEventRows ?? []).filter((event) => event.reviewer_user_id === assignment.reviewer_user_id);
      const firstAuthEventAt = (types: string[]) => reviewerAuthEvents.filter((event) => types.includes(event.event_type)).map((event) => event.occurred_at).filter(Boolean).sort()[0] ?? null;
      const lastAuthEventAt = (types: string[]) => reviewerAuthEvents.filter((event) => types.includes(event.event_type)).map((event) => event.occurred_at).filter(Boolean).sort().at(-1) ?? null;
      const startEvent = (eventRows ?? []).find((event) => event.assignment_id === assignment.id && event.event_type === "assignment_started");
      const startNotificationStatus = (startEvent?.payload as any)?.notificationStatus;
      const notificationSentAt = assignment.notification_sent_at ?? (startNotificationStatus === "sent" ? startEvent?.occurred_at ?? null : null);
      const assignmentProgress = (progressRows ?? []).filter((item) => item.assignment_id === assignment.id);
      const progressActivityTimes = assignmentProgress.filter((item) => (Array.isArray(item.checked_blocks) && item.checked_blocks.length) || item.memo || item.complete).map((item) => item.updated_at).filter(Boolean).sort();
      const reviewerActivityTimes = [...reviewerEvents.map((event) => event.occurred_at), ...progressActivityTimes].filter(Boolean).sort();
      const workroomEnteredAt = firstEventAt(["workroom_enter"]);
      const firstDocumentOpenedAt = firstEventAt(["document_open"]);
      const firstReviewRecordedAt = [...eventTimes(["annotation_created", "document_completed"]), ...progressActivityTimes].sort()[0] ?? null;
      const otpRequestedAt = firstAuthEventAt(["auth_otp_requested"]);
      const otpSentAt = firstAuthEventAt(["auth_otp_sent"]);
      const otpFailedAt = lastAuthEventAt(["auth_otp_failed"]);
      const loginSucceededAt = firstAuthEventAt(["auth_login_succeeded"]);
      const lastActivityAt = reviewerActivityTimes.at(-1) ?? null;
      let attention: string | null = null;
      if (detailDocuments.some((item) => item.totalBlocks === 0)) attention = "원고 문단 연결 확인 필요";
      else if (new Date(assignment.ends_at).getTime() < now && !["submitted", "accepted"].includes(assignment.status)) attention = "검수 기한 확인 필요";
      else if (otpFailedAt && (!otpSentAt || new Date(otpFailedAt).getTime() > new Date(otpSentAt).getTime())) attention = "최근 인증메일 발송 실패 확인 필요";
      else if (assignment.status === "reviewing" && (!lastActivityAt || now - new Date(lastActivityAt).getTime() > 72 * 60 * 60 * 1000)) attention = "최근 3일간 검수 기록 없음";
      else if (["submitted", "accepted"].includes(assignment.status) && !exportMap.has(assignment.id)) attention = "최종 제출 후 보고서 생성 확인 필요";
      return {
        id: assignment.id,
        reviewer: { id: reviewer?.user_id, name: reviewer?.display_name ?? "전문위원", email: reviewer?.email ?? "", mobile: reviewer?.mobile ?? "", organization: reviewer?.organization ?? "", department: reviewer?.department ?? "", positionTitle: reviewer?.position_title ?? "", roleLabel: reviewer?.role_label ?? "외부 전문위원" },
        program: program?.name ?? "검수 사업",
        subject: subject?.name ?? "담당 과목",
        title: assignment.title,
        subjectId: assignment.subject_id,
        programId: subject?.program_id ?? null,
        contractReference: assignment.contract_reference,
        examTrack: assignment.exam_track ?? "national",
        contractCompletedAt: assignment.contract_completed_at,
        startedAt: assignment.started_at,
        notificationSentAt,
        notificationStatus: notificationSentAt ? "sent" : startNotificationStatus ?? (assignment.started_at ? "unknown" : "not_started"),
        workroomEnteredAt,
        firstDocumentOpenedAt,
        firstReviewRecordedAt,
        otpRequestedAt,
        otpSentAt,
        otpFailedAt,
        loginSucceededAt,
        period: `${assignment.starts_at.slice(0, 10)} — ${assignment.ends_at.slice(0, 10)}`,
        interimDueAt: assignment.interim_due_at?.slice(0, 10) ?? null,
        status: assignment.status,
        documentCount: detailDocuments.length,
        completeDocumentCount: detailDocuments.filter((item) => item.complete).length,
        totalBlocks: detailDocuments.reduce((sum, item) => sum + item.totalBlocks, 0),
        checkedBlocks: detailDocuments.reduce((sum, item) => sum + item.checkedBlocks, 0),
        opinionCount: (annotationRows ?? []).filter((item) => item.assignment_id === assignment.id).length,
        lastActivityAt,
        attention,
        report: exportMap.get(assignment.id) ? { id: (exportMap.get(assignment.id) as any).id, reportId: (exportMap.get(assignment.id) as any).report_id, fileName: (exportMap.get(assignment.id) as any).file_name, sha256: (exportMap.get(assignment.id) as any).sha256, deliveryStatus: (exportMap.get(assignment.id) as any).delivery_status, createdAt: (exportMap.get(assignment.id) as any).created_at, deliveredAt: (exportMap.get(assignment.id) as any).delivered_at, managerReviewStatus: (managerReviewMap.get((exportMap.get(assignment.id) as any).id) as any)?.status ?? "pending", managerReviewedAt: (managerReviewMap.get((exportMap.get(assignment.id) as any).id) as any)?.reviewed_at ?? null, managerApprovedAt: (managerReviewMap.get((exportMap.get(assignment.id) as any).id) as any)?.approved_at ?? null } : null,
        interimReport: interimMap.get(assignment.id) ? { id: (interimMap.get(assignment.id) as any).id, reportId: (interimMap.get(assignment.id) as any).report_id, fileName: (interimMap.get(assignment.id) as any).file_name, sha256: (interimMap.get(assignment.id) as any).sha256, submittedAt: (interimMap.get(assignment.id) as any).submitted_at } : null,
        documents: detailDocuments
      };
    });
  const { data: expertCatalog } = await admin.from("review_profiles").select("user_id, email, display_name, mobile, organization, department, position_title, role_label, active").eq("role", "reviewer").order("display_name");
  const { data: subjectCatalog } = await admin.from("review_subjects").select("id, program_id, name, sort_order").order("sort_order");
  const { data: programCatalog } = await admin.from("review_programs").select("id, name, sort_order").order("sort_order");
  const { data: documentCatalog } = await admin.from("review_documents").select("id, subject_id, title, kind, version, status, source_sha256").in("status", ["review_ready", "reviewing", "approved"]).order("title");
  return {
    launchReadiness: {
      enabled: Boolean(controls.launchEnabled && controls.accessEnabled && REVIEW_EMAIL_ENABLED && REVIEW_EMAIL_PROVIDER),
      launchEnabled: controls.launchEnabled,
      accessEnabled: controls.accessEnabled,
      emailEnabled: REVIEW_EMAIL_ENABLED,
      emailConfigured: Boolean(REVIEW_EMAIL_PROVIDER),
      emailProvider: REVIEW_EMAIL_PROVIDER || null,
      updatedAt: controls.updatedAt,
      updatedBy: controls.updatedBy,
      controlSource: controls.source
    },
    assignments: dashboardAssignments,
    experts: (expertCatalog ?? []).map((item) => ({ id: item.user_id, email: item.email, name: item.display_name, mobile: item.mobile, organization: item.organization, department: item.department, positionTitle: item.position_title, roleLabel: item.role_label, active: item.active })),
    programs: (programCatalog ?? []).map((item) => ({ id: item.id, name: item.name })),
    subjects: (subjectCatalog ?? []).map((item) => ({ id: item.id, programId: item.program_id, name: item.name })),
    documents: (documentCatalog ?? []).map((item) => ({ id: item.id, subjectId: item.subject_id, title: item.title, kind: item.kind, version: item.version, status: item.status, sourceSha256: item.source_sha256, examTrack: examTrackFromTitle(item.title) }))
  };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "허용되지 않은 접속 위치입니다." }, 403, origin);

  try {
    const requestText = await request.text();
    if (requestText.length > MAX_REQUEST_CHARS) return json({ error: "요청 내용이 허용 범위를 초과했습니다." }, 413, origin);
    let requestBody: Record<string, unknown>;
    try {
      requestBody = JSON.parse(requestText);
    } catch {
      return json({ error: "요청 형식을 확인해 주세요." }, 400, origin);
    }
    const action = cleanText(requestBody.action, 80);
    const payload = requestBody.payload && typeof requestBody.payload === "object" && !Array.isArray(requestBody.payload)
      ? requestBody.payload as Record<string, any>
      : {};
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    if (action === "requestOtp") {
      if (!origin || !ALLOWED_ORIGINS.includes(origin)) return json({ error: "허용되지 않은 접속 위치입니다." }, 403, origin);
      try {
        return json(await requestReviewOtp(admin, request, payload.email), 202, origin);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "인증번호 요청을 처리하지 못했습니다." }, 503, origin);
      }
    }

    const token = bearer(request);
    if (!token) return json({ error: "로그인이 필요합니다." }, 401, origin);
    const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userResult, error: userError } = await auth.auth.getUser(token);
    if (userError || !userResult.user) return json({ error: "로그인 시간이 만료되었습니다." }, 401, origin);
    const userId = userResult.user.id;

    if (action === "bootstrap") {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000).toISOString();
      const { count } = await admin.from("review_events").select("id", { count: "exact", head: true }).eq("reviewer_user_id", userId).eq("event_type", "auth_login_succeeded").gte("occurred_at", thirtyMinutesAgo);
      if (!count) await recordAuthEvent(admin, userId, "auth_login_succeeded", { channel: "email_otp", ipHash: await clientIpHash(request) });
      return json(await bootstrap(admin, userId), 200, origin);
    }

    if (action === "managerDashboard") return json(await managerDashboard(admin, userId), 200, origin);

    if (action === "managerGetCommunicationAudit") {
      await ensureManager(admin, userId);
      const assignmentId = cleanText(payload.assignmentId, 80);
      if (!assignmentId) throw new Error("확인할 위촉 과제를 선택해 주세요.");
      const { data: assignment, error: assignmentError } = await admin.from("review_assignments").select("*").eq("id", assignmentId).single();
      if (assignmentError || !assignment) throw new Error("위촉 과제를 확인하지 못했습니다.");
      const [{ data: expert }, { data: subject }, { data: links }, { data: events }, { data: archivedRows }] = await Promise.all([
        admin.from("review_profiles").select("email, display_name").eq("user_id", assignment.reviewer_user_id).single(),
        admin.from("review_subjects").select("name").eq("id", assignment.subject_id).single(),
        admin.from("review_assignment_documents").select("document_id, sort_order").eq("assignment_id", assignmentId).order("sort_order"),
        admin.from("review_events").select("event_type, occurred_at, payload").eq("assignment_id", assignmentId).in("event_type", ["notification_dispatched", "assignment_started", "assignment_start_failed"]).order("occurred_at", { ascending: false }),
        admin.from("review_notification_archive").select("subject, html_body, template_version, provider, provider_message_id, delivery_status, sent_at").eq("assignment_id", assignmentId).eq("notification_type", "assignment_start").order("sent_at", { ascending: false }).limit(1)
      ]);
      if (!expert?.email) throw new Error("전문위원 이메일 정보를 확인하지 못했습니다.");
      const documentIds = (links ?? []).map((item) => item.document_id);
      const { data: documents } = documentIds.length ? await admin.from("review_documents").select("id, title, version").in("id", documentIds) : { data: [] };
      const documentMap = new Map((documents ?? []).map((item) => [item.id, item]));
      const orderedDocuments = (links ?? []).map((item) => documentMap.get(item.document_id)).filter(Boolean) as Array<Record<string, unknown>>;
      const archived = (events ?? []).find((event) => event.event_type === "notification_dispatched");
      const exactArchive = archivedRows?.[0] ?? null;
      const started = (events ?? []).find((event) => event.event_type === "assignment_started");
      const failure = (events ?? []).find((event) => event.event_type === "assignment_start_failed");
      const archivedPayload = (archived?.payload ?? {}) as Record<string, unknown>;
      const startedPayload = (started?.payload ?? {}) as Record<string, unknown>;
      const startSubject = cleanText(exactArchive?.subject ?? archivedPayload.subject, 300) || `[유한회사 설탕과소금] ${expert.display_name} 전문위원님 · ${subject?.name ?? "담당 과목"} 검수 개시 안내`;
      const archivedHtml = exactArchive?.html_body ?? "";
      const startHtml = archivedHtml || buildAssignmentStartEmail(expert.display_name, subject?.name, assignment, orderedDocuments);
      const supplementSubject = `[유한회사 설탕과소금] ${expert.display_name} 전문위원님 · ${subject?.name ?? "담당 과목"} 검수 워크룸 이용 보충 안내`;
      return json({
        ok: true,
        assignmentId,
        recipient: { name: expert.display_name, email: expert.email },
        subject: subject?.name ?? "담당 과목",
        delivery: {
          status: assignment.notification_sent_at ? "service_accepted" : failure ? "failed" : "not_recorded",
          sentAt: exactArchive?.sent_at ?? assignment.notification_sent_at ?? archived?.occurred_at ?? null,
          provider: exactArchive?.provider ?? archivedPayload.provider ?? null,
          providerMessageId: exactArchive?.provider_message_id ?? archivedPayload.providerMessageId ?? startedPayload.notificationId ?? null,
          templateVersion: exactArchive?.template_version ?? archivedPayload.templateVersion ?? "assignment-start-v1",
          exactOriginal: Boolean(archivedHtml)
        },
        startNotice: { subject: startSubject, html: startHtml },
        supplementalGuide: {
          subject: supplementSubject,
          html: buildSupplementalGuideEmail(expert.display_name, subject?.name),
          text: buildSupplementalGuideText(expert.display_name, subject?.name)
        }
      }, 200, origin);
    }

    if (action === "managerSetRuntimeControls") {
      await ensureManager(admin, userId);
      const command = cleanText(payload.command, 20);
      const expected = command === "unlock" ? "검수 준비 승인" : command === "lock" ? "긴급 잠금" : "";
      if (!expected || cleanText(payload.confirmation, 30) !== expected) throw new Error("운영 잠금 변경 확인 문구가 일치하지 않습니다.");
      const enabled = command === "unlock";
      const changedAt = new Date().toISOString();
      const { error: controlError } = await admin.from("review_runtime_controls").upsert({ id: "default", access_enabled: enabled, launch_enabled: enabled, updated_by: userId, updated_at: changedAt }, { onConflict: "id" });
      if (controlError) throw new Error("검수 운영 잠금 상태를 변경하지 못했습니다.");
      await admin.from("review_events").insert({ reviewer_user_id: userId, event_type: enabled ? "runtime_controls_unlocked" : "runtime_controls_locked", payload: { accessEnabled: enabled, launchEnabled: enabled, emailEnabled: REVIEW_EMAIL_ENABLED, emailConfigured: Boolean(REVIEW_EMAIL_PROVIDER) }, occurred_at: changedAt });
      return json({ ok: true, accessEnabled: enabled, launchEnabled: enabled, changedAt }, 200, origin);
    }

    if (action === "managerPreviewBootstrap") {
      await ensureManager(admin, userId);
      const assignmentId = cleanText(payload.assignmentId, 80);
      return json(await bootstrap(admin, userId, assignmentId), 200, origin);
    }

    if (action === "managerUpsertExpert") {
      await ensureManager(admin, userId);
      const requestedId = cleanText(payload.id, 80);
      const email = cleanText(payload.email, 320).toLowerCase();
      const displayName = cleanText(payload.name, 100);
      const mobile = cleanText(payload.mobile, 30);
      const organization = cleanText(payload.organization, 200);
      const department = cleanText(payload.department, 200);
      const positionTitle = cleanText(payload.positionTitle, 100);
      if (!email.includes("@") || !displayName || !mobile || !organization || !department || !positionTitle) throw new Error("전문위원님의 필수 정보를 모두 입력해 주세요.");
      let expertUserId = requestedId;
      let invitationSent = false;
      if (!expertUserId) {
        const { data: existingProfile } = await admin.from("review_profiles").select("user_id, role").ilike("email", email).maybeSingle();
        if (existingProfile && existingProfile.role !== "reviewer") throw new Error("관리자·운영담당자 계정은 전문위원 정보 화면에서 변경할 수 없습니다.");
        expertUserId = existingProfile?.user_id ?? "";
      }
      if (!expertUserId) {
        const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        expertUserId = listed?.users?.find((item) => item.email?.toLowerCase() === email)?.id ?? "";
      }
      if (!expertUserId) {
        const { data: created, error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { display_name: displayName, role: "reviewer" } });
        if (createError || !created.user) throw new Error("전문위원 계정을 생성하지 못했습니다.");
        expertUserId = created.user.id;
      } else {
        const { data: targetProfile, error: targetProfileError } = await admin.from("review_profiles").select("role").eq("user_id", expertUserId).single();
        if (targetProfileError || targetProfile?.role !== "reviewer") throw new Error("전문위원 계정만 이 화면에서 변경할 수 있습니다.");
        const { error: authUpdateError } = await admin.auth.admin.updateUserById(expertUserId, { email, user_metadata: { display_name: displayName, role: "reviewer" } });
        if (authUpdateError) throw new Error("전문위원 계정 정보를 갱신하지 못했습니다.");
      }
      const { error: profileError } = await admin.from("review_profiles").upsert({ user_id: expertUserId, email, display_name: displayName, mobile, organization, department, position_title: positionTitle, role: "reviewer", role_label: "외부 전문위원", active: payload.active !== false }, { onConflict: "user_id" });
      if (profileError) throw profileError;
      await admin.from("review_events").insert({ reviewer_user_id: userId, event_type: requestedId ? "expert_profile_updated" : "expert_profile_created", payload: { expertUserId, email, invitationSent: false, accessState: "prepared" } });
      return json({ ok: true, expertUserId, invitationSent }, 200, origin);
    }

    if (action === "managerSaveAssignment") {
      await ensureManager(admin, userId);
      const requestedId = cleanText(payload.id, 80);
      const expertUserId = cleanText(payload.expertUserId, 80);
      const subjectId = cleanText(payload.subjectId, 80);
      const title = cleanText(payload.title, 300);
      const contractReference = cleanText(payload.contractReference, 500);
      const examTrack = cleanText(payload.examTrack, 20);
      const contractCompleted = payload.contractCompleted === true;
      const documentIds: string[] = [...new Set<string>(Array.isArray(payload.documentIds) ? payload.documentIds.map((item: unknown) => cleanText(item, 80)).filter(Boolean) : [])];
      const startsAt = new Date(`${cleanText(payload.startsAt, 10)}T00:00:00+09:00`);
      const interimDueAt = new Date(`${cleanText(payload.interimDueAt, 10)}T23:59:59+09:00`);
      const endsAt = new Date(`${cleanText(payload.endsAt, 10)}T23:59:59+09:00`);
      if (!expertUserId || !subjectId || !title || !documentIds.length || !["national", "local"].includes(examTrack) || !contractCompleted || Number.isNaN(startsAt.getTime()) || Number.isNaN(interimDueAt.getTime()) || Number.isNaN(endsAt.getTime()) || interimDueAt <= startsAt || interimDueAt > endsAt || endsAt <= startsAt) throw new Error("전문위원, 시험 구분, 전자계약 완료, 검수 자료와 시작·중간보고·최종완료 일정을 정확히 확인해 주세요.");
      const { data: expert, error: expertError } = await admin.from("review_profiles").select("user_id, email, display_name, active").eq("user_id", expertUserId).eq("role", "reviewer").single();
      if (expertError || !expert?.active) throw new Error("이용 가능한 전문위원 계정을 확인해 주세요.");
      const { data: subject, error: subjectError } = await admin.from("review_subjects").select("id, program_id, name").eq("id", subjectId).single();
      if (subjectError || !subject) throw new Error("위촉할 과목을 확인해 주세요.");
      const assignmentTitle = examTrack === "national" ? `${subject.name} 핵심요약노트·모의고사 검수` : title;
      const { data: validDocuments, error: documentError } = await admin.from("review_documents").select("id, title, version, status, source_sha256").eq("subject_id", subjectId).in("id", documentIds);
      if (documentError || (validDocuments ?? []).length !== documentIds.length) throw new Error("담당 과목과 일치하는 검수 자료만 지정할 수 있습니다.");
      if ((validDocuments ?? []).some((item) => examTrackFromTitle(item.title) !== examTrack)) throw new Error("선택한 시험 구분과 일치하는 국가직 또는 지방직 원고만 지정할 수 있습니다.");
      if ((validDocuments ?? []).some((item) => item.status !== "review_ready" || !item.source_sha256)) throw new Error("최신 활성 원고와 원본 무결성값이 확인된 자료만 지정할 수 있습니다.");
      if (examTrack !== "national") throw new Error("지방직 7급 검수는 별도 계약 후 별도 과제로 진행해 주세요.");
      const contractCompletedAt = new Date().toISOString();
      let assignmentId = requestedId;
      let duplicatePrevented = false;
      if (requestedId) {
        const { data: existing, error: existingError } = await admin.from("review_assignments").select("*").eq("id", requestedId).single();
        if (existingError || !existing) throw new Error("확인·변경할 위촉 과제를 찾지 못했습니다.");
        const { data: currentLinks } = await admin.from("review_assignment_documents").select("document_id").eq("assignment_id", requestedId);
        const currentIds = new Set((currentLinks ?? []).map((item) => item.document_id));
        const compositionChanged = currentIds.size !== documentIds.length || documentIds.some((id) => !currentIds.has(id));
        if (compositionChanged) {
          const { count: progressCount } = await admin.from("review_progress").select("assignment_id", { count: "exact", head: true }).eq("assignment_id", requestedId);
          const { count: annotationCount } = await admin.from("review_annotations").select("assignment_id", { count: "exact", head: true }).eq("assignment_id", requestedId);
          if ((progressCount ?? 0) > 0 || (annotationCount ?? 0) > 0) throw new Error("이미 검수 기록이 시작된 과제의 자료 구성은 변경할 수 없습니다. 기존 위촉을 보존하고 새 과제로 등록해 주세요.");
        }
        if (existing.reviewer_user_id !== expertUserId) throw new Error("기록 보호를 위해 위촉 후 전문위원을 변경할 수 없습니다. 새 과제로 등록해 주세요.");
        if (existing.status !== "prepared") throw new Error("이미 시작된 과제는 준비 단계에서 변경할 수 없습니다.");
        const { error: updateError } = await admin.from("review_assignments").update({ subject_id: subjectId, title: assignmentTitle, starts_at: startsAt.toISOString(), interim_due_at: interimDueAt.toISOString(), ends_at: endsAt.toISOString(), contract_reference: contractReference, exam_track: examTrack, contract_completed_at: contractCompletedAt }).eq("id", requestedId);
        if (updateError) throw updateError;
      } else {
        const assignmentKey = { reviewer_user_id: expertUserId, subject_id: subjectId, exam_track: examTrack, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() };
        const findExistingAssignment = async () => admin.from("review_assignments").select("id").match(assignmentKey).neq("status", "revoked").order("created_at", { ascending: true }).limit(1).maybeSingle();
        const { data: existingDuplicate, error: duplicateLookupError } = await findExistingAssignment();
        if (duplicateLookupError) throw new Error("기존 위촉 중복 여부를 확인하지 못했습니다.");
        if (existingDuplicate?.id) {
          assignmentId = existingDuplicate.id;
          duplicatePrevented = true;
        } else {
          const { data: created, error: createError } = await admin.from("review_assignments").insert({ ...assignmentKey, title: assignmentTitle, interim_due_at: interimDueAt.toISOString(), contract_reference: contractReference, contract_completed_at: contractCompletedAt, status: "prepared", started_at: null, notification_sent_at: null }).select("id").single();
          if (createError?.code === "23505") {
            const { data: racedAssignment, error: racedLookupError } = await findExistingAssignment();
            if (racedLookupError || !racedAssignment?.id) throw new Error("동일 위촉의 중복 저장을 안전하게 정리하지 못했습니다.");
            assignmentId = racedAssignment.id;
            duplicatePrevented = true;
          } else {
            if (createError || !created) throw new Error("과목 위촉을 저장하지 못했습니다.");
            assignmentId = created.id;
          }
        }
      }
      const { data: currentLinks } = await admin.from("review_assignment_documents").select("document_id").eq("assignment_id", assignmentId);
      const currentIds = new Set((currentLinks ?? []).map((item) => item.document_id));
      const obsoleteIds = [...currentIds].filter((id) => !documentIds.includes(id));
      if (obsoleteIds.length) await admin.from("review_assignment_documents").delete().eq("assignment_id", assignmentId).in("document_id", obsoleteIds);
      const { error: linkError } = await admin.from("review_assignment_documents").upsert(documentIds.map((documentId, index) => ({ assignment_id: assignmentId, document_id: documentId, sort_order: index + 1, visible_from: null, visible_until: endsAt.toISOString() })), { onConflict: "assignment_id,document_id" });
      if (linkError) throw linkError;
      await admin.from("review_events").insert({ assignment_id: assignmentId, reviewer_user_id: userId, event_type: requestedId ? "assignment_updated" : duplicatePrevented ? "assignment_duplicate_prevented" : "assignment_created", payload: { expertUserId, subjectId, documentIds, examTrack, contractCompleted: true, startsAt: startsAt.toISOString(), interimDueAt: interimDueAt.toISOString(), endsAt: endsAt.toISOString(), notificationStatus: "held_until_batch_start", duplicatePrevented } });
      return json({ ok: true, assignmentId, duplicatePrevented, notificationSent: false, notificationStatus: "held_until_batch_start" }, 200, origin);
    }

    if (action === "managerBatchStart") {
      await ensureManager(admin, userId);
      const controls = await runtimeControls(admin);
      if (!controls.launchEnabled || !controls.accessEnabled || !REVIEW_EMAIL_ENABLED || !REVIEW_EMAIL_PROVIDER) {
        throw new Error("전문위원 안내 발송 기능이 현재 잠겨 있습니다. 대표님의 최종 발송 승인 후 서버 설정을 해제해 주세요.");
      }
      const assignmentIds: string[] = [...new Set<string>(Array.isArray(payload.assignmentIds) ? payload.assignmentIds.map((item: unknown) => cleanText(item, 80)).filter(Boolean) : [])];
      if (!assignmentIds.length || assignmentIds.length > 50) throw new Error("시작할 국가직 과제를 1~50건 선택해 주세요.");
      const { data: assignments, error: assignmentError } = await admin.from("review_assignments").select("*").in("id", assignmentIds);
      if (assignmentError || (assignments ?? []).length !== assignmentIds.length) throw new Error("일괄 시작할 과제를 모두 확인하지 못했습니다.");
      const results=[] as Array<Record<string, unknown>>;
      for (const assignment of assignments ?? []) {
        if (assignment.status !== "prepared") {
          if (assignment.started_at && assignment.notification_sent_at && ["assigned", "reviewing", "submitted", "accepted", "returned"].includes(assignment.status)) {
            results.push({assignmentId:assignment.id,started:false,alreadyStarted:true,notificationSent:true,notificationStatus:"sent",notificationRecordStatus:"already_recorded"});
            continue;
          }
          throw new Error("계약 완료된 국가직 준비 과제만 시작할 수 있습니다.");
        }
        if (assignment.exam_track !== "national" || !assignment.contract_completed_at) throw new Error("계약 완료된 국가직 준비 과제만 시작할 수 있습니다.");
        const { data: links } = await admin.from("review_assignment_documents").select("document_id").eq("assignment_id", assignment.id);
        const documentIds=(links ?? []).map((item)=>item.document_id);
        const { data: documents } = documentIds.length ? await admin.from("review_documents").select("id, title, version, status, source_sha256").in("id", documentIds) : { data: [] };
        if (!documentIds.length || (documents ?? []).length !== documentIds.length || (documents ?? []).some((item)=>item.status!=="review_ready"||!item.source_sha256||examTrackFromTitle(item.title)!=="national")) throw new Error("국가직 최신 활성 원고와 무결성값을 다시 확인해 주세요.");
        const startBlockCounts = await reviewBlockCountMap(admin, documentIds);
        const emptyDocumentIds = documentIds.filter((documentId) => (startBlockCounts.get(documentId) ?? 0) === 0);
        if (emptyDocumentIds.length) throw new Error(`검수 문단이 준비되지 않은 원고 ${emptyDocumentIds.length}건이 있어 시작할 수 없습니다.`);
        const { data: expert }=await admin.from("review_profiles").select("email,display_name").eq("user_id",assignment.reviewer_user_id).single();
        const { data: subject }=await admin.from("review_subjects").select("name").eq("id",assignment.subject_id).single();
        if(!expert?.email){
          results.push({assignmentId:assignment.id,started:false,alreadyStarted:false,notificationSent:false,notificationStatus:"failed",notificationRecordStatus:"reviewer_email_missing",error:"전문위원 이메일을 확인해 주세요."});
          continue;
        }
        const {data:existingStartArchive}=await admin.from("review_notification_archive").select("sent_at,delivery_status").eq("assignment_id",assignment.id).eq("notification_type","assignment_start").eq("recipient_email",expert.email).maybeSingle();
        if(existingStartArchive?.delivery_status==="service_accepted"&&existingStartArchive.sent_at){
          const recoveredStartAt=assignment.started_at||existingStartArchive.sent_at;
          const {error:recoverError}=await admin.from("review_assignments").update({status:"assigned",started_at:recoveredStartAt,notification_sent_at:existingStartArchive.sent_at}).eq("id",assignment.id).eq("status","prepared");
          if(!recoverError){
            await admin.from("review_assignment_documents").update({visible_from:recoveredStartAt}).eq("assignment_id",assignment.id);
            results.push({assignmentId:assignment.id,started:false,alreadyStarted:true,notificationSent:true,notificationStatus:"sent",notificationRecordStatus:"repaired_from_archive"});
            continue;
          }
        }
        const reservationAt=new Date().toISOString();
        const {data:reservedRows,error:reservationError}=await admin.from("review_assignments").update({started_at:reservationAt}).eq("id",assignment.id).eq("status","prepared").is("started_at",null).is("notification_sent_at",null).select("id");
        if(reservationError||!(reservedRows??[]).length){
          const [{data:latest},{data:archivedStart}]=await Promise.all([
            admin.from("review_assignments").select("status,started_at,notification_sent_at").eq("id",assignment.id).maybeSingle(),
            admin.from("review_notification_archive").select("sent_at,delivery_status").eq("assignment_id",assignment.id).eq("notification_type","assignment_start").eq("recipient_email",expert.email).maybeSingle()
          ]);
          if(archivedStart?.delivery_status==="service_accepted"&&archivedStart.sent_at){
            const repairedAt=latest?.started_at||archivedStart.sent_at;
            const {error:repairError}=await admin.from("review_assignments").update({status:"assigned",started_at:repairedAt,notification_sent_at:archivedStart.sent_at}).eq("id",assignment.id).eq("status","prepared");
            if(!repairError){
              await admin.from("review_assignment_documents").update({visible_from:repairedAt}).eq("assignment_id",assignment.id);
              results.push({assignmentId:assignment.id,started:false,alreadyStarted:true,notificationSent:true,notificationStatus:"sent",notificationRecordStatus:"repaired_from_archive"});
              continue;
            }
          }
          if(latest?.started_at&&latest?.notification_sent_at&&["assigned","reviewing","submitted","accepted","returned"].includes(latest.status)){
            results.push({assignmentId:assignment.id,started:false,alreadyStarted:true,notificationSent:true,notificationStatus:"sent",notificationRecordStatus:"already_recorded"});
            continue;
          }
          const reservationAge=latest?.started_at?Date.now()-new Date(latest.started_at).getTime():0;
          if(latest?.status==="prepared"&&latest.started_at&&!latest.notification_sent_at&&reservationAge>120000){
            await admin.from("review_assignments").update({started_at:null}).eq("id",assignment.id).eq("status","prepared").eq("started_at",latest.started_at).is("notification_sent_at",null);
            results.push({assignmentId:assignment.id,started:false,alreadyStarted:false,notificationSent:false,notificationStatus:"retry_required",notificationRecordStatus:"stale_reservation_released",error:"이전 시작 시도가 안전하게 정리되었습니다. 같은 버튼을 한 번 더 눌러 주세요."});
          }else{
            results.push({assignmentId:assignment.id,started:false,alreadyStarted:false,notificationSent:false,notificationStatus:"processing",notificationRecordStatus:"start_in_progress",error:"같은 과제의 시작 처리가 이미 진행 중입니다. 잠시 후 최신 기록을 확인해 주세요."});
          }
          continue;
        }
        const notificationSubject=`[유한회사 설탕과소금] ${expert.display_name} 전문위원님 · ${subject?.name??"담당 과목"} 검수 개시 안내`;
        const notificationHtml=buildAssignmentStartEmail(expert.display_name,subject?.name,assignment,(documents??[]) as Array<Record<string, unknown>>);
        let notification={sent:false,status:"failed",id:null as string|null,provider:null as string|null};
        try {
          notification=await sendOperationalEmail(expert.email,notificationSubject,notificationHtml,`assignment-start-${assignment.id}`);
        } catch (error) {
          await admin.from("review_assignments").update({started_at:null}).eq("id",assignment.id).eq("status","prepared").eq("started_at",reservationAt).is("notification_sent_at",null);
          await admin.from("review_events").insert({assignment_id:assignment.id,reviewer_user_id:userId,event_type:"assignment_start_failed",payload:{phase:"email",notificationStatus:"failed",message:cleanText(error instanceof Error?error.message:"안내 이메일 발송 실패",200)}});
          results.push({assignmentId:assignment.id,started:false,alreadyStarted:false,notificationSent:false,notificationStatus:"failed",notificationRecordStatus:"email_failed",error:"안내 이메일 발송 서비스 접수에 실패했습니다."});
          continue;
        }
        if(!notification.sent){
          await admin.from("review_assignments").update({started_at:null}).eq("id",assignment.id).eq("status","prepared").eq("started_at",reservationAt).is("notification_sent_at",null);
          results.push({assignmentId:assignment.id,started:false,alreadyStarted:false,notificationSent:false,notificationStatus:notification.status,notificationRecordStatus:"email_not_sent",error:"안내 이메일이 발송 서비스에 접수되지 않았습니다."});
          continue;
        }
        const { error: archiveError } = await admin.from("review_notification_archive").upsert({assignment_id:assignment.id,notification_type:"assignment_start",channel:"email",recipient_email:expert.email,recipient_name:expert.display_name,subject:notificationSubject,html_body:notificationHtml,text_body:null,template_version:"assignment-start-v1",provider:notification.provider,provider_message_id:notification.id,delivery_status:"service_accepted",sent_at:new Date().toISOString(),created_by:userId},{onConflict:"assignment_id,notification_type,recipient_email"});
        await admin.from("review_events").insert({assignment_id:assignment.id,reviewer_user_id:userId,event_type:"notification_dispatched",payload:{channel:"email",recipient:expert.email,subject:notificationSubject,templateVersion:"assignment-start-v1",provider:notification.provider,providerMessageId:notification.id,notificationStatus:notification.status,archiveStored:!archiveError,archiveError:archiveError?cleanText(archiveError.message,160):null}});
        const startedAt=reservationAt;
        const notificationSentAt=notification.sent?new Date().toISOString():null;
        const {data:startedRows,error:startError}=await admin.from("review_assignments").update({status:"assigned",notification_sent_at:notificationSentAt}).eq("id",assignment.id).eq("status","prepared").eq("started_at",reservationAt).is("notification_sent_at",null).select("id");
        if(startError||!(startedRows??[]).length){
          const {data:latest}=await admin.from("review_assignments").select("status,started_at,notification_sent_at").eq("id",assignment.id).maybeSingle();
          if(latest?.started_at&&latest?.notification_sent_at){
            results.push({assignmentId:assignment.id,started:false,alreadyStarted:true,notificationSent:true,notificationStatus:"sent",notificationRecordStatus:"already_recorded"});
            continue;
          }
          await admin.from("review_events").insert({assignment_id:assignment.id,reviewer_user_id:userId,event_type:"assignment_start_failed",payload:{phase:"assignment_record",notificationStatus:"sent",notificationId:notification.id}});
          results.push({assignmentId:assignment.id,started:false,alreadyStarted:false,notificationSent:true,notificationStatus:"sent",notificationRecordStatus:"assignment_record_failed",error:"안내 메일은 접수됐으나 검수 시작 기록 저장에 실패했습니다. 같은 버튼으로 다시 확인해 주세요."});
          continue;
        }
        const {error:visibilityError}=await admin.from("review_assignment_documents").update({visible_from:startedAt}).eq("assignment_id",assignment.id);
        const notificationRecordStatus=visibilityError?"started_visibility_warning":"recorded";
        const {error:startEventError}=await admin.from("review_events").insert({assignment_id:assignment.id,reviewer_user_id:userId,event_type:"assignment_started",payload:{examTrack:"national",documentIds,versions:(documents??[]).map((item)=>item.version),notificationStatus:notification.status,notificationSentAt,notificationId:notification.id}});
        results.push({assignmentId:assignment.id,started:true,alreadyStarted:false,notificationSent:true,notificationStatus:notification.status,notificationRecordStatus:startEventError?"assignment_record_only":notificationRecordStatus});
      }
      return json({ok:true,processedCount:results.length,startedCount:results.filter((item)=>item.started).length,alreadyStartedCount:results.filter((item)=>item.alreadyStarted).length,notificationSentCount:results.filter((item)=>item.notificationSent).length,failedCount:results.filter((item)=>item.error).length,results},200,origin);
    }

    if (action === "managerChangeAssignmentStatus") {
      await ensureManager(admin, userId);
      const assignmentId = cleanText(payload.assignmentId, 80);
      const command = cleanText(payload.command, 30);
      if (!['rereview', 'revoke'].includes(command)) throw new Error("지원하지 않는 운영 명령입니다.");
      const { data: assignment, error: assignmentError } = await admin.from("review_assignments").select("*").eq("id", assignmentId).single();
      if (assignmentError || !assignment) throw new Error("위촉 과제를 찾지 못했습니다.");
      const { data: expert } = await admin.from("review_profiles").select("email, display_name").eq("user_id", assignment.reviewer_user_id).single();
      const { data: subject } = await admin.from("review_subjects").select("name").eq("id", assignment.subject_id).single();
      if (command === "rereview") {
        const { data: report } = await admin.from("review_exports").select("id, delivery_status").eq("assignment_id", assignmentId).maybeSingle();
        if (report?.delivery_status === "delivered") throw new Error("이미 교재 제작 시스템에 전달된 과제는 기존 기록을 보존하고 새 과제로 등록해 주세요.");
        if (report) {
          const { error: supersedeError } = await admin.from("review_exports").update({ delivery_status: "superseded" }).eq("id", report.id);
          if (supersedeError) throw supersedeError;
        }
        const endsAt = new Date(`${cleanText(payload.endsAt, 10)}T23:59:59+09:00`);
        if (Number.isNaN(endsAt.getTime())) throw new Error("재검토 종료일을 확인해 주세요.");
        const { error: assignmentUpdateError } = await admin.from("review_assignments").update({ status: "returned", ends_at: endsAt.toISOString(), submitted_at: null }).eq("id", assignmentId);
        if (assignmentUpdateError) throw assignmentUpdateError;
        const { error: progressUpdateError } = await admin.from("review_progress").update({ complete: false, completed_at: null }).eq("assignment_id", assignmentId);
        if (progressUpdateError) throw progressUpdateError;
      } else {
        const { error: revokeError } = await admin.from("review_assignments").update({ status: "revoked" }).eq("id", assignmentId);
        if (revokeError) throw revokeError;
      }
      let notification = { sent: false, status: "skipped", id: null as string | null };
      if (payload.sendNotification && expert?.email) {
        const title = command === "rereview" ? "재검토 요청 안내" : "검수 위촉 종료 안내";
        const body = command === "rereview" ? `<p>반영 과정에서 전문위원님의 추가 고견이 필요한 부분이 있어 재검토를 정중히 요청드립니다.</p><p>워크룸에서 기존 의견과 보완 자료를 확인해 주시면 감사하겠습니다.</p>` : `<p>${emailHtml(subject?.name ?? "담당 과목")} 검수 위촉 일정이 종료되어 안내드립니다.</p><p>함께해 주신 귀한 전문성과 노고에 깊이 감사드립니다.</p>`;
        notification = await sendOperationalEmail(expert.email, `[설탕과소금] ${expert.display_name} 전문위원님, ${title}`, `<div style="font-family:Arial,sans-serif;line-height:1.8;color:#243746"><h2 style="color:#102d4d">${emailHtml(expert.display_name)} 전문위원님께</h2>${body}<p><a href="${emailHtml(REVIEW_APP_URL)}">전문위원 검수 워크룸</a></p><p>유한회사 설탕과소금 드림</p></div>`, `${command}-${assignmentId}-${new Date().toISOString().slice(0,10)}`);
      }
      await admin.from("review_events").insert({ assignment_id: assignmentId, reviewer_user_id: userId, event_type: command === "rereview" ? "assignment_rereview_requested" : "assignment_revoked", payload: { notificationStatus: notification.status } });
      return json({ ok: true, notificationSent: notification.sent, notificationStatus: notification.status }, 200, origin);
    }

    if (action === "managerGetReport") {
      await ensureManager(admin, userId);
      const exportId = cleanText(payload.exportId, 80);
      const { data, error } = await admin.from("review_exports").select("id, assignment_id, reviewer_user_id, report_id, file_name, json_payload, sha256, delivery_status, created_at, delivered_at").eq("id", exportId).single();
      if (error || !data) throw new Error("표준 검수보고서를 찾지 못했습니다.");
      const { data: managerReview } = await admin.from("review_manager_reviews").select("id, status, manager_notes, ai_supplement, reviewed_at, approved_at, updated_at").eq("export_id", exportId).maybeSingle();
      const aiSupplement = managerReview?.ai_supplement && Object.keys(managerReview.ai_supplement).length ? managerReview.ai_supplement : buildAiSupplement(data.json_payload);
      return json({
        reportId: data.report_id,
        fileName: data.file_name,
        report: data.json_payload,
        sha256: data.sha256,
        deliveryStatus: data.delivery_status,
        createdAt: data.created_at,
        deliveredAt: data.delivered_at,
        managerReview: managerReview ? { id: managerReview.id, status: managerReview.status, notes: managerReview.manager_notes, aiSupplement, reviewedAt: managerReview.reviewed_at, approvedAt: managerReview.approved_at, updatedAt: managerReview.updated_at } : { status: "pending", notes: "", aiSupplement, reviewedAt: null, approvedAt: null, updatedAt: null }
      }, 200, origin);
    }

    if (action === "managerSaveReportReview" || action === "managerApproveReport") {
      const manager = await ensureManager(admin, userId);
      const exportId = cleanText(payload.exportId, 80);
      const managerNotes = cleanText(payload.managerNotes, 12000);
      const { data: report, error: reportError } = await admin.from("review_exports").select("id, assignment_id, reviewer_user_id, report_id, json_payload, delivery_status").eq("id", exportId).single();
      if (reportError || !report) throw new Error("대표 검토 대상 보고서를 찾지 못했습니다.");
      if (report.delivery_status === "delivered") throw new Error("이미 교재 제작 시스템에 전달 완료된 보고서입니다.");
      const aiSupplement = buildAiSupplement(report.json_payload);
      const now = new Date().toISOString();
      const approving = action === "managerApproveReport";
      const reviewRow = {
        export_id: exportId,
        assignment_id: report.assignment_id,
        reviewer_user_id: report.reviewer_user_id,
        manager_user_id: manager.user_id,
        status: approving ? "approved" : "reviewing",
        manager_notes: managerNotes,
        ai_supplement: aiSupplement,
        reviewed_at: now,
        approved_at: approving ? now : null
      };
      const { data: saved, error: saveError } = await admin.from("review_manager_reviews").upsert(reviewRow, { onConflict: "export_id" }).select("id, status, manager_notes, ai_supplement, reviewed_at, approved_at, updated_at").single();
      if (saveError || !saved) throw saveError || new Error("대표 검토 내용을 저장하지 못했습니다.");
      await admin.from("review_events").insert({ assignment_id: report.assignment_id, reviewer_user_id: userId, event_type: approving ? "report_manager_approved" : "report_manager_review_saved", payload: { exportId, reportId: report.report_id } });
      return json({ ok: true, managerReview: { id: saved.id, status: saved.status, notes: saved.manager_notes, aiSupplement: saved.ai_supplement, reviewedAt: saved.reviewed_at, approvedAt: saved.approved_at, updatedAt: saved.updated_at } }, 200, origin);
    }

    if (action === "managerGetHandoffPackage") {
      await ensureManager(admin, userId);
      const exportId = cleanText(payload.exportId, 80);
      const { data: report, error: reportError } = await admin.from("review_exports").select("id, report_id, json_payload").eq("id", exportId).single();
      if (reportError || !report) throw new Error("교재 수정 인계 대상 보고서를 찾지 못했습니다.");
      const { data: managerReview, error: reviewError } = await admin.from("review_manager_reviews").select("status, manager_notes, ai_supplement, approved_at").eq("export_id", exportId).single();
      if (reviewError || managerReview?.status !== "approved") throw new Error("대표 확인과 인계 승인을 먼저 완료해 주세요.");
      const handoff = buildClaudeHandoff(report.json_payload, managerReview);
      const subject = reportFilePart(report.json_payload?.assignment?.subject || "검수");
      return json({
        reportId: report.report_id,
        markdownFileName: `${subject}_Claude_Code_교재수정_인계서.md`,
        jsonFileName: `${subject}_Claude_Code_교재수정_인계자료.json`,
        markdown: handoff.markdown,
        json: handoff.json
      }, 200, origin);
    }

    if (action === "managerGetInterimReport") {
      await ensureManager(admin, userId);
      const reportId = cleanText(payload.reportId, 80);
      const { data, error } = await admin.from("review_interim_reports").select("id, report_id, file_name, markdown, sha256, submitted_at").eq("id", reportId).single();
      if (error || !data) throw new Error("1차 중간보고서를 찾지 못했습니다.");
      return json({ reportId: data.report_id, fileName: data.file_name, markdown: data.markdown, sha256: data.sha256, submittedAt: data.submitted_at }, 200, origin);
    }

    if (action === "markReportDelivered") {
      await ensureManager(admin, userId);
      const exportId = cleanText(payload.exportId, 80);
      const { data: report, error: reportError } = await admin.from("review_exports").select("id, assignment_id, delivery_status").eq("id", exportId).single();
      if (reportError || !report) throw new Error("표준 검수보고서를 찾지 못했습니다.");
      const { data: managerReview } = await admin.from("review_manager_reviews").select("status").eq("export_id", exportId).maybeSingle();
      if (managerReview?.status !== "approved") throw new Error("대표 확인과 Claude Code 인계 승인을 먼저 완료해 주세요.");
      const deliveredAt = new Date().toISOString();
      const { data: delivered, error } = await admin.from("review_exports").update({ delivery_status: "delivered", delivered_at: deliveredAt }).eq("id", exportId).eq("delivery_status", "ready").select("id").maybeSingle();
      if (error) throw error;
      if (!delivered) throw new Error("이미 처리되었거나 전달 대기 상태가 아닌 보고서입니다.");
      await admin.from("review_events").insert({ assignment_id: report.assignment_id, reviewer_user_id: userId, event_type: "report_delivered", payload: { exportId }, occurred_at: deliveredAt });
      const { data: deliveredReport } = await admin.from("review_exports").select("reviewer_user_id, report_id, sha256").eq("id", exportId).single();
      if (deliveredReport) await admin.from("review_change_history").insert({ assignment_id: report.assignment_id, reviewer_user_id: deliveredReport.reviewer_user_id, changed_by: userId, change_type: "report_delivered", target_id: deliveredReport.report_id, after_payload: { exportId, sha256: deliveredReport.sha256, deliveredAt } });
      return json({ ok: true, deliveredAt }, 200, origin);
    }

    if (action === "getDocument") {
      const assignmentId = cleanText(payload.assignmentId, 80);
      const documentId = cleanText(payload.documentId, 80);
      await assignmentFor(admin, userId, assignmentId);
      await assertDocumentAccess(admin, assignmentId, documentId);
      const [documentResult, blockResult, annotationResult, progressResult] = await Promise.all([
        admin.from("review_documents").select("id, kind, title, version, review_stage").eq("id", documentId).single(),
        admin.from("review_blocks").select("id, block_key, heading, body, sort_order").eq("document_id", documentId).order("sort_order"),
        admin.from("review_annotations").select("*").eq("assignment_id", assignmentId).eq("document_id", documentId).eq("reviewer_user_id", userId).order("created_at"),
        admin.from("review_progress").select("*").eq("assignment_id", assignmentId).eq("document_id", documentId).eq("reviewer_user_id", userId).maybeSingle()
      ]);
      const { data: document, error: documentError } = documentResult;
      if (documentError || !document) throw new Error("검수 자료를 찾지 못했습니다.");
      const { data: blocks, error: blockError } = blockResult;
      if (blockError) throw blockError;
      const annotations = annotationResult.data;
      const progress = progressResult.data;
      return json({
        document: { id: document.id, kind: document.kind, title: document.title, version: document.version, stage: document.review_stage, blocks: (blocks ?? []).map((block) => ({ id: block.id, key: block.block_key, heading: block.heading, text: block.body })) },
        annotations: (annotations ?? []).map((item) => ({ id: item.id, assignmentId: item.assignment_id, documentId: item.document_id, blockId: item.block_id, kind: item.kind, color: item.color, startOffset: item.start_offset, endOffset: item.end_offset, selectedText: item.selected_text, body: item.body, issueType: item.issue_type, severity: item.severity, status: item.status, createdAt: item.created_at, updatedAt: item.updated_at })),
        progress: progress ? { checkedBlocks: progress.checked_blocks ?? [], memo: progress.memo ?? "", complete: progress.complete, completedAt: progress.completed_at } : { checkedBlocks: [], memo: "", complete: false }
      }, 200, origin);
    }

    if (action === "managerPreviewDocument") {
      await ensureManager(admin, userId);
      const assignmentId = cleanText(payload.assignmentId, 80);
      const documentId = cleanText(payload.documentId, 80);
      const { data: assignment, error: assignmentError } = await admin
        .from("review_assignments")
        .select("id, reviewer_user_id, status")
        .eq("id", assignmentId)
        .single();
      if (assignmentError || !assignment) throw new Error("관리자 확인이 가능한 위촉 과제를 찾지 못했습니다.");
      const { data: documentLink } = await admin.from("review_assignment_documents").select("assignment_id").eq("assignment_id", assignmentId).eq("document_id", documentId).maybeSingle();
      if (!documentLink) throw new Error("이 위촉 과제에 연결된 검수 자료가 아닙니다.");
      const { data: document, error: documentError } = await admin.from("review_documents").select("id, kind, title, version, review_stage").eq("id", documentId).single();
      if (documentError || !document) throw new Error("검수 자료를 찾지 못했습니다.");
      const { data: blocks, error: blockError } = await admin.from("review_blocks").select("id, block_key, heading, body, sort_order").eq("document_id", documentId).order("sort_order");
      if (blockError) throw blockError;
      const { data: annotations } = await admin.from("review_annotations").select("*").eq("assignment_id", assignmentId).eq("document_id", documentId).eq("reviewer_user_id", assignment.reviewer_user_id).order("created_at");
      const { data: progress } = await admin.from("review_progress").select("*").eq("assignment_id", assignmentId).eq("document_id", documentId).eq("reviewer_user_id", assignment.reviewer_user_id).maybeSingle();
      return json({
        document: { id: document.id, kind: document.kind, title: document.title, version: document.version, stage: document.review_stage, blocks: (blocks ?? []).map((block) => ({ id: block.id, key: block.block_key, heading: block.heading, text: block.body })) },
        annotations: (annotations ?? []).map((item) => ({ id: item.id, assignmentId: item.assignment_id, documentId: item.document_id, blockId: item.block_id, kind: item.kind, color: item.color, startOffset: item.start_offset, endOffset: item.end_offset, selectedText: item.selected_text, body: item.body, issueType: item.issue_type, severity: item.severity, status: item.status, createdAt: item.created_at, updatedAt: item.updated_at })),
        progress: progress ? { checkedBlocks: progress.checked_blocks ?? [], memo: progress.memo ?? "", complete: progress.complete, completedAt: progress.completed_at } : { checkedBlocks: [], memo: "", complete: false }
      }, 200, origin);
    }

    if (action === "saveAnnotation") {
      const annotation = payload.annotation ?? {};
      const assignmentId = cleanText(annotation.assignmentId, 80);
      const documentId = cleanText(annotation.documentId, 80);
      await assignmentFor(admin, userId, assignmentId, true);
      await assertDocumentAccess(admin, assignmentId, documentId);
      const { data: block } = await admin.from("review_blocks").select("id, body").eq("id", cleanText(annotation.blockId, 80)).eq("document_id", documentId).single();
      if (!block) throw new Error("검수 문단을 찾지 못했습니다.");
      const startOffset = Number(annotation.startOffset);
      const endOffset = Number(annotation.endOffset);
      if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset <= startOffset || endOffset > block.body.length) throw new Error("선택 문장의 위치가 올바르지 않습니다.");
      const kind = ["highlight", "memo", "issue"].includes(annotation.kind) ? annotation.kind : "memo";
      const annotationId = cleanText(annotation.id, 80);
      const { data: existingAnnotation } = await admin
        .from("review_annotations")
        .select("*")
        .eq("id", annotationId)
        .maybeSingle();
      if (existingAnnotation && (existingAnnotation.reviewer_user_id !== userId || existingAnnotation.assignment_id !== assignmentId)) {
        throw new Error("현재 계정에서 다듬을 수 없는 검수의견입니다.");
      }
      const record = {
        id: annotationId, assignment_id: assignmentId, document_id: documentId, block_id: block.id, reviewer_user_id: userId,
        kind, color: kind === "highlight" && ["yellow", "green", "pink"].includes(annotation.color) ? annotation.color : null,
        start_offset: startOffset, end_offset: endOffset, selected_text: block.body.slice(startOffset, endOffset),
        body: cleanText(annotation.body), issue_type: kind === "issue" ? cleanText(annotation.issueType, 100) : null,
        severity: kind === "issue" && ["critical", "major", "minor"].includes(annotation.severity) ? annotation.severity : null,
        updated_at: new Date().toISOString()
      };
      const { error } = await admin.from("review_annotations").upsert(record, { onConflict: "id" });
      if (error) throw error;
      await admin.from("review_change_history").insert({
        assignment_id: assignmentId,
        document_id: documentId,
        reviewer_user_id: userId,
        changed_by: userId,
        change_type: "annotation_saved",
        target_id: annotationId,
        before_payload: existingAnnotation ?? null,
        after_payload: record
      });
      await markAssignmentReviewing(admin, userId, assignmentId);
      return json({ ok: true }, 200, origin);
    }

    if (action === "deleteAnnotation") {
      const assignmentId = cleanText(payload.assignmentId, 80);
      await assignmentFor(admin, userId, assignmentId, true);
      const annotationId = cleanText(payload.annotationId, 80);
      const { data: existingAnnotation } = await admin.from("review_annotations").select("*").eq("id", annotationId).eq("assignment_id", assignmentId).eq("reviewer_user_id", userId).maybeSingle();
      const { error } = await admin.from("review_annotations").delete().eq("id", annotationId).eq("assignment_id", assignmentId).eq("reviewer_user_id", userId);
      if (error) throw error;
      if (existingAnnotation) await admin.from("review_change_history").insert({
        assignment_id: assignmentId,
        document_id: existingAnnotation.document_id,
        reviewer_user_id: userId,
        changed_by: userId,
        change_type: "annotation_deleted",
        target_id: annotationId,
        before_payload: existingAnnotation,
        after_payload: null
      });
      return json({ ok: true }, 200, origin);
    }

    if (action === "recordBlockViews") {
      const assignmentId = cleanText(payload.assignmentId, 80);
      const documentId = cleanText(payload.documentId, 80);
      await assignmentFor(admin, userId, assignmentId, true);
      await assertDocumentAccess(admin, assignmentId, documentId);
      const requestedIds = Array.isArray(payload.blockIds) ? [...new Set(payload.blockIds.map((id: unknown) => cleanText(id, 80)).filter(Boolean))].slice(0, 100) : [];
      if (!requestedIds.length) return json({ ok: true, recorded: 0 }, 200, origin);
      const { data: validBlocks, error: validError } = await admin.from("review_blocks").select("id, body").eq("document_id", documentId).in("id", requestedIds);
      if (validError) throw validError;
      const validIds = (validBlocks ?? []).map((block) => block.id);
      const { data: existing, error: existingError } = await admin.from("review_block_checks").select("block_id").eq("assignment_id", assignmentId).eq("document_id", documentId).eq("reviewer_user_id", userId).in("block_id", validIds);
      if (existingError) throw existingError;
      const existingIds = new Set((existing ?? []).map((item) => item.block_id));
      const now = new Date().toISOString();
      const records = (validBlocks ?? []).filter((block) => !existingIds.has(block.id)).map((block) => {
        const estimate = reviewReadingEstimate(block.body);
        return { assignment_id: assignmentId, document_id: documentId, block_id: block.id, reviewer_user_id: userId, first_seen_at: now, estimated_seconds: estimate.estimatedSeconds, character_count: estimate.characterCount, updated_at: now };
      });
      if (records.length) {
        const { error } = await admin.from("review_block_checks").insert(records);
        if (error && !String(error.code).includes("23505")) throw error;
      }
      return json({ ok: true, recorded: records.length }, 200, origin);
    }

    if (action === "recordBlockChecks") {
      const assignmentId = cleanText(payload.assignmentId, 80);
      const documentId = cleanText(payload.documentId, 80);
      await assignmentFor(admin, userId, assignmentId, true);
      await assertDocumentAccess(admin, assignmentId, documentId);
      const requestedIds = Array.isArray(payload.blockIds) ? [...new Set(payload.blockIds.map((id: unknown) => cleanText(id, 80)).filter(Boolean))].slice(0, 100) : [];
      if (!requestedIds.length) return json({ ok: true, recorded: 0 }, 200, origin);
      const bulkCount = Math.max(1, Math.min(100, Number(payload.bulkCount) || requestedIds.length));
      const { data: validBlocks, error: validError } = await admin.from("review_blocks").select("id, body").eq("document_id", documentId).in("id", requestedIds);
      if (validError) throw validError;
      const validIds = (validBlocks ?? []).map((block) => block.id);
      const { data: existing, error: existingError } = await admin.from("review_block_checks").select("*").eq("assignment_id", assignmentId).eq("document_id", documentId).eq("reviewer_user_id", userId).in("block_id", validIds);
      if (existingError) throw existingError;
      const existingMap = new Map((existing ?? []).map((item) => [item.block_id, item]));
      const checkedAt = new Date();
      const records = (validBlocks ?? []).map((block) => {
        const previous = existingMap.get(block.id) as any;
        const estimate = reviewReadingEstimate(block.body);
        const seenAt = previous?.first_seen_at ? new Date(previous.first_seen_at) : null;
        const elapsedSeconds = seenAt ? Math.max(0, Number(((checkedAt.getTime() - seenAt.getTime()) / 1000).toFixed(1))) : null;
        return {
          assignment_id: assignmentId,
          document_id: documentId,
          block_id: block.id,
          reviewer_user_id: userId,
          first_seen_at: previous?.first_seen_at ?? null,
          first_checked_at: previous?.first_checked_at ?? checkedAt.toISOString(),
          last_checked_at: checkedAt.toISOString(),
          check_count: Number(previous?.check_count || 0) + 1,
          elapsed_seconds: previous?.first_checked_at ? previous.elapsed_seconds : elapsedSeconds,
          estimated_seconds: estimate.estimatedSeconds,
          speed_status: previous?.first_checked_at ? previous.speed_status : reviewSpeedStatus(elapsedSeconds, estimate.estimatedSeconds, bulkCount),
          character_count: estimate.characterCount,
          bulk_count: Math.max(Number(previous?.bulk_count || 1), bulkCount),
          updated_at: checkedAt.toISOString()
        };
      });
      const { error } = await admin.from("review_block_checks").upsert(records, { onConflict: "assignment_id,document_id,block_id,reviewer_user_id" });
      if (error) throw error;
      return json({ ok: true, recorded: records.length }, 200, origin);
    }

    if (action === "getSubmissionIntegrity") {
      const assignmentId = cleanText(payload.assignmentId, 80);
      await assignmentFor(admin, userId, assignmentId, true);
      return json({ ok: true, integrity: await buildReviewIntegrity(admin, userId, assignmentId) }, 200, origin);
    }

    if (action === "saveProgress") {
      const assignmentId = cleanText(payload.assignmentId, 80);
      const documentId = cleanText(payload.documentId, 80);
      await assignmentFor(admin, userId, assignmentId, true);
      await assertDocumentAccess(admin, assignmentId, documentId);
      const progress = payload.progress ?? {};
      const { data: existingProgress } = await admin.from("review_progress").select("*").eq("assignment_id", assignmentId).eq("document_id", documentId).eq("reviewer_user_id", userId).maybeSingle();
      const { data: validBlocks } = await admin.from("review_blocks").select("id").eq("document_id", documentId);
      const validIds = new Set((validBlocks ?? []).map((block) => block.id));
      const checkedBlocks = Array.isArray(progress.checkedBlocks)
        ? [...new Set<string>(progress.checkedBlocks.map((id: unknown) => String(id)).filter((id: string) => validIds.has(id)))].slice(0, 2000)
        : [];
      const complete = Boolean(progress.complete) && validIds.size > 0 && checkedBlocks.length === validIds.size;
      const savedAt = new Date().toISOString();
      const record = {
        assignment_id: assignmentId,
        document_id: documentId,
        reviewer_user_id: userId,
        checked_blocks: checkedBlocks,
        memo: cleanText(progress.memo, 10000),
        complete,
        completed_at: complete ? existingProgress?.completed_at || savedAt : null,
        updated_at: savedAt
      };
      const { error } = await admin.from("review_progress").upsert(record, { onConflict: "assignment_id,document_id,reviewer_user_id" });
      if (error) throw error;
      await admin.from("review_change_history").insert({
        assignment_id: assignmentId,
        document_id: documentId,
        reviewer_user_id: userId,
        changed_by: userId,
        change_type: "progress_saved",
        target_id: documentId,
        before_payload: existingProgress ?? null,
        after_payload: record
      });
      await markAssignmentReviewing(admin, userId, assignmentId);
      return json({ ok: true }, 200, origin);
    }

    if (action === "submitAssignment") {
      const assignmentId = cleanText(payload.assignmentId, 80);
      await assignmentFor(admin, userId, assignmentId, true);
      const integrity = await buildReviewIntegrity(admin, userId, assignmentId);
      if (!integrity.totalBlockCount) throw new Error("검수할 원고 문단이 준비되지 않아 최종 제출할 수 없습니다. 담당자에게 말씀해 주세요.");
      if (integrity.hasAttention && payload.integrityAcknowledged !== true) throw new Error("미확인 또는 확인 속도 주의기록을 먼저 확인하고 대표 보고 포함에 동의해 주세요.");
      const submittedAt = new Date().toISOString();
      const { data: submitted, error } = await admin.from("review_assignments").update({ status: "submitted", submitted_at: submittedAt }).eq("id", assignmentId).eq("reviewer_user_id", userId).in("status", ["assigned", "reviewing", "returned"]).select("id").maybeSingle();
      if (error) throw error;
      if (!submitted) throw new Error("현재 상태에서는 최종 제출할 수 없습니다. 화면을 새로 확인해 주세요.");
      let report;
      try {
        report = await createReviewReport(admin, userId, assignmentId, "final");
      } catch (reportError) {
        await admin.from("review_assignments").update({ status: "reviewing", submitted_at: null }).eq("id", assignmentId).eq("reviewer_user_id", userId).eq("submitted_at", submittedAt);
        throw reportError;
      }
      await admin.from("review_events").insert({ assignment_id: assignmentId, reviewer_user_id: userId, event_type: "submission_integrity_acknowledged", payload: { policyVersion: integrity.policyVersion, uncheckedBlockCount: integrity.uncheckedBlockCount, suspiciousCount: integrity.suspiciousCount, acknowledged: Boolean(payload.integrityAcknowledged), submittedAt } });
      const { data: assignmentSummary } = await admin.from("review_assignments").select("title, subject_id").eq("id", assignmentId).single();
      const { data: reviewerSummary } = await admin.from("review_profiles").select("display_name").eq("user_id", userId).single();
      const { data: subjectSummary } = assignmentSummary?.subject_id ? await admin.from("review_subjects").select("name").eq("id", assignmentSummary.subject_id).single() : { data: null };
      try {
        await sendOperationalEmail(REVIEW_OPERATIONS_EMAIL, `[설탕과소금] ${subjectSummary?.name ?? "담당 과목"} 검수보고서 접수`, `<div style="font-family:Arial,sans-serif;line-height:1.8;color:#243746"><h2 style="color:#102d4d">표준 검수보고서가 접수되었습니다.</h2><ul><li>전문위원: ${emailHtml(reviewerSummary?.display_name ?? "전문위원")}</li><li>과제: ${emailHtml(assignmentSummary?.title ?? "검수 과제")}</li><li>보고서 번호: ${emailHtml(report.reportId)}</li><li>무결성값: ${emailHtml(report.sha256)}</li></ul><p><a href="${emailHtml(REVIEW_APP_URL.replace(/\/$/, "/manage.html"))}">운영관제에서 보고서 확인</a></p></div>`, `report-ready-${assignmentId}-${report.sha256}`);
      } catch {
        await admin.from("review_events").insert({ assignment_id: assignmentId, reviewer_user_id: userId, event_type: "report_notification_failed", payload: { reportId: report.reportId } });
      }
      return json({ ok: true, reportId: report.reportId, reportSha256: report.sha256, deliveryStatus: report.deliveryStatus }, 200, origin);
    }

    if (action === "submitInterimReport") {
      const assignmentId = cleanText(payload.assignmentId, 80);
      await assignmentFor(admin, userId, assignmentId, true);
      const { data: progressRows, error: progressError } = await admin.from("review_progress").select("checked_blocks, memo").eq("assignment_id", assignmentId).eq("reviewer_user_id", userId);
      if (progressError) throw progressError;
      const checkedCount = (progressRows ?? []).reduce((sum, item) => sum + new Set(Array.isArray(item.checked_blocks) ? item.checked_blocks : []).size, 0);
      if (!checkedCount) throw new Error("1차 중간보고는 실제로 확인하신 문단 기록이 있어야 제출할 수 있습니다.");
      const report = await createReviewReport(admin, userId, assignmentId, "interim");
      await admin.from("review_events").insert({ assignment_id: assignmentId, reviewer_user_id: userId, event_type: "interim_report_submitted", payload: { reportId: report.reportId, sha256: report.sha256, checkedCount } });
      return json({ ok: true, reportId: report.reportId, reportSha256: report.sha256, submittedAt: new Date().toISOString() }, 200, origin);
    }

    if (action === "exportReport") {
      const assignmentId = cleanText(payload.assignmentId, 80);
      const report = await createReviewReport(admin, userId, assignmentId, "draft");
      return json(report, 200, origin);
    }

    if (action === "managerPreviewReport") {
      await ensureManager(admin, userId);
      const assignmentId = cleanText(payload.assignmentId, 80);
      const { data: assignment, error } = await admin.from("review_assignments").select("reviewer_user_id, status").eq("id", assignmentId).single();
      if (error || !assignment) throw new Error("관리자 확인이 가능한 위촉 과제를 찾지 못했습니다.");
      const report = await createReviewReport(admin, assignment.reviewer_user_id, assignmentId, "draft", true);
      return json(report, 200, origin);
    }

    if (action === "logEvent") {
      const assignmentId = cleanText(payload.assignmentId, 80) || null;
      if (assignmentId) await assignmentFor(admin, userId, assignmentId);
      const eventType = cleanText(payload.type, 120);
      if (!ALLOWED_REVIEW_EVENTS.has(eventType)) throw new Error("허용되지 않은 활동 기록입니다.");
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count, error: countError } = await admin.from("review_events").select("id", { count: "exact", head: true }).eq("reviewer_user_id", userId).gte("occurred_at", oneHourAgo);
      if (countError) throw countError;
      if ((count ?? 0) >= 500) throw new Error("활동 기록 요청이 일시적으로 많습니다. 잠시 후 다시 이용해 주세요.");
      const { error: eventError } = await admin.from("review_events").insert({ assignment_id: assignmentId, document_id: cleanText(payload.documentId, 80) || null, reviewer_user_id: userId, event_type: eventType, payload: safeEventPayload(payload.payload), user_agent: cleanText(request.headers.get("User-Agent"), 500) });
      if (eventError) throw eventError;
      return json({ ok: true }, 200, origin);
    }

    return json({ error: "지원하지 않는 요청입니다." }, 400, origin);
  } catch (error) {
    console.error("review-content", error);
    return json({ error: error instanceof Error ? error.message : "요청을 처리하지 못했습니다." }, 400, origin);
  }
});
