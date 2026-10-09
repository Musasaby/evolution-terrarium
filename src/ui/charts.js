// ===== 時系列の折れ線グラフ（左右2軸） =====
import { CFG } from '../sim/index.js';
import { prepCanvas } from './dom.js';

export const fmt = (v) => Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);

// stats: [{ t, ... }] / series: [{ get(p), color, min?, max?, span? }]（1本目は左軸、2本目は右軸）
export function lineChart(cv, stats, series, colors) {
  const { ctx, w, h } = prepCanvas(cv);
  const st = stats;
  if (st.length < 2) { ctx.fillStyle = colors.muted; ctx.font = '11px sans-serif'; ctx.fillText('データを集計中…', 8, 20); return; }
  const L = 30, R = 30, T = 8, B = 16;
  const t0 = st[0].t, t1 = st[st.length - 1].t;
  const X = (t) => L + (t - t0) / Math.max(1e-6, t1 - t0) * (w - L - R);
  ctx.font = '10px "IBM Plex Mono", monospace';
  // 時間軸（年）
  ctx.strokeStyle = colors.line; ctx.fillStyle = colors.muted; ctx.lineWidth = 1;
  const y0 = t0 / CFG.YEAR, y1 = t1 / CFG.YEAR;
  const step = y1 - y0 > 20 ? 5 : y1 - y0 > 6 ? 2 : y1 - y0 > 2 ? 1 : 0.5;
  ctx.textAlign = 'center';
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
    const x = X(y * CFG.YEAR); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, h - B); ctx.stroke();
    ctx.fillText(y + '年', x, h - 4);
  }
  series.forEach((s, si) => {
    let mn = s.min ?? Infinity, mx = s.max ?? -Infinity;
    if (s.min === undefined || s.max === undefined) for (const p of st) { const v = s.get(p); if (s.min === undefined) mn = Math.min(mn, v); if (s.max === undefined) mx = Math.max(mx, v); }
    const span = s.span ?? 1;
    if (mx - mn < span) { const m = (mx + mn) / 2; if (s.min === undefined) mn = m - span / 2; if (s.max === undefined) mx = mn + span; else mn = mx - span; }
    if (s.min !== undefined && mn > s.min) mn = s.min;
    const Y = (v) => h - B - (v - mn) / (mx - mn) * (h - B - T);
    // 目盛（左右）
    ctx.fillStyle = s.color; ctx.textAlign = si === 0 ? 'right' : 'left';
    ctx.fillText(fmt(mx), si === 0 ? L - 4 : w - R + 4, T + 8);
    ctx.fillText(fmt(mn), si === 0 ? L - 4 : w - R + 4, h - B);
    if (si === 0) {
      ctx.beginPath(); ctx.moveTo(X(st[0].t), h - B);
      for (const p of st) ctx.lineTo(X(p.t), Y(s.get(p)));
      ctx.lineTo(X(t1), h - B); ctx.closePath();
      ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = s.color; ctx.lineWidth = 1.5; ctx.beginPath();
    st.forEach((p, i) => { const x = X(p.t), y = Y(s.get(p)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    const lp = st[st.length - 1]; ctx.beginPath(); ctx.arc(X(lp.t), Y(s.get(lp)), 2.5, 0, 6.3); ctx.fill();
  });
}
