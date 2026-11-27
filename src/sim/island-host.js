// ===== 1 つの島：Sim と由来キーを持ち、移出・移入を行う（1 スレッド版と Worker 版で共通） =====
import { Sim } from './sim.js';
import { makeRng } from './random.js';
import { cloneGenome } from './genetics.js';
import { spawnCreature, newSpecies, removeCreature, isLiving } from './creatures.js';
import { normalizeSettings } from './world-settings.js';

// 島ごとの { index, seed, settings }。島が 1 つなら今までの単一世界と同じ（シードと size をそのまま使う）
export function islandSpecs(seed, settings) {
  const s = normalizeSettings(settings), n = s.islands;
  const islandSettings = n === 1 ? s : { ...s, size: s.islandSize };
  return Array.from({ length: n }, (_, i) => ({ index: i, seed: n === 1 ? seed : seed * 100 + i, settings: islandSettings }));
}
// stepCount ステップ進めた直後に移住するか（settings は normalizeSettings 済み）
export function isMigrationStep(settings, stepCount) {
  return settings.islands > 1 && settings.migrateEvery > 0 && settings.migrants > 0 && stepCount % settings.migrateEvery === 0;
}
// 次に移住するまでのステップ数。移住しない設定なら Infinity
export function stepsToNextMigration(settings, stepCount) {
  if (!(settings.islands > 1 && settings.migrateEvery > 0 && settings.migrants > 0)) return Infinity;
  return settings.migrateEvery - (stepCount % settings.migrateEvery);
}
// 移住の乱数シード。移出は自分の島番号、移入は送り出した島の番号を island に渡す
export function migrationSeed(seed, stepCount, island) { return seed * 1e6 + stepCount + island; }
// 島 i が移民を受け取る島（環状）
export function migrationSource(i, n) { return (i - 1 + n) % n; }

export class IslandHost {
  // spec: islandSpecs の要素。opts.profiler: Sim に渡す計測器（省略可）
  constructor(RAPIER, spec, opts = {}) {
    this.index = spec.index;
    this.sim = new Sim(RAPIER, spec.seed, { settings: spec.settings, profiler: opts.profiler });
    this.originKey = new Map();
  }
  run(steps) { for (let i = 0; i < steps; i++) this.sim.step(); }
  // 島をまたいで同じ系統かを見分けるキー。移住で生まれた種は出身の種のキーを受け継ぐ
  speciesKey(sp) { return this.originKey.get(sp.id) ?? `${this.index}:${sp.id}`; }
  // 島から k 体を選んで移出する。戻り値は移民の配列（{ genome, energyFrac, origin }）
  emigrate(k, rngSeed) {
    const sim = this.sim;
    const rng = makeRng(rngSeed);
    const live = sim.creatures.filter(isLiving).sort((a, b) => a.id - b.id);
    const n = live.length;
    const order = Array.from({ length: n }, (_, i) => i);
    const chosen = [];
    const take = Math.min(k, n);
    for (let i = 0; i < take; i++) {
      const j = i + Math.floor(rng() * (n - i));
      [order[i], order[j]] = [order[j], order[i]];
      chosen.push(live[order[i]]);
    }
    const migrants = chosen.map((c) => ({
      genome: cloneGenome(c.genome),
      energyFrac: c.maxE > 0 ? c.energy / c.maxE : 0,
      origin: this.speciesKey(c.species),
    }));
    for (const c of chosen) {
      if (c.species) c.species.count--;
      removeCreature(sim, c);
    }
    return migrants;
  }
  // 島へ移民を受け入れる。戻り値は { placed, dropped }
  immigrate(migrants, rngSeed) {
    const sim = this.sim;
    const rng = makeRng(rngSeed);
    const edge = sim.edge;
    const lim = edge - 10;
    let placed = 0, dropped = 0;
    for (const m of migrants) {
      let x = null, z = null;
      for (let t = 0; t < 20; t++) {
        const xx = rng.range(-lim, lim), zz = rng.range(-lim, lim);
        if (!sim.isWater(xx, zz)) { x = xx; z = zz; break; }
      }
      if (x === null) { dropped++; continue; }
      let best = null, bestCount = -1;
      for (const sp of sim.species.values()) {
        if (sp.count <= 0) continue;
        if (sim.interfertile(sp.rep, m.genome) && sp.count > bestCount) {
          best = sp;
          bestCount = sp.count;
        }
      }
      if (!best) { best = newSpecies(sim, m.genome, null, true); this.originKey.set(best.id, m.origin); }
      spawnCreature(sim, m.genome, x, z, { species: best, energyFrac: m.energyFrac, gen: 0 });
      placed++;
    }
    return { placed, dropped };
  }
}
