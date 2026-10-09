// ===== シミュレーション本体：各部品の組み立てと、1ステップの進め方 =====
// RAPIER を外から注入して使う。描画には依存しないので、ブラウザでも Node でも動く。
//
// 部品の分担
//   Climate  (climate.js)      … 季節・天候・湖面
//   Terrain  (terrain.js)      … 高さ場・隆起と侵食・水域からの距離
//   Flora    (flora.js)        … 植物
//   creatures.js / interactions.js / speciation.js … 生物の一生・接触・種分化
//   stats.js                   … グラフ用の時系列
// Sim はこれらをつなぎ、物理エンジン（world・当たり判定の持ち主表）を共有させる。
import { CFG, SCHEDULE } from './config.js';
import { makeRng, makeNoise } from './random.js';
import { Climate } from './climate.js';
import { Terrain } from './terrain.js';
import { Flora } from './flora.js';
import { tempAt, meanTempAt, isWater, suitability } from './environment.js';
import { spawnFounderGroup, updateCreatures, housekeeping, livingCount } from './creatures.js';
import { processContacts } from './interactions.js';
import { interfertile, updateSpecies } from './speciation.js';
import { recordStats } from './stats.js';
import { clampVel } from './body.js';
import { NULL_PROFILER } from './profiler.js';

const MAX_EVENTS = 120;

export class Sim {
  // opts.profiler: begin(name)/end(name) を持つ計測器（省略時は計測しない）
  constructor(RAPIER, seed = 1, opts = {}) {
    this.R = RAPIER;
    this.seed = seed;
    this.profiler = opts.profiler || NULL_PROFILER;
    this.rng = makeRng(seed);
    this.noise = makeNoise(this.rng);
    this.t = 0;
    this.stepCount = 0;
    this.nextCreatureId = 1;
    this.nextSpeciesId = 1;
    this.creatures = [];
    this.species = new Map();
    this.colliderOwner = new Map(); // collider handle -> {kind: 'c'|'p'|'t', obj, part}
    this.grazing = new Map();       // key -> {p, c}
    this.events = [];
    this.stats = [];
    this.litters = [];
    this.counters = { births: 0, deaths: 0, predations: 0, matings: 0, stillborn: 0, rejected: 0 };
    this.rejectUntil = new Map();
    this.terrainVersion = 0;
    this.listeners = new Map();

    this.initPhysics();
    const log = (msg, kind) => this.log(msg, kind);
    this.climate = new Climate(this.rng, log);
    this.terrain = new Terrain(this.rng, this.noise);
    this.buildTerrainCollider();
    this.terrain.computeMoisture(this.climate.water);
    this.flora = new Flora({ R: RAPIER, world: this.world, colliderOwner: this.colliderOwner, rng: this.rng, terrain: this.terrain, climate: this.climate });
    this.flora.populate();
    for (let i = 0; i < CFG.INIT_SPECIES; i++) spawnFounderGroup(this, CFG.GROUP);
  }

  // ---------------- イベント ----------------
  // sim.on('log', fn) で出来事を受け取れる。戻り値を呼ぶと購読を解除する
  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }
  emit(type, payload) { const s = this.listeners.get(type); if (s) for (const fn of s) fn(payload); }

  log(msg, kind = 'info') {
    const e = { t: this.t, msg, kind };
    this.events.unshift(e);
    if (this.events.length > MAX_EVENTS) this.events.pop();
    this.emit('log', e);
  }

  // ---------------- 物理エンジン ----------------
  initPhysics() {
    const R = this.R;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = CFG.DT;
    this.eventQueue = new R.EventQueue(true);
    const owner = this.colliderOwner;
    this.hooks = {
      // 同じ個体の体節どうしはぶつからない
      filterContactPair: (c1, c2) => {
        const a = owner.get(c1), b = owner.get(c2);
        if (a && b && a.kind === 'c' && b.kind === 'c' && a.obj === b.obj) return null;
        return R.SolverFlags.COMPUTE_IMPULSE;
      },
      filterIntersectionPair: () => true,
    };
  }
  buildTerrainCollider() {
    const R = this.R, N = CFG.GRID, S = CFG.WORLD;
    if (this.terrainCol) this.world.removeCollider(this.terrainCol, false);
    this.terrainCol = this.world.createCollider(R.ColliderDesc.heightfield(N, N, this.terrain.H, { x: S, y: 1, z: S }).setFriction(1.0));
    this.colliderOwner.set(this.terrainCol.handle, { kind: 't' });
    if (!this.walls) {
      this.walls = [];
      const hw = S / 2;
      for (const [x, z, sx, sz] of [[hw + 1, 0, 1, hw], [-hw - 1, 0, 1, hw], [0, hw + 1, hw, 1], [0, -hw - 1, hw, 1]]) {
        this.walls.push(this.world.createCollider(R.ColliderDesc.cuboid(sx, 60, sz).setTranslation(x, 30, z)));
      }
    }
    this.terrainVersion++;
  }
  dispose() { this.world.free(); this.eventQueue.free?.(); this.listeners.clear(); }

  // ---------------- 外から使う問い合わせ ----------------
  get year() { return this.t / CFG.YEAR; }
  seasonName() { return Climate.seasonName(this.t); }
  get H() { return this.terrain.H; }
  get distWater() { return this.terrain.distWater; }
  get plants() { return this.flora.plants; }
  get plantVersion() { return this.flora.version; }
  heightAt(x, z) { return this.terrain.heightAt(x, z); }
  isWater(x, z) { return isWater(this.terrain, this.climate, x, z); }
  tempAt(x, z) { return tempAt(this.terrain, this.climate, x, z); }
  meanTempAt(x, z) { return meanTempAt(this.terrain, this.climate, x, z); }
  moistureAt(x, z) { return this.terrain.moistureAt(x, z, this.climate); }
  suitability(sp, x, z, mean = true) { return suitability(this.terrain, this.climate, sp, x, z, mean); }
  interfertile(a, b) { return interfertile(a, b); }
  livingCount() { return livingCount(this); }
  // 'rain' | 'drought' | 'clear' | 'ice'
  forceWeather(w) { this.climate.force(w, this.t); }
  // 物理エンジン内の物体数（パフォーマンス表示用）
  physicsCounts() {
    const w = this.world;
    return { bodies: w.bodies.len(), colliders: w.colliders.len(), joints: w.impulseJoints.len?.() ?? 0 };
  }

  // ---------------- 1ステップ ----------------
  step() {
    const dt = CFG.DT, P = this.profiler;
    this.t += dt; this.stepCount++;
    const sc = this.stepCount;

    P.begin('環境');
    if (sc % SCHEDULE.CLIMATE === 0) this.climate.update(this.t, dt * SCHEDULE.CLIMATE);
    if (sc % SCHEDULE.PLANTS === 0) this.flora.update(this.t, 1);
    if (sc % SCHEDULE.TERRAIN === 0 && this.terrain.update(this.t, this.climate.humidity, (m, k) => this.log(m, k))) this.buildTerrainCollider();
    if (sc % SCHEDULE.MOISTURE === 0) this.terrain.computeMoisture(this.climate.water);
    P.end('環境');

    P.begin('生物');
    updateCreatures(this, dt);
    P.end('生物');

    P.begin('物理');
    this.world.step(this.eventQueue, this.hooks);
    if (sc % 2 === 0) for (const c of this.creatures) if (c.alive) clampVel(c);
    P.end('物理');

    P.begin('接触');
    processContacts(this, dt);
    P.end('接触');

    P.begin('集計');
    if (sc % SCHEDULE.HOUSEKEEPING === 0) housekeeping(this);
    if (sc % SCHEDULE.SPECIES === SCHEDULE.SPECIES_OFFSET) updateSpecies(this);
    if (sc % SCHEDULE.STATS === 0) recordStats(this);
    P.end('集計');
  }
}
