// ===== シミュレーションコアの公開窓口 =====
// 描画や UI はここからだけ import する（内部ファイルの構成を変えても外側に影響しないように）。
export { Sim } from './sim.js';
export { CFG, SCHEDULE, NI, NH, NO } from './config.js';
export { PLANT_SPECIES } from './plant-species.js';
export { makeRng } from './random.js';
export { qRot } from './math.js';
export { SectionProfiler, NULL_PROFILER } from './profiler.js';
export {
  NMARK, randomGenome, cloneGenome, recombine, mutate,
  markerDivergence, morphDistance, geneDistance, compatibility, recognizes, genomeStats,
} from './genetics.js';
