'use strict';
// 只打包共享工厂；前端交互仍在 app.js 中编辑。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'app.js');
const source = fs.readFileSync(path.join(__dirname, 'recommend-core.js'), 'utf8').trimEnd();
const start = '/* BEGIN GENERATED SHARED ENGINE */';
const end = '/* END GENERATED SHARED ENGINE */';
const current = fs.readFileSync(target, 'utf8');
const beginAt = current.indexOf(start);
const endAt = current.indexOf(end, beginAt);
if (beginAt < 0 || endAt < 0 || current.indexOf(start, beginAt + start.length) >= 0) {
  throw new Error('app.js 的共享引擎生成标记缺失或重复。');
}
const generated = `${current.slice(0, beginAt)}${start}\n${source}\n${end}${current.slice(endAt + end.length)}`;
if (process.argv.includes('--check')) {
  if (current !== generated) {
    console.error('前端共享引擎不同步，请运行 node server/build-frontend.cjs。');
    process.exitCode = 1;
  } else console.log('前端与后端共享引擎源码一致。');
} else {
  if (current !== generated) fs.writeFileSync(target, generated);
  console.log('共享引擎已打包到 app.js。');
}
