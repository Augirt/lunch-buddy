/* 服务端独立检查约束、规则分和主菜去重；菜单从 data.js 读取。 */
module.exports = function createLunchEngine(catalog) {
  const { MERCHANTS, DISHES, TASTE_OPTIONS, AVOID_OPTIONS, DEFAULT_PROFILE } = catalog;
  const STAPLES = ['不限', ...new Set(DISHES.map((dish) => dish.staple).filter(Boolean))];
  const dishById = new Map(DISHES.map((dish) => [dish.id, dish]));
  const avoidIds = new Set(AVOID_OPTIONS.map((option) => option.id));
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validList = (value, allowed, max) =>
    Array.isArray(value) && value.length <= max && value.every((item) => allowed.has(item));

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
    const todayIndex = input.todayIndex ?? 0;
    if (!Number.isInteger(todayIndex) || todayIndex < 0 || todayIndex > 10000) {
      throw new Error('演示日期不正确。');
    }
    const history = input.history ?? [];
    if (!Array.isArray(history) || history.length > 30 || !history.every((entry) =>
      object(entry) && dishById.has(entry.dishId) && Number.isInteger(entry.dayIndex) &&
      entry.dayIndex >= -10000 && entry.dayIndex <= todayIndex)) {
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
    return {
      profile: {
        tastes: [...new Set(profile.tastes)], avoid: [...new Set(profile.avoid)],
        healthy: profile.healthy, staplePriority: profile.staplePriority,
        staplePreference: profile.staplePreference, budget: profile.budget,
      },
      history: history.map(({ dishId, dayIndex }) => ({ dishId, dayIndex })),
      todayIndex, skipped: [...new Set(skipped)], skipStats,
    };
  }

  function dishMatchesAvoid(dish, ids) {
    const terms = ids.flatMap((id) => AVOID_OPTIONS.find((option) => option.id === id)?.terms || []);
    return dish.ingredients.some((ingredient) => terms.some((term) => ingredient.includes(term)));
  }

  function scoreDish(dish, recentDishes, state) {
    const { profile } = state;
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
    return { dish, score: Math.round(total), total, parts, matchedTastes, sameProtein };
  }

  function analyze(state) {
    const openMerchants = MERCHANTS.filter((merchant) => merchant.open);
    const openIds = new Set(openMerchants.map((merchant) => merchant.id));
    const recall = DISHES.filter((dish) => openIds.has(dish.merchantId));
    const avoidRemoved = recall.filter((dish) => dishMatchesAvoid(dish, state.profile.avoid));
    const afterAvoid = recall.filter((dish) => !avoidRemoved.includes(dish));
    const budgetRemoved = afterAvoid.filter((dish) => dish.price > state.profile.budget);
    const afterBudget = afterAvoid.filter((dish) => dish.price <= state.profile.budget);
    const recentDishes = state.history
      .map((entry) => ({ ...entry, rel: state.todayIndex - entry.dayIndex, dish: dishById.get(entry.dishId) }))
      .filter((entry) => entry.dish && entry.rel >= 0 && entry.rel <= 2)
      .sort((a, b) => a.rel - b.rel);
    const historyRemoved = afterBudget.filter((dish) =>
      recentDishes.some((entry) => entry.dish.main === dish.main));
    const afterHistory = afterBudget.filter((dish) => !historyRemoved.includes(dish));
    const scored = afterHistory.map((dish) => scoreDish(dish, recentDishes, state))
      .sort((a, b) => b.total - a.total || b.dish.rating - a.dish.rating || a.dish.price - b.dish.price);
    const visible = scored.filter((item) => !state.skipped.includes(item.dish.id));
    return {
      openMerchants, closedMerchants: MERCHANTS.length - openMerchants.length, recall,
      avoidRemoved, budgetRemoved, afterAvoid, afterBudget, recentDishes,
      historyRemoved, afterHistory, scored, visible, skippedCount: state.skipped.length,
    };
  }
  return { normalizeRequest, analyze, scoreDish, dishMatchesAvoid, STAPLES };
};
