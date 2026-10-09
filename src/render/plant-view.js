// ===== 植物の描画 =====
// 植物は種類ごとに形の部品（葉・茎・球・円錐・円盤）を組み合わせて描く。
// 新しい植物種を足すときは、plant-species.js に定義を、ここの SHAPES に形を、palette.js に色を足す。
// sim から読むもの: plants, t, climate
import * as THREE from 'three';
import { CFG } from '../sim/index.js';
import { PLANT_COLORS, BLOOM_COLORS } from './palette.js';

const REBUILD_MS = 1500;   // 植物は動かないので、ときどき作り直せば十分
const CAPACITY = { blade: 9000, stem: 6000, ball: 5000, cone: 3000, disc: 1800 };

const brown = new THREE.Color('#8a7448'), snow = new THREE.Color('#e9eef0'), orange = new THREE.Color('#c9772f');
const trunkLight = new THREE.Color('#5b4632'), trunkDark = new THREE.Color('#4e3a2a');
const bloom = BLOOM_COLORS.map(c => new THREE.Color(c));

// 形の定義。put(部品, x, y, z, 拡大xyz, 回転xyz, 色) で部品を置く
// ctx: { p: 植物, x, y, z, s: 大きさ, f: 元気さ(0〜1), T: その場の気温, base: 基本色, autumn: 紅葉の度合い, r: 個体ごとの乱数, c2: 作業用の色 }
const SHAPES = {
  草({ x, y, z, s, f, base, r }, put) {
    const h = (0.25 + 0.55 * f) * s;
    for (let k = 0; k < 4; k++) { const a = r() * 6.28, d = r() * 0.8 * s; put('blade', x + Math.cos(a) * d, y, z + Math.sin(a) * d, s, h * (0.7 + r() * 0.6), s, (r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6, base); }
  },
  花({ p, x, y, z, s, f, T, base, r }, put) {
    const h = (0.3 + 0.4 * f) * s;
    for (let k = 0; k < 3; k++) {
      const a = r() * 6.28, d = r() * 0.45 * s, xx = x + Math.cos(a) * d, zz = z + Math.sin(a) * d, hh = h * (0.7 + r() * 0.5);
      put('stem', xx, y, zz, 0.025, hh, 0.025, 0, 0, 0, base);
      if (f > 0.35 && T > 6) put('ball', xx, y + hh, zz, 0.11 * s, 0.07 * s, 0.11 * s, 0, 0, 0, bloom[Math.floor(p.shapeSeed * 4)]);
    }
  },
  葦({ x, y, z, s, f, base, r }, put) {
    for (let k = 0; k < 5; k++) { const a = r() * 6.28, d = r() * 0.5 * s; put('stem', x + Math.cos(a) * d, y - 0.2, z + Math.sin(a) * d, 0.03, (1.0 + f) * s * (0.7 + r() * 0.5), 0.03, (r() - 0.5) * 0.25, 0, (r() - 0.5) * 0.25, base); }
  },
  苔({ p, x, y, z, s, f, base }, put) {
    put('disc', x, y + 0.02, z, 0.55 * s * (0.5 + 0.5 * f), 1, 0.55 * s * (0.5 + 0.5 * f), 0, p.rot, 0, base);
  },
  低木({ x, y, z, s, f, base, r }, put) {
    const g = 0.55 + 0.45 * f;
    for (let k = 0; k < 3; k++) { const a = r() * 6.28; put('ball', x + Math.cos(a) * 0.3 * s, y + 0.35 * s * g, z + Math.sin(a) * 0.3 * s, 0.5 * s * g, 0.42 * s * g, 0.5 * s * g, 0, 0, 0, base); }
  },
  広葉樹({ p, x, y, z, s, f, T, base, autumn, c2 }, put) {
    const g = 0.6 + 0.4 * f, th = 2.4 * s;
    put('stem', x, y, z, 0.2 * s, th, 0.2 * s, 0, 0, 0, trunkLight);
    const leaf = c2.copy(base).lerp(orange, autumn * 0.8);
    if (T < 3) leaf.lerp(brown, 0.6);
    put('ball', x, y + th + 0.4 * s, z, 1.4 * s * g, 1.1 * s * g, 1.4 * s * g, 0, p.rot, 0, leaf);
    put('ball', x + 0.6 * s, y + th - 0.1, z + 0.3 * s, 0.9 * s * g, 0.8 * s * g, 0.9 * s * g, 0, 0, 0, leaf);
  },
  針葉樹({ x, y, z, s, f, base }, put) {
    const g = 0.6 + 0.4 * f;
    put('stem', x, y, z, 0.16 * s, 1.2 * s, 0.16 * s, 0, 0, 0, trunkDark);
    for (let k = 0; k < 3; k++) put('cone', x, y + (0.8 + k * 0.9) * s, z, (1.2 - k * 0.3) * s * g, 1.5 * s, (1.2 - k * 0.3) * s * g, 0, 0, 0, base);
  },
  サボテン({ x, y, z, s, f, base, r }, put) {
    const h = (1.2 + 0.6 * f) * s;
    put('stem', x, y, z, 0.3 * s, h, 0.3 * s, 0, 0, 0, base);
    put('stem', x + 0.3 * s, y + h * 0.45, z, 0.15 * s, 0.6 * s, 0.15 * s, 0, 0, -0.9, base);
    if (r() > 0.4) put('stem', x - 0.3 * s, y + h * 0.55, z, 0.13 * s, 0.5 * s, 0.13 * s, 0, 0, 0.9, base);
  },
};

export class PlantView {
  constructor(scene) {
    const mk = (geo, n, rough = 0.85) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: rough }), n);
      m.setColorAt(0, new THREE.Color()); m.frustumCulled = false; m.count = 0; scene.add(m); return m;
    };
    const blade = new THREE.ConeGeometry(0.06, 1, 4); blade.translate(0, 0.5, 0);
    const stem = new THREE.CylinderGeometry(1, 1, 1, 6); stem.translate(0, 0.5, 0);
    const ball = new THREE.IcosahedronGeometry(1, 1);
    const cone = new THREE.ConeGeometry(1, 1, 7); cone.translate(0, 0.5, 0);
    const disc = new THREE.CylinderGeometry(1, 1, 0.08, 9);
    const geos = { blade, stem, ball, cone, disc };
    this.meshes = {};
    for (const k in CAPACITY) this.meshes[k] = mk(geos[k], CAPACITY[k]);
    this.baseColors = Object.fromEntries(Object.entries(PLANT_COLORS).map(([k, v]) => [k, new THREE.Color(v)]));
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.base = new THREE.Color(); this.c2 = new THREE.Color();
    this.last = -Infinity;
  }

  attach(sim) { this.sim = sim; this.last = -Infinity; }

  update(now) {
    if (now - this.last < REBUILD_MS) return;
    this.last = now;
    this.rebuild();
  }

  rebuild() {
    const { meshes, m4, q, e, p: pv, s: sv } = this;
    const cnt = { blade: 0, stem: 0, ball: 0, cone: 0, disc: 0 };
    const sim = this.sim, cl = sim.climate;
    const season = ((sim.t / CFG.YEAR) % 1 + 1) % 1;
    const autumn = season > 0.45 && season < 0.75 ? Math.sin((season - 0.45) / 0.3 * Math.PI) : 0;
    const put = (kind, x, y, z, sx, sy, sz, rx, ry, rz, color) => {
      const m = meshes[kind], i = cnt[kind]; if (i >= m.instanceMatrix.count) return;
      pv.set(x, y, z); q.setFromEuler(e.set(rx, ry, rz)); sv.set(sx, sy, sz);
      m4.compose(pv, q, sv); m.setMatrixAt(i, m4); m.setColorAt(i, color); cnt[kind]++;
    };
    const ctx = { base: this.base, c2: this.c2, autumn };
    for (const p of sim.plants) {
      const shape = SHAPES[p.sp.name]; if (!shape) continue;
      const f = Math.max(0.05, p.energy / p.maxE);
      const T = cl.tempAtHeight(p.y);
      ctx.base.copy(this.baseColors[p.sp.name]).lerp(brown, (1 - f) * 0.7);
      if (T < 0) ctx.base.lerp(snow, Math.min(0.6, -T / 10));
      let rnd = p.shapeSeed * 997;
      ctx.r = () => { rnd = (rnd * 16807) % 2147483647 || 1; return (rnd % 10000) / 10000; };
      ctx.p = p; ctx.x = p.x; ctx.y = p.y; ctx.z = p.z; ctx.s = p.size; ctx.f = f; ctx.T = T;
      shape(ctx, put);
    }
    for (const k in meshes) {
      const m = meshes[k]; m.count = cnt[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
