/* 模拟外卖首页 + 弹窗午饭助手。模型请求统一发给 BFF；不可用时明确回退规则演示。 */
'use strict';
/* BEGIN GENERATED SHARED ENGINE */
/* Node 和浏览器共用；不依赖网络、存储或 DOM。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory;
  else root.createLunchEngine = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createLunchEngine(catalog) {
  const { MERCHANTS, DISHES, TASTE_OPTIONS, AVOID_OPTIONS, DEFAULT_PROFILE } = catalog;
  const STAPLES = ['不限', ...new Set(DISHES.map((dish) => dish.staple).filter(Boolean))];
  const dishById = new Map(DISHES.map((dish) => [dish.id, dish]));
  const avoidIds = new Set(AVOID_OPTIONS.map((option) => option.id));
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validList = (value, allowed, max) =>
    Array.isArray(value) && value.length <= max && value.every((item) => allowed.has(item));
  const dateKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const daysBetween = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;
  const aliases = { pork: ['肋排', '肥肠', '猪肝'], seafood: ['鱼虾'], beef: [] };
  const proteins = { pork: '猪肉', beef: '牛肉', seafood: '鱼虾' };
  function avoidTerms(id) {
    return [...(AVOID_OPTIONS.find(option => option.id === id)?.terms || []), ...(aliases[id] || [])];
  }
  function customTerms(term) {
    const option = AVOID_OPTIONS.find(option => [option.label, ...avoidTerms(option.id)].includes(term));
    return option ? avoidTerms(option.id) : ({
      鸡肉: ['鸡肉', '鸡腿', '鸡胸', '鸡翅'], 辣椒: ['辣椒', '剁椒', '小米椒', '干辣椒'],
    }[term] || [term]);
  }
  function unsupportedAvoid(terms) {
    return terms.filter(term => !DISHES.some(dish =>
      dish.ingredients.some(ingredient => customTerms(term).some(word => ingredient.includes(word)))));
  }
  function normalizeConstraints(input = {}, fallbackDate = dateKey()) {
    if (!object(input)) throw new Error('当天约束格式不正确。');
    const constraints = {
      noSpicy: input.noSpicy ?? false, stapleType: input.stapleType ?? '不限',
      maxMinutes: input.maxMinutes ?? null, dateKey: input.dateKey ?? fallbackDate,
      cuisines: input.cuisines ?? [], proteins: input.proteins ?? [],
      explicit: input.explicit ?? ['noSpicy', 'stapleType', 'maxMinutes', 'cuisines', 'proteins'].filter(key => input[key] !== undefined),
    };
    if (typeof constraints.noSpicy !== 'boolean' || !['不限', '米饭', '面食'].includes(constraints.stapleType) ||
      !(constraints.maxMinutes === null || Number.isInteger(constraints.maxMinutes) && constraints.maxMinutes >= 1 && constraints.maxMinutes <= 120) ||
      !validDate(constraints.dateKey) ||
      !validList(constraints.cuisines, new Set(DISHES.map(d => d.cuisine)), 20) ||
      !validList(constraints.proteins, new Set(DISHES.map(d => d.protein)), 20) ||
      !validList(constraints.explicit, new Set(['noSpicy', 'stapleType', 'maxMinutes', 'cuisines', 'proteins']), 5)) {
      throw new Error('当天约束值不正确。');
    }
    return { ...constraints, cuisines: [...new Set(constraints.cuisines)], proteins: [...new Set(constraints.proteins)] };
  }
  function normalizeEvents(events = [], today = dateKey()) {
    if (!Array.isArray(events) || events.length > 60 || !events.every(event =>
      object(event) && typeof event.event_id === 'string' && event.event_id.length > 0 && event.event_id.length <= 100 &&
      dishById.has(event.dish_id) && validDate(event.date_key) &&
      ['real', 'demo', 'legacy'].includes(event.source) &&
      typeof event.chosen_at === 'string' && Number.isFinite(Date.parse(event.chosen_at)))) {
      throw new Error('选餐事件格式不正确，最多60项。');
    }
    const seen = new Set();
    return events.filter(event => {
      if (seen.has(event.event_id)) return false;
      seen.add(event.event_id);
      return event.source === 'real' && dateKey(new Date(event.chosen_at)) === event.date_key &&
        daysBetween(today, event.date_key) >= 0 && daysBetween(today, event.date_key) < 30;
    }).map(({ event_id, dish_id, date_key, source, chosen_at }) => ({ event_id, dish_id, date_key, source, chosen_at }));
  }
  function learnPreferences(events = [], today = dateKey(), enabled = true) {
    const accepted = normalizeEvents(events, today);
    // 同日期只取最终确认选择。event_id 防重复，时间顺序与上传顺序无关。
    const final = new Map();
    for (const event of accepted) {
      if (!final.has(event.date_key) || Date.parse(event.chosen_at) > Date.parse(final.get(event.date_key).chosen_at)) {
        final.set(event.date_key, event);
      }
    }
    const selections = [...final.values()];
    const active = enabled && selections.length >= 5 && final.size >= 3;
    const dimensions = ['tastes', 'cooking', 'staple', 'cuisine', 'protein'];
    const frequencies = Object.fromEntries(dimensions.map(key => [key, {}]));
    const counts = Object.fromEntries(dimensions.map(key => [key, {}]));
    let totalWeight = 0;
    for (const event of selections) {
      const dish = dishById.get(event.dish_id);
      const weight = 0.5 ** (daysBetween(today, event.date_key) / 14);
      totalWeight += weight;
      for (const key of dimensions) for (const value of new Set(Array.isArray(dish[key]) ? dish[key] : [dish[key]])) {
        if (!value) continue;
        frequencies[key][value] = (frequencies[key][value] || 0) + weight;
        counts[key][value] = (counts[key][value] || 0) + 1;
      }
    }
    const tendencies = Object.fromEntries(dimensions.map(key => [key, Object.fromEntries(
      Object.entries(frequencies[key]).map(([value, weight]) => [value, Math.max(0, 2 * weight / totalWeight - 1)]))]));
    return { active, reason: !enabled ? 'paused' : active ? null : 'insufficient_records',
      selection_count: selections.length, date_count: final.size, tendencies, counts, window_days: 30 };
  }

  function normalizeRequest(input) {
    if (!object(input) || !object(input.profile)) throw new Error('需要提供口味档案 profile。');
    const profile = { ...DEFAULT_PROFILE, staplePreference: '不限', ...input.profile };
    if (!validList(profile.tastes, new Set(TASTE_OPTIONS), TASTE_OPTIONS.length)) {
      throw new Error('口味选项不正确。');
    }
    if (!validList(profile.avoid, avoidIds, AVOID_OPTIONS.length)) throw new Error('忌口选项不正确。');
    if (typeof profile.healthy !== 'boolean' || typeof profile.staplePriority !== 'boolean') {
      throw new Error('健康和主食偏好必须是布尔值。');
    }
    if (!Number.isFinite(profile.budget) || profile.budget < 15 || profile.budget > 60) {
      throw new Error('每餐预算需在 15 至 60 元之间。');
    }
    if (!STAPLES.includes(profile.staplePreference)) throw new Error('主食偏好不正确。');
    const customAvoid = profile.customAvoid ?? [];
    if (!Array.isArray(customAvoid) || customAvoid.length > 20 ||
      !customAvoid.every(term => typeof term === 'string' && term.trim().length > 0 && term.length <= 30)) {
      throw new Error('自定义忌口最多20项，每项1至30字。');
    }
    const todayIndex = input.todayIndex ?? 0;
    if (!Number.isInteger(todayIndex) || todayIndex < 0 || todayIndex > 10000) {
      throw new Error('演示日期不正确。');
    }
    const history = input.history ?? [];
    if (!Array.isArray(history) || history.length > 30 || !history.every((entry) =>
      object(entry) && dishById.has(entry.dishId) &&
      (entry.date_key !== undefined ? validDate(entry.date_key) : Number.isInteger(entry.dayIndex) &&
      entry.dayIndex >= -10000 && entry.dayIndex <= todayIndex))) {
      throw new Error('午饭记忆格式不正确。');
    }
    const skipped = input.skipped ?? [];
    if (!validList(skipped, new Set(dishById.keys()), DISHES.length)) {
      throw new Error('换掉的菜品 ID 不正确。');
    }
    const skipStats = { cuisines: {}, proteins: {} };
    // 从换菜记录重建反馈，不信任客户端提交的分数或权重。
    for (const id of new Set(skipped)) {
      const dish = dishById.get(id);
      skipStats.cuisines[dish.cuisine] = (skipStats.cuisines[dish.cuisine] || 0) + 1;
      skipStats.proteins[dish.protein] = (skipStats.proteins[dish.protein] || 0) + 1;
    }
    const constraints = normalizeConstraints(input.constraints ?? input.day ?? {});
    // 日期已过期的当天强条件不继续生效；真实日期由前端随请求推进。
    const currentDate = input.date_key ?? dateKey();
    if (!validDate(currentDate)) throw new Error('当前日期不正确。');
    const effectiveConstraints = constraints.dateKey === currentDate ? constraints : normalizeConstraints({}, currentDate);
    const events = normalizeEvents(input.selection_events, currentDate);
    const persistentConstraints = normalizeConstraints({ ...(input.persistent_constraints || {}), dateKey: currentDate }, currentDate);
    let dayPreferences = null;
    if (object(input.day_preferences) && input.day_preferences.dateKey === currentDate) {
      dayPreferences = { dateKey: currentDate };
      const merged = { ...profile, ...input.day_preferences };
      if (!validList(merged.tastes, new Set(TASTE_OPTIONS), TASTE_OPTIONS.length) ||
        !Number.isFinite(merged.budget) || merged.budget < 15 || merged.budget > 60 ||
        !STAPLES.includes(merged.staplePreference) || typeof merged.healthy !== 'boolean' ||
        typeof merged.staplePriority !== 'boolean') throw new Error('当天软偏好值不正确。');
      for (const key of ['tastes', 'healthy', 'staplePriority', 'staplePreference', 'budget']) {
        if (input.day_preferences[key] !== undefined) dayPreferences[key] = input.day_preferences[key];
      }
    }
    if (input.learning_enabled !== undefined && typeof input.learning_enabled !== 'boolean') throw new Error('学习开关不正确。');
    return {
      profile: {
        tastes: [...new Set(profile.tastes)], avoid: [...new Set(profile.avoid)],
        healthy: profile.healthy, staplePriority: profile.staplePriority,
        staplePreference: profile.staplePreference, budget: profile.budget,
        customAvoid: [...new Set(customAvoid.map(term => term.trim()))],
      },
      history: history.map(({ dishId, dayIndex, date_key }) => date_key ? ({ dishId, date_key }) : ({ dishId, dayIndex })),
      todayIndex, skipped: [...new Set(skipped)], skipStats,
      constraints: effectiveConstraints, date_key: currentDate, selection_events: events,
      persistent_constraints: persistentConstraints,
      learning_enabled: input.learning_enabled ?? true,
      day_preferences: dayPreferences,
    };
  }

  function dishMatchesAvoid(dish, ids, customAvoid = []) {
    if (ids.some(id => proteins[id] && dish.protein === proteins[id])) return true;
    const terms = [...ids.flatMap(avoidTerms), ...customAvoid.flatMap(customTerms)];
    return dish.ingredients.some((ingredient) => terms.some((term) => ingredient.includes(term)));
  }

  function scoreDish(dish, recentDishes, state) {
    const profile = { ...state.profile, ...state.day_preferences };
    const matchedTastes = dish.tastes.filter((taste) => profile.tastes.includes(taste));
    const tasteRatio = dish.tastes.length ? matchedTastes.length / dish.tastes.length : 0;
    let taste = 28 * tasteRatio + Math.min(6, matchedTastes.length * 3);
    if (dish.tastes.includes('重辣') && !profile.tastes.includes('重辣')) taste = Math.max(0, taste - 6);
    let health = 11;
    if (profile.healthy) {
      const oilBase = dish.oil === 1 ? 22 : dish.oil === 2 ? 14 : 6;
      const bonus = ['蒸', '煮', '炖', '烤'].includes(dish.cooking) ? 2 : 0;
      health = Math.max(0, Math.min(22, oilBase + bonus - (dish.fried ? 6 : 0)));
    }
    let staple = dish.staple ? 14 : profile.staplePriority ? 0 : 8;
    if (profile.staplePreference && profile.staplePreference !== '不限') {
      staple = dish.staple === profile.staplePreference ? 14 : dish.staple ? 5 : 0;
    }
    const quality = Math.min(14, Math.max(0, (dish.rating - 4.2) * 20) + Math.min(4, dish.monthly / 300));
    const speed = dish.minutes <= 25 ? 8 : dish.minutes <= 32 ? 7 : dish.minutes <= 40 ? 5 : 3;
    const sameProtein = recentDishes.some((entry) => entry.dish.protein === dish.protein);
    const sameCuisine = recentDishes.some((entry) => entry.dish.cuisine === dish.cuisine);
    let variety = 8 - (sameProtein ? 6 : 0) - (sameCuisine ? 3 : 0);
    variety -= (state.skipStats?.cuisines?.[dish.cuisine] || 0) * 3;
    variety -= (state.skipStats?.proteins?.[dish.protein] || 0) * 2;
    variety = Math.max(0, variety);
    const parts = { taste, health, staple, quality, speed, variety };
    const total = Object.values(parts).reduce((sum, value) => sum + value, 0);
    const learning = state.learning;
    const dimensions = ['tastes', 'cooking', 'staple', 'cuisine', 'protein'];
    const learnedParts = {};
    for (const key of dimensions) {
      const values = (Array.isArray(dish[key]) ? dish[key] : [dish[key]]).filter(Boolean);
      const conflict = key === 'tastes' && profile.tastes.length && !values.some(value => profile.tastes.includes(value)) ||
        key === 'cooking' && profile.healthy && (dish.oil > 1 || dish.fried) ||
        key === 'staple' && profile.staplePreference !== '不限' && dish.staple !== profile.staplePreference;
      learnedParts[key] = learning?.active && !conflict && values.length
        ? values.reduce((sum, value) => sum + (learning.tendencies[key][value] || 0), 0) / values.length : 0;
    }
    const learned_bonus = 6 * Object.values(learnedParts).reduce((a, b) => a + b, 0) / 5;
    const score = Math.round(total);
    return { dish, score, total, parts, matchedTastes, sameProtein, learned_bonus, learned_parts: learnedParts,
      rank_score: score + learned_bonus };
  }

  function analyze(state) {
    const profile = { ...state.profile, ...state.day_preferences };
    state = { ...state, learning: learnPreferences(state.selection_events, state.date_key, state.learning_enabled) };
    const openMerchants = MERCHANTS.filter((merchant) => merchant.open);
    const openIds = new Set(openMerchants.map((merchant) => merchant.id));
    const recall = DISHES.filter((dish) => openIds.has(dish.merchantId));
    const avoidRemoved = recall.filter((dish) => dishMatchesAvoid(dish, state.profile.avoid, state.profile.customAvoid));
    const afterAvoid = recall.filter((dish) => !avoidRemoved.includes(dish));
    const budgetRemoved = afterAvoid.filter((dish) => dish.price > profile.budget);
    const afterBudget = afterAvoid.filter((dish) => dish.price <= profile.budget);
    const recentDishes = state.history
      .map((entry) => ({ ...entry, rel: entry.date_key ? daysBetween(state.date_key, entry.date_key) : state.todayIndex - entry.dayIndex, dish: dishById.get(entry.dishId) }))
      .filter((entry) => entry.dish && entry.rel >= 0 && entry.rel <= 2)
      .sort((a, b) => a.rel - b.rel);
    const historyRemoved = afterBudget.filter((dish) =>
      recentDishes.some((entry) => entry.dish.main === dish.main));
    const afterHistory = afterBudget.filter((dish) => !historyRemoved.includes(dish));
    const constraintRemoved = afterHistory.filter(dish => {
      const c = { ...state.persistent_constraints };
      for (const key of state.constraints.explicit) c[key] = state.constraints[key];
      return c.noSpicy && dish.tastes.some(taste => ['微辣', '重辣'].includes(taste)) ||
        c.stapleType === '米饭' && !dish.staple?.includes('饭') ||
        c.stapleType === '面食' && !/面|粉|乌冬|馍/.test(dish.staple || '') ||
        c.maxMinutes !== null && dish.minutes > c.maxMinutes ||
        c.cuisines.length && !c.cuisines.includes(dish.cuisine) ||
        c.proteins.length && !c.proteins.includes(dish.protein);
    });
    const afterConstraints = afterHistory.filter(dish => !constraintRemoved.includes(dish));
    const scored = afterConstraints.map((dish) => scoreDish(dish, recentDishes, state))
      .sort((a, b) => b.rank_score - a.rank_score || b.total - a.total || b.dish.rating - a.dish.rating || a.dish.price - b.dish.price);
    const visible = scored.filter((item) => !state.skipped.includes(item.dish.id));
    return {
      openMerchants, closedMerchants: MERCHANTS.length - openMerchants.length, recall,
      avoidRemoved, budgetRemoved, afterAvoid, afterBudget, recentDishes,
      historyRemoved, afterHistory, scored, visible, skippedCount: state.skipped.length,
      constraintRemoved, afterConstraints, unsupported_avoid: unsupportedAvoid(state.profile.customAvoid),
      learning: state.learning,
      counts: { total: DISHES.length, closed: DISHES.length - recall.length, open: recall.length,
        avoid: avoidRemoved.length, budget: budgetRemoved.length, history: historyRemoved.length,
        constraints: constraintRemoved.length, skipped: scored.length - visible.length, eligible: visible.length },
    };
  }
  return { normalizeRequest, analyze, scoreDish, dishMatchesAvoid, STAPLES, normalizeConstraints,
    unsupportedAvoid, customTerms, normalizeEvents, learnPreferences, dateKey, validDate, daysBetween };
});
/* END GENERATED SHARED ENGINE */
const $ = (selector, root = document) => root.querySelector(selector);
const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const getDish = id => DISHES.find(d => d.id === id);
const getMerchant = id => MERCHANTS.find(m => m.id === id);
const STORAGE_KEY = 'lunch-buddy-state-v2';
const LEGACY_STORAGE_KEY = 'lunch-buddy-state-v1';
const lunchEngine = createLunchEngine({ MERCHANTS, DISHES, TASTE_OPTIONS, AVOID_OPTIONS, DEFAULT_PROFILE });
let storageAvailable = true;
const categoryList = [
  ['全部', '🍽️'], ['家常菜', '🍚'], ['川湘菜', '🌶️'], ['面食', '🍜'],
  ['轻食', '🥗'], ['粤式', '🍖'], ['日式', '🍣'], ['西北', '🥙'], ['韩式', '🍲'],
];
const coverIds = { xiangkou: 'd1', chuancai: 'd6', shancheng: 'd11', helv: 'd16', jinji: 'd21', yifan: 'd26', laoshan: 'd31', xiaoman: 'd35', hanwei: 'd40', xiangli: 'd43' };
/* 原创餐品插画，按主食和主料绘制，避免外部图片服务不可用时出现占位照片。 */
function dishArt(dish) {
  const backgrounds = { tomato: '#f1d8c4', amber: '#f0e1bd', sage: '#dfe7cf', clay: '#edddc7', cocoa: '#e9d4bf', sky: '#dbe8de' };
  const noodles = /面|粉|乌冬/.test(dish.staple || '');
  const salad = dish.cuisine === '轻食';
  const seafood = dish.protein === '鱼虾';
  const color = dish.protein === '牛肉' ? '#875135' : dish.protein === '鸡肉' ? '#c99453'
    : seafood ? '#e69771' : dish.protein === '豆制品' ? '#dbb96d' : '#a96c43';
  let rice = '';
  for (let i = 0; i < 56; i++) {
    const x = 235 + ((i * 37) % 174);
    const y = 125 + ((i * 19) % 113);
    const dx = (x - 310) / 112, dy = (y - 180) / 68;
    if (dx * dx + dy * dy < 1) rice += `<ellipse cx="${x}" cy="${y}" rx="4" ry="2.2" fill="#fffdf1" transform="rotate(${i * 19} ${x} ${y})"/>`;
  }
  const noodleLines = Array.from({ length: 11 }, (_, i) => `<path d="M${228 + i * 6} ${132 + i * 4}q56-23 117 2t-45 34q-95 8-42 29t91 5" fill="none" stroke="${i % 2 ? '#ead39a' : '#f3e0ae'}" stroke-width="${5 + i % 3}" stroke-linecap="round"/>`).join('');
  const protein = seafood
    ? `<g transform="rotate(-18 325 174)"><rect x="283" y="126" width="90" height="78" rx="22" fill="#ca7656"/><rect x="280" y="121" width="90" height="72" rx="20" fill="${color}"/>${[0, 1, 2, 3, 4].map(i => `<path d="m${290 + i * 15} 127 13 59" stroke="#f5c6a0" stroke-width="4" stroke-linecap="round"/>`).join('')}</g>`
    : Array.from({ length: salad ? 5 : 7 }, (_, i) => {
      const x = 272 + (i % 3) * 31, y = 122 + Math.floor(i / 3) * 30;
      return `<g transform="rotate(${i % 2 ? 13 : -17} ${x + 18} ${y + 13})"><rect x="${x}" y="${y + 5}" width="40" height="28" rx="8" fill="#714c303b"/><rect x="${x}" y="${y}" width="40" height="28" rx="8" fill="${color}"/><path d="m${x + 7} ${y + 7} 21 1" stroke="#efbd7f" stroke-width="3" opacity=".55" stroke-linecap="round"/></g>`;
    }).join('');
  const greens = [0, 1, 2, 3].map(i => `<g transform="translate(${salad ? 228 + i * 39 : 220 + i * 14},${salad ? 127 + i % 2 * 78 : 163 + i * 17}) rotate(${i * 31})"><ellipse cx="0" cy="0" rx="24" ry="14" fill="${i % 2 ? '#6c8c43' : '#819f52'}"/><path d="M-17 0 15 0m-7-7L0 0l-10-6" stroke="#b2c983" stroke-width="2" fill="none" stroke-linecap="round"/></g>`).join('');
  const tomatoes = [0, 1, 2].map(i => `<g transform="translate(${345 + i * 19},${211 - i * 22}) rotate(${i * 50})"><path d="M-17 0a17 17 0 0 1 34 0Z" fill="#d55f3b"/><path d="M-11-1a11 11 0 0 1 22 0" fill="none" stroke="#f39467" stroke-width="4"/><path d="M0-10v7m-6-4 3 3m9-3-3 3" stroke="#efbf7d" stroke-width="2"/></g>`).join('');
  return `<svg class="meal-art" viewBox="0 0 600 360" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${html(dish.name)}餐品插画" xmlns="http://www.w3.org/2000/svg">
    <rect width="600" height="360" fill="${backgrounds[dish.tone] || '#e6e0cb'}"/>
    <path d="M0 325h600M0 44h600" stroke="#ffffff25" stroke-width="2"/>
    <ellipse cx="324" cy="281" rx="160" ry="22" fill="#66604514"/>
    <g transform="rotate(-15 310 183)"><ellipse cx="308" cy="194" rx="142" ry="88" fill="#cfcbba"/><ellipse cx="308" cy="184" rx="146" ry="92" fill="#fffdf2"/><ellipse cx="308" cy="180" rx="125" ry="76" fill="${noodles ? '#a26542' : '#ede6ce'}"/><ellipse cx="308" cy="177" rx="118" ry="70" fill="${noodles ? '#ba7950' : '#f6f0dc'}"/>
      ${noodles ? noodleLines : rice}${protein}${greens}${tomatoes}
      ${dish.ingredients.some(i => i.includes('鸡蛋')) ? '<ellipse cx="285" cy="191" rx="37" ry="25" fill="#fff9df"/><ellipse cx="289" cy="190" rx="17" ry="14" fill="#efb746"/>' : ''}
      <path d="M209 129q-18 41-4 62" stroke="#fff" stroke-width="4" fill="none" opacity=".8" stroke-linecap="round"/>
    </g>
    <g transform="rotate(30 460 185)"><rect x="471" y="92" width="7" height="183" rx="3.5" fill="#b58a5c"/><rect x="486" y="93" width="7" height="182" rx="3.5" fill="#c39b68"/><path d="M474 104v80M489 104v80" stroke="#e6c99e" stroke-width="2"/></g>
    <g transform="translate(100 248)"><ellipse rx="33" ry="19" fill="#efe5c8"/><ellipse cy="-4" rx="31" ry="18" fill="#fffbed"/><ellipse cy="-4" rx="23" ry="12" fill="#a5653b"/><ellipse cy="-7" rx="15" ry="4" fill="#c1814d" opacity=".5"/></g>
    <path d="M112 62c12 4 20 15 31 11" stroke="#fffdf0" stroke-width="3" opacity=".5" fill="none" stroke-linecap="round"/>
  </svg>`;
}
function safeProfile(input = {}) {
  return {
    tastes: Array.isArray(input.tastes) ? [...new Set(input.tastes.filter(t => TASTE_OPTIONS.includes(t)))] : [...DEFAULT_PROFILE.tastes],
    avoid: Array.isArray(input.avoid) ? [...new Set(input.avoid.filter(a => AVOID_OPTIONS.some(o => o.id === a)))] : [...DEFAULT_PROFILE.avoid],
    customAvoid: Array.isArray(input.customAvoid) ? [...new Set(input.customAvoid.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().slice(0, 30)))].slice(0, 20) : [],
    staplePreference: ['不限', ...DISHES.map(d => d.staple)].includes(input.staplePreference) ? input.staplePreference : '不限',
    budget: Number.isFinite(input.budget) ? Math.max(15, Math.min(60, input.budget)) : DEFAULT_PROFILE.budget,
    healthy: typeof input.healthy === 'boolean' ? input.healthy : DEFAULT_PROFILE.healthy,
    staplePriority: typeof input.staplePriority === 'boolean' ? input.staplePriority : DEFAULT_PROFILE.staplePriority,
  };
}
function seedState() {
  return {
    version: 2, revision: 0, profile: safeProfile(DEFAULT_PROFILE), history: [],
    legacyHistory: [], demoHistory: SEED_HISTORY.map(h => ({ ...h, source: 'demo' })),
    mode: 'real', dateKey: lunchEngine.dateKey(), todayIndex: 0,
    day: lunchEngine.normalizeConstraints(), dayPreferences: null, persistentConstraints: {},
    skipped: [], utteranceEvents: [], selectionEvents: [], exposureEvents: [], skipEvents: [],
    learningEnabled: true, pendingClarification: null, conversation: [],
  };
}
function trimEvents(events) {
  const now = Date.now();
  return (Array.isArray(events) ? events : []).filter(e => e && typeof e.event_id === 'string' &&
    Number.isFinite(Date.parse(e.chosen_at || e.created_at)) &&
    now - Date.parse(e.chosen_at || e.created_at) < 90 * 86400000)
    .slice(-200);
}
function safeDay(input, dateKey) {
  try { return lunchEngine.normalizeConstraints(input || {}, dateKey); }
  catch { return lunchEngine.normalizeConstraints({}, dateKey); }
}
function safeDayPreferences(input) {
  if (!input || !lunchEngine.validDate(input.dateKey)) return null;
  const result = { dateKey: input.dateKey };
  if (Array.isArray(input.tastes)) result.tastes = input.tastes.filter(t => TASTE_OPTIONS.includes(t));
  for (const key of ['healthy', 'staplePriority']) if (typeof input[key] === 'boolean') result[key] = input[key];
  if (Number.isFinite(input.budget) && input.budget >= 15 && input.budget <= 60) result.budget = input.budget;
  if (['不限', ...DISHES.map(d => d.staple)].includes(input.staplePreference)) result.staplePreference = input.staplePreference;
  return result;
}
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw || typeof raw !== 'object' || raw.version !== 2) {
      const previousText = localStorage.getItem(LEGACY_STORAGE_KEY);
      const previous = JSON.parse(previousText || 'null');
      if (!previous || typeof previous !== 'object') return seedState();
      // v1保留可恢复备份；没有日期的旧记忆不能伪装为真实行为。
      try { localStorage.setItem('lunch-buddy-state-v1-backup', previousText); } catch { storageAvailable = false; }
      return { ...seedState(), profile: safeProfile(previous.profile),
        legacyHistory: (Array.isArray(previous.history) ? previous.history : [])
          .filter(h => h && getDish(h.dishId) && Number.isInteger(h.dayIndex)).slice(-20)
          .map(h => ({ ...h, source: 'legacy' })) };
    }
    const todayIndex = Number.isInteger(raw.todayIndex) && raw.todayIndex >= 0 && raw.todayIndex <= 10000 ? raw.todayIndex : 0;
    const dateKey = lunchEngine.validDate(raw.dateKey) ? raw.dateKey : lunchEngine.dateKey();
    return {
      ...seedState(), profile: safeProfile(raw.profile), todayIndex, dateKey,
      mode: raw.mode === 'demo' ? 'demo' : 'real', day: safeDay(raw.day, dateKey),
      persistentConstraints: safeDay(raw.persistentConstraints, dateKey),
      dayPreferences: safeDayPreferences(raw.dayPreferences),
      history: (Array.isArray(raw.history) ? raw.history : []).filter(h => h && getDish(h.dishId) && lunchEngine.validDate(h.date_key)).slice(-90),
      legacyHistory: (Array.isArray(raw.legacyHistory) ? raw.legacyHistory : []).filter(h => h && getDish(h.dishId)).slice(-20),
      demoHistory: (Array.isArray(raw.demoHistory) ? raw.demoHistory : []).filter(h => h && getDish(h.dishId) && Number.isInteger(h.dayIndex)).slice(-30),
      ...Object.fromEntries(['utteranceEvents', 'selectionEvents', 'exposureEvents', 'skipEvents'].map(key => [key, trimEvents(raw[key])])),
      learningEnabled: raw.learningEnabled !== false,
      skipped: (Array.isArray(raw.skipped) ? raw.skipped : []).filter(getDish).slice(0, DISHES.length),
      pendingClarification: raw.pendingClarification?.questions?.length <= 2 &&
        typeof raw.pendingClarification.context === 'string' ? raw.pendingClarification : null,
      conversation: (Array.isArray(raw.conversation) ? raw.conversation : []).filter(m =>
        m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').slice(-20),
    };
  } catch { storageAvailable = false; return seedState(); }
}
let state = loadState();
let selectedCategory = '全部';
let query = '';
let sort = 'popular';
let messages = state.conversation;
let busy = false;
let activeRequest = null;
let assistantOpen = false;
let service = { reachable: false, compatible: false, modelConfigured: false, model: '', status: 'checking', timeoutMs: 10000 };
let connectionGeneration = 0;
let toastTimer;
let modalFocus = null;
let preferenceDraft = safeProfile(state.profile);
function saveState() {
  for (const key of ['utteranceEvents', 'selectionEvents', 'exposureEvents', 'skipEvents']) state[key] = trimEvents(state[key]);
  state.conversation = messages.slice(-20);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); storageAvailable = true; }
  catch { storageAvailable = false; }
  if ($('#storageStatus')) {
    $('#storageStatus').hidden = storageAvailable;
    $('#storageStatus').textContent = '当前无法保存到本机，仍可会话内选餐；刷新后记忆可能丢失。';
  }
  return storageAvailable;
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3000);
}
function labels(prefs = state.profile) {
  return [...prefs.avoid.map(id => AVOID_OPTIONS.find(a => a.id === id)?.label).filter(Boolean), ...(prefs.customAvoid || [])];
}
function activeDate(snapshot = state) {
  if (snapshot.mode !== 'demo') return snapshot.dateKey;
  const date = new Date(`${snapshot.dateKey}T04:00:00Z`);
  date.setUTCDate(date.getUTCDate() + snapshot.todayIndex);
  return date.toISOString().slice(0, 10);
}
function currentHistory(snapshot = state) { return snapshot.mode === 'demo' ? snapshot.demoHistory : snapshot.history; }
function effectiveProfile(snapshot = state) {
  return { ...snapshot.profile, ...(snapshot.dayPreferences?.dateKey === activeDate(snapshot) ? snapshot.dayPreferences : {}) };
}
function currentConstraints(snapshot = state) {
  const day = snapshot.day.dateKey === activeDate(snapshot) ? snapshot.day : safeDay({}, activeDate(snapshot));
  const constraints = { ...safeDay(snapshot.persistentConstraints, activeDate(snapshot)) };
  for (const key of day.explicit) constraints[key] = day[key];
  return constraints;
}
function buildApiInput(snapshot = state) {
  const dateKey = activeDate(snapshot);
  const events = snapshot.mode === 'real' ? snapshot.selectionEvents.filter(e => e.source === 'real' &&
    getDish(e.dish_id) && lunchEngine.validDate(e.date_key) && lunchEngine.daysBetween(dateKey, e.date_key) >= 0 &&
    lunchEngine.daysBetween(dateKey, e.date_key) < 30 && typeof e.chosen_at === 'string' &&
    Number.isFinite(Date.parse(e.chosen_at)) && lunchEngine.dateKey(new Date(e.chosen_at)) === e.date_key).slice(-60) : [];
  return {
    profile: snapshot.profile, history: currentHistory(snapshot).slice(-30).map(h => snapshot.mode === 'demo'
      ? { dishId: h.dishId, dayIndex: h.dayIndex } : { dishId: h.dishId, date_key: h.date_key }),
    todayIndex: snapshot.todayIndex, skipped: snapshot.skipped, date_key: dateKey,
    constraints: snapshot.day, persistent_constraints: snapshot.persistentConstraints,
    day_preferences: snapshot.dayPreferences, selection_events: events,
    learning_enabled: snapshot.learningEnabled && snapshot.mode === 'real',
    pending_clarification: snapshot.pendingClarification,
  };
}
function invalidateRequest() {
  state.revision++;
  activeRequest?.abort();
  activeRequest = null;
  setBusy(false);
}
function ensureCurrentDate() {
  const today = lunchEngine.dateKey();
  if (state.dateKey === today) return false;
  invalidateRequest();
  state.dateKey = today;
  state.todayIndex = 0; state.mode = 'real';
  state.day = safeDay({}, today); state.dayPreferences = null;
  state.pendingClarification = null; state.skipped = []; messages = [];
  saveState();
  renderMemory(); renderChat();
  toast('新的一天，当天条件已清除，长期偏好和忌口继续保留');
  return true;
}
function preferenceText() {
  const p = effectiveProfile();
  const c = currentConstraints();
  return [p.tastes.join('、') || '口味不限', labels().length ? `不吃${labels().join('、')}` : '无忌口',
    p.healthy ? '少油少炸' : '', p.staplePriority ? '主食优先' : '', `¥${p.budget}以内`,
    c.noSpicy ? '不辣' : '', c.stapleType !== '不限' ? `只吃${c.stapleType}` : '',
    c.maxMinutes ? `${c.maxMinutes}分钟内` : ''].filter(Boolean).join(' · ');
}
function dateLabel() {
  const date = activeDate();
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日${state.mode === 'demo' ? ' · 模拟日期（不参与真实学习）' : ' · 上海日期'}`;
}
function dayLabel(entry) {
  if (entry.source === 'legacy') return '旧演示';
  const diff = entry.date_key ? lunchEngine.daysBetween(activeDate(), entry.date_key) : state.todayIndex - entry.dayIndex;
  return ['今天', '昨天', '前天'][diff] || `${diff}天前`;
}
function hitsAvoid(dish, prefs = state.profile) {
  return lunchEngine.dishMatchesAvoid(dish, prefs.avoid, prefs.customAvoid);
}
function candidateData(skipped = state.skipped, snapshot = state) {
  const data = lunchEngine.analyze(lunchEngine.normalizeRequest({ ...buildApiInput(snapshot), skipped }));
  return { ...data, candidates: data.unsupported_avoid.length ? [] : data.visible.map(item => item.dish) };
}

/* 静态网页兜底只使用保存的偏好，不假装解析自然语言。 */
function ruleResult(message, notice = '未连接推荐服务，本次按已保存的偏好使用规则演示。', isChat = true) {
  const data = candidateData();
  const picks = data.unsupported_avoid.length ? [] : data.visible.slice(0, 3).map(item => ({
    dishId: item.dish.id,
    reason: `${item.dish.name}，${item.dish.tastes.join('、')}口味，做法为${item.dish.cooking}${item.dish.staple ? `，主食${item.dish.staple}` : ''}，菜单价格${item.dish.price}元。已按保存的条件筛选。`,
    matched: [...item.dish.tastes, `做法：${item.dish.cooking}`, `价格：${item.dish.price}元`].slice(0, 4),
    score: item.score, scoreParts: item.parts, learnedBonus: item.learned_bonus, rankScore: item.rank_score,
  }));
  const clarification = !picks.length ? { context: '', round: 1, questions: [{
    slot: data.unsupported_avoid.length ? 'customAvoid' : 'budget',
    question: data.unsupported_avoid.length ? `菜单未完整标注${data.unsupported_avoid.join('、')}，请先向商家确认食材。`
      : '没有符合当前条件的菜品。是否调整预算、主食或时效？忌口继续保留。',
    reason_code: data.unsupported_avoid.length ? 'unsupported_avoid' : 'no_candidates', allowed_answers: [],
  }] } : null;
  return {
    mode: 'rules', model: '', message: picks.length
      ? isChat ? '当前是规则演示，这句话还没有交给大模型解析。我先按已保存的口味推荐；想调整预算、忌口或口味，可以点“修改偏好”。' : '先按已保存的口味，看看这几份。'
      : clarification.questions[0].question,
    recommendations: picks, notice, trace: data.counts, clarification,
    decisionTrace: { counts: data.counts, learning: data.learning, model_candidate_count: 0 },
    telemetry: { model_calls: 0, cache_hit: false, actual_usage: { prompt_tokens: 0, completion_tokens: 0 },
      stages: { parse: { status: 'not_run', attempts: 0 }, recommend: { status: 'rules', attempts: 0 } } },
    requestId: null, profileApplied: false,
  };
}

/* 外卖页面不承载 AI 决策，始终展示可浏览的模拟商家菜单。 */
function renderCategories() {
  $('#categories').innerHTML = categoryList.map(([name, emoji]) => `<button class="category" type="button" data-action="category" data-value="${name}" aria-pressed="${selectedCategory === name}"><span class="category-emoji" aria-hidden="true">${emoji}</span>${name}</button>`).join('');
}
function renderStores() {
  let stores = MERCHANTS.filter(m => {
    const dishes = DISHES.filter(d => d.merchantId === m.id);
    const categoryMatch = selectedCategory === '全部' || dishes.some(d => d.cuisine === selectedCategory);
    const q = query.toLowerCase();
    return categoryMatch && (!q || [m.name, m.category, ...dishes.flatMap(d => [d.name, ...d.tastes])].some(t => t.toLowerCase().includes(q)));
  });
  stores.sort((a, b) => Number(b.open) - Number(a.open)
    || (sort === 'fast' ? a.minutes - b.minutes : sort === 'rating' ? b.rating - a.rating : b.monthly - a.monthly));
  $('#storeCount').textContent = query ? `“${query}” · 找到 ${stores.length} 家商家` : `${stores.filter(m => m.open).length} 家营业中 · 配送至你的办公室`;
  $('#emptySearch').hidden = stores.length > 0;
  $('#storeGrid').innerHTML = stores.map((m, index) => {
    const dishes = DISHES.filter(d => d.merchantId === m.id);
    const dish = dishes.find(d => query && d.name.includes(query)) || getDish(coverIds[m.id]) || dishes[0];
    return `<article class="store-card" tabindex="0" role="button" aria-label="查看${html(m.name)}菜单" data-action="shop" data-merchant="${m.id}">
      <div class="store-cover">${dishArt(dish)}
        <span class="store-cover-label">${html(m.category)}</span><span class="store-cover-time">${m.open ? `${m.minutes}分钟送达` : '今日休息'}</span></div>
      <div class="store-info"><div class="store-top"><h3>${html(m.name)}</h3><small>${m.distance}km</small></div>
        <div class="store-stats"><strong>★ ${m.rating}</strong><span>月售 ${m.monthly}+</span><span>人均 ¥${Math.round(dishes.reduce((n, d) => n + d.price, 0) / dishes.length)}</span></div>
        <div class="store-highlight"><span>招牌</span>${html(dish.name)}<b>¥${dish.price}</b></div></div>
    </article>`;
  }).join('');
}
function renderShop(id) {
  const merchant = getMerchant(id);
  if (!merchant) return;
  const eligible = new Set(candidateData([]).candidates.map(d => d.id));
  $('#shopContent').innerHTML = `<div class="shop-header"><span class="shop-mark">${merchant.mark}</span><div><h2 id="shopTitle">${html(merchant.name)}</h2><p>★ ${merchant.rating} · ${merchant.minutes}分钟 · ${merchant.distance}km${merchant.open ? '' : ' · 今日休息'}</p></div></div>
    ${DISHES.filter(d => d.merchantId === id).map(d => `<article class="menu-row"><div class="menu-art">${dishArt(d)}</div><div><h3>${html(d.name)}</h3><p>${html(d.desc)}</p><div class="rec-facts"><span>${html(d.tastes.join('、'))}</span><span>${html(d.staple)}</span>${hitsAvoid(d) ? '<span>含你的忌口</span>' : ''}</div><div class="menu-bottom"><strong>¥${d.price}</strong><button type="button" data-action="choose" data-dish="${d.id}" ${eligible.has(d.id) ? '' : 'disabled'}>${eligible.has(d.id) ? '今天吃这个' : '不符合当前条件'}</button></div></div></article>`).join('')}`;
  showModal('shopModal');
}
function renderMemory() {
  const history = currentHistory();
  const isToday = h => h.date_key ? h.date_key === activeDate() : h.dayIndex === state.todayIndex;
  const today = history.find(isToday);
  const rows = [today || (state.mode === 'demo' ? { dayIndex: state.todayIndex } : { date_key: activeDate() }),
    ...history.filter(h => !isToday(h)).sort((a, b) => b.date_key?.localeCompare(a.date_key) || b.dayIndex - a.dayIndex).slice(0, 6)];
  const learning = candidateData().learning;
  const evidence = Object.entries(learning.counts.cooking).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([cooking, count]) => `选了${count}次${cooking}菜`).join('、');
  $('#memoryContent').innerHTML = `<div class="memory-profile"><strong>长期档案</strong><br>${html(state.profile.tastes.join('、') || '口味不限')} · ${html(labels().join('、') || '无忌口')} · ¥${state.profile.budget}以内<br><strong>这顿的有效条件</strong><br>${html(preferenceText())}</div>${rows.map(h => {
    const dish = getDish(h.dishId);
    return `<div class="memory-row"><span>${dayLabel(h)}</span>${dish ? `<div class="memory-art">${dishArt(dish)}</div>` : ''}<div><strong>${dish ? html(dish.name) : '今天还没选好'}</strong><small>${dish ? `${html(getMerchant(dish.merchantId).name)} · ¥${dish.price}${state.mode === 'demo' ? ' · 演示记录' : ''}` : '确认选择后记录'} </small></div></div>`;
  }).join('')}<p class="settings-note">${html(dateLabel())}</p>
    <section class="learning-summary" id="learningSummary"><h3>从选择中学习</h3><p>${state.mode === 'demo' ? '当前为演示模式，不参与真实偏好学习。'
      : !state.learningEnabled ? '学习已暂停，历史记录仍保留。' : learning.active
        ? `过去${learning.selection_count}次最终选择、${learning.date_count}个日期中，${html(evidence)}。仅为软排序加分，最多6分。`
        : `已有${learning.selection_count}次有效最终选择，记录不足；满5次并跨至少3日期才启用学习。每日只算最终一次。`}</p>
      <button type="button" class="button-soft" data-action="toggle-learning">${state.learningEnabled ? '暂停学习' : '恢复学习'}</button>
      <button type="button" class="button-soft" data-action="clear-learning">清除分析记录</button>
      <p class="settings-note">清除分析记录保留明确忌口与午饭历史；未选和换批不作为负偏好。</p></section>
    <details class="utterance-history"><summary>原话与操作记录 · ${state.utteranceEvents.length}条原话 / ${state.selectionEvents.length}次选择</summary>
      ${state.utteranceEvents.slice(-6).reverse().map(e => `<p><strong>${html(e.text)}</strong><small>${html(e.date_key)} · ${e.parsed ? '已解析' : '未应用'}${e.source === 'demo' ? ' · 演示' : ''}</small></p>`).join('') || '<p>还没有原话记录。</p>'}
      <p class="settings-note">另有${state.exposureEvents.length}次曝光、${state.skipEvents.length}次换批；本机保留90天、每类最多200项。</p></details>
    ${state.legacyHistory.length ? `<details><summary>旧演示记录（不参与真实学习）</summary><p class="settings-note">${state.legacyHistory.map(h => html(getDish(h.dishId)?.name)).join('、')}</p></details>` : ''}`;
  $('#contextLabel').textContent = today
    ? '今天已选好 · 接下来帮你避开这道主菜' : '记住你的口味，避开近两天的主菜';
  $('#returnToday').hidden = state.mode !== 'demo';
}

function connectionText() {
  if (service.status === 'checking') return '正在检查模型连接';
  if (service.status === 'degraded') return '本次服务不可用 · 已回退规则';
  if (service.reachable && !service.compatible) return 'V2接口未启用 · 规则选餐';
  if (service.cached) return `已使用模型缓存${service.model ? ` · ${service.model}` : ''}`;
  if (service.modelConfigured) return `${service.verified ? '大模型已连接' : '模型已配置，待首次调用'}${service.model ? ` · ${service.model}` : ''}`;
  return service.reachable ? '规则演示 · 模型未配置' : '规则演示 · 未连接推荐服务';
}
function renderConnection() {
  const label = $('#connectionLabel');
  label.classList.toggle('connected', service.verified === true);
  label.innerHTML = `<i></i>${html(connectionText())}`;
  $('#serverStatus').textContent = service.status === 'degraded' ? '最近一次模型请求未成功，本次使用规则选餐。已确认的条件继续生效；未确认的偏好不会应用。可点击重新连接再验证。'
    : service.reachable && !service.compatible ? '服务仍使用旧接口，V2未启用。本页先使用共享规则引擎；独立V2实例可完成自然语言交互。'
    : service.modelConfigured
    ? service.verified ? '已收到大模型的实际响应，选餐与自然语言交互可用。' : '模型配置已读取，首次推荐会验证实际调用；失败时明确回退规则结果。'
    : service.reachable
    ? '推荐服务已连接，模型尚未配置。配置完成后自动切换到大模型；现在可体验规则选餐。'
    : '未连接推荐服务。静态页面可体验规则选餐；使用后台服务启动后，可接入大模型。';
}
async function checkConnection() {
  const generation = ++connectionGeneration;
  service.status = 'checking'; renderConnection();
  if (/github\.io$/.test(location.hostname) || location.protocol === 'file:') {
    service = { reachable: false, compatible: false, modelConfigured: false, model: '', status: 'offline', timeoutMs: 10000 }; renderConnection(); return;
  }
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (generation !== connectionGeneration) return;
    service = {
      reachable: true, modelConfigured: result.configured === true || result.mode === 'llm',
      compatible: result.agent_v2_enabled === true,
      model: typeof result.model === 'string' ? result.model : '', status: 'ready',
      timeoutMs: Number.isFinite(result.request_timeout_ms) ? result.request_timeout_ms + 1000 : 10000,
    };
  } catch {
    if (generation !== connectionGeneration) return;
    service = { reachable: false, compatible: false, modelConfigured: false, model: '', status: 'offline', timeoutMs: 10000 };
  }
  renderConnection();
}
function welcomeHtml() {
  return `<p class="chat-date">${html(dateLabel())}</p><div class="chat-message assistant"><div class="message-name">午饭搭子</div><div class="message-text chat-welcome"><h3>中午好，小A 👋</h3><p>告诉我口味、预算和不吃的食材，我从商家库里帮你挑。会避开今天和近两天选过的主菜。</p><div class="welcome-memory">${html(preferenceText())}</div></div>
    <div class="quick-prompts"><button type="button" data-action="recommend">按记住的口味，帮我挑一份 <span>↗</span></button><button type="button" data-action="prompt" data-prompt="30元以内，清淡一点，带米饭">30元以内，清淡一点 <span>↗</span></button><button type="button" data-action="prompt" data-prompt="不要香菜，少油少炸，配米饭，帮我挑午饭">不要香菜，少油少炸 <span>↗</span></button></div></div>`;
}
function recHtml(rec, index) {
  const d = getDish(rec.dishId);
  if (!d) return '';
  const merchant = getMerchant(d.merchantId);
  const selected = currentHistory().some(h => (h.date_key ? h.date_key === activeDate() : h.dayIndex === state.todayIndex) && h.dishId === d.id);
  const selectable = candidateData([]).candidates.some(c => c.id === d.id);
  if (index > 0) return `<article class="recommendation backup"><div class="rec-art">${dishArt(d)}</div><div class="rec-content"><div class="rec-heading"><h3>${html(d.name)}</h3><strong>¥${d.price}</strong></div><p class="rec-reason">${html(rec.reason)}</p><div class="rec-footer"><span>${html(merchant.name)} · ${d.minutes}分钟</span><button type="button" class="rec-select ${selected ? 'rec-selected' : ''}" data-action="choose" data-dish="${d.id}" ${selected || !selectable ? 'disabled' : ''}>${selected ? '已记录' : selectable ? '选它' : '条件已变'}</button></div></div></article>`;
  return `<article class="recommendation"><div class="rec-cover">${dishArt(d)}<span>这份先看看</span></div><div class="rec-content"><div class="rec-heading"><h3>${html(d.name)}</h3><strong>¥${d.price}</strong></div><p class="rec-subtitle">${html(merchant.name)} · ★ ${d.rating} · ${d.minutes}分钟送达</p><div class="rec-facts"><span>${html(d.tastes.join('、'))}</span><span>${html(d.staple)}</span><span>${d.fried ? '油炸' : '非油炸'}</span></div><p class="rec-reason">${html(rec.reason)}</p><button class="button-primary ${selected ? 'rec-selected' : ''}" type="button" data-action="choose" data-dish="${d.id}" ${selected || !selectable ? 'disabled' : ''}>${selected ? '✓ 已记录，今天吃这个' : selectable ? '就吃这个 →' : '当前条件已变化，请重新推荐'}</button></div></article>`;
}
function traceHtml(result) {
  const t = result.trace || {};
  const telemetry = result.telemetry || {};
  const stageNames = { not_run: '未调用', rules: '规则', model: '模型', failed: '失败', cancelled: '取消' };
  const stages = Object.entries(telemetry.stages || {}).map(([key, value]) =>
    `${key === 'parse' ? '解析' : '推荐'}：${stageNames[value.status] || '未调用'}${value.cached ? '（缓存）' : value.shared ? '（共享结果）' : ''}，${value.attempts || 0}次${Number.isFinite(value.latency_ms) ? ` / ${value.latency_ms}ms` : ''}`);
  const usage = telemetry.actual_usage || {};
  const originUsage = telemetry.cache_hit ? telemetry.origin_usage : null;
  const learning = result.decisionTrace?.learning;
  return `<details class="agent-trace"><summary>${result.mode === 'llm' ? '大模型推荐' : '规则选餐'} · 查看决策摘要</summary>
    <p class="trace-model">${html(result.notice || (result.model ? `模型：${result.model}` : '本地共享规则引擎'))}</p>
    <p class="trace-counts">目录${t.total ?? DISHES.length}道 · 营业${t.open ?? '—'}道<br>排除：休息${t.closed || 0} / 忌口${t.avoid || 0} / 预算${t.budget || 0} / 近期主菜${t.history || 0} / 当天限制${t.constraints || 0} / 换批${t.skipped || 0}<br>合规${t.eligible ?? 0}道 · 入模${result.decisionTrace?.model_candidate_count ?? 0}道</p>
    <p>${stages.map(html).join('<br>')}<br>本次模型请求${telemetry.model_calls || 0}次${telemetry.cache_hit ? ' · 推荐缓存命中' : ''}${Number.isFinite(telemetry.request_latency_ms) ? ` · 全程${telemetry.request_latency_ms}ms` : ''}<br>本次tokens：输入${usage.prompt_tokens || 0} / 输出${usage.completion_tokens || 0}${usage.unknown ? '（部分消耗未知，不能视为零费用）' : ''}${originUsage ? `<br>缓存原消耗：输入${originUsage.prompt_tokens || 0} / 输出${originUsage.completion_tokens || 0}` : ''}</p>
    ${(result.recommendations || []).map(rec => `<div class="trace-dish"><strong>${html(getDish(rec.dishId)?.name)}</strong><span>规则${rec.score ?? '—'} + 学习${Number(rec.learnedBonus || 0).toFixed(2)} = 排序${Number(rec.rankScore || rec.score || 0).toFixed(2)}</span><small>${Object.entries(rec.scoreParts || {}).map(([key, value]) => `${({ taste: '口味', health: '少油', staple: '主食', quality: '口碑', speed: '时效', variety: '多样性' })[key] || key}${Number(value).toFixed(1)}`).map(html).join(' · ')}</small><small>${(rec.matched || []).map(html).join(' / ')}</small></div>`).join('')}
    ${learning ? `<p>学习依据：${learning.selection_count}次最终选择 / ${learning.date_count}日期${learning.active ? '，已启用软加分' : '，未启用加分'}。</p>` : ''}
    <p class="settings-note">规则分和学习分用于排序，不是模型置信度。菜单为演示数据，未标注的食材不能保证过敏安全。</p>
    ${result.requestId ? `<small class="trace-request">请求 ${html(result.requestId)}${result.fallbackReason ? ` · ${html(result.fallbackReason)}` : ''}</small>` : ''}</details>`;
}
function renderChat(scroll = false) {
  const scrollEl = $('#chatMessages');
  const previous = scrollEl.scrollTop;
  scrollEl.innerHTML = welcomeHtml() + messages.map(m => {
    if (m.role === 'user') return `<div class="chat-message user"><div class="message-text">${html(m.content)}</div></div>`;
    const result = m.result;
    return `<div class="chat-message assistant"><div class="message-name">午饭搭子${result ? ` · ${result.mode === 'llm' ? '大模型' : '规则演示'}` : ''}</div><div class="message-text ${m.error ? 'chat-error' : ''}">${html(m.content)}${m.error ? '<div class="message-actions"><button type="button" class="button-soft" data-action="retry">再试一次</button></div>' : ''}</div>${result ? `${(result.recommendations || []).map(recHtml).join('')}<div class="message-actions">${result.recommendations?.length ? '<button type="button" class="button-soft" data-action="reroll">换一批 ↻</button>' : ''}<button type="button" class="button-soft" data-action="settings">修改偏好</button></div>${traceHtml(result)}` : ''}</div>`;
  }).join('');
  scrollEl.scrollTop = scroll ? scrollEl.scrollHeight : previous;
  const pending = state.pendingClarification;
  $('#clarificationPrompt').hidden = !pending?.questions?.length;
  $('#clarificationPrompt').textContent = pending?.questions?.map(q => q.question).join(' ') || '';
}
function openAssistant() {
  assistantOpen = true;
  $('#assistantPanel').hidden = false;
  $('#assistantLauncher').hidden = true;
  $('#assistantLauncher').setAttribute('aria-expanded', 'true');
  $('#assistantNudge').hidden = true;
  $('#chatInput').focus({ preventScroll: true });
}
function closeAssistant() {
  assistantOpen = false;
  $('#assistantPanel').hidden = true;
  $('#assistantLauncher').hidden = false;
  $('#assistantLauncher').setAttribute('aria-expanded', 'false');
  $('#assistantLauncher').focus({ preventScroll: true });
}
function showModal(id) {
  modalFocus = document.activeElement;
  for (const name of ['settingsModal', 'shopModal', 'memoryModal']) if (name !== id) $('#' + name).hidden = true;
  $('#' + id).hidden = false;
  document.body.style.overflow = 'hidden';
  $('#' + id + ' .dialog-close').focus({ preventScroll: true });
}
function closeModal(id) {
  $('#' + id).hidden = true;
  document.body.style.overflow = '';
  if (modalFocus?.isConnected) modalFocus.focus({ preventScroll: true });
}
function showSettings() {
  preferenceDraft = safeProfile(state.profile);
  renderPreferenceChips();
  $('#healthyPreference').checked = preferenceDraft.healthy;
  $('#staplePriorityPreference').checked = preferenceDraft.staplePriority;
  $('#staplePreference').innerHTML = ['不限', ...new Set(DISHES.map(d => d.staple).filter(Boolean))]
    .map(s => `<option value="${html(s)}">${html(s)}</option>`).join('');
  $('#staplePreference').value = preferenceDraft.staplePreference;
  $('#budgetPreference').value = preferenceDraft.budget;
  $('#budgetLabel').textContent = `¥${preferenceDraft.budget}以内`;
  $('#customAvoidPreference').value = preferenceDraft.customAvoid.join('、');
  $('#noSpicyPreference').checked = currentConstraints().noSpicy;
  $('#hardStaplePreference').value = currentConstraints().stapleType;
  $('#maxMinutesPreference').value = currentConstraints().maxMinutes ?? '';
  $('#settingsError').hidden = true;
  renderConnection();
  showModal('settingsModal');
}
function renderPreferenceChips() {
  $('#tasteChips').innerHTML = TASTE_OPTIONS.map(t => `<button type="button" data-action="profile-taste" data-value="${t}" aria-pressed="${preferenceDraft.tastes.includes(t)}">${t}</button>`).join('');
  $('#avoidChips').innerHTML = AVOID_OPTIONS.map(a => `<button type="button" data-action="profile-avoid" data-value="${a.id}" aria-pressed="${preferenceDraft.avoid.includes(a.id)}">${a.label}</button>`).join('');
}
function setBusy(value, stage = '正在理解你的需求') {
  busy = value;
  $('#chatProgress').hidden = !value;
  $('#progressText').textContent = stage;
  $('#sendButton').disabled = value;
  $('#chatInput').disabled = value;
}
function stateVersion() { return JSON.stringify({ revision: state.revision, input: buildApiInput() }); }
function recordEvent(kind, fields) {
  const event = { event_id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, created_at: new Date().toISOString(),
    date_key: activeDate(), source: state.mode === 'demo' ? 'demo' : 'real', ...fields };
  state[kind].push(event);
  return event;
}

/* 此适配器只调用统一后端接口，不从浏览器直接发送模型密钥。 */
async function askService(message, signal, isChat) {
  const payload = {
    ...buildApiInput(),
    ...(isChat ? {
      text: message,
      messages: messages.slice(0, -1).filter(m => !m.error).slice(-8).map(m => ({ role: m.role, content: m.content.slice(0, 500) })),
    } : {}),
  };
  const response = await fetch(isChat ? '/api/chat' : '/api/recommend', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    signal: AbortSignal.any([signal, AbortSignal.timeout(service.timeoutMs || 10000)]),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('推荐服务响应格式不正确。'); }
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : '推荐服务暂时无法选餐。');
  return result;
}
function normalizeServiceResult(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.picks)) throw new Error('推荐服务没有返回餐品列表。');
  const prospective = raw.profile_applied === true ? {
    ...state, profile: raw.persistent_profile, dayPreferences: raw.day_preferences,
    day: raw.constraints, persistentConstraints: raw.persistent_constraints,
  } : state;
  const normalized = lunchEngine.normalizeRequest(buildApiInput(prospective));
  const data = lunchEngine.analyze(normalized);
  const eligible = new Set(data.unsupported_avoid.length ? [] : data.visible.map(item => item.dish.id));
  if (raw.picks.length > 3) throw new Error('餐品数量未通过校验。');
  const seen = new Set();
  const recommendations = raw.picks.map(rec => {
    if (!rec || !eligible.has(rec.dish_id) || seen.has(rec.dish_id) || typeof rec.reason !== 'string') throw new Error('餐品校验没有通过，已使用规则演示。');
    seen.add(rec.dish_id);
    const expected = data.visible.find(item => item.dish.id === rec.dish_id);
    if (Number.isFinite(rec.rule_score) && rec.rule_score !== expected.score) throw new Error('规则分与当前条件不一致。');
    return { dishId: rec.dish_id, reason: rec.reason.slice(0, 500),
      matched: Array.isArray(rec.matched) ? rec.matched.filter(t => typeof t === 'string').slice(0, 4) : [],
      score: expected.score, scoreParts: expected.parts, learnedBonus: expected.learned_bonus, rankScore: expected.rank_score };
  }).slice(0, 3);
  const mode = raw.source === 'qwen' ? 'llm' : 'rules';
  if (raw.clarification && (!Array.isArray(raw.clarification.questions) || raw.clarification.questions.length > 2 ||
    typeof raw.clarification.context !== 'string' || raw.clarification.context.length > 500)) throw new Error('澄清状态格式不正确。');
  if (raw.profile_applied === true) {
    state.profile = normalized.profile; state.day = normalized.constraints;
    state.dayPreferences = normalized.day_preferences; state.persistentConstraints = normalized.persistent_constraints;
  }
  state.pendingClarification = raw.needs_clarification ? raw.clarification : null;
  const fallbackMessages = {
    missing_key: '模型尚未配置，本次使用已保存偏好的规则演示。',
    timeout: '模型响应超时，本次使用规则演示。',
    invalid_output: '模型结果未通过校验，本次使用规则演示。',
    auth_failed: '模型权限暂未就绪，本次使用规则演示。',
    account_unavailable: '模型账号额度不可用，本次使用规则演示。',
    rate_limited: '模型暂时限流，本次使用规则演示。',
    circuit_open: '模型服务暂时熔断，本次使用规则演示。',
    few_candidates: '候选较少，直接展示符合条件的餐品。',
    no_candidates: '没有符合当前条件的餐品。',
  };
  return {
    mode, message: typeof raw.reply === 'string' ? raw.reply.slice(0, 1500)
      : typeof raw.summary === 'string' ? raw.summary.slice(0, 1500) : '为你选了这几份。',
    model: typeof raw.model === 'string' ? raw.model : '', recommendations,
    trace: raw.decision_trace?.counts || data.counts,
    decisionTrace: raw.decision_trace, telemetry: raw.telemetry, requestId: raw.request_id,
    fallbackReason: raw.fallback_reason, clarification: raw.clarification,
    notice: fallbackMessages[raw.fallback_reason] || (mode === 'rules' ? '模型暂不可用，本次使用规则演示。' : ''),
    profileApplied: raw.profile_applied === true, source: raw.source,
  };
}
async function sendMessage(content, isChat = true) {
  ensureCurrentDate();
  const message = String(content || '').trim().slice(0, 500);
  if (!message || busy) return;
  openAssistant();
  const version = stateVersion();
  const controller = new AbortController();
  activeRequest = controller;
  messages.push({ role: 'user', content: message });
  const utterance = isChat ? recordEvent('utteranceEvents', { text: message, parsed: false, changes: [] }) : null;
  saveState();
  $('#chatInput').value = '';
  renderChat(true);
  setBusy(true, service.modelConfigured ? '大模型正在理解你的口味并选餐' : '正在查询商家并筛选餐品');
  try {
    let result;
    if (service.reachable && service.compatible) {
      try {
        const raw = await askService(message, controller.signal, isChat);
        if (controller.signal.aborted) return;
        if (stateVersion() !== version) return;
        result = normalizeServiceResult(raw);
        if (utterance) {
          utterance.parsed = raw.utterance_event?.parsed === true || raw.telemetry?.stages.parse.status === 'model';
          utterance.changes = raw.profile_applied === true ? raw.changes || [] : [];
          utterance.request_id = raw.request_id;
        }
        service.cached = raw.source === 'qwen' && raw.telemetry?.stages.recommend.cached === true;
        const failed = ['timeout', 'auth_failed', 'account_unavailable', 'rate_limited', 'model_config', 'invalid_output',
          'upstream_error', 'network_error', 'circuit_open'].includes(raw.fallback_reason);
        service.status = failed ? 'degraded' : 'ready';
        service.verified = !failed && (raw.source === 'qwen' || raw.telemetry?.stages.parse.status === 'model');
        if (raw.model) service.model = raw.model;
        renderConnection();
      } catch (error) {
        if (controller.signal.aborted) return;
        if (stateVersion() !== version) return;
        service.status = 'degraded'; service.verified = false; service.cached = false; renderConnection();
        result = ruleResult(message, `${error.message} 本次使用规则演示。`, isChat);
        toast('推荐服务暂不可用，本次使用规则演示');
      }
    } else {
      result = ruleResult(message, service.reachable && !service.compatible ? 'V2接口未启用，本次使用已保存偏好的共享规则。' : undefined, isChat);
    }
    if (controller.signal.aborted) return;
    if (result.clarification) state.pendingClarification = result.clarification;
    if (result.recommendations.length) recordEvent('exposureEvents', {
      dish_ids: result.recommendations.map(r => r.dishId), request_id: result.requestId || null,
    });
    messages.push({ role: 'assistant', content: result.message, result });
    saveState(); renderMemory(); renderChat(false);
    // 把新回复开头滚进视野，让首选和备选都容易浏览。
    const responses = $('#chatMessages').querySelectorAll('.chat-message.assistant');
    responses[responses.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (!controller.signal.aborted) { messages.push({ role: 'assistant', content: error.message, error: true }); renderChat(true); }
  } finally {
    if (activeRequest === controller) { activeRequest = null; setBusy(false); if (assistantOpen) $('#chatInput').focus({ preventScroll: true }); }
  }
}
function chooseDish(id) {
  ensureCurrentDate();
  const dish = getDish(id);
  if (!dish || !candidateData([]).candidates.some(d => d.id === id)) {
    toast('当前条件已变化，请重新推荐'); return;
  }
  invalidateRequest();
  const requestId = [...messages].reverse().find(m => m.result?.recommendations.some(r => r.dishId === id))?.result.requestId || null;
  recordEvent('selectionEvents', { dish_id: id, chosen_at: new Date().toISOString(), request_id: requestId });
  if (state.mode === 'demo') {
    state.demoHistory = state.demoHistory.filter(h => h.dayIndex !== state.todayIndex);
    state.demoHistory.push({ dishId: id, dayIndex: state.todayIndex, source: 'demo' });
  } else {
    state.history = state.history.filter(h => h.date_key !== activeDate());
    state.history.push({ dishId: id, date_key: activeDate(), source: 'real' });
  }
  state.pendingClarification = null;
  const saved = saveState(); renderMemory(); renderChat(false);
  if (!$('#shopModal').hidden) closeModal('shopModal');
  toast(`今天就吃「${dish.name}」· ${saved ? '已记录，近两天不重样' : '仅本次会话记录，无法持久保存'}`);
}
function newChat() {
  invalidateRequest();
  messages = []; state.skipped = []; state.pendingClarification = null;
  saveState();
  renderChat(); $('#chatInput').value = ''; $('#chatInput').focus({ preventScroll: true });
}
function nextDay() {
  invalidateRequest();
  if (state.mode === 'real') {
    state.demoHistory = state.history.map(h => ({ dishId: h.dishId, dayIndex: -lunchEngine.daysBetween(state.dateKey, h.date_key), source: 'demo' }));
    state.todayIndex = 0;
  }
  state.mode = 'demo'; state.todayIndex = Math.min(10000, state.todayIndex + 1);
  state.skipped = []; state.day = safeDay({}, activeDate()); state.dayPreferences = null; state.pendingClarification = null;
  state.demoHistory = state.demoHistory.filter(h => state.todayIndex - h.dayIndex <= 12).slice(-12);
  messages = [];
  saveState(); renderMemory(); renderChat();
  toast('已模拟到明天，演示选择不参与真实学习');
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  switch (target.dataset.action) {
    case 'category': selectedCategory = target.dataset.value; renderCategories(); renderStores(); break;
    case 'clear-search': query = ''; selectedCategory = '全部'; $('#searchInput').value = ''; renderCategories(); renderStores(); break;
    case 'shop': renderShop(target.dataset.merchant); break;
    case 'assistant': openAssistant(); break;
    case 'close-assistant': closeAssistant(); break;
    case 'dismiss-nudge': $('#assistantNudge').hidden = true; break;
    case 'settings': showSettings(); break;
    case 'profile-taste':
    case 'profile-avoid': {
      const key = target.dataset.action === 'profile-taste' ? 'tastes' : 'avoid';
      const value = target.dataset.value;
      if (preferenceDraft[key].includes(value)) preferenceDraft[key] = preferenceDraft[key].filter(item => item !== value);
      else preferenceDraft[key].push(value);
      renderPreferenceChips(); break;
    }
    case 'close-settings': closeModal('settingsModal'); break;
    case 'close-shop': closeModal('shopModal'); break;
    case 'close-memory': closeModal('memoryModal'); break;
    case 'memory': renderMemory(); showModal('memoryModal'); break;
    case 'prompt': sendMessage(target.dataset.prompt); break;
    case 'recommend': sendMessage('按记住的口味，帮我挑一份午饭', false); break;
    case 'choose': chooseDish(target.dataset.dish); break;
    case 'reroll': {
      if (busy) break;
      ensureCurrentDate();
      const latest = [...messages].reverse().find(m => m.result?.recommendations?.length);
      if (latest) state.skipped = [...new Set([...state.skipped, ...latest.result.recommendations.map(r => r.dishId)])];
      recordEvent('skipEvents', { dish_ids: latest?.result?.recommendations.map(r => r.dishId) || [], request_id: latest?.result?.requestId || null });
      sendMessage('这几份先不吃，换一批符合偏好的午饭', false); break;
    }
    case 'retry': sendMessage([...messages].reverse().find(m => m.role === 'user')?.content); break;
    case 'cancel':
      invalidateRequest(); messages.push({ role: 'assistant', content: '已取消。可以重新告诉我今天想吃什么。' }); saveState(); renderChat(true); break;
    case 'new-chat': newChat(); break;
    case 'next-day': nextDay(); break;
    case 'return-today':
      invalidateRequest(); state.mode = 'real'; state.todayIndex = 0; state.dateKey = lunchEngine.dateKey();
      state.day = safeDay({}, state.dateKey); state.dayPreferences = null; state.pendingClarification = null; state.skipped = []; messages = [];
      saveState(); renderMemory(); renderChat(); toast('已回到真实日期，真实记录和长期偏好继续保留'); break;
    case 'toggle-learning':
      invalidateRequest(); state.learningEnabled = !state.learningEnabled;
      saveState(); renderMemory(); renderChat(); toast(state.learningEnabled ? '已恢复学习' : '学习已暂停，记录仍保留'); break;
    case 'clear-learning':
      invalidateRequest();
      for (const key of ['utteranceEvents', 'selectionEvents', 'exposureEvents', 'skipEvents']) state[key] = [];
      saveState(); renderMemory(); renderChat(); toast('分析记录已清除，明确忌口和午饭历史保留'); break;
    case 'reconnect': checkConnection(); break;
    case 'reset':
      invalidateRequest(); state = seedState(); messages = []; saveState(); renderMemory(); renderChat(); toast('已重置本地偏好与记录'); break;
  }
});
$('#chatForm').addEventListener('submit', event => { event.preventDefault(); sendMessage($('#chatInput').value); });
$('#chatInput').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage(event.target.value); }
});
$('#searchForm').addEventListener('submit', event => { event.preventDefault(); query = $('#searchInput').value.trim(); renderStores(); });
$('#searchInput').addEventListener('input', event => { query = event.target.value.trim(); renderStores(); });
$('#sortSelect').addEventListener('change', event => { sort = event.target.value; renderStores(); });
$('#budgetPreference').addEventListener('input', event => { $('#budgetLabel').textContent = `¥${event.target.value}以内`; });
$('#settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    ensureCurrentDate();
    invalidateRequest();
    const customAvoid = $('#customAvoidPreference').value.split(/[、,，\n]/).map(t => t.trim()).filter(Boolean);
    if (customAvoid.length > 20 || customAvoid.some(t => t.length > 30)) throw new Error('自定义忌口最多20项，每项不超过30字。');
    state.profile = safeProfile({
      ...preferenceDraft, healthy: $('#healthyPreference').checked,
      staplePriority: $('#staplePriorityPreference').checked,
      staplePreference: $('#staplePreference').value,
      budget: Number($('#budgetPreference').value), customAvoid,
    });
    state.dayPreferences = null;
    state.day = lunchEngine.normalizeConstraints({
      dateKey: activeDate(), noSpicy: $('#noSpicyPreference').checked, stapleType: $('#hardStaplePreference').value,
      maxMinutes: $('#maxMinutesPreference').value ? Number($('#maxMinutesPreference').value) : null,
    }, activeDate());
    state.skipped = []; state.pendingClarification = null;
    const saved = saveState(); renderMemory(); renderChat(false);
    closeModal('settingsModal');
    toast(saved ? '偏好已保存，正在重新帮你挑' : '偏好仅在本次会话生效，无法持久保存');
    // 被取消的旧请求先结束，再以新档案发起推荐。
    if (busy) { setBusy(false); activeRequest = null; }
    await sendMessage('按刚设置的口味，重新帮我挑一份', false);
  } catch (error) { $('#settingsError').textContent = error.message; $('#settingsError').hidden = false; }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    const openModal = ['settingsModal', 'shopModal', 'memoryModal'].find(id => !$('#' + id).hidden);
    if (openModal) closeModal(openModal); else if (assistantOpen) closeAssistant();
  }
  if (event.key === 'Enter' && event.target.matches('.store-card')) { event.preventDefault(); renderShop(event.target.dataset.merchant); }
  if (event.key === 'Tab') {
    const modal = document.querySelector('.overlay:not([hidden]) .dialog');
    if (!modal) return;
    const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, a[href]')]
      .filter(element => element.getClientRects().length);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
$('#bannerArt').innerHTML = dishArt(getDish('d16'));
document.addEventListener('visibilitychange', () => { if (!document.hidden) ensureCurrentDate(); });
window.addEventListener('focus', ensureCurrentDate);
ensureCurrentDate();
saveState();
renderCategories(); renderStores(); renderMemory(); renderChat(); checkConnection();
