const EBOOK_API = "https://gyo6-law-info-ai.gyo6.workers.dev";
const SAMPLE_EBOOK_ID = "fb-service-l3-2026-ext";
const SAMPLE_LESSON_ID = "fb.c01.l01";

const modeButtons = [...document.querySelectorAll("[data-ebook-mode]")];
const statusEl = document.querySelector("[data-ebook-status]");
const readerEl = document.querySelector("[data-ebook-reader]");

modeButtons.forEach((button) => {
  button.addEventListener("click", () => loadLesson(button.dataset.ebookMode || "student"));
});

document.addEventListener("gyo6-portal-auth-state", (event) => {
  const state = event.detail || {};
  if (!statusEl) return;
  if (!state.user) {
    statusEl.textContent = "승인 회원 로그인 후 샘플 전자책을 열 수 있습니다.";
  } else if (!state.approved) {
    statusEl.textContent = "로그인은 되었지만 관리자 승인 전입니다.";
  } else {
    const role = state.member?.role || "member";
    statusEl.textContent = `${role} 권한으로 전자책 샘플을 열 수 있습니다.`;
  }
});

async function loadLesson(mode) {
  if (!statusEl || !readerEl) return;
  statusEl.textContent = `${mode === "teacher" ? "교사용" : "학생용"} 전자책을 불러오는 중입니다.`;
  readerEl.innerHTML = "";

  try {
    const token = await window.GYO6_PORTAL_AUTH?.getAccessToken?.();
    if (!token) throw new Error("승인 회원 로그인이 필요합니다.");

    const url = `${EBOOK_API}/api/ebooks/${encodeURIComponent(SAMPLE_EBOOK_ID)}/lessons/${encodeURIComponent(SAMPLE_LESSON_ID)}?mode=${encodeURIComponent(mode)}`;
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    statusEl.textContent = `${data.mode === "teacher" ? "교사용" : "학생용"} 전자책을 표시합니다.`;
    readerEl.innerHTML = renderLesson(data.lesson, data.mode);
  } catch (error) {
    statusEl.textContent = error.message || "전자책을 불러오지 못했습니다.";
  }
}

function renderLesson(lesson, mode) {
  const steps = Array.isArray(lesson?.steps) ? lesson.steps : [];
  return `
    <article class="ebook-live-card">
      <div class="ebook-live-head">
        <span>${escapeHtml(mode === "teacher" ? "교사 화면" : "학생 화면")}</span>
        <h3>${escapeHtml(lesson?.lessonTitle || "전자책 샘플")}</h3>
        <p>${escapeHtml(lesson?.unitTitle || "")} · ${escapeHtml(String(lesson?.estimatedMinutes || ""))}분</p>
      </div>
      <div class="ebook-live-steps">
        ${steps.map((step, index) => renderStep(step, index + 1, mode)).join("")}
      </div>
    </article>
  `;
}

function renderStep(step, number, mode) {
  const blocks = Array.isArray(step.studentBlocks) ? step.studentBlocks : [];
  const questions = Array.isArray(step.questions) ? step.questions : [];
  const notes = Array.isArray(step.teacherNotes) ? step.teacherNotes : [];
  const guides = Array.isArray(step.teacherGuides) ? step.teacherGuides : [];
  const explanations = Array.isArray(step.studentExplanations) ? step.studentExplanations : [];

  return `
    <section class="ebook-live-step">
      <div class="ebook-live-step-title">
        <b>${number}</b>
        <div>
          <span>${escapeHtml(step.phase || "step")}</span>
          <h4>${escapeHtml(step.title || "")}</h4>
        </div>
      </div>
      ${blocks.map((block) => `<div class="ebook-live-block ${escapeHtml(block.type || "text")}">${safeInlineHtml(block.html)}</div>`).join("")}
      ${questions.length ? `<div class="ebook-live-questions">${questions.map((question) => renderQuestion(question)).join("")}</div>` : ""}
      ${explanations.length ? `<div class="ebook-live-locked"><strong>제출 후 해설</strong>${explanations.map((item) => `<p>${safeInlineHtml(item.html)}</p>`).join("")}</div>` : ""}
      ${mode === "teacher" && notes.length ? `<div class="ebook-live-teacher"><strong>교사 메모</strong>${notes.map((note) => `<p>${safeInlineHtml(note.html)}</p>`).join("")}</div>` : ""}
      ${mode === "teacher" && guides.length ? `<div class="ebook-live-guide"><strong>수업 진행 자료</strong>${guides.map((guide) => `<p><em>${escapeHtml(guide.type || "guide")}</em> ${safeInlineHtml(guide.html)}</p>`).join("")}</div>` : ""}
    </section>
  `;
}

function renderQuestion(question) {
  const options = Array.isArray(question.options) ? question.options : [];
  return `
    <div class="ebook-live-question">
      <p>${safeInlineHtml(question.promptHtml || "")}</p>
      ${options.length ? `<ol>${options.map((option) => `<li>${escapeHtml(option)}</li>`).join("")}</ol>` : ""}
      ${question.answerLockedUntil ? `<span>정답과 해설은 제출 후 표시됩니다.</span>` : ""}
    </div>
  `;
}

function safeInlineHtml(value) {
  return escapeHtml(value)
    .replaceAll("&lt;strong&gt;", "<strong>")
    .replaceAll("&lt;/strong&gt;", "</strong>")
    .replaceAll("&lt;b&gt;", "<b>")
    .replaceAll("&lt;/b&gt;", "</b>")
    .replaceAll("&lt;br&gt;", "<br>")
    .replaceAll("&lt;br/&gt;", "<br>")
    .replaceAll("&lt;br /&gt;", "<br>");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
