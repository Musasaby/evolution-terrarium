// ===== パフォーマンス表示（3D 画面の右上に重ねる） =====
// PerfMonitor のスナップショットを読んで描くだけ。何を計測するかは main.js の配線で決まる。
//
// スナップショットに期待する中身
//   tasks:    { シム, 描画更新, レンダリング, UI }            … 1フレームあたり平均 ms
//   counters: { steps, simSeconds, dropped }                  … 期間中の合計
//   sources:  speed            … 指定した速度（0 / 倍率 / SPEED_MAX）
//             simSections      … { 区間名: { ms, n } }（Sim の SectionProfiler.take()）
//             render           … { calls, triangles, geometries, textures }
//             world            … { creatures, corpses, plants, bodies, colliders, joints }
//             memory           … { used, limit }（MB。取得できないブラウザでは null）
import { healthOf } from './perf-monitor.js';

const TASK_ORDER = ['シム', '描画更新', 'レンダリング', 'UI'];
const SECTION_COLORS = { 環境: '--leaf', 生物: '--accent', 物理: '--water', 接触: '--danger', 集計: '--muted' };

const fmtMs = (v) => v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
const fmtInt = (v) => Math.round(v).toLocaleString('ja-JP');

export class PerfOverlay {
  // onCompactChange(compact): 簡易／詳細の切り替えを外へ知らせる（保存などに使う）
  constructor(root, monitor, { speedMax = 999, compact = true, onCompactChange = () => {} } = {}) {
    this.root = root;
    this.speedMax = speedMax;
    this.onCompactChange = onCompactChange;
    this.build();
    this.setCompact(compact);
    this.unsub = monitor.subscribe((s) => { if (!this.root.hidden) this.render(s); });
  }

  setVisible(v) { this.root.hidden = !v; }
  setCompact(v) {
    this.compact = v;
    this.root.classList.toggle('compact', v);
    this.el.toggle.setAttribute('aria-expanded', String(!v));
    this.el.toggle.textContent = v ? '詳細' : '簡易';
  }

  build() {
    const r = this.root;
    r.innerHTML = `
      <div class="perf-head"><strong>パフォーマンス</strong><span class="state ok" data-k="state">計測中</span><button class="mini" data-k="toggle">詳細</button></div>
      <div class="big"><b data-k="fps">--</b><span>fps · <span data-k="frame">--</span></span></div>
      <canvas data-k="spark" aria-label="フレーム間隔の推移"></canvas>
      <div class="summary" data-k="summary"></div>
      <div class="detail">
        <h3>シミュレーション</h3>
        <dl data-k="sim"></dl>
        <div class="phases" data-k="phases"></div>
        <div class="phase-legend" data-k="phaseLegend"></div>
        <h3>1フレームの内訳</h3>
        <dl data-k="tasks"></dl>
        <h3>描画</h3>
        <dl data-k="render"></dl>
        <h3>世界</h3>
        <dl data-k="world"></dl>
      </div>
      <div class="foot">0.5 秒ごとに更新 · 線は 60fps / 30fps の目安</div>`;
    this.el = {};
    r.querySelectorAll('[data-k]').forEach(e => { this.el[e.dataset.k] = e; });
    this.el.toggle.addEventListener('click', () => { this.setCompact(!this.compact); this.onCompactChange(this.compact); if (this.last) this.render(this.last); });
    const css = getComputedStyle(document.documentElement);
    this.colors = {};
    for (const k of ['--fg', '--muted', '--line', '--accent', '--leaf', '--water', '--danger']) this.colors[k] = css.getPropertyValue(k).trim();
  }

  render(s) {
    this.last = s;
    const src = s.sources, speed = src.speed ?? 0;
    const effective = (s.counters.simSeconds || 0) / s.seconds;  // 実時間1秒あたりに進んだシム秒
    const target = speed > 0 && speed < this.speedMax ? speed : null;
    const realtimeRatio = target ? effective / target : null;
    const health = speed === 0 ? { level: 'ok', label: '停止中' } : healthOf({ fps: s.fps, realtimeRatio });

    this.el.state.className = 'state ' + health.level;
    this.el.state.textContent = health.label;
    this.el.fps.textContent = s.fps.toFixed(0);
    this.el.frame.textContent = `平均 ${fmtMs(s.frameMs)} ms・最大 ${fmtMs(s.frameMaxMs)} ms`;
    this.drawSpark(s.history);

    const steps = s.counters.steps || 0;
    const simMs = s.tasks['シム'] || 0;
    const stepMs = steps ? fmtMs(simMs * s.frames / steps) + ' ms' : '—';
    const speedLabel = speed === 0 ? '停止' : target ? `×${target}` : '最大';
    // 簡易表示の1行まとめ
    this.el.summary.textContent = speed === 0 ? `停止中 · 1フレーム処理 ${fmtMs(s.workMs)} ms`
      : `${speedLabel} → 実効 ×${effective.toFixed(2)} · 1ステップ ${stepMs}`;
    if (this.compact) return;

    // シミュレーション
    this.rows(this.el.sim, [
      ['指定速度', speedLabel],
      ['実効速度', speed === 0 ? '—' : `×${effective.toFixed(2)}` + (realtimeRatio !== null ? `（${(realtimeRatio * 100).toFixed(0)}%）` : '')],
      ['ステップ／秒', fmtInt(steps / s.seconds)],
      ['1ステップ', stepMs],
      ['追いつけず省略', s.counters.dropped ? `${s.counters.dropped.toFixed(2)} シム秒` : 'なし'],
    ]);
    this.drawSections(src.simSections);

    // 1フレームの内訳
    const taskRows = TASK_ORDER.filter(k => k in s.tasks).map(k => [k, `${fmtMs(s.tasks[k])} ms`]);
    taskRows.push(['合計（最大）', `${fmtMs(s.workMs)} ms（${fmtMs(s.workMaxMs)}）`]);
    this.rows(this.el.tasks, taskRows);

    const rd = src.render;
    this.rows(this.el.render, rd ? [
      ['ドローコール', fmtInt(rd.calls)], ['三角形', fmtInt(rd.triangles)],
      ['ジオメトリ／テクスチャ', `${rd.geometries} / ${rd.textures}`],
    ] : [['描画統計', '—']]);

    const w = src.world, mem = src.memory;
    const worldRows = w ? [
      ['生物（死骸）', `${w.creatures}（${w.corpses}）`], ['植物', fmtInt(w.plants)],
      ['剛体／当たり判定', `${fmtInt(w.bodies)} / ${fmtInt(w.colliders)}`], ['関節', fmtInt(w.joints)],
    ] : [];
    worldRows.push(['JS ヒープ', mem ? `${mem.used.toFixed(0)} / ${mem.limit.toFixed(0)} MB` : '取得不可']);
    this.rows(this.el.world, worldRows);
  }

  rows(dl, rows) {
    // 行数が同じなら中身だけ書き換える（毎回 DOM を作り直さない）
    if (dl.children.length !== rows.length * 2) {
      dl.innerHTML = '';
      for (let i = 0; i < rows.length; i++) dl.append(document.createElement('dt'), document.createElement('dd'));
    }
    rows.forEach(([k, v], i) => { dl.children[i * 2].textContent = k; dl.children[i * 2 + 1].textContent = v; });
  }

  drawSections(sec) {
    const bar = this.el.phases, leg = this.el.phaseLegend;
    if (!sec) { bar.innerHTML = ''; leg.innerHTML = ''; return; }
    const names = Object.keys(SECTION_COLORS);
    if (bar.children.length !== names.length) {
      bar.innerHTML = ''; leg.innerHTML = '';
      for (const n of names) {
        const c = this.colors[SECTION_COLORS[n]];
        const d = document.createElement('div'); d.style.background = c; d.title = n; bar.appendChild(d);
        const l = document.createElement('div'); l.innerHTML = `<span><i style="background:${c}"></i>${n}</span><b>—</b>`; leg.appendChild(l);
      }
    }
    const total = names.reduce((a, n) => a + (sec[n]?.ms || 0), 0);
    names.forEach((n, i) => {
      const ms = sec[n]?.ms || 0;
      bar.children[i].style.width = total ? (ms / total * 100) + '%' : '0';
      leg.children[i].querySelector('b').textContent = total ? `${(ms / total * 100).toFixed(0)}%` : '—';
    });
  }

  drawSpark(hist) {
    const cv = this.el.spark, dpr = Math.min(2, devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const top = 50; // 縦軸の上限 ms（それ以上は頭打ち）
    const Y = (ms) => h - Math.min(ms, top) / top * (h - 2) - 1;
    ctx.strokeStyle = this.colors['--line']; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    for (const ms of [1000 / 60, 1000 / 30]) { ctx.beginPath(); ctx.moveTo(0, Y(ms)); ctx.lineTo(w, Y(ms)); ctx.stroke(); }
    ctx.setLineDash([]);
    if (hist.length < 2) return;
    const n = hist.length, bw = w / Math.max(n, 60);
    for (let i = 0; i < n; i++) {
      const ms = hist[i];
      ctx.fillStyle = ms > 1000 / 30 ? this.colors['--danger'] : ms > 1000 / 50 ? this.colors['--accent'] : this.colors['--leaf'];
      ctx.fillRect(w - (n - i) * bw, Y(ms), Math.max(1, bw - 0.5), h - Y(ms));
    }
  }

  dispose() { this.unsub(); }
}
