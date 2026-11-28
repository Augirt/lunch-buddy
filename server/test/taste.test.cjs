const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyTasteIntent } = require('../index.cjs');

test('[defect-probing] 单独不想吃辣应落到清淡', () => {
  assert.deepEqual(applyTasteIntent({ tastes: ['微辣'] }, '不想吃辣').tastes, ['清淡']);
});
test('[defect-probing] 否定清淡不能被映射为清淡', () => {
  assert.deepEqual(applyTasteIntent({ tastes: ['重辣'] }, '不要清淡，我要重辣').tastes, ['重辣']);
});
