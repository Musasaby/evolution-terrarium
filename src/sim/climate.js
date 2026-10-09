// ===== 気候：季節・気温のゆらぎ・氷河期・天候・湖面 =====
// 乱数と記録用の関数だけを受け取る独立した部品。地形や生物には依存しない。
import { CFG } from './config.js';
import { clamp } from './math.js';

export class Climate {
  // rng: 乱数 / log(msg, kind): 出来事の記録
  constructor(rng, log = () => {}) {
    this.rng = rng;
    this.log = log;
    this.drift = 0; this.ice = 0; this.iceTarget = 0; this.iceUntil = -1;
    this.weather = 'clear'; this.weatherUntil = 30; this.humidity = 0.55;
    this.baseWater = 1.2; this.water = 1.2; this.temp = 15; this.meanTemp = 15; this.rainVis = 0;
  }

  static seasonName(t) {
    const ph = ((t / CFG.YEAR) % 1 + 1) % 1;
    return ['春', '夏', '秋', '冬'][Math.floor(((ph + 0.125) % 1) * 4)];
  }
  get iceAge() { return this.iceTarget < 0 || this.ice < -3; }

  update(t, dt) {
    const rng = this.rng;
    const season = Math.sin((t / CFG.YEAR) * Math.PI * 2);
    this.drift += rng.gauss() * 0.04 * Math.sqrt(dt) - this.drift * 0.0005 * dt;
    this.drift = clamp(this.drift, -5, 5);
    // 氷河期
    if (this.iceTarget === 0 && t > CFG.YEAR * 2 && rng() < dt / (CFG.YEAR * 7)) this.startIceAge(t);
    if (this.iceTarget < 0 && t > this.iceUntil) { this.iceTarget = 0; this.log('氷河期が終わり、温暖化が始まった', 'env'); }
    this.ice += (this.iceTarget - this.ice) * Math.min(1, dt / 60);
    this.temp = 15 + 11 * season + this.drift + this.ice;
    this.meanTemp += (this.temp - this.meanTemp) * Math.min(1, dt / (CFG.YEAR * 0.6));
    // 天候
    if (t > this.weatherUntil) {
      const r = rng();
      const wetBias = 0.1 * Math.sin((t / CFG.YEAR) * Math.PI * 2 + 1);
      const prev = this.weather;
      this.weather = r < 0.33 + wetBias ? 'rain' : r < 0.78 ? 'clear' : 'drought';
      this.weatherUntil = t + rng.range(20, 70) * (this.weather === 'drought' ? 1.8 : 1);
      if (this.weather !== prev) {
        if (this.weather === 'drought') this.log('干ばつが始まった', 'env');
        if (this.weather === 'rain') this.log(this.temp < 0 ? '雪が降り始めた' : '雨が降り始めた', 'env');
      }
    }
    const tgtH = this.weather === 'rain' ? 1 : this.weather === 'drought' ? 0 : 0.5;
    this.humidity += (tgtH - this.humidity) * Math.min(1, dt / 90);
    const dw = this.weather === 'rain' ? 0.012 : this.weather === 'drought' ? -0.014 : -0.002;
    const evap = this.temp > 25 ? -0.004 : 0;
    this.water = clamp(this.water + (dw + evap) * dt, this.baseWater - 2.8, this.baseWater + 2.8 + Math.min(0, this.ice * 0.1));
    this.rainVis += ((this.weather === 'rain' ? 1 : 0) - this.rainVis) * Math.min(1, dt / 3);
  }

  startIceAge(t) {
    this.iceTarget = -this.rng.range(11, 16);
    this.iceUntil = t + CFG.YEAR * this.rng.range(1.5, 3);
    this.log('氷河期が始まった', 'env');
  }

  // 'rain' | 'drought' | 'clear' | 'ice'
  force(w, t) {
    if (w === 'ice') { if (this.iceTarget === 0) this.startIceAge(t); return; }
    this.weather = w; this.weatherUntil = t + 60;
    this.log(w === 'rain' ? '雨が降り始めた' : w === 'drought' ? '干ばつが始まった' : '天気が晴れた', 'env');
  }

  // 標高 h の地点の気温（湖面基準から 1m ごとに 0.55℃ 下がる）
  tempAtHeight(h) { return this.temp - 0.55 * Math.max(0, h - this.baseWater); }
  meanTempAtHeight(h) { return this.meanTemp - 0.55 * Math.max(0, h - this.baseWater); }
}
