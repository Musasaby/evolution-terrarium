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
  ui/       ヘッダー・右パネル・操作ボタン・タイトル画面（ストアを読み書きする）
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
| `world-settings.js` | 世界の設定 `DEFAULT_SETTINGS`・`normalizeSettings`・`worldGeometry`・`SETTING_PRESETS` | config |
| `random.js` `math.js` | シード付き乱数・ノイズ・クォータニオン | なし |
| `genetics.js` | ゲノム生成・組換え・突然変異・系統距離・ニッチ距離・配偶者認識 | config, math |
| `brain.js` | 神経回路の計算（`think`） | config, math |
| `body.js` | 剛体と関節の構築・関節モーター・進行方向 | RAPIER（引数で受け取る） |
| `climate.js` | `Climate`：季節・天候・氷河期・湖面 | 乱数と記録関数だけ |
| `terrain.js` | `Terrain`：高さ場・隆起と侵食・水域からの距離・土壌 | 乱数とノイズだけ |
| `environment.js` | 地形×気候の問い合わせ（気温・水・土壌を含む植物の適地度） | Terrain, Climate |
| `flora.js` | `Flora`：植物の発芽・成長・拡散・枯死 | 物理世界, Terrain, Climate |
| `creatures.js` | 誕生・感覚・代謝・密集と疫病・死・移入 | sim を第1引数で受け取る |
| `interactions.js` | 接触イベント → 採食・捕食・繁殖 | 同上 |
| `speciation.js` | 生物学的種概念による種分化 | 同上 |
| `founder.js` | 祖先の事前進化（別の小さな物理世界で試走） | 同上 |
| `stats.js` | グラフ用の時系列 | 同上 |
| `diversity.js` | `computeDiversity`：多様性指標（純粋関数。sim を読むだけ） | creatures |
| `profiler.js` | 処理区間の時間計測（使わないときは何もしない） | なし |
| `sim.js` | `Sim`：部品の組み立てと `step()` の手順 | すべて |

`Sim#step()` は「環境 → 生物 → 物理 → 接触 → 集計」の順に進み、各区間を `profiler.begin/end` で囲んでいます。`sim.on('log', fn)` で出来事を購読できます。

### 剛体の姿勢は写しを読む

物理ステップの直後に、各個体の体節の位置・回転・角速度を `c.pos[i]` `c.rot[i]` `c.angv[i]` に写しています（`body.js` の `readPose`）。剛体の `translation()` などは呼ぶたびに WASM からのコピーとオブジェクト生成が起きるので、sim 内でも描画でも**姿勢はこの写しを読んでください**。物理ステップの外では剛体は動かないので、写しは常に最新です（速度 `linvel()` は写していません）。

### 多様性の指標（`diversity.js`）

`computeDiversity(sim)` が、生きている個体から次をまとめて返す純粋関数です（乱数を使わず、sim を書き換えません）。

| 値 | 内容 |
|---|---|
| `living` `species` | 個体数・現存種数 |
| `shannon` `effSpecies` | 種のシャノン多様度と、その実効数 `exp(H)` |
| `dominance` | 最も多い種が全体に占める割合 |
| `effDiet` | 食性 3 分類（草・木の葉・肉）の実効数 |
| `traitSd` | 体積・体節数・`diet`・`topt` の標準偏差（`tTol` `aqua` はまだ 0） |

`stats.js` はこの結果を時系列に記録し、右パネルのグラフが読むだけです。指標を増やすときは `computeDiversity` の戻り値に足し、`stats.js` の記録と `ui/` の表示を合わせて更新します。

### 生態のニッチ形質

各個体のゲノムは、生き方の違いを表す 4 つのニッチ形質を持ちます（`genetics.js`）。

| 形質 | 意味 | 範囲（古いゲノムの既定） |
|---|---|---|
| `diet` | 食性。0=草、0.5=木の葉、1=肉 | 0〜1（0.25） |
| `topt` | 最も調子のよい気温 | −10〜40 ℃（17） |
| `tTol` | 快適な気温の幅。`topt ± tTol` の外で寒暖の費用 | 4〜18 ℃（`CFG.COMFORT`） |
| `aqua` | 水棲適応。水中の費用・減衰が下がり、陸では基礎代謝が上がる | 0〜1（0） |

- 費用は `creatures.js` の `updateCreatures` で計算します。`tTol` が広いほど、`aqua` が高いほど陸上で基礎代謝が増えます（係数は `CFG.TTOL_COST` `CFG.AQUA_*`）。
- 繁殖相手の選り好みと種分化は `genetics.js` の `nicheDistance` で、4 形質の差に重み `CFG.NICHE_*` を掛けて系統距離に足します。生態が違う個体ほど生殖隔離が進みます。
- **ニッチ形質を増やす**ときは、`genetics.js` の `randomGenome`・`cloneGenome`・`recombine`・`mutate` に生成・複製・突然変異を足し、`nicheDistance` に差と重み（`CFG.NICHE_*`）を加えます。使う側の `creatures.js`（感覚・代謝）と `diversity.js` の `traitSd`、右パネルの個体タブ（`ui/panels/inspector-panel.js`）も合わせて更新します。古いゲノムの既定値を用意すると保存済みの個体を壊しません。

### 密集と疫病

個体数が増えすぎたときの歯止めです。どちらも `creatures.js` が `CFG` の値で計算し、これでエネルギーが尽きた個体は死因が「飢餓」か「疫病」として記録されます。

- **密集**: `CROWD_R`（6 m）以内の同種が `CROWD_FREE`（6 体）を超えると、1 体ごとに基礎代謝の `CROWD_K`（6%）ずつ費用が増えます。同種どうしの縄張り争い・資源の取り合いのイメージです。密集度は最寄りの個体を探す走査で一緒に数えます。
- **疫病**: ある種が全個体の `PLAGUE_SHARE`（30%）を超えると流行しえます。判定 1 回あたり `(割合 − PLAGUE_SHARE) × PLAGUE_P` の確率で発生し、`PLAGUE_DUR`（45 シム秒）続きます。流行中は基礎代謝の `PLAGUE_K`（35%）ぶんの費用が増え、密集しているほど重くなります。収まったあとは `PLAGUE_IMMUNE`（150 シム秒）再発しません。多数派ほど不利になる負の頻度依存で、1 種の独占を抑えます。

### 土壌

`terrain.js` は世界の生成時に土壌の格子（`Uint8Array`、既定 65×65）を作り、`soilAt(x, z)` は格子 1 回の表引きで 0〜3 を返します。

| 値 | 土壌 |
|---|---|
| 0 | 岩場 |
| 1 | 砂地 |
| 2 | 肥沃 |
| 3 | 泥炭 |

- ノイズの場をスコアにして、陸地セルの分位数で 4 等分します。既定ではどの土壌も陸地の約 25% になります（世界の設定 `soil` の重みで配分が変わります）。
- `plant-species.js` の各植物種は `soil`（4 要素の係数）を持ち、`environment.js` の `suitability` が最後に土壌係数を掛けます。発芽先の選択にも効きます。
- `render/terrain-view.js` は陸地の色に土壌の色を混ぜます（`SOIL_TINT`）。土壌は静的な値で、侵食や湖面の変化では変わりません。

## 世界の設定とタイトル画面

世界の地形・土壌・気候は、起動時のタイトル画面で選べます。値の定義と変換は `src/sim/world-settings.js` にまとまっています。

- **`DEFAULT_SETTINGS`**: 設定項目と既定値。広さ `size`（80〜160 m、既定 120）、山の数 `mtnCount` と高さ `mtnHeight`、湖の数 `lakeCount` と広さ `lakeSize`、土壌の重み `soil`（4 要素）、気温のずれ `tempOffset`、季節の振れ幅 `seasonAmp`、降水 `wetness`。`null` はシード任せです。
- **`normalizeSettings(partial)`**: 欠けた項目を既定値で埋め、範囲外をクランプした凍結済みの設定を返します。`Sim` は `opts.settings` をこれに通してから使います。
- **`worldGeometry(size)`**: 広さから、格子の分割数 `grid`、置き場所の端 `edge`、個体数・植物数の上限（`maxPop` `minPop` `maxPlants` `maxSoftPlants` `maxHardPlants` `initPlants`）を導きます。**格子の大きさ（既定 120 m / 64 分割）は保ち、上限だけを面積比 `(size / 120)²` で増減**します。広い世界は重くなるので注意してください。
- **`SETTING_PRESETS`**: カテゴリ（広さ・地形・土壌・気候）ごとのテンプレート。各テンプレートは自分のカテゴリの項目だけを持ちます。

画面側は `ui/title-screen.js` がテンプレートのボタンと詳細設定（`<details>`）を作り、DOM に依存しない変換は `ui/world-form.js` が担当します（Node からも確認できます）。「はじめる」で `Sim` を作り、「新しい世界」でタイトル画面に戻ります。最後に使った設定は `localStorage` の `evolution-terrarium:world` に保存し、壊れていれば既定値で始めます。シードと設定名はヘッダーの `title` と記録パネルに出ます。

## よくある変更の入口

- **パラメータ調整**: `src/sim/config.js` の `CFG` / `SCHEDULE`。
- **植物の種類を増やす**: `sim/plant-species.js` に定義、`render/plant-view.js` の `SHAPES` に形、`render/palette.js` の `PLANT_COLORS` に色。土壌への適性は種ごとの `soil` 係数で決める。
- **生物の感覚を増やす**: `sim/creatures.js` の `sense()` で値を作り、`sim/brain.js` の入力に割り当て、`config.js` の `NI` を増やす（ゲノムの長さが変わる）。
- **ニッチ形質を増やす**: `sim/genetics.js` の 4 か所（生成・複製・組換え・突然変異）と `nicheDistance` に足し、係数を `config.js` の `CFG.NICHE_*` に置く。使う側の `creatures.js`・`diversity.js`・個体タブも更新する（詳しくは上の「生態のニッチ形質」）。
- **土壌の種類や配分を変える**: 種類を増やすなら `sim/terrain.js` の `soilAt`、`sim/plant-species.js` の `soil`、`render/terrain-view.js` の色。配分は世界の設定 `soil`（`world-settings.js` の `DEFAULT_SETTINGS` と `SETTING_PRESETS.soil`）で変わる。
- **設定項目・テンプレートを増やす**: `sim/world-settings.js` の `DEFAULT_SETTINGS` に項目と既定値を足し、`normalizeSettings` に範囲のクランプを書く。地形・気候・広さに関わるなら `Terrain` / `Climate` / `worldGeometry` で使い、`SETTING_PRESETS` にテンプレートを足す。画面は `ui/world-form.js` の `CATEGORIES` と `ui/title-screen.js` の `DETAIL_FIELDS` に欄を足す。動作確認は `tools/sim-check.mjs`・`tools/diversity-check.mjs` の `--settings` で行う。
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
npm run check:diversity       # 27000 ステップ（3 年）・シード 1,2,3 を並行実行して多様性を表にする
node tools/diversity-check.mjs 9000 1 # ステップ数とシード（カンマ区切りで複数可）を指定
node tools/sim-check.mjs 600 1 --settings terrain:mountain # 世界の設定を指定
```

同じシード・同じステップ数なら状態ハッシュは常に同じです。**振る舞いを変えないつもりの変更（リファクタリング）では、前後でハッシュが一致すること**を確かめてください。パラメータや規則を変えた場合はハッシュが変わるのが正常です。

`--settings` は `sim-check` と `diversity-check` の両方で使えます。`<カテゴリ>:<ID>`（例 `terrain:mountain`）をカンマ区切りで重ねるか、`'{"lakeCount":4}'` のような JSON を渡します。カテゴリは `size` `terrain` `soil` `climate` です。詳細は `AGENTS.md` の「テスト・検証の注意」を参照してください。

個体数と土地を増やす案の調査用に、`tools/scaling/`(Node で動く調査用スクリプト。`run.mjs`・`ab-bench.mjs`・`region-bench.mjs`・`island-run.mjs`・`lod-check.mjs` など)と `tools/bench/`(ブラウザの計測ページ。`npm run serve` のあと `worker-bench.html`・`render-bench.html` を開く)があります。結果は `docs/plans/scaling-study.md` にまとめてあります。
