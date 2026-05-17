// Service worker
// 1. 安装时弹 options
// 2. 启动 / 安装 / 装包后，主动往所有现有 4 平台 tab（豆包 / 元宝 / 千问 / DeepSeek）注入 content script
//    （否则装扩展之前就开着的 tab，content script 永远不会注入）
// 3. 拦截 chat.deepseek.com 的 Authorization header 存到 session storage（DeepSeek 需要 Bearer token）

const INJECT_TARGETS = [
  { matches: ["https://www.doubao.com/*", "https://doubao.com/*"], file: "content-doubao.js" },
  { matches: ["https://yuanbao.tencent.com/*"], file: "content-yuanbao.js" },
  { matches: ["https://www.qianwen.com/*", "https://qianwen.com/*"], file: "content-qianwen.js" },
  { matches: ["https://chat.deepseek.com/*"], file: "content-deepseek.js" },
];

async function injectIntoMatchingTabs() {
  for (const { matches, file } of INJECT_TARGETS) {
    try {
      const tabs = await chrome.tabs.query({ url: matches });
      for (const tab of tabs) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
          console.log(`[insights] 已往 tab ${tab.id} (${tab.url.slice(0, 60)}) 注入 ${file}`);
        } catch (e) {
          // 注入失败常见：chrome:// 页 / 已注入过抛重复错。忽略。
        }
      }
    } catch (e) {
      console.warn(`[insights] 查询 ${matches} 失败:`, e.message);
    }
  }
}

self.addEventListener("install", () => console.log("[insights] SW installed"));

// 首装预置默认 LLM（DeepSeek 共享 key，开箱即用）
const DEFAULT_LLM_CONFIG = {
  provider: "openai",
  base_url: "https://api.deepseek.com/v1",
  api_key: "sk-95b9820214cc4221b7a4f8d22279aa32",
  model: "deepseek-chat",
};

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    // 只在用户从未配过时写入默认；已配过的不覆盖
    const existing = (await chrome.storage.sync.get(["llmConfig"])).llmConfig
                  || (await chrome.storage.local.get(["llmConfig"])).llmConfig;
    if (!existing) {
      try { await chrome.storage.sync.set({ llmConfig: DEFAULT_LLM_CONFIG }); }
      catch { await chrome.storage.local.set({ llmConfig: DEFAULT_LLM_CONFIG }); }
    }
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
  }
  // 装/升级后立刻往老 tab 注入
  injectIntoMatchingTabs();
});

chrome.runtime.onStartup.addListener(() => {
  injectIntoMatchingTabs();
});

// === DeepSeek Bearer token 自动捕获 ===
// 当 deepseek.com 自己发请求时，截获 Authorization 头存进 chrome.storage.session
// tab-fetch 用 deepseek 平台时从这里读
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const auth = details.requestHeaders?.find(h => h.name.toLowerCase() === "authorization");
    if (auth && auth.value && auth.value.startsWith("Bearer ")) {
      // 异步写，不阻塞请求
      chrome.storage.session.set({ deepseek_bearer: auth.value }).catch(() => {});
    }
  },
  { urls: ["https://chat.deepseek.com/api/*"] },
  ["requestHeaders", "extraHeaders"]
);
