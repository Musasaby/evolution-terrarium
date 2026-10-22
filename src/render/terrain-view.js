// ===== 地形の描画 =====
// sim から読むもの: H（高さ）, distWater, soil, climate, terrainVersion
import * as THREE from 'three';

const COLOR_INTERVAL_MS = 4000; // 季節・湿り気による色の塗り直し間隔

const cSand = new THREE.Color('#c8b78a'), cDry = new THREE.Color('#a99a5c'), cLush = new THREE.Color('#4d7a37'),
  cRock = new THREE.Color('#7a7268'), cSnow = new THREE.Color('#eef3f5'), cMud = new THREE.Color('#5e5640');
// 土壌の種類(0=岩場, 1=砂地, 2=肥沃, 3=泥炭)ごとのわずかな色寄せ
const cSoil = [new THREE.Color('#8f8a84'), new THREE.Color('#c2b280'), new THREE.Color('#4f6b33'), new THREE.Color('#5a4a30')];
const SOIL_TINT = 0.18;

export class TerrainView {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.version = -1;
    this.lastColor = 0;
    this.tmp = new THREE.Color();
  }

  attach(sim) {
    this.sim = sim;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
    const N = sim.grid, W = N + 1;
    const g = new THREE.BufferGeometry();
    const idx = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const a = i * W + j, b = (i + 1) * W + j, c = i * W + j + 1, d = (i + 1) * W + j + 1;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(W * W * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(W * W * 3), 3));
    this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.scene.add(this.mesh);
    this.updateGeometry();
  }

  update(now) {
    if (this.sim.terrainVersion !== this.version) this.updateGeometry();
    if (now - this.lastColor > COLOR_INTERVAL_MS) { this.updateColors(); this.lastColor = now; }
  }

  updateGeometry() {
    const sim = this.sim, N = sim.grid, W = N + 1, S = sim.size, H = sim.H;
    const geo = this.mesh.geometry, pos = geo.attributes.position.array;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const k = (i * W + j) * 3;
      pos[k] = -S / 2 + i * S / N; pos[k + 1] = H[i * W + j]; pos[k + 2] = -S / 2 + j * S / N;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    this.updateColors();
    this.version = sim.terrainVersion;
  }

  updateColors() {
    const sim = this.sim, N = sim.grid, W = N + 1, H = sim.H, cl = sim.climate, tmp = this.tmp;
    const col = this.mesh.geometry.attributes.color.array, nrm = this.mesh.geometry.attributes.normal.array;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const id = i * W + j, h = H[id];
      const ny = nrm[id * 3 + 1];
      const dw = sim.distWater[id];
      const moist = Math.min(1, 0.15 + 0.5 * cl.humidity + 0.55 * Math.exp(-dw / 10));
      if (h < cl.water) tmp.copy(cMud);
      else if (h < cl.water + 0.4) tmp.copy(cSand);
      else {
        tmp.copy(cDry).lerp(cLush, moist);
        const rock = Math.min(1, Math.max(0, (0.86 - ny) * 4) + Math.max(0, (h - 15) / 8));
        tmp.lerp(cRock, rock);
        // 土壌の種類をわずかに反映する
        tmp.lerp(cSoil[sim.soil[id]], SOIL_TINT);
      }
      const T = cl.tempAtHeight(h);
      if (T < 1 && h >= cl.water) tmp.lerp(cSnow, Math.min(1, (1 - T) / 5));
      col[id * 3] = tmp.r; col[id * 3 + 1] = tmp.g; col[id * 3 + 2] = tmp.b;
    }
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}
