// 注入到 chat.deepseek.com 页面里，代理 fetch 用页面真 origin + Bearer token。
// Token 来源（按优先级）：
// 1. background.js webRequest 捕获到的 真 Bearer（chrome.storage.session.deepseek_bearer）
// 2. 兜底：扫 localStorage / sessionStorage 找像 token 的字符串（含非 JWT 格式）
console.log("[insights] content-deepseek injected");

function looksLikeToken(s) {
  if (!s || typeof s !== "string") return false;
  const t = s.replace(/^["']|["']$/g, "");
  if (t.length < 30) return false;
  // 三类格式都认：
  // 1. JWT (xxx.yyy.zzz)
  // 2. base64-ish（DeepSeek 这种 64+ 长度的纯字符串）
  // 3. 带 / + = 的 base64
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(t)
      || /^[A-Za-z0-9._\-=+\/]{30,}$/.test(t);
}

function tryParseToken(raw) {
  if (!raw) return null;
  raw = String(raw).trim();
  if (looksLikeToken(raw)) return raw.replace(/^["']|["']$/g, "");
  try {
    const obj = JSON.parse(raw);
    if (typeof obj === "string" && looksLikeToken(obj)) return obj;
    if (typeof obj === "object" && obj) {
      for (const k of ["token", "value", "access_token", "userToken", "data", "bearer"]) {
        if (obj[k]) {
          const r = tryParseToken(typeof obj[k] === "string" ? obj[k] : JSON.stringify(obj[k]));
          if (r) return r;
        }
      }
    }
  } catch (_) {}
  if (raw.startsWith("Bearer ")) {
    const t = raw.slice(7);
    if (looksLikeToken(t)) return t;
  }
  return null;
}

function scanStorageToken() {
  for (const store of [localStorage, sessionStorage]) {
    try {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        const v = store.getItem(k);
        const t = tryParseToken(v);
        if (t) {
          console.log(`[insights/deepseek] 从 ${store === localStorage ? "localStorage" : "sessionStorage"}.${k} 挖到 token (${t.slice(0, 12)}...)`);
          return t;
        }
      }
    } catch (_) {}
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "tab-fetch" || msg.platform !== "deepseek") return false;
  (async () => {
    try {
      const headers = { ...(msg.headers || {}) };
      // 1. 先用 webRequest 自动捕获的
      let bearer = null;
      try {
        const { deepseek_bearer } = await chrome.storage.session.get(["deepseek_bearer"]);
        bearer = deepseek_bearer;
      } catch (_) {}
      // 2. 兜底扫 storage
      if (!bearer) {
        const t = scanStorageToken();
        if (t) bearer = `Bearer ${t}`;
      }
      if (bearer) {
        headers["authorization"] = bearer;
        console.log(`[insights/deepseek] fetch with ${bearer.slice(0, 18)}...`);
      } else {
        console.warn(`[insights/deepseek] ⚠ 没拿到 token — 在 deepseek 上点开任意对话让页面发请求触发 webRequest 捕获`);
      }
      const r = await fetch(msg.url, {
        method: msg.method || "GET",
        credentials: "include",
        headers,
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
