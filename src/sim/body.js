// ===== 体（剛体と関節）の構築と運動制御 =====
// 物理エンジン RAPIER と、体を置く world を引数で受け取る。シミュレーション本体には依存しない。
import { CFG, O_TURN, O_GO } from './config.js';
import { clamp, qMul, qAxis, qRot, qConj } from './math.js';
import { capsuleHalf } from './genetics.js';

// 体節の当たり判定：カプセル（円柱より接触計算がずっと軽い）。胴がなくなるほど短い体節は球
function partShape(R, p) {
  const h = capsuleHalf(p);
  return h > 0.005 ? R.ColliderDesc.capsule(h, p.r) : R.ColliderDesc.ball(p.r);
}

// ゲノムから剛体・関節を組み立てる。groundFn(x,z) で地面高さを与える
export function buildBody(R, world, genome, x, z, groundFn, yaw, lift = 0) {
  const parts = genome.parts;
  const tf = [];
  let q0 = qAxis({ x: 0, y: 0, z: 1 }, Math.PI / 2); // 根を横倒し
  q0 = qMul(qAxis({ x: 0, y: 1, z: 0 }, yaw), q0);
  tf[0] = { q: q0, p: { x: 0, y: 0, z: 0 } };
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i], par = parts[p.parent], pt = tf[p.parent];
    const ax = { x: Math.cos(p.az), y: 0, z: Math.sin(p.az) };
    const q = qMul(pt.q, qAxis(ax, p.a0));
    const anchorP = qRot(pt.q, { x: 0, y: p.t * par.len / 2, z: 0 });
    const anchorC = qRot(q, { x: 0, y: -p.len / 2, z: 0 });
    tf[i] = { q, p: { x: pt.p.x + anchorP.x - anchorC.x, y: pt.p.y + anchorP.y - anchorC.y, z: pt.p.z + anchorP.z - anchorC.z } };
  }
  let minY = Infinity, ground = -Infinity;
  for (let i = 0; i < parts.length; i++) {
    const up = qRot(tf[i].q, { x: 0, y: parts[i].len / 2, z: 0 });
    minY = Math.min(minY, tf[i].p.y - Math.abs(up.y) - parts[i].r);
    ground = Math.max(ground, groundFn(x + tf[i].p.x, z + tf[i].p.z));
  }
  const dy = ground - minY + 0.15 + lift;
  const bodies = [], cols = [], joints = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const b = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x + tf[i].p.x, tf[i].p.y + dy, z + tf[i].p.z)
      .setRotation(tf[i].q).setCanSleep(false).setLinearDamping(0.1).setAngularDamping(0.3));
    const col = world.createCollider(partShape(R, p).setDensity(CFG.DENSITY).setFriction(1.0)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS | R.ActiveEvents.COLLISION_EVENTS).setContactForceEventThreshold(0)
      .setActiveHooks(R.ActiveHooks.FILTER_CONTACT_PAIRS), b);
    bodies.push(b); cols.push(col);
  }
  const sub = parts.map((p, i) => bodies[i].mass());
  for (let i = parts.length - 1; i > 0; i--) sub[parts[i].parent] += sub[i];
  const total = sub[0];
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i], par = parts[p.parent];
    const ax = { x: Math.cos(p.az), y: 0, z: Math.sin(p.az) };
    const jd = R.JointData.revolute({ x: 0, y: p.t * par.len / 2, z: 0 }, { x: 0, y: -p.len / 2, z: 0 }, ax);
    const j = world.createImpulseJoint(jd, bodies[p.parent], bodies[i], true);
    j.setContactsEnabled(false);
    j.setLimits(p.a0 - p.range, p.a0 + p.range);
    j.configureMotorModel(R.MotorModel.ForceBased);
    j.stiff = p.str * (sub[i] + total * 0.3) * (p.len + 0.3) * 60 + 2;
    j.damp = j.stiff * 0.01;
    j.ax = ax;
    // 体の左右どちら側にある体節か（根の体節から見た横方向の位置）。曲がるときは片側の動きを強める
    const loc = qRot(qConj(q0), tf[i].p);
    j.side = clamp(loc.z / 0.6, -1, 1);
    j.configureMotorPosition(p.a0, j.stiff, j.damp);
    joints.push(j);
  }
  return { bodies, cols, joints };
}

// ---- 剛体の姿勢の写し ----
// 剛体の位置・回転・角速度は、読むたびに WASM から JS へのコピーとオブジェクト生成が起きる。
// 物理ステップの直後に1回だけ読んで c.pos / c.rot / c.angv に写しておき、次の物理ステップまではこれを使う。
// （物理ステップの外では剛体の姿勢は変わらないので、読み直しても同じ値になる）
export function readPose(c) {
  const bs = c.bodies, n = bs.length;
  if (!c.pos || c.pos.length !== n) {
    c.pos = []; c.rot = []; c.angv = [];
    for (let i = 0; i < n; i++) { c.pos.push({ x: 0, y: 0, z: 0 }); c.rot.push({ x: 0, y: 0, z: 0, w: 1 }); c.angv.push({ x: 0, y: 0, z: 0 }); }
  }
  for (let i = 0; i < n; i++) {
    const b = bs[i], t = b.translation(), r = b.rotation(), w = b.angvel();
    const P = c.pos[i], Q = c.rot[i], W = c.angv[i];
    P.x = t.x; P.y = t.y; P.z = t.z;
    Q.x = r.x; Q.y = r.y; Q.z = r.z; Q.w = r.w;
    W.x = w.x; W.y = w.y; W.z = w.z;
  }
}

// 関節 ji の現在角（readPose で写した回転を使う）
export function jointAngle(c, ji) {
  const p = c.genome.parts[ji + 1];
  const qp = c.rot[p.parent], qc = c.rot[ji + 1];
  const q = qMul(qConj(qp), qc), ax = c.joints[ji].ax;
  return 2 * Math.atan2(q.x * ax.x + q.y * ax.y + q.z * ax.z, q.w);
}
export function readJointAngles(c) {
  for (let j = 0; j < c.joints.length; j++) c.angles[j] = jointAngle(c, j);
}

// 暴走を防ぐ速度の上限
export function clampVel(c) {
  for (const b of c.bodies) {
    const v = b.linvel(), s = Math.hypot(v.x, v.y, v.z);
    if (s > 12) b.setLinvel({ x: v.x * 12 / s, y: v.y * 12 / s, z: v.z * 12 / s }, true);
    const w = b.angvel(), ws = Math.hypot(w.x, w.y, w.z);
    if (ws > 25) b.setAngvel({ x: w.x * 25 / ws, y: w.y * 25 / ws, z: w.z * 25 / ws }, true);
  }
}

// 神経の出力と内部リズムから関節モーターの目標を決める（readPose で写した角速度を使う）。戻り値は運動量（エネルギー消費の計算に使う）
export function driveMotors(c) {
  const parts = c.genome.parts;
  let move = 0;
  const tired = c.energy < c.maxE * 0.08 ? 0.4 : 1;
  // 生まれつきの走性：食べ物の方向へ曲がり（taxis）、食べ物がないときは歩みを速める（seek）。強さと向きは遺伝する
  const s = c.sense, g = c.genome;
  const food = s && s.pp > 0 && c.ate <= 0;
  const turn = Math.tanh(c.out[O_TURN] + (food ? (g.taxis ?? 0) * s.ps : 0));
  const go = Math.tanh(c.out[O_GO] + (g.seek ?? 0) * (c.ate > 0 ? -0.6 : 0.6));
  for (let j = 0; j < c.joints.length; j++) {
    const p = parts[j + 1], jt = c.joints[j];
    const ph = c.phase + (p.ph ?? 0);
    const amp = (p.amp ?? 1) * (0.55 + 0.45 * go) * Math.max(0, 1 + 0.9 * turn * (jt.side ?? 0));
    const tgt = p.a0 + p.range * Math.tanh(c.out[j] * 0.6 + amp * Math.sin(ph) + (p.tw ?? 0) * turn * Math.cos(ph));
    jt.configureMotorPosition(tgt, jt.stiff * tired, jt.damp);
    const b1 = c.angv[p.parent], b2 = c.angv[j + 1];
    const w = Math.abs((b2.x - b1.x) * jt.ax.x + (b2.y - b1.y) * jt.ax.y + (b2.z - b1.z) * jt.ax.z);
    move += jt.stiff * tired * Math.abs(tgt - c.angles[j]) * Math.min(w, 8);
  }
  return move;
}

// 根の体節の長軸（転がっても変わらない）を水平に射影した向き
export function heading(q) {
  let f = qRot(q, { x: 0, y: 1, z: 0 });
  let l = Math.hypot(f.x, f.z);
  if (l < 0.2) { f = qRot(q, { x: 1, y: 0, z: 0 }); l = Math.hypot(f.x, f.z) || 1; }
  return { x: f.x / l, z: f.z / l };
}
// 進行方向：実際に進んでいる向き（速度の移動平均）。ほぼ止まっているときは体の向き
export function travelDir(c, q) {
  // 歩行のゆれを均すため、約2秒分の移動を平均する
  const v = c.bodies[0].linvel();
  const k = 0.08;
  c.vx = (c.vx || 0) * (1 - k) + v.x * k; c.vz = (c.vz || 0) * (1 - k) + v.z * k;
  const sp = Math.hypot(c.vx, c.vz);
  if (sp > 0.08) return { x: c.vx / sp, z: c.vz / sp };
  return heading(q);
}
