/**
 * 从 Facebook 通话页提取群聊链接，并检测「复制组」场景
 * 复制组：通话中邀请组外成员 → 新建群聊/复制组 → 原组通话断开
 */
(function (global) {
  const NUMERIC_ID_RE = /^\d{5,}$/;

  const THREAD_URL_RE =
    /https?:\/\/(?:www\.)?(?:facebook\.com\/messages\/t|messenger\.com\/t)\/(\d{5,})/gi;

  const THREAD_PATH_RE = /\/(?:messages\/t|t)\/(\d{5,})/gi;

  const THREAD_TEXT_PATTERNS = [
    /[?&]thread_id=(\d{5,})/gi,
    /[?&]thread_fbid=(\d{5,})/gi,
    /[?&]tid=(\d{5,})/gi,
    /"thread_fbid"\s*:\s*"(\d{5,})"/gi,
    /"thread_id"\s*:\s*"(\d{5,})"/gi,
    /"message_thread_id"\s*:\s*"(\d{5,})"/gi,
    /"client_thread_id"\s*:\s*"(\d{5,})"/gi,
    /"associated_thread_id"\s*:\s*"(\d{5,})"/gi,
    /"thread_key"\s*:\s*\{\s*"thread_fbid"\s*:\s*"(\d{5,})"/gi,
    /"thread_key"\s*:\s*"(\d{5,})"/gi,
    /fb:\/\/thread\/(\d{5,})/gi,
    /"messaging_thread_id"\s*:\s*"(\d{5,})"/gi,
    /"open_thread_id"\s*:\s*"(\d{5,})"/gi,
    /"conversation_id"\s*:\s*"(\d{5,})"/gi,
    /"rtc_call_thread_id"\s*:\s*"(\d{5,})"/gi,
    /"call_thread_id"\s*:\s*"(\d{5,})"/gi,
    /"group_thread_id"\s*:\s*"(\d{5,})"/gi,
  ];

  const PARENT_THREAD_FIELDS = [
    "parent_thread_id",
    "source_thread_fbid",
    "forked_from_thread_id",
    "original_thread_id",
    "linked_source_thread_id",
    "prior_thread_id",
  ];

  const COPY_SIGNAL_RE =
    /复制|复制组|新群组|创建了群|创建群组|组外|不在群|invite.*outside|forked|duplicate.*thread|split.*thread|spawned.*thread|copied.*thread|new group chat/i;

  const FOLDER_LABELS = {
    PENDING: "消息请求",
    OTHER: "陌生信息/其他",
    SPAM: "垃圾信息",
    FILTERED: "过滤消息",
    MESSAGE_REQUEST: "消息请求",
    INBOX: "收件箱",
    ARCHIVED: "已归档",
  };

  function normalizeThreadUrl(threadId) {
    const trimmed = String(threadId || "").trim();
    if (!NUMERIC_ID_RE.test(trimmed)) return null;
    return `https://www.facebook.com/messages/t/${trimmed}`;
  }

  function decodeJsonString(value) {
    if (!value) return "";
    try {
      return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
    } catch {
      return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
    }
  }

  function extractGroupName(context) {
    const patterns = [
      /"thread_name"\s*:\s*"((?:\\.|[^"\\])*)"/i,
      /"customization_info"\s*:\s*\{[^}]{0,200}?"name"\s*:\s*"((?:\\.|[^"\\])*)"/i,
      /"name"\s*:\s*"((?:\\.|[^"\\])*)"/i,
      /"title"\s*:\s*"((?:\\.|[^"\\])*)"/i,
    ];
    const skip = /^(GROUP|INBOX|Messenger|null|true|false|\d+)$/i;

    for (const pattern of patterns) {
      const match = context.match(pattern);
      if (match?.[1]) {
        const name = decodeJsonString(match[1]).trim();
        if (name.length >= 2 && name.length <= 120 && !skip.test(name)) {
          return name;
        }
      }
    }
    return "";
  }

  function extractVisibleGroupTitle(doc = document) {
    const selectors = [
      '[data-testid="chat-title"]',
      '[data-testid="conversation-title"]',
      '[role="main"] h1',
      '[role="main"] h2',
      'h1[dir="auto"]',
      'span[dir="auto"][role="heading"]',
    ];

    for (const selector of selectors) {
      const el = doc.querySelector(selector);
      const text = el?.textContent?.trim();
      if (text && text.length >= 2 && text.length <= 120) {
        return text;
      }
    }

    const title = (doc.title || "").trim();
    if (!title) return "";

    const parts = title.split(/\s*[|\-–—·]\s*/);
    const candidate = (parts[0] || title).trim();
    if (/^(Messenger|Facebook|消息|Messages)$/i.test(candidate)) {
      return (parts[1] || "").trim();
    }
    return candidate;
  }

  function enrichThreadRef(thread, pageText, scoredThreads, items, visibleTitle, preferOriginal) {
    if (!thread) return null;

    let id = thread.id || "";
    let url = thread.url || normalizeThreadUrl(id);
    id = id || (url ? url.split("/messages/t/")[1] : "");

    let name = thread.name || thread.groupName || "";

    if (!name && id && scoredThreads.has(id)) {
      name = scoredThreads.get(id).groupName || "";
    }

    if (!name && id) {
      const anchor = `"thread_fbid"\\s*:\\s*"${id}"`;
      const match = pageText.match(new RegExp(anchor, "i"));
      if (match?.index != null) {
        const ctx = pageText.slice(Math.max(0, match.index - 900), match.index + 900);
        name = extractGroupName(ctx);
      }
    }

    if (!name) {
      const item = items.find((entry) => entry.url?.includes(id));
      name = item?.groupName || "";
    }

    if (!name && preferOriginal && visibleTitle) {
      name = visibleTitle;
    }

    if (!url && id) {
      url = normalizeThreadUrl(id);
    }

    if (!id && !url) return null;

    return {
      id,
      url: url || "",
      name: name || "未知名称",
    };
  }

  function loadStoredOriginalGroup(copyThreadId) {
    try {
      const raw = sessionStorage.getItem("fb-original-group-context");
      if (!raw) return null;
      const stored = JSON.parse(raw);
      if (!stored?.id || stored.id === copyThreadId) return null;
      if (Date.now() - (stored.savedAt || 0) > 6 * 60 * 60 * 1000) return null;
      return {
        id: stored.id,
        url: stored.url || normalizeThreadUrl(stored.id),
        name: stored.name || "",
      };
    } catch {
      return null;
    }
  }

  function enrichCopyGroupAlert(alert, items, doc, pageText, scoredThreads) {
    if (!alert?.detected) return alert;

    const visibleTitle = extractVisibleGroupTitle(doc);

    alert.copyThread = enrichThreadRef(
      alert.copyThread,
      pageText,
      scoredThreads,
      items,
      visibleTitle,
      false
    );

    if (!alert.originalThread) {
      const fromItems = items.find((entry) => entry.role === "original");
      if (fromItems) {
        alert.originalThread = {
          id: fromItems.url.split("/messages/t/")[1],
          url: fromItems.url,
          name: fromItems.groupName,
        };
      }
    }

    if (!alert.originalThread) {
      const stored = loadStoredOriginalGroup(alert.copyThread?.id);
      if (stored) alert.originalThread = stored;
    }

    if (!alert.originalThread) {
      const fallback = items.find(
        (entry) => entry.url && entry.url !== alert.copyThread?.url && entry.groupName
      );
      if (fallback) {
        alert.originalThread = {
          id: fallback.url.split("/messages/t/")[1],
          url: fallback.url,
          name: fallback.groupName,
        };
      }
    }

    alert.originalThread = enrichThreadRef(
      alert.originalThread,
      pageText,
      scoredThreads,
      items,
      visibleTitle,
      true
    );

    if (alert.originalThread && alert.copyThread) {
      alert.summary = `原小组「${alert.originalThread.name}」已被生成复制组「${alert.copyThread.name}」。请查看下方原小组与复制组的名称和链接。`;
    }

    return alert;
  }

  function saveOriginalGroupContext(items) {
    const candidate =
      items.find((entry) => entry.role === "original") ||
      items.find((entry) => entry.groupName) ||
      items[0];

    if (!candidate?.url) return;

    const id = candidate.url.split("/messages/t/")[1];
    if (!id) return;

    sessionStorage.setItem(
      "fb-original-group-context",
      JSON.stringify({
        id,
        url: candidate.url,
        name: candidate.groupName || extractVisibleGroupTitle(),
        savedAt: Date.now(),
      })
    );
  }

  function detectFolderHint(context) {
    const folderMatch = context.match(/"folder"\s*:\s*"([A-Z_]+)"/i);
    if (folderMatch) {
      return FOLDER_LABELS[folderMatch[1].toUpperCase()] || folderMatch[1];
    }
    if (/message_request|message_requests|filtered_requests/i.test(context)) {
      return "消息请求";
    }
    if (/stranger|unknown.?sender|non.?friend/i.test(context)) {
      return "陌生信息";
    }
    return "";
  }

  function scoreThreadCandidate(context) {
    let score = 0;
    if (/thread_type"\s*:\s*"GROUP"/i.test(context)) score += 120;
    if (/is_group"\s*:\s*true/i.test(context)) score += 80;
    if (/group/i.test(context)) score += 15;
    if (/call|rtc|groupcall|videochat|voicechat|room|ongoing/i.test(context)) score += 50;
    if (/message_request|filtered|pending|stranger|folder"\s*:\s*"(PENDING|OTHER|SPAM|FILTERED)/i.test(context)) {
      score += 20;
    }
    if (/thread_type"\s*:\s*"ONE_TO_ONE"/i.test(context)) score -= 40;
    if (/parent_thread|source_thread|forked_from|original_thread/i.test(context)) score += 25;
    return score;
  }

  function buildThreadProfile(id, context, extra = {}) {
    const folder = detectFolderHint(context);
    const hintParts = [];
    if (folder) hintParts.push(`群聊位置：${folder}`);
    return {
      id,
      url: normalizeThreadUrl(id),
      score: scoreThreadCandidate(context),
      groupName: extractGroupName(context),
      hint: hintParts.join(" · "),
      isGroup: /thread_type"\s*:\s*"GROUP"/i.test(context) || /is_group"\s*:\s*true/i.test(context),
      ...extra,
    };
  }

  function addResult(map, entry) {
    if (!entry?.url || !entry.url.includes("/messages/t/")) return;
    const id = entry.url.split("/messages/t/")[1];
    if (!NUMERIC_ID_RE.test(id)) return;

    const key = entry.url.toLowerCase();
    const existing = map.get(key);
    if (!existing || (entry.role !== "unknown" && existing.role === "unknown")) {
      map.set(key, { ...existing, ...entry, url: entry.url });
    } else if (existing) {
      map.set(key, {
        ...existing,
        hint: entry.hint || existing.hint,
        groupName: entry.groupName || existing.groupName,
        role: entry.role !== "unknown" ? entry.role : existing.role,
      });
    }
  }

  function extractThreadIdsFromText(text) {
    const ids = new Set();
    if (!text) return ids;

    let match;
    while ((match = THREAD_URL_RE.exec(text)) !== null) ids.add(match[1]);
    THREAD_URL_RE.lastIndex = 0;

    while ((match = THREAD_PATH_RE.exec(text)) !== null) ids.add(match[1]);
    THREAD_PATH_RE.lastIndex = 0;

    for (const pattern of THREAD_TEXT_PATTERNS) {
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        if (NUMERIC_ID_RE.test(match[1])) ids.add(match[1]);
      }
    }

    return ids;
  }

  function extractScoredThreadsFromText(text) {
    const scored = new Map();
    if (!text) return scored;

    const anchorPatterns = [
      /"thread_fbid"\s*:\s*"(\d{5,})"/gi,
      /"thread_id"\s*:\s*"(\d{5,})"/gi,
      /"message_thread_id"\s*:\s*"(\d{5,})"/gi,
    ];

    for (const pattern of anchorPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const id = match[1];
        const start = Math.max(0, match.index - 700);
        const end = Math.min(text.length, match.index + 700);
        const context = text.slice(start, end);
        const profile = buildThreadProfile(id, context);
        const prev = scored.get(id);
        if (!prev || profile.score > prev.score) {
          scored.set(id, profile);
        } else {
          if (profile.groupName && !prev.groupName) prev.groupName = profile.groupName;
          if (profile.hint && !prev.hint) prev.hint = profile.hint;
        }
      }
    }

    return scored;
  }

  function findParentChildPairs(pageText) {
    const pairs = [];
    const seen = new Set();
    const threadRe = /"thread_fbid"\s*:\s*"(\d{5,})"/gi;
    let match;

    while ((match = threadRe.exec(pageText)) !== null) {
      const copyId = match[1];
      const windowText = pageText.slice(Math.max(0, match.index - 400), match.index + 1400);

      for (const field of PARENT_THREAD_FIELDS) {
        const parentRe = new RegExp(`"${field}"\\s*:\\s*"(\\d{5,})"`, "i");
        const parentMatch = windowText.match(parentRe);
        if (!parentMatch) continue;

        const originalId = parentMatch[1];
        if (originalId === copyId) continue;

        const key = `${copyId}:${originalId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ copyId, originalId, reason: field });
      }
    }

    return pairs;
  }

  function detectCopyGroupScenario(pageText, scoredThreads, visibleText = "") {
    const empty = {
      detected: false,
      confidence: "none",
      summary: "",
      copyThread: null,
      originalThread: null,
      reason: "",
    };

    const profiles = [...scoredThreads.values()].sort((a, b) => b.score - a.score);
    const groupProfiles = profiles.filter((p) => p.isGroup || p.score >= 100);
    const pairs = findParentChildPairs(pageText);
    const uiSignal = COPY_SIGNAL_RE.test(`${visibleText}\n${pageText.slice(0, 50000)}`);

    if (pairs.length) {
      const pair = pairs[0];
      const copyProfile = scoredThreads.get(pair.copyId) || buildThreadProfile(pair.copyId, pageText);
      const originalProfile =
        scoredThreads.get(pair.originalId) || buildThreadProfile(pair.originalId, pageText);

      return {
        detected: true,
        confidence: "high",
        summary: `原组「${originalProfile.groupName || "未知名称"}」已被生成复制组。有人在通话里邀请了组外成员，原组通话可能已断开。`,
        copyThread: {
          id: pair.copyId,
          url: normalizeThreadUrl(pair.copyId),
          name: copyProfile.groupName || "复制组（未知名称）",
        },
        originalThread: {
          id: pair.originalId,
          url: normalizeThreadUrl(pair.originalId),
          name: originalProfile.groupName || "原组（未知名称）",
        },
        reason: pair.reason,
      };
    }

    if (groupProfiles.length >= 2 && (uiSignal || groupProfiles.some((p) => /call|rtc/i.test(p.hint)))) {
      const copyCandidate = groupProfiles[0];
      const originalCandidate = groupProfiles[1];

      return {
        detected: true,
        confidence: uiSignal ? "high" : "medium",
        summary: `原组「${originalCandidate.groupName || "未知名称"}」疑似已被生成复制组，当前通话更可能已是复制组。`,
        copyThread: {
          id: copyCandidate.id,
          url: copyCandidate.url,
          name: copyCandidate.groupName || "疑似复制组",
        },
        originalThread: {
          id: originalCandidate.id,
          url: originalCandidate.url,
          name: originalCandidate.groupName || "疑似原组",
        },
        reason: uiSignal ? "ui_signal" : "multiple_group_threads",
      };
    }

    if (uiSignal && groupProfiles.length >= 1) {
      return {
        detected: true,
        confidence: "medium",
        summary: "页面出现复制组/新建群相关提示。下方链接中请优先查看标记为「复制组」的群聊。",
        copyThread: {
          id: groupProfiles[0].id,
          url: groupProfiles[0].url,
          name: groupProfiles[0].groupName || "当前通话群聊",
        },
        originalThread: null,
        reason: "ui_signal",
      };
    }

    return empty;
  }

  function applyCopyRoles(items, copyGroupAlert) {
    if (!copyGroupAlert?.detected) return items;

    return items.map((item) => {
      const id = item.url.split("/messages/t/")[1];
      if (copyGroupAlert.copyThread?.id === id) {
        return {
          ...item,
          role: "copy",
          groupName: copyGroupAlert.copyThread.name || item.groupName,
          hint: [item.hint, "角色：复制组"].filter(Boolean).join(" · "),
        };
      }
      if (copyGroupAlert.originalThread?.id === id) {
        return {
          ...item,
          role: "original",
          groupName: copyGroupAlert.originalThread.name || item.groupName,
          hint: [item.hint, "角色：原组"].filter(Boolean).join(" · "),
        };
      }
      return item;
    });
  }

  function extractFromUrl(url) {
    const results = new Map();
    if (!url) return results;

    try {
      const parsed = new URL(url);
      const pathMatch = parsed.pathname.match(/\/(?:messages\/t|t)\/(\d{5,})/i);
      if (pathMatch) {
        addResult(results, {
          url: normalizeThreadUrl(pathMatch[1]),
          source: "URL 路径",
          role: "unknown",
        });
      }

      for (const [key, value] of parsed.searchParams.entries()) {
        if (/thread|tid/i.test(key) && NUMERIC_ID_RE.test(value)) {
          addResult(results, {
            url: normalizeThreadUrl(value),
            source: "URL 参数",
            role: "unknown",
          });
        }
      }
    } catch {
      // ignore
    }

    for (const id of extractThreadIdsFromText(url)) {
      addResult(results, {
        url: normalizeThreadUrl(id),
        source: "URL 文本",
        role: "unknown",
      });
    }

    return results;
  }

  function collectPageText(doc) {
    const chunks = [doc.documentElement?.outerHTML || "", doc.body?.innerText || ""];

    doc.querySelectorAll("script").forEach((node) => {
      chunks.push(node.textContent || "");
    });

    doc.querySelectorAll("a[href*='/messages/t/'], a[href*='/t/']").forEach((anchor) => {
      chunks.push(anchor.href || "");
      chunks.push(anchor.getAttribute("href") || "");
    });

    return chunks.join("\n");
  }

  function analyzeDocument(doc = document, pageUrl = location.href) {
    const results = new Map();

    for (const [, meta] of extractFromUrl(pageUrl)) {
      addResult(results, meta);
    }

    doc.querySelectorAll("a[href*='/messages/t/'], a[href*='messenger.com/t/']").forEach((anchor) => {
      const href = anchor.href || anchor.getAttribute("href") || "";
      const match = href.match(/\/(?:messages\/t|t)\/(\d{5,})/i);
      if (match) {
        addResult(results, {
          url: normalizeThreadUrl(match[1]),
          source: "页面链接",
          role: "unknown",
        });
      }
    });

    const pageText = collectPageText(doc);
    const visibleText = doc.body?.innerText || "";
    const scoredThreads = extractScoredThreadsFromText(pageText);

    for (const profile of scoredThreads.values()) {
      addResult(results, {
        url: profile.url,
        source: "页面数据",
        hint: profile.hint,
        groupName: profile.groupName,
        role: "unknown",
      });
    }

    for (const id of extractThreadIdsFromText(pageText)) {
      const profile = scoredThreads.get(id);
      addResult(results, {
        url: normalizeThreadUrl(id),
        source: "页面数据",
        hint: profile?.hint || "",
        groupName: profile?.groupName || "",
        role: "unknown",
      });
    }

    const itemsArray = Array.from(results.values());
    const rawAlert = detectCopyGroupScenario(pageText, scoredThreads, visibleText);
    const copyGroupAlert = enrichCopyGroupAlert(rawAlert, itemsArray, doc, pageText, scoredThreads);
    const items = applyCopyRoles(itemsArray, copyGroupAlert);

    return { items, copyGroupAlert };
  }

  function extractFromDocument(doc = document, pageUrl = location.href) {
    return analyzeDocument(doc, pageUrl).items;
  }

  function pickBestResult(items, copyGroupAlert = null) {
    if (!items?.length) return null;

    if (copyGroupAlert?.detected && copyGroupAlert.copyThread?.url) {
      const copyItem = items.find((item) => item.url === copyGroupAlert.copyThread.url);
      if (copyItem) return copyItem;
    }

    const rolePriority = { copy: 30, original: 10, unknown: 0 };
    const sourcePriority = {
      "URL 路径": 50,
      页面链接: 40,
      "URL 参数": 30,
      "URL 文本": 20,
      页面数据: 10,
    };

    const ranked = [...items].sort((a, b) => {
      const roleDiff = (rolePriority[b.role] || 0) - (rolePriority[a.role] || 0);
      if (roleDiff) return roleDiff;
      const sourceDiff = (sourcePriority[b.source] || 0) - (sourcePriority[a.source] || 0);
      if (sourceDiff) return sourceDiff;
      return 0;
    });

    return ranked[0];
  }

  global.FBGroupLinkExtractor = {
    analyzeDocument,
    extractFromDocument,
    extractFromUrl: (url) => Array.from(extractFromUrl(url).values()),
    pickBestResult,
    normalizeThreadUrl,
    extractVisibleGroupTitle,
    saveOriginalGroupContext,
    enrichCopyGroupAlert,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
