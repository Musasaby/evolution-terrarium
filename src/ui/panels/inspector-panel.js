// ===== 個体パネル：選んだ個体の遺伝子・エネルギー・系譜 =====
// 選択状態はストア（selected / follow）から読み、ボタン操作もストアへ書くだけ。
import { qRot } from '../../sim/index.js';
import { speciesCss, CORPSE_COLOR } from '../../render/palette.js';
import { $, fillDl, prepCanvas } from '../dom.js';

const MATE_CACHE_SEC = 2;  // 交配相手の数え直し間隔（シム秒）

export class InspectorPanel {
  constructor(store, colors) {
    this.id = 'p-ind';
    this.store = store;
    this.colors = colors;
    this.mateCache = { id: -1, t: -1, text: '' };
    $('btn-follow').addEventListener('click', () => store.set({ follow: !store.get().follow }));
    $('btn-clear').addEventListener('click', () => store.set({ selected: null, follow: false }));
    $('btn-random').addEventListener('click', () => {
      const sim = store.get().sim; if (!sim) return;
      const live = sim.creatures.filter(c => c.alive && !c.dead);
      if (live.length) store.set({ selected: live[Math.floor(Math.random() * live.length)], follow: true });
    });
  }

  render(sim, { selected: c, follow }) {
    $('ind-empty').hidden = !!c; $('ind').hidden = !c;
    if (!c) return;
    const sp = c.species;
    $('i-dot').style.background = c.dead ? CORPSE_COLOR : speciesCss(sp);
    $('i-species').textContent = sp.name + (c.dead ? '（死骸）' : '');
    $('i-sub').textContent = `個体 #${c.id} · 第${c.gen}世代 · ${c.nParts}パーツ`;
    const e = c.dead ? c.corpseE : c.energy;
    $('i-ebar').style.width = Math.max(0, Math.min(100, e / c.maxE * 100)) + '%';
    $('i-etext').textContent = `${e.toFixed(0)} / ${c.maxE.toFixed(0)}` + (c.dead ? '（死骸の残り）' : '');
    $('c-base').textContent = c.cost.base.toFixed(2); $('c-move').textContent = c.cost.move.toFixed(2);
    $('c-clim2').textContent = c.cost.climate.toFixed(2); $('c-wet').textContent = c.cost.water.toFixed(2);
    const rows = [
      ['年齢', c.age.toFixed(0) + ' 秒'], ['体積', c.vol.toFixed(2) + ' m³'], ['関節', c.joints.length || c.nParts - 1],
      ['子の数', c.children], ['捕食した数', c.kills], ['獲得エネルギー', c.eaten.toFixed(0)],
      ['振動数', c.genome.freq.toFixed(2) + ' Hz'], ['親', c.parents ? '#' + c.parents.join(', #') : '祖先／移入'],
      ['同時に生まれた数', c.litter ? c.litter + ' 体' : '—'],
      ['選り好みの強さ', (c.genome.pick * 100).toFixed(0) + ' %'],
      ['交配できる相手', this.mateInfo(sim, c)],
      ['誕生時の変異', c.mutations.length ? c.mutations.join('、') : 'なし'],
    ];
    if (c.dead) rows.unshift(['死因', c.cause]);
    fillDl($('i-dl'), rows);
    $('btn-follow').setAttribute('aria-pressed', String(follow));
    $('btn-follow').textContent = follow ? '追跡中' : '追跡する';
    this.drawBody(c);
  }

  // 子を残せる相手（雑種の生存力が半分以上）が今いくついるか
  mateInfo(sim, c) {
    if (c.dead) return '—';
    const mc = this.mateCache;
    if (mc.id === c.id && sim.t - mc.t < MATE_CACHE_SEC) return mc.text;
    let same = 0, other = 0;
    for (const o of sim.creatures) {
      if (o === c || !o.alive || o.dead) continue;
      if (sim.interfertile(c.genome, o.genome)) o.species === c.species ? same++ : other++;
    }
    const text = `同種 ${same} 体` + (other ? `・他種 ${other} 体` : '');
    this.mateCache = { id: c.id, t: sim.t, text };
    return text;
  }

  // 体の形（真上から見た図）
  drawBody(c) {
    const { ctx, w, h } = prepCanvas($('body2d'));
    if (!c.bodies.length) return;
    const pts = c.bodies.map((b, i) => {
      const t = b.translation(), ax = qRot(b.rotation(), { x: 0, y: c.genome.parts[i].len / 2, z: 0 });
      return { x: t.x, z: t.z, ax: ax.x, az: ax.z, r: c.genome.parts[i].r };
    });
    let cx = 0, cz = 0; pts.forEach(p => { cx += p.x; cz += p.z; }); cx /= pts.length; cz /= pts.length;
    let ext = 0.5; pts.forEach(p => { ext = Math.max(ext, Math.abs(p.x - cx) + Math.abs(p.ax) + p.r, Math.abs(p.z - cz) + Math.abs(p.az) + p.r); });
    const sc = Math.min(w, h) / 2.3 / ext;
    ctx.lineCap = 'round';
    const col = c.dead ? CORPSE_COLOR : speciesCss(c.species);
    pts.forEach((p, i) => {
      ctx.strokeStyle = col; ctx.globalAlpha = i === 0 ? 1 : 0.85; ctx.lineWidth = Math.max(2, p.r * 2 * sc);
      ctx.beginPath(); ctx.moveTo(w / 2 + (p.x - cx - p.ax) * sc, h / 2 + (p.z - cz - p.az) * sc); ctx.lineTo(w / 2 + (p.x - cx + p.ax) * sc, h / 2 + (p.z - cz + p.az) * sc); ctx.stroke();
    });
    ctx.globalAlpha = 1; ctx.fillStyle = this.colors.muted; ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.fillText(`1m = ${sc.toFixed(0)}px`, 8, h - 8);
  }
}
