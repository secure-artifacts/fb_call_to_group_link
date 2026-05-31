(function () {
  if (globalThis.__fbGroupLinkFinderLoaded) return;
  globalThis.__fbGroupLinkFinderLoaded = true;

  const BADGE_ID = "fb-group-link-finder-badge";
  const WARN_ID = "fb-group-link-finder-warn";

  let lastAlertKey = "";
  let dismissedBadgeUrl = "";
  let dismissedWarnKey = "";
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

  function showCopyGroupWarning(alert, copyItem) {
    if (!alert?.detected) return;

    const alertKey = `${alert.copyThread?.id || ""}:${alert.originalThread?.id || ""}`;
    if (alertKey && alertKey === dismissedWarnKey) return;
    if (alertKey && alertKey === lastAlertKey && document.getElementById(WARN_ID)) return;
    lastAlertKey = alertKey;

    document.getElementById(WARN_ID)?.remove();

    const copyUrl = alert.copyThread?.url || copyItem?.url || "";
    const originalBlock = alert.originalThread?.url
      ? `<div style="margin-top:8px;"><strong>原组：</strong>${escapeHtml(alert.originalThread.name)}<br><a href="${alert.originalThread.url}" target="_blank" rel="noopener">${alert.originalThread.url}</a></div>`
      : "";

    const warn = document.createElement("div");
    warn.id = WARN_ID;
    warn.setAttribute("data-fb-group-link-finder", "warn");
    warn.innerHTML = `
      <style>
        #${WARN_ID} {
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 2147483647;
          background: #b42318;
          color: #fff;
          padding: 14px 16px;
          border-radius: 10px;
          box-shadow: 0 6px 24px rgba(0,0,0,.35);
          font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          max-width: 360px;
          pointer-events: auto;
        }
        #${WARN_ID} strong.title { display: block; font-size: 15px; margin-bottom: 6px; }
        #${WARN_ID} a { color: #fff; word-break: break-all; pointer-events: auto; }
        #${WARN_ID} button {
          margin-top: 10px;
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
      <strong class="title">⚠️ 检测到复制组通话</strong>
      <div>${escapeHtml(alert.summary)}</div>
      <div style="margin-top:8px;"><strong>复制组：</strong>${escapeHtml(alert.copyThread?.name || "未知")}<br><a href="${copyUrl}" target="_blank" rel="noopener">${copyUrl}</a></div>
      ${originalBlock}
      <div>
        <button type="button" data-copy>复制复制组链接</button>
        <button type="button" data-close>关闭</button>
      </div>
    `;

    bindPanelActions(warn, copyUrl, () => {
      dismissedWarnKey = alertKey;
    });

    document.documentElement.appendChild(warn);

    chrome.runtime.sendMessage({
      type: "COPY_GROUP_ALERT",
      alert,
      pageUrl: location.href,
    });
  }

  function showBadge(item) {
    if (!item?.url) return;
    if (item.url === dismissedBadgeUrl) return;
    if (document.getElementById(WARN_ID)) return;
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
      showCopyGroupWarning(copyGroupAlert, best);
    } else if (best) {
      showBadge(best);
    }

    return { items, copyGroupAlert };
  }

  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      if (document.getElementById(BADGE_ID) || document.getElementById(WARN_ID)) {
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
              node.id === WARN_ID ||
              node.id === "fb-group-link-finder-hangup-modal" ||
              node.closest?.(`#${BADGE_ID}, #${WARN_ID}, #fb-group-link-finder-hangup-modal`) ||
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
