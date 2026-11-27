// 見ている島の写し（island-snapshot の packFrame と sim-mirror の SimMirror）の動作確認（ブラウザ不要）
//   node tools/mirror-check.mjs              … 既定 300 ステップ・シード 20261007
//   node tools/mirror-check.mjs 600 1        … ステップ数とシードを指定
//
// 100 ステップごとに packFrame → structuredClone → mirror.applyFrame を行い、
// 写しが Sim と同じ個体・姿勢・気候を持つかを照らす。NG が 1 件でもあれば終了コード 1。
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim } from '../src/sim/index.js';
import { createSentState, packFrame } from '../src/app/island-snapshot.js';
import { SimMirror } from '../src/app/sim-mirror.js';

const steps = +(process.argv[2] ?? 300);
const seed = +(process.argv[3] ?? 20261007);
await RAPIER.init();

const sim = new Sim(RAPIER, seed);
const sent = createSentState();
const mirror = new SimMirror({ index: 0, seed, size: sim.size, grid: sim.grid, settings: sim.settings });

let ng = 0;
function check(name, cond, expected, actual) {
  if (cond) console.log(`OK ${name}`);
  else { ng++; console.log(`NG ${name}: ${expected} / ${actual}`); }
}

function compareFrame() {
  const live = sim.creatures.filter((c) => c.alive);
  const simIds = live.map((c) => c.id);
  const mirrorIds = mirror.creatures.map((c) => c.id);
  const idsSame = simIds.length === mirrorIds.length && simIds.every((id, i) => id === mirrorIds[i]);
  check('個体の並び', idsSame, simIds.join(','), mirrorIds.join(','));

  const simDead = live.filter((c) => c.dead).length;
  const mirrorDead = mirror.creatures.filter((c) => c.dead).length;
  check('死骸の数', simDead === mirrorDead, simDead, mirrorDead);

  let posOk = true, rotOk = true, posWorst = 0, rotWorst = 0;
  let spOk = true;
  const spBad = [];
  for (let j = 0; j < live.length; j++) {
    const a = live[j], b = mirror.creatures[j];
    if (!b || a.pos.length !== b.pos.length) { posOk = false; rotOk = false; posWorst = Infinity; continue; }
    for (let i = 0; i < a.pos.length; i++) {
      const dp = Math.max(Math.abs(a.pos[i].x - b.pos[i].x), Math.abs(a.pos[i].y - b.pos[i].y), Math.abs(a.pos[i].z - b.pos[i].z));
      const dr = Math.max(Math.abs(a.rot[i].x - b.rot[i].x), Math.abs(a.rot[i].y - b.rot[i].y), Math.abs(a.rot[i].z - b.rot[i].z), Math.abs(a.rot[i].w - b.rot[i].w));
      if (dp > posWorst) posWorst = dp;
      if (dr > rotWorst) rotWorst = dr;
      if (dp > 1e-4) posOk = false;
      if (dr > 1e-4) rotOk = false;
    }
    if ((a.species?.name ?? null) !== (b.species?.name ?? null)) { spOk = false; spBad.push(`${a.id}:${a.species?.name}/${b.species?.name}`); }
  }
  check('姿勢 pos', posOk, '差 <= 1e-4', posWorst);
  check('姿勢 rot', rotOk, '差 <= 1e-4', rotWorst);
  check('種名', spOk, 'すべて一致', spBad.join(','));

  const dt = Math.abs(mirror.climate.tempAtHeight(5) - sim.climate.tempAtHeight(5));
  check('気候 気温', dt <= 1e-6, '差 <= 1e-6', dt);
  check('気候 氷河期', mirror.climate.iceAge === sim.climate.iceAge, sim.climate.iceAge, mirror.climate.iceAge);
  check('季節', mirror.seasonName() === sim.seasonName(), sim.seasonName(), mirror.seasonName());
  check('年', mirror.year === sim.year, sim.year, mirror.year);
}

for (let i = 0; i < steps; i++) {
  sim.step();
  if ((i + 1) % 100 === 0) {
    const { packet } = packFrame(sim, sent);
    mirror.applyFrame(structuredClone(packet));
    compareFrame();
  }
}

if (ng === 0) console.log('すべて OK');
else { console.log(`NG が ${ng} 件`); process.exitCode = 1; }
