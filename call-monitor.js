/**
 * 监测 FB 通话意外挂断（非用户主动挂断），屏幕中央大弹窗提醒
 */
(function () {
  if (globalThis.__fbCallMonitorLoaded) return;
  globalThis.__fbCallMonitorLoaded = true;

  const MODAL_ID = "fb-group-link-finder-hangup-modal";
  const USER_LEAVE_GRACE_MS = 5000;
  const ACTIVE_CONFIRM_MS = 2500;
  const POLL_MS = 800;

  const ENDED_TEXT_RE =
    /call ended|call has ended|通话已结束|通话结束|已结束通话|连接已断开|连接中断|disconnected|you left the call|你已离开|对方已挂断|no longer in this call|不在通话|通话不可用|removed from the call|被移出|call was ended|通话意外|连接失败|reconnect/i;

  const HANGUP_CLICK_RE =
    /hang up|end call|leave call|leave meeting|挂断|离开通话|结束通话|decline call|拒绝通话|退出通话|离开会议/i;

  let callWasActive = false;
  let callActiveSince = 0;
  let pendingActiveTimer = null;
  let userInitiatedLeave = false;
  let userLeaveTimer = null;
  let pollTimer = null;
  let lastHangupAlertAt = 0;
  let sessionDismissed = false;

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

  function isCallContext() {
    const pathQuery = location.pathname + location.search;
    return /groupcall|\/call|videochat|voicechat|livestream|\/t\/\d+/i.test(pathQuery);
  }

  function getVisibleText() {
    return (document.body?.innerText || "").slice(0, 8000);
  }

  function hasEndedText() {
    return ENDED_TEXT_RE.test(getVisibleText());
  }

  function hasLiveMedia() {
    const videos = document.querySelectorAll("video");
    for (const video of videos) {
      if (video.srcObject || video.readyState > 0 || !video.paused) {
        return true;
      }
    }
    return document.querySelectorAll("audio[srcObject], audio:not([paused])").length > 0;
  }

  function hasCallControls() {
    const selectors = [
      '[aria-label*="Hang up" i]',
      '[aria-label*="挂断" i]',
      '[aria-label*="End call" i]',
      '[aria-label*="结束" i]',
      '[data-testid*="call" i]',
    ];
    return selectors.some((sel) => document.querySelector(sel));
  }

  function isCallCurrentlyActive() {
    if (hasEndedText()) return false;
    if (hasLiveMedia()) return true;
    if (hasCallControls()) return true;
    if (isCallContext() && !hasEndedText()) {
      return callWasActive;
    }
    return false;
  }

  function markUserLeave() {
    userInitiatedLeave = true;
    clearTimeout(userLeaveTimer);
    userLeaveTimer = setTimeout(() => {
      userInitiatedLeave = false;
    }, USER_LEAVE_GRACE_MS);
  }

  function getClickLabel(target) {
    let node = target;
    for (let i = 0; i < 8 && node; i++) {
      if (!(node instanceof Element)) break;
      const parts = [
        node.getAttribute("aria-label"),
        node.getAttribute("title"),
        node.textContent,
      ].filter(Boolean);
      const label = parts.join(" ").trim();
      if (label) return label;
      node = node.parentElement;
    }
    return "";
  }

  function onDocumentClick(event) {
    const label = getClickLabel(event.target);
    if (HANGUP_CLICK_RE.test(label)) {
      markUserLeave();
    }
  }

  function buildHangupMessage(copyGroupAlert) {
    const lines = [
      "Facebook 通话已意外断开（并非你主动挂断）。",
      "常见原因：有人在通话中邀请了组外成员导致复制组、网络中断，或主持人结束通话。",
    ];
    if (copyGroupAlert?.detected) {
      lines.push("");
      lines.push("⚠️ 同时检测到可能出现复制组，原组通话可能已被替换。");
      if (copyGroupAlert.copyThread?.url) {
        lines.push(`复制组链接：${copyGroupAlert.copyThread.url}`);
      }
    } else {
      lines.push("");
      lines.push("建议：点击插件图标解析当前页面，查找对应群聊链接。");
    }
    return lines.join("\n");
  }

  function showCenterHangupModal(message, copyUrl) {
    if (sessionDismissed || document.getElementById(MODAL_ID)) return;

    const now = Date.now();
    if (now - lastHangupAlertAt < 3000) return;
    lastHangupAlertAt = now;

    const overlay = document.createElement("div");
    overlay.id = MODAL_ID;
    overlay.setAttribute("data-fb-group-link-finder", "hangup-modal");
    overlay.innerHTML = `
      <style>
        #${MODAL_ID} {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.62);
          pointer-events: auto;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", sans-serif;
        }
        #${MODAL_ID} .fb-hangup-card {
          width: min(520px, calc(100vw - 40px));
          background: #fff;
          color: #1c1e21;
          border-radius: 18px;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
          padding: 28px 28px 22px;
          text-align: center;
        }
        #${MODAL_ID} .fb-hangup-icon {
          font-size: 52px;
          line-height: 1;
          margin-bottom: 10px;
        }
        #${MODAL_ID} .fb-hangup-title {
          margin: 0 0 12px;
          font-size: 24px;
          font-weight: 700;
          color: #b42318;
        }
        #${MODAL_ID} .fb-hangup-body {
          margin: 0;
          font-size: 15px;
          line-height: 1.65;
          color: #3b3f45;
          white-space: pre-wrap;
          text-align: left;
        }
        #${MODAL_ID} .fb-hangup-actions {
          display: flex;
          gap: 10px;
          justify-content: center;
          margin-top: 22px;
          flex-wrap: wrap;
        }
        #${MODAL_ID} button {
          border: none;
          border-radius: 10px;
          padding: 12px 18px;
          font-size: 15px;
          cursor: pointer;
        }
        #${MODAL_ID} [data-copy] {
          background: #1877f2;
          color: #fff;
        }
        #${MODAL_ID} [data-close] {
          background: #e4e6eb;
          color: #050505;
        }
      </style>
      <div class="fb-hangup-card" role="alertdialog" aria-modal="true" aria-labelledby="fb-hangup-title">
        <div class="fb-hangup-icon">📞</div>
        <h2 class="fb-hangup-title" id="fb-hangup-title">通话意外挂断</h2>
        <p class="fb-hangup-body">${escapeHtml(message)}</p>
        <div class="fb-hangup-actions">
          ${copyUrl ? `<button type="button" data-copy>复制群聊链接</button>` : ""}
          <button type="button" data-close>关闭</button>
        </div>
      </div>
    `;

    const closeModal = () => {
      sessionDismissed = true;
      overlay.remove();
    };

    overlay.querySelector("[data-close]")?.addEventListener(
      "click",
      (event) => {
        stopEvent(event);
        closeModal();
      },
      true
    );

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

    overlay.addEventListener(
      "click",
      (event) => {
        if (event.target === overlay) closeModal();
      },
      true
    );

    document.documentElement.appendChild(overlay);

    try {
      chrome.runtime.sendMessage({
        type: "UNEXPECTED_HANGUP",
        pageUrl: location.href,
      });
    } catch {
      // ignore
    }
  }

  function handleUnexpectedHangup() {
    if (userInitiatedLeave || sessionDismissed) {
      callWasActive = false;
      callActiveSince = 0;
      return;
    }

    let copyGroupAlert = { detected: false };
    let copyUrl = "";

    if (globalThis.FBGroupLinkExtractor) {
      const analysis = FBGroupLinkExtractor.analyzeDocument(document, location.href);
      copyGroupAlert = analysis.copyGroupAlert || copyGroupAlert;
      const best = FBGroupLinkExtractor.pickBestResult(analysis.items, copyGroupAlert);
      copyUrl = copyGroupAlert.copyThread?.url || best?.url || "";
    }

    showCenterHangupModal(buildHangupMessage(copyGroupAlert), copyUrl);
    callWasActive = false;
    callActiveSince = 0;
  }

  function onCallStateTick() {
    const activeNow = isCallCurrentlyActive();

    if (activeNow && !callWasActive) {
      if (!pendingActiveTimer) {
        pendingActiveTimer = setTimeout(() => {
          pendingActiveTimer = null;
          if (isCallCurrentlyActive()) {
            callWasActive = true;
            callActiveSince = Date.now();
            sessionDismissed = false;
          }
        }, ACTIVE_CONFIRM_MS);
      }
      return;
    }

    clearTimeout(pendingActiveTimer);
    pendingActiveTimer = null;

    if (callWasActive && !activeNow) {
      const duration = Date.now() - callActiveSince;
      if (duration >= ACTIVE_CONFIRM_MS) {
        handleUnexpectedHangup();
      } else {
        callWasActive = false;
        callActiveSince = 0;
      }
    }
  }

  function startMonitoring() {
    if (!isCallContext()) return;

    document.addEventListener("click", onDocumentClick, true);

    pollTimer = setInterval(onCallStateTick, POLL_MS);
    onCallStateTick();

    const observer = new MutationObserver(() => {
      onCallStateTick();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

    window.addEventListener("beforeunload", () => {
      if (callWasActive && !userInitiatedLeave) {
        sessionStorage.setItem("fb-hangup-pending", String(Date.now()));
      }
    });

    const pending = sessionStorage.getItem("fb-hangup-pending");
    if (pending && Date.now() - Number(pending) < 15000) {
      sessionStorage.removeItem("fb-hangup-pending");
      setTimeout(handleUnexpectedHangup, 500);
    }
  }

  startMonitoring();
})();
