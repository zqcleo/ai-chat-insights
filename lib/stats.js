// stats.js — 翻自 stats.py。纯函数，能在 Node 跑也能在浏览器跑。
// 输入是合并 raw（含多平台 conversations[].platform 标签）。

// 日期函数全部用浏览器本地时区（CST 用户直接 work；其他时区会有小偏差）
function pad(n) { return String(n).padStart(2, "0"); }

function toLocal(ts) {
  if (!ts || ts <= 0) return null;
  return new Date(ts * 1000);
}

function fmtDate(dt) {
  if (!dt) return "—";
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function fmtDateTime(dt) {
  if (!dt) return "—";
  return `${fmtDate(dt)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function localDateKey(ts) {
  const d = toLocal(ts);
  return d ? fmtDate(d) : null;
}

function localWeekday(ts) {
  // 0=Mon..6=Sun
  const d = toLocal(ts);
  if (!d) return 0;
  return (d.getDay() + 6) % 7;
}

function localHour(ts) {
  const d = toLocal(ts);
  return d ? d.getHours() : 0;
}

const MEDIA_MARKERS = ["[图片消息]", "[文件消息]", "[图片]", "[文件]", "[语音]"];

function isMediaMsg(msg) {
  if (msg.has_media) return true;
  const c = msg.content || "";
  return MEDIA_MARKERS.some(mk => c.includes(mk));
}

function platformKpi(convs) {
  const allMsgs = convs.flatMap(c => c.messages);
  const userMsgs = allMsgs.filter(m => m.role === "user");
  const botMsgs = allMsgs.filter(m => m.role === "assistant");
  const tsList = allMsgs.map(m => m.ts).filter(t => t > 0);
  const firstTs = tsList.length ? Math.min(...tsList) : 0;
  const lastTs = tsList.length ? Math.max(...tsList) : 0;
  const spanDays = (firstTs && lastTs) ? Math.floor((lastTs - firstTs) / 86400) : 0;
  const days = new Set(tsList.map(localDateKey).filter(Boolean));
  const nMediaMsg = allMsgs.filter(isMediaMsg).length;
  const nMediaConv = convs.filter(c => c.messages.some(isMediaMsg)).length;
  return {
    n_conv: convs.length,
    n_msg: allMsgs.length,
    n_user: userMsgs.length,
    n_bot: botMsgs.length,
    n_active_days: days.size,
    first_date: firstTs ? fmtDate(toLocal(firstTs)) : "—",
    last_date: lastTs ? fmtDate(toLocal(lastTs)) : "—",
    span_days: spanDays,
    active_rate: spanDays ? Math.round((days.size / spanDays) * 1000) / 10 : 0,
    n_media_msg: nMediaMsg,
    n_media_conv: nMediaConv,
    n_text_only_conv: convs.length - nMediaConv,
  };
}

function buildTimeline(convs, platforms) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dailyByPlatform = {};
  for (const p of platforms) dailyByPlatform[p] = {};
  const allDates = new Set();
  for (const c of convs) {
    for (const m of c.messages) {
      if (m.ts > 0) {
        const k = localDateKey(m.ts);
        dailyByPlatform[c.platform] = dailyByPlatform[c.platform] || {};
        dailyByPlatform[c.platform][k] = (dailyByPlatform[c.platform][k] || 0) + 1;
        allDates.add(k);
      }
    }
  }
  const timeline = [];
  const todayMs = today.getTime();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(todayMs - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const entry = { date: key };
    let total = 0;
    for (const p of platforms) {
      const v = (dailyByPlatform[p] || {})[key] || 0;
      entry[p] = v;
      total += v;
    }
    entry.count = total;
    timeline.push(entry);
  }
  // pre-90 count
  const cutoff = new Date(todayMs - 89 * 86400000);
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  let pre90 = 0;
  for (const p of platforms) {
    for (const [k, v] of Object.entries(dailyByPlatform[p] || {})) {
      if (k < cutoffKey) pre90 += v;
    }
  }
  const earliest = [...allDates].sort()[0] || cutoffKey;
  return { timeline, pre90, earliest };
}

function computeAnomalies(convs, allMsgs, userMsgs, platformLabels) {
  const out = [];

  // 🏆 最长对话
  const withMsg = convs.filter(c => c.messages.length);
  if (withMsg.length) {
    const longest = withMsg.reduce((a, b) => b.messages.length > a.messages.length ? b : a);
    out.push({
      emoji: "🏆",
      title: "最长对话",
      value: `「${longest.name}」${longest.messages.length} 条`,
      hint: `${platformLabels[longest.platform] || longest.platform} · ${longest.first_ts ? fmtDate(toLocal(longest.first_ts)) : "—"} 起`,
      platform: longest.platform,
    });
  }

  // 📅 单日峰值
  const dayCounter = {};
  const dayPlatform = {};
  for (const c of convs) {
    for (const m of c.messages) {
      if (m.ts > 0) {
        const k = localDateKey(m.ts);
        dayCounter[k] = (dayCounter[k] || 0) + 1;
        dayPlatform[k] = dayPlatform[k] || {};
        dayPlatform[k][c.platform] = (dayPlatform[k][c.platform] || 0) + 1;
      }
    }
  }
  const sortedDays = Object.entries(dayCounter).sort((a, b) => b[1] - a[1]);
  if (sortedDays.length) {
    const [peakDay, peakN] = sortedDays[0];
    const plat = Object.entries(dayPlatform[peakDay]).sort((a, b) => b[1] - a[1])[0][0];
    out.push({
      emoji: "📅",
      title: "单日消息峰值",
      value: `${peakDay} · ${peakN} 条`,
      hint: `主战场：${platformLabels[plat] || plat}`,
      platform: plat,
    });
  }

  // 🌙 最熬夜的一条（本地时间口径，跟 fmtDateTime 一致）
  function nightDepth(dt) {
    const h = dt.getHours();
    if (h < 6) return h + 24;     // 00:00–05:59 → 24–29 分（越晚越大）
    if (h >= 22) return h;        // 22:00–23:59 → 22–23 分
    return -1;                    // 白天不参选
  }
  const candidates = [];
  for (const c of convs) {
    for (const m of c.messages) {
      if (m.ts > 0 && m.role === "user") {
        const dt = toLocal(m.ts);
        if (nightDepth(dt) >= 0) candidates.push({ dt, m, c });
      }
    }
  }
  if (candidates.length) {
    candidates.sort((a, b) => nightDepth(b.dt) - nightDepth(a.dt) || b.dt - a.dt);
    const { dt, c } = candidates[0];
    out.push({
      emoji: "🌙",
      title: "最熬夜的一条",
      value: fmtDateTime(dt),
      hint: `「${c.name.slice(0, 18)}」(${platformLabels[c.platform] || c.platform})`,
      platform: c.platform,
    });
  }

  // 🔁 跨度最长的对话
  const spanConvs = convs.filter(c => c.first_ts && c.last_ts && c.messages.length >= 3);
  if (spanConvs.length) {
    const longestSpan = spanConvs.reduce((a, b) => (b.last_ts - b.first_ts) > (a.last_ts - a.first_ts) ? b : a);
    const sd = Math.floor((longestSpan.last_ts - longestSpan.first_ts) / 86400);
    out.push({
      emoji: "🔁",
      title: "你最放心上的对话",
      value: `「${longestSpan.name}」跨 ${sd} 天`,
      hint: `${platformLabels[longestSpan.platform] || longestSpan.platform} · ${fmtDate(toLocal(longestSpan.first_ts))} ~ ${fmtDate(toLocal(longestSpan.last_ts))}`,
      platform: longestSpan.platform,
    });
  }

  // 💀 开了就走
  const dead = convs.filter(c => c.messages.length <= 2);
  if (dead.length) {
    out.push({
      emoji: "💀",
      title: "开了就走的对话",
      value: `${dead.length} 个 ≤ 2 条`,
      hint: "想到啥问一句，没追问、没复用",
    });
  }

  // 🎲 中途换模型
  let switchConvs = 0;
  for (const c of convs) {
    const seen = new Set();
    for (const m of c.messages) {
      if (m.role === "assistant" && m.model) seen.add(m.model);
    }
    if (seen.size >= 2) switchConvs++;
  }
  if (switchConvs) {
    out.push({
      emoji: "🎲",
      title: "中途换过模型",
      value: `${switchConvs} 个对话`,
      hint: "同一对话里手动切过模型",
    });
  }

  // 🦉 夜猫子指数
  const nightUser = userMsgs.filter(m => {
    if (m.ts <= 0) return false;
    const h = localHour(m.ts);
    return [22, 23, 0, 1, 2, 3].includes(h);
  }).length;
  if (userMsgs.length) {
    const pct = Math.round((nightUser / userMsgs.length) * 1000) / 10;
    out.push({
      emoji: "🦉",
      title: "夜猫子指数",
      value: `${pct}%（22:00-04:00）`,
      hint: `${nightUser} / ${userMsgs.length} 条用户消息`,
    });
  }

  // 📆 周末
  const wkUser = userMsgs.filter(m => m.ts > 0 && localWeekday(m.ts) >= 5).length;
  if (userMsgs.length) {
    const pct = Math.round((wkUser / userMsgs.length) * 1000) / 10;
    out.push({
      emoji: "📆",
      title: "周末活跃占比",
      value: `${pct}%`,
      hint: "随机基线 28.6%；高 = 周末加班 / 低 = 工作场景",
    });
  }

  // ⚡ 最懒的提问
  const shortUser = [];
  for (const c of convs) {
    for (const m of c.messages) {
      if (m.role === "user") {
        const txt = (m.content || "").trim();
        if (txt.length >= 1 && txt.length <= 3) shortUser.push(m);
      }
    }
  }
  if (shortUser.length) {
    out.push({
      emoji: "⚡",
      title: "最懒的提问",
      value: `${shortUser.length} 条 ≤ 3 字`,
      hint: "比如「？」「继续」「再来」",
    });
  }

  return out;
}

export function computeStats(raw) {
  const convs = raw.conversations || [];
  const fallback = raw.platform || "doubao";
  const platforms = raw.platforms || [fallback];
  const platformLabels = raw.platform_labels || {};
  for (const p of platforms) if (!platformLabels[p]) platformLabels[p] = p;
  for (const c of convs) if (!c.platform) c.platform = fallback;

  const allMsgs = convs.flatMap(c => c.messages);
  const userMsgs = allMsgs.filter(m => m.role === "user");
  const botMsgs = allMsgs.filter(m => m.role === "assistant");

  const kpi = platformKpi(convs);
  kpi.refuse_count = 0;

  const byPlatform = [];
  for (const p of platforms) {
    const sub = convs.filter(c => c.platform === p);
    if (!sub.length) continue;
    const pk = platformKpi(sub);
    pk.platform = p;
    pk.label = platformLabels[p] || p;
    byPlatform.push(pk);
  }

  const { timeline, pre90, earliest } = buildTimeline(convs, platforms);

  const topConvs = convs
    .filter(c => c.messages.length)
    .map(c => ({
      name: c.name,
      platform: c.platform,
      platform_label: platformLabels[c.platform] || c.platform,
      n_msg: c.messages.length,
      badge: c.badge_count || 0,
      first: c.first_ts ? fmtDate(toLocal(c.first_ts)) : "—",
      last: c.last_ts ? fmtDate(toLocal(c.last_ts)) : "—",
    }))
    .sort((a, b) => b.n_msg - a.n_msg);

  // 模型 mix
  const modelCounter = {};
  for (const c of convs) {
    for (const m of c.messages) {
      if (m.role !== "assistant") continue;
      const mid = m.model || "(未标记)";
      const key = `${c.platform}|${mid}`;
      modelCounter[key] = (modelCounter[key] || 0) + 1;
    }
  }
  const modelMix = Object.entries(modelCounter)
    .map(([k, v]) => {
      const [p, mid] = k.split("|");
      return {
        platform: p,
        platform_label: platformLabels[p] || p,
        model: mid,
        count: v,
        label: `${platformLabels[p] || p} · ${mid}`,
      };
    })
    .sort((a, b) => b.count - a.count);

  // 热力图
  const heatmapGrid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const m of userMsgs) {
    if (m.ts > 0) heatmapGrid[localWeekday(m.ts)][localHour(m.ts)]++;
  }
  const heatmap = [];
  for (let wd = 0; wd < 7; wd++) {
    for (let h = 0; h < 24; h++) heatmap.push([h, wd, heatmapGrid[wd][h]]);
  }

  const platformPie = platforms
    .map(p => ({
      name: platformLabels[p] || p,
      value: convs.filter(c => c.platform === p).reduce((s, c) => s + c.messages.length, 0),
    }))
    .filter(x => x.value > 0);

  const rolePie = [
    { name: "我发的", value: userMsgs.length },
    { name: "AI 回的", value: botMsgs.length },
  ];

  // 拒答
  const refusalPhrases = ["无法回答", "不能回答", "不便回答", "无法提供", "我无法", "抱歉，我", "我不会", "无可奉告"];
  const refusals = botMsgs.filter(m => refusalPhrases.some(p => (m.content || "").includes(p)));

  const anomalies = computeAnomalies(convs, allMsgs, userMsgs, platformLabels);

  return {
    kpi,
    by_platform: byPlatform,
    platforms,
    platform_labels: platformLabels,
    timeline,
    timeline_pre90: pre90,
    earliest_date: earliest,
    top_convs: topConvs,
    model_mix: modelMix,
    heatmap,
    role_pie: rolePie,
    platform_pie: platformPie,
    anomalies,
    refusals: {
      count: refusals.length,
      rate_pct: botMsgs.length ? Math.round((refusals.length / botMsgs.length) * 1000) / 10 : 0,
    },
  };
}
