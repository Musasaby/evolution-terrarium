// IslandRunner の遅れの消費と捨て方の確認（ブラウザ不要）
//   node tools/island-runner-check.mjs
//
// 偽の Worker・port・mirror・arch で IslandRunner を直接作り、遅い環境で
// シミュレーションが進むかを照らす。NG が 1 件でもあれば終了コード 1。
import { IslandRunner } from '../src/app/island-runner.js';
import { CFG, ParallelArchipelago } from '../src/sim/index.js';

let ng = 0;
function check(name, cond, expected, actual) {
  if (cond) console.log(`OK ${name}`);
  else { ng++; console.log(`NG ${name}: ${expected} / ${actual}`); }
}

function makeMirror() { return { applyFrame() {}, applyPanels() {}, dispose() {} }; }

// 応答がすぐ返る場合：1 フレームでためる時間が MAX_BACKLOG を超えても進む
async function testFastResponse() {
  let total = 0;
  const workers = [];
  const ports = [{ ask: async () => ({ frame: null }) }];
  const mirror = makeMirror();
  const arch = { settings: {}, advance: async (n) => { total += n; } };
  const runner = new IslandRunner(workers, ports, arch, mirror, 0);
  for (let i = 0; i < 40; i++) {
    runner.advance(0.125, 8);
    await new Promise((r) => setTimeout(r, 0));
  }
  check('応答がすぐ返る場合に進む', total * CFG.DT > 0, '> 0', total * CFG.DT);
}

// 応答が 3 フレームに 1 回しか返らない場合：待ちの間も遅れをためて進み続ける
async function testSlowResponse() {
  let total = 0;
  const pending = [];
  const workers = [];
  const ports = [{ ask: async () => ({ frame: null }) }];
  const mirror = makeMirror();
  const arch = {
    settings: {},
    advance: (n) => { total += n; return new Promise((res) => pending.push(res)); },
  };
  const runner = new IslandRunner(workers, ports, arch, mirror, 0);
  for (let i = 0; i < 180; i++) {
    runner.advance(1 / 60, 8);
    if ((i + 1) % 3 === 0) {
      const ps = pending.splice(0);
      for (const res of ps) res();
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  check('応答が 3 フレームに 1 回でも進む', total > 0, '> 0', total);
}

// 移住のたびに onMigrate が島ごとの行き来を受け取る
async function testOnMigrate() {
  const ports = [0, 1, 2].map((i) => ({ ask: async (type) => {
    if (type === 'run') return { computeMs: 0 };
    if (type === 'emigrate') return { migrants: [{}, {}] };
    return i === 1 ? { placed: 1, dropped: 1 } : { placed: 2, dropped: 0 };
  } }));
  const arch = new ParallelArchipelago(ports, 1, { islands: 3, migrateEvery: 10, migrants: 2 });
  const calls = [];
  arch.onMigrate = (moves, step) => calls.push({ moves, step });
  await arch.advance(10);
  const expected = JSON.stringify([{ moves: [
    { to: 0, from: 2, sent: 2, placed: 2, dropped: 0 },
    { to: 1, from: 0, sent: 2, placed: 1, dropped: 1 },
    { to: 2, from: 1, sent: 2, placed: 2, dropped: 0 }], step: 10 }]);
  check('onMigrate が島ごとの行き来を受け取る', JSON.stringify(calls) === expected, expected, JSON.stringify(calls));
}

await testFastResponse();
await testSlowResponse();
await testOnMigrate();

if (ng === 0) console.log('すべて OK');
else { console.log('NG あり'); process.exitCode = 1; }
