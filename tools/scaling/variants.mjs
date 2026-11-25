// スケーリング検証の条件（V0）。prepare で Sim を作った直後の geo を差し替える。
// geo は sim.geo と sim.flora.geo の両方が同じ値を指すようにする。

function overrideGeo(sim, patch) {
  sim.geo = Object.freeze({ ...sim.geo, ...patch });
  sim.flora.geo = sim.geo;
}

const twice = (n) => Math.round(n * 2);
const four = (n) => Math.round(n * 4);

export const VARIANTS = {
  base: {
    desc: '既定の広さと上限',
    prepare() {},
  },
  pop2: {
    desc: '個体数の上限を 2 倍',
    prepare(sim) {
      overrideGeo(sim, { maxPop: twice(sim.geo.maxPop) });
    },
  },
  pop4: {
    desc: '個体数の上限を 4 倍',
    prepare(sim) {
      overrideGeo(sim, { maxPop: four(sim.geo.maxPop) });
    },
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
  },
};

export function getVariant(name) {
  const v = VARIANTS[name];
  if (!v) {
    throw new Error(`知らない条件 "${name}"。使える名前: ${Object.keys(VARIANTS).join(', ')}`);
  }
  return v;
}
