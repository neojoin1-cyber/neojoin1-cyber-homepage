const CAMPAIGN_ID = "fair-start-partnership-202608";
const CAMPAIGN_LINK = "partners.html?from=popup";

showPartnershipPopup();

function showPartnershipPopup() {
  if (hasSeen()) return;

  const layer = document.createElement("div");
  layer.className = "board-home-popup partnership-popup";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", "설탕과소금 제휴기관 모집 안내");
  layer.innerHTML = `
    <div class="board-home-popup-dialog">
      <button class="board-home-popup-close" type="button" aria-label="팝업 닫기">×</button>
      <a class="partnership-popup-art" href="${CAMPAIGN_LINK}" aria-label="설탕과소금 제휴기관 모집 자세히 보기">
        <picture>
          <source media="(max-width: 620px)" srcset="assets/partnership-fair-start-mobile.webp">
          <img src="assets/partnership-fair-start-desktop.webp" width="1672" height="941" alt="공정한 출발선을 함께 넓히는 설탕과소금 제휴기관 모집. 구매자 10퍼센트 추가 할인, 판매액 20퍼센트 제휴기관 발전금">
        </picture>
      </a>
      <div class="board-home-popup-actions">
        <a class="btn primary" href="${CAMPAIGN_LINK}">제휴 안내 자세히 보기</a>
        <button class="btn" type="button" data-popup-close>닫기</button>
      </div>
    </div>`;

  const previousFocus = document.activeElement;
  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    layer.remove();
    previousFocus?.focus?.();
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") close();
  };

  layer.addEventListener("click", (event) => {
    if (event.target === layer || event.target.closest(".board-home-popup-close,[data-popup-close]")) close();
  });
  document.addEventListener("keydown", onKeydown);
  document.body.append(layer);
  markSeen();
  layer.querySelector(".board-home-popup-close")?.focus();
}

function hasSeen() {
  try { return localStorage.getItem(`gyo6-campaign-popup:${CAMPAIGN_ID}`) === "seen"; } catch { return false; }
}

function markSeen() {
  try { localStorage.setItem(`gyo6-campaign-popup:${CAMPAIGN_ID}`, "seen"); } catch { /* no-op */ }
}
