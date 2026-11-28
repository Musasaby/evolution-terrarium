// IslandRunner の遅れの消費と捨て方の確認（ブラウザ不要）
//   node tools/island-runner-check.mjs
//
// 偽の Worker・port・mirror・arch で IslandRunner を直接作り、遅い環境で
// シミュレーションが進むかを照らす。NG が 1 件でもあれば終了コード 1。
import { IslandRunner, migrationLogs } from '../src/app/island-runner.js';
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

// 移住の moves から島ごとの記録の 1 行を作る（島番号は 1 始まり）
async function testMigrationLogs() {
  const moves = [
    { to: 0, from: 2, sent: 2, placed: 2, dropped: 0 },
    { to: 1, from: 0, sent: 2, placed: 1, dropped: 1 },
    { to: 2, from: 1, sent: 2, placed: 2, dropped: 0 },
  ];
  const logs = migrationLogs(moves);
  check('migrationLogs が移住の 1 行を作る', logs[1].msg === '移住：島 1 から 1 体が移ってきて、島 3 へ 2 体が移っていった（1 体は降り立つ陸地が見つからなかった）', '（島 1 の文）', logs[1].msg);
  check('migrationLogs が島 0 の 1 行を作る', logs[0].msg === '移住：島 3 から 2 体が移ってきて、島 2 へ 2 体が移っていった', '（島 0 の文）', logs[0].msg);
}

// 見る島を切り替えると、前の島の計測を止め、新しい島にすべて送り直させる
async function testSetView() {
  const frameReply = { frame: { t: 0, climate: {}, ids: new Int32Array(0), dead: new Uint8Array(0), poses: new Float32Array(0), born: [], species: [] }, panels: null };
  function makePort() {
    const calls = [];
    return { calls, ask: async (type, payload) => { calls.push({ type, payload }); return type === 'frame' ? frameReply : {}; } };
  }
  const ports = [makePort(), makePort()];
  const infos = [0, 1].map((i) => ({ info: { index: i, seed: i, size: 80, grid: 64, settings: {} } }));
  const arch = { settings: {}, migrated: 0, dropped: 0 };
  const runner = new IslandRunner([], ports, arch, makeMirror(), 0, infos);
  await runner.setView(1);
  const lastFrame = ports[1].calls.filter((c) => c.type === 'frame').at(-1);
  const profileOff = ports[0].calls.find((c) => c.type === 'profile');
  check('setView が見る島を切り替える', runner.view === 1 && runner.mirror.index === 1, 'view=1 mirror.index=1', `view=${runner.view} mirror.index=${runner.mirror.index}`);
  check('setView が新しい島に fresh の frame を送る', lastFrame?.payload.fresh === true, 'fresh=true', JSON.stringify(lastFrame?.payload));
  check('setView が前の島の計測を止める', profileOff?.payload.on === false, 'on=false', JSON.stringify(profileOff?.payload));
}

// 全島の集計を取り寄せて、群島全体の多様性をまとめる
async function testFetchSummary() {
  const replies = [
    { summary: { living: 5, diet: [[0, 5]], groups: [{ n: 3, genomes: [] }, { n: 2, genomes: [] }] } },
    { summary: { living: 3, diet: [[1, 3]], groups: [{ n: 3, genomes: [] }] } },
  ];
  const ports = replies.map((r) => ({ ask: async (type) => (type === 'summary' ? r : {}) }));
  const arch = { settings: {}, migrated: 0, dropped: 0 };
  const runner = new IslandRunner([], ports, arch, makeMirror(), 0, [{ info: {} }, { info: {} }]);
  await runner.fetchSummary();
  const expected = '[{"index":0,"living":5,"species":2},{"index":1,"living":3,"species":1}]';
  check('fetchSummary が島ごとの集計を作る', JSON.stringify(runner.summary.islands) === expected, expected, JSON.stringify(runner.summary.islands));
  check('fetchSummary が群島全体の個体数をまとめる', runner.summary.living === 8, '8', runner.summary.living);
}

await testMigrationLogs();
await testSetView();
await testFetchSummary();

if (ng === 0) console.log('すべて OK');
else { console.log('NG あり'); process.exitCode = 1; }
