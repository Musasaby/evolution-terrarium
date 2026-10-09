// ===== 種分化：生物学的種概念による種の判定 =====
import { CFG } from './config.js';
import { compatibility, recognizes } from './genetics.js';
import { newSpecies, isLiving } from './creatures.js';

// 互いを配偶相手と認め、かつ雑種が育つか（交配前と交配後の両方の隔離を考える）
export function interfertile(a, b) {
  return compatibility(a, b) * Math.sqrt(recognizes(a, b) * recognizes(b, a)) >= CFG.FERTILE;
}

// 互いに子を残せる個体のつながりを1つの種とし、つながりが切れた集団を新種として分ける
export function updateSpecies(sim) {
  const bySp = new Map();
  for (const c of sim.creatures) if (isLiving(c)) (bySp.get(c.species) || bySp.set(c.species, []).get(c.species)).push(c);
  for (const [sp, mem] of bySp) {
    if (mem.length < 4) continue;
    const n = mem.length, comp = new Int32Array(n).fill(-1);
    let nc = 0;
    for (let i = 0; i < n; i++) {
      if (comp[i] >= 0) continue;
      const stack = [i]; comp[i] = nc;
      while (stack.length) {
        const u = stack.pop();
        for (let v = 0; v < n; v++) if (comp[v] < 0 && interfertile(mem[u].genome, mem[v].genome)) { comp[v] = nc; stack.push(v); }
      }
      nc++;
    }
    if (nc < 2) continue;
    const groups = Array.from({ length: nc }, () => []);
    mem.forEach((c, i) => groups[comp[i]].push(c));
    groups.sort((a, b) => b.length - a.length);
    for (const g of groups.slice(1)) {
      if (g.length < 2) continue; // 1体だけ外れた個体は集団とみなさない
      const nsp = newSpecies(sim, g[0].genome, sp, true);
      for (const c of g) { c.species = nsp; sp.count--; nsp.count++; nsp.total++; }
      nsp.peak = nsp.count;
      sim.log(`「${sp.name}」の一部（${g.length}体）が生殖的に隔離され、新種「${nsp.name}」になった`, 'species');
    }
  }
  for (const [k, v] of sim.rejectUntil) if (v < sim.t) sim.rejectUntil.delete(k);
}
