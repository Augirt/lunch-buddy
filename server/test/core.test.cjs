const { test } = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../../data.js');
const engine = require('../recommend-core.cjs')(catalog);
const base = extra => engine.normalizeRequest({ profile: { ...catalog.DEFAULT_PROFILE, tastes: [], avoid: [], budget: 60 },
  history: [], date_key: '2026-11-28', ...extra });

test('[defect-probing] 仅猪肉忌口必须排除肥肠面', () => {
  const state = engine.normalizeRequest({ profile: { ...catalog.DEFAULT_PROFILE, avoid: ['pork'] }, history: [] });
  assert.equal(engine.analyze(state).visible.some(item => item.dish.id === 'd15'), false);
});

test('全菜单逐项忌口独立检查，浏览器与Node共用相同实现', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../recommend-core.js'), 'utf8'), sandbox);
  const browser = sandbox.createLunchEngine(catalog);
  const protein = { pork: '猪肉', beef: '牛肉', seafood: '鱼虾' };
  for (const option of catalog.AVOID_OPTIONS) {
    const state = base({ profile: { ...catalog.DEFAULT_PROFILE, avoid: [option.id], budget: 60 } });
    for (const dish of catalog.DISHES) {
      const expected = dish.protein === protein[option.id] ||
        dish.ingredients.some(i => option.terms.some(t => i.includes(t))) ||
        option.id === 'pork' && dish.ingredients.some(i => /肥肠|肋排/.test(i));
      assert.equal(engine.dishMatchesAvoid(dish, [option.id]), expected, `${option.id}/${dish.id}`);
    }
    assert.deepEqual([...browser.analyze(browser.normalizeRequest(state)).visible].map(i => i.dish.id),
      engine.analyze(state).visible.map(i => i.dish.id));
  }
});

test('当天硬条件、预算、skipped顺序互斥，软主食不做排除', () => {
  const state = base({ constraints: { dateKey: '2026-11-28', noSpicy: true, stapleType: '米饭', maxMinutes: 30 }, skipped: ['d4'] });
  const data = engine.analyze(state);
  assert.ok(data.visible.length > 0);
  for (const item of data.visible) {
    assert.ok(!item.dish.tastes.some(t => /辣/.test(t)));
    assert.ok(item.dish.staple.includes('饭'));
    assert.ok(item.dish.minutes <= 30);
    assert.notEqual(item.dish.id, 'd4');
  }
  assert.equal(data.counts.total, ['closed', 'avoid', 'budget', 'history', 'constraints', 'skipped', 'eligible']
    .reduce((sum, key) => sum + data.counts[key], 0));
  assert.ok(engine.analyze(base({ profile: { ...state.profile, staplePreference: '米饭' } })).visible.some(i => /面|粉/.test(i.dish.staple)));
});

test('真实日期三日边界和过期当天约束', () => {
  for (const [date, excluded] of [['2026-11-28', true], ['2026-11-27', true], ['2026-11-26', true], ['2026-11-25', false]]) {
    const data = engine.analyze(base({ history: [{ dishId: 'd1', date_key: date }] }));
    assert.equal(data.visible.some(i => i.dish.id === 'd1'), !excluded);
  }
  const state = base({ constraints: { dateKey: '2026-11-27', noSpicy: true },
    day_preferences: { dateKey: '2026-11-27', budget: 15 } });
  assert.equal(state.constraints.noSpicy, false);
  assert.equal(state.day_preferences, null);
});

test('未知自定义忌口阻断，已标注食材正常过滤，输入不可越界', () => {
  assert.deepEqual(engine.analyze(base({ profile: { ...catalog.DEFAULT_PROFILE, customAvoid: ['芝麻'] } })).unsupported_avoid, ['芝麻']);
  const data = engine.analyze(base({ profile: { ...catalog.DEFAULT_PROFILE, avoid: [], customAvoid: ['鸡蛋'] } }));
  assert.ok(data.visible.every(i => !i.dish.ingredients.some(t => t.includes('鸡蛋'))));
  assert.throws(() => base({ constraints: { maxMinutes: 0 } }));
  assert.throws(() => base({ day_preferences: { dateKey: '2026-11-28', budget: 1 } }));
  assert.throws(() => base({ profile: { ...catalog.DEFAULT_PROFILE, customAvoid: ['x'.repeat(31)] } }));
});

test('学习仅取真实日期最终选择，达到门槛有0至6软加分且不救回忌口', () => {
  const events = Array.from({ length: 5 }, (_, i) => ({ event_id: `e${i}`, dish_id: 'd4',
    date_key: `2026-11-${28 - i}`, chosen_at: `2026-11-${28 - i}T04:00:00.000Z`, source: 'real' }));
  assert.equal(engine.learnPreferences(events.slice(0, 4), '2026-11-28').active, false);
  assert.equal(engine.learnPreferences(events, '2026-11-28').active, true);
  assert.equal(engine.learnPreferences(events.map(e => ({ ...e, source: 'demo' })), '2026-11-28').active, false);
  assert.equal(engine.learnPreferences(events, '2026-11-28', false).reason, 'paused');
  const state = base({ selection_events: events });
  const data = engine.analyze(state);
  const learned = data.visible.find(i => i.dish.id === 'd4');
  assert.ok(learned.learned_bonus > 0 && learned.learned_bonus <= 6);
  assert.equal(learned.rank_score, learned.score + learned.learned_bonus);
  assert.equal(engine.analyze(base({ ...state, profile: { ...state.profile, avoid: ['seafood'] } })).visible.some(i => i.dish.id === 'd4'), false);
  const overwritten = [...events, { ...events[0], event_id: 'later', dish_id: 'd1', chosen_at: '2026-11-28T05:00:00.000Z' }];
  assert.equal(engine.learnPreferences(overwritten, '2026-11-28').counts.protein['鱼虾'], 4);
  assert.equal(engine.learnPreferences(overwritten, '2026-11-28').selection_count, 5);
});
test('目录类型和关联有效，全部主菜覆盖三日去重边界', () => {
  assert.equal(new Set(catalog.DISHES.map(d => d.id)).size, catalog.DISHES.length);
  for (const dish of catalog.DISHES) {
    assert.ok(catalog.MERCHANTS.some(m => m.id === dish.merchantId));
    assert.ok(Number.isFinite(dish.price) && dish.price > 0);
    assert.ok(Number.isFinite(dish.minutes) && dish.minutes > 0);
    assert.ok([1, 2, 3].includes(dish.oil));
    assert.equal(typeof dish.fried, 'boolean');
    for (let rel = 0; rel <= 3; rel++) {
      const state = base({ history: [{ dishId: dish.id, dayIndex: -rel }] });
      const data = engine.analyze(state);
      const same = data.visible.some(i => i.dish.main === dish.main);
      const open = catalog.MERCHANTS.find(m => m.id === dish.merchantId).open;
      assert.equal(same, rel === 3 && open, `${dish.id}/${rel}`);
    }
  }
});
