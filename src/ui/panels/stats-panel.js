// ===== 統計パネル：個体数・繁殖・体のつくり・気候・植生 =====
import { PLANT_SPECIES } from '../../sim/index.js';
import { PLANT_COLORS } from '../../render/palette.js';
import { $, fillDl } from '../dom.js';
import { lineChart } from '../charts.js';

export class StatsPanel {
  constructor(colors) { this.id = 'p-stats'; this.colors = colors; }

  reset() { $('plantbar').innerHTML = ''; $('plantlegend').innerHTML = ''; }

  render(sim) {
    const COL = this.colors, st = sim.stats;
    lineChart($('c-pop'), st, [{ get: p => p.pop, color: COL.accent, min: 0 }, { get: p => p.species, color: COL.water, min: 0 }], COL);
    lineChart($('c-div'), st, [{ get: p => p.effSpecies ?? 0, color: COL.accent, min: 0, span: 2 }, { get: p => (p.dominance ?? 0) * 100, color: COL.danger, min: 0, max: 100 }], COL);
    this.renderDiversity(sim, st[st.length - 1]);
    lineChart($('c-body'), st, [{ get: p => p.parts, color: COL.accent, min: 1 }, { get: p => p.vol * 10, color: COL.leaf, min: 0 }], COL);
    lineChart($('c-clim'), st, [{ get: p => p.temp, color: COL.danger, span: 10 }, { get: p => p.water, color: COL.water, span: 2 }], COL);
    const C = sim.counters, L = sim.litters;
    const avgL = L.length ? L.reduce((a, b) => a + b, 0) / L.length : 0;
    let splits = 0; for (const s of sim.species.values()) if (s.parent !== null) splits++;
    fillDl($('repro'), [
      ['交配の回数', C.matings], ['生まれた子', C.births],
      ['1回の平均出産数', L.length ? avgL.toFixed(2) + ' 体' : '—'],
      ['育たなかった雑種', C.stillborn], ['相手を見分けて断った', C.rejected],
      ['種分化', splits + ' 回'],
    ]);
    this.renderVegetation(st[st.length - 1]);
  }

  renderDiversity(sim, last) {
    // 最大の種と流行中の疫病は今の個体から数える（統計は数秒おきなので）
    const cnt = new Map(); let n = 0;
    for (const c of sim.creatures) if (c.alive && !c.dead) { n++; cnt.set(c.species, (cnt.get(c.species) || 0) + 1); }
    let topSp = null, topN = 0;
    for (const [sp, k] of cnt) if (k > topN) { topN = k; topSp = sp; }
    const plague = [...cnt.keys()].filter(sp => sp.plagueUntil > sim.t).map(sp => sp.name);
    fillDl($('diversity'), [
      ['生存している種', cnt.size + ' 種'],
      ['有効種数', last ? last.effSpecies.toFixed(1) + ' 種' : '—'],
      ['シャノン多様度 H', last ? last.shannon.toFixed(2) : '—'],
      ['最も多い種', topSp ? `${topSp.name}（${Math.round(topN / n * 100)}%）` : '—'],
      ['疫病が流行中', plague.length ? plague.join('、') : 'なし'],
    ]);
  }

  renderVegetation(last) {
    if (!last) return;
    const tot = last.plantCounts.reduce((a, b) => a + b, 0) || 1;
    const bar = $('plantbar'), leg = $('plantlegend');
    if (!bar.children.length) {
      PLANT_SPECIES.forEach(sp => {
        const d = document.createElement('div'); d.style.background = PLANT_COLORS[sp.name]; bar.appendChild(d);
        const l = document.createElement('span'); l.innerHTML = `<i style="background:${PLANT_COLORS[sp.name]}"></i>${sp.name} <b>0</b>`; leg.appendChild(l);
      });
    }
    last.plantCounts.forEach((n, i) => { bar.children[i].style.width = (n / tot * 100) + '%'; leg.children[i].querySelector('b').textContent = n; });
  }
}
