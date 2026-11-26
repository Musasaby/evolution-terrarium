# タスク一覧: Issue #22(物理を軽くする: 体節の衝突グループを個体 id で 16 に分ける)

## 要件
- R1: `src/sim/` で、体節の衝突グループを個体 id で 16 に分け、接触フックを外す
- R2: 27000 ステップ・seed 1,2,3 で生態の指標を確かめ、#18 の V1 と同じ基準で採否を判断して記録する
- R3: 物理の所要時間を `tools/scaling/ab-bench.mjs` で変更前後を比べて記録する
- R4: 別の個体どうしのめり込みを数値で確かめる(ブラウザでの見た目確認の代わり)

## 前提・解釈
- 本実装は #18 で測った試作 `groups16`(`tools/scaling/variants.mjs`)と**状態ハッシュが一致する**形にする。計画時に確かめた値: 試作を今のコードにかけると、`node tools/sim-check.mjs`(600 ステップ・既定シード 20261007)は `088bad967edb44ab`、`node tools/sim-check.mjs 600 1` は `fb099bd8c5bfe5dd`。変更前は `0e7801998fe70d04`
- 祖先の試走用の世界(`src/sim/founder.js`)の体節は、従来の設定(`setActiveHooks(FILTER_CONTACT_PAIRS)`)のままにする。試走側まで衝突グループに変えると、既定シードのハッシュが `bc3e987b9a522ab9` になり、測った試作とずれることを計画時に確かめた
- 変更前の比較には旧方式(接触フック)を再現する variant `hooks` を作って使う。計画時に試したところ、旧方式を再現すると既定シード 600 ステップのハッシュは変更前と同じ `0e7801998fe70d04` になった。これで A/B 計測を同じコードの上で交互に回せる
- 採否の基準は #18 の V1 と同じ(`docs/plans/scaling-study.md:111`)。物理 ms の中央値が比 0.90 以下、実効種数・食性実効・個体数が ±15% 以内、births・matings・predations が ±20% 以内、`broken` の割合の増加が 1 ポイント未満
- 基準を外れた場合も、結果を記録して止まる。実装のコミットは残し、採否は利用者が判断する
- めり込みは Rapier 0.21 の `Collider.contactCollider(other, 0)` で測る。計画時に確かめた挙動: 2 つの形が離れていれば `null` を返し、重なっていれば `distance` が負の `ShapeContact` を返す。変更前のコードで seed 1・300 ステップ後に、根が 3 以内の 268 組を調べると、最も深い値は `distance = -0.057` だった(ソルバの許容内の小さなめり込み)

## 対象外
- ブラウザでの見た目確認は子エージェントにはできないため、R4 の数値計測で代える。必要なら利用者が PR の確認時に `npm run serve` で見る
- `tools/scaling/region-worker.mjs` は自前の世界で `world.step()` を呼ぶ試作で、本番の sim とは別なので変えない

## T1: sim の体節を衝突グループで分け、接触フックを外す
- **目的**: 本番の sim で、体節の衝突グループを個体 id で 16 に分け、接触フック(`filterContactPair`)を外す。試作 `groups16` と状態ハッシュが一致する形で実装する。骨格は次のとおりで、ここから変えない
  - `src/sim/body.js` に関数を足して export する
    ```js
    // 体節の衝突グループ。個体 id を 16 で割った余りのビットを所属にし、同じビットの体節とは衝突しない
    // (同じ個体の体節どうしがぶつからないようにする。別の個体でも余りが同じなら衝突しない)
    export function bodyCollisionGroups(id) {
      const bit = 1 << (id % 16);
      return ((bit << 16) | (0xFFFF ^ bit)) >>> 0;
    }
    ```
  - `buildBody` の引数の末尾に `group = null` を足す(`buildBody(R, world, genome, x, z, groundFn, yaw, lift = 0, group = null)`)。体節の `ColliderDesc` を変数 `desc` に組み立て、`group === null` なら従来どおり `desc.setActiveHooks(R.ActiveHooks.FILTER_CONTACT_PAIRS)`、そうでなければ `desc.setCollisionGroups(bodyCollisionGroups(group))` を呼んでから `world.createCollider(desc, b)` する。`group === null` の分岐には「祖先の試走用の世界(founder.js)はこちら。従来の設定のまま」と注記する
  - `src/sim/creatures.js` の `spawnCreature` で、`buildBody(...)` の末尾の引数に `c.id` を渡す
  - `src/sim/sim.js` の `initPhysics` から `this.hooks` の定義を消し、`step()` の `this.world.step(this.eventQueue, this.hooks)` を `this.world.step(this.eventQueue)` にする
  - `tools/scaling/lod-check.mjs` で付け直すときの `buildBody(...)` の末尾に、引数 `0`(`lift`)と `c.id` を足す。本番の世界で `FILTER_CONTACT_PAIRS` を付けたままフックを渡さないと、`world.step` が WASM の中で落ちることを計画時に確かめた
  - `src/sim/founder.js` は変更しない
- **対象**: `src/sim/body.js`, `src/sim/creatures.js`, `src/sim/sim.js`, `tools/scaling/lod-check.mjs`
- **要件**: R1
- **参照ファイル**:
  - `src/sim/body.js:13-50`(変更対象。buildBody の体節の当たり判定)
  - `src/sim/creatures.js:34-46`(変更対象。spawnCreature)
  - `src/sim/sim.js:84-100`(変更対象。initPhysics の hooks。164 行目の world.step も変える)
  - `tools/scaling/lod-check.mjs:118-125`(変更対象。付け直しの buildBody)
  - `tools/scaling/variants.mjs:108-120`(試作 groups16。同じ計算式にする)
- **受け入れ基準**:
  - [ ] `node tools/sim-check.mjs` の状態ハッシュが `088bad967edb44ab`、`node tools/sim-check.mjs 600 1` が `fb099bd8c5bfe5dd` になる(試作 groups16 と一致。規則が変わるので変更前の `0e7801998fe70d04` とは違うのが正常)
  - [ ] `git grep -n "filterContactPair\|this.hooks" -- src/` が何も出力しない
  - [ ] `git diff --stat` に `src/sim/founder.js` が含まれない
  - [ ] `node tools/scaling/lod-check.mjs --warm 300 --window 60 --sample 5` が exit 0 で終わる
- **依存**: なし

## T2: 旧方式を再現する variant と、variant ごとの状態ハッシュを出すツール
- **目的**: 変更前後を同じコードの上で比べるため、旧方式(接触フック)を再現する variant `hooks` を `tools/scaling/variants.mjs` に足す。あわせて、variant をかけた sim の状態ハッシュを出す小さなツールを作り、再現が正しいことをハッシュで確かめられるようにする。T1 で本番の sim が衝突グループ方式になっている前提で書く
  - `VARIANTS` に `hooks` を足す。骨格は次のとおり。
    ```js
    hooks: {
      desc: '旧方式: 衝突グループを分けず、接触フックで同じ個体の体節どうしの衝突を外す（#22 の変更前）',
      prepare(sim, R) {
        onCreatureCollider(sim, (col) => {
          col.setCollisionGroups(0xFFFFFFFF);
          col.setActiveHooks(R.ActiveHooks.FILTER_CONTACT_PAIRS);
        });
        const owner = sim.colliderOwner;
        const hooks = {
          filterContactPair: (c1, c2) => {
            const a = owner.get(c1), b = owner.get(c2);
            if (a && b && a.kind === 'c' && b.kind === 'c' && a.obj === b.obj) return null;
            return R.SolverFlags.COMPUTE_IMPULSE;
          },
          filterIntersectionPair: () => true,
        };
        const step = sim.world.step.bind(sim.world);
        sim.world.step = (queue) => step(queue, hooks);
      },
      sample: sampleBase,
    },
    ```
  - `groups16` の `desc` を「(#22 で本番に入ったため、今は base と同じ)」の旨に書き換える。`prepare` は消さずに残す(過去の記録を再現するため)
  - 新しいツール `tools/scaling/variant-hash.mjs` を作る。使い方は `node tools/scaling/variant-hash.mjs <variant> [ステップ数=600] [シード=20261007]`。処理は `RAPIER.init()` → `new Sim(RAPIER, seed, {})` → `getVariant(name).prepare(sim, RAPIER)` → ステップ数だけ `sim.step()` → `console.log(\`${name} seed ${seed} / ${steps} ステップ 状態ハッシュ ${stateHash(sim)}\`)`。`stateHash` は `tools/state-hash.mjs` から、`Sim` は `src/sim/index.js` から import する。知らない variant 名は `getVariant` の例外メッセージを stderr に出して exit 1
- **対象**: `tools/scaling/variants.mjs`, `tools/scaling/variant-hash.mjs`
- **要件**: R3
- **参照ファイル**:
  - `tools/scaling/variants.mjs:1-30`(変更対象。onCreatureCollider の使い方)
  - `tools/scaling/variants.mjs:105-125`(変更対象。groups16 の定義)
  - `tools/sim-check.mjs:1-30`(真似る既存実装。Sim の作り方とハッシュの出し方)
- **受け入れ基準**:
  - [ ] `node tools/scaling/variant-hash.mjs hooks` が状態ハッシュ `0e7801998fe70d04` を出す(変更前の sim と一致)
  - [ ] `node tools/scaling/variant-hash.mjs base` と `node tools/scaling/variant-hash.mjs groups16` がどちらも `088bad967edb44ab` を出す
  - [ ] `node tools/scaling/variant-hash.mjs nosuch` が exit 1 で終わり、stderr に「知らない条件」を含む
  - [ ] `node tools/scaling/ab-bench.mjs --variants hooks,base --steps 60 --rounds 1` が exit 0 で終わる
- **依存**: T1

## T3: 別の個体どうしのめり込みを測るツール
- **目的**: ブラウザでの見た目確認の代わりに、別の個体の体節どうしがどれだけ重なっているかを数値で出すツール `tools/scaling/overlap-check.mjs` を作る。T2 の variant `hooks` を変更前として比べる。骨格は次のとおり。
  - 使い方: `node tools/scaling/overlap-check.mjs --variants base,hooks [--steps 9000] [--seed 1] [--every 30] [--out <path>]`。引数の読み方は `tools/scaling/ab-bench.mjs` の `parseArgs` を真似る
  - variant ごとに同じプロセスの中で順に、`new Sim(RAPIER, seed, {})` → `getVariant(name).prepare(sim, RAPIER)` → steps ステップ進める。`every` ステップごとに次の標本を取る
  - 標本: 生きている個体(`c.alive && !c.dead`)のすべての組 i<j のうち、根の体節の位置(`c.pos[0]`)の距離が 3 未満の組について、`a.cols` と `b.cols` のすべての組み合わせで `ca.contactCollider(cb, 0)` を呼ぶ。`null` でないものの `distance` の最小値を `minD` とし、めり込み深さを `pen = minD < 0 ? -minD : 0`(すべて `null` なら 0)とする。`a.id % 16 === b.id % 16` の組を `same`、それ以外を `diff` に分けて pen を集める
  - variant ごとの結果: `same` と `diff` のそれぞれに `{ pairs, over001, over01, p50, p95, max }`。`pairs` は組の数、`over001` は pen > 0.01 の組の数、`over01` は pen > 0.1 の組の数、`p50` `p95` `max` は pen 全体(0 を含む)の値。パーセンタイルは `tools/scaling/variants.mjs` の `percentile` と同じ線形補間で、そのファイルの中に同じ関数を書いてよい
  - 出力: 全体を `{ date, steps, seed, every, results: { <variant>: { same, diff } } }` の JSON にし、`--out` があればそのパスに書く(親ディレクトリは `mkdir -p` 相当で作る)。標準出力には variant ごとに 1 行の要約(`same` と `diff` の pairs・over01・p95・max)を出す
- **対象**: `tools/scaling/overlap-check.mjs`
- **要件**: R4
- **参照ファイル**:
  - `tools/scaling/ab-bench.mjs:1-40`(真似る既存実装。引数の読み方と --out の書き方)
  - `tools/scaling/variants.mjs:27-75`(percentile と、根が近い組を数える samplePairs)
- **受け入れ基準**:
  - [ ] `node tools/scaling/overlap-check.mjs --variants base,hooks --steps 600 --seed 1 --out tools/.tmp/overlap.json` が exit 0 で終わり、`tools/.tmp/overlap.json` の `results.base.same` と `results.hooks.diff` に `pairs` `over001` `over01` `p50` `p95` `max` がそろっている(確かめた後 `tools/.tmp/` は消す)
  - [ ] 同じコマンドの標準出力に、`base` と `hooks` の要約がそれぞれ 1 行ずつ出る
  - [ ] `node tools/scaling/overlap-check.mjs --variants nosuch` が exit 1 で終わる
- **依存**: T2

## T4: 変更前後の計測を実行してデータを保存する
- **目的**: T1〜T3 の仕組みで変更前(`hooks`)と変更後(`base`)を計測し、生データを `docs/plans/scaling-data/` に保存する。コードは変えない。次のコマンドを 1 つずつ順に実行する(並行に走らせない。速さの計測が揺れるため)
  1. `node tools/scaling/run.mjs --variant hooks --steps 27000 --seeds 1,2,3 --out docs/plans/scaling-data/v1impl-hooks.json`(5 分前後)
  2. `node tools/scaling/run.mjs --variant base --steps 27000 --seeds 1,2,3 --out docs/plans/scaling-data/v1impl-base.json`(5 分前後)
  3. `node tools/scaling/ab-bench.mjs --variants hooks,base --steps 1800 --seed 1 --rounds 3 --out docs/plans/scaling-data/v1impl-ab.json`
  4. `node tools/scaling/overlap-check.mjs --variants hooks,base --steps 9000 --seed 1 --out docs/plans/scaling-data/v1impl-overlap.json`
  - 完了報告には `node tools/scaling/summarize.mjs docs/plans/scaling-data/v1impl-hooks.json docs/plans/scaling-data/v1impl-base.json` の出力表、`v1impl-ab.json` の `medians`、overlap-check の標準出力の要約をそのまま貼る
- **対象**: `docs/plans/scaling-data/v1impl-hooks.json`, `docs/plans/scaling-data/v1impl-base.json`, `docs/plans/scaling-data/v1impl-ab.json`, `docs/plans/scaling-data/v1impl-overlap.json`
- **要件**: R2, R3, R4
- **参照ファイル**:
  - `docs/plans/scaling-study.md:80-90`(#18 の V1 で同じ計測をしたときのコマンド)
- **受け入れ基準**:
  - [ ] 4 つの JSON ファイルがすべて作られ、`v1impl-hooks.json` と `v1impl-base.json` の `seeds` が `[1,2,3]`、`steps` が 27000 になっている
  - [ ] `v1impl-ab.json` の `medians` に `hooks` と `base` の `physMs` がある
  - [ ] `v1impl-overlap.json` の `results` に `hooks` と `base` がある
  - [ ] 完了報告に、summarize.mjs の表・`medians`・overlap-check の要約が貼られている
- **依存**: T3

## T5: 結果と採否の判断を検証記録にまとめる
- **目的**: T4 の生データ(T4 の完了報告に要約がある)を `docs/plans/scaling-study.md` にまとめ、採否の判断を書く。あわせて `ARCHITECTURE.md` に衝突グループの仕組みを短く書き足す
  - `docs/plans/scaling-study.md` の「## まとめと提案」の直前に「## V1 の本実装の確認(Issue #22)」の節を足す。中身は次の順にする: 計測日と実行したコマンド(T4 の 4 つ)、生データのパス / 変更前(hooks)と変更後(base)の表(列は V1 の「条件ごとの結果」の表と同じ: 物理 ms・base 比の代わりに hooks 比・個体数・実効種数・食性実効・births・matings・predations・speedP50・broken)/ シードごとの実効種数 / めり込みの表(same と diff ごとの pairs・over001・over01・p95・max、hooks と base)/ 判断
  - 判断は `docs/plans/scaling-study.md:111` の基準で、比べる相手を `hooks` にして書く。すべて基準内なら「採用してよい」、外れた指標があれば外れた指標と値を書き、「採否は利用者が判断する」と書く(実装は戻さない)。めり込みは `same` の `over01`・`max` が `hooks` の値より大きいかどうかを事実として書く
  - 「## まとめと提案」の表の V1 の行と「### 提案」の 2. は書き換えず、新しい節を参照する一文(「本実装後の確認は『V1 の本実装の確認』を参照」)を 2. の末尾に足す
  - `ARCHITECTURE.md` の `body.js` の行の近く(62 行目の姿勢の写しの段落の後)に、1 段落を足す: 体節は個体 id を 16 で割った余りで衝突グループを分けており(`bodyCollisionGroups`)、同じ個体の体節どうしは衝突しない。別の個体でも余りが同じなら衝突しない。接触フックは使っていない(WASM から JS を呼び返す処理が物理の約 14% を占めていたため)。試走用の世界(`founder.js`)だけは従来の設定のまま
- **対象**: `docs/plans/scaling-study.md`, `ARCHITECTURE.md`
- **要件**: R2, R3, R4
- **参照ファイル**:
  - `docs/plans/scaling-study.md:80-120`(変更対象。V1 の節。表の形と基準をそろえる)
  - `docs/plans/scaling-study.md:278-297`(変更対象。まとめと提案)
  - `ARCHITECTURE.md:40-65`(変更対象。sim の各ファイルと姿勢の写しの段落)
- **受け入れ基準**:
  - [ ] `docs/plans/scaling-study.md` に「## V1 の本実装の確認(Issue #22)」の節があり、「## まとめと提案」より前にある
  - [ ] 節の表の数値が `node tools/scaling/summarize.mjs docs/plans/scaling-data/v1impl-hooks.json docs/plans/scaling-data/v1impl-base.json` の出力と `v1impl-ab.json`・`v1impl-overlap.json` の値に一致する
  - [ ] 判断の段落に、基準の各指標(物理 ms の比・個体数・実効種数・食性実効・births・matings・predations・broken)の変化が書かれている
  - [ ] `ARCHITECTURE.md` に `bodyCollisionGroups` を含む段落がある
- **依存**: T4
