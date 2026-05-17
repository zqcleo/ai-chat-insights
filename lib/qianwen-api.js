// 通义千问爬虫（JS 版，对齐 qianwen.py）
const QS_PARAMS = {
  biz_id: "ai_qwen", chat_client: "h5", device: "pc", fr: "pc", pr: "qwen",
  ut: "5b7b3cd9-17d4-361f-6c51-e4cfe45f3a4e",
  la: "zh-CN", tz: "Asia/Shanghai", wv: "2.8.1", ve: "2.8.1",
};
const DEVICE_ID = QS_PARAMS.ut;
const PAGE_LIMIT = 50;
const MAX_LIST_PAGES = 50;
const MAX_MSG_PAGES = 50;

function qs(extra = {}) {
  const merged = { ...QS_PARAMS, ...extra };
  return Object.entries(merged).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

// 从浏览器自己的 cookie store 取 XSRF-TOKEN（content script 注入后可直接 document.cookie）
async function getXsrfFromCookie() {
  try {
    const cs = await chrome.cookies.getAll({ url: "https://www.qianwen.com/" });
    const c = cs.find(x => x.name === "XSRF-TOKEN");
    return c ? c.value : "";
  } catch { return ""; }
}

let _fetcher = async (url, init) => {
  const r = await fetch(url, { ...init, credentials: "include" });
  if (!r.ok) throw new Error(`qianwen HTTP ${r.status}`);
  return r.json();
};
export function setQianwenFetcher(fn) { _fetcher = fn; }

async function post(path, body, extraQs) {
  const xsrf = await getXsrfFromCookie();
  const url = `https://chat2-api.qianwen.com${path}?${qs(extraQs)}`;
  const headers = {
    "accept": "*/*",
    "accept-language": "zh-CN,zh;q=0.9",
    "content-type": "application/json",
    "x-deviceid": DEVICE_ID,
    "x-platform": "pc_tongyi",
  };
  if (xsrf) headers["x-xsrf-token"] = xsrf;
  return _fetcher(url, { method: "POST", headers, body: JSON.stringify(body) });
}

async function get(path, extraQs) {
  const xsrf = await getXsrfFromCookie();
  const url = `https://chat2-api.qianwen.com${path}?${qs(extraQs)}`;
  const headers = {
    "accept": "*/*",
    "accept-language": "zh-CN,zh;q=0.9",
    "x-deviceid": DEVICE_ID,
    "x-platform": "pc_tongyi",
  };
  if (xsrf) headers["x-xsrf-token"] = xsrf;
  return _fetcher(url, { method: "GET", headers });
}

export async function listSessions() {
  const all = [];
  let nextToken = "";
  for (let i = 0; i < MAX_LIST_PAGES; i++) {
    const r = await post("/api/v2/session/page/list", {
      limit: PAGE_LIMIT, next_token: nextToken,
      sort_field: "modifiedTime", need_filter_tag: true,
    });
    if (r.code !== 0) throw new Error(`qianwen list 失败: ${r.msg}（cookie 是不是过期了？）`);
    const data = r.data || {};
    const page = data.list || [];
    all.push(...page);
    if (!data.have_next_page) break;
    nextToken = data.next_token || "";
    if (!nextToken) break;
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

function uuid11() {
  const a = new Uint8Array(8); crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(36)).join("").slice(0, 11);
}

// 千问每个 turn 会返回多个 event 片段（thinking / search / answer / ...）共享同一 req_id。
// 选最"主"的那条：response_messages 总长最大者。
function respScore(m) {
  return (m.response_messages || []).reduce((s, r) => s + ((r.content || "").length), 0);
}
function dedupeByReqId(events) {
  const best = new Map();
  for (const m of events) {
    const id = m.req_id;
    if (!id) continue;
    const cur = best.get(id);
    if (!cur || respScore(m) > respScore(cur)) best.set(id, m);
  }
  return [...best.values()];
}

export async function fetchMessages(sessionId, opts = {}) {
  const stopAtMsgIds = opts.stopAtMsgIds || null;
  const events = [];                       // 所有事件（含同 req_id 的多片段）
  const seenReqIds = new Set();            // 已经见过的 turn id（用于翻页 cursor）
  const nonceBase = uuid11();
  let hitAnchor = false;
  for (let page = 0; page < MAX_MSG_PAGES && !hitAnchor; page++) {
    const qsExtra = {
      return_response_messages: "true",
      session_id: sessionId,
      biz_id: "ai_qwen",
      event_filter: "all",
      page_size: String(PAGE_LIMIT),
      nonce: `${nonceBase}${page}`,
      timestamp: String(Date.now()),
    };
    if (seenReqIds.size) {
      // cursor 用"最旧的 req_id"（默认从新到老翻）
      qsExtra.next_token = events[events.length - 1].req_id || "";
    }
    let r;
    try { r = await get("/api/v1/session/msg/list", qsExtra); }
    catch (e) { console.warn(`qianwen session ${sessionId} 拉失败:`, e); break; }
    if (r.code !== 0) break;
    const list = (r.data || {}).list || [];
    if (!list.length) break;

    // 当前页是否带来新的 turn？没带来就停（避免 server 返回相同片段导致死循环）
    let pageHadNewTurn = false;
    for (const m of list) {
      if (stopAtMsgIds && stopAtMsgIds.has(m.req_id)) { hitAnchor = true; break; }
      if (!seenReqIds.has(m.req_id)) {
        seenReqIds.add(m.req_id);
        pageHadNewTurn = true;
      }
      events.push(m);
    }
    if (hitAnchor) break;
    if (!pageHadNewTurn) break;
    if (!(r.data || {}).have_next_page) break;
    await new Promise(r => setTimeout(r, 300));
  }
  // 同 req_id 多片段 → 取 response_messages 内容最长那条
  return dedupeByReqId(events);
}

function extractUserText(reqMsgs) {
  if (!reqMsgs || !reqMsgs.length) return "";
  for (const rm of reqMsgs) {
    if ((rm.mime_type || "").startsWith("text/") && rm.content) return rm.content;
  }
  return reqMsgs[0].content || "";
}

function extractAiText(respMsgs) {
  const candidates = [];
  let hasImage = false;
  for (const rm of respMsgs || []) {
    const mt = rm.mime_type || "";
    if (typeof rm.content === "string" && rm.content.length >= 20) {
      candidates.push({ mt, content: rm.content });
    }
    if (mt.includes("image")) hasImage = true;
  }
  if (!candidates.length) return { text: hasImage ? "[图片消息]" : "", hasImage };
  candidates.sort((a, b) => {
    const score = (x) => x.mt.includes("markdown") ? 0 : x.mt.includes("multi_load") ? 1 : 2;
    return score(a) - score(b) || b.content.length - a.content.length;
  });
  let text = candidates[0].content.replace(/<[^>]+>/g, "").trim();
  return { text, hasImage };
}

function cleanQianwenTurn(m, sessionId) {
  const reqId = m.req_id || "";
  const reqTs = m.request_timestamp || 0;
  const ts = reqTs ? Math.floor(reqTs / 1000) : 0;
  const respTs = m.response_timestamp || reqTs;
  const aiTs = respTs ? Math.floor(respTs / 1000) : ts;
  const reqMsgs = m.request_messages || [];
  const respMsgs = m.response_messages || [];
  const userText = extractUserText(reqMsgs);
  const { text: aiText, hasImage } = extractAiText(respMsgs);
  const hasMedia = hasImage || (reqMsgs.concat(respMsgs).some(r => (r.mime_type || "").includes("image")));
  const model = m.model_name || null;
  const out = [];
  if (userText) {
    out.push({
      msg_id: `${reqId}_u`, role: "user", ts,
      content: userText.slice(0, 5000), has_media: hasMedia,
      model: null, section_id: sessionId,
    });
  }
  if (aiText) {
    out.push({
      msg_id: `${reqId}_a`, role: "assistant", ts: aiTs,
      content: aiText.slice(0, 5000), has_media: false,
      model, section_id: sessionId,
    });
  }
  return out;
}

export async function pullQianwen(onProgress, prevConvs = []) {
  const prevById = new Map((prevConvs || []).map(c => [c.conv_id, c]));
  const sessions = await listSessions();
  const conversations = [];
  const stats = { skipped: 0, updated: 0, fresh: 0 };

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const sid = s.session_id;
    const name = s.title || "(无标题)";
    const lastReqTs = parseInt(s.last_req_timestamp || 0);  // 千问的时间戳是 ms
    const prev = prevById.get(sid);

    let cleaned, mode;
    if (!prev) {
      const turns = await fetchMessages(sid);
      cleaned = turns.flatMap(m => cleanQianwenTurn(m, sid));
      mode = "fresh"; stats.fresh++;
    } else if (prev.last_req_timestamp && prev.last_req_timestamp === lastReqTs) {
      cleaned = prev.messages; mode = "skipped"; stats.skipped++;
    } else {
      // 增量：knownIds 是已缓存的 req_id 集合（msg_id 是 "{reqId}_u" 或 "{reqId}_a"，统一去掉后缀）
      const knownReqIds = new Set(prev.messages.map(m => m.msg_id.replace(/_[ua]$/, "")));
      const newTurns = await fetchMessages(sid, { stopAtMsgIds: knownReqIds });
      const newClean = newTurns.flatMap(m => cleanQianwenTurn(m, sid));
      const byId = new Map(prev.messages.map(m => [m.msg_id, m]));
      for (const m of newClean) byId.set(m.msg_id, m);
      cleaned = [...byId.values()];
      mode = "updated"; stats.updated++;
    }

    cleaned.sort((a, b) => a.ts - b.ts || (a.msg_id < b.msg_id ? -1 : 1));
    const firstTs = cleaned.length ? cleaned[0].ts : Math.floor((s.created_at || 0) / 1000);
    const lastTs = cleaned.length ? cleaned[cleaned.length - 1].ts : Math.floor(lastReqTs / 1000);

    conversations.push({
      conv_id: sid, name, badge_count: s.unread_cnt || 0, conv_type: 0,
      last_req_timestamp: lastReqTs,
      first_ts: firstTs, last_ts: lastTs, messages: cleaned,
      platform: "qianwen",
    });
    if (onProgress) onProgress({ platform: "qianwen", i: i + 1, n: sessions.length, name, msgs: cleaned.length, mode });
  }
  console.log(`[pullQianwen] 增量：新 ${stats.fresh} / 更新 ${stats.updated} / 复用 ${stats.skipped}（共 ${sessions.length}）`);
  return {
    fetched_at: new Date().toISOString(),
    user_id: "", platform: "qianwen",
    conversations, incremental_stats: stats,
  };
}
