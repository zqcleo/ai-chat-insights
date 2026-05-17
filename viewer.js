// viewer.js — 两种模式：
//   1. ?run=1（或第一次没数据）：跑完整流程 detect + pull + analyze + render
//   2. 普通：直接读 storage 渲染最近一次报告

import { detectLogin } from "./lib/detect.js";
import { pullDoubao, setDoubaoFetcher } from "./lib/doubao-api.js";
import { pullYuanbao, setYuanbaoFetcher } from "./lib/yuanbao-api.js";
import { pullQianwen, setQianwenFetcher } from "./lib/qianwen-api.js";
import { pullDeepseek, setDeepseekFetcher } from "./lib/deepseek-api.js";
import { tabFetch, closeOpenedTabs } from "./lib/tab-fetch.js";

// 装上 content-script 代理 fetch（解决 cross-origin 403）
setDoubaoFetcher((url, init) => tabFetch("doubao", url, init));
setYuanbaoFetcher((url, init) => tabFetch("yuanbao", url, init));
setQianwenFetcher((url, init) => tabFetch("qianwen", url, init));
setDeepseekFetcher((url, init) => tabFetch("deepseek", url, init));

const PLATFORM_PULLERS = {
  doubao: pullDoubao,
  yuanbao: pullYuanbao,
  qianwen: pullQianwen,
  deepseek: pullDeepseek,
};
const PLATFORM_LABELS = { doubao: "豆包", yuanbao: "元宝", qianwen: "通义千问", deepseek: "DeepSeek" };

// 把 base_url / provider 翻译成用户认识的品牌名
function brandFromConfig(cfg) {
  const u = (cfg.base_url || "").toLowerCase();
  if (u.includes("anthropic")) return "Claude";
  if (u.includes("deepseek")) return "DeepSeek";
  if (u.includes("openai.com")) return "OpenAI";
  if (u.includes("bigmodel") || u.includes("zhipu")) return "智谱";
  if (u.includes("moonshot")) return "Kimi";
  if (u.includes("dashscope") || u.includes("qwen")) return "通义";
  return cfg.provider === "anthropic" ? "Claude" : "AI";
}
import { computeStats } from "./lib/stats.js";
import { clusterTopics, templateAnalysis } from "./lib/topics.js";
import { analyzeLLM, setLLMProgressCallback } from "./lib/analyze.js";
import { computePlaceholders } from "./lib/report.js";

const $ = (id) => document.getElementById(id);

function setRunner(title, status, pct) {
  $("runner-overlay").hidden = false;
  if (title != null) $("runner-title").textContent = title;
  if (status != null) $("runner-status").textContent = status;
  if (pct != null) $("runner-bar").style.width = `${Math.min(100, pct)}%`;
}

function hideRunner() {
  $("runner-overlay").hidden = true;
}

function showError(msg) {
  setRunner("❌ 失败", msg, 0);
  $("runner-bar").style.background = "#dc2626";
}

// ---- 主流程 ----

async function doRender(stats, raw, analysis) {
  const root = $("report-root");
  root.hidden = false;
  const { placeholders, chartData } = computePlaceholders(stats, raw, analysis);
  // 把 root.innerHTML 里的 {{XXX}} 替换掉
  let html = root.innerHTML;
  for (const [k, v] of Object.entries(placeholders)) {
    html = html.split(k).join(v);
  }
  root.innerHTML = html;
  // 渲染图表
  await new Promise(r => requestAnimationFrame(r));
  if (window.initCharts) window.initCharts(chartData);
  if (window.bindCopyButtons) window.bindCopyButtons();
}

async function runPipeline() {
  const totalStart = Date.now();
  const totalElapsed = () => Math.round((Date.now() - totalStart) / 1000);
  setRunner("生成中…", "检测登录态", 5);

  // 0. 读上一次的 raw 做增量基准
  const { lastInsight, runRequest } = await chrome.storage.local.get(["lastInsight", "runRequest"]);
  const prevByPlatform = {};
  for (const p of Object.keys(PLATFORM_PULLERS)) prevByPlatform[p] = [];
  if (lastInsight && lastInsight.raw && lastInsight.raw.conversations) {
    for (const c of lastInsight.raw.conversations) {
      if (prevByPlatform[c.platform]) prevByPlatform[c.platform].push(c);
    }
    console.log(`[runner] 缓存:`, Object.fromEntries(Object.entries(prevByPlatform).map(([p, l]) => [p, l.length])));
  }

  // 1. detect
  let platforms = runRequest && runRequest.platforms;
  if (!platforms) {
    platforms = {};
    for (const p of Object.keys(PLATFORM_PULLERS)) platforms[p] = await detectLogin(p);
  }
  const enabledPlatforms = Object.keys(PLATFORM_PULLERS).filter(p => platforms[p]);
  if (!enabledPlatforms.length) {
    return showError("没识别到任何平台的登录态。请至少登录豆包/元宝/通义千问/DeepSeek 其中一个。");
  }

  // 2. pull（带增量）按平台串行
  const raws = [];
  const PER_PLATFORM_RANGE = 70 / enabledPlatforms.length;  // 5%~75% 这段切给抓取
  let progressBase = 5;
  for (const p of enabledPlatforms) {
    const label = PLATFORM_LABELS[p] || p;
    const cacheHint = prevByPlatform[p].length
      ? `上次缓存 ${prevByPlatform[p].length} 个`
      : `首次抓取`;

    // 「列对话」阶段的 ticker —— 每秒显示已等多久 + 在 progressBase 上慢爬最多 5%
    // 第一个 onProgress（拿到第一个 session）会清掉
    const phaseStart = Date.now();
    let progressFired = false;
    const listingTicker = setInterval(() => {
      if (progressFired) return;
      const elapsed = Math.round((Date.now() - phaseStart) / 1000);
      const drift = Math.min(5, elapsed * 0.3);
      $("runner-bar").classList.add("shimmer");
      setRunner(null, `${label} · 拉对话列表中… ${elapsed}s（${cacheHint}）`, progressBase + drift);
    }, 500);
    setRunner(null, `${label} · 拉对话列表中…（${cacheHint}）`, progressBase);
    $("runner-bar").classList.add("shimmer");

    try {
      const puller = PLATFORM_PULLERS[p];
      let cached = 0, fetched = 0;
      const r = await puller((info) => {
        progressFired = true;
        $("runner-bar").classList.remove("shimmer");
        const pct = progressBase + (info.i / info.n) * PER_PLATFORM_RANGE;
        if (info.mode === "skipped") cached++; else fetched++;
        const counts = cached > 0 ? `（抓取 ${fetched} · 复用 ${cached}）` : "";
        const title = info.name ? ` · 「${info.name.slice(0, 24)}」` : "";
        setRunner(null, `${label} · ${info.i}/${info.n}${counts}${title}`, pct);
      }, prevByPlatform[p]);
      const s = r.incremental_stats || {};
      console.log(`[runner] ${label} 增量：新 ${s.fresh}, 更新 ${s.updated}, 复用 ${s.skipped}`);
      raws.push(r);
    } catch (e) {
      clearInterval(listingTicker);
      $("runner-bar").classList.remove("shimmer");
      return showError(`${label} 抓取失败：${e.message}`);
    } finally {
      clearInterval(listingTicker);
      $("runner-bar").classList.remove("shimmer");
    }
    progressBase += PER_PLATFORM_RANGE;
  }

  // 3. merge + stats
  const merged = {
    fetched_at: new Date().toISOString(),
    platforms: raws.map(r => r.platform),
    platform_labels: PLATFORM_LABELS,
    conversations: raws.flatMap(r => r.conversations),
  };
  const nConv = merged.conversations.length;
  const nMsg = merged.conversations.reduce((s, c) => s + (c.messages?.length || 0), 0);

  setRunner(null, `统计 KPI · ${nConv} 对话 / ${nMsg} 消息`, 78);
  const stats = computeStats(merged);
  setRunner(null, `聚类话题中…`, 81);
  const topics = clusterTopics(merged);

  // 4. LLM or template（先 sync 后 local 兜底）
  let { llmConfig } = await chrome.storage.sync.get(["llmConfig"]);
  if (!llmConfig) {
    llmConfig = (await chrome.storage.local.get(["llmConfig"])).llmConfig;
  }
  let analysis;
  if (llmConfig && llmConfig.api_key && llmConfig.model) {
    const brand = brandFromConfig(llmConfig);
    $("runner-bar").classList.add("shimmer");
    // 按模型类型给典型耗时区间（不是 timeout，是经验值）
    const modelLower = (llmConfig.model || "").toLowerCase();
    const isThinking = /reasoner|v4-pro|o1|o3|thinking/.test(modelLower);
    const eta = isThinking ? "通常 60-120s" : "通常 10-30s";

    setLLMProgressCallback((stage, elapsed, max, extra) => {
      let msg;
      if (stage === "done")        msg = `${brand} 分析完成（${extra}）`;
      else if (stage === "error")  msg = `${brand} 分析失败：${extra}`;
      else                         msg = `${brand} 分析中… ${elapsed}s · ${eta}`;
      setRunner(null, msg, 85 + Math.min(10, elapsed / max * 10));
    });
    try {
      analysis = await analyzeLLM(merged, stats, llmConfig);
      if (!analysis.topics || analysis.topics.length === 0) analysis.topics = topics;
    } catch (e) {
      console.error("LLM 失败:", e);
      setRunner(null, `AI 总结失败，只显示数据图表（${e.message.slice(0, 60)}）`, 90);
      await new Promise(r => setTimeout(r, 1500));
      analysis = templateAnalysis(stats, topics);
    } finally {
      setLLMProgressCallback(null);
      $("runner-bar").classList.remove("shimmer");
    }
  } else {
    analysis = templateAnalysis(stats, topics);
  }

  // 5. 保存 + 渲染
  setRunner(null, `拼装报告 · ${nConv} 对话 / ${nMsg} 消息`, 95);
  await chrome.storage.local.set({
    lastInsight: { stats, raw: merged, analysis },
    lastReportTs: Date.now(),
    runRequest: null,
  });
  setRunner(null, `渲染图表中…`, 97);
  // 渲染阶段万一抛了（比如 echarts init 引用错变量）也要把 overlay 收起来
  // 不能让进度条永远卡在 97%
  try {
    await doRender(stats, merged, analysis);
  } catch (e) {
    console.error("doRender 失败:", e);
    setRunner(`完成（图表部分失败）`, `${e.message.slice(0, 80)}`, 100);
    setTimeout(hideRunner, 3000);
    try { await closeOpenedTabs(); } catch (_) {}
    return;
  }
  try { await closeOpenedTabs(); } catch (_) {}
  setRunner(`完成 · 用时 ${totalElapsed()}s`, `${enabledPlatforms.length} 平台 / ${nConv} 对话 / ${nMsg} 消息`, 100);
  setTimeout(hideRunner, 1800);
}

async function loadExisting() {
  const { lastInsight } = await chrome.storage.local.get(["lastInsight"]);
  if (!lastInsight) {
    $("report-root").hidden = true;
    setRunner("还没生成报告", "请打开扩展弹窗，点「生成复盘报告」。", 0);
    return;
  }
  const { stats, raw, analysis } = lastInsight;
  await doRender(stats, raw, analysis);
}

// ---- 入口 ----
(async function () {
  const params = new URLSearchParams(location.search);
  const isRun = params.get("run") === "1";
  if (isRun) {
    await runPipeline();
  } else {
    await loadExisting();
  }
})();
