const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const catalog = require('../../data.js');
const { createApp, readConfig, engine, applyTasteIntent } = require('../index.cjs');
const { validatePicks } = require('../model.cjs');

const input = () => ({
  profile: { ...catalog.DEFAULT_PROFILE, tastes: [...catalog.DEFAULT_PROFILE.tastes], avoid: [...catalog.DEFAULT_PROFILE.avoid] },
  history: catalog.SEED_HISTORY, todayIndex: 0, skipped: [],
});
const response = (content, finish = 'stop') => new Response(JSON.stringify({
  choices: [{ finish_reason: finish, message: { content: JSON.stringify(content) } }],
  usage: { prompt_tokens: 1200, completion_tokens: 300 },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });
const config = (apiKey = '') => ({ ...readConfig({}), apiKey });

async function fixture(t, settings = config(), fetchImpl = async () => { throw new Error('不能触发真实网络请求'); }) {
  const server = createApp(settings, { fetchImpl });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    get: (route) => fetch(url + route),
    post: (route, body, headers = {}) => fetch(url + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    }),
  };
}

function modelAnswer(request) {
  const body = JSON.parse(request.body);
  const payload = JSON.parse(body.messages[1].content);
  return {
    body, payload,
    result: {
      summary: '今天挑这三道，兼顾你的口味、主食和预算。',
      picks: payload.candidates.slice(0, 3).map((dish) => ({
        dish_id: dish.dish_id, matched: dish.facts.slice(0, 2),
        reason: `${dish.name}，${dish.tastes.join('、')}口味，价格${dish.price}元，适合今天的午饭。`,
      })),
    },
  };
}

test('配置支持北京新旧域名，拒绝把 Key 发到任意服务器', () => {
  assert.equal(readConfig({}).model, 'qwen3.8-flash');
  assert.equal(readConfig({ DASHSCOPE_BASE_URL: 'https://space123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' }).baseUrl.includes('space123'), true);
  assert.throws(() => readConfig({ DASHSCOPE_BASE_URL: 'https://example.com/compatible-mode/v1' }));
});

test('所有组合都执行预算、忌口、营业和同主菜去重', () => {
  for (const avoid of [[], ['seafood'], ['pork', 'beef', 'peanut'], ['allium'], catalog.AVOID_OPTIONS.map((option) => option.id)]) {
    for (const budget of [15, 25, 45, 60]) {
      const state = engine.normalizeRequest({ ...input(), profile: { ...input().profile, avoid, budget } });
      const data = engine.analyze(state);
      for (const item of data.visible) {
        assert.ok(item.dish.price <= budget);
        assert.ok(!engine.dishMatchesAvoid(item.dish, avoid));
        assert.ok(catalog.MERCHANTS.find((merchant) => merchant.id === item.dish.merchantId).open);
        assert.ok(!data.recentDishes.some((entry) => entry.dish.main === item.dish.main));
      }
    }
  }
});

test('同一道主菜换店或换 SKU 仍被排除，第三天可以恢复', () => {
  const previous = catalog.DISHES.find((dish) => dish.id === 'd26');
  const clone = { ...previous, id: 'another-sku', merchantId: 'xiangkou' };
  const custom = require('../recommend-core.cjs')({ ...catalog, DISHES: [...catalog.DISHES, clone] });
  const state = custom.normalizeRequest(input());
  assert.ok(!custom.analyze(state).visible.some((item) => item.dish.id === clone.id));
  const later = custom.normalizeRequest({ ...input(), todayIndex: 2 });
  assert.ok(custom.analyze(later).visible.some((item) => item.dish.id === clone.id));
});

test('健康和主食保留为软排序，主食种类能改变主食分', () => {
  const state = engine.normalizeRequest(input());
  assert.ok(engine.analyze(state).visible.some((item) => item.dish.fried));
  const rice = catalog.DISHES.find((dish) => dish.id === 'd1');
  assert.equal(engine.scoreDish(rice, [], { ...state, profile: { ...state.profile, staplePreference: '米饭' } }).parts.staple, 14);
  assert.equal(engine.scoreDish(rice, [], { ...state, profile: { ...state.profile, staplePreference: '面条' } }).parts.staple, 5);
});

test('今天已选的主菜也去重，页面允许指定的食物图片域名', async (t) => {
  const state = engine.normalizeRequest({ ...input(), history: [{ dishId: 'd1', dayIndex: 0 }] });
  assert.ok(!engine.analyze(state).visible.some((item) => item.dish.main === '番茄牛腩'));
  const app = await fixture(t);
  const page = await app.get('/');
  assert.match(page.headers.get('content-security-policy'), /img-src .*https:\/\/copilot-cn\.bytedance\.net/);
});

test('未配置 Key 时推荐和对话明确回落，且不自动应用聊天偏好', async (t) => {
  const app = await fixture(t);
  const health = await (await app.get('/api/health')).json();
  assert.equal(health.configured, false);
  assert.equal(Object.hasOwn(health, 'apiKey'), false);
  const result = await (await app.post('/api/recommend', input())).json();
  assert.equal(result.source, 'rules');
  assert.equal(result.fallback_reason, 'missing_key');
  assert.equal(result.picks.length, 3);
  const chat = await (await app.post('/api/chat', { ...input(), text: '今天想吃米饭' })).json();
  assert.equal(chat.profile_applied, false);
  assert.equal(chat.source, 'rules');
  assert.match(chat.reply, /尚未配置/);
  assert.equal((await app.post('/api/preferences', { ...input(), text: '想吃米饭' })).status, 503);
});

test('结构化调用关闭思考，重复请求复用缓存，价格由菜单补全', async (t) => {
  let calls = 0;
  const app = await fixture(t, config('测试凭证'), async (_url, request) => {
    calls += 1;
    const { body, payload, result } = modelAnswer(request);
    assert.equal(body.model, 'qwen3.8-flash');
    assert.equal(body.enable_thinking, false);
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.ok(payload.candidates.length <= 15);
    return response(result);
  });
  const first = await (await app.post('/api/recommend', input())).json();
  const second = await (await app.post('/api/recommend', input())).json();
  assert.equal(first.source, 'qwen');
  assert.equal(second.cache_hit, true);
  assert.equal(calls, 1);
  for (const pick of first.picks) assert.equal(pick.dish.price, catalog.DISHES.find((dish) => dish.id === pick.dish_id).price);
});

test('禁止模型编造 ID、重复 ID、冒用其他餐品属性', () => {
  const candidates = [{ dish_id: 'd1', facts: ['咸鲜'] }, { dish_id: 'd2', facts: ['清淡'] }];
  const valid = { summary: '今天为你挑选这两道午饭。', picks: [
    { dish_id: 'd1', matched: ['咸鲜'], reason: '这一份口味咸鲜，适合今天的午饭。' },
    { dish_id: 'd2', matched: ['清淡'], reason: '这一份口味清淡，适合今天的午饭。' },
  ] };
  assert.deepEqual(validatePicks(valid, candidates), valid);
  for (const bad of [
    { ...valid, picks: [{ ...valid.picks[0], dish_id: 'fake' }, valid.picks[1]] },
    { ...valid, picks: [valid.picks[0], valid.picks[0]] },
    { ...valid, picks: [{ ...valid.picks[0], matched: ['清淡'] }, valid.picks[1]] },
  ]) assert.throws(() => validatePicks(bad, candidates));
});

test('真实模型多返回有效匹配标签时归一化，未知标签仍被拒绝', () => {
  const facts = ['咸鲜', '微辣', '做法：煮', '主食：面条', '价格：22元'];
  const value = {
    summary: '今天推荐这一道午饭。',
    picks: [{ dish_id: 'd12', matched: facts, reason: '豌杂面兼具咸鲜与微辣口味，煮制并配面条，价格22元。' }],
  };
  const candidates = [{ dish_id: 'd12', facts }];
  const result = validatePicks(value, candidates);
  assert.equal(result.picks[0].matched.length, 4);
  assert.throws(() => validatePicks({
    ...value, picks: [{ ...value.picks[0], matched: [...facts, '不存在的食材'] }],
  }, candidates));
});
test('校验失败只重试一次，然后返回安全规则结果', async (t) => {
  let calls = 0;
  const app = await fixture(t, config('测试凭证'), async () => {
    calls += 1;
    return response({ picks: [{ dish_id: '不存在的菜' }], summary: '错误结果' });
  });
  const result = await (await app.post('/api/recommend', input())).json();
  assert.equal(calls, 2);
  assert.equal(result.source, 'rules');
  assert.equal(result.fallback_reason, 'invalid_output');
  assert.ok(result.picks.every((pick) => catalog.DISHES.some((dish) => dish.id === pick.dish_id)));
});

test('上游认证失败不重试，不返回凭证或供应商错误正文', async (t) => {
  let calls = 0;
  const app = await fixture(t, config('secret-test'), async () => {
    calls += 1;
    return new Response('错误正文包含 secret-test', { status: 401 });
  });
  const result = await (await app.post('/api/recommend', input())).text();
  assert.equal(calls, 1);
  assert.match(result, /auth_failed/);
  assert.ok(!result.includes('secret-test'));
});

test('超时直接规则兜底，不等待无限响应', async (t) => {
  const app = await fixture(t, { ...config('测试凭证'), timeoutMs: 30 }, async (_url, request) =>
    new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })));
  const result = await (await app.post('/api/recommend', input())).json();
  assert.equal(result.source, 'rules');
  assert.equal(result.fallback_reason, 'timeout');
});

test('不信任客户端候选和权重，拒绝错误输入及跨域调用', async (t) => {
  const app = await fixture(t);
  assert.equal((await app.post('/api/recommend', { ...input(), profile: { ...input().profile, budget: -1 } })).status, 400);
  assert.equal((await app.post('/api/recommend', { ...input(), skipped: ['fake'] })).status, 400);
  assert.equal((await app.post('/api/recommend', input(), { Origin: 'https://example.com' })).status, 403);
  for (const route of ['/server/.env', '/.env', '/.git/config', '/server/model.cjs']) {
    assert.equal((await app.get(route)).status, 404);
  }
});

test('自然语言解析后重做硬筛选，遗漏的已有忌口保持不变', async (t) => {
  let calls = 0;
  const app = await fixture(t, config('测试凭证'), async (_url, request) => {
    calls += 1;
    const body = JSON.parse(request.body);
    if (body.response_format.json_schema.name === 'lunch_preferences') return response({
      ...input().profile, avoid: ['peanut'], staplePreference: '米饭',
      message: '新增花生忌口，主食优先米饭。', unsupported_avoid: [], needs_clarification: false,
    });
    const { payload, result } = modelAnswer(request);
    assert.ok(payload.candidates.every((dish) => !dish.ingredients.some((ingredient) => /香菜|花生/.test(ingredient))));
    return response(result);
  });
  const result = await (await app.post('/api/chat', { ...input(), text: '不吃花生，今天想吃米饭' })).json();
  assert.equal(calls, 2);
  assert.equal(result.profile_applied, true);
  assert.ok(result.profile.avoid.includes('cilantro'));
  assert.ok(result.profile.avoid.includes('organ'));
  assert.ok(result.profile.avoid.includes('peanut'));
  assert.equal(result.source, 'qwen');
});

test('“清淡”落到口味标签并移除辣味，其他约束与去重保持不变', async (t) => {
  const spicy = { ...input().profile, tastes: ['咸鲜', '微辣'] };
  assert.deepEqual(applyTasteIntent(spicy, '今天想清淡一点').tastes, ['咸鲜', '清淡']);
  assert.deepEqual(applyTasteIntent(spicy, '不想吃辣，养胃一点').tastes, ['咸鲜', '清淡']);
  assert.deepEqual(applyTasteIntent(spicy, '今天想吃辣').tastes, ['咸鲜', '微辣']);
  assert.deepEqual(applyTasteIntent({ ...spicy, tastes: ['重辣'] }, '清爽点').tastes, ['清淡']);

  const app = await fixture(t, config('测试凭证'), async (_url, request) => {
    const body = JSON.parse(request.body);
    if (body.response_format.json_schema.name === 'lunch_preferences') return response({
      ...input().profile, tastes: ['咸鲜', '微辣'], avoid: ['cilantro', 'organ', 'peanut'],
      staplePreference: '米饭', budget: 30, message: '已更新口味和预算。',
      unsupported_avoid: [], needs_clarification: false,
    });
    const { payload, result } = modelAnswer(request);
    assert.deepEqual(payload.profile.tastes, ['咸鲜', '清淡']);
    return response(result);
  });
  const result = await (await app.post('/api/chat', {
    ...input(), text: '今天想清淡一点，不吃花生，想吃米饭，预算30元',
    history: [{ dishId: 'd1', dayIndex: 0 }],
  })).json();
  assert.equal(result.profile_applied, true);
  assert.deepEqual(result.profile.tastes, ['咸鲜', '清淡']);
  assert.deepEqual(result.profile.avoid, ['cilantro', 'organ', 'peanut']);
  assert.equal(result.profile.staplePreference, '米饭');
  assert.equal(result.profile.budget, 30);
  assert.ok(!result.picks.some((pick) => pick.dish.main === '番茄牛腩'));
});

test('不能匹配的忌口或预算先澄清，不继续推荐', async (t) => {
  let calls = 0;
  const app = await fixture(t, config('测试凭证'), async () => {
    calls += 1;
    return response({
      ...input().profile, staplePreference: '不限', message: '菜单未完整标注芝麻，请先确认商家食材。',
      unsupported_avoid: ['芝麻'], needs_clarification: true,
    });
  });
  const result = await (await app.post('/api/chat', { ...input(), text: '芝麻过敏' })).json();
  assert.equal(result.profile_applied, false);
  assert.equal(result.picks.length, 0);
  assert.equal(result.fallback_reason, 'unsupported_avoid');
  assert.equal(calls, 1);
});
