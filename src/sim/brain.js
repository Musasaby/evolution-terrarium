// ===== 神経回路：感覚と体の状態から、関節・記憶・旋回・推進の出力を計算する =====
// 生物の状態 c だけを読み書きする純粋な処理。物理エンジンにも世界にも依存しない。
import { MAXJ, NMEM, NI, NH, NO, NW1, NW2 } from './config.js';
import { clamp } from './math.js';

// 入力の並び（I[0]〜I[17]）
//  0 定数 / 1,2 内部リズム sin・cos / 3 エネルギー
//  4〜6 最寄りの植物（横・前・近さ） / 7〜9 最寄りの生物（横・前・近さ）
//  10 相手が同類か / 11 相手の大きさ / 12 前方の水 / 13 前方の勾配 / 14 気温 / 15 体の上向き
//  16 食べている / 17 傷ついている
//  18〜 関節角（MAXJ 個）, その後に記憶（NMEM 個）
export function think(c, dt) {
  c.phase += c.genome.freq * dt * Math.PI * 2;
  const s = c.sense, I = c.inp;
  I[0] = 1; I[1] = Math.sin(c.phase); I[2] = Math.cos(c.phase); I[3] = c.energy / c.maxE * 2 - 1;
  I[4] = s.ps; I[5] = s.pc; I[6] = s.pp; I[7] = s.cs; I[8] = s.cc; I[9] = s.cp; I[10] = s.kin; I[11] = s.size;
  I[12] = s.waterAhead; I[13] = s.slope; I[14] = s.temp; I[15] = s.up; I[16] = c.ate > 0 ? 1 : 0; I[17] = c.hurt > 0 ? 1 : 0;
  const nj = c.joints.length, parts = c.genome.parts;
  for (let j = 0; j < MAXJ; j++) I[18 + j] = j < nj ? clamp((c.angles[j] - parts[j + 1].a0) / (parts[j + 1].range + 1e-3), -1.5, 1.5) : 0;
  for (let m = 0; m < NMEM; m++) I[18 + MAXJ + m] = c.mem[m];
  const B = c.genome.brain, Hh = c.hidden, O = c.out;
  for (let h = 0; h < NH; h++) {
    let a = B[NW1 + h];
    for (let i = 0; i < NI; i++) a += I[i] * B[i * NH + h];
    Hh[h] = Math.tanh(a);
  }
  const o2 = NW1 + NH, ob = o2 + NW2;
  for (let o = 0; o < NO; o++) {
    let a = B[ob + o];
    for (let h = 0; h < NH; h++) a += Hh[h] * B[o2 + h * NO + o];
    O[o] = Math.tanh(a);
  }
  for (let m = 0; m < NMEM; m++) c.mem[m] = O[MAXJ + m];
}
