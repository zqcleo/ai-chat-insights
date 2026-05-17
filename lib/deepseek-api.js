// DeepSeek (chat.deepseek.com) 爬虫（JS 版，对齐 deepseek.py）
const MAX_LIST_PAGES = 100;

let _fetcher = async (url, init) => {
  const r = await fetch(url, { ...init, credentials: "include" });
  if (!r.ok) throw new Error(`deepseek HTTP ${r.status}`);
  return r.json();
};
export function setDeepseekFetcher(fn) { _fetcher = fn; }

const HEADERS = {
  "accept": "*/*",
  "accept-language": "zh-CN,zh;q=0.9",
  "x-app-version": "2.0.0",
  "x-client-locale": "zh_CN",
  "x-client-platform": "web",
  "x-client-version": "2.0.0",
  "x-client-timezone-offset": "28800",
};

async function get(path) {
  const url = `https://chat.deepseek.com${path}`;
  return _fetcher(url, { method: "GET", headers: HEADERS });
}

export async function listSessions() {
  const all = [];
  const seen = new Set();
  let cursorId = null, cursorTs = null;
  for (let i = 0; i < MAX_LIST_PAGES; i++) {
    let qs = "lte_cursor.pinned=false";
    if (cursorId !== null && cursorTs !== null) {
      qs += `&lte_cursor.id=${cursorId}&lte_cursor.updated_at=${cursorTs}`;
    }
    const r = await get(`/api/v0/chat_session/fetch_page?${qs}`);
    if (r.code !== 0) throw new Error(`deepseek fetch_page 失败: ${r.msg}（cookie 是不是过期了？）`);
    const sessions = ((r.data || {}).biz_data || {}).chat_sessions || [];
    if (!sessions.length) break;
    const newOnes = sessions.filter(s => !seen.has(s.id));
    for (const s of newOnes) { seen.add(s.id); all.push(s); }
    if (!newOnes.length) break;
    const last = newOnes[newOnes.length - 1];
    cursorId = last.id; cursorTs = last.updated_at;
    if (cursorTs == null) break;
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

export async function fetchMessages(sessionId) {
  // DeepSeek 一次返回全部，没有分页
  const r = await get(`/api/v0/chat/history_messages?chat_session_id=${sessionId}`);
  if (r.code !== 0) return [];
  return ((r.data || {}).biz_data || {}).chat_messages || [];
}

function extractText(msg) {
  const parts = [];
  let hasMedia = false;
  for (const f of msg.fragments || []) {
    const t = f.type || "";
    if (t === "REQUEST" || t === "RESPONSE") {
      if (f.content) parts.push(f.content);
    } else if (t.includes("IMAGE") || t.includes("FILE")) {
      hasMedia = true;
    }
  }
  let text = parts.join("\n").trim();
  if (!text && hasMedia) text = "[图片消息]";
  return { text, hasMedia };
}

function cleanDeepseekMsg(m, sessionMeta) {
  const roleRaw = (m.role || "").toUpperCase();
  const role = roleRaw === "USER" ? "user" : roleRaw === "ASSISTANT" ? "assistant" : "unknown";
  const ts = Math.floor(m.inserted_at || 0);
  const { text, hasMedia } = extractText(m);
  return {
    msg_id: String(m.message_id || ""),
    role,
    ts,
    content: (text || "").slice(0, 5000),
    has_media: hasMedia,
    model: m.model || sessionMeta.model_type || null,
    section_id: sessionMeta.id,
  };
}

export async function pullDeepseek(onProgress, prevConvs = []) {
  const prevById = new Map((prevConvs || []).map(c => [c.conv_id, c]));
  const sessions = await listSessions();
  const conversations = [];
  const stats = { skipped: 0, updated: 0, fresh: 0 };

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const sid = s.id;
    const name = s.title || "(无标题)";
    const updatedAt = s.updated_at || 0;  // float 秒
    const prev = prevById.get(sid);

    let cleaned, mode;
    if (!prev) {
      const msgs = await fetchMessages(sid);
      cleaned = msgs.map(m => cleanDeepseekMsg(m, s));
      mode = "fresh"; stats.fresh++;
    } else if (prev.updated_at_float != null && Math.abs(prev.updated_at_float - updatedAt) < 0.001) {
      cleaned = prev.messages; mode = "skipped"; stats.skipped++;
    } else {
      // DeepSeek 全量返回 → 直接全拉一次比 anchor 简单
      const msgs = await fetchMessages(sid);
      cleaned = msgs.map(m => cleanDeepseekMsg(m, s));
      mode = "updated"; stats.updated++;
    }

    cleaned.sort((a, b) => a.ts - b.ts || (a.msg_id < b.msg_id ? -1 : 1));
    const firstTs = cleaned.length ? cleaned[0].ts : Math.floor(s.inserted_at || 0);
    const lastTs = cleaned.length ? cleaned[cleaned.length - 1].ts : Math.floor(updatedAt);

    conversations.push({
      conv_id: sid, name, badge_count: 0, conv_type: 0,
      updated_at_float: updatedAt,
      first_ts: firstTs, last_ts: lastTs, messages: cleaned,
      platform: "deepseek",
    });
    if (onProgress) onProgress({ platform: "deepseek", i: i + 1, n: sessions.length, name, msgs: cleaned.length, mode });
  }
  console.log(`[pullDeepseek] 增量：新 ${stats.fresh} / 更新 ${stats.updated} / 复用 ${stats.skipped}（共 ${sessions.length}）`);
  return {
    fetched_at: new Date().toISOString(),
    user_id: "", platform: "deepseek",
    conversations, incremental_stats: stats,
  };
}
