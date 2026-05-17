// tab-fetch.js — 通过 content script 代理 fetch，用页面真 origin。
// 找不到对应平台的 tab 就自动开一个隐藏 tab，等加载完再发请求。

const PLATFORM_CFG = {
  doubao: {
    pattern: "https://www.doubao.com/*",
    openUrl: "https://www.doubao.com/chat/",
    contentFile: "content-doubao.js",
  },
  yuanbao: {
    pattern: "https://yuanbao.tencent.com/*",
    openUrl: "https://yuanbao.tencent.com/chat/naQivTmsDa",
    contentFile: "content-yuanbao.js",
  },
  qianwen: {
    pattern: "https://www.qianwen.com/*",
    openUrl: "https://www.qianwen.com/",
    contentFile: "content-qianwen.js",
  },
  deepseek: {
    pattern: "https://chat.deepseek.com/*",
    openUrl: "https://chat.deepseek.com/",
    contentFile: "content-deepseek.js",
  },
};

// 给老 tab（扩展装之前就开着的）手动注入 content script
async function ensureContentScriptInjected(tabId, contentFile) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [contentFile],
    });
    console.log(`[tab-fetch] 已往 tab ${tabId} 注入 ${contentFile}`);
    // 等一下让 onMessage listener 注册
    await new Promise(r => setTimeout(r, 300));
  } catch (e) {
    console.warn(`[tab-fetch] 注入 ${contentFile} 失败:`, e.message);
  }
}

const _openedTabs = {};  // platform → tabId（我们自己开的，runner 结束可考虑关掉）

async function findOrOpenTab(platform) {
  const cfg = PLATFORM_CFG[platform];
  if (!cfg) throw new Error(`unknown platform: ${platform}`);

  // 先找现有 tab
  const existing = await chrome.tabs.query({ url: cfg.pattern });
  if (existing.length) return existing[0].id;

  // 没现成的 → 后台打开
  console.log(`[tab-fetch/${platform}] 开后台 tab: ${cfg.openUrl}`);
  const tab = await chrome.tabs.create({ url: cfg.openUrl, active: false });
  _openedTabs[platform] = tab.id;

  // 等 tab 加载完 + content script 注入完
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`${platform} tab 加载超时（30s）`));
    }, 30000);
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        // 给 content script 注入留点时间
        setTimeout(resolve, 1200);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  return tab.id;
}

async function trySendMessage(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    if (/Receiving end does not exist|Could not establish connection/i.test(e.message)) {
      return { __needInject: true, __error: e.message };
    }
    throw e;
  }
}

export async function tabFetch(platform, url, init = {}) {
  const cfg = PLATFORM_CFG[platform];
  const tabId = await findOrOpenTab(platform);
  const msg = {
    type: "tab-fetch",
    platform,
    url,
    method: init.method || "POST",
    headers: init.headers || {},
    body: init.body,
  };

  let resp = await trySendMessage(tabId, msg);

  // content script 没注入（老 tab）→ 手动注入再重试一次
  if (resp && resp.__needInject) {
    console.log(`[tab-fetch/${platform}] sendMessage 失败，尝试手动注入 content script`);
    await ensureContentScriptInjected(tabId, cfg.contentFile);
    resp = await trySendMessage(tabId, msg);
    if (resp && resp.__needInject) {
      throw new Error(`${platform} content script 注入失败（${resp.__error}）。把对应网站的 tab 刷新一下再试`);
    }
  }

  if (!resp) throw new Error(`${platform} content script 没响应（tab ${tabId} 可能被关）`);
  if (resp.error) throw new Error(`${platform} fetch 错误: ${resp.error}`);
  if (!resp.ok) throw new Error(`${platform} HTTP ${resp.status}: ${resp.body?.slice(0, 200) || ""}`);
  return JSON.parse(resp.body);
}

// runner 结束时调用，关掉我们打开的隐藏 tab
export async function closeOpenedTabs() {
  for (const platform of Object.keys(_openedTabs)) {
    try { await chrome.tabs.remove(_openedTabs[platform]); } catch (_) {}
    delete _openedTabs[platform];
  }
}
