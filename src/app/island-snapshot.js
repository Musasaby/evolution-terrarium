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
// 250 ms ごとに送る分。selectedId: 主スレッドで選んでいる個体の id（無ければ null）。sections: 区間計測の値（無ければ null）
export function packPanels(sim, sent, selectedId, sections) {
  const out = {
    species: [...sim.species.values()].map(speciesData),
    counters: { ...sim.counters }, litters: sim.litters.slice(), physics: sim.physicsCounts(),
    plants: sim.plants.map((p) => ({ id: p.id, spIdx: p.spIdx, x: p.x, y: p.y, z: p.z, size: p.size, rot: p.rot, shapeSeed: p.shapeSeed, energy: p.energy, maxE: p.maxE })),
    stats: null, events: null, terrain: null, selected: null, sections,
  };
  const st = sim.stats, lastT = st.length ? st[st.length - 1].t : -1;
  if (st.length !== sent.statsLen || lastT !== sent.statsT) { out.stats = structuredClone(st); sent.statsLen = st.length; sent.statsT = lastT; }   // 間引かれることがあるので丸ごと送る
  if (sim.events[0] !== sent.eventsTop || sim.events.length !== sent.eventsLen) { out.events = sim.events.map((e) => ({ ...e })); sent.eventsTop = sim.events[0] ?? null; sent.eventsLen = sim.events.length; }
  if (sim.terrainVersion !== sent.terrainVersion) { out.terrain = { version: sim.terrainVersion, H: sim.H.slice(), distWater: sim.distWater.slice(), soil: sim.soil.slice() }; sent.terrainVersion = sim.terrainVersion; }
  const c = selectedId == null ? null : sim.creatures.find((x) => x.id === selectedId && x.alive);
  if (c) out.selected = { id: c.id, energy: c.energy, corpseE: c.corpseE ?? 0, age: c.age, children: c.children, kills: c.kills, eaten: c.eaten, crowd: c.crowd, litter: c.litter ?? 0, cause: c.cause ?? '', cost: { ...c.cost } };
  return out;
}
// 種の情報（代表ゲノム rep は送らない）
export function speciesData(sp) { const { rep, ...rest } = sp; return rest; }
// 気候の値（関数の rng・log は送れないので外す）
function climateData(cl) { const { rng, log, ...rest } = cl; return rest; }
