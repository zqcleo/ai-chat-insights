# Changelog

## [1.0.0] - 2026-05-17

首次开源发布。

### 支持平台
- 豆包（doubao.com）
- 腾讯元宝（yuanbao.tencent.com）
- 通义千问（qianwen.com）
- DeepSeek（chat.deepseek.com）

### 核心功能
- 自动检测 4 平台登录态，可手动勾选要包含的平台
- 增量更新：缓存命中的对话跳过重抓
- 报告含 KPI、活跃节奏（90 天时间线 / 24×7 热力图 / 平台分布）、数据彩蛋、主题归类
- 接入 LLM（默认 DeepSeek）输出深度洞察：跑得通的用法 / 出错的地方 / 立刻能改 / 长期玩法
- LLM 失败兜底：降级到本地模板分析，报告仍可生成

### 隐私
- 抓取数据全本地 `chrome.storage.local`
- Cookie 通过浏览器原生 fetch 自动带上，扩展代码不读 cookie 字符串
- LLM 配置存 `chrome.storage.sync`（跟 Google 同步可用则跨设备保留）
