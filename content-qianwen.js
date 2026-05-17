// 注入到 qianwen.com 页面里，代理 fetch 用页面真 origin。
console.log("[insights] content-qianwen injected");
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "tab-fetch" || msg.platform !== "qianwen") return false;
  (async () => {
    try {
      const r = await fetch(msg.url, {
        method: msg.method || "POST",
        credentials: "include",
        headers: msg.headers || {},
        body: msg.body,
      });
      const text = await r.text();
      sendResponse({ ok: r.ok, status: r.status, body: text });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});
