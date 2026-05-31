const ALERT_STORAGE_KEY = "lastCopyGroupAlert";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "COPY_GROUP_ALERT") {
    const alert = message.alert;
    if (!alert?.detected) return;

    const copyName = alert.copyThread?.name || "复制组";
    const originalName = alert.originalThread?.name || "原组";
    const title = "⚠️ 检测到 FB 复制组通话";
    const messageText = alert.originalThread
      ? `「${originalName}」可能出现复制组。\n当前复制组：${copyName}`
      : `检测到复制组通话：${copyName}`;

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
