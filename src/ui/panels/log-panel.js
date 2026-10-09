// ===== 記録パネル：出来事の一覧 =====
// sim の 'log' イベントを購読し、新しい出来事があったときだけ描き直す。
import { CFG } from '../../sim/index.js';
import { $ } from '../dom.js';

export class LogPanel {
  constructor() { this.id = 'p-log'; this.dirty = true; this.unsub = null; }

  attach(sim) {
    this.unsub?.();
    this.unsub = sim.on('log', () => { this.dirty = true; });
    this.dirty = true;
  }

  render(sim) {
    if (!this.dirty) return;
    this.dirty = false;
    const ul = $('log'); ul.innerHTML = '';
    for (const e of sim.events) {
      const li = document.createElement('li'); li.className = e.kind;
      const t = document.createElement('time'); t.textContent = (e.t / CFG.YEAR).toFixed(2) + '年';
      const s = document.createElement('span'); s.textContent = e.msg;
      li.append(t, s); ul.appendChild(li);
    }
    if (!sim.events.length) ul.innerHTML = '<li><span class="note">まだ出来事はありません。</span></li>';
  }
}
