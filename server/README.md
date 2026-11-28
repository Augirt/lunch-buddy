# Qwen 接入与前端对接

2026-11-28：以下旧接口说明对应默认关闭V2的兼容模式。V2契约见 [前端交接](FRONTEND-V2-HANDOFF.md)。前端V2接入和本地端到端验收已完成：页面最终全量31/31、定向3/3、真实页面11/11通过；本轮新增7次真实模型调用。43项后端回归通过。完整验收证据仅保存在本地，不随仓库发布。独立3001实例启用V2，默认开关与共用3000实例保持原状态。共享工厂打包到app.js，旧实例也能浏览与规则选餐。

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

上述命令启动默认兼容模式。使用已经接入V2的前端自然语言功能时，改为独立实例：

```bash
AGENT_V2_ENABLED=true PORT=3001 npm --prefix server start
```

打开 <http://127.0.0.1:3001>。后端同时提供页面和 API，不需要前端跨域；本页检测到默认兼容模式时使用共享规则结果。
使用 Python 静态服务或 GitHub Pages 时不具备这些 API，前端应保持规则模式。

`server/.env` 保存本机配置；示例复制命令用于新机器初始化，已有配置时不要覆盖。
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
| MODEL_MAX_TOKENS | 600 | 单次输出上限 |
| REQUEST_TIMEOUT_MS | 9000 | V2请求内解析、推荐和重试的统一截止预算 |
| AGENT_V2_ENABLED | false | V2接口流程开关；独立实例验收后再切换页面 |

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
模型决定顺序和匹配事实；展示理由由服务端菜单事实模板生成。V2还校验受支持的理由代码。
`rule_score` 是服务器计算的规则分，不是模型置信度。V2直接返回 `score_parts/learned_bonus/rank_score`，前端应接共享引擎以统一静态模式；详见交接文档。
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
其他兜底代码：`timeout`、`auth_failed`、`account_unavailable`、`rate_limited`、`model_config`、
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
“清淡/清爽/养胃/不想吃辣/少辣”会确定为 `tastes` 里的“清淡”，并移除“微辣”“重辣”；
这是服务端在模型解析后再次强制执行的，不依赖模型是否遵守提示词。
只有明确说“想吃辣/要辣”时才保留辣味标签。
取消单项可明确说“现在可以吃香菜”，清空可说“清空忌口”，也可通过设置控件取消。

## 前端接线要点

- 在同源 `/api/health` 存在时启用服务端推荐；404 或 file:// 时保持原规则体验。
- 推荐源以响应的 `source` 为准。`configured: true` 不代表模型一定成功。
- 先显示规则结果或加载态，异步返回后只更新仍匹配当前档案的结果。
  用 AbortController 或递增请求序号防止旧档案响应覆盖新忌口。
- “换一个”优先消费已返回的备选；用完后把已换的 dish_id 放进 `skipped` 再调用。
- 点“就吃这个”后按原方式保存午饭历史；换菜不写入已吃历史。
- 理由/回复始终用 textContent 或 HTML 转义显示。
- 兼容模式chat最多两个任务；V2的客户端超时取 `/api/health.request_timeout_ms + 1000`，默认10秒，并在设置变更、取消、跨天和重置时丢弃旧响应。
- 同档案推荐缓存 10 分钟，相同进行中请求合并；临时失败缓存仅 5 秒。
  每个来源 IP 每分钟最多 30 个 API 请求、最多 2 个同时进行，避免无意重复消费。

## 验证与边界

```bash
npm --prefix server test
curl http://127.0.0.1:3000/api/health
# 以下会真实调用百炼，并按账号额度计费：
npm --prefix server run smoke -- --direct
npm --prefix server run smoke
npm --prefix server run smoke -- --chat
# V2真实调用只在独立临时端口运行：
npm --prefix server run smoke -- --v2 --chat --text=今天想清淡一点
npm --prefix server run eval
npm --prefix server run eval -- --live --max-calls=30
```

测试使用本地替身，不发送真实百炼请求、不消耗账户额度。
`smoke` 会使用本地临时端口验证真实账号，不中断正在运行的 Demo；
`--direct` 验证单独模型接口，`--chat` 验证偏好解析和推荐。
可用 `python3 server/configure-key.py 百炼导出的密钥.csv` 安全导入 Key；
它只写入 `server/.env`，权限为 600，不打印密钥。

2026-11-27 已用用户提供的真实账号验证：模型接口 HTTP 200；
推荐返回 `source: "qwen"`、无降级，单次实测 3722ms、输入 1777/输出 336 tokens。
按当前刊例价，本次推荐约 0.00233 元。这是一次联调结果，不是延迟或推荐质量的统计保证。
中文对话“不吃花生，今天想吃米饭，预算30元”也已验证：
保留原有忌口、新增花生、主食改为米饭、预算改为30元，返回三款符合约束的推荐，
`profile_applied: true`、`source: "qwen"`。
真实联调还发现模型会多输出有效匹配标签，现已将其归一化为最多 4 条，
并继续拒绝未知菜品 ID、未知事实和重复菜品。

当前保留原 Demo 的午饭日记忆模型，以 `dayIndex` 对今天、昨天、前天去重，
同主菜换商家或 SKU 也会被排除。真实订单接入时应由服务端账户历史提供时间戳；
不能把客户端提交的模拟历史当成生产中的可靠订单记忆。
健康和主食保持原产品的软偏好，忌口、预算、营业状态和主菜去重才是硬约束。
菜单仍为模拟数据，无法从未标注的食材推断过敏安全或交叉污染。

V2增加Asia/Shanghai日期键、当天强限制与多日选择统计。标准忌口包含蛋白种类兜底；自定义食材须有目录覆盖，未知食材先澄清。学习最多加6分，仅改变软排序，不修改预算、忌口或硬限制。原话与本地行为的保存由前端接入承担，服务端不建立持久用户档案。

当前意图解析有明确范围：支持口味标签、少油、主食、预算、配送时限和目录内忌口的常见表达及澄清。服务端不把模型对未提及字段的提议当作授权。更复杂的自由表达、菜系或蛋白的自然语言软偏好仍需扩充人工标注场景；不能宣称已覆盖全部中文语义。

参考：[模型信息](https://docs.bailian.console.aliyun.com/zh/model-studio/qwen3-8-flash)、
[Chat API 与北京地址](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、
[严格结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)。
