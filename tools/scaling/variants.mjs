// スケーリング検証の条件（V0）。prepare で Sim を作った直後の geo を差し替える。
// geo は sim.geo と sim.flora.geo の両方が同じ値を指すようにする。

function overrideGeo(sim, patch) {
  sim.geo = Object.freeze({ ...sim.geo, ...patch });
  sim.flora.geo = sim.geo;
}

const twice = (n) => Math.round(n * 2);
const four = (n) => Math.round(n * 4);

// すでに登録済みの生物の体節と、以後に登録される生物の体節すべてに fn を呼ぶ。
// colliderOwner.set は生物以外（地形・植物）にも使われるので、kind === 'c' のときだけ fn を呼ぶ。
function onCreatureCollider(sim, fn) {
  const owner = sim.colliderOwner;
  for (const [handle, o] of owner) {
    if (o.kind === 'c') fn(sim.world.getCollider(handle), o);
  }
  const set = owner.set.bind(owner);
  owner.set = (handle, o) => {
    const ret = set(handle, o);
    if (o && o.kind === 'c') fn(sim.world.getCollider(handle), o);
    return ret;
  };
}

// 昇順に並べた配列のパーセンタイル（線形補間）。空なら undefined。
function percentile(sorted, p) {
  if (sorted.length === 0) return undefined;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// すべての条件に共通の動きの指標。生きている個体だけを見る。
function sampleBase(sim) {
  const speeds = [];
  let broken = 0;
  for (const c of sim.creatures) {
    if (!c.alive || c.dead) continue;
    speeds.push(Math.hypot(c.vx || 0, c.vz || 0));
    const p0 = c.pos?.[0];
    if (!p0) continue;
    const y = p0.y - sim.heightAt(p0.x, p0.z);
    if (!Number.isFinite(y) || y > 3) broken++;
  }
  speeds.sort((a, b) => a - b);
  return {
    speedP10: percentile(speeds, 0.1),
    speedP50: percentile(speeds, 0.5),
    speedP90: percentile(speeds, 0.9),
    broken,
    iters: sim.world.numSolverIterations,
  };
}

// groups16 だけが返す、根の体節が近い個体の組の数。
function samplePairs(sim) {
  const live = sim.creatures.filter((c) => c.alive && !c.dead && c.pos?.[0]);
  let nearPairs = 0, sameGroupPairs = 0;
  for (let i = 0; i < live.length; i++) {
    const a = live[i].pos[0];
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j].pos[0];
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d < 3) {
        nearPairs++;
        if (live[i].id % 16 === live[j].id % 16) sameGroupPairs++;
      }
    }
  }
  return { nearPairs, sameGroupPairs };
}

export const VARIANTS = {
  base: {
    desc: '既定の広さと上限',
    prepare() {},
    sample: sampleBase,
  },
  pop2: {
    desc: '個体数の上限を 2 倍',
    prepare(sim) {
      overrideGeo(sim, { maxPop: twice(sim.geo.maxPop) });
    },
    sample: sampleBase,
  },
  pop4: {
    desc: '個体数の上限を 4 倍',
    prepare(sim) {
      overrideGeo(sim, { maxPop: four(sim.geo.maxPop) });
    },
    sample: sampleBase,
  },
  pop2plants2: {
    desc: '個体数・植物の上限を 2 倍',
    prepare(sim) {
      overrideGeo(sim, {
        maxPop: twice(sim.geo.maxPop),
        maxPlants: twice(sim.geo.maxPlants),
        maxSoftPlants: twice(sim.geo.maxSoftPlants),
        maxHardPlants: twice(sim.geo.maxHardPlants),
      });
    },
    sample: sampleBase,
  },
  // ---- V1: 衝突判定を軽くする差し替え案 ----
  groups16: {
    desc: '体節の衝突グループを id で 16 分割し、フックを外す',
    prepare(sim, R) {
      onCreatureCollider(sim, (col, o) => {
        const bit = 1 << (o.obj.id % 16);
        col.setCollisionGroups(((bit << 16) | (0xFFFF ^ bit)) >>> 0);
        col.setActiveHooks(R.ActiveHooks.NONE);
      });
    },
    sample(sim) {
      return { ...sampleBase(sim), ...samplePairs(sim) };
    },
  },
  iter2: {
    desc: 'ソルバの反復回数を 2 にする（既定 4）',
    prepare(sim) {
      sim.world.numSolverIterations = 2;
    },
    sample: sampleBase,
  },
  iter3: {
    desc: 'ソルバの反復回数を 3 にする（既定 4）',
    prepare(sim) {
      sim.world.numSolverIterations = 3;
    },
    sample: sampleBase,
  },
  'events-lean': {
    desc: '生物の体節から COLLISION_EVENTS を外す（採食は植物側のイベントで続く）',
    prepare(sim, R) {
      onCreatureCollider(sim, (col) => {
        col.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS);
      });
    },
    sample: sampleBase,
  },
  'events-root': {
    desc: 'events-lean に加え、根以外の体節のイベントを止める',
    prepare(sim, R) {
      onCreatureCollider(sim, (col, o) => {
        col.setActiveEvents(o.part > 0 ? R.ActiveEvents.NONE : R.ActiveEvents.CONTACT_FORCE_EVENTS);
      });
    },
    sample: sampleBase,
  },
};

export function getVariant(name) {
  const v = VARIANTS[name];
  if (!v) {
    throw new Error(`知らない条件 "${name}"。使える名前: ${Object.keys(VARIANTS).join(', ')}`);
  }
  return v;
}
