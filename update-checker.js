/**
 * 对照 GitHub Releases 检查扩展更新
 */
(function (global) {
  const REPO = "secure-artifacts/fb_call_to_group_link";
  const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
  const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`;
  const ZIP_PREFIX = "fb-call-to-group-link-";

  function parseVersion(tag) {
    return String(tag || "")
      .replace(/^v/i, "")
      .trim();
  }

  function compareVersions(current, latest) {
    const a = parseVersion(current).split(".").map((part) => parseInt(part, 10) || 0);
    const b = parseVersion(latest).split(".").map((part) => parseInt(part, 10) || 0);
    const len = Math.max(a.length, b.length);

    for (let i = 0; i < len; i++) {
      const left = a[i] || 0;
      const right = b[i] || 0;
      if (left > right) return 1;
      if (left < right) return -1;
    }
    return 0;
  }

  function getCurrentVersion() {
    return chrome.runtime.getManifest().version;
  }

  async function fetchLatestRelease() {
    const response = await fetch(API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (response.status === 403) {
      throw new Error("GitHub 请求过于频繁，请稍后再试或打开 Release 页面手动下载。");
    }
    if (!response.ok) {
      throw new Error(`无法获取 GitHub 最新版本（HTTP ${response.status}）`);
    }

    const data = await response.json();
    const tag = data.tag_name || "";
    const latestVersion = parseVersion(tag);
    const asset = (data.assets || []).find(
      (item) => item.name?.startsWith(ZIP_PREFIX) && item.name.endsWith(".zip")
    );

    return {
      tag,
      latestVersion,
      releaseUrl: data.html_url || RELEASE_PAGE,
      downloadUrl: asset?.browser_download_url || "",
      zipName: asset?.name || "",
      publishedAt: data.published_at || "",
    };
  }

  async function checkForUpdate() {
    const currentVersion = getCurrentVersion();
    const release = await fetchLatestRelease();
    const updateAvailable = compareVersions(currentVersion, release.latestVersion) < 0;

    return {
      currentVersion,
      ...release,
      updateAvailable,
    };
  }

  global.FBUpdateChecker = {
    REPO,
    RELEASE_PAGE,
    parseVersion,
    compareVersions,
    getCurrentVersion,
    fetchLatestRelease,
    checkForUpdate,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
