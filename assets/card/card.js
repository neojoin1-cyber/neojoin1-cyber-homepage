(function () {
  "use strict";

  const API_BASE = "https://gyo6-law-info-ai.gyo6.workers.dev";
  const CARD_URL = "https://gyo6.kr/card/kim-younghee/";
  const PROFILE = {
    name: "김영희",
    organization: "유한회사 설탕과소금",
    title: "대표 · 이사",
    phone: "010-3534-7163",
    email: "admin@gyo6.kr",
    address: "경북 경주시 원지길12번길 56-5, 1층"
  };
  const MODES = {
    general: {
      label: "설탕과소금 대표",
      message: "교육 현장의 경험을 연구와 기술로 이어갑니다."
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
  const QR_VARIANTS = {
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

  const params = new URLSearchParams(window.location.search);
  const mode = Object.hasOwn(MODES, params.get("mode")) ? params.get("mode") : "general";
  const source = cleanParam(params.get("src"), 60) || "direct";
  const exchangeDialog = document.querySelector("[data-exchange-dialog]");
  const qrDialog = document.querySelector("[data-qr-dialog]");
  const form = document.querySelector("[data-exchange-form]");
  const message = document.querySelector("[data-form-message]");
  const toast = document.querySelector("[data-toast]");
  let activeQrMode = mode;
  let toastTimer = 0;

  applyMode();
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
      link.href = url.toString();
      link.classList.toggle("is-active", targetMode === mode);
      if (targetMode === mode) link.setAttribute("aria-current", "true");
    });
  }

  function bindEvents() {
    document.querySelectorAll("[data-save-contact]").forEach((button) => {
      button.addEventListener("click", downloadVcard);
    });
    document.querySelectorAll("[data-open-exchange]").forEach((button) => {
      button.addEventListener("click", openExchange);
    });
    document.querySelector("[data-show-qr]")?.addEventListener("click", openQr);
    document.querySelector("[data-close-exchange]")?.addEventListener("click", closeExchange);
    document.querySelector("[data-close-qr]")?.addEventListener("click", closeQr);
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
    form?.addEventListener("submit", submitExchange);
  }

  function buildVcard() {
    const note = `${MODES[mode].label} | ${MODES[mode].message}`;
    return [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `FN:${escapeVcard(PROFILE.name)}`,
      `N:${escapeVcard(PROFILE.name)};;;;`,
      `ORG:${escapeVcard(PROFILE.organization)}`,
      `TITLE:${escapeVcard(PROFILE.title)}`,
      `TEL;TYPE=CELL:${PROFILE.phone.replaceAll("-", "")}`,
      `EMAIL;TYPE=WORK:${PROFILE.email}`,
      `URL:${CARD_URL}`,
      `ADR;TYPE=WORK:;;${escapeVcard("원지길12번길 56-5, 1층")};경주시;경북;;대한민국`,
      `NOTE:${escapeVcard(note)}`,
      "END:VCARD"
    ].join("\r\n");
  }

  function downloadVcard() {
    const blob = new Blob(["\ufeff", buildVcard()], { type: "text/vcard;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "김영희_설탕과소금.vcf";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("김영희 대표의 연락처 파일을 열었습니다.");
  }

  async function shareCard(sharedMode = mode, explicitUrl = "") {
    const shareUrl = explicitUrl || buildOfficialUrl(sharedMode, "share");
    const shareData = {
      title: "김영희 대표·이사 | 유한회사 설탕과소금",
      text: `${MODES[sharedMode].label} · 유한회사 설탕과소금 김영희 대표`,
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

  function renderQr(nextMode) {
    if (!Object.hasOwn(QR_VARIANTS, nextMode)) return;
    activeQrMode = nextMode;
    const variant = QR_VARIANTS[nextMode];
    const image = document.querySelector("[data-qr-image]");
    if (image) {
      image.src = variant.image;
      image.alt = `김영희 대표 ${variant.label} 디지털 명함 QR`;
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
          cardSlug: "kim-younghee",
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
      setMessage("명함 교환이 완료되었습니다. 김영희 대표의 연락처도 저장해 주세요.", true);
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
