// 豆包 web API 爬虫（JS 版，与 doubao.py 字段对齐）
// 设备指纹来自 HAR 抓包样本，跨用户复用没问题但若被风控建议替换。

const QS_PARAMS = {
  version_code: "20800",
  language: "zh",
  device_platform: "web",
  aid: "497858",
  real_aid: "497858",
  pkg_type: "release_version",
  device_id: "7637927092826572322",
  pc_version: "3.17.2",
  web_id: "7571803084512577024",
  tea_uuid: "7571803084512577024",
  region: "",
  sys_region: "",
  samantha_web: "1",
  "use-olympus-account": "1",
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const PAGE_LIMIT = 20;
const MAX_PAGES_PER_CONV = 100;

function uuidv4() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
  );
}

function qs() {
  const parts = Object.entries(QS_PARAMS).map(([k, v]) => `${k}=${v}`);
  parts.push(`web_tab_id=${uuidv4()}`);
  return parts.join("&");
}

// 默认 fetch（Node 测试用）；扩展环境调 setDoubaoFetcher 注入 tab-fetch 代理
let _fetcher = async (url, init) => {
  const r = await fetch(url, { ...init, credentials: "include" });
  if (!r.ok) throw new Error(`doubao HTTP ${r.status}`);
  return r.json();
};
export function setDoubaoFetcher(fn) { _fetcher = fn; }

async function post(endpoint, body) {
  const url = `https://www.doubao.com/im/${endpoint}?${qs()}`;
  return _fetcher(url, {
    method: "POST",
    headers: {
      "accept": "application/json, text/plain, */*",
      "agw-js-conv": "str",
      "content-type": "application/json; encoding=utf-8",
    },
    body: JSON.stringify(body),
  });
}

function cleanText(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s.startsWith("{")) return s;
  let d;
  try { d = JSON.parse(s); } catch { return s; }
  if (d && typeof d === "object" && "text" in d) return (d.text || "").trim();
  if ("image_list" in d || "image_url" in d) return "[图片消息]";
  if ("entities" in d) return (d.text || "[文件消息]").trim();
  return s;
}

function hasMediaBlock(msg) {
  for (const cb of msg.content_block || []) {
    const c = cb.content || {};
    if ("image_block" in c || "image_list_block" in c || "file_block" in c ||
        "audio_block" in c || "video_block" in c) return true;
  }
  const raw = msg.content || "";
  if (raw.trim().startsWith("{")) {
    try {
      const d = JSON.parse(raw);
      if (d && typeof d === "object" &&
          ("image_list" in d || "image_url" in d || "entities" in d)) return true;
    } catch {}
  }
  return false;
}

function extractText(msg) {
  const parts = [];
  for (const cb of msg.content_block || []) {
    const tb = (cb.content || {}).text_block || {};
    if (tb && tb.text) parts.push(tb.text);
  }
  const hasMedia = hasMediaBlock(msg);
  const text = parts.length ? parts.join("\n") : (cleanText(msg.content) || cleanText(msg.tts_content));
  return { text, hasMedia };
}

export async function listConversations() {
  const body = {
    cmd: 3200,
    uplink_body: {
      pull_recent_conv_chain_uplink_body: {
        limit: 50,
        message_count_per_conv: 0,
        api_version: 1,
        conv_version: 0,
        direction: 3,
        option: {
          not_need_message: true,
          need_complete_conversation: true,
          need_coco_conversation: true,
          need_coco_bot: true,
          need_pc_pin_chain: true,
          pc_pin_query_type: 0,
        },
      },
    },
    sequence_id: uuidv4(),
    channel: 2,
    version: "1",
  };
  const r = await post("chain/recent_conv", body);
  if (r.status_code !== 0) {
    throw new Error(`recent_conv 失败：${r.status_desc}（cookie 是不是过期了？）`);
  }
  return r.downlink_body.pull_recent_conv_chain_downlink_body.cells || [];
}

// stopAtMsgIds: Set<string>，命中就停（增量模式用）
export async function fetchMessages(convId, convType = 3, opts = {}) {
  const stopAtMsgIds = opts.stopAtMsgIds || null;
  const all = [];
  let anchor = 9007199254740991;
  let hitAnchor = false;
  for (let i = 0; i < MAX_PAGES_PER_CONV && !hitAnchor; i++) {
    const body = {
      cmd: 3100,
      uplink_body: {
        pull_singe_chain_uplink_body: {
          conversation_id: String(convId),
          anchor_index: anchor,
          conversation_type: convType,
          direction: 1,
          limit: PAGE_LIMIT,
          ext: {},
          filter: { index_list: [] },
          evaluate_ab_params: "",
          evaluate_common_params: "",
        },
      },
      sequence_id: uuidv4(),
      channel: 2,
      version: "1",
    };
    let r;
    try { r = await post("chain/single", body); }
    catch (e) { console.warn(`doubao conv ${convId} 拉失败:`, e); break; }
    const msgs = ((r.downlink_body || {}).pull_singe_chain_downlink_body || {}).messages || [];
    if (!msgs.length) break;
    // 检查 anchor 命中：从新到老遍历这一页，遇到 cache 的 msg 就停（这条之前的都已缓存）
    if (stopAtMsgIds) {
      for (const m of msgs) {
        if (stopAtMsgIds.has(m.message_id)) {
          hitAnchor = true;
          break;
        }
        all.push(m);
      }
    } else {
      all.push(...msgs);
    }
    if (hitAnchor) break;
    let newAnchor;
    try {
      newAnchor = Math.min(...msgs.map(m => parseInt(m.index_in_conv || anchor)));
    } catch { break; }
    if (newAnchor >= anchor) break;
    anchor = newAnchor;
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

function cleanDoubaoMsg(m) {
  const ut = m.user_type || 0;
  const role = ut === 1 ? "user" : ut === 2 ? "assistant" : "unknown";
  const { text, hasMedia } = extractText(m);
  return {
    msg_id: m.message_id || "",
    role,
    ts: parseInt(m.create_time || 0),
    content: (text || "").slice(0, 5000),
    has_media: hasMedia,
    model: (m.ext && m.ext.model_id) || null,
    section_id: m.section_id || "",
  };
}

// prevConvs: 上次抓的 conversations 数组，用 conv_version 判增量
export async function pullDoubao(onProgress, prevConvs = []) {
  const prevById = new Map((prevConvs || []).map(c => [c.conv_id, c]));
  const cells = await listConversations();
  const conversations = [];
  const stats = { skipped: 0, updated: 0, fresh: 0 };

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const conv = cell.conversation;
    const cid = conv.conversation_id;
    const ctype = conv.conversation_type || 3;
    const name = conv.name || (conv.conv_extra && conv.conv_extra.inner_bot_name) || "(无标题)";
    const badge = conv.badge_count || 0;
    const cv = conv.conv_version || "";
    const prev = prevById.get(cid);

    let cleaned, mode;
    if (!prev) {
      // 全新对话
      const msgsRaw = await fetchMessages(cid, ctype);
      cleaned = msgsRaw.map(cleanDoubaoMsg);
      mode = "fresh";
      stats.fresh++;
    } else if (prev.conv_version && prev.conv_version === cv) {
      // 没动，复用
      cleaned = prev.messages;
      mode = "skipped";
      stats.skipped++;
    } else {
      // 有更新，按 msg_id 锚点拉
      const knownIds = new Set(prev.messages.map(m => m.msg_id));
      const newMsgsRaw = await fetchMessages(cid, ctype, { stopAtMsgIds: knownIds });
      const newClean = newMsgsRaw.map(cleanDoubaoMsg);
      // 合并 + 去重（以 msg_id 为准，新内容覆盖旧）
      const byId = new Map(prev.messages.map(m => [m.msg_id, m]));
      for (const m of newClean) byId.set(m.msg_id, m);
      cleaned = [...byId.values()];
      mode = "updated";
      stats.updated++;
    }

    cleaned.sort((a, b) => a.ts - b.ts || (a.msg_id < b.msg_id ? -1 : 1));
    const firstTs = cleaned.length ? cleaned[0].ts : 0;
    const lastTs = cleaned.length ? cleaned[cleaned.length - 1].ts : 0;

    conversations.push({
      conv_id: cid,
      name,
      badge_count: badge,
      conv_type: ctype,
      conv_version: cv,
      first_ts: firstTs,
      last_ts: lastTs,
      messages: cleaned,
      platform: "doubao",
    });
    if (onProgress) onProgress({ platform: "doubao", i: i + 1, n: cells.length, name, msgs: cleaned.length, mode });
  }
  console.log(`[pullDoubao] 增量结果：新 ${stats.fresh} / 更新 ${stats.updated} / 复用 ${stats.skipped}（共 ${cells.length}），丢 ${prevById.size - cells.filter(c => prevById.has(c.conversation.conversation_id)).length}`);
  return {
    fetched_at: new Date().toISOString(),
    user_id: "",
    platform: "doubao",
    conversations,
    incremental_stats: stats,
  };
}
