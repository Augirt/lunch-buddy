const catalog = require('../data.js');
const engine = require('./recommend-core.cjs')(catalog);
const clauses = text => text.split(/[，,。；;！!？?\n]|但是|不过|但|而是/).map(s => s.trim()).filter(Boolean);
const light = /清淡|清爽|养胃|少辣|别太辣|不要太辣|口味轻|(?:不(?:想|喜欢)?吃辣|不喜欢辣|不要辣|不辣)(?!椒|子|油)/;
const negatedLight = /(?:不要|不想|不喜欢|别|不吃|不用)(?:吃|太)?(?:清淡|清爽|养胃|口味轻)/;
const noSpicy = /(?:不(?:想|喜欢)?吃辣|不喜欢辣|不要辣|不辣|无辣|不能吃辣)(?!椒|子|油)/;
function applyTasteIntent(profile, text) {
  const positive = clauses(text).some(clause => light.test(clause) && !negatedLight.test(clause));
  if (!positive) return profile;
  return { ...profile, tastes: [...new Set([...profile.tastes.filter(t => !['微辣', '重辣'].includes(t)), '清淡'])] };
}
const FIELDS = ['tastes', 'avoid', 'customAvoid', 'healthy', 'staplePriority', 'staplePreference', 'budget',
  'noSpicy', 'stapleType', 'maxMinutes'];
function question(slot, reason_code, text, allowed_answers = []) {
  return { slot, reason_code, question: text, allowed_answers };
}
function clarificationResponse(items, text, pending, extra = {}) {
  return { needs_clarification: true, unsupported_avoid: [], changes: [], applied: false,
    clarification: { questions: items.slice(0, 2), context: pending?.context || text, round: (pending?.round || 0) + 1 }, ...extra };
}
function inspectIntent(text, state, pending = null) {
  const originalText = text;
  if (pending !== null && (!pending || typeof pending !== 'object' || !Array.isArray(pending.questions) ||
    pending.questions.length > 2 || typeof pending.context !== 'string' || pending.context.length > 500 ||
    !Number.isInteger(pending.round) || pending.round < 1 || pending.round > 20 ||
    !pending.questions.every(q => q && FIELDS.includes(q.slot) && typeof q.reason_code === 'string'))) {
    throw new Error('待确认状态格式不正确。');
  }
  const changes = [];
  const profile = { ...state.profile, tastes: [...state.profile.tastes], avoid: [...state.profile.avoid],
    customAvoid: [...state.profile.customAvoid] };
  const day = { ...(state.day_preferences || {}), dateKey: state.date_key };
  const constraints = { ...state.constraints };
  const persistent = { ...(state.persistent_constraints || {}) };
  const questions = [];
  const scopeFor = clause => /以后|一直|平时|长期|今后|每天/.test(clause) ? 'persistent' : 'day';
  const change = (field, value, evidence, scope = scopeFor(evidence)) => {
    if (['avoid', 'customAvoid'].includes(field)) scope = 'persistent';
    const evidenceText = originalText.includes(evidence) || pending?.context?.includes(evidence) ? evidence : originalText;
    changes.push({ field, value, scope, evidence: evidenceText,
      evidence_source: originalText.includes(evidenceText) ? 'current' : 'clarification' });
    if (['noSpicy', 'stapleType', 'maxMinutes'].includes(field)) {
      if (scope === 'persistent') persistent[field] = value;
      constraints[field] = value;
      constraints.dateKey = state.date_key;
      constraints.explicit = [...new Set([...constraints.explicit, field])];
    } else if (scope === 'persistent') { profile[field] = value; delete day[field]; }
    else day[field] = value;
  };
  const resetPending = /换个话题|重新开始|重置|取消这次/.test(text);
  const pendingItems = resetPending ? [] : pending?.questions || [];
  // 只接受当前轮明确答案；上下文不能独立授权清除忌口或改变硬条件。
  if (pendingItems.length && /^(保持|不放宽|不改|取消)[。！!]*$/.test(text.trim())) {
    return { applied: false, needs_clarification: false, unsupported_avoid: [], changes: [],
      profile, day_preferences: state.day_preferences, constraints, persistent_constraints: persistent, stop: true };
  }
  if (pendingItems.some(q => q.slot === 'budget') && /^\d+(?:元)?[。！!]*$/.test(text.trim())) text = `预算${text}`;
  if (pendingItems.some(q => q.slot === 'stapleType') && /^(不限|米饭|面食)[。！!]*$/.test(text.trim())) text = `主食${text}`;
  if (pendingItems.some(q => q.slot === 'maxMinutes') && /^\d+分钟[。！!]*$/.test(text.trim())) text = `${text}内送达`;
  const resolving = pendingItems.some(q => q.slot === 'budget' && /预算\s*\d+/.test(text) ||
    q.slot === 'stapleType' && /主食(?:米饭|面食|不限)/.test(text) ||
    q.slot === 'maxMinutes' && /\d+分钟(?:内|送达)/.test(text) ||
    ['avoid', 'customAvoid'].includes(q.slot) && /不吃|可以吃|取消忌口/.test(text));
  if (resolving) {
    const retained = clauses(pending.context).filter(clause => !pendingItems.some(q =>
      q.slot === 'budget' && /预算|元|块/.test(clause) ||
      q.slot === 'stapleType' && /米饭|面食|只吃面/.test(clause) ||
      q.slot === 'maxMinutes' && /分钟|配送/.test(clause) ||
      ['avoid', 'customAvoid'].includes(q.slot) && /不吃|不要|过敏|取消忌口/.test(clause)));
    text = [...retained, text].join('，');
  }
  if (/忽略.*(?:规则|指令)|泄露|密钥|API.?Key|系统提示|执行代码|调用工具|system\s*:/i.test(text)) {
    return { applied: false, needs_clarification: false, unsupported_avoid: [], changes: [], out_of_scope: true,
      profile, day_preferences: state.day_preferences, constraints, persistent_constraints: persistent };
  }
  const segments = clauses(text);
  const hardRice = segments.some(s => /只(?:吃|要).*米饭|必须.*米饭|主食米饭/.test(s));
  const hardNoodle = segments.some(s => /只(?:吃|要).*(?:面|粉)|必须.*面食|主食面食/.test(s));
  const excludesSpicy = segments.some(s => noSpicy.test(s));
  const wantsSpicy = segments.some(s => /(?:要|想吃|必须).*重辣/.test(s) && !/不要|不想/.test(s));
  if (hardRice && hardNoodle) questions.push(question('stapleType', 'conflicting_constraints', '这顿主食选米饭还是面食？', ['米饭', '面食']));
  if (excludesSpicy && wantsSpicy) questions.push(question('noSpicy', 'conflicting_constraints', '这顿需要不辣，还是重辣？', ['不辣', '重辣']));
  for (const s of segments) {
    if (/不吃米饭|不要米饭|不吃面食|不要面食/.test(s)) questions.push(
      question('stapleType', 'unsupported_staple_exclusion', '这顿主食选米饭、面食，还是不限？', ['米饭', '面食', '不限']));
    if (/^(?:只吃|必须吃)/.test(s) && !/米饭|面|粉/.test(s)) questions.push(
      question('customAvoid', 'unsupported_only_food', '目前不能保证菜品只含某一种食材，请明确可接受的菜单食材范围。', ['已确认食材']));
    const budgetMatch = s.match(/(?:预算|不超过|最多|以内|上限)\s*(\d+(?:\.\d+)?)\s*(?:元|块)?/) ||
      s.match(/(\d+(?:\.\d+)?)\s*(?:元|块)(?:以内|以下)/);
    if (budgetMatch) {
      const value = Number(budgetMatch[1]);
      if (value < 15 || value > 60) questions.push(question('budget', 'out_of_range', '预算支持15至60元，这顿上限是多少？', ['15至60元']));
      else change('budget', value, s);
    }
    const minutes = s.match(/(\d+)\s*分钟(?:内|以内|送到|送达)/);
    if (minutes) {
      const value = Number(minutes[1]);
      if (value < 1 || value > 120) questions.push(question('maxMinutes', 'out_of_range', '配送时效支持1至120分钟，你能接受多少分钟？', ['1至120分钟']));
      else change('maxMinutes', value, s);
    }
    if (/配送不限|不限制配送|取消时效/.test(s)) change('maxMinutes', null, s);
    if (/主食不限|取消主食限制/.test(s)) change('stapleType', '不限', s);
    if (noSpicy.test(s)) change('noSpicy', true, s);
    if (/可以吃辣|取消不辣|允许辣/.test(s)) change('noSpicy', false, s);
    if (/只(?:吃|要).*米饭|必须.*米饭|主食米饭/.test(s)) change('stapleType', '米饭', s);
    if (/只(?:吃|要).*(?:面|粉)|必须.*面食|主食面食/.test(s)) change('stapleType', '面食', s);
    let tastes = [...(day.tastes || profile.tastes)];
    const lighter = light.test(s) && !negatedLight.test(s);
    if (lighter) change('tastes', applyTasteIntent({ tastes }, s).tastes, s);
    else {
      for (const taste of catalog.TASTE_OPTIONS) {
        if (s.includes(taste) && !new RegExp(`(?:不要|不想|不喜欢|别)(?:吃)?${taste}`).test(s)) {
          if (taste === '重辣' || taste === '微辣') tastes = tastes.filter(t => !['清淡', '微辣', '重辣'].includes(t));
          if (!tastes.includes(taste)) tastes.push(taste);
          change('tastes', tastes, s);
        }
      }
    }
    if (/少油|少炸|清淡|清爽|养胃/.test(s) && !negatedLight.test(s)) change('healthy', true, s);
    if (/不限用油|取消少油|不用少油/.test(s)) change('healthy', false, s);
    if (/米饭/.test(s) && !/不要米饭|不吃米饭/.test(s)) change('staplePreference', '米饭', s);
    if (/想吃面|偏好面|优先面/.test(s)) change('staplePreference', '面条', s);
    if (/主食优先|要带主食/.test(s)) change('staplePriority', true, s);
    if (/清空忌口|取消所有忌口|取消全部忌口/.test(s)) {
      change('avoid', [], s); change('customAvoid', [], s); continue;
    }
    const remove = s.match(/(?:现在)?(?:可以吃|取消忌口[:：]?)(.+)/);
    const avoid = s.match(/(?:不吃|不能吃|不要|忌口[:：]?)(.+)/) || s.match(/^(.+?)(?:过敏|不能吃)$/);
    const match = remove || avoid;
    if (match && !/^(?:辣$|太辣|微辣|重辣|清淡|清爽|太|主食|米饭|面食)/.test(match[1])) {
      const terms = match[1].replace(/了$|以后.*$|今天.*$/, '').split(/[、和及与]/).map(t => t.trim()).filter(Boolean);
      const unknown = [];
      for (const term of terms) {
        const option = catalog.AVOID_OPTIONS.find(o => [o.label, ...o.terms, ...(o.id === 'pork' ? ['肥肠', '肋排'] : [])].includes(term));
        if (option) {
          change('avoid', remove ? profile.avoid.filter(id => id !== option.id) : [...new Set([...profile.avoid, option.id])], s);
        } else if (engine.unsupportedAvoid([term]).length && !remove) unknown.push(term);
        else change('customAvoid', remove ? profile.customAvoid.filter(t => t !== term) : [...new Set([...profile.customAvoid, term])], s);
      }
      if (unknown.length) {
        const result = clarificationResponse([question('customAvoid', 'unsupported_avoid',
          `菜单没有完整标注${unknown.join('、')}，无法确认是否含有。请先向商家确认食材；可改用已确认的食材名称。`, ['已确认的食材名称'])], text, pending,
        { unsupported_avoid: unknown });
        return result;
      }
    }
    if (/不(?:是|要)不吃|不是不能吃|不是不辣|取消忌口$/.test(s)) questions.push(
      question('avoid', 'ambiguous_negation', '请明确要保留还是取消哪一项忌口？', ['不吃＋食材', '可以吃＋食材']));
  }
  if (questions.length) return clarificationResponse(questions, text, pending);
  const conflictingChanges = FIELDS.filter(field => ['budget', 'noSpicy', 'stapleType', 'maxMinutes'].includes(field) &&
    ['day', 'persistent'].some(scope => new Set(changes.filter(c => c.field === field && c.scope === scope)
      .map(c => JSON.stringify(c.value))).size > 1));
  if (conflictingChanges.length && !/改为|改成|不对|还是|而是/.test(originalText)) return clarificationResponse(
    conflictingChanges.map(field => question(field, 'conflicting_constraints', '同一作用期有多个不同限制，请明确最终取值。', ['明确最终取值'])), text, pending);
  if (pendingItems.length && !changes.length && !/推荐|午饭|换一批|为什么/.test(text)) {
    return clarificationResponse(pendingItems.map(q => question(q.slot, q.reason_code,
      `还需要明确${q.slot === 'budget' ? '预算金额' : q.slot === 'customAvoid' ? '已确认的食材名称' : '这顿限制的具体取值'}，才能继续。`,
      q.allowed_answers || [])), text, pending);
  }
  return { applied: changes.length > 0, needs_clarification: false, unsupported_avoid: [], changes,
    profile, day_preferences: day, constraints, persistent_constraints: persistent,
    out_of_scope: !changes.length && !/午饭|吃|推荐|换|为什么|解释|清淡|清爽|养胃|少油|主食/.test(text) };
}
function applyValidatedIntent(proposal, inspection, text) {
  if (inspection.needs_clarification || inspection.out_of_scope || inspection.stop) return inspection;
  // 模型完整档案仅作提议。只允许有当前原话证据且属于支持范围的变更。
  const accepted = (proposal.changes || []).filter(change => FIELDS.includes(change.field) &&
    ['day', 'persistent'].includes(change.scope) && typeof change.evidence === 'string' &&
    change.evidence.trim().length && text.includes(change.evidence) &&
    inspection.changes.some(local => local.field === change.field));
  return { ...inspection, model_evidence_accepted: accepted.length };
}
module.exports = { applyTasteIntent, inspectIntent, applyValidatedIntent, question };
