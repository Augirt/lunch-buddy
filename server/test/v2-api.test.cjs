const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp, readConfig } = require('../index.cjs');
const catalog = require('../../data.js');
const input = extra => ({ profile: { ...catalog.DEFAULT_PROFILE, avoid: [], tastes: ['咸鲜', '微辣'] },
  history: [], date_key: '2026-11-28', ...extra });
const config = extra => ({ ...readConfig({ AGENT_V2_ENABLED: 'true' }), apiKey: 'test-key', ...extra });
const response = (content, finish_reason = 'stop') => new Response(JSON.stringify({
  choices: [{ finish_reason, message: { content: JSON.stringify(content) } }],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
}), { headers: { 'Content-Type': 'application/json' } });
function answer(request) {
  const body = JSON.parse(request.body), payload = JSON.parse(body.messages[1].content);
  if (body.response_format.json_schema.name === 'lunch_preferences') return {
    ...payload.profile, changes: [], message: '已更新', unsupported_avoid: [], needs_clarification: false,
    ...{ customAvoid: undefined },
  };
  return { picks: payload.candidates.slice(0, 3).map(c => ({ dish_id: c.dish_id,
    matched: c.facts.slice(0, 2), rationale_codes: c.supported_rationale_codes.slice(0, 2) })) };
}
async function fixture(t, settings = config(), fetchImpl = async (_, req) => response(answer(req))) {
  const server = createApp(settings, { fetchImpl });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { server, post: (body, route = '/api/recommend', signal) => fetch(url + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  }), get: route => fetch(url + route) };
}
test('V2缓存语义去重：新调用0、原usage单列、真实trace可核对', async t => {
  let calls = 0;
  const app = await fixture(t, config(), async (_, req) => { calls++; return response(answer(req)); });
  const first = await (await app.post(input())).json();
  const next = await (await app.post(input({ profile: { ...input().profile, tastes: ['微辣', '咸鲜'] }, skipStats: { fake: 999 } }))).json();
  assert.equal(first.source, 'qwen');
  assert.equal(first.telemetry.model_calls, 1);
  assert.equal(next.cache_hit, true);
  assert.equal(next.telemetry.model_calls, 0);
  assert.equal(next.telemetry.actual_usage.prompt_tokens, 0);
  assert.equal(next.telemetry.origin_usage.prompt_tokens, 100);
  assert.equal(next.telemetry.stages.recommend.attempts, 0);
  assert.equal(calls, 1);
  assert.ok(first.picks.every(p => p.reason.includes(`${p.dish.price}元`)));
  assert.equal(first.decision_trace.counts.eligible, first.candidate_count);
});
test('V2对话解析最多重试一次，推荐不重试，全程最多3请求', async t => {
  let calls = 0;
  const app = await fixture(t, config(), async (_, req) => {
    calls++;
    if (calls === 1 || calls === 3) return response({});
    return response(answer(req));
  });
  const result = await (await app.post(input({ text: '今天想清淡一点' }), '/api/chat')).json();
  assert.equal(calls, 3);
  assert.equal(result.telemetry.model_calls, 3);
  assert.equal(result.telemetry.stages.parse.attempts, 2);
  assert.equal(result.telemetry.stages.recommend.attempts, 1);
  assert.equal(result.telemetry.actual_usage.prompt_tokens, 300);
  assert.equal(result.source, 'rules');
  assert.equal(result.profile_applied, true);
  assert.equal(result.persistent_profile.tastes.includes('微辣'), true);
  assert.equal(result.day_preferences.tastes.includes('清淡'), true);
});
test('缺Key不解析，未知食材和冲突不推荐，无候选不放宽', async t => {
  const noKey = await fixture(t, config({ apiKey: '' }));
  const missing = await (await noKey.post(input({ text: '不吃花生' }), '/api/chat')).json();
  assert.equal(missing.profile_applied, false);
  assert.equal(missing.telemetry.model_calls, 0);
  const app = await fixture(t, config(), async () => { throw Error('此路径不应调用模型'); });
  for (const text of ['芝麻过敏', '预算10元', '只吃米饭，只吃面食']) {
    const result = await (await app.post(input({ text }), '/api/chat')).json();
    assert.equal(result.needs_clarification, true, text);
    assert.equal(result.telemetry.model_calls, 0);
    assert.equal(result.picks.length, 0);
  }
  const none = await (await app.post(input({ constraints: { dateKey: '2026-11-28', maxMinutes: 1 } }))).json();
  assert.equal(none.fallback_reason, 'no_candidates');
  assert.equal(none.telemetry.model_calls, 0);
  assert.equal(none.constraints.maxMinutes, 1);
});
test('错误分类区分欠费4014295xx，正文和Key不泄露', async t => {
  for (const [status, code, expected] of [[400, 'Arrearage', 'account_unavailable'], [401, 'Unauthorized', 'auth_failed'],
    [429, 'RateLimit', 'rate_limited'], [503, 'Internal', 'upstream_error']]) {
    let calls = 0;
    const app = await fixture(t, config(), async () => {
      calls++; return new Response(JSON.stringify({ error: { code, message: 'test-key private-body' } }), { status });
    });
    const result = await (await app.post(input())).json();
    assert.equal(result.fallback_reason, expected);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes('private-body'), false);
    assert.equal(JSON.stringify(result).includes('test-key'), false);
    assert.equal(result.telemetry.actual_usage.unknown, true);
  }
});
test('总请求期限包含解析和推荐，解析成功后超时不丢条件', async t => {
  const app = await fixture(t, config({ requestTimeoutMs: 50, timeoutMs: 8000 }), async (_, req) => {
    const body = JSON.parse(req.body);
    if (body.response_format.json_schema.name === 'lunch_preferences') return response(answer(req));
    return new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true }));
  });
  const result = await (await app.post(input({ text: '今天不要辣' }), '/api/chat')).json();
  assert.equal(result.profile_applied, true);
  assert.equal(result.constraints.noSpicy, true);
  assert.equal(result.telemetry.stages.parse.status, 'model');
  assert.equal(result.fallback_reason, 'timeout');
  assert.ok(result.request_latency_ms < 300);
  assert.ok(result.picks.every(p => !p.dish.tastes.some(t => /辣/.test(t))));
});
test('3次连续5xx熔断，30秒到期探测恢复', async t => {
  let now = Date.now(), calls = 0, healthy = false;
  const app = await fixture(t, config({ clock: () => now }), async (_, req) => {
    calls++; return healthy ? response(answer(req)) : new Response('{}', { status: 503 });
  });
  for (let i = 0; i < 3; i++) {
    const result = await (await app.post(input({ skipped: catalog.DISHES.slice(0, i).map(d => d.id) }))).json();
    assert.equal(result.fallback_reason, 'upstream_error');
  }
  const open = await (await app.post(input({ skipped: ['d4'] }))).json();
  assert.equal(open.fallback_reason, 'circuit_open');
  assert.equal(calls, 3);
  now += 30001; healthy = true;
  const recovered = await (await app.post(input({ skipped: ['d5'] }))).json();
  assert.equal(recovered.source, 'qwen');
  assert.equal(calls, 4);
});
test('合并请求单人取消不影响其他订阅者，最后取消传播上游', async t => {
  let resolveUpstream, started;
  let upstreamAborted = false, calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const app = await fixture(t, config(), async (_, req) => {
    calls++; started();
    req.signal.addEventListener('abort', () => { upstreamAborted = true; }, { once: true });
    return new Promise(resolve => { resolveUpstream = () => resolve(response(answer(req))); });
  });
  const controller = new AbortController();
  const first = app.post(input(), '/api/recommend', controller.signal).catch(e => e);
  await ready;
  const second = app.post(input());
  await new Promise(resolve => setTimeout(resolve, 20));
  controller.abort();
  await first;
  assert.equal(upstreamAborted, false);
  resolveUpstream();
  const result = await (await second).json();
  assert.equal(result.source, 'qwen');
  assert.equal(calls, 1);
  assert.equal(result.telemetry.model_calls, 0);
  let readyLast, observedAbort;
  const lastReady = new Promise(resolve => { readyLast = resolve; });
  const abortSeen = new Promise(resolve => { observedAbort = resolve; });
  const last = await fixture(t, config(), async (_, req) => {
    readyLast();
    return new Promise((_, reject) => req.signal.addEventListener('abort', () => {
      observedAbort(); reject(req.signal.reason);
    }, { once: true }));
  });
  const c = new AbortController();
  const pending = last.post(input(), '/api/recommend', c.signal).catch(e => e);
  await lastReady; c.abort(); await pending; await abortSeen;
});
test('公开共享脚本，私有文件不公开', async t => {
  const app = await fixture(t);
  assert.equal((await app.get('/server/recommend-core.js')).status, 200);
  for (const path of ['/server/.env', '/server/model.cjs', '/server/legacy-app.cjs']) assert.equal((await app.get(path)).status, 404);
});
test('零至三候选均不调用推荐模型，三道以内全部满足约束', async t => {
  const app = await fixture(t, config(), async () => { throw Error('少候选不应调用模型'); });
  const visible = require('../index.cjs').engine.analyze(require('../index.cjs').engine.normalizeRequest(input())).visible;
  for (let count = 0; count <= 3; count++) {
    const keep = visible.slice(0, count).map(i => i.dish.id);
    const result = await (await app.post(input({ skipped: catalog.DISHES.filter(d => !keep.includes(d.id)).map(d => d.id) }))).json();
    assert.equal(result.telemetry.model_calls, 0);
    assert.equal(result.picks.length, count);
    assert.equal(result.fallback_reason, count ? 'few_candidates' : 'no_candidates');
    assert.ok(result.picks.every(p => keep.includes(p.dish_id)));
  }
});
test('坏JSON、截断、越界事实均有限重试，失败消耗仍可观测', async t => {
  for (const mode of ['bad_json', 'length', 'wrong_fact']) {
    let calls = 0;
    const app = await fixture(t, config(), async (_, req) => {
      calls++;
      if (mode === 'bad_json') return new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: '{broken' } }], usage: { prompt_tokens: 100, completion_tokens: 20 },
      }));
      const result = answer(req);
      if (mode === 'wrong_fact') result.picks[0].matched = ['价格：1元'];
      return response(result, mode === 'length' ? 'length' : 'stop');
    });
    const result = await (await app.post(input())).json();
    assert.equal(calls, 2);
    assert.equal(result.fallback_reason, 'invalid_output');
    assert.equal(result.telemetry.actual_usage.prompt_tokens, 200);
    assert.equal(result.telemetry.model_calls, 2);
  }
});
