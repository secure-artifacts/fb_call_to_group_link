/**
 * 共享 UI 工具（content / call-monitor 共用）
 */
(function (global) {
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

  function bindModalActions(overlay, { onClose, copyHandlers = [] }) {
    overlay.querySelector("[data-close]")?.addEventListener(
      "click",
      (event) => {
        stopEvent(event);
        onClose?.();
      },
      true
    );

    overlay.addEventListener(
      "click",
      (event) => {
        if (event.target === overlay) onClose?.();
      },
      true
    );

    for (const { selector, url } of copyHandlers) {
      overlay.querySelector(selector)?.addEventListener(
        "click",
        async (event) => {
          stopEvent(event);
          const btn = overlay.querySelector(selector);
          if (!btn || !url) return;
          try {
            await navigator.clipboard.writeText(url);
            btn.textContent = "已复制";
          } catch {
            btn.textContent = "复制失败";
          }
        },
        true
      );
    }
  }

  function isOurPanelNode(node) {
    if (!(node instanceof Element)) return false;
    if (node.getAttribute?.("data-fb-group-link-finder")) return true;
    return Boolean(node.closest?.("[data-fb-group-link-finder]"));
  }

  global.FBGroupLinkUI = {
    escapeHtml,
    stopEvent,
    bindModalActions,
    isOurPanelNode,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
