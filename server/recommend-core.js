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
