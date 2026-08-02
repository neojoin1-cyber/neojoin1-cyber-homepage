const BOARD_API = "https://gyo6-law-info-ai.gyo6.workers.dev/api/boards";
const BOARD_API_ORIGIN = new URL(BOARD_API).origin;
const ATTACHMENT_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx";
const ATTACHMENT_MAX_FILES = 5;
const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
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
const popupField = document.querySelector("[data-board-popup-field]");
const objectUrls = new Set();

const state = { room: "all", q: "", authReady: false };

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
  writeForm?.elements.room?.addEventListener("change", syncAdminControls);
  writeForm?.elements.attachments?.addEventListener("change", updateFileSelectionNote);
  listEl?.addEventListener("click", handlePostAction);
  listEl?.addEventListener("submit", submitPostEdit);
  document.addEventListener("gyo6-portal-auth-state", () => {
    state.authReady = true;
    syncAdminControls();
    loadPosts();
  });
  window.addEventListener("beforeunload", clearObjectUrls);
}

async function loadPosts() {
  if (!listEl || !statusEl) return;
  statusEl.textContent = "게시글을 불러오는 중입니다.";
  clearObjectUrls();
  listEl.innerHTML = "";

  try {
    const url = new URL(BOARD_API);
    if (state.room !== "all") url.searchParams.set("room", state.room);
    if (state.q) url.searchParams.set("q", state.q);
    const token = await getOptionalToken();
    const response = await fetch(url, {
      headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);

    const posts = Array.isArray(data.posts) ? data.posts : [];
    statusEl.textContent = posts.length ? `${posts.length}개의 게시글을 표시합니다.` : "아직 표시할 게시글이 없습니다.";
    listEl.innerHTML = posts.map(renderPost).join("");
    await hydratePrivateImages(token);
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
    const files = validateSelectedFiles(writeForm.elements.attachments?.files);
    const payload = {
      room: formData.get("room")?.toString() || "",
      anonymousName: formData.get("anonymousName")?.toString() || "",
      title: formData.get("title")?.toString() || "",
      body: formData.get("body")?.toString() || "",
      isPopup: formData.get("isPopup") === "on"
    };
    const response = await fetch(BOARD_API, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);

    const postId = Number(data.post?.id);
    if (files.length) {
      noteEl.textContent = `게시글을 등록했습니다. 첨부파일 ${files.length}개를 올리는 중입니다.`;
      await uploadAttachments(postId, files, token);
    }
    noteEl.textContent = files.length ? `게시글과 첨부파일 ${files.length}개를 등록했습니다.` : "게시글을 등록했습니다.";
    writeForm.reset();
    syncAdminControls();
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

  if (action === "download-attachment") return downloadAttachment(button);
  if (action === "delete-attachment") {
    const id = button.dataset.attachmentId || "";
    if (!id || !window.confirm("이 첨부파일을 삭제하시겠습니까?")) return;
    button.disabled = true;
    try {
      await requestBoardMutation("attachment/delete", { id });
      statusEl.textContent = "첨부파일을 삭제했습니다.";
      await loadPosts();
    } catch (error) {
      statusEl.textContent = error.message || "첨부파일을 삭제하지 못했습니다.";
      button.disabled = false;
    }
    return;
  }
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
  if (!window.confirm("이 게시글을 삭제하시겠습니까? 첨부파일도 함께 삭제되며 복구할 수 없습니다.")) return;
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
    const token = await window.GYO6_PORTAL_AUTH?.getAccessToken?.();
    if (!token) throw new Error("승인 회원 로그인 후 게시글을 관리할 수 있습니다.");
    const formData = new FormData(form);
    const files = validateSelectedFiles(form.elements.attachments?.files);
    await requestBoardMutation("update", {
      id,
      anonymousName: formData.get("anonymousName")?.toString() || "",
      title: formData.get("title")?.toString() || "",
      body: formData.get("body")?.toString() || "",
      isPopup: formData.get("isPopup") === "on"
    });
    if (files.length) {
      statusEl.textContent = `게시글을 수정했습니다. 첨부파일 ${files.length}개를 올리는 중입니다.`;
      await uploadAttachments(id, files, token);
    }
    statusEl.textContent = files.length ? `게시글과 첨부파일 ${files.length}개를 저장했습니다.` : "게시글을 수정했습니다.";
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
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function uploadAttachments(postId, files, token) {
  if (!Number.isInteger(postId) || postId <= 0) throw new Error("첨부할 게시글을 확인하지 못했습니다.");
  for (const file of files) {
    const endpoint = BOARD_API.replace("/api/boards", `/api/board/attachment/upload?postId=${postId}`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
        "x-file-size": String(file.size)
      },
      body: file
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(`${file.name}: ${data.error || `HTTP ${response.status}`}`);
  }
}

async function downloadAttachment(button) {
  const url = button.dataset.attachmentUrl || "";
  const fileName = button.dataset.attachmentName || "첨부파일";
  if (!url) return;
  button.disabled = true;
  try {
    const token = await getOptionalToken();
    const response = await fetch(toAttachmentUrl(url), {
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
      cache: "no-store"
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "첨부파일을 열지 못했습니다.");
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    statusEl.textContent = error.message || "첨부파일을 열지 못했습니다.";
  } finally {
    button.disabled = false;
  }
}

async function hydratePrivateImages(token) {
  const images = [...document.querySelectorAll("img[data-private-attachment]")];
  if (!images.length || !token) return;
  await Promise.all(images.map(async (image) => {
    try {
      const response = await fetch(toAttachmentUrl(image.dataset.privateAttachment), {
        headers: { authorization: `Bearer ${token}` }, cache: "no-store"
      });
      if (!response.ok) return;
      const objectUrl = URL.createObjectURL(await response.blob());
      objectUrls.add(objectUrl);
      image.src = objectUrl;
      image.removeAttribute("data-private-attachment");
    } catch {
      image.closest("figure")?.classList.add("attachment-preview-failed");
    }
  }));
}

async function getOptionalToken() {
  const auth = window.GYO6_PORTAL_AUTH;
  const snapshot = auth?.getState?.();
  if (!snapshot?.approved || !snapshot?.user) return "";
  try { return await auth.getAccessToken(); } catch { return ""; }
}

function syncTabs() {
  tabs.forEach((button) => button.classList.toggle("active", (button.dataset.boardRoom || "all") === state.room));
}

function syncAdminControls() {
  if (!writeForm || !popupField) return;
  const role = window.GYO6_PORTAL_AUTH?.getState?.().member?.role || "";
  const isAdmin = role === "owner" || role === "admin";
  const isPromotion = writeForm.elements.room?.value === "promotion";
  popupField.hidden = !(isAdmin && isPromotion);
  if (popupField.hidden && writeForm.elements.isPopup) writeForm.elements.isPopup.checked = false;
}

function updateFileSelectionNote() {
  if (!noteEl || !writeForm) return;
  try {
    const files = validateSelectedFiles(writeForm.elements.attachments?.files);
    noteEl.textContent = files.length ? `첨부파일 ${files.length}개가 선택되었습니다.` : "";
  } catch (error) {
    noteEl.textContent = error.message;
  }
}

function validateSelectedFiles(fileList) {
  const files = [...(fileList || [])];
  if (files.length > ATTACHMENT_MAX_FILES) throw new Error(`첨부파일은 게시글당 ${ATTACHMENT_MAX_FILES}개까지 선택할 수 있습니다.`);
  const allowed = /\.(png|jpe?g|webp|gif|pdf|hwp|hwpx|doc|docx|xls|xlsx|ppt|pptx)$/i;
  for (const file of files) {
    if (!allowed.test(file.name)) throw new Error(`${file.name}: 지원하지 않는 파일 형식입니다.`);
    if (!file.size || file.size > ATTACHMENT_MAX_BYTES) throw new Error(`${file.name}: 파일당 15MB 이하만 첨부할 수 있습니다.`);
  }
  return files;
}

function renderPost(post) {
  const room = ROOM_LABELS[post.room] || "게시판";
  const status = post.room === "promotion" ? "공개" : post.status === "answered" ? "답변완료" : post.status === "closed" ? "종료" : "접수";
  const protectedNotice = post.canViewBody ? "" : '<p class="board-private">본문과 첨부파일은 작성자와 관리자만 확인할 수 있습니다.</p>';
  const body = post.canViewBody && post.body ? renderBoardBody(post.body, post.room) : "";
  const attachments = post.canViewBody ? renderAttachments(post) : "";
  const reply = post.canViewBody && post.adminReply
    ? `<div class="board-reply"><strong>관리자 답변</strong><p>${escapeHtml(post.adminReply).replaceAll("\n", "<br>")}</p></div>` : "";
  const popupBadge = post.isPopup ? '<span class="board-popup-badge">홈 팝업</span>' : "";
  const management = post.canManage && /^\d+$/.test(String(post.id))
    ? `<div class="board-post-actions" aria-label="게시글 관리">
        <button class="btn" type="button" data-board-action="edit">수정</button>
        <button class="btn danger" type="button" data-board-action="delete">삭제</button>
      </div>
      <form class="board-post-edit" data-board-edit-form data-board-post-id="${escapeHtml(post.id)}" hidden>
        <label>표시 이름<input name="anonymousName" type="text" maxlength="40" value="${escapeHtml(post.author?.anonymousName || "")}"></label>
        <label>제목<input name="title" type="text" maxlength="120" value="${escapeHtml(post.title || "")}" required></label>
        <label>내용<textarea name="body" rows="8" required>${escapeHtml(post.body || "")}</textarea></label>
        <label class="board-file-field">이미지·문서 추가<input name="attachments" type="file" accept="${ATTACHMENT_ACCEPT}" multiple><small>이미지, PDF, 한글·오피스 문서 · 파일당 15MB · 게시글당 최대 5개</small></label>
        ${post.canSetPopup ? `<label class="board-popup-toggle"><input name="isPopup" type="checkbox" ${post.isPopup ? "checked" : ""}> 홈페이지에서 한 번만 보여줄 팝업으로 지정</label>` : ""}
        ${renderAttachmentManagement(post.attachments)}
        <div class="board-post-edit-actions"><button class="btn primary" type="submit">수정 저장</button><button class="btn" type="button" data-board-action="cancel">취소</button></div>
      </form>` : "";

  return `<article class="board-post" data-board-post-id="${escapeHtml(post.id || "")}">
      <div class="board-post-meta"><span>${escapeHtml(room)}</span><span>${escapeHtml(status)}</span>${popupBadge}<time datetime="${escapeHtml(post.updatedAt || post.createdAt || "")}">${escapeHtml(formatDate(post.updatedAt || post.createdAt))}</time></div>
      <h3>${escapeHtml(post.title || "제목 없음")}</h3>${protectedNotice}${attachments}${body}${reply}${management}
    </article>`;
}

function renderAttachments(post) {
  const attachments = Array.isArray(post.attachments) ? post.attachments : [];
  if (!attachments.length) return "";
  const images = attachments.filter((item) => item.isImage);
  const files = attachments.filter((item) => !item.isImage);
  return `<div class="board-attachments" aria-label="첨부파일">
    ${images.map((item) => {
      const src = post.room === "promotion" ? `src="${escapeHtml(toAttachmentUrl(item.url))}"` : `data-private-attachment="${escapeHtml(item.url)}"`;
      return `<figure class="board-post-visual board-attachment-image"><img ${src} alt="${escapeHtml(item.name)}" loading="lazy" decoding="async"><figcaption>${escapeHtml(item.name)}</figcaption></figure>`;
    }).join("")}
    ${files.length ? `<div class="board-attachment-files">${files.map(renderAttachmentDownload).join("")}</div>` : ""}</div>`;
}

function renderAttachmentDownload(item) {
  return `<button class="board-attachment-download" type="button" data-board-action="download-attachment" data-attachment-url="${escapeHtml(item.url)}" data-attachment-name="${escapeHtml(item.name)}"><span>${escapeHtml(item.name)}</span><small>${escapeHtml(formatBytes(item.size))}</small></button>`;
}

function renderAttachmentManagement(items) {
  const attachments = Array.isArray(items) ? items : [];
  if (!attachments.length) return "";
  return `<div class="board-attachment-management"><strong>현재 첨부</strong>${attachments.map((item) => `<div><span>${escapeHtml(item.name)} · ${escapeHtml(formatBytes(item.size))}</span><button type="button" data-board-action="delete-attachment" data-attachment-id="${escapeHtml(item.id)}">삭제</button></div>`).join("")}</div>`;
}

function renderBoardBody(value, room) {
  const lines = String(value ?? "").split("\n");
  const content = lines.map((line) => {
    const image = room === "promotion" ? line.trim().match(/^\[\[image:(assets\/news\/[a-z0-9._/-]+\.(?:png|jpe?g|webp))\|([^\]]{1,160})\]\]$/i) : null;
    if (image) {
      const src = escapeHtml(image[1]);
      const alt = escapeHtml(image[2].trim());
      return `<figure class="board-post-visual"><img src="${src}" alt="${alt}" loading="lazy" decoding="async"><figcaption>${alt}</figcaption></figure>`;
    }
    return escapeHtml(line);
  }).join("<br>");
  return `<div class="board-body">${content}</div>`;
}

function toAttachmentUrl(value) { return new URL(String(value || ""), BOARD_API_ORIGIN).toString(); }
function clearObjectUrls() { for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); }
function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
