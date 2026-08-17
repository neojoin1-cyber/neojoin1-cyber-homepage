const CAMPAIGN_ID = "national-7-free-mock-202608";
const CAMPAIGN_LINK = "exam-service.html?service=civil&free=1&from=popup";

showFreeMockPopup();

function showFreeMockPopup() {
  if (hasSeen()) return;

  const layer = document.createElement("div");
  layer.className = "board-home-popup free-mock-popup";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-labelledby", "free-mock-popup-title");
  layer.innerHTML = `
    <div class="board-home-popup-dialog">
      <button class="board-home-popup-close" type="button" aria-label="팝업 닫기">×</button>
      <div class="free-mock-popup-visual" aria-hidden="true"><span>7급</span><i>국가직</i></div>
      <div class="free-mock-popup-copy">
        <span class="free-mock-popup-label">로그인 없이 무료</span>
        <p>2026 국가직 7급 필기시험</p>
        <h2 id="free-mock-popup-title">실전 모의고사를<br>먼저 풀어보세요.</h2>
        <div class="free-mock-popup-subjects"><span>헌법</span><span>경제학</span><span>행정학</span><span>행정법</span></div>
        <small>과목별 표준 모의고사 1회 · 자동 채점과 해설 제공</small>
      </div>
      <div class="board-home-popup-actions">
        <a class="btn primary" href="${CAMPAIGN_LINK}">무료 모의고사 시작하기</a>
        <button class="btn" type="button" data-popup-close>다음에 보기</button>
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
