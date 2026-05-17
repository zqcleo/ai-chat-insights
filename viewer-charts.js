// viewer-charts.js — 从 template.html 末尾 inline script 抽出。
// 由 viewer.js 在数据 / DOM 就绪后调用 window.initCharts(data)。

(function () {
  const CHART_TEXT = { color: "#64748b", fontSize: 12 };
  const PRIMARY = "#2563eb";
  const PALETTE = ["#2563eb", "#f59e0b", "#10b981", "#7c3aed", "#dc2626", "#06b6d4", "#ec4899", "#84cc16"];

  let charts = [];

  function initCharts(DATA) {
    // 清掉旧实例
    charts.forEach(c => { try { c.dispose(); } catch (_) {} });
    charts = [];
    const platformColors = DATA.platform_colors || {};
    const platforms = DATA.platforms;
    const platformLabels = DATA.platform_labels || {};

    // 1. 时间线堆叠柱状图
    const tl = echarts.init(document.getElementById("chart-timeline"));
    tl.setOption({
      grid: { top: 30, right: 12, bottom: 40, left: 40 },
      tooltip: { trigger: "axis" },
      legend: { top: 0, right: 12, textStyle: CHART_TEXT, data: platforms.map(p => platformLabels[p] || p) },
      xAxis: {
        type: "category",
        data: DATA.timeline.map(d => d.date),
        axisLabel: { ...CHART_TEXT, formatter: v => v.slice(5) },
        axisTick: { alignWithLabel: true },
      },
      yAxis: { type: "value", axisLabel: CHART_TEXT, splitLine: { lineStyle: { color: "#f0f0f0" } } },
      series: platforms.map((p, i) => ({
        name: platformLabels[p] || p,
        type: "bar",
        stack: "total",
        data: DATA.timeline.map(d => d[p] || 0),
        itemStyle: {
          color: platformColors[p] || PALETTE[i % PALETTE.length],
          borderRadius: i === platforms.length - 1 ? [2, 2, 0, 0] : 0,
        },
        barCategoryGap: "20%",
      })),
    });

    // 3. 热力图
    const hm = echarts.init(document.getElementById("chart-heatmap"));
    const maxHeat = Math.max(...DATA.heatmap.map(h => h[2]), 1);
    hm.setOption({
      grid: { top: 10, right: 12, bottom: 30, left: 36 },
      tooltip: { formatter: p => `周${"一二三四五六日"[p.data[1]]} ${p.data[0]}:00 · ${p.data[2]} 条` },
      xAxis: { type: "category", data: Array.from({ length: 24 }, (_, i) => i + ""), axisLabel: { ...CHART_TEXT, fontSize: 10 }, splitArea: { show: false } },
      yAxis: { type: "category", data: ["一", "二", "三", "四", "五", "六", "日"], axisLabel: CHART_TEXT },
      visualMap: { min: 0, max: maxHeat, calculable: false, show: false, inRange: { color: ["#f1f5f9", PRIMARY] } },
      series: [{ type: "heatmap", data: DATA.heatmap, itemStyle: { borderColor: "#fff", borderWidth: 1 } }],
    });

    // 4. 平台占比
    const pp = echarts.init(document.getElementById("chart-platform"));
    pp.setOption({
      tooltip: { trigger: "item" },
      legend: { bottom: 0, textStyle: CHART_TEXT },
      series: [{
        type: "pie", radius: ["50%", "72%"], center: ["50%", "46%"],
        data: DATA.platform_pie,
        label: { formatter: "{b}\n{d}%", fontSize: 12, color: "#4a4a52" },
        color: platforms.map((p, i) => platformColors[p] || PALETTE[i % PALETTE.length]),
      }],
    });

    charts = [tl, hm, pp];
    window.addEventListener("resize", () => charts.forEach(c => c.resize()));
  }

  // Copy 按钮：因为 viewer 上是 self CSP，可以放心绑 listener（不用 onclick 内联）
  function bindCopyButtons() {
    document.querySelectorAll(".copy-btn").forEach(btn => {
      if (btn.__bound) return;
      btn.__bound = true;
      btn.addEventListener("click", () => {
        const code = btn.previousElementSibling;
        navigator.clipboard.writeText(code.textContent).then(() => {
          const old = btn.textContent;
          btn.textContent = "已复制";
          btn.classList.add("copied");
          setTimeout(() => { btn.textContent = old; btn.classList.remove("copied"); }, 1500);
        });
      });
    });
  }

  window.initCharts = initCharts;
  window.bindCopyButtons = bindCopyButtons;
})();
