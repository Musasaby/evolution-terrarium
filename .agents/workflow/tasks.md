# タスク一覧: Issue #18(https://github.com/Musasaby/evolution-terrarium/issues/18)

## 要件
- R1: V0 個体数・面積を増やすと多様性が上がるかを確かめ、条件ごとの表と、仮説を支持するかどうかの結論を記録する
- R2: V1 物理の軽量化(a 衝突グループ・b ソルバー反復数・c 接触イベントの絞り込み)ごとに、物理 ms/ステップの中央値・9000 ステップ seed 1〜2 の多様性指標・採用してよいかの判断を記録する
- R3: V2 sim を Web Worker に移す前後の fps・実効速度・転送コストを表にする
- R4: V3 領域分割の、区画数と速くなる比率の表・同期方式の比較・決定性を保てるかの結論を記録する
- R5: V4 島モデルと単一の世界(V0)の、多様性と処理時間の比較表を作る
- R6: V5 物理の詳細度の切り替えについて、相関係数・切り替え 1 回の費用・採用できるかの判断を記録する
- R7: V6 個体数ごとの描画の所要時間の表と、WebGPU を検討すべきかの結論を記録する
- R8: 全案の「速くなる比率 / 多様性への効果 / 実装の手間 / 決定性」を 1 つの表にまとめ、採用する案を提案する
- R9: 試作は `tools/` に置き、既定の設定での sim の振る舞いを変えない(`npm run check:sim` の状態ハッシュが変わらない)

## 前提・解釈
- 結果の記録先は `docs/plans/scaling-study.md`(1 ファイル。節ごとに書き足す)。計測の生データ(JSON)は `docs/plans/scaling-data/` に置いてコミットする
- **本計測は親が実行する**。子は計測スクリプトの作成と短い試運転(数分以内)までを行う。親は文書化タスクを dispatch する前に、目的欄の「親の事前作業」のコマンドを実行し、JSON をコミットしておく。文書化タスクの参照ファイルにその JSON を挙げてあるため、JSON が無いと dispatch-prompt-gen がエラーで止まる
- **ブラウザでしか測れない V2・V6 は利用者が実行する**。子は URL パラメータで条件を選べる計測ページ(`tools/bench/`)を作る。利用者が `npm run serve` で開き、画面に出る JSON を `docs/plans/scaling-data/` に保存する
- **V3・V4 は Node の `worker_threads` で試作する**(ブラウザの Worker と同じ仕組みで、ヘッドレスで測れる。V2 には依存しない)。Node 23 の worker_threads で Rapier の初期化と `Atomics.wait` が使えることは計画時に確かめた
- V3 の試作は物理と運動(脳・関節モーター)だけを区画に分ける。植物・採食・捕食・繁殖・感覚の更新は行わず、感覚は開始時の値に固定する。壁と重なり帯(影)は作らない
- V0 は 5 条件(120 m 既定 / 160 m 既定 / 120 m・maxPop×2 / 120 m・maxPop×4 / 120 m・maxPop×2・植物の上限×2)。上限は `Sim` を作った後に `sim.geo` と `sim.flora.geo` を差し替えて上書きする(初期の個体数・植物数は変わらない)。広さの上限が 160 m のため、それより広い条件は作らない
- V1 の各案は `src/sim/` を変えず、`tools/scaling/variants.mjs` が `Sim` を作った後に差し替える。衝突グループ案が `colliderOwner.set` の差し替えで動き、600 ステップで物理が 7.39 → 6.43 ms になることは計画時に試した
- `tools/scaling/` の調査用スクリプトに限り、`src/sim/index.js` 以外の sim 内部(`body.js` `brain.js` `creatures.js` `founder.js` `config.js`)を直接 import してよい(AGENTS.md の規則の例外。調査用で本番に使わないため)
- V4 は 80 m の島 4 つ(総面積は 160 m の単一の世界と同じ)。比較相手は V0 の 160 m 条件
- 現在の基準値(計画時に実行): `npm run check:sim` の状態ハッシュは `0e7801998fe70d04`(seed 20261007・600 ステップ)。`node tools/diversity-check.mjs 600 1` の 0.07 年の行は「個体数 181・現存種 15・実効種数 14.2・食性実効 2.7」
- 判断の基準は計画時に決めておき、各文書化タスクの目的欄に書く(子は基準に当てはめて判断する)

## 対象外
- 本番コードへの採用(このIssueの結果を見て別のIssueで決める)
- V3 の重なり帯(影)と、区画をまたぐ採食・繁殖
- V2 の、本物の画面(`WorldView`・パネル)での Worker 化。試作は簡易な描画で、主スレッドで動かす場合と Worker で動かす場合を同じ描画で比べる
- Playwright などによるブラウザ計測の自動化

<!-- グループ A: 計測の土台と V0(仮説の確認)・V1(物理の軽量化) -->

## T1: 検証記録の雛形と出力先の用意
- **目的**: 結果を書き足していく `docs/plans/scaling-study.md` の雛形を作る。見出しは次の順にする: `# 個体数と土地を増やす案の検証(Issue #18)`、`## 目的と進め方`、`## 計測の方法`、`## 現状の計測(2026-11-25、seed 1)`、`## V0. 仮説の確認`、`## V1. 物理の軽量化`、`## V2. sim を Web Worker に移す`、`## V3. 領域分割`、`## V4. 島モデル`、`## V5. 物理の詳細度の切り替え`、`## V6. 描画の上限`、`## まとめと提案`。「目的と進め方」と「現状の計測」は Issue #18 の本文(`gh issue view 18 --json body --jq .body` で読める)の「目的」「現状の計測」を要約して書く。「計測の方法」には、比較は交互に 3 回ずつ測った中央値で行うこと、生データは `docs/plans/scaling-data/` に置くことを書く。V0〜まとめの各節の本文は `(未記入)` の 1 行にする。あわせて、試運転の出力先 `tools/scaling/.out/` を `.gitignore` に足す
- **対象**: `docs/plans/scaling-study.md`(新規)、`.gitignore`
- **要件**: なし
- **参照ファイル**:
  - `docs/plans/biodiversity.md:1-20`(計画文書の書き方)
  - `.gitignore`(変更対象。末尾に `tools/scaling/.out/` を足す)
- **受け入れ基準**:
  - [ ] `docs/plans/scaling-study.md` に、目的欄の 12 個の見出しがこの順で並んでいる(`grep -n '^#' docs/plans/scaling-study.md` で確かめる)
  - [ ] 「現状の計測」の節に、Issue #18 の表の 2 行(標準 120 m: 194 体・12.24 ms・9.78 ms、広い 150 m: 297 体・16.87 ms・13.41 ms)が載っている
  - [ ] `git check-ignore tools/scaling/.out/x.json` が `tools/scaling/.out/x.json` を出力する
- **依存**: なし

## T2: 条件を差し替えて多様性を測る実行スクリプト(V0 用)
- **目的**: 既存の多様性計測(`tools/diversity-worker.mjs` の `runSeed`)に、条件の差し替えと区間計測のための引数を足し、V0 の条件で実行して JSON に残すスクリプトを作る。設計は次のとおり(この形で作る)。
  1. `tools/diversity-worker.mjs`: `runSeed(steps, seed, settings, opts = {})` に引数を足す。`opts.prepare?.(sim, RAPIER)` を `Sim` を作った直後に呼ぶ。`opts.profile` が true なら `SectionProfiler`(`src/sim/index.js` から import)を `new Sim(RAPIER, seed, { settings, profiler })` に渡し、各行に `sections`(区間名 → その区間の ms/ステップ。`prof.take()` の `ms / n` ではなく `ms / 区間のステップ数`)を足す。各行に `Object.assign(row, opts.sample?.(sim))` を足す。戻り値に `geo`(`prepare` 後の `sim.geo` の `size` `maxPop` `minPop` `maxPlants` `maxSoftPlants` `maxHardPlants`)・`counters`(`{ ...sim.counters }`)・`feedStats`(`{ ...sim.feedStats }`)を足す。opts を渡さないときの既存の値は変えない
  2. `tools/scaling/variants.mjs`: `export const VARIANTS = { base, pop2, pop4, pop2plants2 }`。各要素は `{ desc: '説明', prepare(sim, R) {} }`。`overrideGeo(sim, patch)` は `sim.geo = Object.freeze({ ...sim.geo, ...patch }); sim.flora.geo = sim.geo;`。pop2 は `maxPop` を 2 倍、pop4 は 4 倍、pop2plants2 は `maxPop` と `maxPlants` `maxSoftPlants` `maxHardPlants` を 2 倍にする(`Math.round`)。`export function getVariant(name)` は知らない名前で `Error`(メッセージに使える名前の一覧を入れる)を投げる
  3. `tools/scaling/run.mjs`: `node tools/scaling/run.mjs --variant <名> [--steps 27000] [--seeds 1,2,3] [--settings <値>] [--out <path>]`。`--settings` は `tools/settings-arg.mjs` の `extractSettings` で取り除いて解釈する。親プロセスはシードごとに `process.execPath` で自分自身を `--worker <名> <ステップ数> <シード>`(と `--settings`)付きで起動して並行に走らせ(`tools/diversity-check.mjs` の `runWorker` と同じ形)、子は `runSeed(steps, seed, settings, { prepare, sample, profile: true })` の結果を JSON で stdout に出す。親は `{ variant, desc, steps, seeds, settingsText, date, results, summary }` を作り、`--out` があれば親ディレクトリを作ってから書き出し、要約を表で表示する。知らない条件名は exit 1
  4. `tools/scaling/summarize.mjs`: `export function summarizeRun(run, window)` は、シードごとに `window = [from, to]`(年)に入る行の中央値(`pop` `species` `effSpecies` `effDiet` `msPerStep` `sections['物理']`)と、その中央値のシード平均を返す。`window` を省くと `[年数 × 2/3, 年数]`(年数 = `steps × CFG.DT / CFG.YEAR`。27000 ステップなら `[2, 3]`)。CLI `node tools/scaling/summarize.mjs <json...>` は 1 ファイル 1 行の Markdown の表(列: 条件・広さ・maxPop・maxPlants・個体数・現存種・実効種数・食性実効・ms/ステップ・物理 ms)を出す
- **対象**: `tools/diversity-worker.mjs`、`tools/scaling/variants.mjs`(新規)、`tools/scaling/run.mjs`(新規)、`tools/scaling/summarize.mjs`(新規)
- **要件**: R1, R9
- **参照ファイル**:
  - `tools/diversity-worker.mjs`(変更対象。runSeed に opts を足す)
  - `tools/diversity-check.mjs:74-104`(子プロセスの起動と --worker の形を真似る)
  - `tools/settings-arg.mjs`(--settings の解釈に使う)
  - `src/sim/world-settings.js:20-38`(geo の項目)
- **受け入れ基準**:
  - [ ] `node tools/scaling/run.mjs --variant pop2plants2 --steps 600 --seeds 1 --out tools/scaling/.out/t2.json` が exit 0 で、JSON の `results[0].geo.maxPop` が 400、`maxPlants` が 4000、`results[0].rows[0].sections` に `物理` がある
  - [ ] `node tools/scaling/run.mjs --variant base --steps 600 --seeds 1 --settings '{"size":160}' --out tools/scaling/.out/t2b.json` の `results[0].geo.maxPop` が 356
  - [ ] `node tools/scaling/summarize.mjs tools/scaling/.out/t2.json tools/scaling/.out/t2b.json` が、`pop2plants2` と `base` の 2 行を含む Markdown の表を出す
  - [ ] `node tools/scaling/run.mjs --variant nosuch --steps 10 --seeds 1` が exit 1 で、メッセージに `pop2plants2` を含む
  - [ ] `npm run check:sim` の状態ハッシュが `0e7801998fe70d04` のまま、`node tools/diversity-check.mjs 600 1` の 0.07 年の行が「個体数 181・現存種 15・実効種数 14.2・食性実効 2.7」のまま
- **依存**: T1

## T3: V0 の結果を表と結論にまとめる
- **目的**: V0 の計測結果を `docs/plans/scaling-study.md` の「V0. 仮説の確認」節に書く。**親の事前作業**(dispatch の前に親が実行して JSON をコミットする): `node tools/scaling/run.mjs --variant <条件> --steps 27000 --seeds 1,2,3 --out docs/plans/scaling-data/v0-<条件>.json` を `base`・`pop2`・`pop4`・`pop2plants2` で実行し、さらに `--variant base --settings '{"size":160}'` を `v0-size160.json` に出す。子は `node tools/scaling/summarize.mjs docs/plans/scaling-data/v0-*.json` の出力を元に、条件ごとの表(2〜3 年の中央値のシード平均。シードごとの値も別表で)を書く。結論は次の基準で判断する: 「160 m 既定」または「maxPop×2・植物×2」の実効種数が「120 m 既定」より 20% 以上高く、かつ 3 シード中 2 シード以上で高ければ「仮説を支持する」。どちらも 5% 未満の差なら「支持しない」。その間は「弱く支持する」。maxPop だけ上げた条件で個体数が増えたか(餌が律速か)も一文で書く。所要時間(ms/ステップ)と個体数の関係も表に載せる
- **対象**: `docs/plans/scaling-study.md`
- **要件**: R1
- **参照ファイル**:
  - `docs/plans/scaling-study.md`(変更対象。V0 の節を書く)
  - `docs/plans/scaling-data/v0-base.json`(親が置く結果)
  - `docs/plans/scaling-data/v0-pop2plants2.json`(親が置く結果)
  - `tools/scaling/summarize.mjs`(表の作り方)
- **受け入れ基準**:
  - [ ] V0 の節に 5 条件(120 m 既定・160 m 既定・maxPop×2・maxPop×4・maxPop×2+植物×2)の行がある表があり、列に個体数・現存種・実効種数・食性実効・ms/ステップがある
  - [ ] 表の数値が `node tools/scaling/summarize.mjs docs/plans/scaling-data/v0-*.json` の出力と一致する
  - [ ] 目的欄の基準に当てはめた結論(支持する / 弱く支持する / 支持しない)と、その根拠の数値が書かれている
  - [ ] 節の本文から `(未記入)` が消えている
- **依存**: T2

## T4: V1 の差し替え案と、動きの指標
- **目的**: V1 の 3 案を `tools/scaling/variants.mjs` の条件として足し、動きの崩れと衝突しなくなる組を測る指標を足す。状態ハッシュは `tools/sim-check.mjs` から共通の関数に切り出し、各実行の最後に記録する。設計は次のとおり。
  1. `tools/scaling/variants.mjs` に補助関数 `onCreatureCollider(sim, fn)` を作る: すでにある `sim.colliderOwner` の `kind === 'c'` の項目すべてに `fn(sim.world.getCollider(handle), owner)` を呼び、さらに `sim.colliderOwner.set` を差し替えて、以後に登録される `kind === 'c'` にも呼ぶ(元の `set` は `bind` して呼び、戻り値を返す)
  2. 条件を足す: `groups16`(`bit = 1 << (owner.obj.id % 16)`、`col.setCollisionGroups(((bit << 16) | (0xFFFF ^ bit)) >>> 0)`、`col.setActiveHooks(R.ActiveHooks.NONE)`)、`iter2` / `iter3`(`sim.world.numSolverIterations = 2` / `3`。既定は 4)、`events-lean`(生物の体節を `col.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)` にして `COLLISION_EVENTS` を外す。柔らかい植物の側が `COLLISION_EVENTS` を持つので採食は続く)、`events-root`(`events-lean` に加え、`owner.part > 0` の体節を `R.ActiveEvents.NONE` にする)
  3. すべての条件に共通の `sample(sim)` を付ける。生きている個体(`c.alive && !c.dead`)について、速さ `Math.hypot(c.vx || 0, c.vz || 0)` の 10・50・90 パーセンタイルを `speedP10` `speedP50` `speedP90`、根の体節の高さ `c.pos[0].y - sim.heightAt(c.pos[0].x, c.pos[0].z)` が 3 を超えるか有限でない個体の数を `broken`、`sim.world.numSolverIterations` を `iters` として返す。`groups16` だけは加えて、根の体節どうしの距離が 3 m 未満の個体の組の数 `nearPairs` と、そのうち `id % 16` が等しい組の数 `sameGroupPairs` を返す
  4. `tools/state-hash.mjs` に `export function stateHash(sim)` を作り、`tools/sim-check.mjs` の状態ハッシュの計算(`createHash('sha1')` から `digest('hex').slice(0, 16)` まで)をそのまま移して使う。`runSeed` の戻り値に `hash: stateHash(sim)` を足す
- **対象**: `tools/scaling/variants.mjs`、`tools/state-hash.mjs`(新規)、`tools/sim-check.mjs`、`tools/diversity-worker.mjs`
- **要件**: R2, R9
- **参照ファイル**:
  - `tools/scaling/variants.mjs`(変更対象。条件を足す)
  - `tools/sim-check.mjs:29-41`(変更対象。ハッシュの計算を切り出す)
  - `tools/diversity-worker.mjs`(変更対象。戻り値に hash を足す)
  - `src/sim/body.js:36-45`(当たり判定に付けているイベントとフック)
  - `src/sim/sim.js:85-100`(filterContactPair の呼び返し)
- **受け入れ基準**:
  - [ ] `npm run check:sim` の状態ハッシュが `0e7801998fe70d04` のまま
  - [ ] `node tools/scaling/run.mjs --variant groups16 --steps 600 --seeds 1 --out tools/scaling/.out/t4.json` が exit 0 で、`results[0].rows[0]` に `nearPairs` `sameGroupPairs` `speedP50` `broken` があり、`results[0].hash` が 16 桁の 16 進数
  - [ ] `groups16` `iter2` `iter3` `events-lean` `events-root` のそれぞれを `--steps 300 --seeds 1` で実行すると exit 0 になり、`iter2` の行の `iters` が 2
  - [ ] `base` と `events-lean` を `--steps 600 --seeds 1` で実行したときの `results[0].hash` が一致するかどうかを報告に書いている(一致しなくても不合格にしない)
- **依存**: T2

## T5: 物理の所要時間を交互に測る A/B 計測
- **目的**: 条件ごとの物理 ms/ステップを、条件を交互に入れ替えながら測って中央値を出すスクリプト `tools/scaling/ab-bench.mjs` を作る。CLI は `node tools/scaling/ab-bench.mjs --variants base,groups16 [--steps 1800] [--seed 1] [--rounds 3] [--settings <値>] [--out <path>]`。親プロセスは回ごとに条件の並びを 1 つずつ回した順(1 回目は指定順、2 回目は 1 つ左に回した順…)で、子プロセス `--worker <条件> <ステップ数> <シード>` を**1 つずつ順に**起動する(並行にしない。負荷が揺れるため)。各回の実行順をログに出す。子は `Sim` を `SectionProfiler` 付きで作り、`getVariant(名).prepare(sim, RAPIER)` の後に `prof.take()` で生成分を捨て、ステップを進めて `{ variant, physMs, totalMs, sections, living }`(`physMs` は `物理` 区間の ms/ステップ、`totalMs` は全体の ms/ステップ)を JSON で出す。親は条件ごとに `physMs` と `totalMs` の中央値と、先頭の条件に対する比を表にし、`{ date, steps, seed, rounds, settingsText, runs, medians }` を `--out` に書く
- **対象**: `tools/scaling/ab-bench.mjs`(新規)
- **要件**: R2
- **参照ファイル**:
  - `tools/scaling/variants.mjs`(getVariant を使う)
  - `tools/scaling/run.mjs`(子プロセスの起動と --settings の扱いを真似る)
  - `tools/sim-check.mjs:16-27`(SectionProfiler の使い方)
- **受け入れ基準**:
  - [ ] `node tools/scaling/ab-bench.mjs --variants base,iter2 --steps 300 --rounds 2 --out tools/scaling/.out/t5.json` が exit 0 で、ログの実行順が 1 回目「base, iter2」、2 回目「iter2, base」になっている
  - [ ] 出力 JSON の `runs` が 4 件で、`medians.base.physMs` と `medians.iter2.physMs` が正の数
  - [ ] 表に、条件ごとの物理 ms の中央値と base に対する比が出ている
  - [ ] `--variants base,nosuch` が exit 1 になる
- **依存**: T4

## T6: V1 の結果と採用の判断をまとめる
- **目的**: V1 の結果を `docs/plans/scaling-study.md` の「V1. 物理の軽量化」節に書く。**親の事前作業**: `node tools/scaling/ab-bench.mjs --variants base,groups16,iter2,iter3,events-lean,events-root --steps 1800 --seed 1 --rounds 3 --out docs/plans/scaling-data/v1-ab.json` と、6 条件それぞれの `node tools/scaling/run.mjs --variant <条件> --steps 9000 --seeds 1,2 --out docs/plans/scaling-data/v1-<条件>.json` を実行してコミットする。子は `v1-ab.json` の中央値と、`node tools/scaling/summarize.mjs docs/plans/scaling-data/v1-*.json` の出力、各 JSON の `results[].counters`(births・matings・predations)・`rows[]` の `speedP50`・`broken`、`groups16` の `sameGroupPairs / nearPairs` を使って表にする。案ごとの判断の基準: 物理 ms の中央値が base より 10% 以上短く、かつ実効種数・食性実効・個体数(9000 ステップの区間の中央値のシード平均)が base の ±15% 以内、births・matings・predations が ±20% 以内、`broken` の割合が base より 1 ポイント以上増えていなければ「採用してよい」。物理が 10% 以上短いが他の基準を外れたものは「条件付き」(外れた指標を書く)、それ以外は「採用しない」
- **対象**: `docs/plans/scaling-study.md`
- **要件**: R2
- **参照ファイル**:
  - `docs/plans/scaling-study.md`(変更対象。V1 の節を書く)
  - `docs/plans/scaling-data/v1-ab.json`(親が置く結果)
  - `docs/plans/scaling-data/v1-base.json`(親が置く結果)
  - `tools/scaling/summarize.mjs`(表の作り方)
- **受け入れ基準**:
  - [ ] V1 の節に、6 条件の物理 ms の中央値・base に対する比・実効種数・食性実効・個体数・births・matings・predations・speedP50・broken の表がある
  - [ ] 物理 ms の数値が `v1-ab.json` の `medians` と一致する
  - [ ] `groups16` で別の個体なのに衝突しなくなる組の割合(`sameGroupPairs / nearPairs`)が書かれている
  - [ ] 5 つの案それぞれに、目的欄の基準による判断(採用してよい / 条件付き / 採用しない)と根拠が書かれている
- **依存**: T3, T5

<!-- グループ B: 並列化(V3 領域分割・V4 島モデル)と V5 物理の詳細度の切り替え(Node) -->

## T7: 領域分割の試作(postMessage による毎ステップ同期)
- **目的**: 1 つの世界を区画ごとの worker_threads に分けて、物理と運動を並列に進める試作を作る。設計は次のとおり。
  1. `tools/scaling/region-snapshot.mjs`: `export async function takeSnapshot({ seed, size, warm })` は `RAPIER.init()` の後、`new Sim(RAPIER, seed, { settings: { size } })` を `warm` ステップ進め、`{ size: sim.size, grid: sim.grid, H: Array.from(sim.H), creatures }` を返す。`creatures` は生きている個体(`c.alive && !c.dead`)ごとの `encodeCreature(c)`。`encodeCreature` は `{ id, genome, energy, maxE, phase, mem: Array.from(c.mem), hidden: Array.from(c.hidden), sense: { ...c.sense }, bodies: [{ p, q, v, w }] }`(`p` `q` は `translation()` `rotation()`、`v` `w` は `linvel()` `angvel()` をそれぞれ `{x,y,z(,w)}` の素のオブジェクトにしたもの)。`genome` は `{ ...genome, brain: Array.from(genome.brain), marks: Array.from(genome.marks) }`(JSON にできる形)。同じファイルに `export function decodeGenome(g)` を置き、`brain` を `Float32Array.from`、`marks` を `Int32Array.from` に戻す
  2. `tools/scaling/region-worker.mjs`: `workerData` で `{ index, bounds: { x0, x1, z0, z1 }, size, grid, H }` を受け取る。`RAPIER.init()` の後、重力 `{x:0, y:-9.81, z:0}`・`timestep = CFG.DT` の World を作り、`R.ColliderDesc.heightfield(grid, grid, new Float32Array(H), { x: size, y: 1, z: size }).setFriction(1.0)` の地形を置く(壁は作らない)。個体の復元 `restore(e)` は `buildBody(R, world, decodeGenome(e.genome), e.bodies[0].p.x, e.bodies[0].p.z, () => 0, 0)` の後、各剛体に `setTranslation` `setRotation` `setLinvel` `setAngvel`(いずれも wake = true)で写し、`{ id, genome, energy, maxE, phase, mem: Float32Array.from, hidden: Float32Array.from, out: new Float32Array(NO), inp: new Float32Array(NI), angles: new Float32Array(MAXJ), sense, ate: 0, hurt: 0, ...body }` を作って `readPose` する。1 ステップは、全個体に `readJointAngles` → `think(c, CFG.DT)` → `driveMotors(c)`、`world.step()`、偶数ステップなら全個体に `clampVel`、全個体に `readPose`。その後、根の体節 `c.pos[0]` が `bounds` の外に出た個体を `encodeCreature` 相当で書き出して剛体を `world.removeRigidBody` で消し、出ていく個体の一覧にする。メッセージ `{ type: 'step', immigrants }` を受けたら、`immigrants` を id の昇順に `restore` し(その所要時間を `handoverMs` に足す)、1 ステップ進めて `{ type: 'done', emigrants, computeMs, handoverMs, count }` を返す。`{ type: 'hash' }` には `[id, 根の x, y, z(1e-4 で丸める)]` の配列を返す
  3. `tools/scaling/region-bench.mjs`: `node tools/scaling/region-bench.mjs [--regions 1,2,4] [--sizes 120] [--steps 900] [--warm 900] [--seed 1] [--sync message] [--out <path>]`。区画は 1 = 全体、2 = `x < 0` と `x >= 0`、4 = x・z の符号で 4 象限。広さごとに `takeSnapshot` を 1 回取り、区画数ごとに、根の位置で個体を振り分けて worker を起動する。毎ステップ、全 worker に `step`(前のステップで出ていった個体を、根の位置で決めた行き先の worker の `immigrants` に入れる)を送り、全員の `done` を待つ。区画数 1 も worker で測る。1 回の実行(広さ × 区画数)ごとに `{ size, regions, sync, steps, msPerStep(全体の壁時間 / ステップ数), computeMaxMs(各ステップの computeMs の最大の平均), computeMeanMs(平均の平均), syncMs(msPerStep − computeMaxMs), imbalance(computeMaxMs / computeMeanMs), handoversPer1000, handoverMsPerCreature, countsStart, countsEnd, hash }` を作る。`hash` は全 worker の `hash` の結果を id 順に並べた JSON の sha1 の先頭 16 桁。表を表示し、`{ date, seed, warm, runs }` を `--out` に書く
- **対象**: `tools/scaling/region-snapshot.mjs`(新規)、`tools/scaling/region-worker.mjs`(新規)、`tools/scaling/region-bench.mjs`(新規)
- **要件**: R4
- **参照ファイル**:
  - `src/sim/body.js:13-60`(buildBody と剛体の作り方)
  - `src/sim/founder.js:23-30`(試走で個体を動かす手順 tick を真似る)
  - `src/sim/brain.js:11-20`(think が読む値)
  - `src/sim/sim.js:101-114`(地形の当たり判定の作り方)
- **受け入れ基準**:
  - [ ] `node tools/scaling/region-bench.mjs --regions 1,2 --steps 60 --warm 60 --out tools/scaling/.out/t7.json` が exit 0 で、`runs` が 2 件、各件に目的欄の項目がすべてある
  - [ ] 区画数 2 の実行で `countsStart` の合計と `countsEnd` の合計が等しい(個体が消えたり増えたりしない)
  - [ ] 区画数 4 を `--regions 4 --steps 60 --warm 60` で実行すると exit 0 になり、`msPerStep` と `handoversPer1000` が表に出る
- **依存**: なし

## T8: 領域分割の SharedArrayBuffer 同期と決定性の確認
- **目的**: T7 の領域分割に、`SharedArrayBuffer` と `Atomics` による毎ステップの同期を足し、決定性を確かめる。設計は次のとおり。`--sync message,atomics` で両方を測れるようにする。atomics のとき、main は `ctrl = new Int32Array(new SharedArrayBuffer(8))`(`ctrl[0]` = 世代、`ctrl[1]` = 終わった worker の数)と、worker ごとに受け取り箱・送り出し箱(各 `new SharedArrayBuffer(4 + 2 ** 20)`。先頭 4 バイトに長さ、その後に JSON を UTF-8 で書く)を `workerData` で渡す。各ステップで main は受け取り箱に行き先ごとの `immigrants` の JSON を書き、`Atomics.store(ctrl, 1, 0)`、`Atomics.add(ctrl, 0, 1)`、`Atomics.notify(ctrl, 0)` の後、`ctrl[1]` が区画数になるまで `Atomics.wait(ctrl, 1, 現在値)` で待ち、送り出し箱を読む。worker は `Atomics.wait(ctrl, 0, 前の世代)` で待ち、受け取り箱を読んで 1 ステップ進め、送り出し箱に `{ emigrants, computeMs, handoverMs, count }` の JSON を書き、`Atomics.add(ctrl, 1, 1)` と `Atomics.notify(ctrl, 1)` をする。共有メモリから読むときは `slice` で複製してから `TextDecoder` に渡す。最後の `hash` は message と同じく postMessage で取る(そのため worker は終了の合図で待ちを抜ける)。あわせて `--repeat 2` で同じ条件を 2 回実行し、各実行に `hashMatch`(1 回目と同じハッシュか)を記録する
- **対象**: `tools/scaling/region-worker.mjs`、`tools/scaling/region-bench.mjs`
- **要件**: R4
- **参照ファイル**:
  - `tools/scaling/region-worker.mjs`(変更対象。atomics の待ちを足す)
  - `tools/scaling/region-bench.mjs`(変更対象。--sync と --repeat を足す)
- **受け入れ基準**:
  - [ ] `node tools/scaling/region-bench.mjs --regions 2 --sync message,atomics --steps 60 --warm 60 --out tools/scaling/.out/t8.json` が exit 0 で、`runs` に `sync` が `message` と `atomics` の 2 件がある
  - [ ] 同じ条件の message と atomics の `hash` が一致する(同期の方法で結果が変わらない)
  - [ ] `--regions 2 --sync atomics --repeat 2 --steps 60 --warm 60` の 2 件目の `hashMatch` が true
  - [ ] 実行後にプロセスが残らずに終わる(コマンドが戻る)
- **依存**: T7

## T9: 島モデルの試作(独立した世界と、ときどきの移住)
- **目的**: 80 m の島 4 つを worker_threads で並行に動かし、一定の間隔で少数の個体を移す試作を作る。設計は次のとおり。
  1. `tools/scaling/island-worker.mjs`: `workerData` で `{ index, seed, size }` を受け取り、`new Sim(RAPIER, seed, { settings: { size } })` を作る。メッセージ: `{ type: 'run', steps }` は進めて `{ computeMs }` を返す。`{ type: 'stats' }` は `{ living, speciesCounts: [[sp.id, 数]], dietCounts: [草, 葉, 肉], div: computeDiversity(sim) の effSpecies と effDiet }` を返す(食性の分け方は `tools/diversity-worker.mjs` の `DIET_EDGE` と同じ)。`{ type: 'emigrate', k, rngSeed }` は `makeRng(rngSeed)` で、生きている個体を id 順に並べた中から重複なく k 体選び、`{ genome: cloneGenome(genome), energyFrac: energy / maxE }` を書き出し、`c.species.count--` の後に `removeCreature(sim, c)` して、その一覧を返す。`{ type: 'immigrate', migrants, rngSeed }` は `makeRng(rngSeed)` で各個体の置き場所を `±(sim.edge − 10)` から最大 20 回引き(`sim.isWater` を避ける。置けなければその個体は捨てて数える)、生きている個体がいる種のうち `sim.interfertile(sp.rep, genome)` が真で個体数が最大の種に入れ、無ければ `newSpecies(sim, genome, null, true)` を作り、`spawnCreature(sim, genome, x, z, { species, energyFrac, gen: 0 })` で置く。`{ placed, dropped }` を返す
  2. `tools/scaling/island-run.mjs`: `node tools/scaling/island-run.mjs [--islands 4] [--size 80] [--steps 27000] [--seeds 1] [--conditions 0x0,1500x2] [--out <path>]`。条件 `<間隔>x<人数>` の間隔 0 は移住なし。島 i のシードは `seed * 100 + i`。1 回の実行(シード × 条件)では、`gcd(間隔, 2250)`(間隔 0 なら 2250)ステップずつ全島に `run` を送って待つ。進んだステップ数が間隔の倍数なら、全島に `emigrate`(`k = 人数`、`rngSeed = seed * 1e6 + 進んだステップ数 + i`)を送り、島 i の個体を島 `(i + 1) % 島数` に `immigrate` する。2250 ステップ(0.25 年)ごとに全島の `stats` を集め、島ごとの値と、群島全体の値(種は `島番号:sp.id` を別の種として数えた実効種数 exp(H)、食性は `dietCounts` の合計から求めた実効数、個体数の合計、種数の合計)を行に記録する。行には壁時間の ms/ステップと、それを全体の個体数で割った値も入れる。シードは並行に、条件は順に実行する。結果 `{ date, islands, size, steps, runs: [{ seed, interval, migrants, rows, migrated, dropped, summary }] }` を `--out` に書き、`summary` には `[年数 × 2/3, 年数]` の区間の中央値を入れる
- **対象**: `tools/scaling/island-worker.mjs`(新規)、`tools/scaling/island-run.mjs`(新規)
- **要件**: R5
- **参照ファイル**:
  - `tools/diversity-worker.mjs`(行の作り方と食性の分け方を真似る)
  - `src/sim/creatures.js:34-48`(spawnCreature と newSpecies)
  - `src/sim/creatures.js:99-104`(removeCreature)
  - `src/sim/speciation.js:6-8`(interfertile)
- **受け入れ基準**:
  - [ ] `node tools/scaling/island-run.mjs --steps 2250 --seeds 1 --conditions 750x2 --out tools/scaling/.out/t9.json` が exit 0 で、`runs[0].rows` が 1 行、`migrated` が 24(3 回 × 4 島 × 2 体)から `dropped` を引いた数と矛盾しない
  - [ ] `--conditions 0x0` の実行で `migrated` が 0
  - [ ] 同じコマンドを 2 回実行したとき、`runs[0].rows[0]` の群島全体の実効種数と個体数が一致する
  - [ ] 行に、島ごとの値と群島全体の値(個体数・種数・実効種数・食性実効・ms/ステップ・個体あたりの ms)がある
- **依存**: なし

## T10: 物理の詳細度の切り替え(LOD)の実現性を測る
- **目的**: 遠くの個体を点として動かす案の前提を測るスクリプト `tools/scaling/lod-check.mjs` を作る。CLI は `node tools/scaling/lod-check.mjs [--seed 1] [--warm 9000] [--window 600] [--sample 60] [--out <path>]`。手順は次のとおり。
  1. `new Sim(RAPIER, seed)` を `warm` ステップ進める。生きている個体の根の位置を控え、さらに `window` ステップ進め、その間ずっと生きていた個体の水平の移動距離を `window × CFG.DT` で割って「本来の物理での速さ」にする
  2. その個体を id 順に並べた先頭 `sample` 体について、`trialDistance(sim, c.genome, 6) / (6 − 40 × CFG.DT)`(`founder.js` の試走。i = 40 から測るため)を「試走の速さ」にする。両者のピアソンの相関係数とスピアマンの順位相関係数を求める
  3. 同じ個体について、外す(全体節の `sim.colliderOwner.delete(col.handle)` と `sim.world.removeRigidBody(b)`)のと、付け直す(`buildBody(sim.R, sim.world, c.genome, x, z, (a, b) => sim.heightAt(a, b), Math.atan2(h.z, h.x))`。`x` `z` は外す前の根の位置、`h = heading(外す前の c.rot[0])`。体を `c` に入れ直し、`colliderOwner` に `{ kind: 'c', obj: c, part: i }` を登録し、`readPose(c)` する)のにかかった時間を個体ごとに測り、中央値を出す(向きの一致は確かめない)
  4. 付け直した後に sim を 30 ステップ進め、その間に「いずれかの体節の `pos.y` が `sim.heightAt(x, z) − 0.2` を下回った」個体の割合を `sinkRate`、「根の体節の速さ `linvel()` が 6 m/s を超えた」個体の割合を `spikeRate` とする
  結果 `{ date, seed, warm, window, n, pearson, spearman, pairs: [[試走, 本来]], detachMs, attachMs, sinkRate, spikeRate }` を表示し、`--out` に書く
- **対象**: `tools/scaling/lod-check.mjs`(新規)
- **要件**: R6
- **参照ファイル**:
  - `src/sim/founder.js:32-51`(trialDistance)
  - `src/sim/body.js:13-14`(buildBody の引数)
  - `src/sim/body.js:130-137`(heading)
  - `src/sim/creatures.js:34-44`(体の登録のしかた)
  - `src/sim/creatures.js:99-104`(体の外し方)
- **受け入れ基準**:
  - [ ] `node tools/scaling/lod-check.mjs --warm 600 --window 300 --sample 20 --out tools/scaling/.out/t10.json` が exit 0 で、JSON に目的欄の項目がすべてある
  - [ ] `n` が 10 以上で、`pearson` と `spearman` が −1〜1 の数
  - [ ] `detachMs` `attachMs` が正の数、`sinkRate` `spikeRate` が 0〜1 の数
- **依存**: なし

## T11: V3・V4・V5 の結果と判断をまとめる
- **目的**: V3・V4・V5 の結果を `docs/plans/scaling-study.md` の各節に書く。**親の事前作業**: `node tools/scaling/region-bench.mjs --regions 1,2,4 --sizes 120,160 --sync message,atomics --steps 900 --warm 900 --repeat 2 --out docs/plans/scaling-data/v3.json`、`node tools/scaling/island-run.mjs --steps 27000 --seeds 1,2,3 --conditions 0x0,1500x2,1500x8,6000x2,6000x8 --out docs/plans/scaling-data/v4-islands.json`、`node tools/scaling/lod-check.mjs --out docs/plans/scaling-data/v5-lod.json` を実行してコミットする。書く内容と判断の基準:
  - V3: 広さ・同期方式ごとに、区画数と速くなる比率(区画数 1 の `msPerStep` ÷ その区画数の `msPerStep`)・syncMs・imbalance・handoversPer1000・handoverMsPerCreature の表。同期方式の比較(syncMs の差)。決定性は、`--repeat 2` の `hashMatch` がすべて true で、message と atomics の hash が一致すれば「保てる」。区画数 1 と区画数 2 以上の hash は一致しない(区画の境界で衝突しなくなる)ことも書く
  - V4: 条件ごとに、群島全体と島ごと(平均)の実効種数・食性実効・個体数・ms/ステップ・個体あたりの ms と、V0 の 160 m 条件(`v0-size160.json`)の同じ値を並べた表。群島全体の実効種数が 160 m より 20% 以上高い条件があれば「多様性に効果あり」
  - V5: n・ピアソン・スピアマン・外す/付け直す時間・sinkRate・spikeRate の表。ピアソンが 0.7 以上、外す+付け直すの中央値の合計が 0.5 ms 以下、sinkRate が 0.05 以下をすべて満たせば「採用できる」、そうでなければ満たさない項目を書いて「このままでは採用できない」
- **対象**: `docs/plans/scaling-study.md`
- **要件**: R4, R5, R6
- **参照ファイル**:
  - `docs/plans/scaling-study.md`(変更対象。V3・V4・V5 の節を書く)
  - `docs/plans/scaling-data/v3.json`(親が置く結果)
  - `docs/plans/scaling-data/v4-islands.json`(親が置く結果)
  - `docs/plans/scaling-data/v5-lod.json`(親が置く結果)
  - `docs/plans/scaling-data/v0-size160.json`(V4 の比較相手)
- **受け入れ基準**:
  - [ ] V3 の節に、区画数と速くなる比率の表・同期方式の比較・決定性の結論がある
  - [ ] V4 の節に、5 条件と 160 m の単一の世界を並べた表と、目的欄の基準による結論がある
  - [ ] V5 の節に、目的欄の項目の表と、基準による判断がある
  - [ ] 表の数値が各 JSON の値と一致する
  - [ ] 3 つの節の本文から `(未記入)` が消えている
- **依存**: T3, T8, T9, T10, T16

<!-- グループ C: ブラウザでの計測(V2 Worker 化・V6 描画の上限)とまとめ -->

## T12: 描画の上限を測る計測ページ(V6)
- **目的**: 個体数を変えて描画の所要時間を測るページを作る。設計は次のとおり。
  1. `src/render/creature-view.js`: コンストラクタを `constructor(scene, { markerColor, maxParts = MAX_PARTS })` にし、`this.maxParts = maxParts` を InstancedMesh の数(胴は `maxParts`、球は `maxParts * 2`)と `update` のループの上限 `kb < MAX_PARTS` に使う。既定の値は変えない
  2. `src/render/world-view.js`: コンストラクタを `constructor(container, { markerColor, maxParts })` にし、`new CreatureView(scene, { markerColor, maxParts })` に渡す
  3. `tools/bench/render-bench.html`: `index.html` の import map(three・three/addons/・rapier)を写し、全画面の描画領域と結果表示(`<pre id="out">` と `<textarea id="json">`)を置き、`render-bench.js` を module で読む
  4. `tools/bench/render-bench.js`: URL パラメータ `counts`(既定 `200,500,1000,2000`)・`frames`(既定 300)・`warm`(既定 60)・`seed`(既定 1)。`RAPIER.init()` の後 `new Sim(RAPIER, seed)` を作るが進めない。`new WorldView(container, { markerColor: '#ffcc00', maxParts: 最大の個体数 × CFG.MAXP })` に `attach(sim)` する。生きている個体を雛形にし、個体数 N ごとに、雛形を順に使い回して `{ alive: true, dead: false, genome, species, bodies: 雛形の bodies, pos: 雛形の pos を x・z に ±sim.edge の一様乱数(`makeRng(seed)`)でずらした写し, rot: 雛形の rot }` を N 体作って `sim.creatures` に入れる。毎フレーム、各個体の `pos[*].x` に `Math.sin(now / 500 + k) * 0.001` を足し(行列の更新を起こすため)、`view.update(1 / 60, now, { selected: null, follow: false })` と `view.render()` の所要時間とフレーム間隔を測る。`warm` フレームを捨て、`frames` フレームの中央値と 90 パーセンタイルを N ごとに求め、`view.renderInfo()` の calls・triangles と、取れれば `WEBGL_debug_renderer_info` の GPU 名を添えて表と JSON を出す
- **対象**: `src/render/creature-view.js`、`src/render/world-view.js`、`tools/bench/render-bench.html`(新規)、`tools/bench/render-bench.js`(新規)
- **要件**: R7, R9
- **参照ファイル**:
  - `src/render/creature-view.js`(変更対象。maxParts を引数にする)
  - `src/render/world-view.js`(変更対象。maxParts を渡す)
  - `index.html:10-18`(import map)
  - `src/app/main.js:41`(WorldView の作り方)
  - `src/render/scene.js:50-53`(renderInfo)
- **受け入れ基準**:
  - [ ] `npm run check:sim` の状態ハッシュが `0e7801998fe70d04` のまま
  - [ ] `node --check tools/bench/render-bench.js` が exit 0
  - [ ] `CreatureView` を `maxParts` なしで作ったとき、胴の InstancedMesh の数が 2400 のまま(コードを読んで確かめ、報告に該当行を書く)
  - [ ] ブラウザでの確認をしていない場合は、その旨と、確認の手順(`npm run serve` → http://localhost:8000/tools/bench/render-bench.html)を報告に書く
- **依存**: なし

## T13: sim を Web Worker に移す効果を測る計測ページ(V2)
- **目的**: 同じ簡易な描画で、sim を主スレッドで動かす場合と Worker で動かす場合を比べるページを作る。設計は次のとおり。
  1. `tools/bench/pack-poses.js`(three に依存しない): `export const STRIDE = 9`、`export function packPoses(sim)` は、生きている個体(`alive`)のすべての体節について `[x, y, z, qx, qy, qz, qw, 半径 genome.parts[i].r, 色相 species?.hue ?? 0]` を詰めた `Float32Array` と体節数 `n` を `{ buf, n }` で返す
  2. `tools/bench/sim-worker.js`(module Worker): `import RAPIER from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/dist/rapier.mjs'`(Worker では import map が効かないため直接 URL を書く)と、`Sim`(`../../src/sim/index.js`)・`SimRunner`(`../../src/app/sim-runner.js`)・`packPoses` を読む。`{ type: 'init', seed, speed }` で sim を作り、ループを始める。ループは、前回からの実時間で `runner.advance(sim, dtr, speed)` を呼び、`packPoses` の結果を `postMessage({ type: 'poses', buf, n, steps, simSeconds, sentAt: performance.timeOrigin + performance.now() }, [buf.buffer])` で送り、前回の開始から 16 ms 後に `setTimeout` で次を呼ぶ。`{ type: 'speed', speed }` で速度を変える
  3. `tools/bench/worker-bench.js`: 簡易な描画(地面の平面 1 枚と、体節を描く `SphereGeometry(1, 10, 6)` の InstancedMesh(最大 8000、色は `setHSL(色相, 0.6, 0.5)`)、固定カメラ、環境光と平行光)。URL パラメータ `modes`(既定 `main,worker`)・`speeds`(既定 `1,8`)・`secs`(既定 20)・`seed`(既定 1)。モードと速度の組ごとに新しい sim(または Worker)を作り、3 秒捨ててから `secs` 秒測る。main モードは毎フレーム主スレッドで `runner.advance` → `packPoses` → 描画、worker モードは毎フレーム受け取った最新の `buf` を描画する。測るもの: fps、フレーム間隔の中央値と 90 パーセンタイル、実効速度(進んだシム秒 ÷ 実時間の秒)、worker モードでは 1 回の転送の大きさ(`buf.byteLength`)の平均・1 秒あたりの転送回数・転送の遅れ(受け取った時刻 `performance.timeOrigin + performance.now()` − `sentAt`)の中央値。組ごとの結果を表と JSON で出す
  4. `tools/bench/worker-bench.html`: `index.html` の import map を写し、描画領域と結果表示(`<pre id="out">` と `<textarea id="json">`)を置き、`worker-bench.js` を module で読む
- **対象**: `tools/bench/pack-poses.js`(新規)、`tools/bench/sim-worker.js`(新規)、`tools/bench/worker-bench.js`(新規)、`tools/bench/worker-bench.html`(新規)
- **要件**: R3
- **参照ファイル**:
  - `src/app/sim-runner.js`(SimRunner を Worker と主スレッドの両方で使う)
  - `src/app/main.js:148-175`(Sim の作り方)
  - `index.html:10-18`(import map)
- **受け入れ基準**:
  - [ ] `node --check` が `tools/bench/pack-poses.js` `tools/bench/sim-worker.js` `tools/bench/worker-bench.js` のすべてで exit 0
  - [ ] Node で `Sim` を seed 1 で作って 30 ステップ進め、`packPoses(sim)` の `n` が生きている個体の体節数の合計と等しく、`buf.length` が `n * 9` 以上になる(確かめたコマンドを報告に書く)
  - [ ] `src/` 配下のファイルを変えていない(`git diff --stat main -- src` に T12 以外の変更が無い)
  - [ ] ブラウザでの確認をしていない場合は、その旨と、確認の手順(`npm run serve` → http://localhost:8000/tools/bench/worker-bench.html)を報告に書く
- **依存**: なし

## T14: V2・V6 の結果をまとめる
- **目的**: ブラウザでの計測結果を `docs/plans/scaling-study.md` の「V2」「V6」節に書く。**利用者の事前作業**(親は dispatch の前に、利用者に計測を頼んで JSON を受け取り、コミットする): `npm run serve` の後、http://localhost:8000/tools/bench/worker-bench.html と http://localhost:8000/tools/bench/render-bench.html を開き、画面の JSON をそれぞれ `docs/plans/scaling-data/v2-worker.json` と `docs/plans/scaling-data/v6-render.json` に保存する。書く内容と判断の基準:
  - V2: 速度 ×1・×8 ごとに、main と worker の fps・フレーム間隔・実効速度の表と、worker の 1 回の転送の大きさ・1 秒あたりの回数・遅れの表。実効速度と fps が何倍になったかを書く
  - V6: 個体数ごとに、描画更新とレンダリングの ms(中央値・90 パーセンタイル)・fps・calls・triangles の表と、計測した GPU 名。描画がボトルネックになる個体数を「描画更新 + レンダリングの中央値が 8 ms を超えるか、fps が 50 を下回る最小の個体数」と定める。それが 1000 体以下なら「WebGPU の検討が必要」、2000 体でも超えなければ「当面不要」、その間なら「1000 体を超える規模を目指すなら検討する」と結論する
- **対象**: `docs/plans/scaling-study.md`
- **要件**: R3, R7
- **参照ファイル**:
  - `docs/plans/scaling-study.md`(変更対象。V2・V6 の節を書く)
  - `docs/plans/scaling-data/v2-worker.json`(利用者が置く結果)
  - `docs/plans/scaling-data/v6-render.json`(利用者が置く結果)
- **受け入れ基準**:
  - [ ] V2 の節に、main と worker の前後比較の表(fps・実効速度・転送の大きさ・回数・遅れ)がある
  - [ ] V6 の節に、個体数ごとの表と、目的欄の基準による WebGPU の結論がある
  - [ ] 表の数値が 2 つの JSON の値と一致する
  - [ ] 2 つの節の本文から `(未記入)` が消えている
- **依存**: T6, T11, T12, T13

## T15: 全案のまとめと採用案の提案
- **目的**: `docs/plans/scaling-study.md` の「まとめと提案」節に、V0〜V6 を 1 つの表にまとめ、採用する案を提案する。表の列は「案・速くなる比率・多様性への効果・実装の手間・決定性・判断」。値は各節の結果から写す(速くなる比率が無い V0 は「—」)。実装の手間は、試作の大きさから「小 = 本番では src/sim の 1〜2 ファイルの変更」「中 = 3〜5 ファイルか新しいモジュール」「大 = 世界の持ち方やループの構造を変える」で付ける。提案は、各節で「採用してよい」「採用できる」「効果あり」と判断した案を、速くなる比率の大きい順に並べ、次の Issue の候補として 1 案ずつ 1〜2 文で書く。V0 の結論が「支持しない」だった場合は、その旨を提案の冒頭に書く。あわせて `ARCHITECTURE.md` の「動作確認」節に、`tools/scaling/`(Node の調査用スクリプト)と `tools/bench/`(ブラウザの計測ページ)を 2〜3 行で紹介し、結果は `docs/plans/scaling-study.md` にあると書く
- **対象**: `docs/plans/scaling-study.md`、`ARCHITECTURE.md`
- **要件**: R8
- **参照ファイル**:
  - `docs/plans/scaling-study.md`(変更対象。まとめと提案を書く)
  - `ARCHITECTURE.md:148-161`(変更対象。動作確認の節に足す)
- **受け入れ基準**:
  - [ ] 「まとめと提案」節に、V0〜V6 の 7 行と目的欄の 6 列を持つ表がある
  - [ ] 表の値が各節の結果と食い違っていない
  - [ ] 提案に、目的欄の規則で選んだ案が速くなる比率の大きい順に並んでいる
  - [ ] `ARCHITECTURE.md` の「動作確認」節に `tools/scaling/` と `tools/bench/` の説明がある
  - [ ] `docs/plans/scaling-study.md` に `(未記入)` が残っていない
- **依存**: T14

## T16: 領域分割の atomics 同期で共有箱があふれる問題を直す
- **グループ**: B
- **目的**: `region-bench.mjs` の atomics 同期は、最初のステップで区画の全個体を受け取り箱に JSON で書く。160 m・区画数 1 では 2.5 MB ほどになり、箱の大きさ(`2 ** 20` バイト)を超えて `共有箱があふれました` で止まる。箱の大きさを `2 ** 24` バイト(16 MiB)に広げ、main と worker の両方で、書く前に箱の大きさ(`sab.byteLength - 4`)を超えないかを確かめ、超えたら箱の大きさと書こうとした長さを含むエラーで止める(worker 側は今は確かめていない)。worker は箱の大きさを定数で持たず、渡された `SharedArrayBuffer` の大きさから求める。message 同期と、同じ条件の hash は変えない
- **対象**: `tools/scaling/region-bench.mjs`、`tools/scaling/region-worker.mjs`
- **要件**: R4
- **参照ファイル**:
  - `tools/scaling/region-bench.mjs`(変更対象。箱の大きさと書く前の確認)
  - `tools/scaling/region-worker.mjs`(変更対象。書く前の確認)
- **受け入れ基準**:
  - [ ] `node tools/scaling/region-bench.mjs --regions 1,2 --sizes 160 --sync message,atomics --steps 30 --warm 30 --out tools/scaling/.out/t16.json` が exit 0 で終わり、`runs` が 4 件ある
  - [ ] 上の結果で、同じ区画数の message と atomics の `hash` が一致する
  - [ ] `node tools/scaling/region-bench.mjs --regions 2 --sync message,atomics --steps 60 --warm 60 --out tools/scaling/.out/t16b.json` の message と atomics の `hash` が、変更前の同じコマンドの結果と一致する(変更前の値は作業前に実行して控える)
  - [ ] worker 側の書き込みにも大きさの確認がある(コードで確かめる)
  - [ ] 実行後にプロセスが残らずに終わる(コマンドが戻る)
- **依存**: T8
