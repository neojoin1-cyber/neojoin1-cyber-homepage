(function () {
  "use strict";

  const CONFIG = window.CARD_PROFILE || {};
  const API_BASE = CONFIG.apiBase || "https://gyo6-law-info-ai.gyo6.workers.dev";
  const CARD_URL = CONFIG.cardUrl || "https://gyo6.kr/card/kim-younghee/";
  const OWNER_STORAGE_KEY = CONFIG.ownerStorageKey || "gyo6.business-card.owner.kim-younghee";
  const CONTACT_MEDIA = CONFIG.contactMedia || {
    photo: "../../assets/card/kim-younghee-contact-executive-v5.jpg",
    logo: "https://gyo6.kr/brand/logo/png/app-icon-512.png"
  };
  const PROFILE = CONFIG.profile || {
    name: "김영희",
    organization: "유한회사 설탕과소금",
    title: "대표 · 이사",
    phone: "054-772-7576",
    email: "admin@gyo6.kr",
    address: "경북 경주시 원지길12번길 56-5, 1층"
  };
  const MODES = CONFIG.modes || {
    general: {
      label: "설탕과소금 대표",
      message: "교육의 경험을 AI와 디지털 시스템으로 확장합니다."
    },
    vocational: {
      label: "특성화고 교육지원 시스템",
      message: "30여 년의 교육 현장 경험으로 학교의 취업지원과 상담 업무를 더 가깝게 연결합니다."
    },
    exam: {
      label: "공직시험 연구소",
      message: "공직 진입에 필요한 학습과 평가 자료를 현장에 맞게 연구하고 체계화합니다."
    },
    studio: {
      label: "디지털 프로젝트 스튜디오",
      message: "교육 콘텐츠와 아이디어를 실제로 쓰이는 웹·앱·AI 서비스로 구현합니다."
    }
  };
  const QR_VARIANTS = CONFIG.qrVariants || {
    general: {
      image: "../../assets/card/qr-general.png",
      label: "기본 명함",
      description: "유한회사 설탕과소금 공식 명함",
      url: `${CARD_URL}?src=paper`
    },
    vocational: {
      image: "../../assets/card/qr-vocational.png",
      label: "특성화고 교육지원",
      description: "학교·교육청·교사 미팅",
      url: `${CARD_URL}?mode=vocational&src=vocational`
    },
    exam: {
      image: "../../assets/card/qr-exam.png",
      label: "공직시험 연구소",
      description: "수험·교재·평가 협력",
      url: `${CARD_URL}?mode=exam&src=exam`
    },
    studio: {
      image: "../../assets/card/qr-studio.png",
      label: "디지털 프로젝트 스튜디오",
      description: "웹·앱·AI 프로젝트 미팅",
      url: `${CARD_URL}?mode=studio&src=studio`
    }
  };

  const CARD_SLUG = CONFIG.cardSlug || "kim-younghee";
  const CONTACT_FILENAME = CONFIG.contactFilename || "kim-younghee-gyo6.vcf";
  const SHARE_TITLE = CONFIG.shareTitle || "김영희 대표·이사 | 유한회사 설탕과소금";
  const SHARE_TEXT = CONFIG.shareText || "유한회사 설탕과소금 김영희 대표·이사 디지털 명함";
  const INSTALL_NAME = CONFIG.installName || `${PROFILE.name} 명함`;
  const CONTACT_SUCCESS = CONFIG.contactSuccess || "공식 사진과 회사 정보가 포함된 연락처를 열었습니다.";
  const params = new URLSearchParams(window.location.search);
  const mode = Object.hasOwn(MODES, params.get("mode")) ? params.get("mode") : "general";
  const source = cleanParam(params.get("src"), 60) || "direct";
  const legacyOwnerRequested = params.get("owner") === "1";
  const ownerRequested = legacyOwnerRequested || source === "owner";
  let ownerStored = false;
  try {
    if (ownerRequested) window.localStorage.setItem(OWNER_STORAGE_KEY, "1");
    ownerStored = window.localStorage.getItem(OWNER_STORAGE_KEY) === "1";
  } catch {
    ownerStored = false;
  }
  const isOwnerView = ownerRequested || ownerStored;
  if (legacyOwnerRequested) {
    const stableOwnerUrl = new URL(window.location.href);
    stableOwnerUrl.searchParams.delete("owner");
    stableOwnerUrl.searchParams.set("src", "owner");
    window.history.replaceState(null, "", stableOwnerUrl);
  }
  const exchangeDialog = document.querySelector("[data-exchange-dialog]");
  const qrDialog = document.querySelector("[data-qr-dialog]");
  const installDialog = document.querySelector("[data-install-dialog]");
  const form = document.querySelector("[data-exchange-form]");
  const message = document.querySelector("[data-form-message]");
  const toast = document.querySelector("[data-toast]");
  let activeQrMode = mode;
  let installPromptEvent = null;
  let toastTimer = 0;

  applyMode();
  applyOwnerView();
  bindEvents();

  function applyMode() {
    const current = MODES[mode];
    const label = document.querySelector("[data-mode-label]");
    const modeMessage = document.querySelector("[data-mode-message]");
    if (label) label.textContent = current.label;
    if (modeMessage) modeMessage.textContent = current.message;

    document.querySelectorAll("[data-mode-link]").forEach((link) => {
      const targetMode = link.dataset.modeLink;
      const url = new URL(window.location.href);
      url.search = "";
      url.hash = "";
      url.searchParams.set("mode", targetMode);
      if (source !== "direct") url.searchParams.set("src", source);
      if (isOwnerView && !ownerStored) url.searchParams.set("owner", "1");
      link.href = url.toString();
      link.classList.toggle("is-active", targetMode === mode);
      if (targetMode === mode) link.setAttribute("aria-current", "true");
    });
  }

  function applyOwnerView() {
    const qrButton = document.querySelector("[data-show-qr]");
    const installButton = document.querySelector("[data-install-card]");
    if (qrButton) qrButton.hidden = !isOwnerView;
    if (installButton) installButton.hidden = !isOwnerView || isStandaloneApp();
    document.body.dataset.cardView = isOwnerView ? "owner" : "visitor";
  }

  function bindEvents() {
    document.querySelectorAll("[data-save-contact]").forEach((button) => {
      button.addEventListener("click", downloadVcard);
    });
    document.querySelectorAll("[data-open-exchange]").forEach((button) => {
      button.addEventListener("click", openExchange);
    });
    document.querySelector("[data-show-qr]")?.addEventListener("click", openQr);
    document.querySelector("[data-install-card]")?.addEventListener("click", installCardApp);
    document.querySelector("[data-close-exchange]")?.addEventListener("click", closeExchange);
    document.querySelector("[data-close-qr]")?.addEventListener("click", closeQr);
    document.querySelector("[data-close-install]")?.addEventListener("click", closeInstallDialog);
    document.querySelector("[data-share-card]")?.addEventListener("click", () => shareCard(mode));
    document.querySelector("[data-share-qr]")?.addEventListener("click", () => shareCard(activeQrMode, QR_VARIANTS[activeQrMode].url));
    document.querySelector("[data-copy-qr-url]")?.addEventListener("click", copyQrUrl);
    document.querySelectorAll("[data-qr-mode]").forEach((button) => {
      button.addEventListener("click", () => renderQr(button.dataset.qrMode));
    });
    exchangeDialog?.addEventListener("click", (event) => {
      if (event.target === exchangeDialog) closeExchange();
    });
    qrDialog?.addEventListener("click", (event) => {
      if (event.target === qrDialog) closeQr();
    });
    installDialog?.addEventListener("click", (event) => {
      if (event.target === installDialog) closeInstallDialog();
    });
    form?.addEventListener("submit", submitExchange);
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      installPromptEvent = event;
      applyOwnerView();
    });
    window.addEventListener("appinstalled", () => {
      installPromptEvent = null;
      applyOwnerView();
      showToast(`${INSTALL_NAME} 앱을 홈 화면에 설치했습니다.`);
    });
  }

  async function buildVcard() {
    const note = `${MODES[mode].label} | ${MODES[mode].message}`;
    const photo = await loadVcardImage(CONTACT_MEDIA.photo);
    const lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `FN:${escapeVcard(PROFILE.name)}`,
      `N:${escapeVcard(PROFILE.name)};;;;`,
      `ORG:${escapeVcard(PROFILE.organization)}`,
      `TITLE:${escapeVcard(PROFILE.title)}`,
      photo ? `PHOTO;ENCODING=b;TYPE=JPEG:${photo}` : "",
      `LOGO;VALUE=uri:${CONTACT_MEDIA.logo}`,
      `TEL;TYPE=CELL:${PROFILE.phone.replaceAll("-", "")}`,
      `EMAIL;TYPE=WORK:${PROFILE.email}`,
      `URL:${PROFILE.website || CARD_URL}`,
      PROFILE.vcardAddress ? `ADR;TYPE=WORK:${PROFILE.vcardAddress}` : `ADR;TYPE=WORK:;;${escapeVcard(PROFILE.address)};;;;대한민국`,
      `NOTE:${escapeVcard(note)}`,
      "END:VCARD"
    ].filter(Boolean);
    return `${lines.map(foldVcardLine).join("\r\n")}\r\n`;
  }

  async function downloadVcard() {
    const buttons = [...document.querySelectorAll("[data-save-contact]")];
    buttons.forEach((button) => { button.disabled = true; });
    showToast("공식 사진이 포함된 연락처를 준비하고 있습니다.");
    try {
      const blob = new Blob([await buildVcard()], { type: "text/vcard" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = CONTACT_FILENAME;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      showToast(CONTACT_SUCCESS);
    } catch {
      showToast("연락처 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  async function loadVcardImage(path) {
    try {
      const response = await fetch(new URL(path, document.baseURI));
      if (!response.ok) return "";
      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(String(reader.result || "").split(",")[1] || ""), { once: true });
        reader.addEventListener("error", () => reject(reader.error), { once: true });
        reader.readAsDataURL(blob);
      });
    } catch {
      return "";
    }
  }

  function foldVcardLine(line) {
    const encoder = new TextEncoder();
    if (encoder.encode(line).length <= 75) return line;
    const folded = [];
    let current = "";
    let byteLimit = 75;
    for (const character of line) {
      if (current && encoder.encode(current + character).length > byteLimit) {
        folded.push(folded.length ? ` ${current}` : current);
        current = character;
        byteLimit = 74;
      } else {
        current += character;
      }
    }
    if (current) folded.push(folded.length ? ` ${current}` : current);
    return folded.join("\r\n");
  }

  async function shareCard(sharedMode = mode, explicitUrl = "") {
    const shareUrl = explicitUrl || buildOfficialUrl(sharedMode, "share");
    const shareData = {
      title: SHARE_TITLE,
      text: MODES[sharedMode]?.shareText || SHARE_TEXT,
      url: shareUrl
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await copyText(shareUrl);
      showToast("디지털 명함 주소를 복사했습니다.");
    } catch (error) {
      if (error?.name !== "AbortError") showToast("주소를 복사하지 못했습니다.");
    }
  }

  function openExchange() {
    if (!exchangeDialog) return;
    if (typeof exchangeDialog.showModal === "function") {
      exchangeDialog.showModal();
    } else {
      exchangeDialog.setAttribute("open", "");
    }
    window.setTimeout(() => form?.elements.name?.focus({ preventScroll: true }), 0);
  }

  function closeExchange() {
    if (!exchangeDialog) return;
    if (typeof exchangeDialog.close === "function") exchangeDialog.close();
    else exchangeDialog.removeAttribute("open");
  }

  function openQr() {
    if (!qrDialog) return;
    renderQr(mode);
    if (typeof qrDialog.showModal === "function") qrDialog.showModal();
    else qrDialog.setAttribute("open", "");
  }

  function closeQr() {
    if (!qrDialog) return;
    if (typeof qrDialog.close === "function") qrDialog.close();
    else qrDialog.removeAttribute("open");
  }

  async function installCardApp() {
    if (isStandaloneApp()) {
      showToast("이미 홈 화면 명함 앱으로 실행 중입니다.");
      return;
    }
    if (installPromptEvent) {
      installPromptEvent.prompt();
      const choice = await installPromptEvent.userChoice;
      installPromptEvent = null;
      if (choice.outcome === "accepted") {
        showToast("명함 앱을 홈 화면에 추가하고 있습니다.");
      }
      return;
    }
    if (typeof installDialog?.showModal === "function") installDialog.showModal();
    else installDialog?.setAttribute("open", "");
  }

  function closeInstallDialog() {
    if (!installDialog) return;
    if (typeof installDialog.close === "function") installDialog.close();
    else installDialog.removeAttribute("open");
  }

  function isStandaloneApp() {
    return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function renderQr(nextMode) {
    if (!Object.hasOwn(QR_VARIANTS, nextMode)) return;
    activeQrMode = nextMode;
    const variant = QR_VARIANTS[nextMode];
    const image = document.querySelector("[data-qr-image]");
    if (image) {
      image.src = variant.image;
      image.alt = `${PROFILE.name} ${variant.label} 디지털 명함 QR`;
    }
    const label = document.querySelector("[data-qr-label]");
    const description = document.querySelector("[data-qr-description]");
    if (label) label.textContent = variant.label;
    if (description) description.textContent = variant.description;
    document.querySelectorAll("[data-qr-mode]").forEach((button) => {
      const selected = button.dataset.qrMode === nextMode;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  async function copyQrUrl() {
    try {
      await copyText(QR_VARIANTS[activeQrMode].url);
      showToast("선택한 명함 주소를 복사했습니다.");
    } catch {
      showToast("주소를 복사하지 못했습니다.");
    }
  }

  function buildOfficialUrl(selectedMode, selectedSource) {
    const url = new URL(CARD_URL);
    if (selectedMode !== "general") url.searchParams.set("mode", selectedMode);
    url.searchParams.set("src", selectedSource);
    return url.toString();
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) throw new Error("copy failed");
  }

  async function submitExchange(event) {
    event.preventDefault();
    if (!form || !message) return;

    const data = new FormData(form);
    const phone = data.get("phone")?.toString().trim() || "";
    const email = data.get("email")?.toString().trim() || "";
    if (!phone && !email) {
      setMessage("전화번호 또는 이메일 중 하나를 입력해 주세요.");
      form.elements.phone?.focus();
      return;
    }

    const submitButton = form.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;
    setMessage("명함을 안전하게 교환하는 중입니다.");

    try {
      const response = await fetch(`${API_BASE}/api/card/exchange`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          cardSlug: CARD_SLUG,
          name: data.get("name")?.toString() || "",
          phone,
          email,
          organization: data.get("organization")?.toString() || "",
          title: data.get("title")?.toString() || "",
          note: data.get("note")?.toString() || "",
          website: data.get("website")?.toString() || "",
          mode,
          source,
          consent: data.get("consent") === "yes",
          consentVersion: "card-exchange-2026-08-04"
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.error) {
        throw new Error(result.error || `명함 교환 오류 (${response.status})`);
      }

      form.reset();
      setMessage(`명함 교환이 완료되었습니다. ${PROFILE.name}님의 연락처도 저장해 주세요.`, true);
      downloadVcard();
      window.setTimeout(closeExchange, 1800);
    } catch (error) {
      setMessage(error.message || "명함을 교환하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  function setMessage(text, success = false) {
    if (!message) return;
    message.textContent = text;
    message.classList.toggle("is-success", success);
  }

  function showToast(text) {
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = text;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2800);
  }

  function escapeVcard(value) {
    return String(value || "")
      .replaceAll("\\", "\\\\")
      .replaceAll("\n", "\\n")
      .replaceAll(";", "\\;")
      .replaceAll(",", "\\,");
  }

  function cleanParam(value, maxLength) {
    return String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .slice(0, maxLength);
  }
})();
