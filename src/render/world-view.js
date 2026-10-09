// ===== 3D 描画のまとめ役 =====
// 各描画部品を束ね、「sim の状態を画面に映す」ことだけを担当する。UI やシミュレーションの進行は知らない。
import { createStage } from './scene.js';
import { TerrainView } from './terrain-view.js';
import { EnvironmentView } from './environment-view.js';
import { CreatureView } from './creature-view.js';
import { PlantView } from './plant-view.js';

export class WorldView {
  constructor(container, { markerColor }) {
    this.stage = createStage(container);
    const { scene, controls } = this.stage;
    this.terrain = new TerrainView(scene);
    this.env = new EnvironmentView(scene, controls);
    this.creatures = new CreatureView(scene, { markerColor });
    this.plants = new PlantView(scene);
    this.canvas = this.stage.renderer.domElement;
  }

  attach(sim) {
    this.sim = sim;
    this.terrain.attach(sim);
    this.env.attach(sim);
    this.creatures.attach(sim);
    this.plants.attach(sim);
    this.plants.rebuild();
    this.env.update(0);
    this.stage.resetCamera();
  }

  // シーンの中身を sim に合わせて更新する（描画そのものは render()）
  update(dt, now, { selected, follow }) {
    if (!this.sim) return;
    this.terrain.update(now);
    this.plants.update(now);
    this.creatures.update(selected, now);
    this.env.update(dt);
    if (follow && selected && selected.alive && selected.bodies[0]) this.stage.panToward(selected.bodies[0].translation(), Math.min(1, dt * 3));
  }

  render() { this.stage.render(); }
  renderInfo() { return this.stage.renderInfo(); }

  // クリック位置の生物を返す
  pick(clientX, clientY) { return this.creatures.pick(clientX, clientY, this.stage.camera, this.canvas); }
}
