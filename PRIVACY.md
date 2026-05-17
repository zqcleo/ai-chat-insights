# 隐私政策 · Privacy Policy

最后更新：2026-05-17

## 简短版

**所有用户数据都在你的浏览器本地处理，不上传任何服务器（除了你主动配置的 LLM API）。**

## 收集的数据

本扩展会读取以下数据，**全部存储在你浏览器本地的 `chrome.storage`**：

| 数据 | 来源 | 用途 |
|---|---|---|
| 4 平台的对话历史 | 用户登录后通过各平台官方 web API 拉取（携带浏览器自有 cookie） | 在本地生成统计与可视化报告 |
| LLM API 配置（key / base_url / model） | 用户在设置页填写 | 调用 LLM 服务生成深度洞察 |
| 抓取缓存 | 从对话 API 获取 | 增量更新，避免重复抓取 |

## 不收集的数据

- ❌ 不读取你浏览器其它网站的数据
- ❌ 不读取 cookie 内容（使用浏览器原生 `fetch(..., {credentials: "include"})`，扩展代码看不到 cookie 字符串）
- ❌ 不向任何分析、追踪、广告服务发送数据
- ❌ 不向作者发送任何遥测或使用统计

## 数据流向

```
浏览器 ──读取对话──> 各平台官方 API (doubao.com / yuanbao.tencent.com / qianwen.com / chat.deepseek.com)
   │
   └─ 数据存入 chrome.storage.local（仅本地）
       │
       └─ 可选：调用你配置的 LLM API（DeepSeek / OpenAI / Anthropic / 等）
            └─ 对话内容作为 prompt 发送给 LLM provider
```

**LLM 调用是浏览器 → LLM API 直连**，扩展不经过任何中转服务器。

请注意：调用 LLM 时，你的对话内容会被发送给 **你选择的 LLM provider**（例如 DeepSeek、OpenAI、Anthropic）。这些 provider 有各自的隐私政策，请自行评估。

## 权限说明

| Chrome 权限 | 为什么需要 |
|---|---|
| `cookies` | 检测各平台登录态（只读 cookie 是否存在，不读值） |
| `tabs` | 打开报告查看器、跳转到登录页 |
| `scripting` | 注入 content script 到 4 平台页面做跨域代理 |
| `webRequest` | 拦截 DeepSeek 自身 API 请求获取 Bearer token（DeepSeek 用 bearer 而非 cookie 鉴权） |
| `storage` / `unlimitedStorage` | 本地保存抓取数据、统计、报告 |
| host_permissions | 限定在 4 平台域名 + 3 个 LLM API 域名 |

扩展**绝不**请求 `<all_urls>` 这种通配权限。

## 数据清除

设置页底部「清空全部（含 LLM 配置）」一键擦除所有本地数据。

## 联系

issue 提到 GitHub repo 即可。
