// ===== 群島：独立した世界（島 = Sim）を並べ、ときどき少数を移住させる =====
// 全島を 1 ステップずつ島番号の順に進め、migrateEvery ステップごとに移住を行う。
// 島番号の順に処理するので、同じシード・同じ設定なら結果は常に同じになる。
import { Sim } from './sim.js';
import { makeRng } from './random.js';
import { cloneGenome } from './genetics.js';
import { spawnCreature, newSpecies, removeCreature, isLiving } from './creatures.js';
import { normalizeSettings } from './world-settings.js';

export class Archipelago {
  // opts.settings: 世界の設定（islands・islandSize・migrateEvery・migrants を含む）
  // opts.profiler: 各島の Sim に渡す計測器（省略可）
  constructor(RAPIER, seed = 1, opts = {}) {
    this.seed = seed;
    this.settings = normalizeSettings(opts.settings);
    this.stepCount = 0;
    this.migrated = 0;   // 移入できた個体の累計
    this.dropped = 0;    // 置き場所が見つからず捨てた個体の累計
    const n = this.settings.islands;
    // 島が 1 つなら今までの単一世界と同じ（シードと size をそのまま使う）
    const islandSettings = n === 1 ? this.settings : { ...this.settings, size: this.settings.islandSize };
    this.islands = [];
    for (let i = 0; i < n; i++) {
      const islandSeed = n === 1 ? seed : seed * 100 + i;
      this.islands.push({ index: i, sim: new Sim(RAPIER, islandSeed, { settings: islandSettings, profiler: opts.profiler }), originKey: new Map() });
    }
  }
  get sims() { return this.islands.map((isl) => isl.sim); }
  step() {
    for (const isl of this.islands) isl.sim.step();
    this.stepCount++;
    const { migrateEvery, migrants } = this.settings;
    if (this.islands.length > 1 && migrateEvery > 0 && migrants > 0 && this.stepCount % migrateEvery === 0) this.migrate();
  }
  // 全島から島番号の順に移出し、そのあと島番号の順に移入する。島 i は島 (i-1+n)%n から受け取る
  migrate() {
    const n = this.islands.length, k = this.settings.migrants, base = this.seed * 1e6 + this.stepCount;
    const out = this.islands.map((isl, i) => emigrate(isl, k, base + i));
    this.islands.forEach((isl, i) => {
      const src = (i - 1 + n) % n;
      const r = immigrate(isl, out[src], base + src);
      this.migrated += r.placed; this.dropped += r.dropped;
    });
  }
  // 島をまたいで同じ系統かを見分けるキー。移住で生まれた種は出身の種のキーを受け継ぐ
  speciesKey(islandIndex, sp) { return speciesKey(this.islands[islandIndex], sp); }
}

function speciesKey(isl, sp) { return isl.originKey.get(sp.id) ?? `${isl.index}:${sp.id}`; }

// 島から k 体を選んで移出する。戻り値は移民の配列（{ genome, energyFrac, origin }）
function emigrate(isl, k, rngSeed) {
  const sim = isl.sim;
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
    origin: speciesKey(isl, c.species),
  }));
  for (const c of chosen) {
    if (c.species) c.species.count--;
    removeCreature(sim, c);
  }
  return migrants;
}

// 島へ移民を受け入れる。戻り値は { placed, dropped }
function immigrate(isl, migrants, rngSeed) {
  const sim = isl.sim;
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
    if (!best) { best = newSpecies(sim, m.genome, null, true); isl.originKey.set(best.id, m.origin); }
    spawnCreature(sim, m.genome, x, z, { species: best, energyFrac: m.energyFrac, gen: 0 });
    placed++;
  }
  return { placed, dropped };
}
