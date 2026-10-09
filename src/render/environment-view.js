// ===== 空・水面・雨と雪の描画 =====
// sim から読むもの: climate（天候・気温・湖面・雨の見え具合）
import * as THREE from 'three';
import { CFG } from '../sim/index.js';

const skyClear = new THREE.Color('#9cc4da'), skyRain = new THREE.Color('#7f8b93'), skyDry = new THREE.Color('#d6c69e'), skyCold = new THREE.Color('#c9d6de');
const RAIN_DROPS = 1800, RAIN_BOX = 80, RAIN_TOP = 40;

export class EnvironmentView {
  constructor(scene, controls) {
    this.scene = scene;
    this.controls = controls;
    this.sky = new THREE.Color();
    // 水面
    const g = new THREE.PlaneGeometry(CFG.WORLD, CFG.WORLD); g.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(g, new THREE.MeshPhongMaterial({ color: 0x3f7fa0, transparent: true, opacity: 0.78, shininess: 80, depthWrite: false }));
    scene.add(this.water);
    // 雨（カメラの注視点のまわりだけに降らせる）
    const rg = new THREE.BufferGeometry(), p = new Float32Array(RAIN_DROPS * 3);
    for (let i = 0; i < RAIN_DROPS; i++) { p[i * 3] = (Math.random() - 0.5) * RAIN_BOX; p[i * 3 + 1] = Math.random() * RAIN_TOP; p[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX; }
    rg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: 0xc9dce6, size: 0.25, transparent: true, opacity: 0.7, depthWrite: false }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);
  }

  attach(sim) { this.sim = sim; }

  update(dt) {
    const cl = this.sim.climate, sky = this.sky;
    sky.copy(skyClear);
    if (cl.weather === 'drought') sky.lerp(skyDry, 0.6);
    sky.lerp(skyRain, cl.rainVis * 0.8);
    if (cl.temp < 2) sky.lerp(skyCold, Math.min(0.7, (2 - cl.temp) / 10));
    if (!this.scene.background) this.scene.background = new THREE.Color();
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);

    this.water.position.y = cl.water;
    const frozen = cl.temp < -3;
    this.water.material.color.set(frozen ? '#d4e6ec' : '#3f7fa0');
    this.water.material.opacity = frozen ? 0.95 : 0.78;

    this.updateRain(cl, dt);
  }

  updateRain(cl, dt) {
    const rain = this.rain;
    rain.visible = cl.rainVis > 0.05;
    if (!rain.visible) return;
    const snow = cl.temp < 1;
    rain.material.size = snow ? 0.35 : 0.22;
    rain.material.color.set(snow ? '#ffffff' : '#bcd3df');
    rain.material.opacity = 0.75 * cl.rainVis;
    const p = rain.geometry.attributes.position.array, vy = snow ? 3 : 22;
    for (let i = 1; i < p.length; i += 3) { p[i] -= vy * dt; if (p[i] < 0) p[i] += RAIN_TOP; }
    rain.geometry.attributes.position.needsUpdate = true;
    const t = this.controls.target;
    rain.position.set(t.x, t.y - 5, t.z);
  }
}
