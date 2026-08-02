const BOARD_API = "https://gyo6-law-info-ai.gyo6.workers.dev/api/boards";
const ROOM_LABELS = {
  promotion: "설탕과소금 소식",
  collaboration: "협업문의",
  qna: "질의응답"
};

const app = document.querySelector("[data-board-app]");
const tabs = [...document.querySelectorAll("[data-board-room]")];
const searchForm = document.querySelector("[data-board-search]");
const resetButton = document.querySelector("[data-board-reset]");
const statusEl = document.querySelector("[data-board-status]");
const listEl = document.querySelector("[data-board-list]");
const writeForm = document.querySelector("[data-board-form]");
const noteEl = document.querySelector("[data-board-form-note]");

const state = {
  room: "all",
  q: "",
  authReady: false
};

if (app) {
  bindEvents();
  loadPosts();
}

function bindEvents() {
  tabs.forEach((button) => {
    button.addEventListener("click", () => {
      state.room = button.dataset.boardRoom || "all";
      syncTabs();
      loadPosts();
    });
  });

  searchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.q = new FormData(searchForm).get("q")?.toString().trim() || "";
    loadPosts();
  });

  resetButton?.addEventListener("click", () => {
    state.q = "";
    if (searchForm?.elements.q) searchForm.elements.q.value = "";
    loadPosts();
  });

  writeForm?.addEventListener("submit", submitPost);
  listEl?.addEventListener("click", handlePostAction);
  listEl?.addEventListener("submit", submitPostEdit);
  document.addEventListener("gyo6-portal-auth-state", () => {
    state.authReady = true;
    loadPosts();
  });
}

async function loadPosts() {
  if (!listEl || !statusEl) return;
  statusEl.textContent = "게시글을 불러오는 중입니다.";
  listEl.innerHTML = "";

  try {
    const url = new URL(BOARD_API);
    if (state.room !== "all") url.searchParams.set("room", state.room);
    if (state.q) url.searchParams.set("q", state.q);

    const token = await getOptionalToken();
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    const posts = Array.isArray(data.posts) ? data.posts : [];
    statusEl.textContent = posts.length
      ? `${posts.length}개의 게시글을 표시합니다.`
      : "아직 표시할 게시글이 없습니다.";
    listEl.innerHTML = posts.map(renderPost).join("");
  } catch (error) {
    statusEl.textContent = error.message || "게시글을 불러오지 못했습니다.";
  }
}

async function submitPost(event) {
  event.preventDefault();
  if (!writeForm || !noteEl) return;
  noteEl.textContent = "로그인과 승인 상태를 확인하는 중입니다.";

  try {
    const token = await window.GYO6_PORTAL_AUTH?.getAccessToken?.();
    if (!token) throw new Error("승인 회원 로그인 후 작성할 수 있습니다.");

    const formData = new FormData(writeForm);
    const payload = {
      room: formData.get("room")?.toString() || "",
      anonymousName: formData.get("anonymousName")?.toString() || "",
      title: formData.get("title")?.toString() || "",
      body: formData.get("body")?.toString() || ""
    };

    const response = await fetch(BOARD_API, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    noteEl.textContent = "게시글을 등록했습니다.";
    writeForm.reset();
    state.room = payload.room || "all";
    syncTabs();
    await loadPosts();
  } catch (error) {
    noteEl.textContent = error.message || "게시글을 등록하지 못했습니다.";
  }
}


async function handlePostAction(event) {
  const button = event.target instanceof Element ? event.target.closest("[data-board-action]") : null;
  if (!button || !listEl?.contains(button)) return;

  const article = button.closest("[data-board-post-id]");
  const form = article?.querySelector("[data-board-edit-form]");
  const action = button.dataset.boardAction;
  if (action === "edit") {
    form?.removeAttribute("hidden");
    form?.elements.title?.focus();
    return;
  }
  if (action === "cancel") {
    form?.setAttribute("hidden", "");
    form?.reset();
    return;
  }
  if (action !== "delete") return;

  const id = Number(article?.dataset.boardPostId);
  if (!Number.isInteger(id) || id <= 0) return;
  if (!window.confirm("이 게시글을 삭제하시겠습니까? 삭제 후에는 복구할 수 없습니다.")) return;

  button.disabled = true;
  statusEl.textContent = "게시글을 삭제하는 중입니다.";
  try {
    await requestBoardMutation("delete", { id });
    statusEl.textContent = "게시글을 삭제했습니다.";
    await loadPosts();
  } catch (error) {
    statusEl.textContent = error.message || "게시글을 삭제하지 못했습니다.";
  } finally {
    button.disabled = false;
  }
}

async function submitPostEdit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches("[data-board-edit-form]")) return;
  event.preventDefault();

  const id = Number(form.dataset.boardPostId);
  if (!Number.isInteger(id) || id <= 0) return;
  const submit = form.querySelector("button[type='submit']");
  if (submit) submit.disabled = true;
  statusEl.textContent = "게시글을 수정하는 중입니다.";

  try {
    const formData = new FormData(form);
    await requestBoardMutation("update", {
      id,
      anonymousName: formData.get("anonymousName")?.toString() || "",
      title: formData.get("title")?.toString() || "",
      body: formData.get("body")?.toString() || ""
    });
    statusEl.textContent = "게시글을 수정했습니다.";
    await loadPosts();
  } catch (error) {
    statusEl.textContent = error.message || "게시글을 수정하지 못했습니다.";
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function requestBoardMutation(action, payload) {
  const token = await window.GYO6_PORTAL_AUTH?.getAccessToken?.();
  if (!token) throw new Error("승인 회원 로그인 후 게시글을 관리할 수 있습니다.");

  const endpoint = BOARD_API.replace("/api/boards", `/api/board/${action}`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function getOptionalToken() {
  const auth = window.GYO6_PORTAL_AUTH;
  const snapshot = auth?.getState?.();
  if (!snapshot?.approved || !snapshot?.user) {
    return "";
  }
  try {
    return await auth.getAccessToken();
  } catch {
    return "";
  }
}

function syncTabs() {
  tabs.forEach((button) => {
    button.classList.toggle("active", (button.dataset.boardRoom || "all") === state.room);
  });
}

function renderPost(post) {
  const room = ROOM_LABELS[post.room] || "게시판";
  const status = post.room === "promotion"
    ? "공개"
    : post.status === "answered" ? "답변완료" : post.status === "closed" ? "종료" : "접수";
  const protectedNotice = post.canViewBody
    ? ""
    : `<p class="board-private">본문은 작성자와 관리자만 확인할 수 있습니다.</p>`;
  const body = post.canViewBody && post.body
    ? renderBoardBody(post.body, post.room)
    : "";
  const reply = post.canViewBody && post.adminReply
    ? `<div class="board-reply"><strong>관리자 답변</strong><p>${escapeHtml(post.adminReply).replaceAll("\n", "<br>")}</p></div>`
    : "";

  const management = post.canManage && /^\d+$/.test(String(post.id))
    ? `
      <div class="board-post-actions" aria-label="게시글 관리">
        <button class="btn" type="button" data-board-action="edit">수정</button>
        <button class="btn danger" type="button" data-board-action="delete">삭제</button>
      </div>
      <form class="board-post-edit" data-board-edit-form data-board-post-id="${escapeHtml(post.id)}" hidden>
        <label>표시 이름<input name="anonymousName" type="text" maxlength="40" value="${escapeHtml(post.author?.anonymousName || "")}"></label>
        <label>제목<input name="title" type="text" maxlength="120" value="${escapeHtml(post.title || "")}" required></label>
        <label>내용<textarea name="body" rows="8" required>${escapeHtml(post.body || "")}</textarea></label>
        <div class="board-post-edit-actions">
          <button class="btn primary" type="submit">수정 저장</button>
          <button class="btn" type="button" data-board-action="cancel">취소</button>
        </div>
      </form>`
    : "";

  return `
    <article class="board-post" data-board-post-id="${escapeHtml(post.id || "")}">
      <div class="board-post-meta">
        <span>${escapeHtml(room)}</span>
        <span>${escapeHtml(status)}</span>
        <time datetime="${escapeHtml(post.updatedAt || post.createdAt || "")}">${escapeHtml(formatDate(post.updatedAt || post.createdAt))}</time>
      </div>
      <h3>${escapeHtml(post.title || "제목 없음")}</h3>
      ${protectedNotice}
      ${body}
      ${reply}
      ${management}
    </article>
  `;
}

function renderBoardBody(value, room) {
  const lines = String(value ?? "").split("\n");
  const content = lines.map((line) => {
    const image = room === "promotion"
      ? line.match(/^\[\[image:(assets\/news\/[a-z0-9._/-]+\.(?:png|jpe?g|webp))\|([^\]]{1,160})\]\]$/i)
      : null;

    if (image) {
      const src = escapeHtml(image[1]);
      const alt = escapeHtml(image[2].trim());
      return `<figure class="board-post-visual"><img src="${src}" alt="${alt}" loading="lazy" decoding="async"><figcaption>${alt}</figcaption></figure>`;
    }

    return escapeHtml(line);
  }).join("<br>");

  return `<div class="board-body">${content}</div>`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
