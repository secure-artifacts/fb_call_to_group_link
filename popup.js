const callUrlInput = document.getElementById("callUrl");
const scanUrlBtn = document.getElementById("scanUrlBtn");
const scanTabBtn = document.getElementById("scanTabBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const resultListEl = document.getElementById("resultList");
const copyAlertEl = document.getElementById("copyAlert");

function setStatus(text, type = "info") {
  statusEl.hidden = !text;
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

function roleLabel(role) {
  if (role === "copy") return "复制组";
  if (role === "original") return "原组";
  return "";
}

function renderCopyAlert(alert) {
  if (!alert?.detected) {
    copyAlertEl.hidden = true;
    copyAlertEl.innerHTML = "";
    return;
  }

  copyAlertEl.hidden = false;
  const originalBlock = alert.originalThread
    ? `<div class="thread-block"><strong>原组：</strong>${alert.originalThread.name}<br><a href="${alert.originalThread.url}" target="_blank" rel="noopener">${alert.originalThread.url}</a></div>`
    : "";

  copyAlertEl.innerHTML = `
    <strong>⚠️ 检测到复制组通话</strong>
    <div>${alert.summary}</div>
    <div class="thread-block"><strong>复制组（要找的）：</strong>${alert.copyThread?.name || "未知"}<br><a href="${alert.copyThread?.url || "#"}" target="_blank" rel="noopener">${alert.copyThread?.url || ""}</a></div>
    ${originalBlock}
  `;
}

function renderResults(items) {
  resultListEl.innerHTML = "";

  if (!items?.length) {
    resultsEl.hidden = true;
    return;
  }

  resultsEl.hidden = false;

  for (const item of items) {
    const tag = roleLabel(item.role);
    const li = document.createElement("li");
    li.innerHTML = `
      ${tag ? `<span class="result-tag ${item.role}">${tag}</span>` : ""}
      ${item.groupName ? `<strong>${item.groupName}</strong><br>` : ""}
      <a class="result-url" href="${item.url}" target="_blank" rel="noopener">${item.url}</a>
      <span class="result-meta">来源：${item.source || "未知"}${item.hint ? ` · ${item.hint}` : ""}</span>
      <div class="result-actions">
        <button type="button" data-copy="${item.url}">复制</button>
        <button type="button" data-open="${item.url}">打开</button>
      </div>
    `;
    resultListEl.appendChild(li);
  }

  resultListEl.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const url = button.getAttribute("data-copy");
      await navigator.clipboard.writeText(url);
      button.textContent = "已复制";
      setTimeout(() => {
        button.textContent = "复制";
      }, 1200);
    });
  });

  resultListEl.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      chrome.tabs.create({ url: button.getAttribute("data-open") });
    });
  });
}

function finishAnalysis(items, copyGroupAlert) {
  renderCopyAlert(copyGroupAlert);

  if (!items.length) {
    setStatus("未找到群聊链接。请确认已在通话页且已登录 Facebook。", "error");
    renderResults([]);
    return null;
  }

  const best = FBGroupLinkExtractor.pickBestResult(items, copyGroupAlert);
  if (best) {
    navigator.clipboard.writeText(best.url);
  }

  if (copyGroupAlert?.detected) {
    setStatus(
      best
        ? `检测到复制组！已复制复制组链接：${best.url}`
        : "检测到复制组，请查看上方红色提醒。",
      "warning"
    );
  } else {
    setStatus(
      best ? `找到 ${items.length} 条，最佳结果已复制：${best.url}` : `找到 ${items.length} 条群聊链接。`,
      "success"
    );
  }

  renderResults(items);
  return best;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isFacebookUrl(url = "") {
  return /facebook\.com|messenger\.com|m\.me/i.test(url);
}

async function extractFromTab(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "EXTRACT_GROUP_LINK" });
}

async function waitForTabComplete(tabId, timeoutMs = 20000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return tab;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error("页面加载超时，请手动进入通话页后再解析。");
}

async function injectAndExtract(tabId) {
  try {
    return await extractFromTab(tabId);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["extractor.js"],
    });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => FBGroupLinkExtractor.analyzeDocument(document, location.href),
    });
    return { ok: true, ...(result || { items: [], copyGroupAlert: { detected: false } }) };
  }
}

async function scanCurrentTab() {
  setStatus("正在解析当前标签页...", "info");
  scanTabBtn.disabled = true;

  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("未找到当前标签页。");
    if (!isFacebookUrl(tab.url)) {
      throw new Error("当前页面不是 Facebook / Messenger，请先打开通话页。");
    }

    let response;
    try {
      response = await extractFromTab(tab.id);
    } catch {
      response = await injectAndExtract(tab.id);
    }

    finishAnalysis(response?.items || [], response?.copyGroupAlert);
  } catch (error) {
    setStatus(error.message || "解析失败。", "error");
    renderCopyAlert(null);
    renderResults([]);
  } finally {
    scanTabBtn.disabled = false;
  }
}

async function scanFromPastedUrl() {
  const url = callUrlInput.value.trim();
  if (!url) {
    setStatus("请先粘贴通话链接。", "error");
    return;
  }
  if (!isFacebookUrl(url)) {
    setStatus("链接需为 facebook.com 或 messenger.com 域名。", "error");
    return;
  }

  const quickItems = FBGroupLinkExtractor.extractFromUrl(url);
  if (quickItems.length) {
    renderCopyAlert(null);
    finishAnalysis(quickItems, { detected: false });
    return;
  }

  setStatus("正在后台打开链接并解析（需已登录 Facebook）...", "info");
  scanUrlBtn.disabled = true;

  let createdTabId = null;

  try {
    const tab = await chrome.tabs.create({ url, active: false });
    createdTabId = tab.id;
    await waitForTabComplete(createdTabId);

    const response = await injectAndExtract(createdTabId);
    finishAnalysis(response?.items || [], response?.copyGroupAlert);
  } catch (error) {
    setStatus(error.message || "解析失败。", "error");
    renderCopyAlert(null);
    renderResults([]);
  } finally {
    scanUrlBtn.disabled = false;
    if (createdTabId !== null) {
      try {
        await chrome.tabs.remove(createdTabId);
      } catch {
        // tab may already be closed
      }
    }
  }
}

scanTabBtn.addEventListener("click", scanCurrentTab);
scanUrlBtn.addEventListener("click", scanFromPastedUrl);

getActiveTab().then((tab) => {
  if (tab?.url && isFacebookUrl(tab.url)) {
    callUrlInput.value = tab.url;
  }
});

chrome.storage.local.get("lastCopyGroupAlert").then((data) => {
  if (data.lastCopyGroupAlert?.detected) {
    renderCopyAlert(data.lastCopyGroupAlert);
  }
});
