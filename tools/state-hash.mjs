// シミュレーションの状態ハッシュ。同じシード・同じステップ数なら必ず同じ値になる。
// 振る舞いを変えない変更では、変更前後でこのハッシュが一致することを確かめる。
import { createHash } from 'node:crypto';

export function stateHash(sim) {
  const h = createHash('sha1');
  const r = (v) => Math.round(v * 1e4) / 1e4;
  h.update(JSON.stringify({ t: r(sim.t), counters: sim.counters, nsp: sim.species.size, ev: sim.events.map(e => e.msg) }));
  for (const c of sim.creatures) {
    h.update(`${c.id}|${c.alive}|${c.dead}|${r(c.energy)}|${c.species?.id}|${c.gen}`);
    if (c.bodies[0]) { const t = c.bodies[0].translation(); h.update(`${r(t.x)},${r(t.y)},${r(t.z)}`); }
  }
  for (const p of sim.plants) h.update(`${p.id}|${r(p.energy)}`);
  h.update(Array.from(sim.H, r).join(','));
  return h.digest('hex').slice(0, 16);
}
