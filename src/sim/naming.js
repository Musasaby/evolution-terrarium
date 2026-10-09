// ===== 種の名前 =====

const SYL = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワガギグゲゴザジズゼゾダデドバビブベボパピプペポ';
export function speciesName(rng) {
  let s = '';
  const n = rng.int(2, 4);
  for (let i = 0; i < n; i++) s += SYL[Math.floor(rng() * SYL.length)];
  return s + rng.pick(['ムシ', 'モドキ', 'ガイ', 'ジュウ', 'ノコ', 'ダマ', 'ボウ', 'アシ']);
}
