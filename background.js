const ALERT_STORAGE_KEY = "lastCopyGroupAlert";
const UPDATE_INFO_KEY = "lastUpdateCheck";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "DOWNLOAD_UPDATE") {
    const url = message.downloadUrl;
    if (!url || !/^https:\/\/github\.com\//i.test(url)) {
      sendResponse({ ok: false, error: "无效的下载地址。" });
      return true;
    }

    chrome.downloads.download(
      {
        url,
        filename: message.zipName || undefined,
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          sendResponse({ ok: false, error: chrome.runtime.lastError?.message || "下载失败。" });
          return;
        }
        sendResponse({ ok: true, downloadId });
      }
    );
    return true;
  }

  if (message?.type === "SAVE_UPDATE_CHECK") {
    chrome.storage.local.set({ [UPDATE_INFO_KEY]: message.info || null }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message?.type === "COPY_GROUP_ALERT") {
    const alert = message.alert;
    if (!alert?.detected) {
      sendResponse({ ok: false });
      return true;
    }

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
