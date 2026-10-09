// ===== 生物の描画（円柱のインスタンス描画）と、クリックでの選択 =====
// sim から読むもの: creatures（体の剛体・ゲノム・種）
import * as THREE from 'three';
import { speciesColor, CORPSE_COLOR } from './palette.js';

const MAX_INST = 2400;

export class CreatureView {
  constructor(scene, { markerColor }) {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }), MAX_INST);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 4), new THREE.MeshBasicMaterial({ color: markerColor }));
    this.marker.rotation.x = Math.PI; this.marker.visible = false;
    scene.add(this.marker);
    this.instToCreature = [];
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3(); this.c = new THREE.Color();
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
  }

  attach(sim) { this.sim = sim; this.instToCreature.length = 0; this.mesh.count = 0; }

  update(selected, now) {
    const { mesh, m4, q, p, s, c } = this;
    let k = 0;
    this.instToCreature.length = 0;
    for (const cr of this.sim.creatures) {
      if (!cr.alive) continue;
      const parts = cr.genome.parts;
      for (let i = 0; i < cr.bodies.length && k < MAX_INST; i++) {
        const b = cr.bodies[i], t = b.translation(), r = b.rotation();
        p.set(t.x, t.y, t.z); q.set(r.x, r.y, r.z, r.w); s.set(parts[i].r, parts[i].len, parts[i].r);
        m4.compose(p, q, s);
        mesh.setMatrixAt(k, m4);
        if (cr.dead) c.set(CORPSE_COLOR);
        else speciesColor(cr.species, c, i === 0 ? 0.42 : 0.56);
        if (cr === selected && !cr.dead) c.offsetHSL(0, 0, 0.12);
        mesh.setColorAt(k, c);
        this.instToCreature[k] = cr;
        k++;
      }
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (selected && selected.alive && selected.bodies[0]) {
      const t = selected.bodies[0].translation();
      this.marker.visible = true;
      this.marker.position.set(t.x, t.y + 1.6 + Math.sin(now / 300) * 0.15, t.z);
    } else this.marker.visible = false;
  }

  // 画面上の点（ブラウザ座標）にいる生物を返す
  pick(clientX, clientY, camera, canvas) {
    const r = canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, camera);
    this.mesh.computeBoundingSphere();
    const hit = this.ray.intersectObject(this.mesh, false)[0];
    return hit && hit.instanceId !== undefined ? this.instToCreature[hit.instanceId] ?? null : null;
  }
}
