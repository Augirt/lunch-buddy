/* 午饭搭子 —— 推荐逻辑与页面交互（无依赖，直接打开 index.html 即可运行） */

const STORAGE_KEY = 'lunch-buddy-state-v1';
const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const COOKING_LABELS = {
  蒸: '清蒸', 煮: '水煮', 炖: '慢炖', 炒: '小炒', 煎: '香煎',
  烤: '烘烤', 炸: '油炸', 拌: '凉拌', 卤: '卤制', 焖: '焖制', 生: '生食',
};

let toastTimer = null;

/* ---------- state ---------- */

function seedState() {
  return {
    profile: { ...DEFAULT_PROFILE, tastes: [...DEFAULT_PROFILE.tastes], avoid: [...DEFAULT_PROFILE.avoid] },
    todayIndex: 0,
    history: SEED_HISTORY.map((entry) => ({ ...entry })),
    accepted: null,
    skipped: [],
    skipStats: { cuisines: {}, proteins: {} },
    traceOpen: true,
    dayAdvanced: false,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.profile || !Array.isArray(parsed.history)) return seedState();
    return {
      ...seedState(),
      ...parsed,
      profile: { ...DEFAULT_PROFILE, ...parsed.profile },
      skipStats: { cuisines: {}, proteins: {}, ...(parsed.skipStats || {}) },
      skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
    };
  } catch (err) {
    return seedState();
  }
}

let state = loadState();

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    /* 无痕模式或 file:// 限制下静默降级 */
  }
}

/* ---------- helpers ---------- */

const getMerchant = (id) => MERCHANTS.find((m) => m.id === id);
const getDish = (id) => DISHES.find((d) => d.id === id);
const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

function avoidLabels(ids = state.profile.avoid) {
  return ids
    .map((id) => AVOID_OPTIONS.find((option) => option.id === id))
    .filter(Boolean)
    .map((option) => option.label);
}

function dishMatchesAvoid(dish, avoidIds) {
  if (!avoidIds.length) return false;
  const terms = avoidIds.flatMap((id) => {
    const option = AVOID_OPTIONS.find((item) => item.id === id);
    return option ? option.terms : [];
  });
  return dish.ingredients.some((ingredient) => terms.some((term) => ingredient.includes(term)));
}

function entryRelativeDay(entry) {
  return state.todayIndex - entry.dayIndex;
}

function relativeDayName(rel) {
  if (rel === 0) return '今天';
  if (rel === 1) return '昨天';
  if (rel === 2) return '前天';
  return `${rel} 天前`;
}

/* 近 N 天（不含今天），按由近到远排序，用于硬去重与新鲜感 */
function getRecentEntries(days = 2) {
  return state.history
    .map((entry) => ({ ...entry, rel: entryRelativeDay(entry) }))
    .filter((entry) => entry.rel >= 1 && entry.rel <= days)
    .sort((a, b) => a.rel - b.rel);
}

/* ---------- scoring ---------- */

function scoreDish(dish, recentDishes) {
  const profile = state.profile;

  const matchedTastes = dish.tastes.filter((taste) => profile.tastes.includes(taste));
  const tasteRatio = dish.tastes.length ? matchedTastes.length / dish.tastes.length : 0;
  let taste = 28 * tasteRatio + Math.min(6, matchedTastes.length * 3);
  if (dish.tastes.includes('重辣') && !profile.tastes.includes('重辣')) taste = Math.max(0, taste - 6);

  let health = 11;
  if (profile.healthy) {
    const oilBase = dish.oil === 1 ? 22 : dish.oil === 2 ? 14 : 6;
    const cookingBonus = ['蒸', '煮', '炖', '烤'].includes(dish.cooking) ? 2 : 0;
    health = Math.max(0, Math.min(22, oilBase + cookingBonus - (dish.fried ? 6 : 0)));
  }

  const staple = dish.staple ? 14 : profile.staplePriority ? 0 : 8;

  const quality = Math.min(
    14,
    Math.max(0, (dish.rating - 4.2) * 20) + Math.min(4, dish.monthly / 300),
  );

  const speed = dish.minutes <= 25 ? 8 : dish.minutes <= 32 ? 7 : dish.minutes <= 40 ? 5 : 3;

  const sameProtein = recentDishes.some((entry) => entry.dish.protein === dish.protein);
  const sameCuisine = recentDishes.some((entry) => entry.dish.cuisine === dish.cuisine);
  let variety = 8;
  if (sameProtein) variety -= 6;
  if (sameCuisine) variety -= 3;
  variety -= (state.skipStats.cuisines[dish.cuisine] || 0) * 3;
  variety -= (state.skipStats.proteins[dish.protein] || 0) * 2;
  variety = Math.max(0, variety);

  const parts = { taste, health, staple, quality, speed, variety };
  const total = taste + health + staple + quality + speed + variety;

  return {
    dish,
    score: Math.round(total),
    total,
    parts,
    matchedTastes,
    sameProtein,
  };
}

function analyze() {
  const openMerchants = MERCHANTS.filter((merchant) => merchant.open);
  const recall = DISHES.filter((dish) => openMerchants.some((merchant) => merchant.id === dish.merchantId));

  const avoidRemoved = recall.filter((dish) => dishMatchesAvoid(dish, state.profile.avoid));
  const afterAvoid = recall.filter((dish) => !avoidRemoved.includes(dish));

  const budgetRemoved = afterAvoid.filter((dish) => dish.price > state.profile.budget);
  const afterBudget = afterAvoid.filter((dish) => dish.price <= state.profile.budget);

  const recentEntries = getRecentEntries(2);
  const recentDishes = recentEntries
    .map((entry) => ({ ...entry, dish: getDish(entry.dishId) }))
    .filter((entry) => entry.dish);

  const historyRemoved = afterBudget.filter((dish) =>
    recentDishes.some((entry) => entry.dish.main === dish.main),
  );
  const afterHistory = afterBudget.filter((dish) => !historyRemoved.includes(dish));

  const scored = afterHistory
    .map((dish) => scoreDish(dish, recentDishes))
    .sort((a, b) => b.total - a.total || b.dish.rating - a.dish.rating || a.dish.price - b.dish.price);

  const visible = scored.filter((item) => !state.skipped.includes(item.dish.id));

  return {
    openMerchants,
    closedMerchants: MERCHANTS.length - openMerchants.length,
    recall,
    avoidRemoved,
    budgetRemoved,
    afterAvoid,
    afterBudget,
    recentDishes,
    historyRemoved,
    afterHistory,
    scored,
    visible,
    skippedCount: state.skipped.length,
  };
}

/* ---------- reason copy ---------- */

function buildReasons(item, data) {
  const { dish } = item;
  const profile = state.profile;
  const reasons = [];

  if (item.matchedTastes.length) {
    reasons.push(`口味命中「${item.matchedTastes.join('、')}」`);
  }
  if (profile.healthy) {
    if (dish.fried) {
      reasons.push('今天先不选炸物，换一顿轻一点的');
    } else if (dish.oil === 1) {
      reasons.push(`${COOKING_LABELS[dish.cooking] || dish.cooking}做法，少油不腻`);
    } else {
      reasons.push('不是油炸，油量适中');
    }
  }
  if (dish.staple && profile.staplePriority) {
    reasons.push(`配${dish.staple}，一顿能吃饱`);
  }
  if (data.recentDishes.length && !item.sameProtein) {
    reasons.push('主料和近两天不同，换换口味');
  }
  if (dish.rating >= 4.6) {
    reasons.push(`${dish.rating} 分，月售 ${dish.monthly}+`);
  }
  if (reasons.length < 4) {
    reasons.push(`${dish.minutes} 分钟送到，不耽误午休`);
  }
  if (reasons.length < 3) {
    reasons.push('来自平台营业商家，今天可配送');
  }
  return reasons.slice(0, 4);
}

function avoidLine(data) {
  const labels = avoidLabels();
  const parts = [];
  if (labels.length) parts.push(`含${labels.join('、')}的菜`);
  if (data.recentDishes.length) {
    parts.push(`近两天的主菜（${data.recentDishes.map((entry) => entry.dish.name).join('、')}）`);
  }
  if (!parts.length) return '没有设置忌口，也没有近期记录，今天可以放心尝鲜。';
  return `筛选时已排除：${parts.join('；')}。`;
}

/* ---------- render: header ---------- */

function renderHeader(data) {
  const now = new Date();
  now.setDate(now.getDate() + state.todayIndex);
  const label = `${now.getMonth() + 1}月${now.getDate()}日 ${DAY_NAMES[now.getDay()]}`;
  $('#dateLabel').textContent = state.todayIndex > 0 ? `${label} · 模拟` : label;

  const tastes = state.profile.tastes.length ? state.profile.tastes.join(' · ') : '口味不限';
  const labels = avoidLabels();
  const chips = [
    { text: tastes, accent: true },
    { text: labels.length ? `不吃 ${labels.join('、')}` : '无忌口' },
    { text: state.profile.healthy ? '少油少炸' : '不限制油' },
    { text: state.profile.staplePriority ? '主食优先' : '主食随意' },
    { text: `≤ ¥${state.profile.budget}` },
  ];
  $('#heroChips').innerHTML = chips
    .map((chip) => `<span class="hero-chip ${chip.accent ? 'chip-accent' : ''}">${escapeHtml(chip.text)}</span>`)
    .join('');
}

/* ---------- render: profile controls ---------- */

function renderProfile() {
  $('#tasteChips').innerHTML = TASTE_OPTIONS.map((taste) => `
    <button class="chip" type="button" data-action="toggle-taste" data-value="${escapeHtml(taste)}"
      aria-pressed="${state.profile.tastes.includes(taste)}">${escapeHtml(taste)}</button>
  `).join('');

  $('#avoidChips').innerHTML = AVOID_OPTIONS.map((option) => `
    <button class="chip" type="button" data-action="toggle-avoid" data-value="${option.id}"
      aria-pressed="${state.profile.avoid.includes(option.id)}">${escapeHtml(option.label)}</button>
  `).join('');

  const healthySwitch = $('[data-action="toggle-healthy"]');
  const stapleSwitch = $('[data-action="toggle-staple"]');
  healthySwitch.setAttribute('aria-checked', String(state.profile.healthy));
  stapleSwitch.setAttribute('aria-checked', String(state.profile.staplePriority));

  const range = $('#budgetRange');
  if (Number(range.value) !== state.profile.budget) range.value = state.profile.budget;
  $('#budgetOut').textContent = `¥${state.profile.budget} 以内`;
}

/* ---------- render: main pick ---------- */

function renderPick(data) {
  const container = $('#pickSection');

  if (state.accepted) {
    const dish = getDish(state.accepted);
    if (dish) {
      const merchant = getMerchant(dish.merchantId);
      const item = data.scored.find((entry) => entry.dish.id === dish.id) || scoreDish(dish, data.recentDishes);
      container.innerHTML = pickCardHtml(dish, merchant, item, data, true);
      return;
    }
  }

  if (!data.visible.length) {
    container.innerHTML = emptyCardHtml(data);
    return;
  }

  const item = data.visible[0];
  const dish = item.dish;
  const merchant = getMerchant(dish.merchantId);
  container.innerHTML = pickCardHtml(dish, merchant, item, data, false);
}

function pickCardHtml(dish, merchant, item, data, accepted) {
  const reasons = buildReasons(item, data);
  const tags = [
    ...dish.tastes,
    `做法 · ${dish.cooking}`,
    dish.staple ? `配${dish.staple}` : '无主食',
  ];

  const actions = accepted
    ? `<div class="actions">
         <button class="btn-primary btn-done" type="button" disabled>✓ 已记录，开饭</button>
         <button class="btn-ghost" type="button" data-action="unaccept">改主意，换一道</button>
       </div>
       <p class="swap-hint">已写入今天的午饭记忆 · 48 小时内不会再推荐同一道主菜</p>`
    : `<div class="actions">
         <button class="btn-primary" type="button" data-action="accept" data-dish="${dish.id}">
           就吃这个 <span>→</span>
         </button>
         <button class="btn-ghost" type="button" data-action="reroll">换一个</button>
       </div>
       <p class="swap-hint">换掉的选择会轻微降低同菜系的排序 · 本次已换 <b>${data.skippedCount}</b> 次</p>`;

  return `
    <article class="pick-card">
      <div class="pick-top">
        <div class="merchant">
          <span class="merchant-mark">${escapeHtml(merchant.mark)}</span>
          <div class="merchant-meta">
            <strong>${escapeHtml(merchant.name)}</strong>
            <span>${escapeHtml(merchant.category)} · ${merchant.distance}km · 月售 ${merchant.monthly}+</span>
          </div>
        </div>
        <div class="match">
          <div class="match-ring" style="--score:${item.score}"><b>${item.score}</b></div>
          <small>匹配度<br />（满分 100）</small>
        </div>
      </div>

      <div class="dish-visual tone-${dish.tone}">
        <span class="dish-emoji" aria-hidden="true">${dish.emoji}</span>
        <span class="visual-label">${accepted ? '今天已定' : '今日首选'}</span>
        <span class="visual-note">从 ${data.recall.length} 道候选里挑出</span>
      </div>

      <div class="dish-body">
        ${accepted ? `<div class="accepted-strip">✓ 今天午饭已定<span>已同步到午饭记忆</span></div>` : ''}
        <div class="dish-title-row">
          <div>
            <h2>${escapeHtml(dish.name)}</h2>
            <p class="dish-desc">${escapeHtml(dish.desc)}</p>
          </div>
          <div class="dish-price"><span>¥</span>${dish.price}</div>
        </div>

        <div class="tag-row">
          ${tags.map((tag, index) => `<span class="tag ${index === tags.length - 1 ? 'tag-main' : ''}">${escapeHtml(tag)}</span>`).join('')}
        </div>

        <div class="meta-row">
          <span class="star">★ ${dish.rating}</span>
          <span class="dot"></span>
          <span>月售 ${dish.monthly}</span>
          <span class="dot"></span>
          <span>${dish.minutes} 分钟送达</span>
          <span class="dot"></span>
          <span>${merchant.distance}km</span>
        </div>

        <div class="why-box">
          <div class="why-head">为什么是它</div>
          <ul>
            ${reasons.map((reason) => `<li><span class="check">✓</span><span>${escapeHtml(reason)}</span></li>`).join('')}
          </ul>
        </div>

        <div class="avoid-line">
          <svg class="shield" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
            <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
          </svg>
          <span>${escapeHtml(avoidLine(data))}</span>
        </div>

        ${actions}
      </div>
    </article>
  `;
}

function emptyCardHtml(data) {
  const noCandidates = data.scored.length === 0;
  return `
    <div class="empty-card">
      <div class="empty-emoji">${noCandidates ? '🥲' : '🙈'}</div>
      <h2>${noCandidates ? '筛得太狠，一道都没剩下' : '今天的候选都被你换完了'}</h2>
      <p>${noCandidates
        ? '试试放宽预算，或者少勾两个忌口。真实产品里，这时会降低约束权重而不是直接空白。'
        : '你已经把今天能推的都看了一遍。可以恢复刚才换掉的，或者从头再挑一次。'}</p>
      <div class="empty-actions">
        ${noCandidates
          ? '<button class="btn-primary" type="button" data-action="widen-budget">预算放宽到 ¥60</button>'
          : '<button class="btn-primary" type="button" data-action="undo-skip">恢复刚才换掉的</button>'}
        <button class="btn-ghost" type="button" data-action="reset">重置演示</button>
      </div>
    </div>
  `;
}

/* ---------- render: runners ---------- */

function renderRunners(data) {
  const container = $('#runnerSection');

  if (state.accepted) {
    container.innerHTML = '';
    return;
  }

  const runners = data.visible.slice(1, 3);
  if (!runners.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <section class="runner-section">
      <div class="section-head">
        <h3>也可以看看</h3>
        <span>备选 ${runners.length} 道</span>
      </div>
      <div class="runner-grid">
        ${runners.map((item) => {
          const merchant = getMerchant(item.dish.merchantId);
          return `
            <article class="runner-card">
              <div class="runner-emoji tone-${item.dish.tone}">${item.dish.emoji}</div>
              <div class="runner-body">
                <strong>${escapeHtml(item.dish.name)}</strong>
                <p>${escapeHtml(item.dish.tastes.join(' · '))} · ${escapeHtml(item.dish.cooking)} · ¥${item.dish.price}<br />${escapeHtml(merchant.name)}</p>
                <div class="runner-foot">
                  <span class="runner-score">匹配 ${item.score}</span>
                  <button class="runner-btn" type="button" data-action="accept" data-dish="${item.dish.id}">选它</button>
                </div>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

/* ---------- render: agent trace ---------- */

function renderTrace(data) {
  const container = $('#traceSection');
  const focus = state.accepted
    ? data.scored.find((item) => item.dish.id === state.accepted) || null
    : data.visible[0] || null;

  if (!data.recall.length) {
    container.innerHTML = '';
    return;
  }

  const topThree = data.scored.slice(0, 3);
  const stepOneChips = [
    ...state.profile.tastes,
    ...avoidLabels().map((label) => `不吃${label}`),
    `≤ ¥${state.profile.budget}`,
    state.profile.healthy ? '少油少炸' : '不限油',
  ];

  const historyDetail = data.historyRemoved.length
    ? `硬性排除：${data.historyRemoved.map((dish) => dish.name).join('、')}（${data.recentDishes.map((entry) => `${entry.dish.name}=${relativeDayName(entry.rel)}`).join('，')}）`
    : data.recentDishes.length
      ? '近两天没有相同主菜，无需排除。'
      : '近两天没有午饭记录，这顿可以随便尝鲜。';

  const avoidDetail = data.avoidRemoved.length || data.budgetRemoved.length
    ? `忌口排除 ${data.avoidRemoved.length} 道${data.avoidRemoved.length ? `（${data.avoidRemoved.slice(0, 3).map((dish) => dish.name).join('、')}${data.avoidRemoved.length > 3 ? ' 等' : ''}）` : ''}；超预算 ${data.budgetRemoved.length} 道。`
    : '没有菜品踩中忌口或超预算。';

  const scoreRows = focus ? [
    ['口味匹配', focus.parts.taste, 34],
    ['健康少油', focus.parts.health, 22],
    ['有主食', focus.parts.staple, 14],
    ['口碑销量', focus.parts.quality, 14],
    ['送达时效', focus.parts.speed, 8],
    ['新鲜感', focus.parts.variety, 8],
  ] : [];

  container.innerHTML = `
    <details class="trace" ${state.traceOpen ? 'open' : ''}>
      <summary>
        <div class="trace-title">
          <span class="trace-eyebrow">AGENT TRACE</span>
          <strong>这碗饭是怎么挑出来的</strong>
        </div>
        <div class="trace-funnel">
          <b>${data.recall.length} 道</b><span>→</span><b>${data.afterHistory.length} 道</b><span>→</span><b>1 道</b>
        </div>
        <span class="chev" aria-hidden="true">⌄</span>
      </summary>

      <div class="trace-body">
        <ol class="steps">
          <li class="step">
            <span class="step-num">1</span>
            <div class="step-main">
              <div class="step-head"><strong>读取你的偏好档案</strong><span class="step-count">每次推荐前读取</span></div>
              <p>口味、忌口、预算和健康偏好，全部转成可执行的筛选与打分条件。</p>
              <div class="step-chips">${stepOneChips.map((chip) => `<span class="step-chip">${escapeHtml(chip)}</span>`).join('')}</div>
              <div class="step-bar"><i style="width:100%"></i></div>
            </div>
          </li>

          <li class="step">
            <span class="step-num">2</span>
            <div class="step-main">
              <div class="step-head"><strong>召回商家库</strong><span class="step-count"><b>${data.recall.length}</b> 道菜</span></div>
              <p>${data.openMerchants.length} 家营业中商家，共 ${data.recall.length} 道可售菜品；跳过 ${data.closedMerchants} 家休息中的店。</p>
              <div class="step-bar"><i style="width:100%"></i></div>
            </div>
          </li>

          <li class="step">
            <span class="step-num">3</span>
            <div class="step-main">
              <div class="step-head"><strong>硬性排除忌口与超预算</strong><span class="step-count">剩 <b>${data.afterBudget.length}</b> 道</span></div>
              <p>${escapeHtml(avoidDetail)}</p>
              <div class="step-bar"><i style="width:${Math.max(4, (data.afterBudget.length / data.recall.length) * 100)}%"></i></div>
            </div>
          </li>

          <li class="step">
            <span class="step-num">4</span>
            <div class="step-main">
              <div class="step-head"><strong>用午饭记忆去重</strong><span class="step-count">剩 <b>${data.afterHistory.length}</b> 道</span></div>
              <p>${escapeHtml(historyDetail)}</p>
              <div class="step-bar"><i style="width:${Math.max(4, (data.afterHistory.length / data.recall.length) * 100)}%"></i></div>
            </div>
          </li>

          <li class="step">
            <span class="step-num">5</span>
            <div class="step-main">
              <div class="step-head"><strong>按偏好综合打分</strong><span class="step-count">Top ${topThree.length}</span></div>
              ${topThree.length
                ? `<div class="top-picks">${topThree.map((item, index) => `<span class="top-pick">${index + 1}. ${escapeHtml(item.dish.name)} <b>${item.score}</b></span>`).join('')}</div>`
                : '<p>暂时没有可打分的候选。</p>'}
              ${data.skippedCount ? `<p>你本次换掉 ${data.skippedCount} 道，同菜系已轻微降权。</p>` : ''}
              <div class="step-chips">
                <span class="step-chip">口味 34</span>
                <span class="step-chip">健康 22</span>
                <span class="step-chip">主食 14</span>
                <span class="step-chip">口碑 14</span>
                <span class="step-chip">时效 8</span>
                <span class="step-chip">新鲜感 8</span>
              </div>
              <div class="step-bar"><i style="width:14%"></i></div>
            </div>
          </li>

          <li class="step">
            <span class="step-num">6</span>
            <div class="step-main">
              <div class="step-head"><strong>生成推荐与解释</strong><span class="step-count"><b>1</b> 个首选 + 2 个备选</span></div>
              <p>把「为什么是它」「避开了什么」讲清楚，让你不用再翻菜单，也知道自己在吃什么。</p>
              <div class="step-bar"><i style="width:7%"></i></div>
            </div>
          </li>
        </ol>

        ${focus ? `
          <div class="score-breakdown">
            <div class="score-head">
              <strong>「${escapeHtml(focus.dish.name)}」得分构成</strong>
              <span>总分 ${Math.round(focus.total)} / 100</span>
            </div>
            ${scoreRows.map(([label, value, max]) => `
              <div class="score-row">
                <span>${label}</span>
                <div class="bar"><i style="width:${Math.round((value / max) * 100)}%"></i></div>
                <b>${Math.round(value)} / ${max}</b>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <p class="trace-foot">Demo 使用本地模拟商家库与可解释规则排序，不调用大模型。接入真实平台后，可保留这套约束层，把偏好解析与推荐文案交给模型，再叠加 CTR / 复购等线上信号。</p>
      </div>
    </details>
  `;

  const details = $('.trace', container);
  if (details) {
    details.addEventListener('toggle', () => { state.traceOpen = details.open; saveState(); });
  }
}

/* ---------- render: history ---------- */

function renderTimeline() {
  const container = $('#historyTimeline');
  const todayDish = state.accepted ? getDish(state.accepted) : null;
  const rows = [];

  rows.push({
    label: '今天',
    emoji: todayDish ? todayDish.emoji : '·',
    name: todayDish ? todayDish.name : '还没定',
    meta: todayDish ? `${getMerchant(todayDish.merchantId).name} · ¥${todayDish.price}` : '定完会自动记住',
    today: true,
    empty: !todayDish,
  });

  const past = state.history
    .map((entry) => ({ ...entry, rel: entryRelativeDay(entry) }))
    .filter((entry) => entry.rel >= 1)
    .sort((a, b) => a.rel - b.rel)
    .slice(0, 2);

  past.forEach((entry) => {
    const dish = getDish(entry.dishId);
    if (!dish) return;
    rows.push({
      label: relativeDayName(entry.rel),
      emoji: dish.emoji,
      name: dish.name,
      meta: `${getMerchant(dish.merchantId).name} · ¥${dish.price}`,
      empty: false,
    });
  });

  if (!past.length) {
    rows.push({ label: '更早', emoji: '·', name: '还没有记录', meta: '先定今天的午饭', empty: true });
  }

  container.innerHTML = rows.map((row) => `
    <div class="tl-item ${row.today ? 'is-today' : ''} ${row.empty ? 'is-empty' : ''}">
      <span class="tl-day">${row.label}</span>
      <span class="tl-emoji">${row.emoji}</span>
      <div class="tl-content">
        <strong>${escapeHtml(row.name)}</strong>
        <small>${escapeHtml(row.meta)}</small>
      </div>
    </div>
  `).join('');
}

/* ---------- actions ---------- */

function renderAll() {
  const data = analyze();
  renderHeader(data);
  renderProfile();
  renderPick(data);
  renderRunners(data);
  renderTrace(data);
  renderTimeline();
  saveState();
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function resetSkips() {
  state.skipped = [];
  state.skipStats = { cuisines: {}, proteins: {} };
}

function acceptDish(dishId) {
  const dish = getDish(dishId);
  if (!dish) return;
  state.history = state.history.filter((entry) => entryRelativeDay(entry) !== 0);
  state.history.push({ dishId, dayIndex: state.todayIndex });
  state.accepted = dishId;
  saveState();
  renderAll();
  showSuccessModal(dish);
}

function showSuccessModal(dish) {
  const merchant = getMerchant(dish.merchantId);
  $('#successEmoji').textContent = dish.emoji;
  $('#successDish').textContent = `${dish.name} · ${merchant.name} · ¥${dish.price}`;
  const modal = $('#successModal');
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  const ok = $('.modal-ok', modal);
  if (ok) ok.focus({ preventScroll: true });
}

function closeModal() {
  const modal = $('#successModal');
  modal.hidden = true;
  document.body.style.overflow = '';
}

function reroll() {
  const data = analyze();
  const current = data.visible[0];
  if (!current) return;
  const { dish } = current;
  state.skipped.push(dish.id);
  state.skipStats.cuisines[dish.cuisine] = (state.skipStats.cuisines[dish.cuisine] || 0) + 1;
  state.skipStats.proteins[dish.protein] = (state.skipStats.proteins[dish.protein] || 0) + 1;
  saveState();
  renderAll();
  if (state.skipped.length === 3) {
    toast('已换 3 道：同类菜系正在被降权，下一份会更不一样');
  }
}

function undoSkip() {
  const last = state.skipped.pop();
  if (last) {
    const dish = getDish(last);
    if (dish) {
      state.skipStats.cuisines[dish.cuisine] = Math.max(0, (state.skipStats.cuisines[dish.cuisine] || 0) - 1);
      state.skipStats.proteins[dish.protein] = Math.max(0, (state.skipStats.proteins[dish.protein] || 0) - 1);
    }
  }
  renderAll();
}

function unaccept() {
  const current = state.accepted ? getDish(state.accepted) : null;
  state.history = state.history.filter((entry) => entryRelativeDay(entry) !== 0);
  state.accepted = null;
  if (current) {
    state.skipped.push(current.id);
    state.skipStats.cuisines[current.cuisine] = (state.skipStats.cuisines[current.cuisine] || 0) + 1;
    state.skipStats.proteins[current.protein] = (state.skipStats.proteins[current.protein] || 0) + 1;
  }
  saveState();
  renderAll();
  closeModal();
  toast('已撤销，再挑一道');
}

function nextDay() {
  const todayDish = state.accepted ? getDish(state.accepted) : null;
  state.todayIndex += 1;
  state.accepted = null;
  resetSkips();
  state.dayAdvanced = true;
  // 只保留最近 10 条记忆，避免演示时间线无限变长
  state.history = state.history
    .filter((entry) => entryRelativeDay(entry) <= 12)
    .sort((a, b) => b.dayIndex - a.dayIndex)
    .slice(0, 10)
    .sort((a, b) => a.dayIndex - b.dayIndex);
  saveState();
  renderAll();
  toast(todayDish
    ? `已到明天 · 新推荐会避开今天的「${todayDish.name}」`
    : '已到明天 · 午饭记忆继续生效');
}

function resetDemo() {
  state = seedState();
  resetSkips();
  saveState();
  renderAll();
  closeModal();
  toast('已恢复初始演示数据');
}

/* ---------- events ---------- */

document.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-action="toggle-taste"], [data-action="toggle-avoid"]');
  if (chip) {
    const value = chip.dataset.value;
    if (chip.dataset.action === 'toggle-taste') {
      const list = state.profile.tastes;
      const index = list.indexOf(value);
      if (index >= 0) list.splice(index, 1); else list.push(value);
    } else {
      const list = state.profile.avoid;
      const index = list.indexOf(value);
      if (index >= 0) list.splice(index, 1); else list.push(value);
    }
    resetSkips();
    renderAll();
    return;
  }

  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  switch (action) {
    case 'accept':
      acceptDish(target.dataset.dish);
      break;
    case 'reroll':
      reroll();
      break;
    case 'undo-skip':
      undoSkip();
      break;
    case 'unaccept':
      unaccept();
      break;
    case 'next-day':
      nextDay();
      break;
    case 'reset':
      resetDemo();
      break;
    case 'toggle-healthy':
      state.profile.healthy = !state.profile.healthy;
      resetSkips();
      renderAll();
      break;
    case 'toggle-staple':
      state.profile.staplePriority = !state.profile.staplePriority;
      resetSkips();
      renderAll();
      break;
    case 'widen-budget':
      state.profile.budget = 60;
      resetSkips();
      renderAll();
      toast('预算已放宽到 ¥60，重新筛一遍');
      break;
    case 'close-modal':
      closeModal();
      break;
    default:
      break;
  }
});

$('#budgetRange').addEventListener('input', (event) => {
  $('#budgetOut').textContent = `¥${event.target.value} 以内`;
});

$('#budgetRange').addEventListener('change', (event) => {
  state.profile.budget = Number(event.target.value);
  resetSkips();
  renderAll();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#successModal').hidden) closeModal();
});

/* ---------- boot ---------- */

renderAll();

if (state.dayAdvanced) {
  state.dayAdvanced = false;
  saveState();
}
