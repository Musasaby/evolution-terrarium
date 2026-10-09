// ===== ヘッダーの計器（年・季節・気温・天候・個体数など） =====
import { $ } from './dom.js';

const WEATHER = { clear: '晴れ', rain: '雨', drought: '干ばつ' };

export function updateHeader(sim) {
  const cl = sim.climate;
  $('r-year').textContent = sim.year.toFixed(1);
  $('r-season').textContent = sim.seasonName();
  $('r-temp').textContent = cl.temp.toFixed(1);
  const dw = cl.water - cl.baseWater;
  $('r-water').textContent = (dw >= 0 ? '+' : '') + dw.toFixed(2);
  let label = WEATHER[cl.weather], cls = cl.weather;
  if (cl.weather === 'rain' && cl.temp < 1) label = '雪';
  if (cl.iceAge) { label += '・氷河期'; cls = 'ice'; }
  const w = $('r-weather');
  w.textContent = label; w.className = 'chip ' + cls;
  let pop = 0, gen = 0;
  const sp = new Set();
  for (const c of sim.creatures) if (c.alive && !c.dead) { pop++; sp.add(c.species.id); if (c.gen > gen) gen = c.gen; }
  $('r-pop').textContent = pop;
  $('r-sp').textContent = sp.size;
  $('r-gen').textContent = gen;
}
