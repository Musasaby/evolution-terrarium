// ===== ヘッダーの操作ボタンとキーボード =====
// 押されたら「何をしてほしいか」をストアや actions へ伝えるだけで、中身は知らない。
import { $ } from './dom.js';

// actions: { forceWeather(w), newWorld() }
export function bindControls(store, actions) {
  const speedButtons = [...document.querySelectorAll('#speeds button')];
  for (const b of speedButtons) b.addEventListener('click', () => store.set({ speed: +b.dataset.s }));
  document.querySelectorAll('[data-w]').forEach(b => b.addEventListener('click', () => actions.forceWeather(b.dataset.w)));
  $('btn-reset').addEventListener('click', () => actions.newWorld());
  $('btn-perf').addEventListener('click', () => store.set({ perfOpen: !store.get().perfOpen }));

  // Space: 一時停止／再開　P: パフォーマンス表示（文字入力中は反応しない）
  let prevSpeed = 1;
  const typing = (el) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  addEventListener('keydown', (e) => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      const { speed } = store.get();
      if (speed) { prevSpeed = speed; store.set({ speed: 0 }); } else store.set({ speed: prevSpeed });
    } else if (e.code === 'KeyP') {
      store.set({ perfOpen: !store.get().perfOpen });
    }
  });

  const sync = (s) => {
    for (const b of speedButtons) b.setAttribute('aria-pressed', String(+b.dataset.s === s.speed));
    $('btn-perf').setAttribute('aria-pressed', String(s.perfOpen));
  };
  store.subscribe(sync);
  sync(store.get());
}
