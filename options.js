const $ = (id) => document.getElementById(id);

function providerFromBaseUrl(u) {
  return (u || "").toLowerCase().includes("anthropic.com") ? "anthropic" : "openai";
}

function brandFromBaseUrl(u) {
  const s = (u || "").toLowerCase();
  if (s.includes("anthropic")) return "Claude";
  if (s.includes("deepseek")) return "DeepSeek";
  if (s.includes("openai.com")) return "OpenAI";
  if (s.includes("bigmodel") || s.includes("zhipu")) return "智谱";
  if (s.includes("moonshot")) return "Kimi";
  if (s.includes("dashscope") || s.includes("qwen")) return "通义";
  return "自定义";
}

function refreshBadge() {
  const baseUrl = $("base_url").value.trim();
  const apiKey = $("api_key").value.trim();
  const model = $("model").value.trim();
  const b = $("llm-state");
  if (baseUrl && apiKey && model) {
    b.className = "badge";
    b.textContent = `✓ 已启用 · ${brandFromBaseUrl(baseUrl)}`;
  } else if (!baseUrl && !apiKey && !model) {
    b.className = "badge off";
    b.textContent = "未启用";
  } else {
    b.className = "badge";
    b.style.background = "#fef3c7";
    b.style.color = "#92400e";
    b.textContent = "未完成";
  }
}

// LLM 配置走 sync storage（跟 Google 账号走，重装不丢）
// 旧版可能存在 local，做一次迁移
async function load() {
  let llmConfig = (await chrome.storage.sync.get(["llmConfig"])).llmConfig;
  if (!llmConfig) {
    const local = (await chrome.storage.local.get(["llmConfig"])).llmConfig;
    if (local) {
      llmConfig = local;
      // 迁移到 sync
      await chrome.storage.sync.set({ llmConfig });
      console.log("[insights] LLM 配置从 local 迁移到 sync");
    }
  }
  if (llmConfig) {
    $("base_url").value = llmConfig.base_url || "";
    $("api_key").value = llmConfig.api_key || "";
    $("model").value = llmConfig.model || "";
  }
  refreshBadge();
}

$("base_url").addEventListener("input", refreshBadge);
$("api_key").addEventListener("input", refreshBadge);
$("model").addEventListener("input", refreshBadge);

$("save").addEventListener("click", async () => {
  const base_url = $("base_url").value.trim();
  const api_key = $("api_key").value.trim();
  const model = $("model").value.trim();
  const s = $("status");

  // 三选一全空 → 关 LLM
  if (!base_url && !api_key && !model) {
    await chrome.storage.sync.remove(["llmConfig"]);
    await chrome.storage.local.remove(["llmConfig"]);
    s.textContent = "✓ LLM 已关闭";
    s.className = "status ok";
    setTimeout(() => { s.textContent = ""; }, 2500);
    return;
  }
  // 任一非空但不完整 → 拒绝保存
  if (!base_url || !api_key || !model) {
    s.textContent = `✗ 缺少：${[!base_url && "Base URL", !api_key && "API Key", !model && "Model"].filter(Boolean).join("、")}`;
    s.className = "status fail";
    return;
  }
  // 全填好 → 自动判 provider
  const llmConfig = {
    provider: providerFromBaseUrl(base_url),
    base_url,
    api_key,
    model,
  };
  await chrome.storage.sync.set({ llmConfig });
  await chrome.storage.local.remove(["llmConfig"]);  // 清掉老 local（避免混乱）
  s.textContent = `✓ 已保存（${brandFromBaseUrl(base_url)}）`;
  s.className = "status ok";
  refreshBadge();
  setTimeout(() => { s.textContent = ""; }, 2500);
});

$("clear-llm").addEventListener("click", async () => {
  if (!confirm("关闭 LLM？后续报告会走纯本地统计 + 关键词聚类的模板版。")) return;
  await chrome.storage.sync.remove(["llmConfig"]);
  await chrome.storage.local.remove(["llmConfig"]);
  $("base_url").value = "";
  $("api_key").value = "";
  $("model").value = "";
  refreshBadge();
  const s = $("status");
  s.textContent = "✓ LLM 已关闭";
  s.className = "status ok";
  setTimeout(() => { s.textContent = ""; }, 2000);
});

$("clear-data").addEventListener("click", async () => {
  if (!confirm("清空上次抓取的 raw / 报告？LLM 配置会保留。")) return;
  await chrome.storage.local.remove(["lastInsight", "lastReportTs", "runRequest"]);
  const s = $("clear-status");
  s.textContent = "✓ 已清";
  s.className = "status ok";
  setTimeout(() => { s.textContent = ""; }, 2000);
});

$("clear-all").addEventListener("click", async () => {
  if (!confirm("清空所有本地数据（含 LLM 配置 + Google 账号同步的部分）？")) return;
  await chrome.storage.local.clear();
  await chrome.storage.sync.clear();
  $("base_url").value = "";
  $("api_key").value = "";
  $("model").value = "";
  refreshBadge();
  const s = $("clear-status");
  s.textContent = "✓ 已清空";
  s.className = "status ok";
  setTimeout(() => { s.textContent = ""; }, 2000);
});

load();
