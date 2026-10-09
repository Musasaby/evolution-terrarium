// ===== 右側パネルの切り替えと定期更新 =====
// パネルは { id, render(sim, state), reset?(), attach?(sim) } を持つだけの部品。
// 新しいパネルを足すときは index.html にタブと <section> を書き、ここへ register する。

export class PanelHost {
  constructor(store) {
    this.store = store;
    this.panels = new Map();
    this.tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
    for (const b of this.tabs) b.addEventListener('click', () => store.set({ tab: b.dataset.p }));
    store.subscribe((s, prev) => {
      if (s.tab !== prev.tab) this.showTab(s.tab);
      // 選択や追跡が変わったら、表示中のパネルをすぐ描き直す
      if (s.tab !== prev.tab || s.selected !== prev.selected || s.follow !== prev.follow) this.renderActive();
    });
    this.showTab(store.get().tab);
  }

  register(panel) { this.panels.set(panel.id, panel); return this; }

  // 新しい世界になったとき
  attach(sim) {
    for (const p of this.panels.values()) { p.reset?.(); p.attach?.(sim); }
  }

  showTab(id) {
    for (const b of this.tabs) b.setAttribute('aria-selected', String(b.dataset.p === id));
    for (const p of document.querySelectorAll('.pane')) p.hidden = p.id !== id;
  }

  renderActive() {
    const s = this.store.get();
    if (!s.sim) return;
    this.panels.get(s.tab)?.render(s.sim, s);
  }
}
