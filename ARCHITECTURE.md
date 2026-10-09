# 構成メモ

ビルド不要の静的サイトです（ES モジュールをそのまま読み込みます）。`index.html` をローカルサーバーで開けば動きます。

```
npm run serve        # python3 -m http.server 8000 → http://localhost:8000
```

## ディレクトリと依存の向き

```
src/
  app/      起動と配線・状態ストア・毎フレームのループ
  sim/      シミュレーション本体（描画・DOM に依存しない。Node でも動く）
  render/   three.js による 3D 描画（sim を読むだけ）
  ui/       ヘッダー・右パネル・操作ボタン（ストアを読み書きする）
  perf/     パフォーマンス計測と表示（sim も three.js も知らない）
  styles.css
tools/      ブラウザ不要の動作確認
sim.js      互換用の入口（src/sim/index.js を再公開）
```

依存は一方向です。下の層は上の層を知りません。

```
app/main.js ──▶ render/ ──┐
     │      ──▶ ui/     ──┼──▶ sim/index.js（公開窓口）
     │      ──▶ perf/     │
     └──▶ app/store.js ◀──┘ ui/ はストア経由でやりとり
```

- 外から sim を使うときは **`src/sim/index.js` からだけ** import します。sim 内部のファイル構成を変えても外側は影響を受けません。
- 部品どうしは直接呼び合わず、`app/store.js` の状態（`sim` `speed` `selected` `follow` `tab` `perfOpen`）を読み書き・購読します。たとえば 3D 画面で生物をクリックすると `store.set({ selected, tab: 'p-ind' })` するだけで、パネルの切り替えや再描画は購読側が行います。

## sim/ の中身

| ファイル | 役割 | 依存するもの |
|---|---|---|
| `config.js` | 設定値 `CFG`・処理間隔 `SCHEDULE`・神経回路の寸法 | なし |
| `random.js` `math.js` | シード付き乱数・ノイズ・クォータニオン | なし |
| `genetics.js` | ゲノム生成・組換え・突然変異・系統距離・配偶者認識 | config, math |
| `brain.js` | 神経回路の計算（`think`） | config, math |
| `body.js` | 剛体と関節の構築・関節モーター・進行方向 | RAPIER（引数で受け取る） |
| `climate.js` | `Climate`：季節・天候・氷河期・湖面 | 乱数と記録関数だけ |
| `terrain.js` | `Terrain`：高さ場・隆起と侵食・水域からの距離 | 乱数とノイズだけ |
| `environment.js` | 地形×気候の問い合わせ（気温・水・植物の適地度） | Terrain, Climate |
| `flora.js` | `Flora`：植物の発芽・成長・拡散・枯死 | 物理世界, Terrain, Climate |
| `creatures.js` | 誕生・感覚・代謝・死・移入 | sim を第1引数で受け取る |
| `interactions.js` | 接触イベント → 採食・捕食・繁殖 | 同上 |
| `speciation.js` | 生物学的種概念による種分化 | 同上 |
| `founder.js` | 祖先の事前進化（別の小さな物理世界で試走） | 同上 |
| `stats.js` | グラフ用の時系列 | 同上 |
| `profiler.js` | 処理区間の時間計測（使わないときは何もしない） | なし |
| `sim.js` | `Sim`：部品の組み立てと `step()` の手順 | すべて |

`Sim#step()` は「環境 → 生物 → 物理 → 接触 → 集計」の順に進み、各区間を `profiler.begin/end` で囲んでいます。`sim.on('log', fn)` で出来事を購読できます。

## よくある変更の入口

- **パラメータ調整**: `src/sim/config.js` の `CFG` / `SCHEDULE`。
- **植物の種類を増やす**: `sim/plant-species.js` に定義、`render/plant-view.js` の `SHAPES` に形、`render/palette.js` の `PLANT_COLORS` に色。
- **生物の感覚を増やす**: `sim/creatures.js` の `sense()` で値を作り、`sim/brain.js` の入力に割り当て、`config.js` の `NI` を増やす（ゲノムの長さが変わる）。
- **右パネルを増やす**: `index.html` にタブと `<section>` を書き、`{ id, render(sim, state) }` を持つクラスを `ui/panels/` に作って `app/main.js` で `panels.register()`。
- **毎フレームの処理を増やす**: `app/main.js` の `GameLoop` に `.add('名前', fn)`。名前ごとの所要時間がパフォーマンス表示の「1フレームの内訳」に自動で出ます。
- **パフォーマンス表示に項目を足す**: `perf.addSource('名前', () => 値)` で情報源を登録し、`perf/perf-overlay.js` で描く。

## パフォーマンス表示

3D 画面右上（「性能」ボタン / `P` キーで表示切り替え、「詳細」で全項目）。0.5 秒ごとに更新します。

- **fps・フレーム間隔のグラフ**: 緑 ≒ 50fps 以上、橙 ≒ 30〜50fps、赤 = 30fps 未満。点線は 60fps / 30fps。
- **実効速度**: 実時間 1 秒あたりに進んだシム秒。×8 を指定しても計算が追いつかなければ ×8 未満になり、遅れが 0.5 シム秒を超えた分は「追いつけず省略」に出ます。
- **シミュレーションの内訳**: `step()` の区間ごとの割合。現状は物理エンジン（Rapier）が約 8 割を占めます。表示を閉じている間は区間計測を止めます。
- **1フレームの内訳**: シム / 描画更新 / UI / レンダリング（WebGL へ描画命令を出す時間）。
- **描画・世界**: ドローコール数・三角形数、生物・植物・剛体・当たり判定・関節の数。JS ヒープは Chrome 系ブラウザでのみ表示されます。

## 動作確認

```
npm install
npm run check:sim             # 600 ステップ進めて状態ハッシュと区間ごとの所要時間を表示
node tools/sim-check.mjs 1500 # ステップ数（とシード）を指定
```

同じシード・同じステップ数なら状態ハッシュは常に同じです。**振る舞いを変えないつもりの変更（リファクタリング）では、前後でハッシュが一致すること**を確かめてください。パラメータや規則を変えた場合はハッシュが変わるのが正常です。
