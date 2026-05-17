// report.js — 翻自 report.py。把 stats + analysis 注入 template.html 占位符。

const PLATFORM_COLORS = {
  doubao: "#2563eb",
  yuanbao: "#f59e0b",
};
const FALLBACK_PALETTE = ["#10b981", "#7c3aed", "#06b6d4", "#ec4899", "#84cc16"];

function colorFor(platform, idx) {
  return PLATFORM_COLORS[platform] || FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
}

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function mdInline(text) {
  // 转义后把 **xx** 还原成 <strong>xx</strong>
  return esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// raw.fetched_at 是 UTC ISO 串，按本地时区格式化（不要直接 slice，否则 UTC 会被误读成本地）
function fmtLocalDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function platformCard(p, color) {
  return `<div class="platform-card" style="--platform-color: ${color}">
  <div class="name">${esc(p.label)}</div>
  <div class="stats">
    对话 <strong>${p.n_conv}</strong> · 消息 <strong>${p.n_msg}</strong><br>
    活跃 <strong>${p.n_active_days}</strong> 天 · 跨度 <strong>${p.span_days}</strong> 天<br>
    ${p.first_date} ~ ${p.last_date}
  </div>
</div>`;
}

function topicCard(t, platformColors, platformLabels) {
  const pills = (t.platforms || []).map(p => {
    const c = platformColors[p] || "#94a3b8";
    return `<span class="platform-pill" style="background:${c}">${esc(platformLabels[p] || p)}</span>`;
  }).join(" ");
  const count = t.n_sessions ? `<span class="topic-count">~${t.n_sessions} 对话</span>` : "";
  return `<div class="topic-card">
  <div class="topic-header">
    <span class="topic-name">${esc(t.name || "?")}</span>
    <span class="topic-meta">${pills} ${count}</span>
  </div>
  <div class="topic-desc">${esc(t.description || "")}</div>
</div>`;
}

function copyable(code) {
  if (!code || !code.trim()) return "";
  return `<div class="copyable-row">
  <code>${esc(code)}</code>
  <button class="copy-btn" onclick="copyText(this)">Copy</button>
</div>`;
}

function winCard(w) {
  return `<div class="win-card">
  <div class="title">${esc(w.title || "")}</div>
  <div class="desc">${esc(w.desc || "")}</div>
</div>`;
}

function frictionCard(f) {
  const ex = f.examples || [];
  const exHtml = ex.length ? `<ul>${ex.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : "";
  return `<div class="friction-card">
  <div class="title">${esc(f.title || "")}</div>
  <div class="desc">${esc(f.desc || "")}</div>
  ${exHtml}
</div>`;
}

function tipCard(s) {
  return `<div class="tip-card">
  <div class="title">${esc(s.title || "")}</div>
  <div class="desc">${esc(s.desc || "")}</div>
  ${copyable(s.copyable)}
</div>`;
}

function horizonCard(h) {
  return `<div class="horizon-card">
  <div class="title">${esc(h.title || "")}</div>
  <div class="desc">${esc(h.desc || "")}</div>
  ${copyable(h.copyable)}
</div>`;
}

function featureCard(f, platformColors, platformLabels) {
  const p = f.platform || "";
  const color = platformColors[p] || "#94a3b8";
  const label = platformLabels[p] || p;
  return `<div class="feature-card" style="--platform-color: ${color}">
  <div class="head"><span class="title">${esc(f.title || "")}</span><span class="platform-pill" style="background:${color}">${esc(label)}</span></div>
  <div class="oneliner">${esc(f.oneliner || "")}</div>
  <div class="why">${esc(f.why_for_you || "")}</div>
  ${copyable(f.copyable)}
</div>`;
}

function anomalyCard(a, platformColors) {
  const color = platformColors[a.platform] || "#94a3b8";
  return `<div class="anomaly-card" style="--anomaly-color: ${color}">
  <div class="anomaly-head"><span class="anomaly-emoji">${esc(a.emoji || "")}</span> ${esc(a.title || "")}</div>
  <div class="anomaly-value">${esc(a.value || "")}</div>
  <div class="anomaly-hint">${esc(a.hint || "")}</div>
</div>`;
}

function narrative(n) {
  const paragraphs = ((n || {}).paragraphs) || [];
  const keyPattern = (n || {}).key_pattern || "";
  const pHtml = paragraphs.length
    ? paragraphs.map(p => `<p>${mdInline(p)}</p>`).join("\n")
    : `<p style="color:var(--gray-soft)">（LLM 未启用 / 未返回长叙事）</p>`;
  const kpHtml = keyPattern
    ? `<div class="key-insight"><strong>Key pattern：</strong>${mdInline(keyPattern)}</div>`
    : "";
  return { paragraphs: pHtml, keyPattern: kpHtml };
}

function mmBar(label, value, total, color) {
  const pct = total ? (value / total) * 100 : 0;
  return `<div class="mm-bar-row">
  <span class="mm-bar-label">${esc(label)}</span>
  <span class="mm-bar-track"><span class="mm-bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></span></span>
  <span class="mm-bar-value">${value} (${pct.toFixed(0)}%)</span>
</div>`;
}

function mmBars(byPlat, totalKey, mediaKey) {
  const rows = [];
  for (const p of byPlat) {
    const total = p[totalKey];
    const media = p[mediaKey];
    const text = total - media;
    rows.push(mmBar(`${p.label} · 文本`, text, total, "#94a3b8"));
    rows.push(mmBar(`${p.label} · 多模态`, media, total, "#7c3aed"));
  }
  return rows.join("\n");
}

export function computePlaceholders(stats, raw, analysis) {
  const kpi = stats.kpi;
  const platforms = stats.platforms || [raw.platform || "doubao"];
  const platformLabels = stats.platform_labels || Object.fromEntries(platforms.map(p => [p, p]));
  const platformColors = Object.fromEntries(platforms.map((p, i) => [p, colorFor(p, i)]));

  const cards = (stats.by_platform || []).map(p => platformCard(p, platformColors[p.platform])).join("\n");
  const topicHtml = ((analysis.topics || [])).map(t => topicCard(t, platformColors, platformLabels)).join("\n") ||
    `<div class="topic-card"><div class="topic-desc" style="color:var(--gray-soft)">（无主题）</div></div>`;
  const winHtml = ((analysis.wins || [])).map(winCard).join("\n") || `<div class="win-card"><div class="desc" style="color:var(--gray-soft)">（无 LLM 模式：跳过该 section）</div></div>`;
  const frictionHtml = ((analysis.frictions || [])).map(frictionCard).join("\n") || `<div class="friction-card"><div class="desc" style="color:var(--gray-soft)">（无 LLM 模式：跳过该 section）</div></div>`;
  const suggHtml = ((analysis.suggestions || [])).map(tipCard).join("\n") || `<div class="tip-card"><div class="desc" style="color:var(--gray-soft)">（无 LLM 模式：跳过该 section）</div></div>`;
  const featureHtml = ((analysis.features_to_try || [])).map(f => featureCard(f, platformColors, platformLabels)).join("\n") || `<div class="feature-card"><div class="why" style="color:var(--gray-soft)">（无 LLM 模式：跳过该 section）</div></div>`;
  const horizonHtml = ((analysis.horizon || [])).map(horizonCard).join("\n") || `<div class="horizon-card"><div class="desc" style="color:var(--gray-soft)">（无 LLM 模式：跳过该 section）</div></div>`;

  const glance = analysis.glance || {};
  const fun = analysis.fun_ending || {};
  const { paragraphs: narrativeP, keyPattern: narrativeKP } = narrative(analysis.narrative);
  const anomalyHtml = ((stats.anomalies || [])).map(a => anomalyCard(a, platformColors)).join("\n");

  const rows = stats.top_convs.slice(0, 25).map(c => {
    const span = c.first === c.last ? c.first : `${c.first} ~ ${c.last}`;
    const color = platformColors[c.platform] || "#94a3b8";
    const tag = `<span class="platform-tag" style="background:${color}">${esc(c.platform_label)}</span>`;
    return `<tr><td>${tag}${esc(c.name)}</td><td class="num">${c.n_msg}</td><td>${span}</td></tr>`;
  }).join("\n");
  // 整个 <table> 用一个 placeholder，避免 {{TOPN_ROWS}} 出现在 <tbody> 文本位置被 HTML parser 踢出
  const topnTable = `<table>
  <thead><tr><th>对话</th><th class="num">消息数</th><th>时间</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;

  const chartData = {
    timeline: stats.timeline,
    model_mix: stats.model_mix,
    heatmap: stats.heatmap,
    platform_pie: stats.platform_pie,
    platforms,
    platform_labels: platformLabels,
    platform_colors: platformColors,
  };

  const platformList = platforms.map(p => platformLabels[p] || p).join("、");

  const placeholders = {
    "{{PLATFORM_LIST}}": esc(platformList),
    "{{PLATFORM_CARDS}}": cards,
    "{{TOPIC_CARDS}}": topicHtml,
    "{{WIN_CARDS}}": winHtml,
    "{{FRICTION_CARDS}}": frictionHtml,
    "{{SUGGESTION_CARDS}}": suggHtml,
    "{{FEATURE_CARDS}}": featureHtml,
    "{{HORIZON_CARDS}}": horizonHtml,
    "{{NARRATIVE_PARAGRAPHS}}": narrativeP,
    "{{NARRATIVE_KEY_PATTERN}}": narrativeKP,
    "{{ANOMALY_CARDS}}": anomalyHtml,
    "{{GLANCE_WORKING}}": esc(glance.working || "—"),
    "{{GLANCE_HINDERING}}": esc(glance.hindering || "—"),
    "{{GLANCE_QUICKWINS}}": esc(glance.quickwins || "—"),
    "{{GLANCE_HORIZON}}": esc(glance.horizon || "—"),
    "{{FUN_HEADLINE}}": esc(fun.headline || ""),
    "{{FUN_DETAIL}}": esc(fun.detail || ""),
    "{{FETCHED_AT}}": esc(fmtLocalDateTime(raw.fetched_at)),
    "{{LLM_PROVIDER}}": esc(analysis.provider || "—"),
    "{{LLM_MODEL}}": esc(analysis.model || "—"),
    "{{KPI_N_CONV}}": String(kpi.n_conv),
    "{{KPI_N_MSG}}": String(kpi.n_msg),
    "{{KPI_N_ACTIVE_DAYS}}": String(kpi.n_active_days),
    "{{KPI_ACTIVE_RATE}}": String(kpi.active_rate),
    "{{KPI_SPAN_DAYS}}": String(kpi.span_days),
    "{{KPI_FIRST_DATE}}": kpi.first_date,
    "{{KPI_LAST_DATE}}": kpi.last_date,
    "{{REFUSE_RATE}}": String(stats.refusals.rate_pct),
    "{{REFUSE_COUNT}}": String(stats.refusals.count),
    "{{TIMELINE_PRE90}}": String(stats.timeline_pre90),
    "{{EARLIEST_DATE}}": stats.earliest_date,
    "{{TOPN_TABLE}}": topnTable,
    "{{DATA_JSON}}": JSON.stringify(chartData),
  };

  return { placeholders, chartData };
}

export function renderReport(stats, raw, analysis, templateHtml) {
  const { placeholders } = computePlaceholders(stats, raw, analysis);
  let out = templateHtml;
  for (const [k, v] of Object.entries(placeholders)) {
    out = out.split(k).join(v);
  }
  return out;
}
