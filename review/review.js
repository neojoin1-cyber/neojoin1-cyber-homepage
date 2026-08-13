"use strict";

if (window.top !== window.self) {
  document.documentElement.innerHTML = '<head><title>접근 제한</title></head><body><p>검수자료는 공식 검수 워크룸에서만 열람할 수 있습니다.</p></body>';
  throw new Error("Embedded review access blocked");
}

const STORAGE_KEY = "sugar-salt-review-workroom-demo-v1";
const AUTH_STORAGE_KEY = "sugar-salt-review-auth-v1";
const AUTH_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const reviewQuery = new URLSearchParams(location.search);
const managerPreviewAssignmentId = reviewQuery.get("managerPreview") || "";
const managerPreviewDocumentId = reviewQuery.get("document") || "";
const managerPreviewFindingId = reviewQuery.get("finding") || "";
const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content?.trim() || "";
const config = {
  supabaseUrl: meta("review-supabase-url").replace(/\/$/, ""),
  anonKey: meta("review-supabase-anon-key")
};
config.production = Boolean(config.supabaseUrl && config.anonKey);
const localDemoAllowed = ["127.0.0.1", "localhost"].includes(location.hostname) && new URLSearchParams(location.search).get("demo") === "1";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const uid = () => crypto.randomUUID?.() || `ann-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const nowIso = () => new Date().toISOString();

const DEMO = {
  reviewer: {
    id: "demo-reviewer",
    name: "김교수",
    email: "professor@example.ac.kr",
    mobile: "010-0000-0000",
    organization: "한국대학교",
    department: "법학과",
    positionTitle: "교수",
    roleLabel: "외부 전문위원"
  },
  assignments: [
    {
      id: "civil-constitution",
      program: { id: "civil", name: "국가직 7급 공무원시험 대비" },
      subject: { id: "constitution", name: "헌법" },
      title: "헌법 핵심노트·모의고사 1차 검수",
      period: "2026. 8. 11. — 8. 19.",
      interimDueAt: "2026-08-15",
      status: "reviewing",
      contractReference: "2026 국가직 7급 공무원시험 대비 핵심요약노트·모의고사 외부 전문위원 검수용역",
      watermarkCode: "CV-CON-260811-A7",
      documents: [
        {
          id: "civil-note-01",
          kind: "핵심노트",
          title: "헌법 기본원리와 기본권",
          version: "v1.2",
          stage: "1차 검수",
          blocks: [
            { id: "cnb-1", heading: "1. 검수 범위", text: "이 화면은 실제 수험 콘텐츠가 아닌 검수 기능 확인용 예시입니다. 전문위원님께서는 사실관계, 최신 법령과 판례의 반영 여부, 수험생이 오해할 가능성이 있는 표현을 중심으로 살펴봐 주시면 됩니다." },
            { id: "cnb-2", heading: "2. 핵심 개념 정리", text: "핵심노트는 긴 설명을 단순히 줄이는 자료가 아니라 시험에서 판단해야 할 기준을 정확하게 구조화한 자료입니다. 중요한 예외와 적용 범위가 빠지지 않았는지 함께 확인해야 합니다." },
            { id: "cnb-3", heading: "3. 최신성 확인", text: "법령·판례·제도 변경이 있는 부분은 변경분만 추가 확인합니다. 기준일 이후의 변경 가능성이 있으면 ‘수정 필요’에서 ‘법령·판례 변경’을 선택하시고 확인이 필요한 근거를 남겨 주세요." }
          ]
        },
        {
          id: "civil-mock-01",
          kind: "모의고사",
          title: "실전 모의고사 제1회",
          version: "v1.0",
          stage: "정답·해설 검수",
          blocks: [
            { id: "cmb-1", heading: "문항 1", text: "다음 설명 중 가장 적절한 것을 고르는 형식의 예시 문항입니다. 실제 검수에서는 문두와 선택지가 하나의 정답을 안정적으로 도출하는지, 복수정답 가능성이 없는지를 확인합니다." },
            { id: "cmb-2", heading: "정답과 해설", text: "정답은 ②번입니다. 해설은 정답의 근거뿐 아니라 나머지 선택지가 틀린 이유를 수험생이 이해할 수 있도록 설명해야 합니다. 문항과 해설 사이의 용어가 일치하는지도 확인합니다." }
          ]
        }
      ]
    },
    {
      id: "elementary-integrated",
      program: { id: "elementary", name: "초등교원임용고사 대비" },
      subject: { id: "elementary-integrated", name: "초등 교육과정 통합" },
      title: "초등 교육과정 통합·교직논술 검수",
      period: "2026. 8. 20. — 9. 16.",
      status: "reviewing",
      contractReference: "2026 초등교원임용고사 대비 외부 검수용역",
      watermarkCode: "EL-INT-260820-B3",
      documents: [
        {
          id: "elementary-note-01",
          kind: "핵심노트",
          title: "초등 교육과정 통합 검수 예시",
          version: "v0.9",
          stage: "구조 검수",
          blocks: [
            { id: "enb-1", heading: "교육과정 검수 원칙", text: "교육과정의 성취기준, 교수·학습 방향과 평가 방향이 서로 모순되지 않는지 확인합니다. 현장 적용 경험을 바탕으로 수험생이 실제 수업 장면을 떠올릴 수 있는 표현인지도 살펴봅니다." },
            { id: "enb-2", heading: "교직논술 연계", text: "교직논술은 별도의 판매 상품으로 운영될 수 있으나 통합 검수에서는 초등 교육과정 자료와 논술 답안 구조가 충돌하지 않는지 함께 확인합니다." }
          ]
        }
      ]
    },
    {
      id: "secondary-korean",
      program: { id: "secondary", name: "중등교원임용고사 대비" },
      subject: { id: "korean", name: "국어" },
      title: "중등 국어 전공·교육학논술 검수",
      period: "2026. 8. 20. — 9. 16.",
      status: "reviewing",
      contractReference: "2026 중등교원임용고사 대비 외부 검수용역",
      watermarkCode: "SE-KOR-260820-C9",
      documents: [
        {
          id: "secondary-note-01",
          kind: "전공 핵심노트",
          title: "중등 국어 전공 검수 예시",
          version: "v0.8",
          stage: "1차 검수",
          blocks: [
            { id: "snb-1", heading: "전공 자료 검수", text: "전공 개념과 교육과정 용어가 정확한지, 기출 경향을 과도하게 일반화하지 않았는지 확인합니다. 자료보호를 위해 각 전문위원님께는 위촉된 과목의 자료만 제공됩니다." },
            { id: "snb-2", heading: "교육학논술 연계", text: "교육학논술 검수는 해당 분야 전문위원님께서 별도로 담당하시며, 전공 자료와 함께 제공되는 구성에서는 구매자가 혼동하지 않도록 역할과 범위를 명확히 구분합니다." }
          ]
        }
      ]
    }
  ]
};

const state = {
  mode: "demo",
  token: null,
  refreshToken: null,
  tokenExpiresAt: 0,
  refreshPromise: null,
  reviewer: null,
  assignments: [],
  activeAssignmentId: null,
  activeDocumentId: null,
  annotations: [],
  progress: {},
  filter: "all",
  zoom: 100,
  selection: null,
  editingAnnotationId: null,
  pendingAnnotationKind: null,
  saveJobs: new Map(),
  saveTimers: new Map(),
  savePromises: new Set(),
  remoteDocumentCache: new Map(),
  remoteDocumentPromises: new Map(),
  rememberSession: true,
  reportPreview: null,
  blockViewObserver: null,
  pendingBlockViews: new Map(),
  queuedBlockViews: new Set(),
  recordedBlockViews: new Set(),
  blockViewTimer: null,
  blockViewFlushPromise: null,
  submissionIntegrity: null
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function restoreDemoState() {
  const fallback = { annotations: [], progress: {}, events: [] };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return fallback;
  }
}

function activeAssignment() {
  return state.assignments.find((item) => item.id === state.activeAssignmentId) || state.assignments[0];
}

function activeDocument() {
  return activeAssignment()?.documents?.find((item) => item.id === state.activeDocumentId) || activeAssignment()?.documents?.[0];
}

function progressFor(documentId = state.activeDocumentId) {
  const assignmentProgress = state.progress[state.activeAssignmentId] || {};
  return assignmentProgress[documentId] || { checkedBlocks: [], memo: "", complete: false };
}

function updateProgress(documentId, patch) {
  state.progress[state.activeAssignmentId] ||= {};
  state.progress[state.activeAssignmentId][documentId] = { ...progressFor(documentId), ...patch };
  scheduleSave("progress", { documentId, progress: state.progress[state.activeAssignmentId][documentId] });
}

function maskedEmail(email) {
  const [local = "", domain = ""] = String(email || "").split("@");
  return `${local.slice(0, Math.min(3, local.length))}${local.length > 3 ? "***" : ""}${domain ? `@${domain}` : ""}`;
}

function setSaveStatus(label, className = "") {
  const element = $("#save-status");
  element.textContent = label;
  element.className = `save-status ${className}`.trim();
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2600);
}

function logEvent(type, payload = {}) {
  if (state.mode === "manager-preview") return;
  const event = { type, payload, assignmentId: state.activeAssignmentId, documentId: state.activeDocumentId, occurredAt: nowIso() };
  if (state.mode === "demo") {
    const saved = restoreDemoState();
    saved.events.push(event);
    saved.events = saved.events.slice(-300);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ annotations: state.annotations, progress: state.progress, events: saved.events }));
    return;
  }
  api("logEvent", event).catch(() => {});
}

function persistDemo() {
  const saved = restoreDemoState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ annotations: state.annotations, progress: state.progress, events: saved.events }));
}

function hasPendingSaves() {
  return state.saveJobs.size > 0 || state.savePromises.size > 0;
}

async function runSaveJob(key) {
  const job = state.saveJobs.get(key);
  if (!job) return;
  state.saveJobs.delete(key);
  const timer = state.saveTimers.get(key);
  if (timer) clearTimeout(timer);
  state.saveTimers.delete(key);
  const savePromise = (async () => {
    if (state.mode === "demo") persistDemo();
    else await api("saveProgress", { assignmentId: job.assignmentId, documentId: job.documentId, progress: job.progress });
  })();
  state.savePromises.add(savePromise);
  let saved = false;
  try {
    await savePromise;
    saved = true;
  } catch (error) {
    state.saveJobs.set(key, job);
    setSaveStatus("저장 재시도 필요", "error");
    toast("작성하신 내용을 저장하지 못했습니다. 인터넷 연결을 확인하신 뒤 다시 시도해 주세요.");
    throw error;
  } finally {
    state.savePromises.delete(savePromise);
    if (saved && !hasPendingSaves()) setSaveStatus("모든 내용 저장됨");
  }
}

async function flushPendingSaves() {
  const keys = [...state.saveJobs.keys()];
  if (keys.length) await Promise.all(keys.map((key) => runSaveJob(key)));
  if (state.savePromises.size) await Promise.all([...state.savePromises]);
}

function scheduleSave(kind, payload) {
  setSaveStatus("저장 중…", "saving");
  if (kind !== "progress") return;
  const assignmentId = state.activeAssignmentId;
  const key = `${assignmentId}:${payload.documentId}`;
  state.saveJobs.set(key, { assignmentId, documentId: payload.documentId, progress: clone(payload.progress) });
  const previousTimer = state.saveTimers.get(key);
  if (previousTimer) clearTimeout(previousTimer);
  state.saveTimers.set(key, setTimeout(() => runSaveJob(key).catch(() => {}), 480));
}

function persistAuthSession() {
  if (!state.rememberSession || !state.refreshToken) return;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refreshToken: state.refreshToken, savedAt: Date.now() }));
}

function restoreAuthSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
    if (!saved?.refreshToken || Date.now() - Number(saved.savedAt || 0) > AUTH_MAX_AGE_MS) throw new Error("expired");
    state.refreshToken = saved.refreshToken;
    state.rememberSession = true;
    return true;
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return false;
  }
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  state.token = null;
  state.refreshToken = null;
  state.tokenExpiresAt = 0;
}

function applySession(session) {
  state.token = session.access_token;
  if (session.refresh_token) state.refreshToken = session.refresh_token;
  state.tokenExpiresAt = Date.now() + Math.max(60, Number(session.expires_in) || 3600) * 1000;
  persistAuthSession();
}

async function refreshSession() {
  if (!state.refreshToken) throw new Error("로그인 시간이 만료되었습니다. 다시 로그인해 주세요.");
  if (state.refreshPromise) return state.refreshPromise;
  state.refreshPromise = (async () => {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.anonKey },
      body: JSON.stringify({ refresh_token: state.refreshToken }),
      cache: "no-store",
      credentials: "omit"
    });
    const session = await response.json().catch(() => ({}));
    if (!response.ok || !session.access_token) { clearAuthSession(); throw new Error("로그인 시간이 만료되었습니다. 다시 로그인해 주세요."); }
    applySession(session);
  })();
  try {
    await state.refreshPromise;
  } finally {
    state.refreshPromise = null;
  }
}

async function api(action, payload = {}, retried = false) {
  if (!config.production) throw new Error("Supabase configuration is missing");
  if (state.refreshToken && Date.now() >= state.tokenExpiresAt - 60_000) await refreshSession();
  const response = await fetch(`${config.supabaseUrl}/functions/v1/review-content`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.anonKey,
      Authorization: `Bearer ${state.token}`
    },
    body: JSON.stringify({ action, payload }),
    cache: "no-store",
    credentials: "omit"
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && !retried && state.refreshToken) {
    await refreshSession();
    return api(action, payload, true);
  }
  if (!response.ok) throw new Error(body.error || "요청을 처리하지 못했습니다.");
  return body;
}

async function sendOtp(email) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.anonKey },
    body: JSON.stringify({ email, create_user: false, email_redirect_to: `${location.origin}${location.pathname}` }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("전문위원님께서 계약 시 등록하신 이메일인지 확인해 주세요.");
}

async function verifyOtp(email, token) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.anonKey },
    body: JSON.stringify({ email, token, type: "email" }),
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(body.error_description || "인증번호가 올바르지 않습니다.");
  return body;
}

function sessionFromMagicLink() {
  if (!location.hash) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const error = params.get("error_description");
  const accessToken = params.get("access_token");
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  if (error) throw new Error(error);
  if (!accessToken) return null;
  return {
    access_token: accessToken,
    refresh_token: params.get("refresh_token") || "",
    expires_in: Number(params.get("expires_in")) || 3600
  };
}

async function enterProduction(session) {
  state.mode = managerPreviewAssignmentId ? "manager-preview" : "production";
  applySession(session);
  const bootstrap = await api(managerPreviewAssignmentId ? "managerPreviewBootstrap" : "bootstrap", managerPreviewAssignmentId ? { assignmentId: managerPreviewAssignmentId } : {});
  state.reviewer = bootstrap.reviewer;
  state.assignments = bootstrap.assignments;
  state.progress = bootstrap.progress || {};
  state.activeAssignmentId = state.assignments[0]?.id || null;
  const previewDocumentExists = state.assignments[0]?.documents?.some((document) => document.id === managerPreviewDocumentId);
  state.activeDocumentId = previewDocumentExists ? managerPreviewDocumentId : state.assignments[0]?.documents?.[0]?.id || null;
  if (!state.activeAssignmentId) throw new Error("현재 위촉된 검수 과제가 없습니다. 확인이 필요하시면 담당자에게 말씀해 주세요.");
  await ensureRemoteDocument(state.activeDocumentId);
  enterApp();
  if (state.mode === "manager-preview" && managerPreviewFindingId) {
    requestAnimationFrame(() => focusAnnotation(managerPreviewFindingId));
  }
}

async function resumeProductionSession() {
  if (!restoreAuthSession()) return false;
  await refreshSession();
  await enterProduction({ access_token: state.token, refresh_token: state.refreshToken, expires_in: Math.max(60, Math.floor((state.tokenExpiresAt - Date.now()) / 1000)) });
  return true;
}

async function logout() {
  const token = state.token;
  clearAuthSession();
  if (token) fetch(`${config.supabaseUrl}/auth/v1/logout`, { method: "POST", headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => {});
  location.href = location.pathname;
}

function enterDemo() {
  const saved = restoreDemoState();
  state.mode = "demo";
  state.reviewer = clone(DEMO.reviewer);
  state.assignments = clone(DEMO.assignments);
  state.annotations = saved.annotations;
  state.progress = saved.progress;
  state.activeAssignmentId = state.assignments[0].id;
  state.activeDocumentId = state.assignments[0].documents[0].id;
  enterApp();
  toast("기능 확인용 예시 자료로 입장했습니다. 귀한 검토에 감사드립니다.");
}

function enterApp() {
  window.scrollTo(0, 0);
  $("#login-screen").hidden = true;
  $("#app-shell").hidden = false;
  $("#reviewer-name").textContent = `${state.reviewer.name} ${state.reviewer.roleLabel || "전문위원"}님`;
  $("#reviewer-initial").textContent = state.reviewer.name?.slice(0, 1) || "검";
  if (state.mode === "manager-preview") {
    $("#save-status").textContent = "관리자 읽기 전용 확인";
    $("#assignment-submit").disabled = true;
    $("#interim-submit").disabled = true;
    $("#complete-document").disabled = true;
    $("#document-memo").disabled = true;
    $$('[data-tool],[data-floating-tool]').forEach((button) => button.disabled = true);
  }
  renderAssignmentOptions();
  renderAll();
  updateWatermark();
  prefetchAdjacentDocuments();
  setInterval(updateWatermark, 60000);
  logEvent("workroom_enter");
  logEvent("document_open", { documentId: state.activeDocumentId });
}

async function ensureRemoteDocument(documentId) {
  if (!["production", "manager-preview"].includes(state.mode) || state.remoteDocumentCache.has(documentId)) return;
  const assignmentId = state.activeAssignmentId;
  const cacheKey = `${assignmentId}:${documentId}`;
  if (!state.remoteDocumentPromises.has(cacheKey)) {
    state.remoteDocumentPromises.set(cacheKey, (async () => {
      const result = await api(state.mode === "manager-preview" ? "managerPreviewDocument" : "getDocument", { assignmentId, documentId });
      state.remoteDocumentCache.set(documentId, result.document);
      const assignment = state.assignments.find((item) => item.id === assignmentId);
      if (assignment) assignment.documents = assignment.documents.map((document) => document.id === documentId ? result.document : document);
      state.annotations = state.annotations.filter((annotation) => annotation.documentId !== documentId).concat(result.annotations || []);
      state.progress[assignmentId] ||= {};
      state.progress[assignmentId][documentId] = result.progress || { checkedBlocks: [], memo: "", complete: false };
    })().finally(() => state.remoteDocumentPromises.delete(cacheKey)));
  }
  await state.remoteDocumentPromises.get(cacheKey);
}

function prefetchAdjacentDocuments(documentId = state.activeDocumentId) {
  if (state.mode !== "production") return;
  const documents = activeAssignment()?.documents || [];
  const index = documents.findIndex((document) => document.id === documentId);
  const candidates = [documents[index + 1]?.id, documents[index - 1]?.id].filter(Boolean);
  const run = () => candidates.forEach((id) => ensureRemoteDocument(id).catch(() => {}));
  setTimeout(() => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 1200 });
    else run();
  }, 650);
}

function renderAssignmentOptions() {
  const select = $("#assignment-select");
  select.innerHTML = state.assignments.map((assignment) => `<option value="${escapeHtml(assignment.id)}">${escapeHtml(assignment.program.name)} · ${escapeHtml(assignment.subject.name)}</option>`).join("");
  select.value = state.activeAssignmentId;
}

function renderAll() {
  renderAssignmentHeader();
  renderDocumentList();
  renderDocument();
  renderAnnotations();
  renderProgress();
}

function renderAssignmentHeader() {
  const assignment = activeAssignment();
  if (!assignment) return;
  $("#program-badge").textContent = assignment.program.name;
  $("#assignment-title").textContent = assignment.title;
  $("#assignment-period").textContent = `검수기간 ${assignment.period}${assignment.interimDueAt ? ` · 1차 중간보고 ${assignment.interimDueAt}` : ""}`;
  $("#interim-submit").disabled = assignment.status === "submitted" || Boolean(assignment.interimSubmittedAt);
  $("#interim-submit").textContent = assignment.interimSubmittedAt ? "1차 중간보고 제출 완료" : "1차 중간보고 제출";
  $("#assignment-submit").disabled = assignment.status === "submitted";
  $("#assignment-submit").textContent = assignment.status === "submitted" ? "최종 검수의견 제출 완료" : "최종 검수의견 제출";
  const receipt = $("#report-receipt");
  if (assignment.report) {
    receipt.hidden = false;
    receipt.textContent = `접수 완료 · 보고서 ${assignment.report.reportId} · 무결성 ${String(assignment.report.sha256 || "").slice(0, 12)}… · ${assignment.report.deliveryStatus === "delivered" ? "교재 제작 시스템 전달 완료" : "관리자 인계 대기"}`;
  } else {
    receipt.hidden = true;
    receipt.textContent = "";
  }
}

function renderDocumentList() {
  const assignment = activeAssignment();
  $("#document-list").innerHTML = assignment.documents.map((document, index) => {
    const progress = progressFor(document.id);
    return `<button class="document-button ${document.id === state.activeDocumentId ? "active" : ""}" data-document-id="${escapeHtml(document.id)}" type="button">
      <span class="document-number">${String(index + 1).padStart(2, "0")}</span>
      <span class="document-copy"><strong>${escapeHtml(document.title)}</strong><small>${escapeHtml(document.kind)} · ${escapeHtml(document.version || "")}</small></span>
      <span class="document-state ${progress.complete ? "done" : ""}">${progress.complete ? "✓" : "○"}</span>
    </button>`;
  }).join("");
}

function annotationsForDocument(documentId = state.activeDocumentId) {
  return state.annotations.filter((annotation) => annotation.assignmentId === state.activeAssignmentId && annotation.documentId === documentId);
}

function annotatedText(block) {
  const annotations = annotationsForDocument().filter((annotation) => annotation.blockId === block.id && Number.isInteger(annotation.startOffset) && Number.isInteger(annotation.endOffset));
  if (!annotations.length) return escapeHtml(block.text);
  const points = new Set([0, block.text.length]);
  annotations.forEach((annotation) => {
    points.add(Math.max(0, Math.min(block.text.length, annotation.startOffset)));
    points.add(Math.max(0, Math.min(block.text.length, annotation.endOffset)));
  });
  const sorted = [...points].sort((a, b) => a - b);
  const priority = { issue: 3, memo: 2, highlight: 1 };
  return sorted.slice(0, -1).map((start, index) => {
    const end = sorted[index + 1];
    const text = escapeHtml(block.text.slice(start, end));
    const active = annotations.filter((annotation) => annotation.startOffset < end && annotation.endOffset > start).sort((a, b) => priority[b.kind] - priority[a.kind]);
    if (!active.length) return text;
    const main = active[0];
    return `<span class="annotation-mark" data-annotation-id="${escapeHtml(main.id)}" data-kind="${escapeHtml(main.kind)}" data-color="${escapeHtml(main.color || "yellow")}">${text}</span>`;
  }).join("");
}

function normalizedBlockHeading(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseTableHeading(value = "") {
  const match = normalizedBlockHeading(value).match(/^\[\[REVIEW_TABLE_V1\|(\d+)\|(\d+)\|(\d+)\|([HD])(?:\|(\d+)\|(\d+))?\]\](.*)$/);
  if (!match) return null;
  return {
    tableIndex: Number(match[1]),
    rowIndex: Number(match[2]),
    columnIndex: Number(match[3]),
    isHeader: match[4] === "H",
    colspan: Math.max(1, Number(match[5] || 1)),
    rowspan: Math.max(1, Number(match[6] || 1)),
    heading: match[7].trim() || "표 검수 내용",
  };
}

function groupConsecutiveBlocks(blocks = []) {
  return blocks.reduce((groups, block) => {
    const table = parseTableHeading(block.heading);
    if (table) {
      const key = `table:${table.tableIndex}:${table.heading}`;
      const previous = groups.at(-1);
      const cell = { ...table, block };
      if (previous?.key === key) {
        previous.cells.push(cell);
        return groups;
      }
      groups.push({ type: "table", key, heading: table.heading, tableIndex: table.tableIndex, cells: [cell] });
      return groups;
    }
    const heading = normalizedBlockHeading(block.heading) || "세부 검수 내용";
    const previous = groups.at(-1);
    if (previous?.type !== "table" && previous?.key === heading) {
      previous.blocks.push(block);
      return groups;
    }
    groups.push({ type: "text", key: heading, heading, blocks: [block] });
    return groups;
  }, []);
}

function renderGroupedBlock(block, progress) {
  const checked = progress.checkedBlocks?.includes(block.id);
  return `<article class="review-block" data-block-id="${escapeHtml(block.id)}" role="listitem">
    <p class="review-block-text" data-block-id="${escapeHtml(block.id)}">${annotatedText(block)}</p>
    <button class="block-check ${checked ? "checked" : ""}" data-check-block="${escapeHtml(block.id)}" type="button" aria-label="${checked ? "확인 완료" : "이 항목 확인"}">${checked ? "✓ 확인됨" : "확인"}</button>
  </article>`;
}

function renderTableGroup(group, progress) {
  const rows = new Map();
  group.cells.forEach((cell) => {
    if (!rows.has(cell.rowIndex)) rows.set(cell.rowIndex, []);
    rows.get(cell.rowIndex).push(cell);
  });
  const tableRows = [...rows.entries()].sort(([a], [b]) => a - b).map(([, cells]) => {
    const ordered = [...cells].sort((a, b) => a.columnIndex - b.columnIndex);
    const blockIds = ordered.map(({ block }) => block.id);
    const checked = blockIds.every((id) => progress.checkedBlocks?.includes(id));
    const columns = ordered.map((cell) => {
      const tag = cell.isHeader ? "th" : "td";
      return `<${tag} class="review-table-cell" data-block-id="${escapeHtml(cell.block.id)}" colspan="${cell.colspan}" rowspan="${cell.rowspan}" ${cell.isHeader ? 'scope="col"' : ""}>
        <span class="review-block-text" data-block-id="${escapeHtml(cell.block.id)}">${annotatedText(cell.block)}</span>
      </${tag}>`;
    }).join("");
    return `<tr>${columns}<td class="review-table-confirm"><button class="block-check ${checked ? "checked" : ""}" data-check-blocks="${escapeHtml(blockIds.join(","))}" type="button" aria-label="${checked ? "이 행 확인 완료" : "이 행 확인"}">${checked ? "✓ 확인됨" : "행 확인"}</button></td></tr>`;
  }).join("");
  return `<section class="review-block-group review-table-group">
    <header class="review-block-group-head">
      <h3>${escapeHtml(group.heading)}</h3>
      <span>원문 표 · ${rows.size}행</span>
    </header>
    <div class="review-data-table-wrap" role="region" aria-label="${escapeHtml(group.heading)} 표" tabindex="0">
      <table class="review-data-table"><tbody>${tableRows}</tbody></table>
    </div>
  </section>`;
}

function renderDocument() {
  const document = activeDocument();
  if (!document?.blocks) return;
  $("#document-kind").textContent = document.kind;
  $("#document-title").textContent = document.title;
  $("#document-version").textContent = document.version || "";
  $("#document-stage").textContent = document.stage || "검수";
  const progress = progressFor();
  $("#document-memo").value = progress.memo || "";
  $("#complete-document").textContent = progress.complete ? "✓ 이 자료의 검토를 마쳤습니다" : "이 자료의 검토를 마쳤습니다";
  $("#complete-document").classList.toggle("primary", !progress.complete);
  $("#document-content").innerHTML = groupConsecutiveBlocks(document.blocks).map((group) => group.type === "table" ? renderTableGroup(group, progress) : `<section class="review-block-group">
    <header class="review-block-group-head">
      <h3>${escapeHtml(group.heading)}</h3>
      ${group.blocks.length > 1 ? `<span>${group.blocks.length}개 검수 항목</span>` : ""}
    </header>
    <div class="review-block-list" role="list">
      ${group.blocks.map((block) => renderGroupedBlock(block, progress)).join("")}
    </div>
  </section>`).join("");
  const index = activeAssignment().documents.findIndex((item) => item.id === document.id);
  $("#previous-document").disabled = index <= 0;
  $("#next-document").disabled = index >= activeAssignment().documents.length - 1;
  applyReaderScale();
  observeReviewBlocks();
}

function observeReviewBlocks() {
  state.blockViewObserver?.disconnect();
  if (state.mode === "manager-preview" || !("IntersectionObserver" in window)) return;
  const assignmentId = state.activeAssignmentId;
  const documentId = state.activeDocumentId;
  state.blockViewObserver = new IntersectionObserver((entries) => {
    entries.filter((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.55).forEach((entry) => {
      const blockId = entry.target.dataset.blockId;
      if (!blockId) return;
      const key = `${assignmentId}:${documentId}`;
      const viewKey = `${key}:${blockId}`;
      if (state.queuedBlockViews.has(viewKey) || state.recordedBlockViews.has(viewKey)) {
        state.blockViewObserver.unobserve(entry.target);
        return;
      }
      if (!state.pendingBlockViews.has(key)) state.pendingBlockViews.set(key, new Set());
      state.pendingBlockViews.get(key).add(blockId);
      state.queuedBlockViews.add(viewKey);
      state.blockViewObserver.unobserve(entry.target);
    });
    scheduleBlockViewFlush();
  }, { root: $("#review-reader"), threshold: [0.55] });
  $$("#document-content [data-block-id]").forEach((element) => state.blockViewObserver.observe(element));
}

function scheduleBlockViewFlush() {
  clearTimeout(state.blockViewTimer);
  state.blockViewTimer = setTimeout(() => flushBlockViews().catch(() => {}), 900);
}

async function flushBlockViews() {
  clearTimeout(state.blockViewTimer);
  state.blockViewTimer = null;
  if (state.blockViewFlushPromise) {
    await state.blockViewFlushPromise;
    if (state.pendingBlockViews.size) return flushBlockViews();
    return;
  }
  const batches = [...state.pendingBlockViews.entries()];
  state.pendingBlockViews.clear();
  if (state.mode !== "production" || !batches.length) return;
  state.blockViewFlushPromise = Promise.all(batches.map(async ([key, ids]) => {
    const [assignmentId, documentId] = key.split(":");
    try {
      await api("recordBlockViews", { assignmentId, documentId, blockIds: [...ids] });
      ids.forEach((id) => {
        state.recordedBlockViews.add(`${key}:${id}`);
        state.queuedBlockViews.delete(`${key}:${id}`);
      });
    } catch (error) {
      ids.forEach((id) => state.queuedBlockViews.delete(`${key}:${id}`));
      throw error;
    }
  }));
  try {
    await state.blockViewFlushPromise;
  } finally {
    state.blockViewFlushPromise = null;
  }
  if (state.pendingBlockViews.size) await flushBlockViews();
}

async function recordBlockChecks(blockIds, assignmentId, documentId) {
  if (state.mode !== "production" || !blockIds.length) return;
  try {
    await flushBlockViews();
    await api("recordBlockChecks", { assignmentId, documentId, blockIds, bulkCount: blockIds.length });
  } catch {
    toast("확인 시각 기록을 저장하지 못했습니다. 확인 표시는 보존되며 제출 전 다시 점검합니다.");
  }
}

function readerBaseFontSize() {
  const width = window.innerWidth || 1280;
  if (document.body.classList.contains("focus-mode")) {
    if (width >= 2400) return 21;
    if (width >= 1800) return 19.5;
    if (width >= 1440) return 18;
  }
  if (width >= 2000) return 18;
  if (width >= 1600) return 17;
  return 16;
}

function applyReaderScale() {
  $("#review-paper")?.style.setProperty("--reader-font-size", `${readerBaseFontSize() * state.zoom / 100}px`);
}

function setFocusMode(enabled) {
  document.body.classList.toggle("focus-mode", enabled);
  const button = $("#focus-mode");
  button.setAttribute("aria-pressed", String(enabled));
  button.setAttribute("aria-label", enabled ? "기본 검수 화면으로 돌아가기" : "큰 화면 검수 시작");
  button.setAttribute("title", enabled ? "좌우 메뉴가 있는 기본 검수 화면으로 돌아갑니다" : "좌우 메뉴를 숨기고 원고를 화면 가득 크게 봅니다");
  applyReaderScale();
  hideSelectionPopover(true);
  toast(enabled
    ? "큰 화면 검수를 시작했습니다. 원고와 검수 도구만 화면 가득 표시합니다."
    : "기본 검수 화면으로 돌아왔습니다.");
}

function annotationLabel(annotation) {
  if (annotation.kind === "issue") return annotation.issueType || "수정 필요";
  if (annotation.kind === "memo") return "전문 의견";
  return `${{ yellow: "노랑", green: "초록", pink: "분홍" }[annotation.color] || "노랑"} 형광펜`;
}

function reportValue(value = "") {
  return String(value ?? "").replace(/\r?\n/g, " ").trim();
}

function reportFilePart(value = "report") {
  return reportValue(value).replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "_").slice(0, 80) || "report";
}

function severityLabel(value) {
  return { critical: "필수 수정", major: "중요 보완", minor: "권고" }[value] || "해당 없음";
}

function buildDemoReviewReport() {
  const assignment = activeAssignment();
  const generatedAt = nowIso();
  const reportId = `REVIEW-${reportFilePart(assignment.id).toUpperCase()}-${generatedAt.replace(/\D/g, "").slice(0, 14)}`;
  const assignmentAnnotations = state.annotations.filter((item) => item.assignmentId === assignment.id);
  const completedDocuments = assignment.documents.filter((document) => progressFor(document.id).complete).length;
  const findings = assignmentAnnotations.filter((item) => item.kind !== "highlight");
  const lines = [
    "---",
    "schema: sugar-salt-expert-review/v1",
    `report_id: ${JSON.stringify(reportId)}`,
    `status: ${assignment.status === "submitted" ? "final" : "draft"}`,
    `generated_at: ${JSON.stringify(generatedAt)}`,
    `assignment_id: ${JSON.stringify(assignment.id)}`,
    `program: ${JSON.stringify(assignment.program.name)}`,
    `subject: ${JSON.stringify(assignment.subject.name)}`,
    `reviewer_name: ${JSON.stringify(state.reviewer.name)}`,
    `reviewer_email: ${JSON.stringify(state.reviewer.email)}`,
    `reviewer_mobile: ${JSON.stringify(state.reviewer.mobile || "")}`,
    `reviewer_organization: ${JSON.stringify(state.reviewer.organization || "")}`,
    `reviewer_department: ${JSON.stringify(state.reviewer.department || "")}`,
    `reviewer_position: ${JSON.stringify(state.reviewer.positionTitle || "")}`,
    `document_count: ${assignment.documents.length}`,
    `completed_document_count: ${completedDocuments}`,
    `finding_count: ${findings.length}`,
    "---",
    "",
    "# 핵심요약노트·모의고사 표준 검수의견 보고서",
    "",
    `- 발행기관: 유한회사 설탕과소금 · ${assignment.program.id === "civil" ? "공직시험 연구소" : "교원임용 연구"}`,
    `- 보고서 번호: ${reportId}`,
    `- 위촉 검수과제: ${assignment.title}`,
    `- 검수분야: ${assignment.program.name} / ${assignment.subject.name}`,
    `- 용역 기준: ${assignment.contractReference || "외부 전문위원 검수용역"}`,
    `- 검수기간: ${assignment.period}`,
    `- 작성상태: ${assignment.status === "submitted" ? "최종 제출" : "작성 중 초안"}`,
    "",
    "## 1. 전문위원 기본 정보",
    "",
    "| 구분 | 내용 |",
    "|---|---|",
    `| 성명 | ${reportValue(state.reviewer.name)} |`,
    `| 역할 | ${reportValue(state.reviewer.roleLabel || "외부 전문위원")} |`,
    `| 소속·부서 | ${reportValue(state.reviewer.organization)} ${reportValue(state.reviewer.department)} |`,
    `| 직위 | ${reportValue(state.reviewer.positionTitle)} |`,
    `| 이메일 | ${reportValue(state.reviewer.email)} |`,
    `| 휴대전화 | ${reportValue(state.reviewer.mobile)} |`,
    "",
    "## 2. 검수 목적·범위·기준",
    "",
    "- 목적: 위촉 범위의 핵심요약노트·모의고사 원고에 대하여 사실관계, 최신 법령·판례·정책자료, 정답 및 해설의 타당성을 확인합니다.",
    `- 범위: ${reportValue(assignment.subject.name)} 담당 원고 ${assignment.documents.length}건`,
    "- 기준: 원문 위치와 인용문을 보존하여 의견을 기록하고, 필수 수정·중요 보완·권고를 구분합니다.",
    "",
    "## 3. 검수 결과 요약",
    "",
    `- 자료 ${assignment.documents.length}건 중 ${completedDocuments}건 검수 확인`,
    `- 수정·보완 의견 ${findings.length}건, 참고 표시 ${assignmentAnnotations.filter((item) => item.kind === "highlight").length}건`,
    ""
  ];
  assignment.documents.forEach((document, documentIndex) => {
    const progress = progressFor(document.id);
    const annotations = assignmentAnnotations.filter((item) => item.documentId === document.id);
    const blockMap = new Map((document.blocks || []).map((block) => [block.id, block]));
    lines.push(
      `## ${documentIndex + 4}. ${reportValue(document.kind)} — ${reportValue(document.title)}`,
      "",
      `- 문서 ID: ${document.id}`,
      `- 버전·단계: ${reportValue(document.version)} / ${reportValue(document.stage)}`,
      `- 검수 확인: ${progress.complete ? `완료 (${reportValue(progress.completedAt || generatedAt)})` : "미완료"}`,
      `- 자료 전체 의견: ${reportValue(progress.memo) || "별도 의견 없음"}`,
      ""
    );
    if (!annotations.length) {
      lines.push("이 자료에 등록된 세부 의견이 없습니다.", "");
      return;
    }
    annotations.forEach((annotation, index) => {
      const block = blockMap.get(annotation.blockId);
      lines.push(
        `### ${documentIndex + 1}-${index + 1}. ${reportValue(annotationLabel(annotation))}`,
        "",
        `- 의견 ID: ${annotation.id}`,
        `- 위치: ${reportValue(block?.heading || annotation.blockId)} (문자 ${annotation.startOffset}–${annotation.endOffset})`,
        `- 분류: ${reportValue(annotation.kind)}${annotation.issueType ? ` / ${reportValue(annotation.issueType)}` : ""}`,
        `- 중요도: ${severityLabel(annotation.severity)}`,
        `- 원문 인용: “${reportValue(annotation.selectedText)}”`,
        `- 전문 검수의견·수정 제안: ${reportValue(annotation.body) || "참고 표시"}`,
        ""
      );
    });
  });
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
  return {
    reportId,
    fileName: `${reportFilePart(assignment.program.name)}_${reportFilePart(assignment.subject.name)}_${reportFilePart(state.reviewer.name)}_검수보고서.html`,
    markdown: lines.join("\n"),
    json: {
      schema: "sugar-salt-expert-review/v1",
      reportId,
      status: assignment.status === "submitted" ? "final" : "draft",
      generatedAt,
      company: { name: "유한회사 설탕과소금", unit: assignment.program.id === "civil" ? "공직시험 연구소" : "교원임용 연구" },
      reviewer: { ...state.reviewer },
      assignment: { id: assignment.id, program: assignment.program.name, subject: assignment.subject.name, title: assignment.title, contractReference: assignment.contractReference, period: assignment.period, status: assignment.status },
      summary: {
        documentCount: assignment.documents.length,
        completedDocumentCount: completedDocuments,
        totalBlockCount: assignment.documents.reduce((sum, document) => sum + (document.blocks?.length || 0), 0),
        checkedBlockCount: assignment.documents.reduce((sum, document) => sum + (progressFor(document.id).checkedBlocks?.length || 0), 0),
        findingCount: findings.length,
        referenceMarkCount: assignmentAnnotations.filter((item) => item.kind === "highlight").length,
        criticalCount: findings.filter((item) => item.kind === "issue" && item.severity === "critical").length,
        majorCount: findings.filter((item) => item.kind === "issue" && item.severity === "major").length,
        minorCount: findings.filter((item) => item.kind === "issue" && item.severity === "minor").length,
        professionalOpinionCount: findings.filter((item) => item.kind === "memo").length
      },
      documents: assignment.documents.map((document) => {
        const progress = progressFor(document.id);
        const blockMap = new Map((document.blocks || []).map((block) => [block.id, block]));
        return {
          id: document.id,
          kind: document.kind,
          title: document.title,
          version: document.version,
          stage: document.stage,
          complete: progress.complete,
          completedAt: progress.completedAt,
          totalBlockCount: document.blocks?.length || 0,
          checkedBlockCount: progress.checkedBlocks?.length || 0,
          overallMemo: progress.memo || "",
          findings: assignmentAnnotations.filter((item) => item.documentId === document.id).map((item) => ({
            id: item.id,
            blockId: item.blockId,
            kind: item.kind,
            location: blockMap.get(item.blockId)?.heading || item.blockId,
            issueType: item.issueType,
            severity: item.severity,
            selectedText: item.selectedText,
            reviewerComment: item.body
          }))
        };
      })
    }
  };
}

function downloadFile(fileName, contents, type = "text/html;charset=utf-8") {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportStatusLabel(status) { return status === "final" ? "최종 제출" : status === "interim" ? "1차 중간보고" : "검토 중 초안"; }
function reportDate(value) { const date = new Date(value || ""); return Number.isNaN(date.getTime()) ? escapeHtml(value || "—") : new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "short", hour12: false }).format(date); }

function humanReportMarkup(payload, { editable = false } = {}) {
  const summary = payload.summary || {}, reviewer = payload.reviewer || {}, assignment = payload.assignment || {}, documents = payload.documents || [];
  const integrity = payload.integrity || {};
  const actionable = documents.flatMap((document) => (document.findings || []).filter((finding) => finding.kind !== "highlight"));
  const critical = actionable.filter((finding) => finding.kind === "issue" && finding.severity === "critical").length;
  const professional = actionable.filter((finding) => finding.kind === "memo").length;
  const documentMarkup = documents.map((document, documentIndex) => {
    const findings = (document.findings || []).filter((finding) => finding.kind !== "highlight");
    return `<article class="report-document"><header><div><h5>${String(documentIndex + 1).padStart(2, "0")} · ${escapeHtml(document.title || "검수 자료")}</h5><small>${escapeHtml(document.kind || "자료")} · ${escapeHtml(document.version || "버전 확인")}</small></div><span>${document.complete ? "검토 완료" : "검토 진행 중"} · 문단 ${Number(document.checkedBlockCount || 0)}/${Number(document.totalBlockCount || 0)}</span></header>
      ${document.overallMemo ? `<p class="report-document-memo"><strong>자료 전체 의견</strong><br>${escapeHtml(document.overallMemo)}</p>` : ""}
      ${findings.length ? findings.map((finding) => `<section class="report-finding" data-severity="${escapeHtml(finding.severity || "memo")}"><header><div class="report-finding-title"><span class="report-finding-badge">${finding.kind === "issue" ? escapeHtml(severityLabel(finding.severity)) : "전문 의견"}</span><strong>${escapeHtml(finding.issueType || finding.location || "전문 검수의견")}</strong></div>${editable ? `<button class="report-edit-source" type="button" data-report-edit="${escapeHtml(finding.id)}" data-report-document="${escapeHtml(document.id)}">원문에서 보완</button>` : ""}</header><small>${escapeHtml(finding.location || "원문 위치")}</small>${finding.selectedText ? `<blockquote class="report-quote">${escapeHtml(finding.selectedText)}</blockquote>` : ""}<p class="report-opinion">${escapeHtml(finding.reviewerComment || "별도 의견 없음")}</p></section>`).join("") : '<div class="report-empty">별도의 수정·전문 의견 없이 검토가 완료된 자료입니다.</div>'}</article>`;
  }).join("");
  const integrityMarkup = `<section class="report-section report-integrity"><header><div><span>03 · REVIEW INTEGRITY</span><h4>검수완전성 확인 기록</h4></div><small>전문위원·대표 동일 기록</small></header><div class="report-summary integrity-report-summary"><article><span>확인 문단</span><strong>${Number(integrity.checkedBlockCount ?? summary.checkedBlockCount ?? 0)}/${Number(integrity.totalBlockCount ?? summary.totalBlockCount ?? 0)}</strong></article><article class="${integrity.uncheckedBlockCount ? "attention" : ""}"><span>미확인 문단</span><strong>${Number(integrity.uncheckedBlockCount || 0)}</strong><small>약 ${Number(integrity.uncheckedApproxPages || 0)}쪽</small></article><article class="${integrity.suspiciousCount ? "attention" : ""}"><span>속도 주의기록</span><strong>${Number(integrity.suspiciousCount || 0)}</strong></article><article><span>시간판정 불가</span><strong>${Number(integrity.unknownTimingCount || 0)}</strong></article></div><p class="report-document-memo">${escapeHtml(integrity.policyNote || "확인 속도 기록은 부정 판정이 아니라 검수 범위와 완전성을 확인하기 위한 대표 참고자료입니다.")}</p>${(integrity.unchecked || []).length ? `<div class="report-integrity-list"><h5>미확인 위치</h5>${integrity.unchecked.map((item, index) => `<p><b>${index + 1}. ${escapeHtml(item.documentTitle || "검수 자료")}</b><span>${escapeHtml(item.heading || "원문 위치")} · ${Number(item.characterCount || 0)}자</span><small>${escapeHtml(item.excerpt || "")}</small></p>`).join("")}</div>` : ""}${(integrity.suspicious || []).length ? `<div class="report-integrity-list warning"><h5>확인 속도 주의 위치</h5>${integrity.suspicious.map((item, index) => `<p><b>${index + 1}. ${escapeHtml(item.documentTitle || "검수 자료")}</b><span>${escapeHtml(item.heading || "원문 위치")} · ${integrityStatusLabel(item.speedStatus)}</span><small>실제 ${item.elapsedSeconds ?? "기록 없음"}초 / 보수적 예상 ${Number(item.estimatedSeconds || 0)}초</small></p>`).join("")}</div>` : ""}</section>`;
  return `<article class="report-sheet"><header class="report-sheet-header"><div><div class="report-brand">SUGAR &amp; SALT · EXPERT REVIEW</div><h3>핵심요약노트·모의고사<br>표준 검수의견 보고서</h3><p>${escapeHtml(payload.company?.name || "유한회사 설탕과소금")} · ${escapeHtml(payload.company?.unit || "검수 운영")}</p></div><div class="report-seal"><span>OFFICIAL</span><strong>${escapeHtml(assignment.subject || "검수")}</strong></div></header>
    <section class="report-meta"><div><span>보고서 번호</span><strong>${escapeHtml(payload.reportId || "작성 중")}</strong></div><div><span>작성 상태</span><strong>${escapeHtml(reportStatusLabel(payload.status))}</strong></div><div><span>검수 분야</span><strong>${escapeHtml(assignment.program || "")} · ${escapeHtml(assignment.subject || "")}</strong></div><div><span>검수 기간</span><strong>${escapeHtml(assignment.period || "—")}</strong></div><div><span>전문위원</span><strong>${escapeHtml(reviewer.name || "전문위원")} · ${escapeHtml(reviewer.positionTitle || reviewer.roleLabel || "")}</strong></div><div><span>소속</span><strong>${escapeHtml([reviewer.organization, reviewer.department].filter(Boolean).join(" ") || "—")}</strong></div><div><span>위촉 과제</span><strong>${escapeHtml(assignment.title || "—")}</strong></div><div><span>생성 일시</span><strong>${reportDate(payload.generatedAt)}</strong></div></section>
    <section class="report-summary"><article><span>검수 자료</span><strong>${Number(summary.completedDocumentCount || 0)}/${Number(summary.documentCount || documents.length)}</strong></article><article><span>확인 문단</span><strong>${Number(summary.checkedBlockCount || 0)}/${Number(summary.totalBlockCount || 0)}</strong></article><article class="${critical ? "attention" : ""}"><span>수정·보완 의견</span><strong>${Number(summary.findingCount ?? actionable.length)}</strong></article><article><span>전문 의견</span><strong>${Number(summary.professionalOpinionCount ?? professional)}</strong></article></section>
    <section class="report-section"><header><div><span>01 · REVIEW SCOPE</span><h4>검수 목적과 기준</h4></div><small>전문위원 위촉 범위에 한함</small></header><p class="report-document-memo">위촉 범위의 핵심요약노트·모의고사 원고에 대하여 사실관계, 최신 법령·판례·정책자료, 정답 및 해설의 타당성을 확인하고 원문 위치와 함께 전문 의견을 기록했습니다.</p></section>
    <section class="report-section"><header><div><span>02 · REVIEW FINDINGS</span><h4>자료별 검수결과</h4></div><small>수정 필요·전문 의견 원문 보존</small></header>${documentMarkup || '<div class="report-empty">검수 자료를 불러오지 못했습니다.</div>'}</section>${integrityMarkup}
    <section class="report-confirmation"><strong>전문위원 확인</strong><br>본 보고서는 위촉 범위에서 실제로 확인하고 기록한 의견을 원문 위치와 함께 정리한 것입니다. 최종 제출 이후에는 회사 대표 확인을 거쳐 교재 제작 시스템으로 전달되며, 전문위원의 원문 의견은 임의로 변경되지 않습니다.</section><footer class="report-footer-brand"><strong>유한회사 설탕과소금</strong><span>공직시험 연구소 · admin@gyo6.kr · https://gyo6.kr</span></footer></article>`;
}

function printableReportHtml(report) {
  const payload = report.json || report.report || {};
  const css = `*{box-sizing:border-box}body{margin:0;padding:32px;color:#263746;background:#eceae4;font-family:"Noto Sans KR",Arial,sans-serif}.report-sheet{width:210mm;max-width:100%;margin:auto;padding:18mm;border-top:5px solid #102d4d;background:#fffefb;box-shadow:0 12px 34px #0002}.report-sheet-header{padding-bottom:18px;display:grid;grid-template-columns:1fr auto;gap:18px;border-bottom:3px solid #102d4d}.report-brand{color:#b2762e;font-size:10px;font-weight:800;letter-spacing:2px}h3{margin:8px 0 5px;color:#102d4d;font-family:Georgia,serif;font-size:30px;line-height:1.3}.report-sheet-header p{margin:0;color:#6a7984;font-size:12px}.report-seal{width:72px;height:72px;display:grid;place-content:center;text-align:center;border:1px solid #cda86d;border-radius:50%;background:#fbf4e8}.report-seal span{color:#b2762e;font-size:8px}.report-seal strong{color:#102d4d;font-size:14px}.report-meta{margin:18px 0;display:grid;grid-template-columns:1fr 1fr;border:1px solid #dedbd3}.report-meta div{padding:10px 12px;display:grid;grid-template-columns:84px 1fr;gap:8px;border-bottom:1px solid #ece8df;font-size:10px}.report-meta div:nth-child(odd){border-right:1px solid #ece8df}.report-meta span{color:#6a7984;font-size:8px;font-weight:800}.report-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.report-summary article{padding:12px;border:1px solid #dedbd3;border-top:3px solid #668878}.report-summary article.attention{border-top-color:#b74b45}.report-summary span{display:block;color:#6a7984;font-size:8px}.report-summary strong{display:block;margin-top:4px;color:#102d4d;font:22px Georgia}.report-section{margin-top:25px}.report-section>header{padding-bottom:8px;display:flex;justify-content:space-between;border-bottom:1px solid #bbb7ae}.report-section>header span{color:#b2762e;font-size:8px}.report-section h4{margin:3px 0;color:#102d4d;font:18px Georgia}.report-section small{font-size:8px}.report-document{margin-top:14px;padding:14px;border:1px solid #dedbd3;break-inside:avoid}.report-document>header{display:flex;justify-content:space-between}.report-document h5{margin:0;color:#102d4d;font-size:13px}.report-document header span{color:#668878;font-size:8px}.report-document-memo{padding:9px 11px;border-left:3px solid #cda86d;background:#faf7f0;font-size:10px;line-height:1.7}.report-finding{margin-top:9px;padding:12px;border:1px solid #e3e0d8;border-left:4px solid #b2762e;break-inside:avoid}.report-finding[data-severity=critical]{border-left-color:#b74b45}.report-finding-title{display:flex;gap:6px}.report-finding-badge{padding:2px 6px;border-radius:99px;background:#faecd8;font-size:8px}.report-quote{margin:8px 0;padding:8px 10px;border-left:2px solid #c9c4ba;background:#f6f5f1;font:10px/1.6 Georgia}.report-opinion{font-size:11px;line-height:1.7;white-space:pre-wrap}.report-empty{padding:20px;text-align:center;font-size:10px}.report-integrity-list{margin-top:10px;padding:12px;border:1px solid #dedbd3;break-inside:avoid}.report-integrity-list.warning{border-left:4px solid #b74b45}.report-integrity-list h5{margin:0 0 6px;color:#102d4d}.report-integrity-list p{margin:0;padding:7px 0;display:grid;gap:2px;border-top:1px solid #ece8df;font-size:9px}.report-integrity-list p:first-of-type{border-top:0}.report-integrity-list span,.report-integrity-list small{color:#6a7984}.report-confirmation{margin-top:25px;padding:15px;border:1px solid #d7c6a7;background:#fbf6ec;font-size:10px;line-height:1.8}.report-footer-brand{margin-top:22px;padding-top:12px;display:flex;justify-content:space-between;border-top:1px solid #cbc7bd;font-size:8px}@page{size:A4;margin:12mm}@media print{body{padding:0;background:#fff}.report-sheet{width:auto;padding:0;border:0;box-shadow:none}}`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(payload.assignment?.subject || "검수")} 표준 검수보고서</title><style>${css}</style></head><body>${humanReportMarkup(payload)}</body></html>`;
}

function saveHumanReport(report) { const payload = report.json || report.report || {}; downloadFile(`${reportFilePart(payload.assignment?.program || "검수")}_${reportFilePart(payload.assignment?.subject || "과목")}_${reportFilePart(payload.reviewer?.name || "전문위원")}_표준_검수보고서.html`, printableReportHtml(report)); }
function printHumanReport(report) { const popup = window.open("", "_blank"); if (!popup) { toast("팝업 차단을 해제한 뒤 다시 시도해 주세요."); return; } popup.opener = null; popup.document.write(printableReportHtml(report)); popup.document.close(); setTimeout(() => { popup.focus(); popup.print(); }, 250); }

async function downloadReviewReport() {
  const button = $("#download-review-report");
  button.disabled = true;
  button.textContent = "보고서 생성 중…";
  try {
    const report = state.mode === "manager-preview"
      ? await api("managerPreviewReport", { assignmentId: state.activeAssignmentId })
      : state.mode === "production"
        ? await api("exportReport", { assignmentId: state.activeAssignmentId })
        : buildDemoReviewReport();
    saveHumanReport(report);
    toast(`공식 검수보고서를 생성했습니다. (${report.reportId})`);
    logEvent("review_report_exported", { reportId: report.reportId });
  } catch (error) {
    toast(error.message || "검수보고서를 생성하지 못했습니다.");
  } finally {
    button.disabled = false;
    button.textContent = "공식 보고서 저장·인쇄";
  }
}

function renderAnnotations() {
  const all = annotationsForDocument();
  const filtered = state.filter === "all" ? all : all.filter((annotation) => annotation.kind === state.filter);
  $("#annotation-count").textContent = String(all.length);
  $("#annotation-list").innerHTML = filtered.length ? filtered.map((annotation) => `<article class="annotation-card" data-kind="${escapeHtml(annotation.kind)}" data-annotation-card="${escapeHtml(annotation.id)}">
    <header><span class="annotation-type">${escapeHtml(annotationLabel(annotation))}</span><span class="annotation-actions">${state.mode === "manager-preview" ? "읽기 전용" : `${annotation.kind !== "highlight" ? `<button type="button" data-edit-annotation="${escapeHtml(annotation.id)}">의견 다듬기</button>` : ""}<button type="button" data-delete-annotation="${escapeHtml(annotation.id)}">표시 지우기</button>`}</span></header>
    <blockquote>${escapeHtml(annotation.selectedText || "표시한 문장")}</blockquote>
    ${annotation.body ? `<p>${escapeHtml(annotation.body)}</p>` : ""}
    ${annotation.kind === "issue" ? `<span class="severity">${escapeHtml({ critical: "필수 수정", major: "중요 보완", minor: "권고" }[annotation.severity] || "검토")}</span>` : ""}
  </article>`).join("") : `<div class="empty-annotations">문장을 선택하시면 형광펜·전문 의견·수정 필요 도구가 바로 표시됩니다.</div>`;
}

function renderProgress() {
  const assignment = activeAssignment();
  const totalBlocks = assignment.documents.reduce((sum, document) => sum + (document.blocks?.length || 0), 0);
  const checkedBlocks = assignment.documents.reduce((sum, document) => sum + (progressFor(document.id).checkedBlocks?.length || 0), 0);
  const completeDocuments = assignment.documents.filter((document) => progressFor(document.id).complete).length;
  const raw = totalBlocks ? Math.round((checkedBlocks / totalBlocks) * 85 + (completeDocuments / assignment.documents.length) * 15) : 0;
  const value = assignment.status === "submitted" ? 100 : Math.min(99, raw);
  $("#progress-label").textContent = `${value}%`;
  $("#progress-bar").value = value;
  $("#progress-bar").textContent = `${value}%`;
}

function updateWatermark() {
  if (!state.reviewer) return;
  const assignment = activeAssignment();
  const stamp = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date());
  const text = `${state.reviewer.name} · ${maskedEmail(state.reviewer.email)} · ${stamp} · ${assignment?.watermarkCode || "REVIEW"}`;
  $("#watermark-layer").innerHTML = Array.from({ length: 12 }, () => `<span>${escapeHtml(text)}</span>`).join("");
}

function textOffset(root, node, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let count = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === node) return count + offset;
    count += walker.currentNode.textContent.length;
  }
  return count;
}

function hideSelectionPopover(clearSelection = false) {
  const popover = $("#selection-popover");
  popover.hidden = true;
  popover.classList.remove("below");
  if (clearSelection) {
    state.selection = null;
    window.getSelection()?.removeAllRanges();
  }
}

function showSelectionPopover(rect) {
  const popover = $("#selection-popover");
  const touchLayout = window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 1024;
  popover.style.visibility = "hidden";
  popover.hidden = false;
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const margin = 8;
  const gap = 12;
  const center = rect.left + rect.width / 2;
  const left = Math.max(margin, Math.min(window.innerWidth - width - margin, center - width / 2));
  let placeBelow = touchLayout;
  let top = placeBelow ? rect.bottom + gap : rect.top - height - gap;
  if (placeBelow && top + height > window.innerHeight - margin) {
    placeBelow = false;
    top = rect.top - height - gap;
  }
  if (!placeBelow && top < 72) {
    placeBelow = true;
    top = rect.bottom + gap;
  }
  top = Math.max(margin, Math.min(window.innerHeight - height - margin, top));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.setProperty("--arrow-left", `${Math.max(18, Math.min(width - 18, center - left))}px`);
  popover.classList.toggle("below", placeBelow);
  popover.style.visibility = "visible";
}

function captureSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const root = range.startContainer.parentElement?.closest(".review-block-text");
  if (!root || !root.contains(range.endContainer)) {
    toast("정확한 위치 기록을 위해 한 문단 안에서 문장을 선택해 주세요.");
    return null;
  }
  const startOffset = textOffset(root, range.startContainer, range.startOffset);
  const endOffset = textOffset(root, range.endContainer, range.endOffset);
  if (endOffset <= startOffset) return null;
  state.selection = {
    blockId: root.dataset.blockId,
    startOffset,
    endOffset,
    selectedText: root.textContent.slice(startOffset, endOffset).trim()
  };
  const rect = range.getBoundingClientRect();
  showSelectionPopover(rect);
  return state.selection;
}

function selectedRangeOrToast() {
  const captured = captureSelection() || state.selection;
  if (!captured?.selectedText) {
    toast("전문 의견을 남기실 문장을 먼저 드래그해 선택해 주세요.");
    return null;
  }
  return captured;
}

async function createAnnotation(kind, options = {}) {
  if (state.mode === "manager-preview") { toast("관리자 확인 화면은 검수 기록을 변경하지 않는 읽기 전용입니다."); return; }
  const selection = selectedRangeOrToast();
  if (!selection) return;
  const annotation = {
    id: uid(),
    assignmentId: state.activeAssignmentId,
    documentId: state.activeDocumentId,
    blockId: selection.blockId,
    kind,
    color: options.color || null,
    startOffset: selection.startOffset,
    endOffset: selection.endOffset,
    selectedText: selection.selectedText,
    body: options.body || "",
    issueType: options.issueType || null,
    severity: options.severity || null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.annotations.push(annotation);
  try {
    if (state.mode === "production") await api("saveAnnotation", { annotation });
    else persistDemo();
    setSaveStatus("모든 내용 저장됨");
    logEvent("annotation_created", { annotationId: annotation.id, kind });
  } catch {
    state.annotations = state.annotations.filter((item) => item.id !== annotation.id);
    setSaveStatus("저장 재시도 필요", "error");
    toast("전문위원님의 의견을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  state.selection = null;
  window.getSelection()?.removeAllRanges();
  hideSelectionPopover();
  renderDocument();
  renderAnnotations();
}

function openAnnotationDialog(kind, annotation = null) {
  const selection = annotation ? annotation : selectedRangeOrToast();
  if (!selection) return;
  state.pendingAnnotationKind = kind;
  state.editingAnnotationId = annotation?.id || null;
  hideSelectionPopover();
  $("#dialog-kicker").textContent = kind === "issue" ? "보완 검토 및 수정 제안" : "전문 검수의견";
  $("#dialog-title").textContent = kind === "issue" ? "권고하시는 수정 방향 남기기" : "선택 문장에 전문 의견 남기기";
  $("#selected-quote").textContent = annotation?.selectedText || state.selection.selectedText;
  $("#issue-fields").hidden = kind !== "issue";
  $("#annotation-body").value = annotation?.body || "";
  $("#issue-type").value = annotation?.issueType || "사실관계 보완";
  $("#issue-severity").value = annotation?.severity || "critical";
  $("#annotation-dialog").showModal();
  setTimeout(() => $("#annotation-body").focus(), 50);
}

async function saveDialogAnnotation(event) {
  event.preventDefault();
  if (state.mode === "manager-preview") return;
  const body = $("#annotation-body").value.trim();
  if (!body) {
    toast("전문위원님의 검수의견을 입력해 주세요.");
    return;
  }
  if (state.editingAnnotationId) {
    const annotation = state.annotations.find((item) => item.id === state.editingAnnotationId);
    annotation.body = body;
    annotation.issueType = state.pendingAnnotationKind === "issue" ? $("#issue-type").value : null;
    annotation.severity = state.pendingAnnotationKind === "issue" ? $("#issue-severity").value : null;
    annotation.updatedAt = nowIso();
    try {
      if (state.mode === "production") await api("saveAnnotation", { annotation });
      else persistDemo();
      setSaveStatus("모든 내용 저장됨");
    } catch {
      setSaveStatus("저장 재시도 필요", "error");
      toast("다듬으신 의견을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    $("#annotation-dialog").close();
    renderAnnotations();
    return;
  }
  const options = { body };
  if (state.pendingAnnotationKind === "issue") {
    options.issueType = $("#issue-type").value;
    options.severity = $("#issue-severity").value;
  }
  $("#annotation-dialog").close();
  await createAnnotation(state.pendingAnnotationKind, options);
}

async function deleteAnnotation(id) {
  if (state.mode === "manager-preview") return;
  const annotation = state.annotations.find((item) => item.id === id);
  if (!annotation || !confirm("선택하신 검수 표시를 지우시겠습니까?")) return;
  try {
    if (state.mode === "production") await api("deleteAnnotation", { assignmentId: state.activeAssignmentId, annotationId: id });
    state.annotations = state.annotations.filter((item) => item.id !== id);
    if (state.mode === "demo") persistDemo();
    renderDocument();
    renderAnnotations();
    logEvent("annotation_deleted", { annotationId: id });
  } catch {
    toast("표시를 지우지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

async function selectDocument(documentId) {
  if (documentId === state.activeDocumentId) return;
  state.selection = null;
  window.getSelection()?.removeAllRanges();
  hideSelectionPopover();
  setSaveStatus("자료 불러오는 중…", "saving");
  try {
    flushPendingSaves().catch(() => {});
    state.activeDocumentId = documentId;
    await ensureRemoteDocument(documentId);
    renderAll();
    setSaveStatus("모든 내용 저장됨");
    $("#review-reader")?.scrollTo?.({ top: 0, behavior: "smooth" });
    logEvent("document_open", { documentId });
    prefetchAdjacentDocuments(documentId);
  } catch {
    setSaveStatus("자료를 불러오지 못함", "error");
    toast("검수 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

async function changeAssignment(assignmentId) {
  state.selection = null;
  window.getSelection()?.removeAllRanges();
  hideSelectionPopover();
  await flushPendingSaves();
  state.activeAssignmentId = assignmentId;
  state.activeDocumentId = activeAssignment().documents[0]?.id;
  await ensureRemoteDocument(state.activeDocumentId);
  renderAll();
  updateWatermark();
  logEvent("assignment_change", { assignmentId });
}

function toggleBlock(blockId) {
  toggleBlocks([blockId]);
}

function toggleBlocks(blockIds) {
  const progress = progressFor();
  const checked = new Set(progress.checkedBlocks || []);
  const allChecked = blockIds.every((blockId) => checked.has(blockId));
  blockIds.forEach((blockId) => allChecked ? checked.delete(blockId) : checked.add(blockId));
  if (!allChecked) recordBlockChecks(blockIds, state.activeAssignmentId, state.activeDocumentId);
  updateProgress(state.activeDocumentId, { checkedBlocks: [...checked] });
  renderDocument();
  renderDocumentList();
  renderProgress();
}

function completeDocument() {
  const document = activeDocument();
  const progress = progressFor();
  if (progress.complete) {
    if (confirm("이 자료를 다시 살펴보시겠습니까? 검토 완료 표시를 해제하겠습니다.")) {
      updateProgress(document.id, { complete: false });
      renderAll();
    }
    return;
  }
  const unchecked = document.blocks.filter((block) => !progress.checkedBlocks?.includes(block.id)).length;
  if (unchecked) {
    toast(`빠짐없는 검토를 위해 아직 확인하지 않은 문단 ${unchecked}개를 살펴봐 주세요.`);
    return;
  }
  updateProgress(document.id, { complete: true, completedAt: nowIso() });
  renderAll();
  toast("이 자료의 검토 완료 기록이 저장되었습니다. 감사합니다.");
  logEvent("document_completed", { documentId: document.id });
}

function localSubmissionIntegrity() {
  const assignment = activeAssignment();
  const unchecked = [];
  const perDocument = assignment.documents.map((document) => {
    const checked = new Set(progressFor(document.id).checkedBlocks || []);
    const missing = (document.blocks || []).filter((block) => !checked.has(block.id));
    missing.forEach((block) => unchecked.push({ documentId: document.id, documentTitle: document.title, blockId: block.id, heading: block.heading, excerpt: String(block.text || "").slice(0, 180), characterCount: String(block.text || "").replace(/\s/g, "").length }));
    return { documentId: document.id, title: document.title, totalBlockCount: document.blocks.length, checkedBlockCount: checked.size, uncheckedBlockCount: missing.length, uncheckedCharacters: missing.reduce((sum, block) => sum + String(block.text || "").replace(/\s/g, "").length, 0) };
  });
  const total = perDocument.reduce((sum, item) => sum + item.totalBlockCount, 0);
  const checked = perDocument.reduce((sum, item) => sum + item.checkedBlockCount, 0);
  const characters = perDocument.reduce((sum, item) => sum + item.uncheckedCharacters, 0);
  return { policyNote: "체험 화면에서는 미확인 범위만 산정합니다.", totalBlockCount: total, checkedBlockCount: checked, uncheckedBlockCount: total - checked, uncheckedCharacterCount: characters, uncheckedApproxPages: Number((characters / 1200).toFixed(1)), suspiciousCount: 0, unknownTimingCount: checked, hasAttention: unchecked.length > 0, perDocument, unchecked, suspicious: [] };
}

function integrityStatusLabel(status) {
  return status === "bulk" ? "일괄 확인" : status === "very_fast" ? "매우 빠른 확인" : "빠른 확인";
}

function renderSubmissionIntegrity(integrity) {
  const issues = Number(integrity.uncheckedBlockCount || 0) + Number(integrity.suspiciousCount || 0) + Number(integrity.unknownTimingCount || 0);
  $("#integrity-summary").innerHTML = `<article><span>전체 문단</span><strong>${Number(integrity.totalBlockCount || 0)}</strong></article><article><span>확인 기록</span><strong>${Number(integrity.checkedBlockCount || 0)}</strong></article><article class="${integrity.uncheckedBlockCount ? "attention" : ""}"><span>미확인</span><strong>${Number(integrity.uncheckedBlockCount || 0)}</strong><small>약 ${Number(integrity.uncheckedApproxPages || 0)}쪽</small></article><article class="${integrity.suspiciousCount || integrity.unknownTimingCount ? "attention" : ""}"><span>속도 주의</span><strong>${Number(integrity.suspiciousCount || 0)}</strong><small>시간판정 불가 ${Number(integrity.unknownTimingCount || 0)}</small></article>`;
  const uncheckedMarkup = (integrity.unchecked || []).map((item, index) => `<button type="button" class="integrity-location" data-integrity-document="${escapeHtml(item.documentId)}" data-integrity-block="${escapeHtml(item.blockId)}"><b>${index + 1}. ${escapeHtml(item.documentTitle)}</b><span>${escapeHtml(item.heading)} · ${Number(item.characterCount || 0)}자</span><small>${escapeHtml(item.excerpt || "")}</small></button>`).join("");
  const suspiciousMarkup = (integrity.suspicious || []).map((item, index) => `<button type="button" class="integrity-location warning" data-integrity-document="${escapeHtml(item.documentId)}" data-integrity-block="${escapeHtml(item.blockId)}"><b>${index + 1}. ${escapeHtml(item.documentTitle)}</b><span>${escapeHtml(item.heading)} · ${integrityStatusLabel(item.speedStatus)}</span><small>실제 ${item.elapsedSeconds ?? "기록 없음"}초 / 보수적 예상 ${Number(item.estimatedSeconds || 0)}초${item.bulkCount > 1 ? ` · ${Number(item.bulkCount)}개 동시 확인` : ""}</small></button>`).join("");
  $("#integrity-details").innerHTML = `${uncheckedMarkup ? `<section><h3>미확인 위치</h3>${uncheckedMarkup}</section>` : ""}${suspiciousMarkup ? `<section><h3>확인 속도 주의 위치</h3>${suspiciousMarkup}</section>` : ""}${integrity.unknownTimingCount ? `<section><h3>시간 판정 불가 기록</h3><p class="integrity-legacy">속도기록 기능 적용 전 또는 화면 노출 기록 없이 확인된 문단 ${Number(integrity.unknownTimingCount)}개입니다. 부정 판정은 하지 않으며 대표 보고서에는 판정 불가로 명시됩니다.</p></section>` : ""}${!issues ? '<div class="integrity-clear">미확인 또는 초고속·일괄 확인 주의기록이 없습니다.</div>' : ""}`;
  $("#integrity-policy").textContent = integrity.policyNote || "확인 속도 기록은 부정 판정이 아니라 대표 확인을 위한 검수완전성 자료입니다.";
  $("#integrity-ack-row").hidden = !issues;
  $("#integrity-ack").checked = false;
  $("#integrity-submit-continue").disabled = Boolean(issues);
}

async function openSubmissionIntegrity() {
  await flushPendingSaves();
  await flushBlockViews();
  const result = state.mode === "production" ? await api("getSubmissionIntegrity", { assignmentId: state.activeAssignmentId }) : { integrity: localSubmissionIntegrity() };
  state.submissionIntegrity = result.integrity;
  renderSubmissionIntegrity(result.integrity);
  $("#submission-integrity-dialog").showModal();
}

async function submitAssignment() {
  if (state.mode === "manager-preview") return;
  const assignment = activeAssignment();
  try { await openSubmissionIntegrity(); } catch (error) { toast(error.message || "검수완전성 기록을 불러오지 못했습니다."); }
}

async function confirmAssignmentSubmission() {
  const assignment = activeAssignment();
  const integrity = state.submissionIntegrity || {};
  const hasAttention = Boolean(integrity.hasAttention);
  if (hasAttention && !$("#integrity-ack").checked) return;
  $("#integrity-submit-continue").disabled = true;
  try {
    await flushPendingSaves();
    const result = state.mode === "production" ? await api("submitAssignment", { assignmentId: assignment.id, integrityAcknowledged: hasAttention }) : { reportId: `DEMO-${Date.now()}`, reportSha256: "demo", deliveryStatus: "ready" };
    assignment.status = "submitted";
    assignment.report = { reportId: result.reportId, sha256: result.reportSha256, deliveryStatus: result.deliveryStatus };
    if (state.mode === "demo") persistDemo();
    renderAssignmentHeader();
    renderProgress();
    const receipt = $("#report-receipt");
    receipt.hidden = false;
    receipt.textContent = `접수 완료 · 보고서 ${result.reportId} · 무결성 ${String(result.reportSha256 || "").slice(0, 12)}… · 관리자 인계 대기`;
    toast("최종 검수보고서가 안전하게 접수되어 관리자 운영관제에 표시되었습니다.");
    logEvent("assignment_submitted");
    $("#submission-integrity-dialog").close();
  } catch (error) {
    $("#integrity-submit-continue").disabled = false;
    toast(error.message || "최종 검수의견을 제출하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

async function submitInterimReport() {
  if (state.mode === "manager-preview") return;
  const assignment = activeAssignment();
  const totalChecked = assignment.documents.reduce((sum, document) => sum + (progressFor(document.id).checkedBlocks?.length || 0), 0);
  if (!totalChecked) {
    toast("1차 중간보고는 실제로 확인하신 문단 기록이 있어야 제출할 수 있습니다.");
    return;
  }
  if (!confirm("현재까지의 실제 검수 진도와 전문 검수의견을 1차 중간보고로 제출하시겠습니까? 제출 후에도 최종 완료일까지 검수를 계속하실 수 있습니다.")) return;
  const button = $("#interim-submit");
  button.disabled = true;
  button.textContent = "중간보고 정리 중…";
  try {
    await flushPendingSaves();
    const result = state.mode === "production"
      ? await api("submitInterimReport", { assignmentId: assignment.id })
      : { submittedAt: nowIso(), reportId: `INTERIM-DEMO-${Date.now()}` };
    assignment.interimSubmittedAt = result.submittedAt || nowIso();
    renderAssignmentHeader();
    toast("1차 중간보고가 운영관제에 안전하게 제출되었습니다. 검수는 계속 진행하실 수 있습니다.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "1차 중간보고 제출";
    toast(error.message || "1차 중간보고를 제출하지 못했습니다.");
  }
}

function focusAnnotation(id) {
  const annotation = state.annotations.find((item) => item.id === id);
  if (!annotation) return;
  const block = $(`[data-block-id="${CSS.escape(annotation.blockId)}"]`);
  block?.scrollIntoView({ behavior: "smooth", block: "center" });
  block?.classList.add("is-target");
  setTimeout(() => block?.classList.remove("is-target"), 1500);
}

function renderReportPreview(report) {
  state.reportPreview = report;
  const sourceEditAvailable = state.mode !== "manager-preview" && activeAssignment()?.status !== "submitted";
  $("#report-preview-content").innerHTML = humanReportMarkup(report.json || report.report || {}, { editable: sourceEditAvailable });
  $("#report-preview-dialog").showModal();
}

async function previewReviewReport() {
  try {
    await flushPendingSaves();
    const report = state.mode === "demo" ? buildDemoReviewReport() : await api(state.mode === "manager-preview" ? "managerPreviewReport" : "exportReport", { assignmentId: state.activeAssignmentId });
    renderReportPreview(report);
  } catch (error) { toast(error.message || "보고서 미리보기를 만들지 못했습니다."); }
}

function bindEvents() {
  $("#demo-entry").addEventListener("click", enterDemo);
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!config.production || localDemoAllowed) {
      toast("현재는 보안 기능 체험 모드입니다. 아래 체험 버튼을 이용해 주세요.");
      return;
    }
    const email = $("#login-email").value.trim();
    const button = $("#login-submit");
    button.disabled = true;
    try {
      await sendOtp(email);
      $("#otp-row").hidden = false;
      $("#login-otp").focus();
      toast("등록된 이메일로 인증번호를 보냈습니다.");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });
  $("#otp-submit").addEventListener("click", async () => {
    const button = $("#otp-submit");
    button.disabled = true;
    try {
      state.rememberSession = $("#remember-login").checked;
      const session = await verifyOtp($("#login-email").value.trim(), $("#login-otp").value.trim());
      await enterProduction(session);
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });
  $("#assignment-select").addEventListener("change", (event) => changeAssignment(event.target.value));
  $("#interim-submit").addEventListener("click", submitInterimReport);
  $("#assignment-submit").addEventListener("click", submitAssignment);
  $("#integrity-dialog-close").addEventListener("click", () => $("#submission-integrity-dialog").close());
  $("#integrity-return").addEventListener("click", () => $("#submission-integrity-dialog").close());
  $("#integrity-ack").addEventListener("change", (event) => { $("#integrity-submit-continue").disabled = !event.target.checked; });
  $("#integrity-submit-continue").addEventListener("click", confirmAssignmentSubmission);
  $("#integrity-details").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-integrity-document]");
    if (!button) return;
    $("#submission-integrity-dialog").close();
    if (button.dataset.integrityDocument !== state.activeDocumentId) await selectDocument(button.dataset.integrityDocument);
    const target = $(`[data-block-id="${CSS.escape(button.dataset.integrityBlock)}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.classList.add("is-target");
    setTimeout(() => target?.classList.remove("is-target"), 1800);
  });
  $("#download-review-report").addEventListener("click", downloadReviewReport);
  $("#preview-review-report").addEventListener("click", previewReviewReport);
  $("#logout-button").addEventListener("click", logout);
  $("#report-preview-close").addEventListener("click", () => $("#report-preview-dialog").close());
  $("#report-preview-confirm").addEventListener("click", () => $("#report-preview-dialog").close());
  $("#report-preview-download").addEventListener("click", () => { if (state.reportPreview) saveHumanReport(state.reportPreview); });
  $("#report-preview-print").addEventListener("click", () => { if (state.reportPreview) printHumanReport(state.reportPreview); });
  $("#report-preview-content").addEventListener("click", async (event) => { const button = event.target.closest("[data-report-edit]"); if (!button) return; $("#report-preview-dialog").close(); const documentId = button.dataset.reportDocument; if (documentId && documentId !== state.activeDocumentId) await selectDocument(documentId); const annotation = state.annotations.find((item) => item.id === button.dataset.reportEdit); if (!annotation) { toast("원문 의견을 불러오지 못했습니다. 최신 화면을 다시 확인해 주세요."); return; } focusAnnotation(annotation.id); openAnnotationDialog(annotation.kind, annotation); });
  $("#document-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-document-id]");
    if (button) selectDocument(button.dataset.documentId);
  });
  $("#document-content").addEventListener("mouseup", captureSelection);
  $("#document-content").addEventListener("touchend", () => setTimeout(captureSelection, 80));
  $("#document-content").addEventListener("click", (event) => {
    const rowCheck = event.target.closest("[data-check-blocks]");
    if (rowCheck) {
      toggleBlocks(rowCheck.dataset.checkBlocks.split(",").filter(Boolean));
      return;
    }
    const check = event.target.closest("[data-check-block]");
    if (check) toggleBlock(check.dataset.checkBlock);
    const mark = event.target.closest("[data-annotation-id]");
    if (mark) focusAnnotation(mark.dataset.annotationId);
  });
  $$("[data-tool]").forEach((button) => button.addEventListener("click", () => {
    const tool = button.dataset.tool;
    if (tool === "highlight") createAnnotation("highlight", { color: button.dataset.color || "yellow" });
    if (tool === "memo") openAnnotationDialog("memo");
    if (tool === "issue") openAnnotationDialog("issue");
  }));
  $("#annotation-form").addEventListener("submit", saveDialogAnnotation);
  $$('[data-close-annotation-dialog]').forEach((button) => button.addEventListener("click", () => $("#annotation-dialog").close()));
  $("#selection-popover").addEventListener("pointerdown", (event) => event.preventDefault());
  $("#selection-popover").addEventListener("click", (event) => {
    const button = event.target.closest("[data-floating-tool]");
    if (!button) return;
    const tool = button.dataset.floatingTool;
    if (tool === "highlight") createAnnotation("highlight", { color: button.dataset.color || "yellow" });
    if (tool === "memo") openAnnotationDialog("memo");
    if (tool === "issue") openAnnotationDialog("issue");
  });
  $("#selection-popover-close").addEventListener("click", () => hideSelectionPopover(true));
  $("#review-reader").addEventListener("scroll", () => hideSelectionPopover(), { passive: true });
  $("#annotation-body").addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === "Enter") saveDialogAnnotation(event);
  });
  $("#annotation-list").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-annotation]");
    if (edit) openAnnotationDialog(state.annotations.find((item) => item.id === edit.dataset.editAnnotation)?.kind, state.annotations.find((item) => item.id === edit.dataset.editAnnotation));
    const remove = event.target.closest("[data-delete-annotation]");
    if (remove) deleteAnnotation(remove.dataset.deleteAnnotation);
    const card = event.target.closest("[data-annotation-card]");
    if (card && !edit && !remove) focusAnnotation(card.dataset.annotationCard);
  });
  $$("[data-filter]").forEach((button) => button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    $$("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
    renderAnnotations();
  }));
  $("#document-memo").addEventListener("input", (event) => { if (state.mode !== "manager-preview") updateProgress(state.activeDocumentId, { memo: event.target.value }); });
  $("#complete-document").addEventListener("click", completeDocument);
  $("#previous-document").addEventListener("click", () => {
    const documents = activeAssignment().documents;
    const index = documents.findIndex((item) => item.id === state.activeDocumentId);
    if (index > 0) selectDocument(documents[index - 1].id);
  });
  $("#next-document").addEventListener("click", () => {
    const documents = activeAssignment().documents;
    const index = documents.findIndex((item) => item.id === state.activeDocumentId);
    if (index < documents.length - 1) selectDocument(documents[index + 1].id);
  });
  $("#zoom-in").addEventListener("click", () => { state.zoom = Math.min(140, state.zoom + 10); $("#zoom-label").textContent = `${state.zoom}%`; renderDocument(); });
  $("#zoom-out").addEventListener("click", () => { state.zoom = Math.max(80, state.zoom - 10); $("#zoom-label").textContent = `${state.zoom}%`; renderDocument(); });
  $("#focus-mode").addEventListener("click", () => setFocusMode(!document.body.classList.contains("focus-mode")));
  $("#sidebar-toggle").addEventListener("click", () => document.body.classList.toggle("sidebar-collapsed"));
  $("#help-button").addEventListener("click", () => $("#help-dialog").showModal());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#selection-popover").hidden) hideSelectionPopover(true);
    else if (event.key === "Escape" && document.body.classList.contains("focus-mode")) setFocusMode(false);
    if (event.shiftKey && event.key.toLowerCase() === "h") { event.preventDefault(); createAnnotation("highlight", { color: "yellow" }); }
    if (event.altKey && event.key.toLowerCase() === "m") { event.preventDefault(); openAnnotationDialog("memo"); }
    if (event.altKey && event.key.toLowerCase() === "e") { event.preventDefault(); openAnnotationDialog("issue"); }
  });
  document.addEventListener("copy", (event) => {
    if (event.target.closest?.(".review-paper")) {
      event.preventDefault();
      toast("소중한 원고와 전문위원님의 의견 보호를 위해 복사 기능은 제공되지 않습니다.");
      logEvent("copy_blocked");
    }
  });
  document.addEventListener("contextmenu", (event) => {
    if (event.target.closest?.(".review-paper")) {
      event.preventDefault();
      toast("자료보호를 위해 이 화면에서는 마우스 오른쪽 버튼 기능을 제공하지 않습니다.");
      logEvent("context_menu_blocked");
    }
  });
  window.addEventListener("beforeprint", () => logEvent("print_attempt"));
  window.addEventListener("resize", applyReaderScale, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && hasPendingSaves()) flushPendingSaves().catch(() => {});
    logEvent(document.hidden ? "window_hidden" : "window_visible");
  });
}

bindEvents();
if (!config.production) {
  $("#login-submit").textContent = "운영 연결 준비 중";
  $("#login-submit").disabled = true;
} else if (!localDemoAllowed) {
  $("#demo-entry").hidden = true;
  (async()=>{ try { const magicLinkSession = sessionFromMagicLink(); if (magicLinkSession) await enterProduction(magicLinkSession); else await resumeProductionSession(); } catch (error) { toast(error.message); } })();
}
