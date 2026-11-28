const CODES = ['taste_match', 'less_oil', 'staple_match', 'rating', 'delivery', 'variety'];
function candidate(item, profile) {
  const d = item.dish;
  const supported = [];
  if (d.tastes.some(t => profile.tastes.includes(t))) supported.push('taste_match');
  if (d.oil === 1 && !d.fried) supported.push('less_oil');
  if (d.staple && (profile.staplePreference === '不限' || profile.staplePreference === d.staple)) supported.push('staple_match');
  if (d.rating >= 4.5) supported.push('rating');
  if (d.minutes <= 32) supported.push('delivery');
  if (item.parts.variety >= 5) supported.push('variety');
  return { dish_id: d.id, name: d.name, main: d.main, ingredients: d.ingredients, tastes: d.tastes,
    cooking: d.cooking, oil: d.oil, fried: d.fried, staple: d.staple, price: d.price, rating: d.rating,
    minutes: d.minutes, rule_score: item.score, learned_bonus: item.learned_bonus, rank_score: item.rank_score,
    supported_rationale_codes: supported,
    facts: [...d.tastes, `做法：${d.cooking}`, ...(d.staple ? [`主食：${d.staple}`] : []),
      `价格：${d.price}元`, `菜单配送：${d.minutes}分钟`, ...(d.oil === 1 ? ['菜单用油：较少'] : [])] };
}
function renderReason(dish) {
  return `${dish.name}，${dish.tastes.join('、')}口味，做法为${dish.cooking}${dish.staple ? `，主食${dish.staple}` : ''}，菜单价格${dish.price}元。${dish.oil === 1 ? '菜单标注用油较少。' : ''}已按本次约束筛选。`;
}
function updateMessage(changes) {
  if (!changes.length) return '继续按当前设置推荐。';
  const labels = { tastes: '口味', avoid: '忌口', customAvoid: '自定义忌口', healthy: '少油偏好',
    staplePriority: '主食优先', staplePreference: '主食偏好', budget: '预算', noSpicy: '不辣限制',
    stapleType: '主食限制', maxMinutes: '配送时效' };
  const persistent = [...new Set(changes.filter(c => c.scope === 'persistent').map(c => labels[c.field]))];
  const day = [...new Set(changes.filter(c => c.scope === 'day').map(c => labels[c.field]))];
  return [persistent.length ? `已更新长期${persistent.join('、')}。` : '',
    day.length ? `已更新今天的${day.join('、')}，跨天失效。` : ''].join('');
}
const fallbackMessages = {
  missing_key: '尚未配置模型，先按你的口味用规则推荐。',
  timeout: '模型回复超时，已切换为规则推荐。',
  auth_failed: '模型凭证或权限未就绪，已切换为规则推荐。',
  account_unavailable: '模型账号额度不可用，已切换为规则推荐。',
  rate_limited: '模型请求暂时受限，已切换为规则推荐。',
  model_config: '模型接口配置需检查，已切换为规则推荐。',
  invalid_output: '模型结果未通过校验，已切换为规则推荐。',
  network_error: '模型连接暂时不可用，已切换为规则推荐。',
  upstream_error: '模型服务暂时不可用，已切换为规则推荐。',
  circuit_open: '模型服务暂时熔断，已切换为规则推荐。',
  few_candidates: '候选较少，直接选择符合约束的菜品。',
  no_candidates: '当前约束下没有候选，需要确认是否调整预算、主食或配送时效。',
};
module.exports = { CODES, candidate, renderReason, updateMessage, fallbackMessages };
