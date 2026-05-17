// 腾讯元宝 web API 爬虫（JS 版，与 yuanbao.py 字段对齐）
const DEFAULT_AGENT_ID = "naQivTmsDa";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const CONV_PAGE_LIMIT = 40;
// 元宝 detail 的 `offset` 实际是 "max id 游标"，不是 skip-N：
//   offset=0 → 返回最新 limit 条
//   offset=N (N>0) → 返回 id 后缀 < N 的，倒序，最多 limit 条
// 所以分页要用本页最小的 id-suffix 当下次 offset，否则长对话会漏抓。
// 服务端单次最多塞 60，超长对话靠 cursor 多翻几次。
const MSG_PAGE_LIMIT = 60;
const MAX_MSG_PAGES = 50;  // 60 × 50 = 3000 条/对话 兜底

function randomHex(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}

// 默认 fetch（Node 测试用）；扩展环境调 setYuanbaoFetcher 注入 tab-fetch 代理
let _fetcher = async (url, init) => {
  const r = await fetch(url, { ...init, credentials: "include" });
  if (!r.ok) throw new Error(`yuanbao HTTP ${r.status}`);
  return r.json();
};
export function setYuanbaoFetcher(fn) { _fetcher = fn; }

async function post(path, body, agentId) {
  const url = `https://yuanbao.tencent.com${path}`;
  return _fetcher(url, {
    method: "POST",
    headers: {
      "accept": "application/json, text/plain, */*",
      "accept-language": "zh-CN,zh;q=0.9",
      "content-type": "application/json",
      "x-agentid": agentId,
      "x-language": "zh-CN",
      "x-platform": "mac",
      "x-source": "web",
      "x-id": randomHex(16),
      "x-instance-id": "5",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify(body),
  });
}

function extractText(msg) {
  const parts = [];
  let hasImage = false, hasFile = false;
  for (const sp of msg.speechesV2 || []) {
    for (const item of sp.content || []) {
      if (item.type === "text") {
        const t = (item.msg || "").trim();
        if (t) parts.push(t);
      } else if (item.type === "image") {
        hasImage = true;
      } else if (item.type === "file") {
        hasFile = true;
        parts.push("[文件消息]");
      }
    }
  }
  let text = parts.join("\n");
  if (!text && hasImage) text = "[图片消息]";
  if (!text) text = (msg.speech || msg.displayPrompt || "").trim();
  return { text, hasMedia: hasImage || hasFile };
}

function extractModel(msg) {
  for (const sp of msg.speechesV2 || []) {
    if (sp.chatModelId) return sp.chatModelId;
  }
  return null;
}

export async function listConversations(agentId = DEFAULT_AGENT_ID) {
  const all = [];
  let offset = 0;
  while (true) {
    const body = {
      agentId,
      offset,
      limit: CONV_PAGE_LIMIT,
      filterGoodQuestion: true,
    };
    const r = await post("/api/user/agent/conversation/list", body, agentId);
    if (!r || !("conversations" in r)) {
      throw new Error(`conversation/list 失败：${JSON.stringify(r).slice(0, 300)}（cookie 是不是过期了？）`);
    }
    const page = r.conversations;
    all.push(...page);
    const total = (r.pagination || {}).totalResults || 0;
    if (page.length < CONV_PAGE_LIMIT || all.length >= total) break;
    offset += CONV_PAGE_LIMIT;
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

// 元宝 m.id 形如 "{uuid}_{N}"，取末尾数字当 cursor
function indexOf(id) {
  const m = String(id || "").match(/_(\d+)$/);
  return m ? parseInt(m[1], 10) : NaN;
}

// stopAtMsgIds: Set<string>，命中就停（增量模式用）
export async function fetchMessages(convId, agentId = DEFAULT_AGENT_ID, opts = {}) {
  const stopAtMsgIds = opts.stopAtMsgIds || null;
  const all = [];
  const seenIds = new Set();
  let cursor = 0;  // 0 = "拿最新 limit 条"；之后 = 上一页里最小的 id-suffix
  let hitAnchor = false;

  for (let i = 0; i < MAX_MSG_PAGES && !hitAnchor; i++) {
    const body = {
      conversationId: String(convId),
      offset: cursor,
      limit: MSG_PAGE_LIMIT,
      agentId,
    };
    let r;
    try { r = await post("/api/user/agent/conversation/v1/detail", body, agentId); }
    catch (e) { console.warn(`yuanbao conv ${convId} 拉失败:`, e); break; }
    const page = (r && r.convs) || [];
    if (!page.length) break;

    let minIdx = Infinity;
    let addedThisPage = 0;
    for (const m of page) {
      if (stopAtMsgIds && stopAtMsgIds.has(m.id)) { hitAnchor = true; break; }
      if (!seenIds.has(m.id)) {
        seenIds.add(m.id);
        all.push(m);
        addedThisPage++;
      }
      const idx = indexOf(m.id);
      if (!isNaN(idx) && idx < minIdx) minIdx = idx;
    }

    if (hitAnchor) break;
    if (!r.hasMore) break;
    if (addedThisPage === 0) break;             // 服务端循环返回同一页 → 退出
    if (minIdx === Infinity || minIdx <= 1) break;  // 已经翻到最老一条
    cursor = minIdx;                            // 下一页只取 id < minIdx
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

function cleanYuanbaoMsg(m, meta) {
  const sp = m.speaker;
  const role = sp === "human" ? "user" : sp === "ai" ? "assistant" : "unknown";
  const { text, hasMedia } = extractText(m);
  return {
    msg_id: m.id || "",
    role,
    ts: parseInt(m.createTime || 0),
    content: (text || "").slice(0, 5000),
    has_media: hasMedia,
    model: extractModel(m) || (meta && meta.chatModelId),
    section_id: m.conversationId || "",
  };
}

export async function pullYuanbao(onProgress, prevConvs = [], agentId = DEFAULT_AGENT_ID) {
  const prevById = new Map((prevConvs || []).map(c => [c.conv_id, c]));
  const convsMeta = await listConversations(agentId);
  const conversations = [];
  const stats = { skipped: 0, updated: 0, fresh: 0 };

  for (let i = 0; i < convsMeta.length; i++) {
    const meta = convsMeta[i];
    const cid = meta.id;
    const name = meta.title || "(无标题)";
    const lastRepliedAt = parseInt(meta.lastRepliedAt || 0);
    const prev = prevById.get(cid);

    let cleaned, mode;
    if (!prev) {
      const msgsRaw = await fetchMessages(cid, agentId);
      cleaned = msgsRaw.map(m => cleanYuanbaoMsg(m, meta));
      mode = "fresh";
      stats.fresh++;
    } else if (prev.last_replied_at && prev.last_replied_at === lastRepliedAt) {
      cleaned = prev.messages;
      mode = "skipped";
      stats.skipped++;
    } else {
      const knownIds = new Set(prev.messages.map(m => m.msg_id));
      const newMsgsRaw = await fetchMessages(cid, agentId, { stopAtMsgIds: knownIds });
      const newClean = newMsgsRaw.map(m => cleanYuanbaoMsg(m, meta));
      const byId = new Map(prev.messages.map(m => [m.msg_id, m]));
      for (const m of newClean) byId.set(m.msg_id, m);
      cleaned = [...byId.values()];
      mode = "updated";
      stats.updated++;
    }

    cleaned.sort((a, b) => a.ts - b.ts || (a.msg_id < b.msg_id ? -1 : 1));
    const firstTs = cleaned.length ? cleaned[0].ts : parseInt(meta.firstRepliedAt || 0);
    const lastTs = cleaned.length ? cleaned[cleaned.length - 1].ts : lastRepliedAt;

    conversations.push({
      conv_id: cid,
      name,
      badge_count: 0,
      conv_type: meta.chatType || 0,
      last_replied_at: lastRepliedAt,
      first_ts: firstTs,
      last_ts: lastTs,
      messages: cleaned,
      platform: "yuanbao",
    });
    if (onProgress) onProgress({ platform: "yuanbao", i: i + 1, n: convsMeta.length, name, msgs: cleaned.length, mode });
  }
  console.log(`[pullYuanbao] 增量结果：新 ${stats.fresh} / 更新 ${stats.updated} / 复用 ${stats.skipped}（共 ${convsMeta.length}）`);
  return {
    fetched_at: new Date().toISOString(),
    user_id: convsMeta[0] ? (convsMeta[0].userId || "") : "",
    platform: "yuanbao",
    conversations,
    incremental_stats: stats,
  };
}
