const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const catalog = require('../data.js');
const legacy = require('./legacy-app.cjs');
const engine = require('./recommend-core.cjs')(catalog);
const { createModelClient } = require('./model.cjs');
const { inspectIntent, applyValidatedIntent, applyTasteIntent, question } = require('./intent.cjs');
const { candidate, renderReason, updateMessage, fallbackMessages } = require('./explanation.cjs');
const VERSIONS = { rules: '2.0.0', prompt: '2.0.0', schema: '2.0.0', learning: '1.0.0',
  catalog: createHash('sha256').update(JSON.stringify(catalog)).digest('hex').slice(0, 12) };
const STATIC = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/app.js', 'app.js'],
  ['/data.js', 'data.js'], ['/styles.css', 'styles.css'], ['/server/recommend-core.js', 'server/recommend-core.js']]);
function readConfig(env = process.env) {
  const base = legacy.readConfig(env);
  const requestTimeoutMs = Number(env.REQUEST_TIMEOUT_MS || 9000);
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 60000) throw new Error('REQUEST_TIMEOUT_MS 配置不正确。');
  if (env.AGENT_V2_ENABLED && !['true', 'false'].includes(env.AGENT_V2_ENABLED)) throw new Error('AGENT_V2_ENABLED 必须是true或false。');
  return { ...base, requestTimeoutMs, agentV2: env.AGENT_V2_ENABLED === 'true' };
}
const emptyUsage = () => ({ prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0, unknown: false });
function addUsage(usages) {
  return usages.reduce((total, usage) => {
    if (!usage) return total;
    for (const key of ['prompt_tokens', 'completion_tokens', 'cached_tokens']) total[key] += usage[key] || 0;
    total.unknown ||= Boolean(usage.unknown);
    return total;
  }, emptyUsage());
}
function phase() { return { status: 'not_run', attempts: 0, latency_ms: 0, usage: emptyUsage() }; }
function context(config, signal) {
  return { started: Date.now(), deadline: Date.now() + (config.requestTimeoutMs || 9000), signal,
    budget: { calls: 0, limit: 3 }, phases: { parse: phase(), recommend: phase() } };
}
function semanticKey(state) {
  const sort = list => [...new Set(list)].sort();
  const profile = { ...state.profile, tastes: sort(state.profile.tastes), avoid: sort(state.profile.avoid), customAvoid: sort(state.profile.customAvoid) };
  const day = state.day_preferences ? { ...state.day_preferences,
    ...(state.day_preferences.tastes ? { tastes: sort(state.day_preferences.tastes) } : {}) } : null;
  return createHash('sha256').update(JSON.stringify({ versions: VERSIONS, profile,
    constraints: { ...state.constraints, cuisines: sort(state.constraints.cuisines), proteins: sort(state.constraints.proteins) },
    persistent: state.persistent_constraints, date: state.date_key, day, todayIndex: state.todayIndex,
    history: [...state.history].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    skipped: sort(state.skipped), events: [...state.selection_events].sort((a, b) => a.event_id.localeCompare(b.event_id)),
    learning_enabled: state.learning_enabled })).digest('hex');
}
function json(res, status, body) {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function readJson(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('请使用application/json。'), { status: 415 });
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) throw Object.assign(new Error('请求内容过长。'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求不是合法JSON。'), { status: 400 }); }
}
function createApp(config = readConfig(), options = {}) {
  if (!config.agentV2) return legacy.createApp(config, options);
  const model = createModelClient(config, options.fetchImpl);
  const cache = new Map(), inFlight = new Map(), clients = new Map();
  function decorate(data, picks) {
    return picks.map(pick => {
      const item = data.visible.find(item => item.dish.id === pick.dish_id);
      return { ...pick, reason: renderReason(item.dish), rule_score: item.score, score_parts: item.parts,
        learned_bonus: item.learned_bonus, learned_parts: item.learned_parts, rank_score: item.rank_score,
        dish: item.dish, merchant: catalog.MERCHANTS.find(m => m.id === item.dish.merchantId) };
    });
  }
  function trace(state, data, picks = []) {
    return { counts: data.counts, model_candidate_count: Math.min(15, data.visible.length),
      omitted_from_model: Math.max(0, data.visible.length - 15), versions: VERSIONS,
      persistent_profile: state.profile, day_preferences: state.day_preferences,
      constraints: state.constraints, persistent_constraints: state.persistent_constraints,
      learning: data.learning, picks: picks.map(({ dish_id, matched, rule_score, score_parts, learned_bonus, rank_score, learned_parts }) =>
        ({ dish_id, matched, rule_score, score_parts, learned_bonus, rank_score, learned_parts })),
      score_note: '规则分用于排序，学习加分来自历史选择；两者不是模型置信度。菜单为演示数据，食材标注不完整，不能保证无过敏原。' };
  }
  function clarification(state, data, items, code = 'clarification_required', pending = null) {
    const questions = items.slice(0, 2);
    const reply = questions.map(q => q.question).join(' ');
    return { picks: [], source: 'rules', fallback_reason: code, summary: reply, reply,
      profile: { ...state.profile, ...state.day_preferences }, persistent_profile: state.profile,
      day_preferences: state.day_preferences, constraints: state.constraints, persistent_constraints: state.persistent_constraints,
      profile_applied: false, needs_clarification: true,
      clarification: { questions, context: pending?.context || '', round: pending?.round || 1 },
      changes: [], model: null, usage: null, decision_trace: trace(state, data) };
  }
  function rules(state, data, reason) {
    const choices = data.visible.slice(0, 3).map(item => {
      const c = candidate(item, { ...state.profile, ...state.day_preferences });
      return { dish_id: c.dish_id, matched: c.facts.slice(0, 3), rationale_codes: c.supported_rationale_codes };
    });
    const picks = decorate(data, choices);
    return { source: 'rules', fallback_reason: reason, picks, summary: fallbackMessages[reason] || fallbackMessages.upstream_error,
      model: null, usage: null, candidate_count: data.visible.length,
      excluded: { avoid: data.counts.avoid, budget: data.counts.budget, history: data.counts.history, constraints: data.counts.constraints },
      decision_trace: trace(state, data, picks) };
  }
  async function recommendation(state, ctx, maxAttempts = 2, forced) {
    const data = engine.analyze(state);
    if (data.unsupported_avoid.length) return clarification(state, data, [question('customAvoid', 'unsupported_avoid',
      `菜单没有完整标注${data.unsupported_avoid.join('、')}，请先向商家确认食材。`, ['已确认食材'])], 'unsupported_avoid');
    if (!data.visible.length) return clarification(state, data, [question('budget', 'no_candidates',
      '没有符合当前限制的菜品。是否调整预算、主食或配送时效？忌口继续保留。', ['预算15至60元', '主食不限', '配送不限', '保持'])], 'no_candidates');
    const p = ctx.phases.recommend;
    if (forced || !config.apiKey || data.visible.length <= 3) {
      p.status = 'rules';
      return rules(state, data, forced || (!config.apiKey ? 'missing_key' : 'few_candidates'));
    }
    p.status = 'model';
    const effective = { ...state.profile, ...state.day_preferences };
    try {
      const response = await model.recommend({
        profile: effective, constraints: state.constraints,
        recent_main_dishes: data.recentDishes.map(e => e.dish.main),
        candidates: data.visible.slice(0, 15).map(item => candidate(item, effective)),
      }, { ...ctx, phase: p, maxAttempts });
      const picks = decorate(data, response.result.picks);
      return { source: 'qwen', fallback_reason: null, picks, summary: '已从符合本次约束的菜单中选出午饭。',
        model: config.model, usage: response.usage, attempts: response.attempts, latency_ms: response.latency_ms,
        candidate_count: data.visible.length, decision_trace: trace(state, data, picks) };
    } catch (error) {
      p.status = error.code === 'cancelled' ? 'cancelled' : 'failed'; p.error_code = error.code;
      return rules(state, data, error.code || 'upstream_error');
    }
  }
  async function cachedRecommendation(state, caller, maxAttempts = 2) {
    const key = semanticKey(state);
    const saved = cache.get(key);
    if (saved?.expires > Date.now()) {
      caller.phases.recommend = { ...phase(), cached: true, origin_source: saved.value.source };
      return { ...saved.value, cache_hit: true, origin_usage: saved.origin_usage };
    }
    let shared = inFlight.get(key), owner = false;
    if (!shared) {
      owner = true;
      const controller = new AbortController();
      const timeout = AbortSignal.timeout(Math.max(1, caller.deadline - Date.now()));
      const ctx = context(config, AbortSignal.any([controller.signal, timeout]));
      ctx.deadline = caller.deadline;
      ctx.budget.limit = Math.min(maxAttempts, caller.budget.limit - caller.budget.calls);
      shared = { controller, ctx, subscribers: new Set() };
      inFlight.set(key, shared);
      shared.promise = recommendation(state, ctx, maxAttempts).then(value => {
        const origin_usage = ctx.phases.recommend.usage;
        if (!controller.signal.aborted && !value.needs_clarification) {
          const transient = value.fallback_reason && !['missing_key', 'few_candidates'].includes(value.fallback_reason);
          cache.set(key, { value, origin_usage, expires: Date.now() + (transient ? 5000 : 600000) });
          if (cache.size > 200) cache.delete(cache.keys().next().value);
        }
        return { value, origin_usage };
      }).finally(() => { if (inFlight.get(key) === shared) inFlight.delete(key); });
    }
    const token = Symbol(); shared.subscribers.add(token);
    let onAbort;
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(Object.assign(new Error('本次请求中止。'), { code:
        caller.signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled' }));
      if (caller.signal.aborted) onAbort();
      else caller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const { value, origin_usage } = await Promise.race([shared.promise, cancelled]);
      if (owner) {
        caller.phases.recommend = { ...shared.ctx.phases.recommend };
        caller.budget.calls += shared.ctx.budget.calls;
      } else caller.phases.recommend = { ...phase(), shared: true, origin_source: value.source };
      return { ...value, cache_hit: !owner, origin_usage };
    } catch (error) {
      if (owner) {
        caller.phases.recommend = { ...shared.ctx.phases.recommend,
          status: error.code === 'cancelled' ? 'cancelled' : 'failed',
          error_code: error.code, usage: { ...shared.ctx.phases.recommend.usage, unknown: true } };
        caller.budget.calls += shared.ctx.budget.calls;
      }
      throw error;
    } finally {
      caller.signal.removeEventListener('abort', onAbort);
      shared.subscribers.delete(token);
      if (!shared.subscribers.size && inFlight.get(key) === shared) {
        inFlight.delete(key); shared.controller.abort(new DOMException('所有请求已取消。', 'AbortError'));
      }
    }
  }
  function finish(res, status, value, ctx, requestId) {
    const actual = addUsage(Object.values(ctx.phases).map(p => p.usage));
    const telemetry = { request_id: requestId, request_latency_ms: Date.now() - ctx.started,
      stages: ctx.phases, model_calls: ctx.budget.calls, cache_hit: Boolean(value.cache_hit),
      actual_usage: actual, origin_usage: value.origin_usage || null, versions: VERSIONS,
      candidate_count: value.candidate_count ?? value.decision_trace?.counts.eligible ?? 0,
      result_status: value.needs_clarification ? 'clarification' : value.fallback_reason || 'ok' };
    if (value.decision_trace) value = { ...value, decision_trace: { ...value.decision_trace,
      stages: ctx.phases, cache_hit: telemetry.cache_hit, fallback_reason: value.fallback_reason } };
    json(res, status, { ...value, request_id: requestId, request_latency_ms: telemetry.request_latency_ms, telemetry });
  }
  const server = http.createServer(async (req, res) => {
    let release;
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableEnded) controller.abort(new DOMException('客户端断开。', 'AbortError')); });
    const ctx = context(config, AbortSignal.any([controller.signal, AbortSignal.timeout(config.requestTimeoutMs || 9000)]));
    const requestId = randomUUID();
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, {
        ok: true, configured: Boolean(config.apiKey), model: config.model, agent_v2_enabled: true,
        request_timeout_ms: config.requestTimeoutMs || 9000, versions: VERSIONS });
      if (req.method === 'POST' && ['/api/recommend', '/api/chat', '/api/preferences'].includes(pathname)) {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: '请从本站发起请求。' });
        const client = req.socket.remoteAddress;
        const old = clients.get(client);
        const entry = old && old.until > Date.now() ? old : { count: 0, active: old?.active || 0, until: Date.now() + 60000 };
        entry.count++;
        if (entry.count > 30 || entry.active >= 2) return json(res, 429, { error: '操作太快，请稍后重试。' });
        entry.active++; clients.set(client, entry); release = () => { entry.active--; };
        if (clients.size > 1000) for (const [key, value] of clients) if (!value.active && value.until <= Date.now()) clients.delete(key);
        const input = await readJson(req);
        let state;
        try { state = engine.normalizeRequest(input); }
        catch (error) { return json(res, 400, { error: error.message }); }
        if (pathname === '/api/recommend') {
          try { return finish(res, 200, await cachedRecommendation(state, ctx), ctx, requestId); }
          catch (error) {
            ctx.phases.recommend.status = error.code === 'cancelled' ? 'cancelled' : 'failed';
            ctx.phases.recommend.error_code = error.code || 'timeout';
            if (error.code === 'timeout') {
              ctx.phases.recommend.usage.unknown = true;
              return finish(res, 200, rules(state, engine.analyze(state), 'timeout'), ctx, requestId);
            }
            throw error;
          }
        }
        const isChat = pathname === '/api/chat';
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 500) return json(res, 400, { error: '请填写1至500字的午饭偏好。' });
        const messages = input.messages ?? [];
        if (!Array.isArray(messages) || messages.length > 8 || !messages.every(m => m && ['user', 'assistant'].includes(m.role) &&
          typeof m.content === 'string' && m.content.length <= 500)) return json(res, 400, { error: '对话上下文格式不正确。' });
        if (!config.apiKey) {
          if (!isChat) return finish(res, 503, { error: '尚未配置模型。', code: 'missing_key', profile_applied: false }, ctx, requestId);
          return finish(res, 200, { ...await cachedRecommendation(state, ctx), profile: state.profile, profile_applied: false,
            reply: '尚未配置模型，这句话还没有解析。请用设置选项调整偏好。', changes: [],
            utterance_event: { event_id: requestId, text: input.text.trim(), date_key: state.date_key, parsed: false, changes: [] } }, ctx, requestId);
        }
        let inspection;
        try { inspection = inspectIntent(input.text.trim(), state, input.pending_clarification || null); }
        catch (error) { return json(res, 400, { error: error.message }); }
        if (inspection.needs_clarification) {
          const result = clarification(state, engine.analyze(state), inspection.clarification.questions,
            inspection.unsupported_avoid.length ? 'unsupported_avoid' : 'clarification_required', inspection.clarification);
          return finish(res, isChat ? 200 : 422, { ...result, unsupported_avoid: inspection.unsupported_avoid,
            utterance_event: { event_id: requestId, text: input.text.trim(), date_key: state.date_key, parsed: false, changes: [] } }, ctx, requestId);
        }
        if (inspection.out_of_scope || inspection.stop) return finish(res, 200, {
          ...clarification(state, engine.analyze(state), []), needs_clarification: false, clarification: null,
          fallback_reason: inspection.stop ? 'unchanged' : 'out_of_scope',
          reply: inspection.stop ? '已保留当前设置。' : '我只能处理午饭偏好、选餐、换批和选餐解释。',
        }, ctx, requestId);
        try {
          ctx.phases.parse.status = 'model';
          const parsed = await model.parsePreferences({
            profile: state.profile, text: input.text.trim(), avoid_options: catalog.AVOID_OPTIONS,
            supported_staples: engine.STAPLES, messages, pending_clarification: input.pending_clarification || null,
          }, catalog, engine, { ...ctx, phase: ctx.phases.parse });
          const applied = applyValidatedIntent(parsed.result, inspection, input.text);
          state = engine.normalizeRequest({ ...state, profile: applied.profile, constraints: applied.constraints,
            persistent_constraints: applied.persistent_constraints, day_preferences: applied.day_preferences });
          const common = { profile: { ...state.profile, ...state.day_preferences }, persistent_profile: state.profile,
            day_preferences: state.day_preferences, constraints: state.constraints, persistent_constraints: state.persistent_constraints,
            changes: applied.changes, profile_applied: applied.applied, clarification: null, needs_clarification: false,
            preference_usage: parsed.usage, utterance_event: { event_id: requestId, text: input.text.trim(),
              date_key: state.date_key, parsed: true, changes: applied.changes } };
          if (!isChat) return finish(res, 200, { ...common, message: updateMessage(applied.changes) }, ctx, requestId);
          let result;
          try { result = await cachedRecommendation(state, ctx, 1); }
          catch (error) {
            if (error.code === 'cancelled') throw error;
            result = rules(state, engine.analyze(state), error.code || 'timeout');
          }
          return finish(res, 200, { ...result, ...common,
            ...(result.needs_clarification ? { needs_clarification: true, clarification: result.clarification } : {}),
            reply: `${updateMessage(applied.changes)} ${result.summary}` }, ctx, requestId);
        } catch (error) {
          ctx.phases.parse.status = error.code === 'cancelled' ? 'cancelled' : 'failed';
          ctx.phases.parse.error_code = error.code || 'invalid_output';
          return finish(res, isChat ? 200 : 502, { ...await recommendation(state, ctx, 1, error.code || 'invalid_output'),
            profile: state.profile, persistent_profile: state.profile, profile_applied: false, changes: [],
            reply: '这句话暂时无法解析，原设置已保留。请用设置选项调整偏好。',
            utterance_event: { event_id: requestId, text: input.text.trim(), date_key: state.date_key, parsed: false, changes: [] },
          }, ctx, requestId);
        }
      }
      const file = STATIC.get(pathname);
      if (req.method === 'GET' && file) {
        const content = await fs.readFile(path.join(__dirname, '..', file));
        res.writeHead(200, { 'Content-Type': file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.js')
          ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://copilot-cn.bytedance.net; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
        return res.end(content);
      }
      json(res, 404, { error: '没有找到该页面或接口。' });
    } catch (error) {
      if (['timeout', 'cancelled'].includes(error.code)) return finish(res, 200, {
        source: 'rules', picks: [], fallback_reason: error.code, profile_applied: false,
        summary: fallbackMessages.timeout, reply: fallbackMessages.timeout,
      }, ctx, requestId);
      json(res, error.status || 500, { error: error.status ? error.message : '服务暂时不可用。' });
    } finally { release?.(); }
  });
  return server;
}
if (require.main === module) {
  const config = readConfig();
  createApp(config).listen(config.port, config.host, () => console.log(`午饭搭子已启动：http://${config.host}:${config.port}（Agent V2 ${config.agentV2 ? '开启' : '关闭'}）`));
}
module.exports = { createApp, readConfig, engine, applyTasteIntent, semanticKey, VERSIONS };
