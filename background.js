const ALERT_STORAGE_KEY = "lastCopyGroupAlert";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "COPY_GROUP_ALERT") {
    const alert = message.alert;
    if (!alert?.detected) return;

    const copyName = alert.copyThread?.name || "复制组";
    const originalName = alert.originalThread?.name || "原组";
    const title = "⚠️ 原组已被生成复制组";
    const messageText = alert.originalThread
      ? `原小组「${originalName}」\n名称：${originalName}\n链接：${alert.originalThread.url || "未知"}\n复制组：${copyName}`
      : `检测到复制组：${copyName}`;

    chrome.storage.local.set({
      [ALERT_STORAGE_KEY]: {
        ...alert,
        detectedAt: Date.now(),
        pageUrl: message.pageUrl || "",
      },
    });

    chrome.notifications.create(`copy-group-${alert.copyThread?.id || Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message: messageText,
      priority: 2,
    });

    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "UNEXPECTED_HANGUP") {
    chrome.notifications.create(`unexpected-hangup-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "📞 FB 通话意外挂断",
      message: "通话已意外断开，请查看页面中央提示。",
      priority: 2,
    });
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
