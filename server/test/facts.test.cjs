const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePicks } = require('../model.cjs');

test('[defect-probing] 菜单未证实的营养过敏价格保证不能通过', () => {
  assert.throws(() => validatePicks({
    summary: '为你挑选今天的午饭。',
    picks: [{ dish_id: 'd1', matched: ['咸鲜'], reason: '只有100千卡，保证无过敏原，特价1元。' }],
  }, [{ dish_id: 'd1', facts: ['咸鲜'] }]));
});
test('V2只接受对应菜事实和理由代码，多余自由字段拒绝', () => {
  const candidates = [{ dish_id: 'd1', facts: ['咸鲜', '价格：32元'], supported_rationale_codes: ['taste_match'] }];
  const valid = { picks: [{ dish_id: 'd1', matched: ['咸鲜', '咸鲜'], rationale_codes: ['taste_match'] }] };
  assert.deepEqual(validatePicks(valid, candidates, true).picks[0].matched, ['咸鲜']);
  for (const bad of [
    { ...valid, summary: '100千卡' },
    { picks: [{ ...valid.picks[0], reason: '无过敏原保证' }] },
    { picks: [{ ...valid.picks[0], matched: ['价格：1元'] }] },
    { picks: [{ ...valid.picks[0], rationale_codes: ['less_oil'] }] },
  ]) assert.throws(() => validatePicks(bad, candidates, true));
});
