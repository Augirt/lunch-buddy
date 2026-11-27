/* 真实账号联调：使用本地临时服务，不影响正在运行的 Demo。 */
const { once } = require('node:events');
const { createApp, readConfig } = require('./index.cjs');
const catalog = require('../data.js');

async function main() {
  const config = readConfig();
  if (!config.apiKey) throw new Error('请先配置 server/.env 中的 DASHSCOPE_API_KEY。');
  const redact = (value) => String(value).split(config.apiKey).join('[密钥已隐藏]')
    .replace(/sk-[A-Za-z0-9._-]+/g, '[密钥已隐藏]');
  const diagnostics = [];
  const upstreamFetch = async (url, options) => {
    const result = await fetch(url, options);
    if (!result.ok) {
      let body;
      try { body = await result.clone().json(); } catch { body = {}; }
      diagnostics.push({
        status: result.status,
        code: redact(body.error?.code || body.code || ''),
        message: redact(body.error?.message || body.message || '').slice(0, 300),
      });
    } else {
      const raw = await result.clone().json();
      const choice = raw?.choices?.[0];
      diagnostics.push({
        status: result.status, finish_reason: choice?.finish_reason,
        content_type: typeof choice?.message?.content,
        content_length: choice?.message?.content?.length || 0,
        ...(process.argv.includes('--debug') ? {
          content_sample: redact(choice?.message?.content || '').slice(0, 1800),
        } : {}),
      });
    }
    return result;
  };
  if (process.argv.includes('--direct')) {
    const started = Date.now();
    const result = await upstreamFetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model, enable_thinking: false, max_tokens: config.maxTokens, temperature: 0.2,
        messages: [
          { role: 'system', content: '你是中文午饭助手，按指定 JSON 结构回复。' },
          { role: 'user', content: '今天推荐番茄牛腩饭，用一句话说明理由，dish_id 为 d1。' },
        ],
        response_format: { type: 'json_schema', json_schema: {
          name: 'connectivity_check', strict: true,
          schema: {
            type: 'object', additionalProperties: false, required: ['dish_id', 'reason'],
            properties: { dish_id: { type: 'string', enum: ['d1'] }, reason: { type: 'string' } },
          },
        } },
      }),
    });
    console.log(JSON.stringify({ status: result.status, model: config.model, latency_ms: Date.now() - started, diagnostics }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const server = createApp(config, { fetchImpl: upstreamFetch });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const chat = process.argv.includes('--chat');
    const textArg = process.argv.find((arg) => arg.startsWith('--text='));
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/${chat ? 'chat' : 'recommend'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: catalog.DEFAULT_PROFILE, history: catalog.SEED_HISTORY, todayIndex: 0, skipped: [],
        ...(chat ? { text: textArg ? textArg.slice('--text='.length) : '不吃花生，今天想吃米饭，预算30元' } : {}),
      }),
    });
    const value = await result.json();
    console.log(JSON.stringify({
      source: value.source, model: value.model, fallback_reason: value.fallback_reason,
      dish_ids: value.picks?.map((pick) => pick.dish_id), usage: value.usage,
      latency_ms: value.latency_ms, diagnostics,
      ...(chat ? { profile_applied: value.profile_applied, profile: value.profile, reply: value.reply, preference_usage: value.preference_usage } : {}),
    }, null, 2));
    if (!result.ok || value.source !== 'qwen' || (chat && !value.profile_applied)) process.exitCode = 1;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch(() => {
  console.error('真实调用未成功，请核对本地配置、网络和百炼模型权限。');
  process.exitCode = 1;
});
