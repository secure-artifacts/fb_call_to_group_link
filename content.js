(function () {
  if (globalThis.__fbGroupLinkFinderLoaded) return;
  globalThis.__fbGroupLinkFinderLoaded = true;

  const BADGE_ID = "fb-group-link-finder-badge";
  const COPY_MODAL_ID = "fb-group-link-finder-copy-modal";

  let lastAlertKey = "";
  let dismissedBadgeUrl = "";
  let dismissedCopyKey = "";
  let scanQueued = false;
  let observer = null;

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function bindPanelActions(root, url, onClose) {
    const copyBtn = root.querySelector("[data-copy]");
    const closeBtn = root.querySelector("[data-close]");

    const handleCopy = async (event) => {
      stopEvent(event);
      if (!copyBtn || !url) return;
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.textContent = "已复制";
      } catch {
        copyBtn.textContent = "复制失败";
      }
    };

    const handleClose = (event) => {
      stopEvent(event);
      onClose?.();
      root.remove();
    };

    for (const btn of [copyBtn, closeBtn]) {
      if (!btn) continue;
      btn.addEventListener("pointerdown", stopEvent, true);
      btn.addEventListener("mousedown", stopEvent, true);
    }

    copyBtn?.addEventListener("click", handleCopy, true);
    closeBtn?.addEventListener("click", handleClose, true);
  }

  function showCopyGroupCenterModal(alert, copyItem) {
    if (!alert?.detected) return;

    const alertKey = `${alert.copyThread?.id || ""}:${alert.originalThread?.id || ""}`;
    if (alertKey && alertKey === dismissedCopyKey) return;
    if (alertKey && alertKey === lastAlertKey && document.getElementById(COPY_MODAL_ID)) return;
    lastAlertKey = alertKey;

    document.getElementById(COPY_MODAL_ID)?.remove();

    const copyUrl = alert.copyThread?.url || copyItem?.url || "";
    const originalName = alert.originalThread?.name || "未能识别名称";
    const originalUrl = alert.originalThread?.url || "";
    const copyName = alert.copyThread?.name || "未能识别名称";

    const headline = alert.originalThread
      ? `原小组「${originalName}」已被生成复制组`
      : `检测到复制组（正在识别原小组信息）`;

    const overlay = document.createElement("div");
    overlay.id = COPY_MODAL_ID;
    overlay.setAttribute("data-fb-group-link-finder", "copy-modal");
    overlay.innerHTML = `
      <style>
        #${COPY_MODAL_ID} {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.65);
          pointer-events: auto;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", sans-serif;
        }
        #${COPY_MODAL_ID} .fb-copy-card {
          width: min(560px, calc(100vw - 40px));
          background: #fff;
          color: #1c1e21;
          border-radius: 18px;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.38);
          padding: 28px 28px 22px;
        }
        #${COPY_MODAL_ID} .fb-copy-icon {
          font-size: 48px;
          text-align: center;
          margin-bottom: 8px;
        }
        #${COPY_MODAL_ID} .fb-copy-title {
          margin: 0 0 10px;
          font-size: 24px;
          font-weight: 700;
          color: #b42318;
          text-align: center;
          line-height: 1.35;
        }
        #${COPY_MODAL_ID} .fb-copy-sub {
          margin: 0 0 16px;
          font-size: 15px;
          line-height: 1.6;
          color: #3b3f45;
          text-align: center;
        }
        #${COPY_MODAL_ID} .fb-copy-section {
          background: #f7f8fa;
          border-radius: 12px;
          padding: 14px;
          margin-bottom: 12px;
        }
        #${COPY_MODAL_ID} .fb-copy-section strong {
          display: block;
          font-size: 14px;
          margin-bottom: 6px;
          color: #050505;
        }
        #${COPY_MODAL_ID} .fb-copy-section.original strong { color: #0a58ca; }
        #${COPY_MODAL_ID} .fb-copy-section.copy strong { color: #b42318; }
        #${COPY_MODAL_ID} .fb-copy-name {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 6px;
        }
        #${COPY_MODAL_ID} a {
          color: #1877f2;
          word-break: break-all;
          font-size: 13px;
        }
        #${COPY_MODAL_ID} .fb-copy-actions {
          display: flex;
          gap: 10px;
          justify-content: center;
          margin-top: 18px;
          flex-wrap: wrap;
        }
        #${COPY_MODAL_ID} button {
          border: none;
          border-radius: 10px;
          padding: 12px 18px;
          font-size: 15px;
          cursor: pointer;
        }
        #${COPY_MODAL_ID} [data-copy] { background: #1877f2; color: #fff; }
        #${COPY_MODAL_ID} [data-copy-original] { background: #e7f3ff; color: #0a58ca; }
        #${COPY_MODAL_ID} [data-close] { background: #e4e6eb; color: #050505; }
      </style>
      <div class="fb-copy-card" role="alertdialog" aria-modal="true">
        <div class="fb-copy-icon">⚠️</div>
        <h2 class="fb-copy-title">${escapeHtml(headline)}</h2>
        <p class="fb-copy-sub">${escapeHtml(alert.summary || "有人在通话中邀请了组外成员。下方会分别给出原小组与复制组的名称和链接。")}</p>
        <div class="fb-copy-section original">
          <strong>被复制的原小组</strong>
          <div class="fb-copy-name">${escapeHtml(originalName)}</div>
          ${
            originalUrl
              ? `<a href="${originalUrl}" target="_blank" rel="noopener">${originalUrl}</a>`
              : `<p style="margin:0;font-size:13px;color:#65676b;">原小组链接暂未识别，请稍后再次解析或查看插件结果列表。</p>`
          }
        </div>
        <div class="fb-copy-section copy">
          <strong>新生成的复制组</strong>
          <div class="fb-copy-name">${escapeHtml(copyName)}</div>
          ${
            copyUrl
              ? `<a href="${copyUrl}" target="_blank" rel="noopener">${copyUrl}</a>`
              : `<p style="margin:0;font-size:13px;color:#65676b;">复制组链接暂未识别。</p>`
          }
        </div>
        <div class="fb-copy-actions">
          ${copyUrl ? `<button type="button" data-copy>复制复制组链接</button>` : ""}
          ${originalUrl ? `<button type="button" data-copy-original>复制原小组链接</button>` : ""}
          <button type="button" data-close>关闭</button>
        </div>
      </div>
    `;

    const closeModal = () => {
      dismissedCopyKey = alertKey;
      overlay.remove();
    };

    overlay.querySelector("[data-close]")?.addEventListener("click", closeModal, true);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModal();
    }, true);

    overlay.querySelector("[data-copy]")?.addEventListener(
      "click",
      async (event) => {
        stopEvent(event);
        try {
          await navigator.clipboard.writeText(copyUrl);
          overlay.querySelector("[data-copy]").textContent = "已复制";
        } catch {
          overlay.querySelector("[data-copy]").textContent = "复制失败";
        }
      },
      true
    );

    overlay.querySelector("[data-copy-original]")?.addEventListener(
      "click",
      async (event) => {
        stopEvent(event);
        try {
          await navigator.clipboard.writeText(originalUrl);
          overlay.querySelector("[data-copy-original]").textContent = "已复制";
        } catch {
          overlay.querySelector("[data-copy-original]").textContent = "复制失败";
        }
      },
      true
    );

    document.documentElement.appendChild(overlay);

    if (copyUrl) {
      navigator.clipboard.writeText(copyUrl).catch(() => {});
    }

    chrome.runtime.sendMessage({
      type: "COPY_GROUP_ALERT",
      alert,
      pageUrl: location.href,
    });
  }

  function showBadge(item) {
    if (!item?.url) return;
    if (item.url === dismissedBadgeUrl) return;
    if (document.getElementById(COPY_MODAL_ID)) return;
    if (document.getElementById(BADGE_ID)) return;

    const roleLine =
      item.role === "copy"
        ? `<div style="font-size:12px;margin-top:4px;">角色：复制组${item.groupName ? ` · ${escapeHtml(item.groupName)}` : ""}</div>`
        : item.role === "original"
          ? `<div style="font-size:12px;margin-top:4px;">角色：原组${item.groupName ? ` · ${escapeHtml(item.groupName)}` : ""}</div>`
          : "";
    const hintLine = item.hint ? `<div style="opacity:.9;font-size:12px;margin-top:4px;">${escapeHtml(item.hint)}</div>` : "";

    const badge = document.createElement("div");
    badge.id = BADGE_ID;
    badge.setAttribute("data-fb-group-link-finder", "badge");
    badge.innerHTML = `
      <style>
        #${BADGE_ID} {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 2147483646;
          background: #1877f2;
          color: #fff;
          padding: 12px 16px;
          border-radius: 10px;
          box-shadow: 0 4px 16px rgba(0,0,0,.25);
          font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          max-width: 320px;
          pointer-events: auto;
        }
        #${BADGE_ID} a { color: #fff; word-break: break-all; pointer-events: auto; }
        #${BADGE_ID} button {
          margin-top: 8px;
          margin-right: 6px;
          border: none;
          border-radius: 6px;
          padding: 6px 10px;
          cursor: pointer;
          background: rgba(255,255,255,.2);
          color: #fff;
          pointer-events: auto;
        }
      </style>
      <strong>已找到群聊链接</strong>
      ${roleLine}
      ${hintLine}
      <a href="${item.url}" target="_blank" rel="noopener">${item.url}</a>
      <div>
        <button type="button" data-copy>复制链接</button>
        <button type="button" data-close>关闭</button>
      </div>
    `;

    bindPanelActions(badge, item.url, () => {
      dismissedBadgeUrl = item.url;
    });

    document.documentElement.appendChild(badge);
  }

  function scanPage() {
    const { items, copyGroupAlert } = FBGroupLinkExtractor.analyzeDocument(document, location.href);
    const best = FBGroupLinkExtractor.pickBestResult(items, copyGroupAlert);

    if (copyGroupAlert.detected) {
      showCopyGroupCenterModal(copyGroupAlert, best);
    } else {
      FBGroupLinkExtractor.saveOriginalGroupContext(items);
      if (best) {
        showBadge(best);
      }
    }

    return { items, copyGroupAlert };
  }

  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      if (document.getElementById(BADGE_ID) || document.getElementById(COPY_MODAL_ID)) {
        return;
      }
      scanPage();
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "EXTRACT_GROUP_LINK") {
      sendResponse({ ok: true, ...scanPage() });
      return true;
    }
    return false;
  });

  const isCallPage =
    /groupcall|\/call|videochat|voicechat|livestream|\/t\/\d+/i.test(location.pathname + location.search);

  if (isCallPage) {
    scanPage();
    observer = new MutationObserver((mutations) => {
      const fromOurPanel = mutations.some((mutation) =>
        [...mutation.addedNodes, ...mutation.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.id === BADGE_ID ||
              node.id === COPY_MODAL_ID ||
              node.id === "fb-group-link-finder-hangup-modal" ||
              node.closest?.(`#${BADGE_ID}, #${COPY_MODAL_ID}, #fb-group-link-finder-hangup-modal`) ||
              node.getAttribute?.("data-fb-group-link-finder"))
        )
      );
      if (fromOurPanel) return;
      scheduleScan();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer?.disconnect(), 120000);
  }
})();
