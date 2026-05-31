const callUrlInput = document.getElementById("callUrl");
const scanUrlBtn = document.getElementById("scanUrlBtn");
const scanTabBtn = document.getElementById("scanTabBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const resultListEl = document.getElementById("resultList");
const copyAlertEl = document.getElementById("copyAlert");
const currentVersionEl = document.getElementById("currentVersion");
const checkUpdateBtn = document.getElementById("checkUpdateBtn");
const updatePanelEl = document.getElementById("updatePanel");

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
  const originalName = escapeHtml(alert.originalThread?.name || "未知");
  const originalUrl = escapeHtml(alert.originalThread?.url || "");
  const copyName = escapeHtml(alert.copyThread?.name || "未知");
  const copyUrl = escapeHtml(alert.copyThread?.url || "");
  const summary = escapeHtml(alert.summary || "");

  copyAlertEl.innerHTML = `
    <strong>⚠️ 原小组「${originalName}」已被生成复制组</strong>
    <div>${summary}</div>
    <div class="thread-block"><strong>原小组名称：</strong>${originalName}</div>
    <div class="thread-block"><strong>原小组链接：</strong><br><a href="${originalUrl || "#"}" target="_blank" rel="noopener">${originalUrl || "暂未识别"}</a></div>
    <div class="thread-block"><strong>复制组名称：</strong>${copyName}</div>
    <div class="thread-block"><strong>复制组链接：</strong><br><a href="${copyUrl || "#"}" target="_blank" rel="noopener">${copyUrl || "暂未识别"}</a></div>
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
    const name = escapeHtml(item.groupName || "");
    const url = escapeHtml(item.url || "");
    const source = escapeHtml(item.source || "未知");
    const hint = item.hint ? escapeHtml(item.hint) : "";
    const li = document.createElement("li");
    li.innerHTML = `
      ${tag ? `<span class="result-tag ${item.role}">${tag}</span>` : ""}
      ${name ? `<strong>${name}</strong><br>` : ""}
      <a class="result-url" href="${url}" target="_blank" rel="noopener">${url}</a>
      <span class="result-meta">来源：${source}${hint ? ` · ${hint}` : ""}</span>
      <div class="result-actions">
        <button type="button" data-copy="${url}">复制</button>
        <button type="button" data-open="${url}">打开</button>
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

function renderUpdatePanel(type, html) {
  updatePanelEl.hidden = false;
  updatePanelEl.className = `update-panel ${type}`;
  updatePanelEl.innerHTML = html;
}

function hideUpdatePanel() {
  updatePanelEl.hidden = true;
  updatePanelEl.innerHTML = "";
}

function formatUpdateSteps() {
  return `
    <ol>
      <li>等待 zip 下载完成（一般在「下载」文件夹）</li>
      <li>解压 zip，覆盖原插件文件夹</li>
      <li>打开 <code>chrome://extensions</code>，点击插件的「重新加载」</li>
    </ol>
  `;
}

async function downloadLatestUpdate(info) {
  if (!info?.downloadUrl) {
    chrome.tabs.create({ url: info?.releaseUrl || FBUpdateChecker.RELEASE_PAGE });
    return { ok: false, openedRelease: true };
  }

  return chrome.runtime.sendMessage({
    type: "DOWNLOAD_UPDATE",
    downloadUrl: info.downloadUrl,
    zipName: info.zipName,
  });
}

async function checkForUpdates({ silent = false } = {}) {
  if (!silent) {
    checkUpdateBtn.disabled = true;
    renderUpdatePanel("info", "<strong>正在检查更新…</strong><div>正在从 GitHub 获取最新版本。</div>");
  }

  try {
    const info = await FBUpdateChecker.checkForUpdate();

    chrome.runtime.sendMessage({
      type: "SAVE_UPDATE_CHECK",
      info: {
        checkedAt: Date.now(),
        latestVersion: info.latestVersion,
        updateAvailable: info.updateAvailable,
      },
    });

    if (info.updateAvailable) {
      renderUpdatePanel(
        "warning",
        `
          <strong>发现新版本 v${escapeHtml(info.latestVersion)}</strong>
          <div>当前 v${escapeHtml(info.currentVersion)} → 最新 v${escapeHtml(info.latestVersion)}</div>
          <div class="update-actions">
            <button type="button" id="downloadUpdateBtn">下载最新版</button>
            <button type="button" id="openReleaseBtn" class="secondary">打开 Release 页</button>
          </div>
          ${formatUpdateSteps()}
        `
      );
      bindUpdatePanelActions(info);
      return info;
    }

    if (!silent) {
      renderUpdatePanel(
        "success",
        `<strong>已是最新版本</strong><div>当前 v${escapeHtml(info.currentVersion)} 与 GitHub 最新版一致。</div>`
      );
    } else {
      hideUpdatePanel();
    }
    return info;
  } catch (error) {
    if (!silent) {
      renderUpdatePanel(
        "error",
        `
          <strong>检查更新失败</strong>
          <div>${escapeHtml(error.message || "网络错误")}</div>
          <div class="update-actions">
            <button type="button" id="openReleaseBtn" class="secondary">打开 Release 页</button>
          </div>
        `
      );
      bindUpdatePanelActions({ releaseUrl: FBUpdateChecker.RELEASE_PAGE });
    }
    return null;
  } finally {
    checkUpdateBtn.disabled = false;
  }
}

function bindUpdatePanelActions(info) {
  updatePanelEl.querySelector("#downloadUpdateBtn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "下载中…";

    try {
      const result = await downloadLatestUpdate(info);
      if (result?.ok) {
        button.textContent = "已开始下载";
        renderUpdatePanel(
          "info",
          `
            <strong>正在下载 v${escapeHtml(info.latestVersion)}</strong>
            <div>请在浏览器下载栏查看进度，完成后按下列步骤更新插件。</div>
            ${formatUpdateSteps()}
          `
        );
      } else if (result?.openedRelease) {
        button.textContent = "已打开 Release";
      } else {
        throw new Error(result?.error || "下载失败");
      }
    } catch (error) {
      button.disabled = false;
      button.textContent = "下载最新版";
      renderUpdatePanel(
        "error",
        `
          <strong>下载失败</strong>
          <div>${escapeHtml(error.message || "请稍后重试")}</div>
          <div class="update-actions">
            <button type="button" id="openReleaseBtn" class="secondary">打开 Release 页</button>
          </div>
        `
      );
      bindUpdatePanelActions(info);
    }
  });

  updatePanelEl.querySelector("#openReleaseBtn")?.addEventListener("click", () => {
    chrome.tabs.create({ url: info.releaseUrl || FBUpdateChecker.RELEASE_PAGE });
  });
}

scanTabBtn.addEventListener("click", scanCurrentTab);
scanUrlBtn.addEventListener("click", scanFromPastedUrl);
checkUpdateBtn.addEventListener("click", () => checkForUpdates());

currentVersionEl.textContent = `v${FBUpdateChecker.getCurrentVersion()}`;

checkForUpdates({ silent: true }).then((info) => {
  if (info?.updateAvailable) {
    renderUpdatePanel(
      "warning",
      `
        <strong>发现新版本 v${escapeHtml(info.latestVersion)}</strong>
        <div>当前 v${escapeHtml(info.currentVersion)} → 最新 v${escapeHtml(info.latestVersion)}</div>
        <div class="update-actions">
          <button type="button" id="downloadUpdateBtn">下载最新版</button>
          <button type="button" id="openReleaseBtn" class="secondary">打开 Release 页</button>
        </div>
        ${formatUpdateSteps()}
      `
    );
    bindUpdatePanelActions(info);
  }
});

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
