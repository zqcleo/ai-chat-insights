// topics.js — 关键词驱动的主题聚类（无 LLM）。
// 把对话标题（+ 首条用户消息片段）扫一遍，挂到预设主题下。命中 0 个的丢到「其他」。

// 主题规则：每个对话的实际平台从 c.platform 来，rule 不需要也不会用 platforms 字段
const TOPIC_RULES = [
  {
    name: "Java 后端 / 框架排障",
    keywords: ["java", "spring", "dubbo", "springboot", "mybatis", "maven", "logback", "jpa", "bean", "注解", "线程", "类未定义", "依赖", "annotation", "zookeeper"],
  },
  {
    name: "数据库 / SQL",
    keywords: ["mongodb", "mongo", "mysql", "redis", "sql", "数据库", "zset", "查询", "索引", "拼写", "json 数据", "导入", "binlog"],
  },
  {
    name: "前端 / Web",
    keywords: ["vue", "react", "typescript", "javascript", "css", "html", "wsl", "前端", "样式", "网页", "nginx", "node.js", "powershell", "chrome"],
  },
  {
    name: "工具链 / 安装配置",
    keywords: ["claude code", "cursor", "idea", "mac", "windows", "ssh", "curl", "homebrew", "安装", "配置", "证书", "代理", "vpn", "git", "stash", "ide"],
  },
  {
    name: "财经 / 投资",
    keywords: ["股", "基金", "理财", "市盈率", "期权", "可转债", "降息", "稀土", "纳指", "a 股", "港股", "美股", "贷款", "社保", "金融", "投资", "经济", "宏观"],
  },
  {
    name: "图像生成 / 创意",
    keywords: ["生成图", "海报", "图片", "插画", "漫画", "贪吃蛇", "朋友圈截图", "头版", "p 图", "midjourney", "stable diffusion", "即梦", "seedream"],
  },
  {
    name: "AI 行业资讯",
    keywords: ["openai", "anthropic", "gemini", "chatgpt", "claude", "deepseek", "llm", "agent", "ai 简报", "ai 行业", "新闻摘要", "hacker news", "rag", "mcp"],
  },
  {
    name: "生活百科 / 实用查询",
    keywords: ["医院", "银行", "车位", "保险", "电信", "电话", "汽车", "购车", "奥迪", "小米", "手机", "微信", "医保", "认定", "签证", "h1b"],
  },
  {
    name: "内容创作 / 文案",
    keywords: ["小说", "情人节", "新闻", "文案", "标题", "海报", "贺卡", "重写", "小红书", "公众号", "翻译"],
  },
  {
    name: "学习 / 教育",
    keywords: ["化学", "物理", "数学", "课标", "教室", "教程", "学习", "题库", "考试", "学校", "学生", "中小学"],
  },
];

function lowerStrip(s) {
  return (s || "").toLowerCase().replace(/\s+/g, "");
}

export function clusterTopics(raw) {
  const platformLabels = raw.platform_labels || { doubao: "豆包", yuanbao: "元宝", qianwen: "通义千问", deepseek: "DeepSeek" };
  // 给每个 conv 算最匹配主题
  const buckets = {};  // topicName -> { name, n_sessions, convs:[], platforms: Set, hits }
  for (const t of TOPIC_RULES) buckets[t.name] = { name: t.name, n_sessions: 0, convs: [], platforms: new Set() };
  const others = { name: "其他", n_sessions: 0, convs: [], platforms: new Set() };

  for (const c of raw.conversations || []) {
    const title = lowerStrip(c.name);
    // 用首条用户 msg 补充语料
    const firstUser = (c.messages || []).find(m => m.role === "user");
    const blob = title + " " + lowerStrip((firstUser && firstUser.content) || "");

    let bestTopic = null;
    let bestScore = 0;
    for (const t of TOPIC_RULES) {
      let score = 0;
      for (const kw of t.keywords) {
        if (blob.includes(lowerStrip(kw))) score++;
      }
      if (score > bestScore) { bestScore = score; bestTopic = t; }
    }
    const target = bestTopic ? buckets[bestTopic.name] : others;
    target.n_sessions++;
    target.convs.push(c);
    target.platforms.add(c.platform);
  }

  // 输出 topic 数组，按 n_sessions 倒序，过滤掉 0 个的
  const out = [...Object.values(buckets), others]
    .filter(b => b.n_sessions > 0)
    .sort((a, b) => b.n_sessions - a.n_sessions)
    .map(b => ({
      name: b.name,
      n_sessions: b.n_sessions,
      description: describeTopic(b, platformLabels),
      platforms: [...b.platforms],
    }));

  return out;
}

function describeTopic(b, platformLabels) {
  // 简短描述：列前 3 个对话名作为代表
  const samples = b.convs
    .filter(c => c.messages.length >= 2)
    .sort((a, b) => b.messages.length - a.messages.length)
    .slice(0, 3)
    .map(c => `「${c.name}」`)
    .join("、");
  const platStr = [...b.platforms].map(p => platformLabels[p] || p).join("/");
  if (samples) {
    return `代表对话：${samples}。主要在 ${platStr} 上发生。`;
  }
  return `主要在 ${platStr} 上发生。`;
}

// 默认 fallback 分析 — 没 LLM 时填的 glance / narrative / wins / frictions / suggestions / features / horizon / fun_ending
export function templateAnalysis(stats, topics) {
  const kpi = stats.kpi;
  const platforms = stats.platforms;
  const platformLabels = stats.platform_labels;
  const byPlat = stats.by_platform;
  const platSummary = byPlat.map(p =>
    `${p.label}（${p.n_conv} 对话 / ${p.n_msg} 消息 / ${p.n_active_days} 活跃日）`
  ).join("、");
  const topTopic = topics[0];
  const topPlat = byPlat.reduce((a, b) => b.n_msg > a.n_msg ? b : a, byPlat[0]);

  return {
    glance: {
      working: `跨 ${kpi.span_days} 天 ${kpi.n_active_days} 天活跃，主战场是 ${topPlat.label}（${topPlat.n_msg} 条消息）。主题最集中的是「${topTopic ? topTopic.name : "—"}」。`,
      hindering: `开了就走（≤ 2 条）的对话有 ${stats.kpi.n_msg ? "若干" : 0} 个；多模态对话只占 ${kpi.n_media_conv}/${kpi.n_conv}（${kpi.n_conv ? Math.round(100 * kpi.n_media_conv / kpi.n_conv) : 0}%）。`,
      quickwins: "配 LLM API key 打开右上角「options」即可解锁深度洞察。",
      horizon: `这次共聚出 ${topics.length} 类主题，最该统一管理的是「${topTopic ? topTopic.name : "—"}」。`,
    },
    narrative: {
      paragraphs: [
        `你共有 **${kpi.n_conv} 个对话 / ${kpi.n_msg} 条消息**，分布在 ${platSummary}。活跃率 ${kpi.active_rate}%（${kpi.n_active_days} / ${kpi.span_days} 天）。`,
        `主题聚类共 **${topics.length} 类**${topTopic ? `，最大块是「${topTopic.name}」(${topTopic.n_sessions} 个对话)` : ""}。`,
        "本报告为**无 LLM 模式**，主题聚类基于关键词规则。如果想看到具体的「跑得通的用法 / 出错的地方 / 立刻可以试的动作」这种行动建议，去扩展 options 页填一把 LLM API key（推荐 DeepSeek，注册送 10 元够用 200 次）。",
      ],
      key_pattern: "数据已抓好，等 LLM 来挖洞察",
    },
    topics,
    wins: [],
    frictions: [],
    suggestions: [
      {
        title: "解锁深度洞察",
        desc: "填一把 LLM API key（DeepSeek / OpenAI / Anthropic 任选）就能拿到 4 段式行动建议。",
        copyable: "",
      },
    ],
    features_to_try: [],
    horizon: [],
    fun_ending: { headline: "数据已就位，等你的 LLM key 来收尾。", detail: "" },
    model: "—",
    provider: "（无 LLM 模式，纯本地统计 + 关键词聚类）",
    platforms,
  };
}
