const API_BASE = "https://gyo6-law-info-ai.gyo6.workers.dev";
const MODE_LABELS = {
  general: "설탕과소금 대표",
  vocational: "특성화고 교육지원",
  exam: "공직시험 연구소",
  studio: "디지털 프로젝트"
};
const STATUS_LABELS = {
  new: "새 연락처",
  contacted: "연락함",
  "follow-up": "후속 연락",
  completed: "완료"
};

const state = {
  contacts: [],
  authReady: false,
  isAdmin: false,
  activeContact: null
};

const accessPanel = document.querySelector("[data-access-panel]");
const accessMessage = document.querySelector("[data-access-message]");
const adminContent = document.querySelector("[data-admin-content]");
const cards = document.querySelector("[data-contact-cards]");
const listStatus = document.querySelector("[data-list-status]");
const searchInput = document.querySelector("[data-contact-search]");
const statusSelect = document.querySelector("[data-contact-status]");
const modeSelect = document.querySelector("[data-contact-mode]");
const dialog = document.querySelector("[data-contact-dialog]");
const editForm = document.querySelector("[data-contact-edit-form]");
const editMessage = document.querySelector("[data-edit-message]");
const toast = document.querySelector("[data-admin-toast]");
let toastTimer = 0;

bindEvents();
window.setTimeout(syncAuthState, 0);

function bindEvents() {
  document.addEventListener("gyo6-portal-auth-state", syncAuthState);
  document.querySelector("[data-open-login]")?.addEventListener("click", () => document.querySelector("#portal-auth-trigger")?.click());
  [searchInput, statusSelect, modeSelect].forEach((control) => control?.addEventListener("input", renderContacts));
  document.querySelector("[data-export-csv]")?.addEventListener("click", exportCsv);
  cards?.addEventListener("click", handleCardClick);
  document.querySelector("[data-close-contact]")?.addEventListener("click", closeDialog);
  document.querySelector("[data-delete-contact]")?.addEventListener("click", deleteContact);
  editForm?.addEventListener("submit", saveContact);
  dialog?.addEventListener("click", (event) => { if (event.target === dialog) closeDialog(); });
  document.querySelectorAll("[data-copy-url]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copyUrl || "");
        showToast("상황별 명함 주소를 복사했습니다.");
      } catch {
        showToast("주소를 복사하지 못했습니다.");
      }
    });
  });
}

async function syncAuthState() {
  const snapshot = window.GYO6_PORTAL_AUTH?.getState?.();
  if (!snapshot?.ready) return;
  state.authReady = true;
  state.isAdmin = snapshot.approved && ["owner", "admin"].includes(snapshot.member?.role);

  if (!state.isAdmin) {
    adminContent.hidden = true;
    accessPanel.hidden = false;
    accessMessage.textContent = snapshot.user
      ? "현재 계정에는 명함 관계관리 권한이 없습니다. 총괄관리자 또는 관리자 계정으로 확인해 주세요."
      : "총괄관리자 또는 관리자 계정으로 로그인하면 명함 교환 내역이 표시됩니다.";
    return;
  }

  accessPanel.hidden = true;
  adminContent.hidden = false;
  await loadContacts();
}

async function loadContacts() {
  if (!listStatus) return;
  listStatus.textContent = "연락처를 불러오는 중입니다.";
  try {
    const token = await window.GYO6_PORTAL_AUTH.getAccessToken();
    const response = await fetch(`${API_BASE}/api/admin/card/contacts`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
    state.contacts = Array.isArray(result.contacts) ? result.contacts : [];
    renderStats();
    renderContacts();
  } catch (error) {
    listStatus.textContent = error.message || "연락처를 불러오지 못했습니다.";
  }
}

function renderStats() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  setText("[data-stat-total]", state.contacts.length);
  setText("[data-stat-new]", state.contacts.filter((item) => item.status === "new").length);
  setText("[data-stat-followup]", state.contacts.filter((item) => item.status === "follow-up").length);
  setText("[data-stat-month]", state.contacts.filter((item) => String(item.createdAt || "").startsWith(currentMonth)).length);
}

function renderContacts() {
  if (!cards || !listStatus) return;
  const keyword = String(searchInput?.value || "").trim().toLowerCase();
  const status = statusSelect?.value || "all";
  const mode = modeSelect?.value || "all";
  const filtered = state.contacts.filter((contact) => {
    const haystack = [contact.name, contact.phone, contact.email, contact.organization, contact.title, contact.source, ...(contact.tags || [])]
      .join(" ").toLowerCase();
    return (!keyword || haystack.includes(keyword)) &&
      (status === "all" || contact.status === status) &&
      (mode === "all" || contact.mode === mode);
  });

  listStatus.textContent = filtered.length
    ? `${filtered.length}명의 명함 교환 내역을 표시합니다.`
    : "조건에 맞는 명함 교환 내역이 없습니다.";
  cards.innerHTML = filtered.map(renderContact).join("");
}

function renderContact(contact) {
  const organization = [contact.organization, contact.title].filter(Boolean).join(" · ") || "소속·직책 미입력";
  const tags = (contact.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  return `
    <article class="contact-item">
      <div>
        <h3>${escapeHtml(contact.name || "이름 없음")}</h3>
        <p>${escapeHtml(organization)}</p>
      </div>
      <div>
        ${contact.phone ? `<a href="tel:${escapeHtml(contact.phone)}">${escapeHtml(contact.phone)}</a>` : ""}
        ${contact.email ? `<a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a>` : ""}
      </div>
      <div>
        <div class="contact-item__meta">
          <span class="contact-status" data-status="${escapeHtml(contact.status)}">${escapeHtml(STATUS_LABELS[contact.status] || contact.status)}</span>
          <span>${escapeHtml(MODE_LABELS[contact.mode] || contact.mode)}</span>
          <span>${escapeHtml(contact.source || "direct")}</span>
          ${tags}
        </div>
        <p>${escapeHtml(formatDate(contact.createdAt))}${contact.followUpAt ? ` · 다시 연락 ${escapeHtml(formatShortDate(contact.followUpAt))}` : ""}</p>
      </div>
      <button type="button" data-edit-contact="${Number(contact.id)}">메모·후속 연락</button>
    </article>`;
}

function handleCardClick(event) {
  const button = event.target instanceof Element ? event.target.closest("[data-edit-contact]") : null;
  if (!button) return;
  const contact = state.contacts.find((item) => Number(item.id) === Number(button.dataset.editContact));
  if (!contact || !editForm) return;
  state.activeContact = contact;
  editForm.elements.id.value = contact.id;
  editForm.elements.status.value = contact.status || "new";
  editForm.elements.tags.value = (contact.tags || []).join(", ");
  editForm.elements.followUpAt.value = String(contact.followUpAt || "").slice(0, 10);
  editForm.elements.ownerNote.value = contact.ownerNote || "";
  document.querySelector("[data-edit-title]").textContent = `${contact.name} 님과의 인연`;
  editMessage.textContent = "";
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

async function saveContact(event) {
  event.preventDefault();
  if (!editForm || !state.activeContact) return;
  const submit = editForm.querySelector("button[type='submit']");
  submit.disabled = true;
  editMessage.textContent = "저장하는 중입니다.";
  try {
    const token = await window.GYO6_PORTAL_AUTH.getAccessToken();
    const data = new FormData(editForm);
    const response = await fetch(`${API_BASE}/api/admin/card/contact/update`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        id: Number(data.get("id")),
        status: data.get("status")?.toString() || "new",
        tags: data.get("tags")?.toString().split(",").map((item) => item.trim()).filter(Boolean) || [],
        followUpAt: data.get("followUpAt")?.toString() || "",
        ownerNote: data.get("ownerNote")?.toString() || ""
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
    showToast("관계 메모를 저장했습니다.");
    closeDialog();
    await loadContacts();
  } catch (error) {
    editMessage.textContent = error.message || "저장하지 못했습니다.";
  } finally {
    submit.disabled = false;
  }
}

async function deleteContact() {
  if (!state.activeContact) return;
  if (!window.confirm(`${state.activeContact.name} 님의 명함 교환 기록을 삭제할까요? 삭제 후 복구할 수 없습니다.`)) return;
  editMessage.textContent = "삭제하는 중입니다.";
  try {
    const token = await window.GYO6_PORTAL_AUTH.getAccessToken();
    const response = await fetch(`${API_BASE}/api/admin/card/contact/delete`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: Number(state.activeContact.id) })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
    showToast("명함 교환 기록을 삭제했습니다.");
    closeDialog();
    await loadContacts();
  } catch (error) {
    editMessage.textContent = error.message || "삭제하지 못했습니다.";
  }
}

function exportCsv() {
  const headers = ["이름", "전화", "이메일", "회사·기관", "직책", "명함모드", "출처", "상태", "태그", "만남메모", "대표메모", "후속연락일", "교환일"];
  const rows = state.contacts.map((contact) => [
    contact.name, contact.phone, contact.email, contact.organization, contact.title,
    MODE_LABELS[contact.mode] || contact.mode, contact.source, STATUS_LABELS[contact.status] || contact.status,
    (contact.tags || []).join("|"), contact.note, contact.ownerNote, contact.followUpAt, contact.createdAt
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `설탕과소금_명함교환_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function closeDialog() {
  if (typeof dialog?.close === "function") dialog.close();
  else dialog?.removeAttribute("open");
  state.activeContact = null;
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = String(value);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatShortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

function csvCell(value) {
  const text = String(value ?? "").replaceAll('"', '""');
  return `"${text}"`;
}

function showToast(text) {
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = text;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
