# タスク一覧: Issue #26(島モデルを本番に入れる (1/3): Archipelago と移住を src/sim に入れる)

## 要件
- R1: `src/sim/archipelago.js` に `Archipelago` を作る。島の数だけ `Sim` を持ち、全島を同じステップ数だけ進めてから移住を行う。`Sim` は 1 島 = 1 世界のまま変えない。島は 1 スレッドで順に進める
- R2: 移住の処理(移出・移入・由来キー)を `tools/scaling/island-worker.mjs` の `emigrate`・`immigrate` から移す。島 i のシードは `seed * 100 + i`、移住の乱数シードは試作と同じ式にし、島番号の順に処理する
- R3: `src/sim/world-settings.js` に島の数・島の広さ・移住の間隔と人数を足す。島の数が 1 なら今と同じ単一世界になる。既定値は島 4・80 m・1500 ステップごと 2 体
- R4: 島をまたいだ実効種数(`interfertile` と union-find で交配可能な種を束ねる)を `src/sim/diversity.js` に足す
- R5: `src/sim/index.js` から `Archipelago`(と R4 の関数)を公開する
- R6: 島の数 1 の設定で、状態ハッシュが変更前(`npm run check:sim` の `088bad967edb44ab`)と一致する
- R7: 島 4・80 m・1500 ステップごと 2 体で、同じシードなら状態ハッシュが毎回一致する
- R8: `tools/` から群島を回し、交配で束ねた実効種数が #23 の結果(8.5 前後)と同程度になることを確かめる
- R9: sim は DOM に依存しない(依存の向きは今と同じ)

## 前提・解釈
- 設定の項目名は `islands`(島の数。整数 1〜8、既定 4)・`islandSize`(島の一辺 m。80〜160、既定 80)・`migrateEvery`(移住の間隔のステップ数。整数 0〜100000、0 は移住なし、既定 1500)・`migrants`(1 回に各島から移す人数。整数 0〜20、既定 2)とする
- 島の数が 1 のときはシードをそのまま使い、広さは今までどおり `size` を使う(`seed * 100 + i` にしない)。こうすると単一世界の状態ハッシュが今と一致する。島が 2 つ以上のときは、島 i のシードを `seed * 100 + i`、広さを `islandSize` にする。#23 の試作で `--islands 1` を指定したときはシードを 100 倍していたので、その場合とは違う世界になる
- 既定値を島 4 にしても、画面(`src/app/main.js`)は今までどおり `Sim` を直接作るので、ブラウザの見た目は変わらない。`Sim` は増えた設定項目を読まない。画面を群島に切り替えるのは #28 で行う
- `Sim` を直接使う `npm run check:sim` の出力は変わらない。群島の状態ハッシュは新しい `tools/archipelago-check.mjs` で出す。島が 1 つならその島の `stateHash`、島が 2 つ以上なら島ごとのハッシュをカンマでつないだ文字列の sha1 の先頭 16 桁にする(試作の `tools/scaling/island-run.mjs` と同じ式)
- 試作と同じシード・同じ移住の式・同じ処理順にするので、試作と状態ハッシュが一致するはず。計画時に試作で確かめた値は `node tools/scaling/island-run.mjs --steps 3000 --seeds 1 --conditions 1500x2` の出力で `移住 16（捨て 0）`・`ハッシュ 80cdc8d4a3aa0c21`(約 30 秒)。#23 の本計測(`docs/plans/scaling-data/v4check-islands-a.json`、27000 ステップの 1500x2)のハッシュは seed 1 が `ee1b3754a07c3e8a`、seed 2 が `31fe9413e1ba6d50`、seed 3 が `1a1eb71e726f88a9`。交配で束ねた実効種数は 8.82・8.81・7.86 で、平均 8.50
- 移住の処理は試作の `emigrate`・`immigrate` と同じにする。全島から島番号の順に移出したあと、島番号の順に移入する。島 i は島 (i-1+n)%n から受け取る(環状)。移住の乱数シードは、移出が `seed * 1e6 + stepCount + i`、移入が `seed * 1e6 + stepCount + src`(src は送り出した島)。`stepCount` は群島を進めたステップ数
- 交配で束ねる集計は試作の `fertileCounts` と同じにする。各島の種ごとに、生きている個体を id の小さい順に最大 3 体選び、そのゲノムを代表にする。別の島の 2 種で、代表どうしのどれか 1 組が `interfertile` を満たせば同じ種にまとめる(推移的。union-find)。同じ島の種どうしを直接まとめることはしない。由来で束ねる集計(試作の `lineageCounts`)は、#23 で判断に使わなかったので入れない
- 計測(T5)は時間がかかるので、シード 1・2 とシード 3 の 2 回に分ける(子のコマンド実行の上限 10 分に収めるため)

## 対象外
- 島ごとの Worker 化(並行化)。#27 で行う
- 描画・UI での島の切り替えと、タイトル画面への設定欄の追加。#28 で行う
- 由来で束ねた実効種数(試作の `lineageCounts`)の本番化。#23 で判断に使わなかったため

## T1: 世界の設定に島の数・島の広さ・移住の間隔と人数を足す
- **目的**: `src/sim/world-settings.js` の `DEFAULT_SETTINGS` と `normalizeSettings` に、群島の 4 項目を足す。`Sim` はこれらを読まないので、単一世界の振る舞いは変わらない。骨格は次のとおり
  - `DEFAULT_SETTINGS` の末尾(`wetness` の後)に足す。コメントは既存の項目にそろえる
    ```js
    islands: 4,                      // 島の数 1〜8（1 なら単一世界。archipelago.js が読む）
    islandSize: 80,                  // 島が 2 つ以上のときの島の一辺（m）80〜160。島が 1 つなら size を使う
    migrateEvery: 1500,              // 移住の間隔（ステップ）0〜100000。0 は移住なし
    migrants: 2,                     // 1 回の移住で各島から移す人数 0〜20
    ```
  - 整数にそろえる補助関数を `count` の隣に足す: `const int = (v, lo, hi, def) => Math.round(num(v, lo, hi, def));`
  - `normalizeSettings` の戻り値の末尾に足す: `islands: int(p.islands, 1, 8, D.islands)`・`islandSize: num(p.islandSize, 80, 160, D.islandSize)`・`migrateEvery: int(p.migrateEvery, 0, 100000, D.migrateEvery)`・`migrants: int(p.migrants, 0, 20, D.migrants)`
  - `SETTING_PRESETS` は変えない
- **対象**: `src/sim/world-settings.js`
- **要件**: R3
- **参照ファイル**:
  - `src/sim/world-settings.js`(変更対象。`DEFAULT_SETTINGS` と `normalizeSettings`)
- **受け入れ基準**:
  - [ ] `node -e "import('./src/sim/index.js').then(m=>console.log(JSON.stringify(m.normalizeSettings())))"` の出力に `"islands":4,"islandSize":80,"migrateEvery":1500,"migrants":2` が含まれる
  - [ ] `node -e "import('./src/sim/index.js').then(m=>console.log(JSON.stringify(m.normalizeSettings({islands:2.6,islandSize:200,migrateEvery:-5,migrants:30}))))"` の出力に `"islands":3,"islandSize":160,"migrateEvery":0,"migrants":20` が含まれる
  - [ ] `node tools/world-form-check.mjs` の最後の行が `すべて OK` になる
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま変わらない
- **依存**: なし

## T2: 島をまたいだ実効種数(交配で束ねる)を diversity.js に足す
- **目的**: 群島全体の多様性を計算する純粋関数 `computeArchipelagoDiversity(sims)` を `src/sim/diversity.js` に足し、`src/sim/index.js` から公開する。試作 `tools/scaling/island-run.mjs` の `fertileCounts`(union-find)と、`tools/scaling/island-worker.mjs` の `stats()` の代表ゲノムの選び方を移す。`Archipelago` には依存させず、島の `Sim` の配列を受け取る。骨格は次のとおり
    ```js
    import { interfertile } from './speciation.js';
    const SAMPLE = 3; // 種ごとの代表ゲノムの数（生きている個体を id の小さい順に）

    // 群島全体の多様性（純粋関数）。sims は島の Sim の配列（島番号の順）。
    //   effSpecies        … 種を「島番号:種 id」で別の種として数えた実効種数
    //   effSpeciesFertile … 別の島の種どうしを交配可能性で束ねた実効種数
    export function computeArchipelagoDiversity(sims) {
      const groups = [];          // { island, n, genomes }（島ごと・種ごと）
      const dietCounts = new Map();
      let living = 0;
      sims.forEach((sim, island) => {
        const bySp = new Map();   // 種 -> 生きている個体の配列
        for (const c of sim.creatures) {
          if (!isLiving(c)) continue;
          living++;
          // bySp に c を足す。食性は computeDiversity と同じ 3 分類で dietCounts に数える
        }
        for (const members of bySp.values()) {
          members.sort((a, b) => a.id - b.id);
          groups.push({ island, n: members.length, genomes: members.slice(0, SAMPLE).map((c) => c.genome) });
        }
      });
      // union-find：別の島の 2 種で、代表どうしのどれか 1 組が interfertile なら同じ根にまとめる。
      // 同じ島どうしは直接まとめない（fertileCounts と同じ）。根ごとに n を足して fertile（Map）を作る
      return {
        living,
        species: groups.length,
        effSpecies: effFromCounts(/* groups の添字 -> n の Map */),
        effDiet: effFromCounts(dietCounts),
        speciesFertile: fertile.size,
        effSpeciesFertile: effFromCounts(fertile),
      };
    }
    ```
  - 既存の `effFromCounts`(Map を受け取る)と `isLiving` を使う。`computeDiversity` は変えない
  - `src/sim/index.js` の `export { computeDiversity } from './diversity.js';` を `export { computeDiversity, computeArchipelagoDiversity } from './diversity.js';` にする
- **対象**: `src/sim/diversity.js`, `src/sim/index.js`
- **要件**: R4, R5
- **参照ファイル**:
  - `src/sim/diversity.js`(変更対象。`effFromCounts` と `computeDiversity` の食性の分類)
  - `src/sim/index.js`(変更対象。公開窓口)
  - `tools/scaling/island-run.mjs:89-112`(移す元の `fertileCounts`)
  - `tools/scaling/island-worker.mjs:38-61`(代表ゲノムの選び方 `stats()`)
- **受け入れ基準**:
  - [ ] `node -e "import('./src/sim/index.js').then(m=>console.log(typeof m.computeArchipelagoDiversity))"` が `function` を出力する
  - [ ] `src/sim/diversity.js` の import が `./creatures.js` と `./speciation.js` だけである(`grep -n "^import" src/sim/diversity.js` で確かめる)
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま変わらない
- **依存**: なし

## T3: Archipelago と移住を src/sim に入れ、群島の状態ハッシュを出すツールを足す
- **目的**: `src/sim/archipelago.js` に `Archipelago` を作り、`src/sim/index.js` から公開する。移住は `tools/scaling/island-worker.mjs` の `emigrate`・`immigrate` をそのまま移す(選び方・置き方・種の決め方・由来キーを変えない)。T1 の設定項目と T2 の `computeArchipelagoDiversity` を使う。あわせて群島を回して状態ハッシュを出す `tools/archipelago-check.mjs` を足す。試作のファイル(`tools/scaling/`)は変えない。骨格は次のとおり
  - `src/sim/archipelago.js`
    ```js
    // ===== 群島：独立した世界（島 = Sim）を並べ、ときどき少数を移住させる =====
    // 全島を 1 ステップずつ島番号の順に進め、migrateEvery ステップごとに移住を行う。
    // 島番号の順に処理するので、同じシード・同じ設定なら結果は常に同じになる。
    import { Sim } from './sim.js';
    import { makeRng } from './random.js';
    import { cloneGenome } from './genetics.js';
    import { spawnCreature, newSpecies, removeCreature, isLiving } from './creatures.js';
    import { normalizeSettings } from './world-settings.js';

    export class Archipelago {
      // opts.settings: 世界の設定（islands・islandSize・migrateEvery・migrants を含む）
      // opts.profiler: 各島の Sim に渡す計測器（省略可）
      constructor(RAPIER, seed = 1, opts = {}) {
        this.seed = seed;
        this.settings = normalizeSettings(opts.settings);
        this.stepCount = 0;
        this.migrated = 0;   // 移入できた個体の累計
        this.dropped = 0;    // 置き場所が見つからず捨てた個体の累計
        const n = this.settings.islands;
        // 島が 1 つなら今までの単一世界と同じ（シードと size をそのまま使う）
        const islandSettings = n === 1 ? this.settings : { ...this.settings, size: this.settings.islandSize };
        this.islands = [];
        for (let i = 0; i < n; i++) {
          const islandSeed = n === 1 ? seed : seed * 100 + i;
          this.islands.push({ index: i, sim: new Sim(RAPIER, islandSeed, { settings: islandSettings, profiler: opts.profiler }), originKey: new Map() });
        }
      }
      get sims() { return this.islands.map((isl) => isl.sim); }
      step() {
        for (const isl of this.islands) isl.sim.step();
        this.stepCount++;
        const { migrateEvery, migrants } = this.settings;
        if (this.islands.length > 1 && migrateEvery > 0 && migrants > 0 && this.stepCount % migrateEvery === 0) this.migrate();
      }
      // 全島から島番号の順に移出し、そのあと島番号の順に移入する。島 i は島 (i-1+n)%n から受け取る
      migrate() {
        const n = this.islands.length, k = this.settings.migrants, base = this.seed * 1e6 + this.stepCount;
        const out = this.islands.map((isl, i) => emigrate(isl, k, base + i));
        this.islands.forEach((isl, i) => {
          const src = (i - 1 + n) % n;
          const r = immigrate(isl, out[src], base + src);
          this.migrated += r.placed; this.dropped += r.dropped;
        });
      }
      // 島をまたいで同じ系統かを見分けるキー。移住で生まれた種は出身の種のキーを受け継ぐ
      speciesKey(islandIndex, sp) { return speciesKey(this.islands[islandIndex], sp); }
    }

    function speciesKey(isl, sp) { return isl.originKey.get(sp.id) ?? `${isl.index}:${sp.id}`; }
    // emigrate(isl, k, rngSeed) / immigrate(isl, migrants, rngSeed) は island-worker.mjs の同名関数を移す。
    // sim は isl.sim、由来キーは speciesKey(isl, …)、originKey は isl.originKey に置き換える。戻り値は
    // emigrate が移民の配列（{ genome, energyFrac, origin }）、immigrate が { placed, dropped }
    ```
  - `src/sim/index.js` に `export { Archipelago } from './archipelago.js';` を足す
  - `tools/state-hash.mjs` に足す
    ```js
    // 群島の状態ハッシュ。島が 1 つならその島の stateHash と同じ値、2 つ以上なら島ごとのハッシュを
    // カンマでつないだ文字列の sha1 の先頭 16 桁（tools/scaling/island-run.mjs と同じ式）
    export function archipelagoHash(arch) {
      const hs = arch.sims.map(stateHash);
      return hs.length === 1 ? hs[0] : createHash('sha1').update(hs.join(',')).digest('hex').slice(0, 16);
    }
    ```
  - `tools/archipelago-check.mjs`(`tools/sim-check.mjs` を真似る)。使い方は `node tools/archipelago-check.mjs [ステップ数=600] [シード=20261007] [--settings ...]`。`extractSettings` で設定を受け、`new Archipelago(RAPIER, seed, { settings })` を作って `arch.step()` を繰り返し、次の行を出す
    - `seed <シード> / <ステップ数> ステップ / 島 <島の数>（一辺 <m>）/ 移住 <migrateEvery> ステップごと <migrants> 体`
    - `状態ハッシュ  <archipelagoHash(arch)>`(`sim-check` と同じく空白 2 つ)
    - 島ごとに `  島 <i>: 生物 <生きている数> / 植物 <数> / 種 <sim.species.size> / ハッシュ <stateHash(sim)>`
    - `移住 <arch.migrated>（捨て <arch.dropped>）`
    - `computeArchipelagoDiversity(arch.sims)` から `個体数 <living>・実効種数 <effSpecies>・交配で束ねた実効種数 <effSpeciesFertile>（<species> 種 → <speciesFertile> 種）`(実効種数は小数 2 桁)
    - `1 ステップ平均 <ms> ms`(全島の合計)
- **対象**: `src/sim/archipelago.js`, `src/sim/index.js`, `tools/state-hash.mjs`, `tools/archipelago-check.mjs`
- **要件**: R1, R2, R5, R6, R7, R9
- **参照ファイル**:
  - `tools/scaling/island-worker.mjs:19-111`(移す元の `speciesKey`・`emigrate`・`immigrate`)
  - `tools/sim-check.mjs`(真似る確認ツール)
  - `tools/state-hash.mjs`(変更対象。`archipelagoHash` を足す)
  - `src/sim/index.js`(変更対象。公開窓口)
- **受け入れ基準**:
  - [ ] Git Bash で `node tools/archipelago-check.mjs 600 20261007 --settings '{"islands":1}'` を実行すると `状態ハッシュ  088bad967edb44ab` が出る(`npm run check:sim` と同じ値)
  - [ ] `node tools/archipelago-check.mjs 3000 1`(既定の島 4・80 m・1500 ステップごと 2 体)を 2 回実行すると、2 回とも `状態ハッシュ  80cdc8d4a3aa0c21` と `移住 16（捨て 0）` が出る(試作の `island-run.mjs --steps 3000 --seeds 1 --conditions 1500x2` と同じ値。1 回あたり 1 分程度)
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま変わらない
  - [ ] `grep -rnE "document\.|window\.|from 'three'" src/sim` が何も出さない。`src/sim/archipelago.js` の import が `./` で始まるパスだけである
- **依存**: T1, T2

## T4: 群島の多様性を複数シードで長く測るツールを足す
- **目的**: `Archipelago` を長く回し、0.25 年(2250 ステップ)ごとに `computeArchipelagoDiversity` を記録して、末尾 1/3 の区間の中央値をシードごとに出すツール `tools/archipelago-diversity.mjs` を足す。シードは子プロセスで並行に実行する。`package.json` に確認用の npm スクリプトを足す。T3 の `Archipelago`・`archipelagoHash` を使う。骨格は次のとおり
  - 使い方: `node tools/archipelago-diversity.mjs [ステップ数=27000] [シード=1,2,3] [--settings ...] [--out <path>]`。`--out` は `extractSettings` の前に argv から取り除く(値を `out` に入れる)
  - 親: `extractSettings` で設定を受け、シードごとに `spawn(process.execPath, [self, '--child', String(steps), String(seed), JSON.stringify(settings ?? {})])` を起こす(`shell` は使わない)。子の stdout を全部読み、`JSON.parse` して結果にする。子が 0 以外で終わったら stderr を出して `process.exitCode = 1` にする
  - 子(`argv[2] === '--child'`): `await RAPIER.init()`、`new Archipelago(RAPIER, seed, { settings })` を作り、2250 ステップごとに行 `{ year, pop: div.living, species, effSpecies, effDiet, speciesFertile, effSpeciesFertile, msPerStep }` を記録する(`year = done * CFG.DT / CFG.YEAR`、`msPerStep` はその区間の 1 ステップ平均)。最後に `{ seed, steps, hash: archipelagoHash(arch), migrated, dropped, rows }` を `process.stdout.write(JSON.stringify(...))` で出す
  - 集計: シードごとに `year` が `years * 2 / 3 - 1e-6` 以上 `years + 1e-6` 以下の行(`years = steps * CFG.DT / CFG.YEAR`)の中央値を求める(`island-run.mjs` の `summarize` と同じ区間)
  - 出力: シードごとに `seed <s>：ハッシュ <hash>・移住 <migrated>（捨て <dropped>）・個体数 <pop>・実効種数 <effSpecies>・交配で束ねた実効種数 <effSpeciesFertile>・<msPerStep> ms/ステップ`、最後に `平均：個体数 <x>・実効種数 <x>・交配で束ねた実効種数 <x>・<x> ms/ステップ`(値は中央値のシード平均。実効種数は小数 2 桁)
  - `--out` があれば `{ date, steps, seeds, settings: normalizeSettings(settings), runs }`(`runs` は子の結果に `summary`(中央値)を足したもの)を JSON で書き出す(ディレクトリが無ければ作る)
  - `package.json` の `scripts` に `"check:archipelago": "node tools/archipelago-check.mjs"` と `"check:archipelago-diversity": "node tools/archipelago-diversity.mjs"` を足す
- **対象**: `tools/archipelago-diversity.mjs`, `package.json`
- **要件**: R8
- **参照ファイル**:
  - `tools/diversity-check.mjs:1-60`(真似る子プロセスの並行実行と表示)
  - `tools/scaling/island-run.mjs:182-213`(集計の区間 `summarize`)
  - `package.json`(変更対象。npm スクリプト)
- **受け入れ基準**:
  - [ ] `node tools/archipelago-diversity.mjs 2250 1,2` が exit 0 で終わり、`seed 1：ハッシュ`・`seed 2：ハッシュ` で始まる行と `平均：` で始まる行を出す(1 分程度)
  - [ ] `node tools/archipelago-diversity.mjs 2250 1 --out <スクラッチの一時パス>/a.json` で書かれた JSON の `runs[0].rows` が 1 行で、`runs[0].summary.effSpeciesFertile` が数値である(確かめた後に一時ファイルは消す)
  - [ ] `npm run check:archipelago` が `状態ハッシュ` の行を出して exit 0 で終わる
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま変わらない
- **依存**: T3

## T5: 群島を 3 年・シード 1〜3 で測り、#23 の結果と比べて検証記録に書く
- **目的**: T4 のツールで既定の群島(島 4・80 m・1500 ステップごと 2 体)を 27000 ステップ回し、交配で束ねた実効種数と状態ハッシュを #23 の本計測と比べる。結果 JSON を保存し、`docs/plans/scaling-study.md` に節を足す。計測はほかの重い処理と同時に走らせない
  - 計測は 2 回に分ける(1 回を 10 分以内に収めるため。コマンドのタイムアウトは 600000 ms にする)
    - `node tools/archipelago-diversity.mjs 27000 1,2 --out docs/plans/scaling-data/archipelago-26-a.json`(目安 4〜5 分)
    - `node tools/archipelago-diversity.mjs 27000 3 --out docs/plans/scaling-data/archipelago-26-b.json`(目安 8 分)
  - 比べる相手は #23 の本計測(`docs/plans/scaling-data/v4check-islands-a.json` の 1500x2)。ハッシュは seed 1 が `ee1b3754a07c3e8a`、seed 2 が `31fe9413e1ba6d50`、seed 3 が `1a1eb71e726f88a9`。交配で束ねた実効種数は 8.82・8.81・7.86(平均 8.50)
  - `docs/plans/scaling-study.md` の `## まとめと提案` の直前に `## 島モデルの本番化(Issue #26)` の節を足す。中身は計測日と 2 つのコマンド、シードごとの表(列: seed・状態ハッシュ・#23 と一致・個体数・実効種数・交配で束ねた実効種数・ms/ステップ)と 3 シード平均の行、#23 の 8.50 との比較を 2〜4 文で書く。ハッシュが一致しない場合は、その事実と値の差を書く(原因の調査はしない)。ms/ステップは 1 スレッドで全島を回した値で、#23 の CPU 合計 ms/ステップと同じ意味であることを添える
- **対象**: `docs/plans/scaling-study.md`, `docs/plans/scaling-data/archipelago-26-a.json`, `docs/plans/scaling-data/archipelago-26-b.json`
- **要件**: R8
- **参照ファイル**:
  - `docs/plans/scaling-study.md:383-482`(変更対象。#23 の節の書き方を真似る)
- **受け入れ基準**:
  - [ ] `docs/plans/scaling-data/archipelago-26-a.json` の `runs` が seed 1・2 の 2 件、`archipelago-26-b.json` の `runs` が seed 3 の 1 件で、各 `steps` が 27000 である
  - [ ] 3 シードの `summary.effSpeciesFertile` の平均が 7.5 以上 9.5 以下である
  - [ ] `docs/plans/scaling-study.md` に `## 島モデルの本番化(Issue #26)` の節があり、表の 3 シードの値と状態ハッシュが 2 つの JSON の値と一致する
- **依存**: T4

## T6: ARCHITECTURE.md と AGENTS.md に群島と確認ツールを書く
- **目的**: T3・T4 で足した `Archipelago`・`computeArchipelagoDiversity`・設定の 4 項目・確認ツールを文書に書く。コードは変えない
  - `ARCHITECTURE.md` の「sim/ の中身」の表に `archipelago.js` の行(`Archipelago`：島 = `Sim` を並べ、`migrateEvery` ステップごとに移住する。依存は sim・creatures・world-settings)を足し、`diversity.js` の行に `computeArchipelagoDiversity` を足す。`### 多様性の指標` の節の後に `### 群島(archipelago.js)` の小節を足し、島のシードと広さの決め方(島 1 つなら単一世界と同じ)、移住の順序と乱数シードの式、交配で束ねる集計、画面はまだ `Sim` を直接使うこと(#27・#28 で切り替える)を書く
  - `ARCHITECTURE.md` の「動作確認」の節のコマンド例に `npm run check:archipelago` と `npm run check:archipelago-diversity` を足す
  - `AGENTS.md` の「テスト・検証の注意」に 1 項目足す: 群島の確認は `npm run check:archipelago`(`node tools/archipelago-check.mjs <ステップ数> <シード> --settings ...`)、長時間の多様性は `node tools/archipelago-diversity.mjs <ステップ数> <シード,...>`(27000 ステップ・1 シードで目安 4〜8 分)。島の数 1 の設定では `check:sim` と同じハッシュになること
- **対象**: `ARCHITECTURE.md`, `AGENTS.md`
- **要件**: なし
- **参照ファイル**:
  - `ARCHITECTURE.md:35-80`(変更対象。sim/ の中身と多様性の指標)
  - `ARCHITECTURE.md:150-165`(変更対象。動作確認)
  - `AGENTS.md`(変更対象。テスト・検証の注意)
- **受け入れ基準**:
  - [ ] `grep -n "archipelago" ARCHITECTURE.md` が、表の行・`### 群島` の小節・動作確認のコマンド例の 3 か所以上を出す
  - [ ] `grep -n "check:archipelago" AGENTS.md` が 1 行以上を出す
  - [ ] 文書に書いたコマンド名・関数名・設定項目名(`islands`・`islandSize`・`migrateEvery`・`migrants`)が実装と一致する
- **依存**: T3, T4
