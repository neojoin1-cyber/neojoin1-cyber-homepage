import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCJ9EF7L-aoctng5saSBduNmAEOd6RZ4wU",
  appId: "1:747899752908:web:87a949ae232161f222cd69",
  authDomain: "gyo6-law-info.firebaseapp.com",
  messagingSenderId: "747899752908",
  projectId: "gyo6-law-info",
  storageBucket: "gyo6-law-info.firebasestorage.app"
};

const MEMBER_API = "https://gyo6-law-info-ai.gyo6.workers.dev";
const mount = document.querySelector("#portal-auth-mount");
const trigger = document.querySelector("#portal-auth-trigger");
const app = initializeApp(firebaseConfig, "gyo6-portal-auth");
const auth = getAuth(app);
const state = {
  ready: false,
  user: null,
  member: null,
  capabilities: {},
  approved: false,
  message: ""
};

await setPersistence(auth, browserLocalPersistence).catch(() => null);

window.GYO6_PORTAL_AUTH = {
  getState: () => ({ ...state }),
  requireApproved,
  getAccessToken
};

trigger?.addEventListener("click", () => openAuthDialog());
mount?.addEventListener("click", handleAuthClick);
mount?.addEventListener("submit", handleAuthSubmit);

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  state.member = null;
  state.capabilities = {};
  state.approved = false;
  state.ready = true;

  if (user) {
    await refreshMember();
  }

  syncPageState();
  renderAuthDialog();
});

function requireApproved(message = "") {
  if (state.approved) {
    return true;
  }
  state.message = message || (state.user
    ? "관리자 승인이 완료되어야 세부 내용을 이용할 수 있습니다."
    : "로그인하고 관리자 승인을 받은 회원만 세부 내용을 이용할 수 있습니다.");
  openAuthDialog();
  return false;
}

async function getAccessToken() {
  if (!state.approved || !state.user) {
    requireApproved("승인 회원 로그인 후 회원 전용 서비스를 이용할 수 있습니다.");
    throw new Error("APPROVED_MEMBER_REQUIRED");
  }
  return state.user.getIdToken();
}

async function refreshMember() {
  try {
    const token = await state.user.getIdToken();
    const response = await fetch(`${MEMBER_API}/api/member/me`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(data.error || `회원 승인 확인 오류 (${response.status})`);
    }
    state.member = data.member || null;
    state.capabilities = data.capabilities || {};
    state.approved = state.member?.status === "approved";
    if (state.user && !state.approved) {
      state.message = "로그인은 되었지만 관리자 승인 대기 상태입니다.";
    }
  } catch (error) {
    state.message = error.message || "회원 승인 상태를 확인하지 못했습니다.";
  }
}

async function handleAuthSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches("[data-portal-login-form]")) {
    return;
  }
  event.preventDefault();
  const submit = form.querySelector("button[type='submit']");
  if (submit) submit.disabled = true;
  state.message = "로그인과 승인 상태를 확인하는 중입니다.";
  renderAuthDialog(true);
  try {
    await signInWithEmailAndPassword(auth, form.elements.email.value.trim(), form.elements.password.value);
  } catch (error) {
    state.message = formatLoginError(error);
    renderAuthDialog(true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function handleAuthClick(event) {
  const button = event.target instanceof Element ? event.target.closest("[data-portal-auth-action]") : null;
  if (!button) return;
  const action = button.dataset.portalAuthAction;
  if (action === "close") {
    closeAuthDialog();
    return;
  }
  if (action === "logout") {
    await signOut(auth);
    state.message = "로그아웃했습니다.";
    closeAuthDialog();
  }
}

function openAuthDialog() {
  renderAuthDialog(true);
  window.setTimeout(() => mount?.querySelector("input[name='email']")?.focus({ preventScroll: true }), 0);
}

function closeAuthDialog() {
  mount?.querySelector(".portal-auth-modal")?.setAttribute("hidden", "");
}

function renderAuthDialog(open = false) {
  if (!mount) return;
  const memberLabel = state.approved ? "승인 회원" : state.user ? "승인 대기" : "비회원";
  mount.innerHTML = `
    <section class="portal-auth-modal" ${open ? "" : "hidden"} aria-label="회원 로그인">
      <div class="portal-auth-backdrop" data-portal-auth-action="close"></div>
      <div class="portal-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="portal-auth-title">
        <div class="portal-auth-head">
          <div>
            <span>${escapeHtml(memberLabel)}</span>
            <h2 id="portal-auth-title">회원 로그인</h2>
          </div>
          <button type="button" data-portal-auth-action="close" aria-label="로그인 창 닫기">×</button>
        </div>
        ${state.message ? `<p class="portal-auth-message">${escapeHtml(state.message)}</p>` : ""}
        ${state.user ? renderSignedIn() : renderLoginForm()}
      </div>
    </section>`;
}

function renderLoginForm() {
  return `
    <p class="portal-auth-copy">일반 안내와 목록은 누구나 볼 수 있습니다. 상세 내용과 회원 전용 자료는 승인 회원에게만 열립니다.</p>
    <form class="portal-auth-form" data-portal-login-form>
      <label>이메일<input name="email" type="email" autocomplete="email" required></label>
      <label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit">로그인</button>
    </form>
    <a class="portal-auth-signup" href="https://gyo6-law-info.web.app/?login=1#login">신규 회원가입 신청</a>`;
}

function renderSignedIn() {
  if (state.approved) {
    return `
      <p class="portal-auth-approved"><strong>${escapeHtml(state.user.displayName || state.user.email || "회원")}</strong>님은 승인 회원입니다. 회원 전용 서비스를 이용할 수 있습니다.</p>
      <button class="portal-auth-logout" type="button" data-portal-auth-action="logout">로그아웃</button>`;
  }
  return `
    <p class="portal-auth-pending"><strong>${escapeHtml(state.user.displayName || state.user.email || "회원")}</strong>님은 로그인했지만 아직 관리자 승인 전입니다.</p>
    <div class="portal-auth-row">
      <a href="https://gyo6-law-info.web.app/?login=1">회원정보·승인상태 확인</a>
      <button type="button" data-portal-auth-action="logout">로그아웃</button>
    </div>`;
}

function syncPageState() {
  document.body.classList.toggle("portal-member-approved", state.approved);
  document.body.classList.toggle("portal-member-blocked", !state.approved);
  if (trigger) {
    trigger.textContent = state.approved
      ? state.user?.displayName || "회원"
      : state.user ? "승인 대기" : "로그인";
  }
  document.dispatchEvent(new CustomEvent("gyo6-portal-auth-state", { detail: { ...state } }));
}

function formatLoginError(error) {
  const code = String(error?.code || "");
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "이메일 또는 비밀번호를 확인해 주세요.";
  }
  if (code.includes("too-many-requests")) {
    return "로그인 시도가 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.";
  }
  return error?.message || "로그인하지 못했습니다.";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
