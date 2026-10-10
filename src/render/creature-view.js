// ===== 生物の描画（カプセル形の体節のインスタンス描画）と、クリックでの選択 =====
// sim から読むもの: creatures（体節の姿勢の写し pos/rot・ゲノム・種）
//
// カプセルは「胴（側面だけの円柱）＋両端の球」の2種類のインスタンスで描く。
// 1つの形を引き伸ばすと端の半球が楕円にゆがむため、胴は長さ方向だけ、球は縦横同じ倍率で拡大する。
import * as THREE from 'three';
import { capsuleHalf } from '../sim/index.js';
import { speciesColor, CORPSE_COLOR } from './palette.js';

const MAX_PARTS = 2400;

export class CreatureView {
  constructor(scene, { markerColor }) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
    const mk = (geo, n) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color());
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
      return m;
    };
    this.body = mk(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), MAX_PARTS);   // 胴（両端は開いている）
    this.caps = mk(new THREE.SphereGeometry(1, 10, 6), MAX_PARTS * 2);             // 両端の半球（球で代用）
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 4), new THREE.MeshBasicMaterial({ color: markerColor }));
    this.marker.rotation.x = Math.PI; this.marker.visible = false;
    scene.add(this.marker);
    this.bodyOwner = []; this.capOwner = [];
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3(); this.c = new THREE.Color();
    this.axis = new THREE.Vector3();
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
  }

  attach(sim) { this.sim = sim; this.bodyOwner.length = 0; this.capOwner.length = 0; this.body.count = 0; this.caps.count = 0; }

  update(selected, now) {
    const { body, caps, m4, q, p, s, c, axis } = this;
    let kb = 0, kc = 0;
    this.bodyOwner.length = 0; this.capOwner.length = 0;
    for (const cr of this.sim.creatures) {
      if (!cr.alive) continue;
      const parts = cr.genome.parts;
      for (let i = 0; i < cr.bodies.length && kb < MAX_PARTS; i++) {
        const t = cr.pos[i], r = cr.rot[i];   // 物理ステップ直後に sim が写した姿勢
        const part = parts[i], h = capsuleHalf(part);
        if (cr.dead) c.set(CORPSE_COLOR);
        else speciesColor(cr.species, c, i === 0 ? 0.42 : 0.56);
        if (cr === selected && !cr.dead) c.offsetHSL(0, 0, 0.12);
        q.set(r.x, r.y, r.z, r.w);
        // 胴
        if (h > 0.005) {
          p.set(t.x, t.y, t.z); s.set(part.r, 2 * h, part.r);
          m4.compose(p, q, s);
          body.setMatrixAt(kb, m4); body.setColorAt(kb, c);
          this.bodyOwner[kb++] = cr;
        }
        // 両端の球（胴がなければ中心に1つ）
        axis.set(0, h, 0).applyQuaternion(q);
        s.set(part.r, part.r, part.r);
        for (const sign of h > 0.005 ? [1, -1] : [0]) {
          p.set(t.x + axis.x * sign, t.y + axis.y * sign, t.z + axis.z * sign);
          m4.compose(p, q, s);
          caps.setMatrixAt(kc, m4); caps.setColorAt(kc, c);
          this.capOwner[kc++] = cr;
        }
      }
    }
    for (const m of [body, caps]) {
      m.count = m === body ? kb : kc;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (selected && selected.alive && selected.bodies[0]) {
      const t = selected.pos[0];
      this.marker.visible = true;
      this.marker.position.set(t.x, t.y + 1.6 + Math.sin(now / 300) * 0.15, t.z);
    } else this.marker.visible = false;
  }

  // 画面上の点（ブラウザ座標）にいる生物を返す
  pick(clientX, clientY, camera, canvas) {
    const r = canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, camera);
    this.body.computeBoundingSphere(); this.caps.computeBoundingSphere();
    const hit = this.ray.intersectObjects([this.body, this.caps], false)[0];
    if (!hit || hit.instanceId === undefined) return null;
    const owners = hit.object === this.body ? this.bodyOwner : this.capOwner;
    return owners[hit.instanceId] ?? null;
  }
}
