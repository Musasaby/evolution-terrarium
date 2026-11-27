// ===== 見ている島の写し：worker から届いた中身を、描画・パネルが Sim と同じ名前で読めるように持つ =====
import { Climate, CFG, interfertile, PLANT_SPECIES } from '../sim/index.js';
import { POSE_STRIDE } from './island-snapshot.js';

export class SimMirror {
  // info: worker の init の返信（{ index, seed, size, grid, settings }）。send(msg): 見ている島の worker に要求を送る
  constructor(info, send = () => {}) {
    Object.assign(this, { index: info.index, seed: info.seed, size: info.size, grid: info.grid, settings: info.settings });
    this.send = send;
    this.t = 0; this.climate = null;
    this.creatures = []; this.byId = new Map(); this.species = new Map();
    this.plants = []; this.H = null; this.distWater = null; this.soil = null; this.terrainVersion = -1;
    this.stats = []; this.counters = { births: 0, deaths: 0, predations: 0, matings: 0, stillborn: 0, rejected: 0 };
    this.litters = []; this.events = []; this.physics = {}; this.sections = null;
    this.listeners = new Map();
  }
  get year() { return this.t / CFG.YEAR; }
  seasonName() { return Climate.seasonName(this.t); }
  interfertile(a, b) { return interfertile(a, b); }
  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }
  emit(type, payload) { const s = this.listeners.get(type); if (s) for (const fn of s) fn(payload); }
  forceWeather(w) { this.send({ type: 'forceWeather', weather: w }); }
  log(msg, kind = 'info') { this.send({ type: 'log', msg, kind }); }
  dispose() { this.listeners.clear(); }
  // packFrame の packet を反映する
  applyFrame(f) {
    this.t = f.t;
    this.climate = Object.assign(Object.create(Climate.prototype), f.climate);
    for (const s of f.species) this.mergeSpecies(s);
    for (const b of f.born) this.byId.set(b.id, makeCreature(b, this.species));
    const next = []; let k = 0;
    for (let j = 0; j < f.ids.length; j++) {
      const c = this.byId.get(f.ids[j]);
      c.alive = true; c.dead = f.dead[j] === 1;
      for (let i = 0; i < c.nParts; i++) { const p = c.pos[i], r = c.rot[i]; p.x = f.poses[k++]; p.y = f.poses[k++]; p.z = f.poses[k++]; r.x = f.poses[k++]; r.y = f.poses[k++]; r.z = f.poses[k++]; r.w = f.poses[k++]; }
      next.push(c);
    }
    // 届かなかった個体は消えた（alive = false）。byId からも外す
    const live = new Set(f.ids);
    for (const c of this.creatures) if (!live.has(c.id)) { c.alive = false; this.byId.delete(c.id); }
    this.creatures = next;
  }
  physicsCounts() { return this.physics; }
  // 区間計測を取り出してリセットする（SectionProfiler.take と同じ形 { 名前: { ms, n } }）
  takeSections() { const s = this.sections ?? {}; this.sections = null; return s; }
  // packPanels の中身を反映する
  applyPanels(p) {
    for (const s of p.species) this.mergeSpecies(s);
    this.counters = p.counters; this.litters = p.litters; this.physics = p.physics;
    this.plants = p.plants.map((x) => ({ ...x, sp: PLANT_SPECIES[x.spIdx] }));
    if (p.stats) this.stats = p.stats;
    if (p.terrain) { this.H = p.terrain.H; this.distWater = p.terrain.distWater; this.soil = p.terrain.soil; this.terrainVersion = p.terrain.version; }
    if (p.selected) { const c = this.byId.get(p.selected.id); if (c) Object.assign(c, p.selected); }
    if (p.sections) {
      if (!this.sections) this.sections = {};
      for (const [name, v] of Object.entries(p.sections)) {
        const cur = this.sections[name];
        if (cur) { cur.ms += v.ms; cur.n += v.n; } else this.sections[name] = { ms: v.ms, n: v.n };
      }
    }
    if (p.events) { this.events = p.events; this.emit('log'); }
  }
  // 種は同じオブジェクトを使い続ける（個体の species が指したまま値だけ更新する）
  mergeSpecies(s) { const cur = this.species.get(s.id); if (cur) Object.assign(cur, s); else this.species.set(s.id, { ...s }); }
}
// 写しの個体。pos/rot は体節の数だけ持つ。energy などは T5 の詳細が届くまで 0
function makeCreature(b, species) {
  return { ...b, species: species.get(b.speciesId), alive: true, dead: false,
    pos: Array.from({ length: b.nParts }, () => ({ x: 0, y: 0, z: 0 })), rot: Array.from({ length: b.nParts }, () => ({ x: 0, y: 0, z: 0, w: 1 })),
    energy: 0, corpseE: 0, age: 0, children: 0, kills: 0, eaten: 0, crowd: 0, litter: 0, cause: '', cost: { base: 0, move: 0, climate: 0, water: 0, crowd: 0 } };
}
