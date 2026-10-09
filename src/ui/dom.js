// ===== DOM の小道具 =====

export const $ = (id) => document.getElementById(id);

// CSS 変数から色を読む
export function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const get = (n) => css.getPropertyValue(n).trim();
  return { accent: get('--accent'), water: get('--water'), leaf: get('--leaf'), danger: get('--danger'), muted: get('--muted'), line: get('--line'), fg: get('--fg'), bg: get('--bg') };
}

// <dl> を [見出し, 値] の行で埋める
export function fillDl(dl, rows) {
  dl.innerHTML = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
}

// 高解像度対応の 2D キャンバスを準備する（h を渡すと CSS の高さも設定）
export function prepCanvas(cv, h) {
  const dpr = Math.min(2, devicePixelRatio), w = cv.clientWidth;
  if (h) cv.style.height = h + 'px';
  const hh = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, hh);
  return { ctx, w, h: hh };
}
