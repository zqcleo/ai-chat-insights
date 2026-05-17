// analyze.js — LLM 调用 + prompt 拼接（翻自 analyze.py + llm.py）
// JSON mode：anthropic 用 prefill「{」、openai 兼容用 response_format。

function platformPromptLabels(platforms, platformLabels) {
  return platforms.map(p => platformLabels[p] || p);
}

function systemPrompt(labels) {
  const platText = labels.map(p => `「${p}」`).join("、");
  const platShort = labels.join("/");
  return `你是一个 AI 使用教练。用户给你 ta 跟 ${platText} 这些 AI 助手的全部对话历史 + 基础统计数据，你的任务是输出一份诚实、具体、可操作的"使用复盘报告"。

你需要同时戴三顶帽子：
1. 客观助理：用数据说话，不夸不贬
2. AI 选择顾问：诚实评估"这件事 ${platShort} 哪个做得更好，是不是该换 Claude / ChatGPT / Gemini 等其他 AI"
3. 效率教练：教用户怎么把这些 AI 用得更高效

⚠️ 当用户在多个平台上有数据时，必须做横向对比。

# 输出格式：严格 JSON

只输出一个 JSON 对象，不要任何额外文字、注释、markdown 代码块标记。Schema：

{
  "glance": {
    "working":   "1-2 句精华，说用户哪里在 work。中文。",
    "hindering": "1-2 句精华，说哪里卡住了 / 工具用错了。中文。",
    "quickwins": "1-2 句精华，3 个最该立即试的动作。中文。",
    "horizon":   "1-2 句精华，长期工作流应该怎么变。中文。"
  },
  "narrative": {
    "paragraphs": ["第1段...", "第2段...", "第3段..."],
    "key_pattern": "一句话总结使用模式（≤40 字）"
  },
  "topics": [
    {"name":"主题名","n_sessions":数字,"description":"1-3 句","platforms":["doubao"|"yuanbao"|"qianwen"|"deepseek"]},
    ... 5-7 个
  ],
  "wins": [{"title":"短标题","desc":"2-4 句带数据引用"}, ... 3-5 条],
  "frictions": [{"title":"...","desc":"...","examples":["对话引用 1","引用 2"]}, ... 3-5 条],
  "suggestions": [{"title":"动作型","desc":"why & how","copyable":"prompt 模板或空字符串"}, ... 3-5 条],
  "features_to_try": [{"platform":"doubao"|"yuanbao"|"qianwen"|"deepseek","title":"功能名","oneliner":"是什么","why_for_you":"引用对话","copyable":""}, ... 3-5 条],
  "horizon": [{"title":"...","desc":"...","copyable":""}, ... 1-3 条],
  "fun_ending": {"headline":"金句","detail":"1-2 句解释"}
}

要求：每个观察带数据/对话名引用 + 平台标签；不要鸡汤；中文输出；title 也用中文。`;
}

function summarizeConv(conv, platformLabel) {
  const msgs = conv.messages || [];
  if (!msgs.length) return null;
  const n = msgs.length;
  let sample;
  if (n <= 5) {
    sample = msgs.map((m, i) => ({ m, marker: "" }));
  } else {
    const head = msgs.slice(0, 3).map(m => ({ m, marker: "" }));
    const mid = msgs[Math.floor(n / 2)];
    const tail = msgs[msgs.length - 1];
    sample = [
      ...head,
      { m: mid, marker: "  ⋯⋯（中间略）⋯⋯" },
      { m: tail, marker: "  ⋯⋯（最后一条）⋯⋯" },
    ];
  }
  const lines = [];
  for (const { m, marker } of sample) {
    if (marker) lines.push(marker);
    const role = m.role === "user" ? "我" : platformLabel;
    const c = (m.content || "").slice(0, 200).replace(/\n/g, " ");
    lines.push(`  ${role}: ${c}`);
  }
  return { name: conv.name, n_msg: n, sample: lines.join("\n") };
}

function buildPrompt(raw, stats) {
  const kpi = stats.kpi;
  const platforms = stats.platforms;
  const platformLabels = stats.platform_labels;
  const labels = platformPromptLabels(platforms, platformLabels);

  const lines = [];
  lines.push(`# 我和 ${labels.join("、")} 的对话数据\n`);
  lines.push("## 总体基础统计\n");
  lines.push(`- 总对话数：${kpi.n_conv}`);
  lines.push(`- 总消息数：${kpi.n_msg}（我发 ${kpi.n_user} / AI 回 ${kpi.n_bot}）`);
  lines.push(`- 时间跨度：${kpi.first_date} ~ ${kpi.last_date}（${kpi.span_days} 天）`);
  lines.push(`- 活跃日：${kpi.n_active_days} 天（活跃率 ${kpi.active_rate}%）`);
  lines.push(`- 拒答次数：${stats.refusals.count}（占 AI 回复 ${stats.refusals.rate_pct}%）`);
  lines.push("");

  if (stats.by_platform.length) {
    lines.push("## 每个平台分别\n");
    for (const p of stats.by_platform) {
      lines.push(`- 【${p.label}】对话 ${p.n_conv} / 消息 ${p.n_msg}（我 ${p.n_user} / AI ${p.n_bot}） / 活跃 ${p.n_active_days} 天 / ${p.first_date}~${p.last_date}`);
    }
    lines.push("");
  }

  lines.push("## 模型 mix");
  for (const m of stats.model_mix) {
    lines.push(`- [${m.platform_label}] model=${m.model}: ${m.count} 条`);
  }
  lines.push("");

  lines.push("## 所有对话清单（按平台分组、消息数倒序）\n");
  const byPlatform = {};
  for (const c of stats.top_convs) {
    byPlatform[c.platform] = byPlatform[c.platform] || [];
    byPlatform[c.platform].push(c);
  }
  for (const p of platforms) {
    const list = byPlatform[p] || [];
    if (!list.length) continue;
    lines.push(`### ${platformLabels[p] || p}（${list.length} 个对话）`);
    list.forEach((c, i) => lines.push(`${i + 1}. ${c.name}（${c.n_msg} 条，${c.first} ~ ${c.last}）`));
    lines.push("");
  }

  lines.push("## 对话样本（每对话前 3 + 中间 1 + 末 1）\n");
  const convs = raw.conversations || [];
  const samplesPerPlat = 25;
  for (const p of platforms) {
    const plat = convs.filter(c => c.platform === p);
    plat.sort((a, b) => b.messages.length - a.messages.length);
    if (!plat.length) continue;
    const label = platformLabels[p] || p;
    lines.push(`### ${label}\n`);
    for (const c of plat.slice(0, samplesPerPlat)) {
      const s = summarizeConv(c, label);
      if (!s) continue;
      lines.push(`#### [${label}] 对话「${s.name}」（${s.n_msg} 条）`);
      lines.push(s.sample);
      lines.push("");
    }
    lines.push("");
  }

  return lines.join("\n");
}

function parseJSONResponse(text) {
  let s = text.trim();
  const fence = s.match(/^```(?:json)?\s*\n([\s\S]*)\n```\s*$/);
  if (fence) s = fence[1].trim();
  if (!s.startsWith("{")) {
    const i = s.indexOf("{");
    if (i >= 0) s = s.slice(i);
  }
  if (!s.endsWith("}")) {
    const j = s.lastIndexOf("}");
    if (j >= 0) s = s.slice(0, j + 1);
  }
  return JSON.parse(s);
}

const LLM_TIMEOUT_MS = 180000;  // 3 分钟（reasoner CoT 慢）

// 进度回调：(stage, elapsed, max, extra) → void
// stage: "sent" | "waiting" | "received" | "done" | "error"
let _progressCb = null;
export function setLLMProgressCallback(cb) {
  _progressCb = cb;
  // 设完立刻 fire 一次，UI 不用等 1 秒
  if (cb) cb("waiting", 0, Math.round(LLM_TIMEOUT_MS / 1000));
}

// 只管 timeout，不再在这管 tick —— ticker 跑完 body 读完才该停（fetch resolve
// 只意味着 headers 来了，body 还要流好几十秒），所以 ticker 移到 analyzeLLM 顶层管
function fetchWithTimeout(url, init, ms = LLM_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal })
    .finally(() => { clearTimeout(timer); });
}

// 把各种错误归类，给用户看人话
function llmErrorReason(e, raw) {
  if (e && e.name === "AbortError") return "请求超时（180s 未返回）";
  if (e && /Failed to fetch|NetworkError|net::/.test(e.message)) return "网络错误（连不上 LLM API）";
  const msg = (e && e.message) || "";
  // 余额不足（DeepSeek / OpenAI 都会返这类信息）
  if (/Insufficient Balance|insufficient_quota|insufficient[_ ]balance|余额不足|out of credit|exceeded.*quota/i.test(msg)) {
    return "LLM 余额不足，请到扩展设置页填自己的 API key";
  }
  // key 无效
  if (/Invalid API key|Unauthorized|invalid_api_key|authentication.*fail/i.test(msg) || /\b401\b/.test(msg)) {
    return "API key 无效或已失效，请到扩展设置页更新";
  }
  // 限流
  if (/rate.?limit|too many requests|429/i.test(msg)) {
    return "LLM 触发频率限制，等一会再试";
  }
  if (/(\d{3}):\s/.test(msg)) {
    const m = msg.match(/(\d{3})/);
    return `HTTP ${m[1]} 错误：${msg.slice(0, 100)}`;
  }
  if (raw === "" || raw === "{") return "LLM 返回空（思考模型 token 不够，answer 没生成）";
  return msg.slice(0, 120) || "未知错误";
}

async function callAnthropic(config, system, userText, maxTokens) {
  const url = (config.base_url || "https://api.anthropic.com") + "/v1/messages";
  const messages = [
    { role: "user", content: userText },
    { role: "assistant", content: "{" },  // prefill
  ];
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.api_key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`anthropic ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  let out = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim();
  if (!out.startsWith("{")) out = "{" + out;
  return out;
}

async function callOpenAI(config, system, userText, maxTokens) {
  const base = (config.base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${config.api_key}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${config.provider} ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  return j.choices[0].message.content.trim();
}

// 思考模型（reasoning model）token 用量爆炸，需要给足
function isThinkingModel(modelName) {
  const n = (modelName || "").toLowerCase();
  return n.includes("reasoner") || n.includes("v4-pro") || n.includes("o1") || n.includes("o3");
}

export async function analyzeLLM(raw, stats, config) {
  const labels = platformPromptLabels(stats.platforms, stats.platform_labels);
  const system = systemPrompt(labels);
  const user = buildPrompt(raw, stats);
  // schema 拼出来约 5-7K，非思考模型给 8K（留余量），思考模型 16K（含 CoT）
  const maxTokens = isThinkingModel(config.model) ? 16000 : 8000;
  console.log(`[analyzeLLM] model=${config.model} max_tokens=${maxTokens} (thinking=${isThinkingModel(config.model)})`);

  // 启动 ticker：从请求发出一直跑到 body 读完 + JSON.parse 完。
  // 这里管 ticker 是因为 fetch.then 只到 headers 就 resolve，body 还要流几十秒。
  const start = Date.now();
  const maxSec = Math.round(LLM_TIMEOUT_MS / 1000);
  const tick = setInterval(() => {
    if (_progressCb) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      _progressCb("waiting", elapsed, maxSec);
    }
  }, 1000);

  let raw_out = "";
  try {
    if (config.provider === "anthropic") {
      raw_out = await callAnthropic(config, system, user, maxTokens);
    } else {
      raw_out = await callOpenAI(config, system, user, maxTokens);
    }
  } catch (e) {
    clearInterval(tick);
    if (_progressCb) _progressCb("error", 0, 0, llmErrorReason(e, raw_out));
    throw new Error(llmErrorReason(e, raw_out));
  }
  clearInterval(tick);

  if (!raw_out || raw_out.trim() === "" || raw_out.trim() === "{") {
    const msg = llmErrorReason(null, raw_out);
    if (_progressCb) _progressCb("error", 0, 0, msg);
    throw new Error(msg);
  }

  if (_progressCb) _progressCb("done", 0, 0, `${raw_out.length} 字符`);

  let parsed;
  try {
    parsed = parseJSONResponse(raw_out);
  } catch (e) {
    throw new Error(`LLM 返回不是合法 JSON（${e.message}）：${raw_out.slice(0, 200)}`);
  }

  return {
    ...parsed,
    model: config.model,
    provider: config.provider,
    platforms: stats.platforms,
  };
}
