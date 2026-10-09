// ===== 小さな状態ストア =====
// 画面の各部品は互いを直接呼ばず、共有したい状態（選択中の個体・速度など）をここに置いて購読する。

export function createStore(initial) {
  let state = { ...initial };
  const subs = new Set();
  return {
    get: () => state,
    // 部分更新。値が変わったときだけ購読者に通知する
    set(patch) {
      const next = { ...state, ...patch };
      if (Object.keys(patch).every(k => Object.is(state[k], next[k]))) return;
      const prev = state; state = next;
      for (const fn of subs) fn(state, prev);
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

// アプリ全体で共有する状態
//   sim       … 現在のシミュレーション（新しい世界を作ると差し替わる）
//   speed     … 0=停止, 1/3/8=倍速, 999=最大
//   selected  … 観察中の個体
//   follow    … カメラで追跡するか
//   tab       … 表示中のパネル id
//   perfOpen  … パフォーマンス表示を出すか
export const appStore = createStore({
  sim: null, speed: 1, selected: null, follow: false, tab: 'p-stats', perfOpen: true,
});
