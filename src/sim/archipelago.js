// ===== 群島：独立した世界（島 = Sim）を並べ、ときどき少数を移住させる =====
// 全島を 1 ステップずつ島番号の順に進め、migrateEvery ステップごとに移住を行う。
// 島番号の順に処理するので、同じシード・同じ設定なら結果は常に同じになる。
import { IslandHost, islandSpecs, isMigrationStep, migrationSeed, migrationSource } from './island-host.js';
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
    this.islands = islandSpecs(seed, this.settings).map((spec) => new IslandHost(RAPIER, spec, { profiler: opts.profiler }));
  }
  get sims() { return this.islands.map((isl) => isl.sim); }
  step() {
    for (const isl of this.islands) isl.sim.step();
    this.stepCount++;
    if (isMigrationStep(this.settings, this.stepCount)) this.migrate();
  }
  // 全島から島番号の順に移出し、そのあと島番号の順に移入する。島 i は島 (i-1+n)%n から受け取る
  migrate() {
    const n = this.islands.length, k = this.settings.migrants;
    const out = this.islands.map((isl, i) => isl.emigrate(k, migrationSeed(this.seed, this.stepCount, i)));
    this.islands.forEach((isl, i) => {
      const src = migrationSource(i, n);
      const r = isl.immigrate(out[src], migrationSeed(this.seed, this.stepCount, src));
      this.migrated += r.placed; this.dropped += r.dropped;
    });
  }
  // 島をまたいで同じ系統かを見分けるキー。移住で生まれた種は出身の種のキーを受け継ぐ
  speciesKey(islandIndex, sp) { return this.islands[islandIndex].speciesKey(sp); }
}
