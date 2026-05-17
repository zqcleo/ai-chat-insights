// 共用的登录态检测 —— 三层 cookie query 取并集
// 1. {url: ...} 语义最贴近"访问该 URL 会带什么 cookie"，覆盖父子域
// 2. {domain: 'host'} 当 url 失败时兜底（理论上跟 1 重叠，但有些 chrome 实现差异）
// 3. {domain: 'parent.tld'} 拿 wildcard 父域 cookie
// 任何一层拿到非追踪 cookie 就算登录

const PLATFORM_CFG = {
  doubao: {
    url: "https://www.doubao.com/",
    domains: ["www.doubao.com", ".doubao.com", "doubao.com"],
  },
  yuanbao: {
    url: "https://yuanbao.tencent.com/",
    domains: ["yuanbao.tencent.com", ".tencent.com", "tencent.com"],
  },
  qianwen: {
    url: "https://www.qianwen.com/",
    domains: ["www.qianwen.com", ".qianwen.com", "qianwen.com"],
  },
  deepseek: {
    url: "https://chat.deepseek.com/",
    domains: ["chat.deepseek.com", ".deepseek.com", "deepseek.com"],
  },
};

const TRACKING_PREFIXES = ["_ga", "_gcl", "_gid", "_fbp", "_qimei", "_TDID", "tea_", "ttwid", "msToken", "AGW_"];

function isBusinessCookie(c) {
  if (!c.value) return false;
  const n = c.name.toLowerCase();
  return !TRACKING_PREFIXES.some(p => n.startsWith(p.toLowerCase()));
}

export async function detectLogin(platform) {
  const cfg = PLATFORM_CFG[platform];
  if (!cfg) return false;

  // 先确认 cookies 权限
  try {
    const hasPerm = await chrome.permissions.contains({ permissions: ["cookies"] });
    if (!hasPerm) {
      console.warn(`[detectLogin/${platform}] cookies 权限未授权（扩展可能需要重装）`);
    }
  } catch (_) {}

  const seen = new Map();  // name → cookie（去重）
  const tried = [];

  // 1. url 查询
  try {
    const cs = await chrome.cookies.getAll({ url: cfg.url });
    tried.push(`url=${cfg.url}→${cs.length}`);
    cs.forEach(c => { if (!seen.has(c.name)) seen.set(c.name, c); });
  } catch (e) { tried.push(`url err: ${e.message.slice(0, 40)}`); }

  // 2. 各 domain 查询
  for (const d of cfg.domains) {
    try {
      const cs = await chrome.cookies.getAll({ domain: d });
      tried.push(`domain=${d}→${cs.length}`);
      cs.forEach(c => { if (!seen.has(c.name)) seen.set(c.name, c); });
    } catch (e) { tried.push(`domain=${d} err: ${e.message.slice(0, 40)}`); }
  }

  const all = [...seen.values()];
  const business = all.filter(isBusinessCookie);
  console.log(`[detectLogin/${platform}] ${all.length} unique, ${business.length} business: [${business.map(c => c.name).join(", ")}]`);
  console.log(`  queries: ${tried.join(" | ")}`);
  return business.length > 0;
}

// 返回详细诊断，供 popup 上"为什么显示未登录"展开看
export async function diagnose(platform) {
  const cfg = PLATFORM_CFG[platform];
  if (!cfg) return { error: "未知平台" };
  let hasPerm = "?";
  try {
    hasPerm = await chrome.permissions.contains({ permissions: ["cookies"] }) ? "✓" : "✗";
  } catch (e) { hasPerm = `err: ${e.message}`; }
  const results = {};
  try {
    results.url = (await chrome.cookies.getAll({ url: cfg.url })).map(c => ({ n: c.name, d: c.domain }));
  } catch (e) { results.url_error = e.message; }
  for (const d of cfg.domains) {
    try {
      results[`domain_${d}`] = (await chrome.cookies.getAll({ domain: d })).map(c => ({ n: c.name, d: c.domain }));
    } catch (e) { results[`domain_${d}_error`] = e.message; }
  }
  return { hasPerm, ...results };
}
