/* 模拟外卖首页 + 弹窗午饭助手。模型请求统一发给 BFF；不可用时明确回退规则演示。 */
'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const getDish = id => DISHES.find(d => d.id === id);
const getMerchant = id => MERCHANTS.find(m => m.id === id);
const STORAGE_KEY = 'lunch-buddy-state-v1';
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
    profile: safeProfile(DEFAULT_PROFILE), history: SEED_HISTORY.map(h => ({ ...h })), todayIndex: 0,
    day: { noSpicy: false, stapleType: '不限', cuisines: [], proteins: [], maxMinutes: null }, skipped: [],
  };
}
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return seedState();
    const todayIndex = Number.isInteger(raw.todayIndex) && raw.todayIndex >= 0 ? raw.todayIndex : 0;
    return {
      ...seedState(), profile: safeProfile(raw.profile), todayIndex,
      history: (Array.isArray(raw.history) ? raw.history : []).filter(h => h && getDish(h.dishId) && Number.isInteger(h.dayIndex) && h.dayIndex <= todayIndex).slice(-20),
    };
  } catch { return seedState(); }
}
let state = loadState();
let selectedCategory = '全部';
let query = '';
let sort = 'popular';
let messages = [];
let busy = false;
let activeRequest = null;
let assistantOpen = false;
let service = { reachable: false, modelConfigured: false, model: '', status: 'checking' };
let toastTimer;
let modalFocus = null;
let preferenceDraft = safeProfile(state.profile);
function saveState() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 忽略存储限制。 */ } }
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3000);
}
function labels(prefs = state.profile) {
  return [...prefs.avoid.map(id => AVOID_OPTIONS.find(a => a.id === id)?.label).filter(Boolean), ...(prefs.customAvoid || [])];
}
function preferenceText() {
  const p = state.profile;
  return [p.tastes.join('、') || '口味不限', labels().length ? `不吃${labels().join('、')}` : '无忌口', p.healthy ? '少油少炸' : '', p.staplePriority ? '主食优先' : '', `¥${p.budget}以内`].filter(Boolean).join(' · ');
}
function dateLabel() {
  const date = new Date();
  date.setDate(date.getDate() + state.todayIndex);
  return `${date.getMonth() + 1}月${date.getDate()}日${state.todayIndex ? ' · 模拟日期' : ''}`;
}
function dayLabel(entry) {
  const diff = state.todayIndex - entry.dayIndex;
  return ['今天', '昨天', '前天'][diff] || `${diff}天前`;
}
function hitsAvoid(dish, prefs = state.profile) {
  if (prefs.avoid.includes('seafood') && dish.protein === '鱼虾'
    || prefs.avoid.includes('pork') && dish.protein === '猪肉'
    || prefs.avoid.includes('beef') && dish.protein === '牛肉') return true;
  const terms = prefs.avoid.flatMap(id => AVOID_OPTIONS.find(a => a.id === id)?.terms || []);
  if (prefs.avoid.includes('pork')) terms.push('肋排', '肥肠', '里脊');
  terms.push(...(prefs.customAvoid || []));
  return dish.ingredients.some(i => terms.some(t => i.includes(t)));
}
function candidateData(prefs = state.profile, history = state.history, day = state.day, skipped = state.skipped) {
  const mains = new Set(history.filter(h => state.todayIndex - h.dayIndex >= 0 && state.todayIndex - h.dayIndex <= 2).map(h => getDish(h.dishId)?.main));
  const counts = { total: DISHES.length, closed: 0, avoid: 0, budget: 0, history: 0, today: 0, skipped: 0 };
  const candidates = DISHES.filter(d => {
    let rejection;
    if (!getMerchant(d.merchantId)?.open) rejection = 'closed';
    else if (hitsAvoid(d, prefs)) rejection = 'avoid';
    else if (d.price > prefs.budget) rejection = 'budget';
    else if (mains.has(d.main)) rejection = 'history';
    else if (day.noSpicy && d.tastes.some(t => ['微辣', '重辣'].includes(t))
      || day.stapleType === '米饭' && !d.staple?.includes('饭')
      || day.stapleType === '面食' && !/面|粉|乌冬|馍/.test(d.staple || '')
      || day.cuisines?.length && !day.cuisines.includes(d.cuisine)
      || day.proteins?.length && !day.proteins.includes(d.protein)
      || day.maxMinutes && d.minutes > day.maxMinutes) rejection = 'today';
    else if (skipped.includes(d.id)) rejection = 'skipped';
    if (rejection) counts[rejection]++;
    return !rejection;
  });
  return { candidates, counts: { ...counts, eligible: candidates.length } };
}

/* 静态网页兜底只使用保存的偏好，不假装解析自然语言。 */
function ruleResult(message, notice = '未连接推荐服务，本次按已保存的偏好使用规则演示。', isChat = true) {
  const data = candidateData();
  const recent = state.history.filter(h => state.todayIndex - h.dayIndex <= 2).map(h => getDish(h.dishId)).filter(Boolean);
  const ranked = data.candidates.map(d => {
    const matches = d.tastes.filter(t => state.profile.tastes.includes(t));
    const score = matches.length * 15
      + (state.profile.healthy ? (d.fried ? -18 : (3 - d.oil) * 11) : 0)
      + (state.profile.staplePriority && d.staple ? 12 : 0)
      + (state.profile.staplePreference !== '不限' && d.staple === state.profile.staplePreference ? 15 : 0)
      + (d.rating - 4) * 15 + Math.min(d.monthly / 300, 4)
      + (d.minutes <= 30 ? 7 : 3)
      + (recent.some(h => h.protein === d.protein) ? 0 : 6);
    const reasons = [
      matches.length ? `${matches.join('、')}口味` : d.tastes.join('、') + '口味',
      d.oil === 1 && !d.fried ? `${d.cooking}制、用油较少` : !d.fried ? '非油炸' : '油炸做法',
      d.staple ? `带${d.staple}` : '', `${d.minutes}分钟送达`,
    ];
    return { dishId: d.id, score, reason: reasons.filter(Boolean).join('，') + '。' };
  }).sort((a, b) => b.score - a.score);
  const picks = ranked.slice(0, 3).map(({ dishId, reason }) => ({ dishId, reason }));
  return {
    mode: 'rules', model: '', message: picks.length
      ? isChat ? '当前是规则演示，这句话还没有交给大模型解析。我先按已保存的口味推荐；想调整预算、忌口或口味，可以点“修改偏好”。' : '先按已保存的口味，看看这几份。'
      : '已保存的条件筛完，没有合适的餐品。可以在偏好设置里提高预算；你的忌口会继续保留。',
    recommendations: picks, profile: state.profile, history: state.history, day: state.day,
    notice, trace: data.counts,
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
  const eligible = new Set(candidateData(state.profile, state.history, state.day, []).candidates.map(d => d.id));
  $('#shopContent').innerHTML = `<div class="shop-header"><span class="shop-mark">${merchant.mark}</span><div><h2 id="shopTitle">${html(merchant.name)}</h2><p>★ ${merchant.rating} · ${merchant.minutes}分钟 · ${merchant.distance}km${merchant.open ? '' : ' · 今日休息'}</p></div></div>
    ${DISHES.filter(d => d.merchantId === id).map(d => `<article class="menu-row"><div class="menu-art">${dishArt(d)}</div><div><h3>${html(d.name)}</h3><p>${html(d.desc)}</p><div class="rec-facts"><span>${html(d.tastes.join('、'))}</span><span>${html(d.staple)}</span>${hitsAvoid(d) ? '<span>含你的忌口</span>' : ''}</div><div class="menu-bottom"><strong>¥${d.price}</strong><button type="button" data-action="choose" data-dish="${d.id}" ${eligible.has(d.id) ? '' : 'disabled'}>${eligible.has(d.id) ? '今天吃这个' : '不符合当前条件'}</button></div></div></article>`).join('')}`;
  showModal('shopModal');
}
function renderMemory() {
  const today = state.history.find(h => h.dayIndex === state.todayIndex);
  const rows = [today || { dayIndex: state.todayIndex, dishId: null }, ...state.history.filter(h => h.dayIndex < state.todayIndex).sort((a, b) => b.dayIndex - a.dayIndex).slice(0, 4)];
  $('#memoryContent').innerHTML = `<div class="memory-profile"><strong>记住的口味</strong><br>${html(preferenceText())}</div>${rows.map(h => {
    const dish = getDish(h.dishId);
    return `<div class="memory-row"><span>${dayLabel(h)}</span>${dish ? `<div class="memory-art">${dishArt(dish)}</div>` : ''}<div><strong>${dish ? html(dish.name) : '今天还没选好'}</strong><small>${dish ? `${html(getMerchant(dish.merchantId).name)} · ¥${dish.price}` : '选完会自动记住'}</small></div></div>`;
  }).join('')}<p class="settings-note">${dateLabel()}</p>`;
  $('#contextLabel').textContent = state.history.some(h => h.dayIndex === state.todayIndex)
    ? '今天已选好 · 接下来帮你避开这道主菜' : '记住你的口味，避开近两天的主菜';
}

function connectionText() {
  if (service.status === 'checking') return '正在检查模型连接';
  if (service.modelConfigured) return `${service.verified ? '大模型已连接' : '模型已配置，待首次调用'}${service.model ? ` · ${service.model}` : ''}`;
  return service.reachable ? '规则演示 · 模型未配置' : '规则演示 · 未连接推荐服务';
}
function renderConnection() {
  const label = $('#connectionLabel');
  label.classList.toggle('connected', service.verified === true);
  label.innerHTML = `<i></i>${html(connectionText())}`;
  $('#serverStatus').textContent = service.modelConfigured
    ? service.verified ? '已收到大模型的实际响应，选餐与自然语言交互可用。' : '模型配置已读取，首次推荐会验证实际调用；失败时明确回退规则结果。'
    : service.reachable
    ? '推荐服务已连接，模型尚未配置。配置完成后自动切换到大模型；现在可体验规则选餐。'
    : '未连接推荐服务。静态页面可体验规则选餐；使用后台服务启动后，可接入大模型。';
}
async function checkConnection() {
  service.status = 'checking'; renderConnection();
  if (/github\.io$/.test(location.hostname) || location.protocol === 'file:') {
    service = { reachable: false, modelConfigured: false, model: '', status: 'offline' }; renderConnection(); return;
  }
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error();
    const result = await response.json();
    service = {
      reachable: true, modelConfigured: result.configured === true || result.mode === 'llm',
      model: typeof result.model === 'string' ? result.model : '', status: 'ready',
    };
  } catch { service = { reachable: false, modelConfigured: false, model: '', status: 'offline' }; }
  renderConnection();
}
function welcomeHtml() {
  return `<p class="chat-date">${dateLabel()}</p><div class="chat-message assistant"><div class="message-name">午饭搭子</div><div class="message-text chat-welcome"><h3>中午好，小A 👋</h3><p>还没想好吃什么？告诉我口味、预算和不吃的食材，我从附近商家里帮你挑。昨天吃过的主菜也会避开。</p><div class="welcome-memory">${html(preferenceText())}</div></div>
    <div class="quick-prompts"><button type="button" data-action="recommend">按记住的口味，帮我挑一份 <span>↗</span></button><button type="button" data-action="prompt" data-prompt="30元以内，清淡一点，带米饭">30元以内，清淡一点 <span>↗</span></button><button type="button" data-action="prompt" data-prompt="不要香菜，少油少炸，配米饭，帮我挑午饭">不要香菜，少油少炸 <span>↗</span></button></div></div>`;
}
function recHtml(rec, index) {
  const d = getDish(rec.dishId);
  if (!d) return '';
  const merchant = getMerchant(d.merchantId);
  const selected = state.history.some(h => h.dayIndex === state.todayIndex && h.dishId === d.id);
  const selectable = candidateData(state.profile, state.history, state.day, []).candidates.some(c => c.id === d.id);
  if (index > 0) return `<article class="recommendation backup"><div class="rec-art">${dishArt(d)}</div><div class="rec-content"><div class="rec-heading"><h3>${html(d.name)}</h3><strong>¥${d.price}</strong></div><p class="rec-reason">${html(rec.reason)}</p><div class="rec-footer"><span>${html(merchant.name)} · ${d.minutes}分钟</span><button type="button" class="rec-select ${selected ? 'rec-selected' : ''}" data-action="choose" data-dish="${d.id}" ${selected || !selectable ? 'disabled' : ''}>${selected ? '已记录' : selectable ? '选它' : '条件已变'}</button></div></div></article>`;
  return `<article class="recommendation"><div class="rec-cover">${dishArt(d)}<span>这份先看看</span></div><div class="rec-content"><div class="rec-heading"><h3>${html(d.name)}</h3><strong>¥${d.price}</strong></div><p class="rec-subtitle">${html(merchant.name)} · ★ ${d.rating} · ${d.minutes}分钟送达</p><div class="rec-facts"><span>${html(d.tastes.join('、'))}</span><span>${html(d.staple)}</span><span>${d.fried ? '油炸' : '非油炸'}</span></div><p class="rec-reason">${html(rec.reason)}</p><button class="button-primary ${selected ? 'rec-selected' : ''}" type="button" data-action="choose" data-dish="${d.id}" ${selected || !selectable ? 'disabled' : ''}>${selected ? '✓ 已记录，今天吃这个' : selectable ? '就吃这个 →' : '当前条件已变化，请重新推荐'}</button></div></article>`;
}
function traceHtml(result) {
  const t = result.trace || {};
  return `<details class="agent-trace"><summary>${result.mode === 'llm' ? '大模型推荐' : '规则演示'} · 查看选餐过程</summary><p><span class="trace-model">${result.mode === 'llm' ? `模型：${html(result.model || '已连接')}` : html(result.notice || '模型未配置，本次使用规则排序。')}</span>${t.total ? `商家库 ${t.total} 道 · 剩余 ${t.eligible ?? '—'} 道候选<br>` : ''}忌口与预算校验 → 今天及近两天主菜去重 → ${result.mode === 'llm' ? '大模型选餐与解释' : '规则排序（按已保存的偏好）'} → 餐品校验</p></details>`;
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
function stateVersion() { return JSON.stringify({ profile: state.profile, history: state.history, day: state.day, todayIndex: state.todayIndex }); }

/* 此适配器只调用统一后端接口，不从浏览器直接发送模型密钥。 */
async function askService(message, signal, isChat) {
  const payload = {
    profile: state.profile, history: state.history, todayIndex: state.todayIndex, skipped: state.skipped,
    ...(isChat ? {
      text: message,
      messages: messages.slice(0, -1).filter(m => !m.error).slice(-8).map(m => ({ role: m.role, content: m.content.slice(0, 500) })),
    } : {}),
  };
  const response = await fetch(isChat ? '/api/chat' : '/api/recommend', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    signal: AbortSignal.any([signal, AbortSignal.timeout(125000)]),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('推荐服务响应格式不正确。'); }
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : '推荐服务暂时无法选餐。');
  return result;
}
function normalizeServiceResult(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.picks)) throw new Error('推荐服务没有返回餐品列表。');
  const prefs = raw.profile_applied === true ? safeProfile(raw.profile) : state.profile;
  const eligible = new Set(candidateData(prefs, state.history, state.day, state.skipped).candidates.map(d => d.id));
  const seen = new Set();
  const recommendations = raw.picks.map(rec => {
    if (!rec || !eligible.has(rec.dish_id) || seen.has(rec.dish_id) || typeof rec.reason !== 'string') throw new Error('餐品校验没有通过，已使用规则演示。');
    seen.add(rec.dish_id);
    return { dishId: rec.dish_id, reason: rec.reason.slice(0, 500) };
  }).slice(0, 3);
  const mode = raw.source === 'qwen' ? 'llm' : 'rules';
  if (raw.profile_applied === true) state.profile = prefs;
  const fallbackMessages = {
    missing_key: '模型尚未配置，本次使用已保存偏好的规则演示。',
    timeout: '模型响应超时，本次使用规则演示。',
    invalid_output: '模型结果未通过校验，本次使用规则演示。',
    auth_failed: '模型权限暂未就绪，本次使用规则演示。',
    few_candidates: '候选较少，直接展示符合条件的餐品。',
    no_candidates: '没有符合当前条件的餐品。',
  };
  return {
    mode, message: typeof raw.reply === 'string' ? raw.reply.slice(0, 1500)
      : typeof raw.summary === 'string' ? raw.summary.slice(0, 1500) : '为你选了这几份。',
    model: typeof raw.model === 'string' ? raw.model : '', recommendations,
    trace: { total: DISHES.length, eligible: raw.candidate_count ?? candidateData().counts.eligible, ...(raw.excluded || {}) },
    notice: fallbackMessages[raw.fallback_reason] || (mode === 'rules' ? '模型暂不可用，本次使用规则演示。' : ''),
    profileApplied: raw.profile_applied === true, source: raw.source,
  };
}
async function sendMessage(content, isChat = true) {
  const message = String(content || '').trim().slice(0, 500);
  if (!message || busy) return;
  openAssistant();
  const version = stateVersion();
  const controller = new AbortController();
  activeRequest = controller;
  messages.push({ role: 'user', content: message });
  $('#chatInput').value = '';
  renderChat(true);
  setBusy(true, service.modelConfigured ? '大模型正在理解你的口味并选餐' : '正在查询商家并筛选餐品');
  try {
    let result;
    if (service.reachable) {
      try {
        const raw = await askService(message, controller.signal, isChat);
        if (controller.signal.aborted) return;
        if (stateVersion() !== version) throw new Error('午饭记忆已变化，请重新发送需求。');
        result = normalizeServiceResult(raw);
        if (raw.source === 'qwen') {
          service.verified = true; service.modelConfigured = true;
          if (raw.model) service.model = raw.model;
          renderConnection();
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (stateVersion() !== version) throw error;
        result = ruleResult(message, `${error.message} 本次使用规则演示。`, isChat);
        toast('推荐服务暂不可用，本次使用规则演示');
      }
    } else {
      result = ruleResult(message, undefined, isChat);
    }
    if (controller.signal.aborted) return;
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
  const dish = getDish(id);
  if (!dish || !candidateData(state.profile, state.history, state.day, []).candidates.some(d => d.id === id)) {
    toast('当前条件已变化，请重新推荐'); return;
  }
  state.history = state.history.filter(h => h.dayIndex !== state.todayIndex);
  state.history.push({ dishId: id, dayIndex: state.todayIndex });
  saveState(); renderMemory(); renderChat(false);
  if (!$('#shopModal').hidden) closeModal('shopModal');
  toast(`今天就吃「${dish.name}」· 已记住，近两天不重样`);
}
function newChat() {
  if (busy) { toast('先等当前推荐完成，或取消这次推荐'); return; }
  messages = []; state.skipped = [];
  state.day = seedState().day;
  renderChat(); $('#chatInput').value = ''; $('#chatInput').focus({ preventScroll: true });
}
function nextDay() {
  activeRequest?.abort();
  state.todayIndex++; state.skipped = []; state.day = seedState().day;
  state.history = state.history.filter(h => state.todayIndex - h.dayIndex <= 12).slice(-12);
  messages = [];
  saveState(); renderMemory(); renderChat();
  toast('已到明天，昨天的午饭已进入去重记忆');
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
      const latest = [...messages].reverse().find(m => m.result?.recommendations?.length);
      if (latest) state.skipped = [...new Set([...state.skipped, ...latest.result.recommendations.map(r => r.dishId)])];
      sendMessage('这几份先不吃，换一批符合偏好的午饭', false); break;
    }
    case 'retry': sendMessage([...messages].reverse().find(m => m.role === 'user')?.content); break;
    case 'cancel':
      activeRequest?.abort(); messages.push({ role: 'assistant', content: '已取消。可以重新告诉我今天想吃什么。' }); renderChat(true); break;
    case 'new-chat': newChat(); break;
    case 'next-day': nextDay(); break;
    case 'reset':
      activeRequest?.abort(); state = seedState(); messages = []; saveState(); renderMemory(); renderChat(); toast('已恢复演示偏好与午饭记忆'); break;
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
    activeRequest?.abort();
    state.profile = safeProfile({
      ...preferenceDraft, healthy: $('#healthyPreference').checked,
      staplePriority: $('#staplePriorityPreference').checked,
      staplePreference: $('#staplePreference').value,
      budget: Number($('#budgetPreference').value),
    });
    state.skipped = [];
    saveState(); renderMemory(); renderChat(false);
    closeModal('settingsModal');
    toast('偏好已保存，正在重新帮你挑');
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
    const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]')];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
$('#bannerArt').innerHTML = dishArt(getDish('d16'));
renderCategories(); renderStores(); renderMemory(); renderChat(); checkConnection();
