# AI 使用复盘 · ai-chat-insights

> 读你和大模型的对话，生成本地复盘报告。  
> 浏览器扩展，0 终端、0 Python，装完即用。

![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![manifest: v3](https://img.shields.io/badge/manifest-v3-green)
![platforms: 4](https://img.shields.io/badge/platforms-4-orange)

支持 4 个平台 ——

| 平台 | 域名 |
|---|---|
| 豆包 | doubao.com |
| 腾讯元宝 | yuanbao.tencent.com |
| 通义千问 | qianwen.com |
| DeepSeek | chat.deepseek.com |

---

## 这个工具回答 4 个问题

1. **跑得通的用法**：你哪些 AI 用法在 work，可以继续保持
2. **出错的地方**：哪些卡住了你 / 工具用错了 / 平台的锅
3. **现在就能改**：3 个最该今晚就试的小动作
4. **长期玩法**：3-6 个月的工作流应该怎么变

灵感来自 Claude Code 自带的 `/insights` 命令。

## 截图

> _TODO：补 3-5 张报告截图（弹窗 / 活跃节奏 / 数据彩蛋 / 深度洞察 / 设置页）_

## 安装

### A. 加载本地源码（推荐，5 分钟）

1. 下载或 `git clone https://github.com/qichuan-zqc/ai-chat-insights.git`
2. 打开 chrome 地址栏输入 `chrome://extensions/` 回车
3. 右上角打开「**开发者模式**」开关
4. 点「**加载已解压的扩展程序**」，选刚才下载的 `ai-chat-insights` 文件夹
5. 扩展栏出现蓝色 🧠 图标，固定到 toolbar 方便点

### B. Chrome 应用商店

> _TODO：上架后填链接_

## 用法

1. **登录任意支持平台**（至少一个）
2. 点扩展图标 → popup 自动检测各平台登录态
3. 默认按检测结果勾选，可手动取消某些平台跳过本次
4. 点「**生成报告**」
5. 等几十秒到几分钟，报告在新 tab 自动打开

后续生成是**增量更新** —— 缓存里已抓的对话不会重抓，只拉新对话和有更新的，通常 5-10 秒能出新报告。

## LLM 配置

默认已配 DeepSeek，装完即用（每次生成约 ¥0.04）。

想换成自己的 key 或别家：右键扩展图标 → **选项**，填：

| Provider | Base URL | Model | 一次大约花 |
|---|---|---|---|
| DeepSeek（默认） | `https://api.deepseek.com/v1` | `deepseek-chat` | ¥0.04 |
| Anthropic Claude | `https://api.anthropic.com` | `claude-haiku-4-5` | ¥0.20 |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | ¥0.10 |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` | ¥0.05 |

Base URL 包含 `anthropic.com` 自动走 Claude 协议，否则走 OpenAI 兼容协议。

## 数据隐私

- ✅ **所有数据 100% 本地** —— 抓取的对话只存在浏览器 `chrome.storage.local`
- ✅ **不读 cookie 字符串** —— 走浏览器原生 fetch 自动带，扩展代码看不见
- ✅ **LLM 直连** —— 浏览器 → API 端，扩展不经过任何中转服务器
- ✅ **零遥测** —— 不发任何统计 / 错误 / 使用数据给作者

详见 [PRIVACY.md](./PRIVACY.md)。

清空：扩展选项页底部「清空全部（含 LLM 配置）」一键擦。

## License

MIT，见 [LICENSE](./LICENSE)。

## 致谢

- [ECharts](https://echarts.apache.org/) 图表
- 灵感来自 Claude Code `/insights`
