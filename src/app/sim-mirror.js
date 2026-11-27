// ===== 見ている島の写し：worker から届いた中身を、描画・パネルが Sim と同じ名前で読めるように持つ =====
import { Climate, CFG, interfertile } from '../sim/index.js';
import { POSE_STRIDE } from './island-snapshot.js';

export class SimMirror {
  // info: worker の init の返信（{ index, seed, size, grid, settings }）。send(msg): 見ている島の worker に要求を送る
  constructor(info, send = () => {}) {
    Object.assign(this, { index: info.index, seed: info.seed, size: info.size, grid: info.grid, settings: info.settings });
    this.send = send;
    this.t = 0; this.climate = null;
    this.creatures = []; this.byId = new Map(); this.species = new Map();
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
  // 種は同じオブジェクトを使い続ける（個体の species が指したまま値だけ更新する）
  mergeSpecies(s) { const cur = this.species.get(s.id); if (cur) Object.assign(cur, s); else this.species.set(s.id, { ...s }); }
}
// 写しの個体。pos/rot は体節の数だけ持つ。energy などは T5 の詳細が届くまで 0
function makeCreature(b, species) {
  return { ...b, species: species.get(b.speciesId), alive: true, dead: false,
    pos: Array.from({ length: b.nParts }, () => ({ x: 0, y: 0, z: 0 })), rot: Array.from({ length: b.nParts }, () => ({ x: 0, y: 0, z: 0, w: 1 })),
    energy: 0, corpseE: 0, age: 0, children: 0, kills: 0, eaten: 0, crowd: 0, litter: 0, cause: '', cost: { base: 0, move: 0, climate: 0, water: 0, crowd: 0 } };
}
