# タスク一覧: Issue #23(島モデルの検証: 集計の補正と決定性を確かめ、本番に入れるかを決める(V4))

## 要件
- R1: 群島の実効種数に、島をまたいで同じ種を同じ種として数える集計を足す。(a) 交配可能性で束ねる方法と (b) 移住の由来で束ねる方法の両方を出す
- R2: R1 の集計で、移住そのものの効果を V1 適用後のコードで測り直す(#18 の V4 と同じ 5 条件・seed 1,2,3・27000 ステップ)
- R3: 同じシード・同じ条件で状態ハッシュが毎回一致するかを確かめる(移住の順序や worker の実行順に依存しないか)
- R4: 処理時間を、群島と個体数をそろえた単一世界と比べ直す
- R5: 結果をもとに本番に入れるかを判断し、入れる場合の構成(`src/sim` の世界の持ち方、描画で島をどう見せるか)の案を書く

## 前提・解釈
- (a) 交配可能性で束ねる: 各島の種ごとに、生きている個体を id の小さい順に最大 3 体選んで、そのゲノムを代表とする(`sp.rep` は種ができた時点のゲノムで更新されないため使わない)。別の島の 2 種で、代表どうしのどれか 1 組が `interfertile`(`src/sim/speciation.js`。sim の種分化と同じ判定)を満たせば同じ種にまとめる。まとめは推移的に広がる(union-find)ので、同じ島の 2 種が別の島の種を介して 1 つにまとまることもある。同じ島の種どうしを直接まとめることはしない
- (b) 移住の由来で束ねる: 種に「由来キー」を持たせる。移住で生まれた種(移入先に交配できる種がなく、`newSpecies` で作った種)は、移民が出身の島で属していた種の由来キーを受け継ぐ。それ以外の種(創始集団や、島の中の種分化で生まれた種)は `<島番号>:<種 id>`。同じ由来キーの種を同じ種として数える。各島は別々の創始集団から始まるので、移住なし(0x0)では (b) の値は従来の「島番号:種 id」と同じになる
- 単一世界は `tools/scaling/island-run.mjs --islands 1 --size <広さ>` で測る(島と同じコードで時間を測るため。`run.mjs` は区間ごとの計測(profile)が入るので使わない)。島 i のシードは `seed * 100 + i` なので、単一世界のシードは 100・200・300 になる
- 時間は「CPU 合計 ms/ステップ」(各島の `computeMs` の合計 ÷ ステップ数)で比べる。ms/個体は CPU 合計 ms/ステップ ÷ 個体数。#18 の V4 では 3 シード × 4 島 = 12 worker を 12 論理コアで同時に動かしており、CPU の取り合いで島ごとの時間が長く出た可能性がある。そこで群島の本計測はシードを 1 つずつ順に動かす(`--serial-seeds`、同時に 4 worker)。単一世界は 3 シードを並行に動かす(同時に 3 worker)
- 個体数をそろえる方法: 単一世界を 90・100・110・120・130・140 m で測り、群島の条件ごとに、個体数(シード平均)がいちばん近い広さを比べる相手にする。計画時の試走(2250 ステップ・seed 1)では、80 m × 4 島の個体数は 266〜283、120 m 単一世界は 182 だった。27000 ステップの末尾 1 年では、#18 の V4 の群島が 125.7〜212.3、#22 の 120 m が 177.3
- T1・T2 の受け入れ基準で使う現在の出力を、計画時に確かめた。`node tools/scaling/island-run.mjs --steps 2250 --seeds 1 --conditions 0x0,750x2` の出力は次の 2 行(ms/ステップの値は実行ごとに揺れる)
  - `seed 1・間隔 0・0 体：移住 0（捨て 0）・個体数 283.0・実効種数 24.54・食性実効 2.95・5.442 ms/ステップ`
  - `seed 1・間隔 750・2 体：移住 24（捨て 0）・個体数 266.0・実効種数 31.29・食性実効 2.97・5.463 ms/ステップ`
  - 所要時間はこのコマンドで約 40 秒。`node tools/sim-check.mjs` の状態ハッシュは `088bad967edb44ab`
- 計測(T5〜T8)は時間を測るので、ほかの計測と同時に走らせない。そのため T5〜T8 は 1 本の依存の鎖にしてある
- 判断の基準は T9 の目的欄に書く。最終的な採否は利用者が決める

## 対象外
- `src/sim` への島モデルの組み込み(本番の実装)。採用が決まったら別の Issue にする。この Issue では構成の案を書くところまで行う
- 描画・UI の変更とブラウザでの確認
- 単一世界の広さを、群島の個体数にぴったり合わせて探すこと(6 つの広さから最も近いものを選ぶ)

## T1: 島の worker に、種の代表ゲノム・由来キー・状態ハッシュ・応答の揺らしを足す
- **目的**: `tools/scaling/island-worker.mjs` に、島をまたいだ集計に必要な情報と、決定性を確かめる仕組みを足す。移住の振る舞い(誰を選ぶか・どこに置くか・どの種に入るか)は変えない。骨格は次のとおりで、ここから変えない
  - import に `import { stateHash } from '../state-hash.mjs';` を足す
  - `const { index, seed, size, jitter = false } = workerData;` にする。定数 `const SAMPLE = 3;` と、由来キーの表 `const originKey = new Map(); // 種 id -> 由来キー(移住で生まれた種だけ)` を置く
    ```js
    // 島をまたいで同じ系統かを見分けるキー。移住で生まれた種は出身の種のキーを受け継ぐ
    function speciesKey(sp) {
      return originKey.get(sp.id) ?? `${index}:${sp.id}`;
    }
    ```
  - `stats()` の戻り値に `speciesInfo` を足す(既存の項目は残す)。`bySp` の各種について、生きている個体を id の昇順に並べて先頭 `SAMPLE` 体を選ぶ
    ```js
    const speciesInfo = [];
    for (const [sp, n] of bySp) {
      const members = live.filter((c) => c.species === sp).sort((a, b) => a.id - b.id).slice(0, SAMPLE);
      speciesInfo.push({ id: sp.id, n, key: speciesKey(sp), genomes: members.map((c) => cloneGenome(c.genome)) });
    }
    ```
  - `emigrate` の `migrants` の各要素に `origin: speciesKey(c.species)` を足す(`removeCreature` より前に作る。今の `chosen.map` の位置でよい)
  - `immigrate` で `newSpecies` を呼んだときだけ、その種の由来キーを記録する: `if (!best) { best = newSpecies(sim, m.genome, null, true); originKey.set(best.id, m.origin); }`
  - 新しいメッセージ `{ type: 'hash' }` → `{ hash: stateHash(sim) }` を足す
  - メッセージの受け取りを `async` にし、`jitter` が true のときは処理の前に `await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20)));` で 0〜19 ms 待つ(worker の応答の順を揺らして、結果が実行順に依存しないかを確かめるため。sim の乱数には触れない)
  - 先頭のコメントのメッセージ一覧に `hash` を足し、`stats` の戻り値に `speciesInfo`、`workerData` に `jitter` を書き足す
- **対象**: `tools/scaling/island-worker.mjs`
- **要件**: R1, R3
- **参照ファイル**:
  - `tools/scaling/island-worker.mjs`(変更対象。110 行の全体)
  - `tools/state-hash.mjs`(使う関数 stateHash)
- **受け入れ基準**:
  - [ ] `node tools/scaling/island-run.mjs --steps 2250 --seeds 1 --conditions 0x0,750x2` の出力が、ms/ステップを除いて「前提・解釈」に書いた 2 行と同じになる(個体数 283.0・実効種数 24.54・食性実効 2.95 と、移住 24(捨て 0)・個体数 266.0・実効種数 31.29・食性実効 2.97)
  - [ ] 次の確認用スクリプトを `tools/.tmp/worker-probe.mjs` に書いて `node tools/.tmp/worker-probe.mjs` を 2 回実行すると、2 回とも同じ 1 行の JSON が出る。`keys` はすべて `2:` で始まり、`genomes` の各値は 1〜3、`origins` は 2 つでどちらも `2:` で始まり、`hash` は 16 桁の 16 進数(確かめた後 `tools/.tmp/` は消す)
    ```js
    import { Worker } from 'node:worker_threads';
    const w = new Worker(new URL('../scaling/island-worker.mjs', import.meta.url), { workerData: { index: 2, seed: 102, size: 80 } });
    await new Promise((res) => w.once('message', res)); // ready
    const ask = (m) => new Promise((res) => { const f = (r) => { if (r.id === m.id) { w.off('message', f); res(r); } }; w.on('message', f); w.postMessage(m); });
    await ask({ id: 1, type: 'run', steps: 300 });
    const st = await ask({ id: 2, type: 'stats' });
    const em = await ask({ id: 3, type: 'emigrate', k: 2, rngSeed: 7 });
    const h = await ask({ id: 4, type: 'hash' });
    console.log(JSON.stringify({ keys: st.speciesInfo.map((s) => s.key), genomes: st.speciesInfo.map((s) => s.genomes.length), origins: em.migrants.map((m) => m.origin), hash: h.hash }));
    await w.terminate();
    ```
  - [ ] `node tools/sim-check.mjs` の状態ハッシュが `088bad967edb44ab` のまま(sim 本体は変えていない)
- **依存**: なし

## T2: 群島の集計に、交配可能性・由来で束ねた実効種数、CPU 合計時間、状態ハッシュを足す
- **目的**: T1 の worker が返す `speciesInfo` と `hash` を使い、`tools/scaling/island-run.mjs` の集計を広げる。移住の手順と既存の集計値は変えない。骨格は次のとおりで、ここから変えない
  - `src/sim/index.js` に `export { interfertile } from './speciation.js';` を足し、`island-run.mjs` は `import { CFG, interfertile } from '../../src/sim/index.js';` で使う。`import { createHash } from 'node:crypto';` も足す
  - 引数に `--serial-seeds`(値なし。`out.serialSeeds = true`)と `--jitter`(値なし。`out.jitter = true`)を足す。`--jitter` は `spawnIsland` の `workerData` に `jitter: true` として渡す。先頭の使い方のコメントにも 2 つを書き足す
  - 島をまたいだまとめの関数を足す
    ```js
    // (a) 交配可能性: 別の島の種どうしで、代表ゲノムのどれか 1 組が交配できれば同じ種にまとめる(推移的)
    function fertileCounts(statsList) {
      const groups = [];
      statsList.forEach((st, i) => { for (const s of st.speciesInfo) groups.push({ island: i, n: s.n, genomes: s.genomes }); });
      const parent = groups.map((_, i) => i);
      const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      for (let a = 0; a < groups.length; a++) {
        for (let b = a + 1; b < groups.length; b++) {
          if (groups[a].island === groups[b].island || find(a) === find(b)) continue;
          if (groups[a].genomes.some((ga) => groups[b].genomes.some((gb) => interfertile(ga, gb)))) parent[find(a)] = find(b);
        }
      }
      const counts = new Map();
      groups.forEach((g, i) => { const r = find(i); counts.set(r, (counts.get(r) || 0) + g.n); });
      return [...counts.values()];
    }
    // (b) 移住の由来: 同じ由来キーの種を同じ種として数える
    function lineageCounts(statsList) {
      const counts = new Map();
      for (const st of statsList) for (const s of st.speciesInfo) counts.set(s.key, (counts.get(s.key) || 0) + s.n);
      return [...counts.values()];
    }
    ```
  - `buildRow` の `archipelago` に次を足す: `speciesFertile`(fertileCounts の要素数)、`effSpeciesFertile`(`effFromCounts(fertileCounts(...))`)、`speciesLineage`、`effSpeciesLineage`(lineageCounts で同様)、`cpuMsPerStep`(`computeList` の `computeMs` の合計 ÷ `stepsRun`)、`cpuMsPerIndividual`(`pop > 0 ? cpuMsPerStep / pop : 0`)。行の JSON にゲノムは入れない
  - `summarize` に、区間の行の中央値として `speciesFertile` `effSpeciesFertile` `speciesLineage` `effSpeciesLineage` `cpuMsPerStep` `cpuMsPerIndividual` を足す。さらに `islandEffSpecies` と `islandPop` を足す: 島 i ごとに区間の行の `islands[i].effSpecies`(または `pop`)の中央値を求め、島について平均した値
  - `runOne` の最後(`summary` を作る前)に `const hashes = (await Promise.all(workers.map((w) => w.ask('hash')))).map((m) => m.hash);` を取り、戻り値に `hashes` と `hash: createHash('sha1').update(hashes.join(',')).digest('hex').slice(0, 16)` を足す
  - 条件ごとの実行: `serialSeeds` なら `for (const seed of seeds)` で 1 シードずつ `await runOne(...)` し、そうでなければ今の `Promise.all` のまま
  - 1 行の出力は今の行の末尾(`ms/ステップ` の後)に `・交配で束ねた実効種数 ${s.effSpeciesFertile.toFixed(2)}・由来で束ねた実効種数 ${s.effSpeciesLineage.toFixed(2)}・CPU ${s.cpuMsPerStep.toFixed(3)} ms/ステップ・ハッシュ ${r.hash}` を足す(前半は変えない)
  - 結果 JSON の最上位に `serialSeeds: !!args.serialSeeds` と `jitter: !!args.jitter` を足す
- **対象**: `tools/scaling/island-run.mjs`, `src/sim/index.js`
- **要件**: R1, R3, R4
- **参照ファイル**:
  - `tools/scaling/island-run.mjs`(変更対象。266 行の全体)
  - `src/sim/index.js`(変更対象。公開窓口)
  - `src/sim/speciation.js:6-9`(使う関数 interfertile)
- **受け入れ基準**:
  - [ ] `node tools/scaling/island-run.mjs --steps 2250 --seeds 1 --conditions 0x0,750x2 --out tools/.tmp/a.json` の 2 行の前半(ms/ステップまで)が「前提・解釈」の値と同じで、後半に交配・由来で束ねた実効種数・CPU・ハッシュが出る
  - [ ] 同じコマンドに `--jitter` を付けたとき(出力先は `tools/.tmp/j.json`)と `--serial-seeds` を付けたとき(`tools/.tmp/s.json`)も、条件ごとのハッシュが 1 つ目と同じになる
  - [ ] `tools/.tmp/a.json` の 0x0 の `summary` で `effSpeciesLineage` が `effSpecies` と等しく、どちらの条件でも `effSpeciesFertile` が `effSpecies` 以下で、`cpuMsPerStep` `cpuMsPerIndividual` `islandEffSpecies` `islandPop` が正の数
  - [ ] `node tools/scaling/island-run.mjs --islands 1 --size 90 --steps 2250 --seeds 1 --out tools/.tmp/one.json` が exit 0 で終わり、その `summary` の `effSpeciesFertile` が `effSpecies` と等しい(確かめた後 `tools/.tmp/` は消す)
  - [ ] `node tools/sim-check.mjs` の状態ハッシュが `088bad967edb44ab` のまま
- **依存**: T1

## T3: 群島と単一世界の結果を表にまとめるツール
- **目的**: T2 の結果 JSON を読み、検証記録に貼る 3 つの表を出すツール `tools/scaling/island-summary.mjs` を作る。骨格は次のとおりで、ここから変えない
  - 使い方: `node tools/scaling/island-summary.mjs <json...>`。最上位の `islands` が 1 のファイルを単一世界(`size` で区別)、2 以上のファイルを群島(各 `runs[]` の `${interval}x${migrants}` で条件を区別)として扱う
  - 値は各 run の `summary` を使い、同じ条件(単一世界は同じ広さ)の run について平均する(シード平均)
  - 表 1「群島」(条件は最初に現れた順): `| 条件 | 群島 実効種数(島:種) | 交配で束ねる | 0x0 比 | 由来で束ねる | 島平均 実効種数 | 群島 個体数 | 島平均 個体数 | CPU ms/ステップ | CPU ms/個体 | 壁 ms/ステップ |`。列の値はそれぞれ `effSpecies` `effSpeciesFertile` (effSpeciesFertile ÷ 0x0 の effSpeciesFertile) `effSpeciesLineage` `islandEffSpecies` `pop` `islandPop` `cpuMsPerStep` `cpuMsPerIndividual` `msPerStep`。0x0 が無ければ「0x0 比」は `-`
  - 表 2「単一世界」(広さの昇順): `| 広さ | 個体数 | 実効種数 | CPU ms/ステップ | CPU ms/個体 |`(`pop` `effSpecies` `cpuMsPerStep` `cpuMsPerIndividual`)
  - 表 3「個体数をそろえた比較」: 群島の条件ごとに、個体数(シード平均の `pop`)の差の絶対値が最も小さい単一世界を選ぶ(同じなら広さが小さい方)。列は `| 条件 | 群島 個体数 | 単一世界 | 実効種数 群島(交配) | 実効種数 単一 | 比 | CPU ms/ステップ 群島 | CPU ms/ステップ 単一 | 比 | CPU ms/個体 群島 | CPU ms/個体 単一 | 比 |`。「単一世界」欄は `110 m(152.3 体)` の形。比は群島 ÷ 単一
  - 数値の桁: 実効種数・個体数は小数 1 桁、ms/ステップは 2 桁、ms/個体は 3 桁、比は 2 桁
  - 表の前にそれぞれ `### 群島` `### 単一世界` `### 個体数をそろえた比較` の見出し行を出す。群島のファイルが無ければ表 1・3 を、単一世界のファイルが無ければ表 2・3 を出さない。引数が無ければ使い方を stderr に出して exit 1
- **対象**: `tools/scaling/island-summary.mjs`
- **要件**: R1, R4
- **参照ファイル**:
  - `tools/scaling/island-run.mjs`(T2 で変えた後の結果 JSON の形。`summarize` と最後の `result`)
  - `tools/scaling/summarize.mjs:44-80`(Markdown の表の出し方を真似る)
- **受け入れ基準**:
  - [ ] 確認用のデータを `node tools/scaling/island-run.mjs --steps 2250 --seeds 1,2 --conditions 0x0,750x2 --out tools/.tmp/arc.json`、`node tools/scaling/island-run.mjs --islands 1 --size 90 --steps 2250 --seeds 1,2 --out tools/.tmp/s90.json`、同じく `--size 120` で `tools/.tmp/s120.json` を作り、`node tools/scaling/island-summary.mjs tools/.tmp/arc.json tools/.tmp/s90.json tools/.tmp/s120.json` を実行すると、3 つの見出しと表が出る。表 1 は 2 行(0x0 の「0x0 比」は 1.00)、表 2 は 2 行(90 と 120)、表 3 は 2 行
  - [ ] 表 1 の 0x0 の「群島 実効種数(島:種)」が、`arc.json` の 0x0 の 2 シードの `summary.effSpecies` の平均を小数 1 桁に丸めた値と一致する
  - [ ] `node tools/scaling/island-summary.mjs tools/.tmp/arc.json` では表 1 だけが出て、引数なしでは exit 1 で終わる(確かめた後 `tools/.tmp/` は消す)
- **依存**: T2

## T4: 決定性を確かめる計測と、ハッシュを比べるツール
- **目的**: 同じシード・同じ条件で状態ハッシュが毎回一致するかを確かめる。応答の順を揺らした場合(`--jitter`)と、シードを順に動かした場合(`--serial-seeds`)も比べる(この 2 つは 1 本の計測にまとめる)。手順は次のとおり
  1. ツール `tools/scaling/island-hash-compare.mjs` を作る。使い方は `node tools/scaling/island-hash-compare.mjs <json...>`。各ファイル(island-run.mjs の結果 JSON)の `runs[]` から、キー `${interval}x${migrants}` とシードごとの `hash` を集める。出力は Markdown の表 `| 条件 | シード | <ファイル名 1> | <ファイル名 2> | ... | 結果 |`(ファイル名はパスの最後の部分。行はキーの最初に現れた順、その中でシードの昇順)。値が無いファイルは `-` とする。全ファイルで同じ値なら「結果」は `一致`、違う値か `-` があれば `不一致`。表の後に、すべて一致なら `すべて一致`、そうでなければ `不一致 N 件` の 1 行を出し、不一致があれば exit 1、なければ exit 0。引数が無ければ使い方を stderr に出して exit 1
  2. 次の 3 つを 1 つずつ順に実行する(1 本 2〜4 分)
     - `node tools/scaling/island-run.mjs --steps 9000 --seeds 1,2 --conditions 0x0,1500x8 --out docs/plans/scaling-data/v4check-hash-1.json`
     - 同じコマンドで出力先を `docs/plans/scaling-data/v4check-hash-2.json`
     - 同じコマンドに `--jitter --serial-seeds` を付け、出力先を `docs/plans/scaling-data/v4check-hash-jitter.json`(応答の順を揺らし、シードも順に動かす)
  3. `node tools/scaling/island-hash-compare.mjs` に 3 つのファイルを渡して実行し、出力を完了報告にそのまま貼る。不一致が出ても直さない(exit 1 は計測の結果として扱い、そのまま報告する)
- **対象**: `tools/scaling/island-hash-compare.mjs`, `docs/plans/scaling-data/v4check-hash-1.json`, `docs/plans/scaling-data/v4check-hash-2.json`, `docs/plans/scaling-data/v4check-hash-jitter.json`
- **要件**: R3
- **参照ファイル**:
  - `tools/scaling/island-run.mjs`(T2 で変えた後の結果 JSON の形。runs の `hash`)
- **受け入れ基準**:
  - [ ] 3 つの JSON(`v4check-hash-1.json` `v4check-hash-2.json` `v4check-hash-jitter.json`)が作られ、どれも `runs` が 4 つ(2 条件 × 2 シード)で、各 run に `hash` がある
  - [ ] `node tools/scaling/island-hash-compare.mjs docs/plans/scaling-data/v4check-hash-1.json docs/plans/scaling-data/v4check-hash-1.json` が `すべて一致` を出して exit 0 で終わり、引数なしでは exit 1 で終わる
  - [ ] 完了報告に、手順 3 の出力がそのまま貼られている
- **依存**: T2

## T5: 群島の本計測(前半: 移住なしと 1500 ステップごと)
- **目的**: V1 適用後のコードで、群島の 3 条件を測る。コードは変えない。T3・T4 の後に置くのは、ほかのタスクの試走と同時に走らせず時間の計測を揺らさないためと、T4 で決定性を確かめてから長い計測に入るため。次のコマンドを実行する(25 分前後かかり、その間の出力は 1 条件の 1 シードが終わるごとに 1 行だけ)。10 分出力が無いと打ち切られるため、バックグラウンドで実行し(例: `node tools/scaling/island-run.mjs ... > $TMPDIR/v4a.log 2>&1 &`)、終わるまで 1〜2 分おきに `tail -3` などで進み具合を表示して待つ
  - `node tools/scaling/island-run.mjs --steps 27000 --seeds 1,2,3 --conditions 0x0,1500x2,1500x8 --serial-seeds --out docs/plans/scaling-data/v4check-islands-a.json`
  - 終わったら `node tools/scaling/island-summary.mjs docs/plans/scaling-data/v4check-islands-a.json` を実行し、出力とログの 9 行を完了報告にそのまま貼る
- **対象**: `docs/plans/scaling-data/v4check-islands-a.json`
- **要件**: R2
- **参照ファイル**: なし
- **受け入れ基準**:
  - [ ] `v4check-islands-a.json` が作られ、`steps` が 27000、`serialSeeds` が true、`runs` が 9 つ(3 条件 × シード 1,2,3)ある
  - [ ] 完了報告に、island-summary.mjs の出力とログの 9 行がそのまま貼られている
- **依存**: T3, T4

## T6: 群島の本計測(後半: 6000 ステップごと)
- **目的**: T5 の続きで、残りの 2 条件を測る。コードは変えない。T5 と同じく、バックグラウンドで実行して進み具合を表示しながら待つ(15 分前後)
  - `node tools/scaling/island-run.mjs --steps 27000 --seeds 1,2,3 --conditions 6000x2,6000x8 --serial-seeds --out docs/plans/scaling-data/v4check-islands-b.json`
  - 終わったら `node tools/scaling/island-summary.mjs docs/plans/scaling-data/v4check-islands-a.json docs/plans/scaling-data/v4check-islands-b.json` を実行し、出力とログの 6 行を完了報告にそのまま貼る
- **対象**: `docs/plans/scaling-data/v4check-islands-b.json`
- **要件**: R2
- **参照ファイル**: なし
- **受け入れ基準**:
  - [ ] `v4check-islands-b.json` が作られ、`steps` が 27000、`serialSeeds` が true、`runs` が 6 つ(2 条件 × シード 1,2,3)ある
  - [ ] island-summary.mjs の表 1 に 5 条件(0x0・1500x2・1500x8・6000x2・6000x8)の行がある
  - [ ] 完了報告に、island-summary.mjs の出力とログの 6 行がそのまま貼られている
- **依存**: T5

## T7: 単一世界の計測(90・100・110 m)
- **目的**: 群島と個体数をそろえて比べるため、単一世界を 3 つの広さで測る。コードは変えない。次の 3 つを 1 つずつ順に実行する(合わせて 10 分前後。T5 と同じく、バックグラウンドで実行して進み具合を表示しながら待つ)
  - `node tools/scaling/island-run.mjs --islands 1 --size 90 --steps 27000 --seeds 1,2,3 --out docs/plans/scaling-data/v4check-single-90.json`
  - 同じコマンドで `--size 100`、出力先 `docs/plans/scaling-data/v4check-single-100.json`
  - 同じコマンドで `--size 110`、出力先 `docs/plans/scaling-data/v4check-single-110.json`
  - 終わったら `node tools/scaling/island-summary.mjs` に 3 つのファイルを渡して実行し、出力を完了報告にそのまま貼る
- **対象**: `docs/plans/scaling-data/v4check-single-90.json`, `docs/plans/scaling-data/v4check-single-100.json`, `docs/plans/scaling-data/v4check-single-110.json`
- **要件**: R4
- **参照ファイル**: なし
- **受け入れ基準**:
  - [ ] 3 つの JSON が作られ、どれも `islands` が 1、`steps` が 27000、`runs` が 3 つ(シード 1,2,3)ある
  - [ ] 完了報告に、island-summary.mjs の出力(表 2 に 90・100・110 の 3 行)がそのまま貼られている
- **依存**: T6

## T8: 単一世界の計測(120・130・140 m)
- **目的**: T7 の続きで、残りの 3 つの広さを測る。コードは変えない。進め方は T7 と同じ(合わせて 15 分前後)
  - `node tools/scaling/island-run.mjs --islands 1 --size 120 --steps 27000 --seeds 1,2,3 --out docs/plans/scaling-data/v4check-single-120.json`
  - 同じコマンドで `--size 130`、出力先 `docs/plans/scaling-data/v4check-single-130.json`
  - 同じコマンドで `--size 140`、出力先 `docs/plans/scaling-data/v4check-single-140.json`
  - 終わったら、群島と単一世界の 8 つのファイルすべて(`v4check-islands-a.json` `v4check-islands-b.json` `v4check-single-90.json` 〜 `v4check-single-140.json`)を `node tools/scaling/island-summary.mjs` に渡して実行し、出力を完了報告にそのまま貼る。群島のどれかの条件の個体数が、単一世界の 6 つの個体数の範囲(最小〜最大)の外にあれば、その条件を完了報告に書く(広さは足さない)
- **対象**: `docs/plans/scaling-data/v4check-single-120.json`, `docs/plans/scaling-data/v4check-single-130.json`, `docs/plans/scaling-data/v4check-single-140.json`
- **要件**: R4
- **参照ファイル**: なし
- **受け入れ基準**:
  - [ ] 3 つの JSON が作られ、どれも `islands` が 1、`steps` が 27000、`runs` が 3 つ(シード 1,2,3)ある
  - [ ] 8 つのファイルでの island-summary.mjs の出力に表 1(5 行)・表 2(6 行)・表 3(5 行)がそろっていて、完了報告にそのまま貼られている
  - [ ] 完了報告に、単一世界の個体数の範囲の外にある群島の条件があるかどうかが書かれている
- **依存**: T7

## T9: 検証の結果と判断を検証記録にまとめる
- **目的**: T4〜T8 の結果(各タスクの完了報告に出力がある)を `docs/plans/scaling-study.md` にまとめ、判断を書く。「## V1 の本実装の確認(Issue #22)」節の後、「## まとめと提案」の直前に「## V4 の検証(Issue #23)」の節を足し、次の順で書く。既存の節の本文は書き換えない
  1. 計測日と実行したコマンド(T4 の 3 つ、T5〜T8 の island-run.mjs)、生データのパス
  2. 集計の方法: 3 つの実効種数の数え方(島:種、交配で束ねる、由来で束ねる。tasks.md の「前提・解釈」の 1〜2 項目めの内容)、CPU 合計 ms/ステップと ms/個体の求め方、群島はシードを順に、単一世界は 3 シード並行で動かしたこと、単一世界は `--islands 1` で測ったこと
  3. `### 決定性`: T4 の比較表と結論
  4. `### 群島` `### 単一世界` `### 個体数をそろえた比較`: 8 つのファイルでの island-summary.mjs の 3 つの表(T8 の完了報告)。#18 の V4 の値(島:種で 7.5〜20.2)と比べて変わった点を 1〜2 文で添える
  5. `### 判断`: 次の規則で書く
     - 決定性: T4 で全条件・全シードが一致なら「保てる」、不一致があれば「保てない」
     - 移住の効果: 条件ごとに「交配で束ねる」の 0x0 比を書き、1.20 以上の条件を「移住の効果あり」とする
     - 単一世界との比較: 表 3 の実効種数の比が 1.20 以上の条件を「多様性に効果あり」とする。CPU ms/ステップの比も条件ごとに書く
     - 由来で束ねた値は参考として 0x0 比を添える(判断には使わない)
     - 総合: 決定性が保て、かつ「多様性に効果あり」の条件が 1 つ以上あり、そのうち CPU ms/ステップの比が 1.50 以下の条件があれば「**本番に入れることを勧める**」とし、その中で「交配で束ねる」が最も高い条件を勧める構成として挙げる。「多様性に効果あり」の条件がすべて CPU 比 1.50 を超えるなら「**条件付き**(島を並行に動かせることが前提)」、決定性が保てないか「多様性に効果あり」の条件が無ければ「**勧めない**」。最後に「最終的な採否は利用者が判断する」と書く
- **対象**: `docs/plans/scaling-study.md`
- **要件**: R2, R3, R4, R5
- **参照ファイル**:
  - `docs/plans/scaling-study.md:199-225`(変更対象。#18 の V4 の節。表の形と書き方を真似る)
  - `docs/plans/scaling-study.md:278-300`(変更対象。#22 の節。計測日・コマンドの書き方を真似る)
  - `.agents/workflow/tasks.md`(「前提・解釈」の集計の方法)
- **受け入れ基準**:
  - [ ] 「## V4 の検証(Issue #23)」が「## V1 の本実装の確認(Issue #22)」の後、「## まとめと提案」の前にあり、目的欄の 1〜5 がこの順で書かれている
  - [ ] 表の数値が、8 つのファイルでの `node tools/scaling/island-summary.mjs` の出力と、3 つのファイルでの `node tools/scaling/island-hash-compare.mjs` の出力に一致する
  - [ ] 判断の結論が目的欄 5 の規則と表の値に合っている
  - [ ] `git diff docs/plans/scaling-study.md` が追加行だけになっている
- **依存**: T4, T8

## T10: 本番に入れる場合の構成案を検証記録に足す
- **目的**: T9 で書いた「## V4 の検証(Issue #23)」節の最後(「## まとめと提案」の前)に「### 本番に入れる場合の構成案」を足し、「### 提案」の 1. の末尾に参照の一文を足す。T9 の判断が「勧めない」の場合も、小見出しの直後に「判断は『勧めない』となったが、今後の検討のために残す」旨の一文を置いて同じ内容を書く。中身は次のとおりで、項目と方針はここから変えない(文は整えてよい)
  - 世界の持ち方: `Sim` は 1 島 = 1 世界のまま変えない。新しい `src/sim/archipelago.js` の `Archipelago` が島の数だけ `Sim` を持ち、全島を同じステップ数だけ進めてから移住を行う。移住の処理(移出・移入・由来キー)は `tools/scaling/island-worker.mjs` の `emigrate`・`immigrate` を移す。島 i のシードは `seed * 100 + i`、移住の乱数シードは試作と同じ式にし、島番号の順に処理して決定性を保つ(T4 の結果を根拠として書く)
  - 並行化: ブラウザでは V2 の Worker 化と組み合わせ、島ごとに Worker を 1 つ持つ。Node の tools では `worker_threads` を使う。どちらでも sim 本体は DOM に依存しない(依存の向きは今と同じ)
  - 設定: `src/sim/world-settings.js` に島の数・島の広さ・移住の間隔と人数を足す。島の数が 1 なら今と同じ単一世界になる。既定値は T9 で勧めた条件(勧める条件が無ければ「未定」)
  - 集計: 島をまたいだ実効種数(交配で束ねる)を `src/sim/diversity.js` に足す
  - 描画: 一度に描くのは 1 島だけにし、ヘッダーの切り替えで見る島を選ぶ。ほかの島は右パネルに島ごとの個体数・種数を表で出し、移住はイベントログで知らせる。理由として、V6 で描画は 2000 体でもボトルネックではないが、V2 の姿勢の転送が 1 島分で済むことを書く
  - Issue の分け方の案: (1) `Archipelago` と移住を `src/sim` に入れる (2) 島ごとの Worker 化 (3) 描画・UI の島の切り替え
  - 「### 提案」の 1. の末尾に「検証の結果は『V4 の検証(Issue #23)』を参照。」を足す。「## まとめと提案」の表は書き換えない
- **対象**: `docs/plans/scaling-study.md`
- **要件**: R5
- **参照ファイル**:
  - `docs/plans/scaling-study.md:146-152`(V2 の判断。Worker 化と転送量)
  - `docs/plans/scaling-study.md:270-277`(V6 の判断。描画の負荷)
  - `docs/plans/scaling-study.md:383-402`(変更対象。まとめと提案)
  - `ARCHITECTURE.md:9-35`(ディレクトリと依存の向き)
- **受け入れ基準**:
  - [ ] 「### 本番に入れる場合の構成案」が「## V4 の検証(Issue #23)」節の中の最後にあり、目的欄の 6 項目(世界の持ち方・並行化・設定・集計・描画・Issue の分け方)がそろっている
  - [ ] 「### 提案」の 1. の末尾に「V4 の検証(Issue #23)」を参照する一文がある
  - [ ] `git diff docs/plans/scaling-study.md` が追加行だけになっている
- **依存**: T9
