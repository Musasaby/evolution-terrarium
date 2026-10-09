// ===== 乱数とノイズ（シード付きで再現可能） =====

export function makeRng(seed) {
  let s = seed >>> 0;
  const r = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.gauss = () => { let u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  r.pick = (a) => a[Math.floor(r() * a.length)];
  return r;
}

// 2次元パーリンノイズ（オクターブ合成）
export function makeNoise(rng) {
  const P = new Uint8Array(512), G = [];
  for (let i = 0; i < 256; i++) { P[i] = i; const a = rng() * Math.PI * 2; G.push([Math.cos(a), Math.sin(a)]); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const f = t => t * t * t * (t * (t * 6 - 15) + 10);
  const n2 = (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
    const g = (i, j, dx, dy) => { const v = G[P[P[X + i] + Y + j] & 255]; return v[0] * dx + v[1] * dy; };
    const u = f(x), v = f(y);
    const a = g(0, 0, x, y) + u * (g(1, 0, x - 1, y) - g(0, 0, x, y));
    const b = g(0, 1, x, y - 1) + u * (g(1, 1, x - 1, y - 1) - g(0, 1, x, y - 1));
    return a + v * (b - a);
  };
  return (x, y, oct = 4) => { let s = 0, a = 1, fr = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * n2(x * fr, y * fr); n += a; a *= 0.5; fr *= 2; } return s / n; };
}
