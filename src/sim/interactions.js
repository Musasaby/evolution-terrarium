// ===== 接触による相互作用：採食・捕食・繁殖 =====
// 物理エンジンの接触イベントを、当たり判定の持ち主（生物・植物・地形）に応じて振り分ける。
import { CFG, EDGE } from './config.js';
import { clamp } from './math.js';
import { recombine, mutate, genomeStats, compatibility, recognizes } from './genetics.js';
import { spawnCreature, kill, center, livingCount, isLiving } from './creatures.js';

// 物理ステップ後に呼ぶ。イベントキューを読み切って処理する
export function processContacts(sim, dt) {
  const owner = sim.colliderOwner, queue = sim.eventQueue;
  const pairs = [];
  queue.drainContactForceEvents(ev => {
    const a = owner.get(ev.collider1()), b = owner.get(ev.collider2());
    if (!a || !b) return;
    if (a.kind === 't' || b.kind === 't') return;
    pairs.push([a, b, ev.totalForceMagnitude()]);
  });
  for (const [a, b, F] of pairs) handleContact(sim, a, b, F, dt);
  // 柔らかい植物（センサー）との重なりの開始・終了を記録しておき、重なっている間は草を食む
  queue.drainCollisionEvents((h1, h2, started) => {
    const a = owner.get(h1), b = owner.get(h2);
    if (!a || !b) return;
    const pl = a.kind === 'p' ? a : b.kind === 'p' ? b : null, cr = a.kind === 'c' ? a : b.kind === 'c' ? b : null;
    if (!pl || !cr) return;
    const key = h1 < h2 ? h1 + ':' + h2 : h2 + ':' + h1;
    if (started) sim.grazing.set(key, { p: pl.obj, c: cr }); else sim.grazing.delete(key);
  });
  graze(sim, dt);
  queue.clear?.();
}

function feed(cr, gain) {
  cr.energy = Math.min(cr.maxE, cr.energy + gain); cr.eaten += gain; cr.ate = 0.5;
}

function graze(sim, dt) {
  for (const [key, g] of sim.grazing) {
    const p = g.p, cr = g.c.obj;
    if (!p.alive || !cr.alive || cr.dead) { sim.grazing.delete(key); continue; }
    const body = cr.bodies[g.c.part]; if (!body) { sim.grazing.delete(key); continue; }
    const v = body.linvel(), spd = Math.hypot(v.x, v.y, v.z);
    // 勢いよく触れるほど多く食べられる。食べ尽くした草はしばらく回復せず、次の草場へ移る必要がある
    if (p.dormant > sim.t) continue;
    const floor = p.maxE * CFG.GRAZE_FLOOR;
    const dmg = Math.min(Math.max(0, p.energy - floor), (4 + body.mass() * spd * 0.5) * dt);
    if (dmg <= 0) continue;
    p.energy -= dmg;
    if (p.energy <= floor + 0.01) p.dormant = sim.t + sim.rng.range(...CFG.RECOVER);
    feed(cr, dmg * 0.85 * CFG.FOOD_GAIN);
  }
}

function handleContact(sim, a, b, F, dt) {
  if (a.kind === 'p' || b.kind === 'p') { browse(sim, a.kind === 'c' ? a : b, (a.kind === 'p' ? a : b).obj, F, dt); return; }
  if (a.kind !== 'c' || b.kind !== 'c') return;
  const A = a.obj, B = b.obj;
  if (!A.alive || !B.alive || A === B) return;
  const ba = A.bodies[a.part], bb = B.bodies[b.part];
  if (!ba || !bb) return;
  const va = ba.linvel(), vb = bb.linvel();
  const sa = Math.hypot(va.x, va.y, va.z), sb = Math.hypot(vb.x, vb.y, vb.z);
  // 繁殖
  if (!A.dead && !B.dead) tryMate(sim, A, B);
  // 衝突によるダメージ：一定以上の速さでぶつかった側が相手を削る（衝突の強さ × 速さ）
  const ma = ba.mass(), mb = bb.mass();
  const base = Math.max(0, F - (ma + mb) * 9.81 * 0.8);
  const k = 0.02 * dt;
  const hitA = base * k * Math.max(0, sa - 0.9) * (sa * sa) / (sa * sa + sb * sb + 0.05); // A が B に与える
  const hitB = base * k * Math.max(0, sb - 0.9) * (sb * sb) / (sa * sa + sb * sb + 0.05);
  applyHit(sim, A, B, hitA);
  applyHit(sim, B, A, hitB);
}

// 硬い植物（木・低木・サボテン）を食べる
function browse(sim, c, p, F, dt) {
  const cr = c.obj; if (!cr || cr.dead || !p.alive) return;
  const body = cr.bodies[c.part]; if (!body) return;
  const m = body.mass();
  const v = body.linvel(), sp = Math.hypot(v.x, v.y, v.z);
  const eff = Math.max(0, F - m * 9.81 * 1.2) + m * sp * 6;
  // 木の葉は高い位置に届く体の部分なら食べやすい。低い位置は幹に体当たりして少しずつ削るしかない
  const high = body.translation().y - p.y > CFG.CANOPY * p.size;
  const dmg = Math.min(p.energy, (high ? 5.0 + eff * 0.02 : eff * 0.015) * dt);
  if (dmg <= 0) return;
  p.energy -= dmg;
  feed(cr, dmg * 0.85 * CFG.FOOD_GAIN);
  if (p.energy <= 0.01) sim.flora.remove(p);
}

function applyHit(sim, att, tgt, dmg) {
  if (att.dead || dmg <= 0.001) return;
  if (tgt.dead) {
    const d = Math.min(tgt.corpseE, dmg * 1.5);
    tgt.corpseE -= d;
    feed(att, d * 0.8 * CFG.FOOD_GAIN);
    return;
  }
  const d = Math.min(tgt.energy, dmg);
  tgt.energy -= d; tgt.hurt = 0.5;
  feed(att, d * 0.7 * CFG.FOOD_GAIN);
  if (tgt.energy <= 0) { kill(sim, tgt, `捕食（${att.species?.name || '?'}）`); att.kills++; sim.counters.predations++; }
}

export function tryMate(sim, A, B) {
  const t = sim.t;
  if (t - A.lastMate < 8 || t - B.lastMate < 8 || A.age < 6 || B.age < 6) return;
  if (A.energy < A.maxE * CFG.MATE_E || B.energy < B.maxE * CFG.MATE_E) return;
  if (livingCount(sim) > CFG.MAX_POP - CFG.MAX_LITTER) return; // 子を育てる余地がない
  const rng = sim.rng;
  const key = A.id < B.id ? A.id + ':' + B.id : B.id + ':' + A.id;
  if ((sim.rejectUntil.get(key) || 0) > t) return;
  // 交配前の隔離：互いを配偶相手と認めるか（体色と選り好み）
  if (rng() > recognizes(A.genome, B.genome) * recognizes(B.genome, A.genome)) {
    sim.rejectUntil.set(key, t + 15); sim.counters.rejected++; return;
  }
  const compat = compatibility(A.genome, B.genome);
  // 両親が差し出したエネルギーの総量で子の数が決まる
  const ca = A.energy * CFG.INVEST, cb = B.energy * CFG.INVEST;
  A.energy -= ca; B.energy -= cb; A.lastMate = t; B.lastMate = t;
  // 交配行動そのものにもエネルギーを使い、その分は子に回らない
  let pool = Math.max(0, ca + cb - CFG.MATE_COST * (A.maxE + B.maxE));
  const pa = center(A), pb = center(B);
  const mx = (pa.x + pb.x) / 2, mz = (pa.z + pb.z) / 2;
  const born = [];
  let stillborn = 0;
  for (let k = 0; k < CFG.MAX_LITTER; k++) {
    const g = recombine(A.genome, B.genome, rng);
    const muts = mutate(g, rng);
    const st = genomeStats(g);
    const cost = CFG.CHILD_COST * (500 * st.vol + 60);
    // 最後の1体は残りのエネルギーに応じた確率で生まれる（期待値＝総エネルギー÷1体の費用）
    if (pool < cost && !(k > 0 && rng() < pool / cost)) break;
    const e = Math.min(pool, cost); pool -= e;
    // 交配後の隔離：系統が離れていると雑種は育たない
    if (rng() > compat) { stillborn++; continue; }
    const ang = (k / 3 + rng() * 0.3) * Math.PI * 2, d = 1.2 + k * 0.35;
    const x = clamp(mx + Math.cos(ang) * d, -EDGE, EDGE), z = clamp(mz + Math.sin(ang) * d, -EDGE, EDGE);
    const sp = speciesForChild(sim, g, A, B);
    const child = spawnCreature(sim, g, x, z, { species: sp, gen: Math.max(A.gen, B.gen) + 1, energy: e, parents: [A.id, B.id], lift: 0.5 + k * 0.15, mutations: muts });
    born.push(child);
  }
  // 使い切れなかった分は親へ戻る
  if (pool > 0) { A.energy = Math.min(A.maxE, A.energy + pool / 2); B.energy = Math.min(B.maxE, B.energy + pool / 2); }
  for (const c of born) c.litter = born.length;
  A.children += born.length; B.children += born.length;
  sim.counters.births += born.length; sim.counters.stillborn += stillborn; sim.counters.matings++;
  sim.litters.push(born.length);
  if (sim.litters.length > 200) sim.litters.shift();
  if (A.species !== B.species && born.length) sim.log(`「${A.species.name}」と「${B.species.name}」の雑種が${born.length}体生まれた`, 'species');
  return born;
}

// 親と同じ種に入る。異種間の雑種は、より交配できる側の種に入る
function speciesForChild(sim, g, A, B) {
  if (A.species === B.species) return A.species;
  const score = (sp) => {
    let s = 0, n = 0;
    for (const o of sim.creatures) if (isLiving(o) && o.species === sp && n < 12) { s += compatibility(g, o.genome); n++; }
    return n ? s / n : 0;
  };
  return score(A.species) >= score(B.species) ? A.species : B.species;
}
