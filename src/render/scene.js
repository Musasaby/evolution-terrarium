// ===== 3D の土台：レンダラー・カメラ・操作・照明 =====
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const CAMERA_HOME = { target: [0, 4, 0], position: [0, 62, 82] };

export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(1.5, devicePixelRatio));
  container.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 600);
  camera.position.set(...CAMERA_HOME.position);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.48; controls.minDistance = 4; controls.maxDistance = 220;
  const hemi = new THREE.HemisphereLight(0xdfeefc, 0x4a4630, 1.1);
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.6);
  sun.position.set(40, 80, 30);
  scene.add(hemi, sun);
  scene.fog = new THREE.Fog(0x9cc3d9, 120, 320);

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  return {
    renderer, scene, camera, controls,
    resetCamera() { controls.target.set(...CAMERA_HOME.target); camera.position.set(...CAMERA_HOME.position); },
    // カメラを target の方へ k の割合だけ寄せる（注視点とカメラを一緒に平行移動）
    panToward(t, k) {
      const dx = t.x - controls.target.x, dy = t.y - controls.target.y, dz = t.z - controls.target.z;
      controls.target.x += dx * k; controls.target.y += dy * k; controls.target.z += dz * k;
      camera.position.x += dx * k; camera.position.y += dy * k; camera.position.z += dz * k;
    },
    render() { controls.update(); renderer.render(scene, camera); },
    // 直前の render() の描画統計
    renderInfo() {
      const i = renderer.info;
      return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
    },
  };
}
