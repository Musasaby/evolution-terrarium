// ===== 数値ユーティリティとクォータニオン =====

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const sat = v => clamp(v, 0, 1);
// 色相などの循環量の差（-0.5〜0.5）
export const circDiff = (a, b) => { let d = b - a; if (d > 0.5) d -= 1; if (d < -0.5) d += 1; return d; };

export const qMul = (a, b) => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
export const qAxis = (ax, a) => { const s = Math.sin(a / 2); return { x: ax.x * s, y: ax.y * s, z: ax.z * s, w: Math.cos(a / 2) }; };
export function qRot(q, v) {
  const { x, y, z, w } = q;
  const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
  return { x: v.x + w * tx + (y * tz - z * ty), y: v.y + w * ty + (z * tx - x * tz), z: v.z + w * tz + (x * ty - y * tx) };
}
export const qConj = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
