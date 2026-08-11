import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const REVIEW_EMAIL_ENABLED = (Deno.env.get("REVIEW_EMAIL_ENABLED") ?? "false").toLowerCase() === "true";
const REVIEW_ACCESS_ENABLED = (Deno.env.get("REVIEW_ACCESS_ENABLED") ?? "false").toLowerCase() === "true";
const REVIEW_LAUNCH_ENABLED = (Deno.env.get("REVIEW_LAUNCH_ENABLED") ?? "false").toLowerCase() === "true";
const REVIEW_EMAIL_FROM = Deno.env.get("REVIEW_EMAIL_FROM") ?? "유한회사 설탕과소금 <review@gyo6.kr>";
const REVIEW_APP_URL = Deno.env.get("REVIEW_APP_URL") ?? "https://gyo6.kr/review/";
const ALLOWED_ORIGINS = (Deno.env.get("REVIEW_ALLOWED_ORIGINS") ?? "https://gyo6.kr,http://127.0.0.1:4175,http://localhost:4175")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const MAX_REQUEST_CHARS = 200_000;
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

function emailHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character);
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
  if (!REVIEW_LAUNCH_ENABLED || !REVIEW_EMAIL_ENABLED) return { sent: false, status: "paused", id: null };
  if (!RESEND_API_KEY) return { sent: false, status: "not_configured", id: null };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.slice(0, 256) },
    body: JSON.stringify({ from: REVIEW_EMAIL_FROM, to: [to], subject, html })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("안내 이메일 발송 서비스가 요청을 처리하지 못했습니다.");
  return { sent: true, status: "sent", id: result.id ?? null };
}

async function assignmentFor(admin: ReturnType<typeof createClient>, userId: string, assignmentId: string, requireWritable = false) {
  const { data, error } = await admin
    .from("review_assignments")
    .select("*")
    .eq("id", assignmentId)
    .eq("reviewer_user_id", userId)
    .single();
  if (error || !data) throw new Error("전문위원님께 위촉된 검수 과제가 아닙니다.");
  if (!data.notification_sent_at) throw new Error("아직 공식 검수 시작 전입니다. 회사의 공식 시작 안내를 받으신 뒤 이용해 주세요.");
  const now = Date.now();
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

async function bootstrap(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: reviewer, error: reviewerError } = await admin
    .from("review_profiles")
    .select("user_id, email, display_name, mobile, organization, department, position_title, role, role_label, active")
    .eq("user_id", userId)
    .single();
  if (reviewerError || !reviewer?.active) throw new Error("현재 이용 가능한 전문위원 계정을 확인하지 못했습니다. 담당자에게 말씀해 주세요.");
  if (reviewer.role === "reviewer" && (!REVIEW_LAUNCH_ENABLED || !REVIEW_ACCESS_ENABLED)) throw new Error("현재 모든 검수 자료를 최종 점검하고 있습니다. 공식 시작 안내를 받으신 뒤 이용해 주세요.");

  const { data: assignmentRows, error: assignmentError } = await admin
    .from("review_assignments")
    .select("*")
    .eq("reviewer_user_id", userId)
    .in("status", ["assigned", "reviewing", "submitted", "returned"])
    .not("notification_sent_at", "is", null)
    .order("starts_at", { ascending: true });
  if (assignmentError) throw assignmentError;

  const subjectIds = [...new Set((assignmentRows ?? []).map((row) => row.subject_id))];
  const { data: subjectRows } = subjectIds.length
    ? await admin.from("review_subjects").select("id, program_id, code, name").in("id", subjectIds)
    : { data: [] };
  const programIds = [...new Set((subjectRows ?? []).map((row) => row.program_id))];
  const { data: programRows } = programIds.length
    ? await admin.from("review_programs").select("id, name").in("id", programIds)
    : { data: [] };
  const assignmentIds = (assignmentRows ?? []).map((row) => row.id);
  const { data: links } = assignmentIds.length
    ? await admin.from("review_assignment_documents").select("assignment_id, document_id, sort_order").in("assignment_id", assignmentIds).order("sort_order")
    : { data: [] };
  const documentIds = [...new Set((links ?? []).map((row) => row.document_id))];
  const { data: documents } = documentIds.length
    ? await admin.from("review_documents").select("id, kind, title, version, review_stage").in("id", documentIds)
    : { data: [] };
  const { data: progressRows } = assignmentIds.length
    ? await admin.from("review_progress").select("*").eq("reviewer_user_id", userId).in("assignment_id", assignmentIds)
    : { data: [] };

  const subjects = new Map((subjectRows ?? []).map((row) => [row.id, row]));
  const programs = new Map((programRows ?? []).map((row) => [row.id, row]));
  const documentMap = new Map((documents ?? []).map((row) => [row.id, row]));
  const assignments = (assignmentRows ?? []).map((assignment) => {
    const subject = subjects.get(assignment.subject_id);
    return {
      id: assignment.id,
      program: programs.get(subject?.program_id) ?? { id: "unknown", name: "검수" },
      subject: { id: subject?.id, name: subject?.name ?? "과목" },
      title: assignment.title,
      contractReference: assignment.contract_reference,
      period: `${assignment.starts_at.slice(0, 10)} — ${assignment.ends_at.slice(0, 10)}`,
      status: assignment.status,
      watermarkCode: assignment.watermark_code,
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
    progress
  };
}

async function createReviewReport(admin: ReturnType<typeof createClient>, userId: string, assignmentId: string) {
  const assignment = await assignmentFor(admin, userId, assignmentId);
  if (["submitted", "accepted"].includes(assignment.status)) {
    const { data: existingExport, error: existingExportError } = await admin
      .from("review_exports")
      .select("report_id, file_name, markdown, sha256, delivery_status")
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
  const { data: blocks, error: blockError } = documentIds.length
    ? await admin.from("review_blocks").select("id, document_id, heading, sort_order").in("document_id", documentIds).order("sort_order")
    : { data: [], error: null };
  if (blockError) throw blockError;
  const { data: annotations, error: annotationError } = await admin.from("review_annotations").select("*").eq("assignment_id", assignmentId).eq("reviewer_user_id", userId).order("created_at");
  if (annotationError) throw annotationError;
  const { data: progressRows, error: progressError } = await admin.from("review_progress").select("*").eq("assignment_id", assignmentId).eq("reviewer_user_id", userId);
  if (progressError) throw progressError;

  const generatedAt = new Date().toISOString();
  const reportId = `REVIEW-${assignmentId.slice(0, 8).toUpperCase()}-${generatedAt.replace(/\D/g, "").slice(0, 14)}`;
  const documentMap = new Map((documents ?? []).map((item) => [item.id, item]));
  const blockMap = new Map((blocks ?? []).map((item) => [item.id, item]));
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
    schema: "sugar-salt-expert-review/v1",
    reportId,
    status: ["submitted", "accepted"].includes(assignment.status) ? "final" : "draft",
    generatedAt,
    company: { name: "유한회사 설탕과소금", unit: program.id === "civil" ? "공직시험 연구소" : "교원임용 연구" },
    reviewer: { id: reviewer.user_id, name: reviewer.display_name, email: reviewer.email, mobile: reviewer.mobile, organization: reviewer.organization, department: reviewer.department, positionTitle: reviewer.position_title, roleLabel: reviewer.role_label },
    assignment: { id: assignment.id, program: program.name, subject: subject.name, title: assignment.title, contractReference: assignment.contract_reference, period: `${assignment.starts_at.slice(0, 10)} — ${assignment.ends_at.slice(0, 10)}`, status: assignment.status },
    summary: { documentCount: detailDocuments.length, completedDocumentCount: detailDocuments.filter((item: any) => item.complete).length, findingCount: findings.length, referenceMarkCount: (annotations ?? []).filter((item) => item.kind === "highlight").length },
    documents: detailDocuments
  };
  const lines = [
    "---",
    "schema: sugar-salt-expert-review/v1",
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
    `- 작성상태: ${payload.status === "final" ? "최종 제출" : "작성 중 초안"}`,
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
    "## 2. 검수 현황",
    "",
    `- 자료 ${payload.summary.documentCount}건 중 ${payload.summary.completedDocumentCount}건 검수 확인`,
    `- 수정·보완 의견 ${payload.summary.findingCount}건, 참고 표시 ${payload.summary.referenceMarkCount}건`,
    ""
  ];
  detailDocuments.forEach((document: any, documentIndex: number) => {
    lines.push(
      `## ${documentIndex + 3}. ${reportValue(document.kind)} — ${reportValue(document.title)}`,
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
  const fileName = `${reportFilePart(program.name)}_${reportFilePart(subject.name)}_${reportFilePart(reviewer.display_name)}_검수보고서.md`;
  if (payload.status === "final") {
    const { error: exportError } = await admin.from("review_exports").upsert({ assignment_id: assignmentId, reviewer_user_id: userId, schema_version: payload.schema, report_id: reportId, file_name: fileName, markdown, json_payload: payload, sha256, delivery_status: "ready", created_at: generatedAt, delivered_at: null }, { onConflict: "assignment_id,reviewer_user_id" });
    if (exportError) throw exportError;
  }
  return { reportId, fileName, markdown, sha256, status: payload.status, deliveryStatus: payload.status === "final" ? "ready" : "draft" };
}

async function ensureManager(admin: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await admin.from("review_profiles").select("user_id, display_name, role, active").eq("user_id", userId).single();
  if (error || !data?.active || !["manager", "admin"].includes(data.role)) throw new Error("회사 운영담당자 권한이 필요합니다.");
  return data;
}

async function managerDashboard(admin: ReturnType<typeof createClient>, userId: string) {
  await ensureManager(admin, userId);
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
  const { data: blocks } = documentIds.length ? await admin.from("review_blocks").select("id, document_id").in("document_id", documentIds) : { data: [] };
  const { data: progressRows } = assignmentIds.length ? await admin.from("review_progress").select("assignment_id, document_id, checked_blocks, complete, completed_at, updated_at").in("assignment_id", assignmentIds) : { data: [] };
  const { data: annotationRows } = assignmentIds.length ? await admin.from("review_annotations").select("assignment_id, id").in("assignment_id", assignmentIds) : { data: [] };
  const { data: eventRows } = assignmentIds.length ? await admin.from("review_events").select("assignment_id, occurred_at").in("assignment_id", assignmentIds).order("occurred_at", { ascending: false }) : { data: [] };
  const { data: exportRows } = assignmentIds.length ? await admin.from("review_exports").select("id, assignment_id, report_id, file_name, sha256, delivery_status, created_at, delivered_at").in("assignment_id", assignmentIds) : { data: [] };
  const reviewerMap = new Map((reviewers ?? []).map((item) => [item.user_id, item]));
  const subjectMap = new Map((subjects ?? []).map((item) => [item.id, item]));
  const programMap = new Map((programs ?? []).map((item) => [item.id, item]));
  const documentMap = new Map((documents ?? []).map((item) => [item.id, item]));
  const progressMap = new Map((progressRows ?? []).map((item) => [`${item.assignment_id}:${item.document_id}`, item]));
  const exportMap = new Map((exportRows ?? []).map((item) => [item.assignment_id, item]));
  const lastActivityMap = new Map<string, string>();
  for (const event of eventRows ?? []) if (event.assignment_id && !lastActivityMap.has(event.assignment_id)) lastActivityMap.set(event.assignment_id, event.occurred_at);
  const blockCounts = new Map<string, number>();
  for (const block of blocks ?? []) blockCounts.set(block.document_id, (blockCounts.get(block.document_id) ?? 0) + 1);
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
      const lastActivityAt = lastActivityMap.get(assignment.id) ?? null;
      let attention: string | null = null;
      if (new Date(assignment.ends_at).getTime() < now && !["submitted", "accepted"].includes(assignment.status)) attention = "검수 기한 확인 필요";
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
        period: `${assignment.starts_at.slice(0, 10)} — ${assignment.ends_at.slice(0, 10)}`,
        status: assignment.status,
        documentCount: detailDocuments.length,
        completeDocumentCount: detailDocuments.filter((item) => item.complete).length,
        totalBlocks: detailDocuments.reduce((sum, item) => sum + item.totalBlocks, 0),
        checkedBlocks: detailDocuments.reduce((sum, item) => sum + item.checkedBlocks, 0),
        opinionCount: (annotationRows ?? []).filter((item) => item.assignment_id === assignment.id).length,
        lastActivityAt,
        attention,
        report: exportMap.get(assignment.id) ? { id: (exportMap.get(assignment.id) as any).id, reportId: (exportMap.get(assignment.id) as any).report_id, fileName: (exportMap.get(assignment.id) as any).file_name, sha256: (exportMap.get(assignment.id) as any).sha256, deliveryStatus: (exportMap.get(assignment.id) as any).delivery_status, createdAt: (exportMap.get(assignment.id) as any).created_at, deliveredAt: (exportMap.get(assignment.id) as any).delivered_at } : null,
        documents: detailDocuments
      };
    });
  const { data: expertCatalog } = await admin.from("review_profiles").select("user_id, email, display_name, mobile, organization, department, position_title, role_label, active").eq("role", "reviewer").order("display_name");
  const { data: subjectCatalog } = await admin.from("review_subjects").select("id, program_id, name, sort_order").order("sort_order");
  const { data: programCatalog } = await admin.from("review_programs").select("id, name, sort_order").order("sort_order");
  const { data: documentCatalog } = await admin.from("review_documents").select("id, subject_id, title, kind, version, status").in("status", ["review_ready", "reviewing", "approved"]).order("title");
  return {
    assignments: dashboardAssignments,
    experts: (expertCatalog ?? []).map((item) => ({ id: item.user_id, email: item.email, name: item.display_name, mobile: item.mobile, organization: item.organization, department: item.department, positionTitle: item.position_title, roleLabel: item.role_label, active: item.active })),
    programs: (programCatalog ?? []).map((item) => ({ id: item.id, name: item.name })),
    subjects: (subjectCatalog ?? []).map((item) => ({ id: item.id, programId: item.program_id, name: item.name })),
    documents: (documentCatalog ?? []).map((item) => ({ id: item.id, subjectId: item.subject_id, title: item.title, kind: item.kind, version: item.version, status: item.status })),
    launch: {
      ready: REVIEW_LAUNCH_ENABLED && REVIEW_EMAIL_ENABLED && REVIEW_ACCESS_ENABLED,
      enabled: REVIEW_LAUNCH_ENABLED,
      pendingAssignments: assignments.filter((item) => item.status === "assigned" && !item.notification_sent_at).length
    }
  };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "허용되지 않은 접속 위치입니다." }, 403, origin);

  try {
    const token = bearer(request);
    if (!token) return json({ error: "로그인이 필요합니다." }, 401, origin);
    const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userResult, error: userError } = await auth.auth.getUser(token);
    if (userError || !userResult.user) return json({ error: "로그인 시간이 만료되었습니다." }, 401, origin);
    const userId = userResult.user.id;
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
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

    if (action === "bootstrap") return json(await bootstrap(admin, userId), 200, origin);

    if (action === "managerDashboard") return json(await managerDashboard(admin, userId), 200, origin);

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
        const result = await sendOperationalEmail(email, `[설탕과소금] ${displayName} 전문위원님, 검수 워크룸 이용 안내`, `<div style="font-family:Arial,sans-serif;line-height:1.8;color:#243746"><h2 style="color:#102d4d">${emailHtml(displayName)} 전문위원님, 반갑습니다.</h2><p>유한회사 설탕과소금의 전문위원으로 함께해 주셔서 깊이 감사드립니다.</p><p>과목 위촉이 완료되면 아래 전용 워크룸에서 계약 이메일 인증 후 검수 자료를 확인하실 수 있습니다.</p><p><a href="${emailHtml(REVIEW_APP_URL)}" style="display:inline-block;padding:11px 18px;border-radius:7px;color:#fff;background:#102d4d;text-decoration:none">전문위원 검수 워크룸</a></p><p>문의: admin@gyo6.kr · 010-3534-7163</p></div>`, `expert-invite-${expertUserId}`);
        invitationSent = result.sent;
      } else {
        const { data: targetProfile, error: targetProfileError } = await admin.from("review_profiles").select("role").eq("user_id", expertUserId).single();
        if (targetProfileError || targetProfile?.role !== "reviewer") throw new Error("전문위원 계정만 이 화면에서 변경할 수 있습니다.");
        const { error: authUpdateError } = await admin.auth.admin.updateUserById(expertUserId, { email, user_metadata: { display_name: displayName, role: "reviewer" } });
        if (authUpdateError) throw new Error("전문위원 계정 정보를 갱신하지 못했습니다.");
      }
      const { error: profileError } = await admin.from("review_profiles").upsert({ user_id: expertUserId, email, display_name: displayName, mobile, organization, department, position_title: positionTitle, role: "reviewer", role_label: "외부 전문위원", active: payload.active !== false }, { onConflict: "user_id" });
      if (profileError) throw profileError;
      await admin.from("review_events").insert({ reviewer_user_id: userId, event_type: requestedId ? "expert_profile_updated" : "expert_profile_created", payload: { expertUserId, email, invitationSent } });
      return json({ ok: true, expertUserId, invitationSent }, 200, origin);
    }

    if (action === "managerLaunchAll") {
      const manager = await ensureManager(admin, userId);
      if (manager.role !== "admin") throw new Error("전문위원 일괄 시작은 회사 대표 관리자만 승인할 수 있습니다.");
      if (cleanText(payload.confirmation, 100) !== "전문위원 검수 일괄 시작") throw new Error("일괄 시작 확인 문구가 일치하지 않습니다.");
      if (!REVIEW_LAUNCH_ENABLED || !REVIEW_EMAIL_ENABLED || !REVIEW_ACCESS_ENABLED) throw new Error("서버의 일괄 시작 잠금이 해제되지 않았습니다.");
      const { data: pendingRows, error: pendingError } = await admin.from("review_assignments").select("*").eq("status", "assigned").is("notification_sent_at", null).order("reviewer_user_id");
      if (pendingError) throw pendingError;
      const pending = pendingRows ?? [];
      if (!pending.length) return json({ ok: true, launchedExperts: 0, launchedAssignments: 0 }, 200, origin);
      const now = Date.now();
      if (pending.some((item) => !item.contract_reference || new Date(item.starts_at).getTime() > now || new Date(item.ends_at).getTime() < now)) throw new Error("계약 기준과 현재 검수기간이 확정된 위촉만 일괄 시작할 수 있습니다.");
      const assignmentIds = pending.map((item) => item.id);
      const { data: links, error: linkError } = await admin.from("review_assignment_documents").select("assignment_id, document_id").in("assignment_id", assignmentIds);
      if (linkError) throw linkError;
      if (pending.some((assignment) => !(links ?? []).some((link) => link.assignment_id === assignment.id))) throw new Error("검수 자료가 지정되지 않은 위촉이 있어 일괄 시작을 중단했습니다.");
      const documentIds = [...new Set((links ?? []).map((item) => item.document_id))];
      const { data: launchDocuments, error: launchDocumentError } = await admin.from("review_documents").select("id, version, status").in("id", documentIds).in("status", ["review_ready", "approved"]);
      if (launchDocumentError) throw launchDocumentError;
      if ((launchDocuments ?? []).length !== documentIds.length) throw new Error("교체되었거나 확정되지 않은 검수 자료가 포함되어 있어 일괄 시작을 중단했습니다. 최신 확정본으로 위촉 자료를 다시 지정해 주세요.");
      const launchDocumentMap = new Map((launchDocuments ?? []).map((item) => [item.id, item]));
      if (pending.some((assignment) => new Set((links ?? []).filter((link) => link.assignment_id === assignment.id).map((link) => launchDocumentMap.get(link.document_id)?.version)).size !== 1)) throw new Error("동일 위촉에 서로 다른 원고 버전이 포함되어 있어 일괄 시작을 중단했습니다.");
      const expertIds = [...new Set(pending.map((item) => item.reviewer_user_id))];
      const subjectIds = [...new Set(pending.map((item) => item.subject_id))];
      const { data: experts, error: expertError } = await admin.from("review_profiles").select("user_id, email, display_name, active").in("user_id", expertIds).eq("role", "reviewer");
      if (expertError) throw expertError;
      if ((experts ?? []).length !== expertIds.length || (experts ?? []).some((item) => !item.active)) throw new Error("이용 불가능한 전문위원 계정이 있어 일괄 시작을 중단했습니다.");
      const { data: subjects, error: subjectError } = await admin.from("review_subjects").select("id, program_id, name").in("id", subjectIds);
      if (subjectError) throw subjectError;
      if ((subjects ?? []).length !== subjectIds.length) throw new Error("확인할 수 없는 위촉 과목이 있어 일괄 시작을 중단했습니다.");
      const programIds = [...new Set((subjects ?? []).map((item) => item.program_id))];
      const { data: programs, error: programError } = await admin.from("review_programs").select("id, name").in("id", programIds);
      if (programError) throw programError;
      if ((programs ?? []).length !== programIds.length) throw new Error("확인할 수 없는 검수 사업이 있어 일괄 시작을 중단했습니다.");
      const subjectMap = new Map((subjects ?? []).map((item) => [item.id, item]));
      const programMap = new Map((programs ?? []).map((item) => [item.id, item]));
      let launchedAssignments = 0;
      for (const expert of experts ?? []) {
        const expertAssignments = pending.filter((item) => item.reviewer_user_id === expert.user_id);
        const assignmentList = expertAssignments.map((item) => {
          const subject = subjectMap.get(item.subject_id) as any;
          const program = programMap.get(subject?.program_id) as any;
          const documentCount = (links ?? []).filter((link) => link.assignment_id === item.id).length;
          return `<li><strong>${emailHtml(program?.name ?? "시험 대비")} · ${emailHtml(subject?.name ?? "담당 과목")}</strong><br>${emailHtml(item.title)} · 자료 ${documentCount}건<br>${emailHtml(item.starts_at.slice(0, 10))} ~ ${emailHtml(item.ends_at.slice(0, 10))}</li>`;
        }).join("");
        const stableAssignmentKey = expertAssignments.map((item) => item.id).sort().join("-");
        const notification = await sendOperationalEmail(expert.email, `[설탕과소금] ${expert.display_name} 전문위원님, 검수 워크룸 공식 시작 안내`, `<div style="font-family:Arial,sans-serif;line-height:1.8;color:#243746"><h2 style="color:#102d4d">${emailHtml(expert.display_name)} 전문위원님께</h2><p>귀한 전문성으로 함께해 주셔서 깊이 감사드립니다. 계약과 검수 자료의 최종 확인을 마쳐 공식 검수를 안내드립니다.</p><ul>${assignmentList}</ul><p><a href="${emailHtml(REVIEW_APP_URL)}" style="display:inline-block;padding:11px 18px;border-radius:7px;color:#fff;background:#102d4d;text-decoration:none">전문위원 검수 워크룸 입장</a></p><p>일정이나 자료에 관하여 협의가 필요하시면 언제든 말씀해 주세요.</p><p>유한회사 설탕과소금 드림<br>admin@gyo6.kr · 010-3534-7163</p></div>`, `review-launch-${expert.user_id}-${stableAssignmentKey}`);
        if (!notification.sent) throw new Error(`${expert.display_name} 전문위원님의 시작 안내가 발송되지 않아 일괄 시작을 중단했습니다.`);
        const launchedAt = new Date().toISOString();
        const expertAssignmentIds = expertAssignments.map((item) => item.id);
        const { error: updateError } = await admin.from("review_assignments").update({ notification_sent_at: launchedAt }).in("id", expertAssignmentIds).is("notification_sent_at", null);
        if (updateError) throw updateError;
        await admin.from("review_events").insert({ reviewer_user_id: userId, event_type: "launch_notification_sent", payload: { expertUserId: expert.user_id, assignmentIds: expertAssignmentIds, notificationId: notification.id } });
        launchedAssignments += expertAssignmentIds.length;
      }
      return json({ ok: true, launchedExperts: expertIds.length, launchedAssignments }, 200, origin);
    }

    if (action === "managerSaveAssignment") {
      await ensureManager(admin, userId);
      const requestedId = cleanText(payload.id, 80);
      const expertUserId = cleanText(payload.expertUserId, 80);
      const subjectId = cleanText(payload.subjectId, 80);
      const title = cleanText(payload.title, 300);
      const contractReference = cleanText(payload.contractReference, 500);
      const documentIds: string[] = [...new Set<string>(Array.isArray(payload.documentIds) ? payload.documentIds.map((item: unknown) => cleanText(item, 80)).filter(Boolean) : [])];
      const startsAt = new Date(`${cleanText(payload.startsAt, 10)}T00:00:00+09:00`);
      const endsAt = new Date(`${cleanText(payload.endsAt, 10)}T23:59:59+09:00`);
      if (!expertUserId || !subjectId || !title || !contractReference || !documentIds.length || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) throw new Error("전문위원, 과목, 검수 자료, 계약 기준과 기간을 정확히 입력해 주세요.");
      const { data: expert, error: expertError } = await admin.from("review_profiles").select("user_id, email, display_name, active").eq("user_id", expertUserId).eq("role", "reviewer").single();
      if (expertError || !expert?.active) throw new Error("이용 가능한 전문위원 계정을 확인해 주세요.");
      const { data: subject, error: subjectError } = await admin.from("review_subjects").select("id, program_id, name").eq("id", subjectId).single();
      if (subjectError || !subject) throw new Error("위촉할 과목을 확인해 주세요.");
      const { data: program } = await admin.from("review_programs").select("id, name").eq("id", subject.program_id).single();
      const { data: validDocuments, error: documentError } = await admin.from("review_documents").select("id, title, version, status").eq("subject_id", subjectId).in("id", documentIds).in("status", ["review_ready", "approved"]);
      if (documentError || (validDocuments ?? []).length !== documentIds.length) throw new Error("담당 과목과 일치하는 검수 자료만 지정할 수 있습니다.");
      const selectedVersions = new Set((validDocuments ?? []).map((document) => document.version));
      if (selectedVersions.size !== 1) throw new Error("한 위촉 과제에는 동일한 확정 버전의 검수 자료만 배정할 수 있습니다.");
      let assignmentId = requestedId;
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
        const { error: updateError } = await admin.from("review_assignments").update({ subject_id: subjectId, title, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), contract_reference: contractReference }).eq("id", requestedId);
        if (updateError) throw updateError;
      } else {
        const { data: created, error: createError } = await admin.from("review_assignments").insert({ reviewer_user_id: expertUserId, subject_id: subjectId, title, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), contract_reference: contractReference, status: "assigned" }).select("id").single();
        if (createError || !created) throw new Error("과목 위촉을 저장하지 못했습니다.");
        assignmentId = created.id;
      }
      const { data: currentLinks } = await admin.from("review_assignment_documents").select("document_id").eq("assignment_id", assignmentId);
      const currentIds = new Set((currentLinks ?? []).map((item) => item.document_id));
      const obsoleteIds = [...currentIds].filter((id) => !documentIds.includes(id));
      if (obsoleteIds.length) await admin.from("review_assignment_documents").delete().eq("assignment_id", assignmentId).in("document_id", obsoleteIds);
      const { error: linkError } = await admin.from("review_assignment_documents").upsert(documentIds.map((documentId, index) => ({ assignment_id: assignmentId, document_id: documentId, sort_order: index + 1, visible_from: startsAt.toISOString(), visible_until: endsAt.toISOString() })), { onConflict: "assignment_id,document_id" });
      if (linkError) throw linkError;
      let notification = { sent: false, status: "skipped", id: null as string | null };
      if (payload.sendNotification) {
        notification = await sendOperationalEmail(expert.email, `[설탕과소금] ${expert.display_name} 전문위원님, ${subject.name} 검수 위촉 안내`, `<div style="font-family:Arial,sans-serif;line-height:1.8;color:#243746"><h2 style="color:#102d4d">${emailHtml(expert.display_name)} 전문위원님께</h2><p>귀한 전문성으로 함께해 주셔서 깊이 감사드립니다.</p><p><strong>${emailHtml(program?.name ?? "시험 대비")} · ${emailHtml(subject.name)}</strong> 검수를 정중히 위촉드립니다.</p><ul><li>과제: ${emailHtml(title)}</li><li>기간: ${emailHtml(cleanText(payload.startsAt, 10))} ~ ${emailHtml(cleanText(payload.endsAt, 10))}</li><li>자료: ${documentIds.length}건</li></ul><p><a href="${emailHtml(REVIEW_APP_URL)}" style="display:inline-block;padding:11px 18px;border-radius:7px;color:#fff;background:#102d4d;text-decoration:none">전문위원 검수 워크룸 입장</a></p><p>일정이나 자료에 관하여 협의가 필요하시면 언제든 담당자에게 말씀해 주세요.</p><p>유한회사 설탕과소금 드림<br>admin@gyo6.kr · 010-3534-7163</p></div>`, `assignment-${assignmentId}-${startsAt.toISOString().slice(0,10)}`);
        if (notification.sent) await admin.from("review_assignments").update({ notification_sent_at: new Date().toISOString() }).eq("id", assignmentId);
      }
      await admin.from("review_events").insert({ assignment_id: assignmentId, reviewer_user_id: userId, event_type: requestedId ? "assignment_updated" : "assignment_created", payload: { expertUserId, subjectId, documentIds, notificationStatus: notification.status } });
      return json({ ok: true, assignmentId, notificationSent: notification.sent, notificationStatus: notification.status }, 200, origin);
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
      const { data, error } = await admin.from("review_exports").select("id, report_id, file_name, markdown, sha256, delivery_status").eq("id", exportId).single();
      if (error || !data) throw new Error("표준 검수보고서를 찾지 못했습니다.");
      return json({ reportId: data.report_id, fileName: data.file_name, markdown: data.markdown, sha256: data.sha256, deliveryStatus: data.delivery_status }, 200, origin);
    }

    if (action === "markReportDelivered") {
      await ensureManager(admin, userId);
      const exportId = cleanText(payload.exportId, 80);
      const { data: report, error: reportError } = await admin.from("review_exports").select("id, assignment_id, delivery_status").eq("id", exportId).single();
      if (reportError || !report) throw new Error("표준 검수보고서를 찾지 못했습니다.");
      const deliveredAt = new Date().toISOString();
      const { data: delivered, error } = await admin.from("review_exports").update({ delivery_status: "delivered", delivered_at: deliveredAt }).eq("id", exportId).eq("delivery_status", "ready").select("id").maybeSingle();
      if (error) throw error;
      if (!delivered) throw new Error("이미 처리되었거나 전달 대기 상태가 아닌 보고서입니다.");
      await admin.from("review_events").insert({ assignment_id: report.assignment_id, reviewer_user_id: userId, event_type: "report_delivered", payload: { exportId }, occurred_at: deliveredAt });
      return json({ ok: true, deliveredAt }, 200, origin);
    }

    if (action === "getDocument") {
      const assignmentId = cleanText(payload.assignmentId, 80);
      const documentId = cleanText(payload.documentId, 80);
      await assignmentFor(admin, userId, assignmentId);
      await assertDocumentAccess(admin, assignmentId, documentId);
      const { data: document, error: documentError } = await admin.from("review_documents").select("id, kind, title, version, review_stage").eq("id", documentId).single();
      if (documentError || !document) throw new Error("검수 자료를 찾지 못했습니다.");
      const { data: blocks, error: blockError } = await admin.from("review_blocks").select("id, block_key, heading, body, sort_order").eq("document_id", documentId).order("sort_order");
      if (blockError) throw blockError;
      const { data: annotations } = await admin.from("review_annotations").select("*").eq("assignment_id", assignmentId).eq("document_id", documentId).eq("reviewer_user_id", userId).order("created_at");
      const { data: progress } = await admin.from("review_progress").select("*").eq("assignment_id", assignmentId).eq("document_id", documentId).eq("reviewer_user_id", userId).maybeSingle();
      await admin.from("review_events").insert({ assignment_id: assignmentId, document_id: documentId, reviewer_user_id: userId, event_type: "document_open", payload: {} });
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
        .select("id, assignment_id, reviewer_user_id")
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
      await markAssignmentReviewing(admin, userId, assignmentId);
      return json({ ok: true }, 200, origin);
    }

    if (action === "deleteAnnotation") {
      const assignmentId = cleanText(payload.assignmentId, 80);
      await assignmentFor(admin, userId, assignmentId, true);
      const { error } = await admin.from("review_annotations").delete().eq("id", cleanText(payload.annotationId, 80)).eq("assignment_id", assignmentId).eq("reviewer_user_id", userId);
      if (error) throw error;
      return json({ ok: true }, 200, origin);
    }

    if (action === "saveProgress") {
      const assignmentId = cleanText(payload.assignmentId, 80);
      const documentId = cleanText(payload.documentId, 80);
      await assignmentFor(admin, userId, assignmentId, true);
      await assertDocumentAccess(admin, assignmentId, documentId);
      const progress = payload.progress ?? {};
      const { data: validBlocks } = await admin.from("review_blocks").select("id").eq("document_id", documentId);
      const validIds = new Set((validBlocks ?? []).map((block) => block.id));
      const checkedBlocks = Array.isArray(progress.checkedBlocks) ? progress.checkedBlocks.filter((id: unknown) => validIds.has(String(id))).slice(0, 2000) : [];
      const complete = Boolean(progress.complete) && validIds.size > 0 && checkedBlocks.length === validIds.size;
      const record = { assignment_id: assignmentId, document_id: documentId, reviewer_user_id: userId, checked_blocks: checkedBlocks, memo: cleanText(progress.memo, 10000), complete, completed_at: complete ? progress.completedAt || new Date().toISOString() : null, updated_at: new Date().toISOString() };
      const { error } = await admin.from("review_progress").upsert(record, { onConflict: "assignment_id,document_id,reviewer_user_id" });
      if (error) throw error;
      await markAssignmentReviewing(admin, userId, assignmentId);
      return json({ ok: true }, 200, origin);
    }

    if (action === "submitAssignment") {
      const assignmentId = cleanText(payload.assignmentId, 80);
      await assignmentFor(admin, userId, assignmentId, true);
      const { data: links } = await admin.from("review_assignment_documents").select("document_id").eq("assignment_id", assignmentId);
      const { data: completed } = await admin.from("review_progress").select("document_id, complete").eq("assignment_id", assignmentId).eq("reviewer_user_id", userId).eq("complete", true);
      const completedIds = new Set((completed ?? []).map((item) => item.document_id));
      if ((links ?? []).some((link) => !completedIds.has(link.document_id))) throw new Error("빠짐없는 최종 제출을 위해 검토 완료 확인이 필요한 자료를 살펴봐 주세요.");
      const submittedAt = new Date().toISOString();
      const { data: submitted, error } = await admin.from("review_assignments").update({ status: "submitted", submitted_at: submittedAt }).eq("id", assignmentId).eq("reviewer_user_id", userId).in("status", ["assigned", "reviewing", "returned"]).select("id").maybeSingle();
      if (error) throw error;
      if (!submitted) throw new Error("현재 상태에서는 최종 제출할 수 없습니다. 화면을 새로 확인해 주세요.");
      let report;
      try {
        report = await createReviewReport(admin, userId, assignmentId);
      } catch (reportError) {
        await admin.from("review_assignments").update({ status: "reviewing", submitted_at: null }).eq("id", assignmentId).eq("reviewer_user_id", userId).eq("submitted_at", submittedAt);
        throw reportError;
      }
      return json({ ok: true, reportId: report.reportId, reportSha256: report.sha256, deliveryStatus: report.deliveryStatus }, 200, origin);
    }

    if (action === "exportReport") {
      const assignmentId = cleanText(payload.assignmentId, 80);
      const report = await createReviewReport(admin, userId, assignmentId);
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
