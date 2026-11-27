// ===== 見ている島の写しに送る中身を詰める（worker 側。DOM・three に依存しない） =====
export const POSE_STRIDE = 7;   // 1 体節あたり [x, y, z, qx, qy, qz, qw]

// 写しに送り済みのものを覚えておく（worker ごとに 1 つ）
export function createSentState() {
  return { creatures: new Set(), species: new Set(), terrainVersion: -1, statsLen: -1, statsT: -1, eventsTop: null, eventsLen: -1 };
}
// 毎フレーム送る分。生きている（alive）個体の id・死骸か・姿勢と、はじめて送る個体・種の静的な情報
export function packFrame(sim, sent) {
  const list = sim.creatures.filter((c) => c.alive);
  const ids = new Int32Array(list.length), dead = new Uint8Array(list.length);
  let nParts = 0; for (const c of list) nParts += c.pos.length;
  const poses = new Float32Array(nParts * POSE_STRIDE);
  const born = [], species = [], live = new Set();
  let k = 0;
  list.forEach((c, j) => {
    ids[j] = c.id; dead[j] = c.dead ? 1 : 0; live.add(c.id);
    for (let i = 0; i < c.pos.length; i++) { const p = c.pos[i], r = c.rot[i]; poses[k++] = p.x; poses[k++] = p.y; poses[k++] = p.z; poses[k++] = r.x; poses[k++] = r.y; poses[k++] = r.z; poses[k++] = r.w; }
    if (c.species && !sent.species.has(c.species.id)) { sent.species.add(c.species.id); species.push(speciesData(c.species)); }
    if (!sent.creatures.has(c.id)) { sent.creatures.add(c.id); born.push(creatureStatic(c)); }
  });
  for (const id of sent.creatures) if (!live.has(id)) sent.creatures.delete(id);   // 消えた個体は忘れる
  const packet = { t: sim.t, climate: climateData(sim.climate), ids, dead, poses, born, species };
  return { packet, transfer: [ids.buffer, dead.buffer, poses.buffer] };
}
// 個体の生涯変わらない情報
function creatureStatic(c) {
  return { id: c.id, genome: c.genome, speciesId: c.species?.id ?? null, gen: c.gen, parents: c.parents, born: c.born,
    vol: c.vol, nParts: c.pos.length, nJoints: c.joints.length, maxE: c.maxE, topt: c.topt, tTol: c.tTol, aqua: c.aqua, eff: c.eff, mutations: c.mutations };
}
// 種の情報（代表ゲノム rep は送らない）
export function speciesData(sp) { const { rep, ...rest } = sp; return rest; }
// 気候の値（関数の rng・log は送れないので外す）
function climateData(cl) { const { rng, log, ...rest } = cl; return rest; }
