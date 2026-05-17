// 注入到 yuanbao.tencent.com 页面里，代理 fetch 用页面真 origin 调元宝 API。
console.log("[insights] content-yuanbao injected");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "tab-fetch" || msg.platform !== "yuanbao") return false;
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
