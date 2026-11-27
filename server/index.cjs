const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const catalog = require('../data.js');
const engine = require('./recommend-core.cjs')(catalog);
const { createModelClient } = require('./model.cjs');
const ROOT = path.resolve(__dirname, '..');
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/data.js', ['data.js', 'text/javascript; charset=utf-8']],
]);
const FALLBACK_MESSAGES = {
  missing_key: '尚未配置模型，先按你的口味用规则推荐。',
  timeout: '模型回复超时，已切换为规则推荐。',
  auth_failed: '模型凭证或权限未就绪，已切换为规则推荐。',
  rate_limited: '模型请求暂时受限，已切换为规则推荐。',
  model_config: '模型名称或接口配置需检查，已切换为规则推荐。',
  invalid_output: '模型结果未通过校验，已切换为规则推荐。',
  upstream_error: '模型服务暂时不可用，已切换为规则推荐。',
  network_error: '模型连接暂时不可用，已切换为规则推荐。',
  few_candidates: '候选较少，直接为你挑出符合约束的菜品。',
};

function readConfig(env = process.env) {
  const number = (key, fallback, min, max) => {
    const value = Number(env[key] || fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} 配置不正确。`);
    return value;
  };
  const baseUrl = (env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash ||
    !(parsed.hostname === 'dashscope.aliyuncs.com' ||
      /^[a-z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(parsed.hostname)) ||
    parsed.pathname !== '/compatible-mode/v1') {
    throw new Error('DASHSCOPE_BASE_URL 需为百炼北京的 HTTPS 兼容接口地址。');
  }
  return {
    apiKey: env.DASHSCOPE_API_KEY?.trim() || '',
    baseUrl, model: env.QWEN_MODEL || 'qwen3.8-flash',
    timeoutMs: number('MODEL_TIMEOUT_MS', 8000, 1000, 60000),
    maxTokens: number('MODEL_MAX_TOKENS', 600, 300, 2000),
    host: env.HOST || '127.0.0.1', port: number('PORT', 3000, 1, 65535),
  };
}

async function readJson(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) {
    throw Object.assign(new Error('请使用 application/json。'), { status: 415 });
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw Object.assign(new Error('请求内容过长。'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求不是合法 JSON。'), { status: 400 }); }
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function preserveAvoid(profile, previous, text) {
  // 解析器不能因漏字段或普通口味修改而清掉已有忌口。
  const clearAll = /^(清空忌口|取消所有忌口|取消全部忌口)[。！!.\s]*$/.test(text.trim());
  const protectedIds = clearAll ? [] : previous.avoid.filter((id) => {
    const option = catalog.AVOID_OPTIONS.find((item) => item.id === id);
    return ![option.label, ...option.terms].some((label) =>
      new RegExp(`(?:^|[，,。；;\\s])(?:现在)?(?:可以吃|取消忌口[:：]?)${label}`).test(text));
  });
  return { ...profile, avoid: [...new Set([...protectedIds, ...profile.avoid])] };
}

const LIGHT_TASTE = /清淡|清爽|养胃|不辣|不吃辣|不要辣|少辣|别太辣|不要太辣|口味轻/;

function applyTasteIntent(profile, text) {
  // 菜单里有“清淡”标签：用户原话必须先落到标签上，不能只留给模型解释成少油。
  if (!LIGHT_TASTE.test(text)) return profile;
  const tastes = profile.tastes.filter((taste) => taste !== '微辣' && taste !== '重辣');
  if (!tastes.includes('清淡')) tastes.push('清淡');
  return { ...profile, tastes };
}

function createApp(config = readConfig(), options = {}) {
  const model = createModelClient(config, options.fetchImpl);
  const cache = new Map();
  const inFlight = new Map();
  const requests = new Map();
  const clientCounts = new Map();

  async function recommendation(state, forcedFallback) {
    const data = engine.analyze(state);
    const candidates = data.visible.slice(0, 15).map((item) => {
      const dish = item.dish;
      return {
        dish_id: dish.id, name: dish.name, main: dish.main,
        ingredients: dish.ingredients, tastes: dish.tastes, cooking: dish.cooking,
        oil: dish.oil, fried: dish.fried, staple: dish.staple, price: dish.price,
        rating: dish.rating, minutes: dish.minutes, rule_score: item.score,
        facts: [...dish.tastes, `做法：${dish.cooking}`, ...(dish.staple ? [`主食：${dish.staple}`] : []), `价格：${dish.price}元`],
      };
    });
    const metadata = {
      candidate_count: data.visible.length,
      excluded: { avoid: data.avoidRemoved.length, budget: data.budgetRemoved.length, history: data.historyRemoved.length },
    };
    if (!candidates.length) {
      return { ...metadata, source: 'rules', fallback_reason: 'no_candidates', picks: [],
        summary: '没有符合忌口、预算和近期主菜限制的候选。', model: null, usage: null };
    }
    const decorate = (picks) => picks.map((pick) => {
      const item = data.visible.find((entry) => entry.dish.id === pick.dish_id);
      const merchant = catalog.MERCHANTS.find((entry) => entry.id === item.dish.merchantId);
      return { ...pick, rule_score: item.score, dish: item.dish, merchant };
    });
    const fallback = (reason) => ({
      ...metadata, source: 'rules', fallback_reason: reason, model: null, usage: null,
      summary: FALLBACK_MESSAGES[reason] || FALLBACK_MESSAGES.upstream_error,
      picks: decorate(candidates.slice(0, 3).map((dish) => ({
        dish_id: dish.dish_id, matched: dish.facts.slice(0, 3),
        reason: `${dish.name}，${dish.tastes.join('、')}口味，${dish.cooking}制${dish.staple ? `并配${dish.staple}` : ''}，价格${dish.price}元；已按你的忌口、预算和近期主菜记录筛选。`,
      }))),
    });
    if (forcedFallback) return fallback(forcedFallback);
    if (!config.apiKey) return fallback('missing_key');
    if (candidates.length <= 3) return fallback('few_candidates');
    try {
      const response = await model.recommend({
        profile: { ...state.profile, avoid: state.profile.avoid.map((id) => catalog.AVOID_OPTIONS.find((item) => item.id === id).label) },
        recent_main_dishes: data.recentDishes.map((entry) => entry.dish.main),
        skipped_dishes: state.skipped, candidates,
      });
      // 候选来自服务端菜单；输出 ID 和匹配属性已重新验证，食材/价格只由服务端补全。
      return {
        ...metadata, source: 'qwen', model: config.model,
        picks: decorate(response.result.picks), summary: response.result.summary,
        usage: response.usage, latency_ms: response.latency_ms, attempts: response.attempts,
        fallback_reason: null,
      };
    } catch (error) {
      console.warn(`[模型兜底] ${error.code || 'upstream_error'}`);
      return fallback(error.code || 'upstream_error');
    }
  }

  async function cachedRecommendation(state) {
    const key = createHash('sha256').update(JSON.stringify(state)).digest('hex');
    const saved = cache.get(key);
    if (saved && saved.expires > Date.now()) return { ...saved.value, cache_hit: true };
    if (inFlight.has(key)) return { ...await inFlight.get(key), cache_hit: true };
    const promise = recommendation(state);
    inFlight.set(key, promise);
    try {
      const value = await promise;
      const transient = value.fallback_reason && !['missing_key', 'few_candidates', 'no_candidates'].includes(value.fallback_reason);
      cache.set(key, { value, expires: Date.now() + (transient ? 5000 : 600000) });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return { ...value, cache_hit: false };
    } finally { inFlight.delete(key); }
  }

  return http.createServer(async (req, res) => {
    let release;
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/api/health') {
        return json(res, 200, { ok: true, configured: Boolean(config.apiKey), model: config.model });
      }
      if (req.method === 'POST' && ['/api/recommend', '/api/preferences', '/api/chat'].includes(pathname)) {
        // 同源写入；不给第三方网页跨域消费模型额度。
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: '请从本站页面发起请求。' });
        const client = req.socket.remoteAddress;
        const now = Date.now();
        const record = requests.get(client);
        const current = record && record.until > now ? record : { count: 0, until: now + 60000 };
        current.count += 1;
        requests.set(client, current);
        if (current.count > 30 || (clientCounts.get(client) || 0) >= 2) {
          return json(res, 429, { error: '操作太快，请稍后重试。' });
        }
        if (requests.size > 1000) {
          for (const [ip, item] of requests) if (item.until <= now) requests.delete(ip);
        }
        clientCounts.set(client, (clientCounts.get(client) || 0) + 1);
        release = () => {
          const count = (clientCounts.get(client) || 1) - 1;
          if (count) clientCounts.set(client, count); else clientCounts.delete(client);
        };
        const input = await readJson(req);
        let state;
        try { state = engine.normalizeRequest(input); }
        catch (error) { return json(res, 400, { error: error.message }); }
        const requestId = randomUUID();
        if (pathname === '/api/preferences' || pathname === '/api/chat') {
          if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 500) {
            return json(res, 400, { error: '请填写 1 至 500 字的午饭偏好。' });
          }
          const isChat = pathname === '/api/chat';
          if (!config.apiKey) {
            if (!isChat) return json(res, 503, { error: '尚未配置百炼 API Key，请先用设置选项调整口味。', code: 'missing_key' });
            return json(res, 200, {
              ...await cachedRecommendation(state), request_id: requestId,
              profile: state.profile, profile_applied: false,
              reply: '尚未配置百炼 API Key，这句话还没有解析。当前推荐仍按已设置的口味档案生成；请先用设置选项调整偏好。',
            });
          }
          const messages = input.messages ?? [];
          if (!Array.isArray(messages) || messages.length > 8 || !messages.every((item) =>
            item && ['user', 'assistant'].includes(item.role) &&
            typeof item.content === 'string' && item.content.length <= 500)) {
            return json(res, 400, { error: '对话上下文最多 8 条，每条最多 500 字。' });
          }
          try {
            const response = await model.parsePreferences({
              profile: state.profile, text: input.text.trim(), avoid_options: catalog.AVOID_OPTIONS,
              supported_staples: engine.STAPLES, messages,
            }, catalog, engine);
            const { message, unsupported_avoid, needs_clarification, ...parsedProfile } = response.result;
            // 口味意图在服务端兜底落实；忌口、预算、主食仍按解析结果和原档案处理。
            const profile = preserveAvoid(applyTasteIntent(parsedProfile, input.text.trim()), state.profile, input.text);
            if (unsupported_avoid.length || needs_clarification) {
              const code = unsupported_avoid.length ? 'unsupported_avoid' : 'clarification_required';
              if (!isChat) return json(res, 422, { error: message, code, unsupported_avoid });
              return json(res, 200, {
                request_id: requestId, profile: state.profile, profile_applied: false,
                picks: [], summary: message, reply: message, source: 'qwen',
                model: config.model, fallback_reason: code, usage: response.usage,
              });
            }
            if (!isChat) return json(res, 200, { request_id: requestId, profile, message, usage: response.usage });
            const result = await cachedRecommendation(engine.normalizeRequest({ ...state, profile }));
            return json(res, 200, {
              ...result, request_id: requestId, profile, profile_applied: true,
              reply: `${message} ${result.summary}`, preference_usage: response.usage,
            });
          } catch (error) {
            if (isChat) return json(res, 200, {
              ...await recommendation(state, error.code || 'invalid_output'), request_id: requestId, profile: state.profile,
              profile_applied: false,
              reply: '这句话暂时无法解析，原有口味档案已保留。请用设置选项调整后再推荐。',
              fallback_reason: error.code || 'invalid_output',
            });
            return json(res, 502, { error: FALLBACK_MESSAGES[error.code] || '偏好解析暂时不可用，请用下方选项设置。' });
          }
        }
        const started = Date.now();
        const result = await cachedRecommendation(state);
        return json(res, 200, { ...result, request_id: requestId, request_latency_ms: Date.now() - started });
      }
      const file = STATIC_FILES.get(pathname);
      if (req.method === 'GET' && file) {
        const content = await fs.readFile(path.join(ROOT, file[0]));
        res.writeHead(200, {
          'Content-Type': file[1], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://copilot-cn.bytedance.net; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        });
        return res.end(content);
      }
      json(res, 404, { error: '没有找到该页面或接口。' });
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, error.status || 500, { error: error.status ? error.message : '服务暂时不可用。' });
    } finally { release?.(); }
  });
}

if (require.main === module) {
  const config = readConfig();
  createApp(config).listen(config.port, config.host, () => {
    console.log(`午饭搭子已启动：http://${config.host}:${config.port}`);
    console.log(config.apiKey ? `模型：${config.model}（服务端配置已读取）` : '尚未配置 API Key：规则推荐可用，配置后重启即可启用 Qwen。');
  });
}
module.exports = { createApp, readConfig, engine, applyTasteIntent };
