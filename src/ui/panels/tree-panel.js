// ===== 系統樹パネル =====
import { CFG } from '../../sim/index.js';
import { speciesCss } from '../../render/palette.js';
import { $, prepCanvas } from '../dom.js';

const ROW_H = 16, PAD_L = 8, PAD_R = 92;

// 表示する種（現存種と、ある程度栄えた絶滅種）と、その祖先を深さ優先の並びで返す
function treeOrder(sim) {
  const all = [...sim.species.values()];
  const show = all.filter(s => s.extinct === null || s.peak >= 2 || s.total >= 3);
  const keep = new Set(show.map(s => s.id));
  for (const s of show) { let p = s.parent; while (p && !keep.has(p)) { keep.add(p); p = sim.species.get(p)?.parent; } }
  const list = all.filter(s => keep.has(s.id));
  const kids = new Map(); const roots = [];
  for (const s of list) { if (s.parent && keep.has(s.parent)) (kids.get(s.parent) || kids.set(s.parent, []).get(s.parent)).push(s); else roots.push(s); }
  const order = [];
  const dfs = (s) => { order.push(s); (kids.get(s.id) || []).sort((a, b) => a.born - b.born).forEach(dfs); };
  roots.sort((a, b) => a.born - b.born).forEach(dfs);
  return order;
}

export class TreePanel {
  constructor(colors) { this.id = 'p-tree'; this.colors = colors; }

  render(sim) {
    const COL = this.colors, cv = $('tree');
    const order = treeOrder(sim);
    const H = Math.max(140, order.length * ROW_H + 28);
    cv.style.height = H + 'px';
    const { ctx, w } = prepCanvas(cv);
    const tEnd = Math.max(sim.t, 1);
    const X = (t) => PAD_L + t / tEnd * (w - PAD_L - PAD_R);
    const rowOf = new Map(); order.forEach((s, i) => rowOf.set(s.id, 14 + i * ROW_H));
    ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = COL.muted; ctx.strokeStyle = COL.line;
    const yrs = tEnd / CFG.YEAR, step = yrs > 20 ? 5 : yrs > 6 ? 2 : 1;
    for (let y = 0; y <= yrs; y += step) { const x = X(y * CFG.YEAR); ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, H - 14); ctx.stroke(); ctx.fillText(y + '年', x + 2, H - 4); }
    for (const s of order) {
      const y = rowOf.get(s.id), x0 = X(s.born), x1 = X(s.extinct ?? sim.t);
      const alive = s.extinct === null;
      const col = speciesCss(s, alive ? 60 : 42);
      if (s.parent && rowOf.has(s.parent)) {
        ctx.strokeStyle = col; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, rowOf.get(s.parent)); ctx.lineTo(x0, y); ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = col; ctx.lineWidth = alive ? 4 : 2;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(Math.max(x1, x0 + 2), y); ctx.stroke();
      if (alive) {
        ctx.fillStyle = COL.fg; ctx.font = '11px "Zen Kaku Gothic New", sans-serif';
        ctx.fillText(`${s.name} ${s.count}`, Math.max(x1, x0 + 2) + 5, y + 4);
      } else { ctx.fillStyle = COL.danger; ctx.fillRect(x1 - 1, y - 3, 2, 6); }
    }
  }
}
