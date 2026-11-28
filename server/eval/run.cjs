/* 人工标注的场景；默认离线，--live 才调用真实模型。 */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { createApp, readConfig, engine } = require('../index.cjs');
const { inspectIntent } = require('../intent.cjs');
const catalog = require('../../data.js');
const get = (object, key) => key.split('.').reduce((v, k) => v?.[k], object);
const flags = new Map(process.argv.slice(2).map(arg => arg.split('=')));
const live = flags.has('--live');
const maxCalls = Number(flags.get('--max-calls') || 30);
if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 30) throw new Error('max-calls需为1至30。');
function initial() {
  return { profile: { ...catalog.DEFAULT_PROFILE, avoid: ['pork'], tastes: ['咸鲜', '微辣'] },
    history: [], date_key: engine.dateKey() };
}
function compare(result, expected) {
  return Object.entries(expected).flatMap(([key, value]) => {
    const actual = key === 'clarification' ? Boolean(result.needs_clarification) :
      key === 'change_fields' ? [...new Set((result.changes || []).map(c => c.field))].sort() : get(result, key);
    return JSON.stringify(actual) === JSON.stringify(value) ? [] : [{ key, expected: value, actual }];
  });
}
async function main() {
  const selectedIds = flags.get('--only')?.split(',');
  const scenarios = (await fs.readFile(path.join(__dirname, 'scenarios.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    .filter(scenario => !selectedIds || selectedIds.includes(scenario.id));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lunch-agent-eval-'));
  const resultsPath = path.join(directory, 'results.jsonl');
  const upstreamPath = path.join(directory, 'model-calls.jsonl');
  let server, calls = 0, url;
  if (live) {
    // 仅进程内读取现有配置，不修改.env，也不输出密钥。
    try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const config = readConfig({ ...process.env, AGENT_V2_ENABLED: 'true' });
    server = createApp(config, { fetchImpl: async (endpoint, request) => {
      if (calls >= maxCalls) throw Object.assign(new Error('真实调用已达上限。'), { code: 'call_limit' });
      calls++;
      const phase = JSON.parse(request.body).response_format.json_schema.name;
      const started = Date.now();
      try {
        const response = await fetch(endpoint, request);
        let raw;
        try { raw = await response.clone().json(); } catch { raw = {}; }
        await fs.appendFile(upstreamPath, JSON.stringify({ call: calls, phase, status: response.status,
          latency_ms: Date.now() - started, supplier_request_id: raw?.id || null,
          finish_reason: raw?.choices?.[0]?.finish_reason || null, usage: raw?.usage || null,
          error_code: raw?.error?.code || raw?.code || null }) + '\n');
        return response;
      } catch (error) {
        await fs.appendFile(upstreamPath, JSON.stringify({ call: calls, phase, latency_ms: Date.now() - started,
          error: ['TimeoutError', 'AbortError'].includes(error.name) ? error.name : 'network_error', usage: 'unknown' }) + '\n');
        throw error;
      }
    } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    url = `http://127.0.0.1:${server.address().port}`;
  }
  const records = [];
  try {
    for (const scenario of scenarios) {
      if (live && maxCalls - calls < 3) {
        records.push({ id: scenario.id, status: 'not_run', reason: 'call_budget_reserved' });
        continue;
      }
      const input = initial();
      const state = engine.normalizeRequest(input);
      const pending = scenario.pending_text ? inspectIntent(scenario.pending_text, state).clarification : null;
      const started = Date.now();
      let result;
      if (live) {
        const response = await fetch(url + '/api/chat', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, text: scenario.text, pending_clarification: pending }) });
        result = await response.json();
      } else result = inspectIntent(scenario.text, state, pending);
      // API同时提供有效profile和persistent_profile；标注的profile表示长期档案。
      const assess = live ? { ...result, profile: result.persistent_profile || result.profile,
        out_of_scope: result.fallback_reason === 'out_of_scope' } : result;
      const errors = compare(assess, { ...scenario.expected, ...(live ? scenario.expected_api : {}) });
      if (live && !scenario.expected.clarification && !scenario.expected.out_of_scope &&
        result.telemetry?.stages.parse.status !== 'model') errors.push({ key: 'parse_source', actual: result.telemetry?.stages.parse.status });
      if (live && result.picks?.length) {
        const validState = engine.normalizeRequest({ ...input, profile: assess.profile,
          day_preferences: result.day_preferences, constraints: result.constraints,
          persistent_constraints: result.persistent_constraints });
        const eligible = new Set(engine.analyze(validState).visible.map(i => i.dish.id));
        if (result.picks.some(p => !eligible.has(p.dish_id))) errors.push({ key: 'hard_constraint_violation' });
      }
      const record = { id: scenario.id, status: errors.length ? 'failed' : 'passed', errors, latency_ms: Date.now() - started, result };
      records.push(record);
      await fs.appendFile(resultsPath, JSON.stringify(record) + '\n');
      console.log(JSON.stringify({ id: scenario.id, status: record.status, request_id: result.request_id || null,
        phase: result.telemetry?.stages || null, source: result.source || 'offline', fallback_reason: result.fallback_reason || null,
        model_calls: result.telemetry?.model_calls || 0, usage: result.telemetry?.actual_usage || null,
        latency_ms: record.latency_ms, changes: result.changes || [], dish_ids: result.picks?.map(p => p.dish_id) || [], errors }));
    }
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
  const executed = records.filter(r => r.status !== 'not_run');
  const latencies = executed.filter(r => r.result?.telemetry?.stages.parse.status === 'model').map(r => r.latency_ms).sort((a, b) => a - b);
  const summary = { mode: live ? 'live' : 'offline', total: records.length, executed: executed.length,
    passed: records.filter(r => r.status === 'passed').length, failed: records.filter(r => r.status === 'failed').length,
    model_calls: calls, model_path_samples: latencies.length, p95_ms: latencies[Math.ceil(latencies.length * 0.95) - 1] ?? null,
    directory, results_path: resultsPath, upstream_path: live ? upstreamPath : null };
  await fs.writeFile(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  if (summary.failed) process.exitCode = 1;
}
main().catch(error => { console.error(error.code || error.name || 'eval_failed'); process.exitCode = 1; });
