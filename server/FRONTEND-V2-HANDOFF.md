# Agent V2 前端交接

日期：2026-11-28。后端及前端V2接入已验证。本文件保留接口与状态契约；前端已修改index.html、app.js、styles.css并接入共享引擎，data.js未改。页面最终全量31/31、定向3/3、真实页面11/11通过，新增7次真实模型调用。默认开关关闭，已有.env和共用3000端口保持原状态；独立V2预览在3001。完整验收证据仅保存在本地，不随仓库发布。

## 启用与共享模块

独立临时端口可用：

```bash
AGENT_V2_ENABLED=true PORT=3001 npm --prefix server start
```

不占用或重启共用3000端口。环境变量优先于.env现有值，示例不修改.env。已有配置不要执行覆盖式复制。

页面在data.js后加载app.js。app.js包含由同一份 `server/recommend-core.js` 自动生成的工厂，避免未重启的旧服务白名单不提供新脚本路径时页面初始化失败。修改共享引擎后运行：

```bash
node server/build-frontend.cjs
node server/build-frontend.cjs --check
```

`--check`校验浏览器包与后端工厂源码完全一致。其他消费者仍可独立加载 `/server/recommend-core.js`（静态子路径用相对路径）；当前新服务只公开这一共享脚本，其他私有server文件仍404。页面不依赖该额外URL。

```js
const lunchEngine = createLunchEngine({
  MERCHANTS, DISHES, TASTE_OPTIONS, AVOID_OPTIONS, DEFAULT_PROFILE
});
const normalized = lunchEngine.normalizeRequest(apiInput);
const data = lunchEngine.analyze(normalized);
// data.visible已硬筛选并按rank_score排序，data.counts可核对排除计数。
```

Node的recommend-core.cjs只是兼容导出。浏览器与Node的全部单项忌口、44道菜结果已作自动一致性检查，页面已替换为共享实现；静态筛选与排序、未知食材阻断也已完成页面验收。

## 请求契约

旧字段profile/history/todayIndex/skipped继续保留。V2新增字段如下；示例不是实际用户行为：

```json
{
  "profile": {
    "tastes": ["咸鲜", "微辣"], "avoid": ["pork"], "customAvoid": [],
    "healthy": true, "staplePriority": true, "staplePreference": "不限", "budget": 45
  },
  "date_key": "2026-11-28",
  "constraints": {
    "dateKey": "2026-11-28", "noSpicy": true, "stapleType": "米饭", "maxMinutes": 30,
    "explicit": ["noSpicy", "stapleType", "maxMinutes"]
  },
  "persistent_constraints": {},
  "day_preferences": { "dateKey": "2026-11-28", "tastes": ["咸鲜", "清淡"] },
  "history": [{ "dishId": "d1", "date_key": "2026-11-27" }],
  "todayIndex": 0, "skipped": [],
  "selection_events": [
    {
      "event_id": "人工示例", "dish_id": "d4", "date_key": "2026-11-26",
      "chosen_at": "2026-11-26T04:05:00.000Z", "source": "real"
    }
  ],
  "learning_enabled": true,
  "pending_clarification": null
}
```

- `profile`始终上传长期档案，不把上次响应的有效profile整体当作长期档案。
- `constraints.explicit`表示当天明确设置的字段。缺省时按本次提供的字段推导；归一化后要保留此数组，防止默认值误解除长期限制。
- `persistent_constraints`保存长期明确硬条件。当日explicit字段优先，日期失效后恢复长期条件。旧day字段可映射为constraints，包括cuisines/proteins的既有硬筛选；这些数组用目录里的枚举值。
- 米饭用菜单主食含“饭”判断；面食用“面、粉、乌冬、馍”，不互相满足。时效1至120整数或null；预算15至60元。
- customAvoid最多20项、每项1至30字。已覆盖食材及同义词会筛选；芝麻等未标注食材返回澄清。此过滤不能证明完整过敏安全。
- day_preferences仅允许tastes/healthy/staplePriority/staplePreference/budget，不能通过它覆写忌口。
- selection_events最多60项、最近30天。服务器丢弃demo/legacy、未来、过期、日期与chosen_at不一致的学习记录，按event_id去重。同日只取最终选择。
- chat/preferences另加text，1至500字；messages最多8条，每条500字。完整原话档案不随请求上传。

## 响应与状态应用

推荐保留picks/source/fallback_reason/reason/matched/dish/merchant/usage等旧字段。新增：

| 字段 | 页面使用方式 |
| --- | --- |
| persistent_profile | 写回长期档案；仅chat/preferences且profile_applied=true时应用 |
| profile | 本次有效档案，包含当天软偏好；只用于本次展示 |
| day_preferences / constraints / persistent_constraints | 按作用期分别保存，下一次请求原样携带 |
| changes | field/value/scope/evidence/evidence_source；只显示已确认且已应用的变更 |
| utterance_event | 原话记录模板；parsed=false只保存记录，不当作生效偏好 |
| needs_clarification / clarification | picks为空时显示最多两个问题；下一轮把clarification传为pending_clarification |
| score_parts / rule_score | 六项规则分，用于排序，不代表模型置信度 |
| learned_bonus / learned_parts / rank_score | 学习加分单列；rank_score=rule_score+learned_bonus |
| decision_trace | 实际过滤计数、候选数、约束、学习依据与阶段状态 |
| telemetry | request_id、全程耗时、各阶段attempts、model_calls、实际usage、缓存来源usage、版本和结果状态 |

needs_clarification=true不触发额外推荐。未知食材、冲突或预算越界时profile_applied=false；零候选可能是在条件解析成功后发生，此时profile_applied=true表示条件已经确认，不表示已找到菜。保留这些条件，等待明确放宽预算、主食或时效；不要自动解除忌口。

下一轮答案可只说“30元”；后端会承接预算slot以及上一轮独立的已明确忌口。重新开始、更换话题、跨天或重置时清除pending。原始对话两轮都保存，证据来源可能是clarification。

source表示最终推荐来源。解析成功而推荐失败时可为rules，但profile_applied仍true；展示阶段状态，勿说“整句解析失败”。缺Key或解析失败时profile_applied=false，原设置不变。configured=true只是配置存在，不能作为当前请求模型已成功的依据。

缓存响应的旧usage不是新成本；费用统计读取telemetry.actual_usage。unknown=true表示部分尝试没有供应商usage，不能解释成零费用。origin_usage只展示生成缓存结果时的推荐消耗。缓存/共享结果的当前阶段attempts=0、status=not_run，origin_source说明结果来源。

## 日期、存储与学习

升级localStorage键为lunch-buddy-state-v2，并保留v1可恢复备份。建议持久结构：

```js
{
  version: 2, persistentProfile, dayPreferences, constraints, persistentConstraints,
  dateKey, mode: "real", demoDayIndex: 0,
  utteranceEvents: [], selectionEvents: [], exposureEvents: [], skipEvents: [],
  learningEnabled: true, pendingClarification: null
}
```

使用 `lunchEngine.dateKey()` 获取Asia/Shanghai日期。页面加载、发送推荐前及恢复到前台时检查日期：清除旧当天条件、清除pending与skipped、取消旧请求，真实历史按date_key保留。模拟到明天使用独立demo模式/索引；不能把演示记录伪装为真实日期行为。

v1档案和历史保留迁移备份；无真实日期的历史标记legacy，仅供原演示或历史展示，不参与真实学习。现实模式的去重history从有日期的选择记录生成。模拟记录与真实记录分开统计。

原话、选择、曝光和换批各保留90天、最多200项。只有“就吃这个”的确认选择是正反馈；同日改选保存操作记录，但学习只取最终一次。曝光、没选和换批不变成负偏好。

学习纯函数为 `lunchEngine.learnPreferences(events, dateKey, enabled)`，页面和BFF使用相同统计。实际规则是至少5个有效最终选择并跨至少3日期；由于每日最终选择只计一次，首版通常需5个日期才达到门槛。按14天半衰期衰减，五维倾向平均×6，最多加6分。明确软偏好冲突的维度不给加分；硬筛选先执行，不回写档案。

“午饭记忆”展示counts中的证据，如过去N次/M日期选了X次蒸菜；提供暂停学习、清除学习记录。清除学习不清除明确忌口。服务器不保存用户档案，刷新后的状态由前端负责。

localStorage异常时保留会话内选餐，提示不能持久记忆，不能显示“已经记住”。服务端失败/静态部署使用共享引擎生成本地规则结果，缺Key也不假称已解析用户原话。

## 交互与验收清单

客户端超时取health.request_timeout_ms+1000，默认10秒。取消时AbortController中止fetch；设置修改、下一天、重置与新请求递增状态版本，丢弃旧响应。增加人工重连入口，最近失败不得继续标当前请求“大模型已连接”。

- [x] 接共享引擎，静态模式和BFF相同输入筛选/排序一致。
- [x] 当天条件与长期档案分别保存，刷新保持、加载与运行中跨天失效、模拟模式隔离。
- [x] 澄清承接、零候选与条件保留正确；忌口不自动放宽。
- [x] 原话/选择事件、90天保留、最终选择学习、暂停和清除可操作。
- [x] request状态版本、默认10秒超时、取消和重连正确；故障测试定向缩短时限。
- [x] trace显示实际阶段、过滤数、分项分、学习依据、实际调用与降级原因；只有缓存命中才显示原缓存消耗。
- [x] 桌面和390px移动端无横向溢出、白屏或运行错误，键盘焦点和正常动效操作通过。
- [x] localStorage不可用仍能会话选餐，保存失败不假称成功。
- [x] 本地BFF完成真实选择、备选、换批、刷新；取消、下一天与旧响应隔离通过故障替身验证。
- [x] 纯静态完成备选、换批、下一天和刷新；GitHub Pages域名/子路径模拟确认共享脚本路径与规则回退。
- [x] 未重启的共用3000旧实例使用打包工厂，浏览、规则选餐、备选与记录通过；脚本加载失败数为0。
- [ ] 远端GitHub Pages更新后的实际站点复验；本轮未发布，属于后续发布范围。

本地页面验收已完成；独立实例已启用V2。默认开关和共享实例保持原状态。真实用户偏好效果、生产负载与远端发布不包含在本轮验收中。
