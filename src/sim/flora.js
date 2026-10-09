// ===== 植生：植物の発芽・成長・拡散・枯死と、その当たり判定 =====
// 依存するもの: 物理エンジン（R, world）、当たり判定の持ち主表、乱数、地形、気候。生物のことは知らない。
import { CFG, EDGE } from './config.js';
import { PLANT_SPECIES } from './plant-species.js';
import { suitability } from './environment.js';

// 植物の空間グリッド（4m 四方）のキー
export const plantKey = (x, z) => (Math.floor((x + 100) / 4) << 8) | Math.floor((z + 100) / 4);
export const PLANT_CELL = 4;

export class Flora {
  constructor({ R, world, colliderOwner, rng, terrain, climate }) {
    Object.assign(this, { R, world, colliderOwner, rng, terrain, climate });
    this.plants = [];
    this.grid = new Map();   // key -> 植物の配列
    this.version = 0;        // 植物が増減するたびに進む（描画側の更新判定用）
  }

  suitability(sp, x, z, mean = true) { return suitability(this.terrain, this.climate, sp, x, z, mean); }

  populate() {
    for (let k = 0; k < 8000 && this.plants.length < 1400; k++) {
      const x = this.rng.range(-EDGE, EDGE), z = this.rng.range(-EDGE, EDGE);
      this.trySeed(x, z, null, 0.75);
    }
  }

  density(x, z) { return this.grid.get(plantKey(x, z))?.length || 0; }

  trySeed(x, z, sp, energyFrac = 0.2) {
    if (Math.abs(x) > EDGE + 1 || Math.abs(z) > EDGE + 1) return null;
    if (this.plants.length >= CFG.MAX_PLANTS) return null;
    if (!sp) {
      // その場所に最も適した種（多少ランダム）
      let best = null, bs = 0;
      for (const s of PLANT_SPECIES) { const v = this.suitability(s, x, z) * (0.6 + 0.8 * this.rng()); if (v > bs) { bs = v; best = s; } }
      sp = best;
    }
    if (!sp) return null;
    const s = this.suitability(sp, x, z);
    if (s < 0.3) return null;
    const cap = sp.hh > 1 ? 2 : 5;
    if (this.density(x, z) >= cap) return null;
    return this.add(sp, x, z, energyFrac);
  }

  add(sp, x, z, energyFrac) {
    const R = this.R, rng = this.rng;
    const size = rng.range(0.75, 1.3);
    const y = this.terrain.heightAt(x, z);
    const p = {
      id: rng() * 1e9 | 0, sp, spIdx: PLANT_SPECIES.indexOf(sp), x, z, y, size,
      maxE: sp.maxE * size * size, energy: 0, age: 0, rot: rng() * Math.PI * 2,
      shapeSeed: rng(), life: sp.life * rng.range(0.7, 1.3), alive: true,
    };
    p.energy = p.maxE * energyFrac;
    const hh = sp.hh * size;
    const desc = R.ColliderDesc.cylinder(hh, sp.col * size).setTranslation(x, y + hh - 0.05, z).setFriction(0.8);
    if (sp.soft) desc.setSensor(true).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    else desc.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(0);
    p.col = this.world.createCollider(desc);
    this.colliderOwner.set(p.col.handle, { kind: 'p', obj: p });
    this.plants.push(p);
    const key = plantKey(x, z);
    (this.grid.get(key) || this.grid.set(key, []).get(key)).push(p);
    this.version++;
    return p;
  }

  remove(p) {
    if (!p.alive) return;
    p.alive = false;
    this.colliderOwner.delete(p.col.handle);
    this.world.removeCollider(p.col, false);
    const arr = this.grid.get(plantKey(p.x, p.z));
    if (arr) { const i = arr.indexOf(p); if (i >= 0) arr.splice(i, 1); }
    this.version++;
  }

  // dt は呼び出し間隔（約1秒）
  update(t, dt) {
    const rng = this.rng, wl = this.climate.water;
    const season = this.climate.temp;
    for (const p of this.plants) {
      if (!p.alive) continue;
      p.age += dt;
      const sNow = this.suitability(p.sp, p.x, p.z, false);
      const sMean = this.suitability(p.sp, p.x, p.z, true);
      // 地形変化で地面の高さが変わったら追従
      const ny = this.terrain.heightAt(p.x, p.z);
      if (Math.abs(ny - p.y) > 0.05) { p.y = ny; const hh = p.sp.hh * p.size; p.col.setTranslation({ x: p.x, y: ny + hh - 0.05, z: p.z }); }
      if (p.health === undefined) p.health = 1;
      if (!p.sp.wet && ny < wl - 0.1) p.health -= 0.1 * dt;
      if (sMean < 0.15) p.health -= 0.025 * dt;
      else if (p.health < 1) p.health = Math.min(1, p.health + 0.01 * dt);
      if (p.age > p.life) p.health -= 0.03 * dt;
      if (!(p.dormant > t)) p.energy += p.maxE * 0.035 * p.sp.grow * sNow * dt * (season < 0 ? 0.2 : 1);
      if (p.energy > p.maxE) p.energy = p.maxE;
      if (p.health <= 0 || (!p.sp.soft && p.energy <= 0)) { this.remove(p); continue; }
      if (p.energy > p.maxE * 0.6 && rng() < p.sp.rate * dt * sNow) {
        const a = rng() * Math.PI * 2, d = rng.range(1, p.sp.spread);
        const sp = rng() < 0.96 ? p.sp : null;
        if (this.trySeed(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, sp, 0.15)) p.energy -= p.maxE * 0.08;
      }
    }
    if (this.plants.some(p => !p.alive)) this.plants = this.plants.filter(p => p.alive);
    // 遠方からの種子（再定着）
    for (let k = 0; k < 5; k++) this.trySeed(rng.range(-EDGE, EDGE), rng.range(-EDGE, EDGE), null, 0.2);
  }

  // 植物の種類ごとの数
  countBySpecies() {
    const pc = new Array(PLANT_SPECIES.length).fill(0);
    for (const p of this.plants) pc[p.spIdx]++;
    return pc;
  }
}
