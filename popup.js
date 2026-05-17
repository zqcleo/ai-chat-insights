import { detectLogin, diagnose } from "./lib/detect.js";

const $ = (id) => document.getElementById(id);

const PLATFORMS = ["doubao", "yuanbao", "qianwen", "deepseek"];

const detected = Object.fromEntries(PLATFORMS.map(p => [p, false]));

// effective = checkbox 当前状态（已登录默认勾上，未登录默认不勾，用户可改）
function effective(p) {
  return $(`force-${p}`).checked;
}

function setStatus(platform) {
  const row = $(`row-${platform}`);
  const status = $(`status-${platform}`);
  const isDetected = detected[platform];
  const isChecked = $(`force-${platform}`).checked;
  row.classList.remove("ok", "fail", "skipped");

  if (isChecked && isDetected) {
    row.classList.add("ok");
    status.textContent = "✓ 已登录";
  } else if (isChecked && !isDetected) {
    row.classList.add("ok");
    status.textContent = "✓ 已强制启用";
  } else if (!isChecked && isDetected) {
    row.classList.add("skipped");
    status.textContent = "已跳过";
  } else {
    row.classList.add("fail");
    status.textContent = "未登录";
  }
}

function refreshUI() {
  for (const p of PLATFORMS) setStatus(p);
  const btn = $("generate");
  const anyEnabled = PLATFORMS.some(p => effective(p));
  if (anyEnabled) {
    btn.disabled = false;
    btn.textContent = "生成报告";
  } else {
    btn.disabled = true;
    btn.textContent = "请勾选至少一个平台";
  }
}

async function detectAll() {
  await Promise.all(PLATFORMS.map(async p => { detected[p] = await detectLogin(p); }));
  // 检测完默认按 detected 初始化 checkbox（用户后续可手动改）
  for (const p of PLATFORMS) {
    $(`force-${p}`).checked = detected[p];
  }
  refreshUI();
}

async function openRunner() {
  const platMap = Object.fromEntries(PLATFORMS.map(p => [p, effective(p)]));
  await chrome.storage.local.set({
    runRequest: { ts: Date.now(), platforms: platMap },
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html?run=1") });
  window.close();
}

async function openLastReport() {
  await chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
}

async function showDiagnose(e) {
  e.preventDefault();
  // toggle：已经展开就收起
  const existing = document.querySelector(".diag");
  if (existing) { existing.remove(); return; }
  let html = '<div class="diag">';
  for (const p of PLATFORMS) {
    const d = await diagnose(p);
    html += `<div><strong>${p}</strong>: cookies permission=${d.hasPerm}</div>`;
    for (const k of Object.keys(d)) {
      if (k === "hasPerm") continue;
      const v = d[k];
      const names = Array.isArray(v) ? v.map(x => x.n).join(", ") : v;
      html += `<div>  ${k}: ${Array.isArray(v) ? `(${v.length}) ${names}` : names}</div>`;
    }
  }
  html += "</div>";
  $("diagnose").insertAdjacentHTML("afterend", html);
}

$("generate").addEventListener("click", openRunner);
$("open-report").addEventListener("click", openLastReport);
$("open-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
for (const p of PLATFORMS) {
  $(`force-${p}`).addEventListener("change", refreshUI);
}
$("diagnose").addEventListener("click", showDiagnose);

(async () => {
  const { lastReportTs, lastInsight } = await chrome.storage.local.get(["lastReportTs", "lastInsight"]);
  if (lastReportTs) {
    $("open-report").hidden = false;
    const mins = Math.round((Date.now() - lastReportTs) / 60000);
    let ago;
    if (mins < 1) ago = "刚才";
    else if (mins < 60) ago = `${mins} 分钟前`;
    else if (mins < 24 * 60) ago = `${Math.round(mins / 60)} 小时前`;
    else ago = `${Math.round(mins / 60 / 24)} 天前`;
    $("open-report").textContent = `查看上次报告 · ${ago}`;
  }
  // 显示缓存状态（让用户知道下次跑是增量还是全量）
  if (lastInsight && lastInsight.raw && lastInsight.raw.conversations) {
    const total = lastInsight.raw.conversations.length;
    const hint = $("override-hint");
    if (hint) {
      hint.textContent = `💾 已缓存 ${total} 个对话，下次生成只抓新增`;
      hint.hidden = false;
    }
  }
  await detectAll();
})();
