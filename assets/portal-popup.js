const POPUP_API = "https://gyo6-law-info-ai.gyo6.workers.dev/api/boards?room=promotion&popup=1";
const POPUP_API_ORIGIN = new URL(POPUP_API).origin;

showLatestBoardPopup();

async function showLatestBoardPopup() {
  try {
    const response = await fetch(POPUP_API, { headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) return;

    const post = (Array.isArray(data.posts) ? data.posts : []).find((item) => {
      const image = Array.isArray(item.attachments) && item.attachments.find((attachment) => attachment.isImage);
      return item.isPopup && image && !hasSeen(item);
    });
    if (!post) return;

    const image = post.attachments.find((attachment) => attachment.isImage);
    markSeen(post);
    renderPopup(post, image);
  } catch {
    // The homepage remains fully usable when the optional notice cannot load.
  }
}

function renderPopup(post, image) {
  const layer = document.createElement("div");
  layer.className = "board-home-popup";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", post.title || "설탕과소금 새 소식");
  layer.innerHTML = `
    <div class="board-home-popup-dialog">
      <button class="board-home-popup-close" type="button" aria-label="팝업 닫기">×</button>
      <img class="board-home-popup-image" src="${escapeHtml(new URL(image.url, POPUP_API_ORIGIN).toString())}" alt="${escapeHtml(image.name || post.title || "설탕과소금 새 소식")}">
      <div class="board-home-popup-actions">
        <a class="btn primary" href="boards.html">게시물 보기</a>
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
  layer.querySelector(".board-home-popup-close")?.focus();
}

function popupKey(post) {
  return `gyo6-board-popup:${post.id}:${post.updatedAt || post.createdAt || "1"}`;
}

function hasSeen(post) {
  try { return localStorage.getItem(popupKey(post)) === "seen"; } catch { return false; }
}

function markSeen(post) {
  try { localStorage.setItem(popupKey(post), "seen"); } catch { /* no-op */ }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
