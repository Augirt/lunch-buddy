# Qwen 接入与前端对接

选定供应商：阿里云百炼，华北2（北京）。模型：`qwen3.8-flash`。
官方当前刊例价为输入 0.8 元、输出 2.7 元/百万 tokens；实际费用以控制台账单为准。

## 启动

需要 Node.js 22.6 或以上。使用内置 HTTP 服务和 fetch，无需安装 npm 依赖。

在项目根目录运行：

```bash
cp server/.env.example server/.env
# 在 server/.env 填入 DASHSCOPE_API_KEY。
npm --prefix server start
```

打开 <http://127.0.0.1:3000>。后端同时提供页面和 API，不需要前端跨域。
使用 Python 静态服务或 GitHub Pages 时不具备这些 API，前端应保持规则模式。

本次接入已创建空的 `server/.env`，可直接填 Key；示例复制命令用于新机器初始化。
`server/.env` 被 `.gitignore` 忽略；启动后只显示是否读取配置，不打印凭证。
不要把 Key 放入 app.js、localStorage、聊天消息或发给真实用户。
修改环境变量后重启服务。当前实现为本机单用户 Demo，尚未部署公开云端。

## 获取资源

1. 打开[百炼控制台](https://bailian.console.aliyun.com/cn-beijing/model/market)，选择华北2（北京）。
2. 确认可以调用 `qwen3.8-flash`，创建该业务空间的普通模型 API Key。
3. 将 Key 写入 `server/.env` 的 `DASHSCOPE_API_KEY`。不用 Coding Plan 的专属 Key。
4. 旧北京兼容地址可继续使用，也可从业务空间详情取 ID，配置为
   `https://业务空间ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。
5. 启动后看 `/api/health` 的 `configured`。它仅说明配置已读取；实际鉴权和模型能力需第一次推荐返回 `source: "qwen"` 才算打通。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| DASHSCOPE_API_KEY | 空 | 服务端百炼凭证；空值启用规则兜底 |
| QWEN_MODEL | qwen3.8-flash | 可调用的具体模型 ID |
| DASHSCOPE_BASE_URL | https://dashscope.aliyuncs.com/compatible-mode/v1 | 北京兼容地址；可用北京业务空间专属域名 |
| HOST | 127.0.0.1 | 仅监听本机 |
| PORT | 3000 | 页面和 API 端口 |
| MODEL_TIMEOUT_MS | 8000 | 每次模型任务的总时限，含结构错误重试 |
| MODEL_MAX_TOKENS | 800 | 单次输出上限 |

调用为 OpenAI 兼容 `POST /chat/completions`，采用
`response_format: { type: "json_schema", json_schema: { strict: true, ... } }`，
并显式设置 `enable_thinking: false`。请求不启用联网搜索或工具。

## 前端通用请求

沿用原 Demo 的字段和 `dayIndex` 午饭记忆，忌口用选项 ID：

```json
{
  "profile": {
    "tastes": ["咸鲜", "微辣"],
    "avoid": ["cilantro", "organ"],
    "healthy": true,
    "staplePriority": true,
    "staplePreference": "不限",
    "budget": 45
  },
  "todayIndex": 0,
  "history": [
    { "dishId": "d26", "dayIndex": -1 },
    { "dishId": "d28", "dayIndex": -2 }
  ],
  "skipped": []
}
```

`staplePreference` 可省略，默认“不限”，可取 `data.js` 已有的主食种类（例如“米饭”“面条”“粉”）。
客户端不要提供候选菜单、规则分或权重：服务器总是从自身的 `data.js` 重新召回与筛选。

## GET /api/health

```json
{ "ok": true, "configured": false, "model": "qwen3.8-flash" }
```

不返回 Key。前端启动时探测此接口；静态站 404 或不是 JSON，应回到本地规则模式。

## POST /api/recommend

请求为上方通用请求，`Content-Type: application/json`。

以下为响应结构示例，具体推荐随档案变化：

```json
{
  "request_id": "随机请求ID",
  "source": "qwen",
  "model": "qwen3.8-flash",
  "fallback_reason": null,
  "summary": "今天优先选这道，口味、主食和预算都合适。",
  "candidate_count": 24,
  "excluded": { "avoid": 8, "budget": 0, "history": 2 },
  "cache_hit": false,
  "picks": [
    {
      "dish_id": "d1",
      "rule_score": 77,
      "matched": ["咸鲜", "主食：米饭"],
      "reason": "番茄牛腩慢炖，带米饭，32元在预算内。",
      "dish": { "id": "d1", "name": "番茄牛腩饭", "price": 32 },
      "merchant": { "id": "xiangkou", "name": "巷口小馆" }
    }
  ],
  "usage": { "prompt_tokens": 2500, "completion_tokens": 500, "cached_tokens": 0 },
  "attempts": 1,
  "latency_ms": 6500,
  "request_latency_ms": 6502
}
```

`dish` 与 `merchant` 实际是菜单的完整对象，示例为简写。通常返回 3 道不同菜，第一道为首选。
模型只决定顺序、匹配事实和理由；`rule_score` 是服务器计算的规则分，不是模型置信度。
如需展示各维度分数，沿用前端规则分，标注其来源，勿将其声称为模型的推理过程。
`usage` 包含校验重试消耗；缓存命中时保留原响应的 usage，它不是本次新消耗。

无 Key、超时、鉴权失败或输出校验失败均 HTTP 200，返回安全的规则候选：

```json
{
  "source": "rules",
  "model": null,
  "fallback_reason": "missing_key",
  "summary": "尚未配置模型，先按你的口味用规则推荐。",
  "picks": [],
  "usage": null
}
```

此处 picks 仅简写；有可用菜时实际仍返回最多 3 道。若没有合规候选才返回空数组，
`fallback_reason: "no_candidates"`。候选不超过 3 道时直接规则推荐，
`fallback_reason: "few_candidates"`，不消耗模型额度。
其他兜底代码：`timeout`、`auth_failed`、`rate_limited`、`model_config`、
`invalid_output`、`upstream_error`、`network_error`。

## POST /api/preferences

通用请求另加 `text: "不吃花生，今天想吃米饭，预算30元"`。
成功返回 `{ request_id, profile, message, usage }`；前端应用 profile 后自行触发推荐。
没有 Key 返回 503、`code: "missing_key"`，不会伪装成已经解析。
菜单未覆盖的忌口或不支持的预算会返回 422，提示澄清。

## POST /api/chat

通用请求另加 `text`。可选 `messages` 为最近最多 8 条
`{ role: "user" | "assistant", content: "内容" }`，每条最多 500 字。

流程是“结构化解析档案 → 服务端校验 → 重新硬筛选 → 推荐”，最多两个模型任务。
成功响应是推荐响应加上：

```json
{
  "reply": "花生已设为忌口，主食优先米饭。今天推荐……",
  "profile": {
    "tastes": ["咸鲜", "微辣"],
    "avoid": ["cilantro", "organ", "peanut"],
    "healthy": true,
    "staplePriority": true,
    "staplePreference": "米饭",
    "budget": 30
  },
  "profile_applied": true,
  "preference_usage": { "prompt_tokens": 600, "completion_tokens": 100, "cached_tokens": 0 }
}
```

聊天失败或没有 Key 时 HTTP 200，`profile_applied: false`，
`reply` 明确说明未解析，`profile` 保持原值，picks 为原档案的规则结果。
前端此时只展示提示和原有推荐，不应将这句话标为已应用，也不能声称推荐满足了新输入的限制。
明确不能覆盖的忌口（例如菜单未标注芝麻）返回 `picks: []`，先澄清再推荐。

已有忌口会由服务器保守保留；普通口味修改不会清空它。
取消单项可明确说“现在可以吃香菜”，清空可说“清空忌口”，也可通过设置控件取消。

## 前端接线要点

- 在同源 `/api/health` 存在时启用服务端推荐；404 或 file:// 时保持原规则体验。
- 推荐源以响应的 `source` 为准。`configured: true` 不代表模型一定成功。
- 先显示规则结果或加载态，异步返回后只更新仍匹配当前档案的结果。
  用 AbortController 或递增请求序号防止旧档案响应覆盖新忌口。
- “换一个”优先消费已返回的备选；用完后把已换的 dish_id 放进 `skipped` 再调用。
- 点“就吃这个”后按原方式保存午饭历史；换菜不写入已吃历史。
- 理由/回复始终用 textContent 或 HTML 转义显示。
- chat 最多两个任务，建议前端超时至少 `2 * MODEL_TIMEOUT_MS + 2000`。
- 同档案推荐缓存 10 分钟，相同进行中请求合并；临时失败缓存仅 5 秒。
  每个来源 IP 每分钟最多 30 个 API 请求、最多 2 个同时进行，避免无意重复消费。

## 验证与边界

```bash
npm --prefix server test
curl http://127.0.0.1:3000/api/health
```

测试使用本地替身，不发送真实百炼请求、不消耗账户额度。
Key 配置后需再做一次真实 `/api/recommend`，确认返回 `source: "qwen"`。
没有真实凭证前，无法证明账号鉴权、实际响应质量或生产延迟。

当前保留原 Demo 的午饭日记忆模型，以 `dayIndex` 对今天、昨天、前天去重，
同主菜换商家或 SKU 也会被排除。真实订单接入时应由服务端账户历史提供时间戳；
不能把客户端提交的模拟历史当成生产中的可靠订单记忆。
健康和主食保持原产品的软偏好，忌口、预算、营业状态和主菜去重才是硬约束。
菜单仍为模拟数据，无法从未标注的食材推断过敏安全或交叉污染。

参考：[模型信息](https://docs.bailian.console.aliyun.com/zh/model-studio/qwen3-8-flash)、
[Chat API 与北京地址](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、
[严格结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)。
