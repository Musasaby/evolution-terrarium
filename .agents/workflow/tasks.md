# タスク一覧: Issue #27(島モデルを本番に入れる (2/3): 島ごとに Worker で並行に動かす)

## 要件
- R1: ブラウザでは島ごとに Web Worker を 1 つ持ち、全島を Worker で動かす
- R2: Node の tools では `worker_threads` で島ごとに並行に動かす
- R3: main は全島のステップが終わるのを待ってから移住を指示する。移住は島番号の順に処理し、worker の応答順に依存させない
- R4: 描画に送る姿勢はいま見ている 1 島の分だけにする。ほかの島からは何も送らない(集計の表示は #28)
- R5: Worker で動かしたときの状態ハッシュが、1 スレッドで順に動かしたとき(`Archipelago`)と一致する
- R6: worker の応答順を揺らしても(`--jitter`)、状態ハッシュが変わらない
- R7: 4 島で、壁時間の ms/ステップ が 1 スレッドのときより短くなることを計測して報告する
- R8: ブラウザで等速・8 倍速が動くことを確かめる(ヘッドレスで確かめられない部分はその旨を報告する)
- R9: ブラウザは設定どおりの島の数(既定 4)で群島を動かし、島 0 を表示する。島の数 1 なら今の単一世界と同じ世界になる

## 前提・解釈
- ブラウザは全島を Worker で動かし、主スレッドには「見ている島の写し」(`SimMirror`)を置く。今の描画(`src/render/`)と右パネル(`src/ui/`)は、`Sim` の代わりにこの写しを読む。見る島は島 0 に固定する。切り替えは #28 で行う(利用者に確認済み)
- 島の仕様(シード・設定)・移住の判定・移住の乱数シードは、1 スレッド版と並行版で同じ関数を使う。このため `src/sim/island-host.js` に `IslandHost`(1 島分の `Sim` と由来キー・移出・移入)を切り出し、`Archipelago` もこれを使うように載せ替える(T1。振る舞いは変えないので、ハッシュは変わらない)
- worker とのやり取りは `{ id, type, ...payload }` の要求に `{ id, ...result }`(失敗時は `{ id, error }`)で答える。要求の種類は `init`・`run`・`emigrate`・`immigrate` が共通、Node 専用に `hash`、ブラウザ専用に `frame`・`forceWeather`・`log`。worker は届いた順に 1 つずつ処理する
- 並行版の進め方: 次の移住の区切りまでのステップ数と残りのステップ数の小さいほうを全島に `run` させ、全島の応答を待つ。区切りに着いたら、全島の `emigrate` を待ち、続けて全島の `immigrate` を待つ。島 i は島 (i-1+n)%n の移民を受け取る。乱数シードは 1 スレッド版と同じ(移出は `seed * 1e6 + stepCount + i`、移入は `seed * 1e6 + stepCount + src`)。各島の処理は他の島に依存しないので、応答順が揺れても結果は変わらない
- 計画時に 1 スレッド版で確かめた値: `npm run check:sim` は `088bad967edb44ab`。`node tools/archipelago-check.mjs 3000 1` は `状態ハッシュ  80cdc8d4a3aa0c21`・`移住 16（捨て 0）`・`1 ステップ平均 22.25 ms`(約 1 分)。`node tools/archipelago-check.mjs 2000 2 --settings '{"migrateEvery":700,"migrants":3}'` は `状態ハッシュ  44622908485396e4`・`移住 24（捨て 0）`。`--settings '{"islands":1}'` の 600 ステップ・シード 20261007 は `088bad967edb44ab`
- 写しへの送り方: 見ている島の worker は毎フレームの `frame` 要求に「生きている(`alive`)個体の id・死骸かどうか・体節の姿勢(Float32Array を transfer)・気候・時刻・はじめて送る個体と種の静的な情報」を返す。250 ms ごとに、種の一覧・植物・統計・出来事・地形(変わったときだけ)・選択中の個体の詳細なども足して返す(`panels`)。ほかの島には `frame` を送らない
- ブラウザの進め方は今の `SimRunner` の規則(1 フレームの予算 22 ms・最大速度 30 ms・遅れ 0.5 シム秒で捨てる)をまねる。前の要求が終わっていないフレームでは新しい要求を出さず、時間だけ貯める。1 回に進めるステップ数は直前の壁時間から求めた ms/ステップ で予算に収める
- パフォーマンス表示の sim の区間計測は見ている島の worker の値だけを出す
- 「世界を始めました」のログと天候の強制(`forceWeather`)は、見ている島の worker に送る。ブラウザでは今も主スレッドの `Sim` に同じことをしているので、ブラウザでの振る舞いは今と同じ
- 描画・パネルが写しで動くよう、`bodies`(剛体)や `joints` を読んでいる 3 か所を、写しにもある `pos`・`rot`・`nJoints` を読むように変える(T7)
- ブラウザの確認(R8)は子エージェントではできない。T7 の後に親が利用者に依頼するか、確かめられなかった旨を報告する
- 計測(R7)は Node の `worker_threads` で行う(T3)。ブラウザでの fps は R8 の確認で目で見る

## 対象外
- 見る島の切り替え・島ごとの個体数と種数の表・群島全体の実効種数・移住のイベントログの表示。#28 で行う
- タイトル画面への島の数などの設定欄の追加。#28 以降で行う
- 試作のファイル(`tools/scaling/`・`tools/bench/`)の変更。残しておく

<!-- グループ node-parallel: Node の worker_threads で島を並行に動かし、ハッシュの一致と速さを確かめる -->

## T1: IslandHost を切り出し、Archipelago をそれに載せ替える
- **目的**: 1 スレッド版と並行版で同じ処理を使うため、1 島分の処理を `src/sim/island-host.js` の `IslandHost` に移す。`Archipelago` は `IslandHost` を並べるだけにする。振る舞いは変えない(リファクタリング)。骨格は次のとおり
  - `src/sim/island-host.js`(新規。`archipelago.js` の `speciesKey`・`emigrate`・`immigrate` の本体をそのまま移す)
    ```js
    // ===== 1 つの島：Sim と由来キーを持ち、移出・移入を行う（1 スレッド版と Worker 版で共通） =====
    import { Sim } from './sim.js';
    import { makeRng } from './random.js';
    import { cloneGenome } from './genetics.js';
    import { spawnCreature, newSpecies, removeCreature, isLiving } from './creatures.js';
    import { normalizeSettings } from './world-settings.js';

    // 島ごとの { index, seed, settings }。島が 1 つなら今までの単一世界と同じ（シードと size をそのまま使う）
    export function islandSpecs(seed, settings) {
      const s = normalizeSettings(settings), n = s.islands;
      const islandSettings = n === 1 ? s : { ...s, size: s.islandSize };
      return Array.from({ length: n }, (_, i) => ({ index: i, seed: n === 1 ? seed : seed * 100 + i, settings: islandSettings }));
    }
    // stepCount ステップ進めた直後に移住するか（settings は normalizeSettings 済み）
    export function isMigrationStep(settings, stepCount) {
      return settings.islands > 1 && settings.migrateEvery > 0 && settings.migrants > 0 && stepCount % settings.migrateEvery === 0;
    }
    // 次に移住するまでのステップ数。移住しない設定なら Infinity
    export function stepsToNextMigration(settings, stepCount) {
      if (!(settings.islands > 1 && settings.migrateEvery > 0 && settings.migrants > 0)) return Infinity;
      return settings.migrateEvery - (stepCount % settings.migrateEvery);
    }
    // 移住の乱数シード。移出は自分の島番号、移入は送り出した島の番号を island に渡す
    export function migrationSeed(seed, stepCount, island) { return seed * 1e6 + stepCount + island; }
    // 島 i が移民を受け取る島（環状）
    export function migrationSource(i, n) { return (i - 1 + n) % n; }

    export class IslandHost {
      // spec: islandSpecs の要素。opts.profiler: Sim に渡す計測器（省略可）
      constructor(RAPIER, spec, opts = {}) {
        this.index = spec.index;
        this.sim = new Sim(RAPIER, spec.seed, { settings: spec.settings, profiler: opts.profiler });
        this.originKey = new Map();
      }
      run(steps) { for (let i = 0; i < steps; i++) this.sim.step(); }
      // 島をまたいで同じ系統かを見分けるキー。移住で生まれた種は出身の種のキーを受け継ぐ
      speciesKey(sp) { return this.originKey.get(sp.id) ?? `${this.index}:${sp.id}`; }
      emigrate(k, rngSeed) { /* archipelago.js の emigrate と同じ。戻り値は移民の配列（{ genome, energyFrac, origin }） */ }
      immigrate(migrants, rngSeed) { /* archipelago.js の immigrate と同じ。戻り値は { placed, dropped } */ }
    }
    ```
  - `src/sim/archipelago.js`: 先頭のコメントは残す。import は `./island-host.js` と `./world-settings.js` だけにする。コンストラクタは `this.islands = islandSpecs(seed, this.settings).map((spec) => new IslandHost(RAPIER, spec, { profiler: opts.profiler }))`。`step()` は全島の `isl.sim.step()` の後に `this.stepCount++`、`isMigrationStep(this.settings, this.stepCount)` なら `this.migrate()`。`migrate()` は `isl.emigrate(k, migrationSeed(this.seed, this.stepCount, i))` を島番号の順に集め、続けて `isl.immigrate(out[src], migrationSeed(this.seed, this.stepCount, src))`(`src = migrationSource(i, n)`)を島番号の順に行う。`speciesKey(islandIndex, sp)` は `this.islands[islandIndex].speciesKey(sp)`。`get sims()`・`migrated`・`dropped` は今のまま
  - `src/sim/index.js` に `export { IslandHost, islandSpecs, isMigrationStep, stepsToNextMigration, migrationSeed, migrationSource } from './island-host.js';` を足す
  - `tools/state-hash.mjs`: 島ごとのハッシュをまとめる式を関数にする。T2 の並行版でも使う
    ```js
    // 島ごとのハッシュ（島番号の順）を 1 つにまとめる。島が 1 つならそのまま
    export function combineIslandHashes(hs) {
      return hs.length === 1 ? hs[0] : createHash('sha1').update(hs.join(',')).digest('hex').slice(0, 16);
    }
    export function archipelagoHash(arch) { return combineIslandHashes(arch.sims.map(stateHash)); }
    ```
- **対象**: `src/sim/island-host.js`, `src/sim/archipelago.js`, `src/sim/index.js`, `tools/state-hash.mjs`
- **要件**: R3, R5
- **参照ファイル**:
  - `src/sim/archipelago.js`(変更対象。移す元の `speciesKey`・`emigrate`・`immigrate`)
  - `src/sim/index.js`(変更対象。公開窓口)
  - `tools/state-hash.mjs`(変更対象。`archipelagoHash`)
- **受け入れ基準**:
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま変わらない
  - [ ] `node tools/archipelago-check.mjs 3000 1` の出力に `状態ハッシュ  80cdc8d4a3aa0c21` と `移住 16（捨て 0）` が含まれる(変更前と同じ。約 1 分)
  - [ ] Git Bash で `node tools/archipelago-check.mjs 2000 2 --settings '{"migrateEvery":700,"migrants":3}'` の出力に `状態ハッシュ  44622908485396e4` と `移住 24（捨て 0）` が含まれる(変更前と同じ)
  - [ ] `src/sim/archipelago.js` に `makeRng`・`spawnCreature` の文字列が無い(`grep -c "makeRng\|spawnCreature" src/sim/archipelago.js` が `0`)
- **依存**: なし

## T2: 島を worker_threads で並行に動かす ParallelArchipelago と確認ツールの --workers を足す
- **目的**: 島ごとの worker に要求を送って群島を進める `ParallelArchipelago` を `src/sim/parallel-archipelago.js` に作る。worker 側の共通の処理 `runIslandRequest` も同じファイルに置く。Node 用の worker `tools/island-thread.mjs` を足し、`tools/archipelago-check.mjs` に `--workers` と `--jitter` を足す。T1 の `IslandHost`・`islandSpecs`・`isMigrationStep`・`stepsToNextMigration`・`migrationSeed`・`migrationSource`・`combineIslandHashes` を使う。`src/sim/parallel-archipelago.js` は worker の API(`worker_threads`・`Worker`)を知らない(送受信の関数を受け取る)。骨格は次のとおり
  - `src/sim/parallel-archipelago.js`(新規)
    ```js
    // ===== 並行群島：島ごとの worker に要求を送り、全島をそろえて進めてから移住する =====
    // worker の応答順によらず、移住は島番号の順の結果で行うので、結果は 1 スレッド版（Archipelago）と同じになる。
    // worker の API は知らない。送受信の関数を createPort に渡して使う（Node でもブラウザでも動く）。
    import { normalizeSettings } from './world-settings.js';
    import { islandSpecs, isMigrationStep, stepsToNextMigration, migrationSeed, migrationSource } from './island-host.js';

    // post(msg, transfer) で要求を送り、listen(fn) で返信を受ける相手を、ask で問い合わせられるようにする
    export function createPort(post, listen) {
      let seq = 0;
      const pending = new Map();
      listen((m) => {
        const p = pending.get(m?.id); if (!p) return;
        pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error)); else p.resolve(m);
      });
      return {
        ask(type, payload = {}, transfer = []) {
          const id = ++seq;
          return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); post({ id, type, ...payload }, transfer); });
        },
        // worker が落ちたときなどに、待っている要求をすべて失敗にする
        failAll(err) { for (const p of pending.values()) p.reject(err); pending.clear(); },
      };
    }

    // worker 側の共通の要求（run / emigrate / immigrate）。知らない type なら null を返す
    export function runIslandRequest(host, msg) {
      if (msg.type === 'run') { const t0 = performance.now(); host.run(msg.steps); return { computeMs: performance.now() - t0 }; }
      if (msg.type === 'emigrate') return { migrants: host.emigrate(msg.k, msg.rngSeed) };
      if (msg.type === 'immigrate') return host.immigrate(msg.migrants, msg.rngSeed);
      return null;
    }

    export class ParallelArchipelago {
      // ports: 島番号の順の port（createPort の戻り値）。数は settings.islands と同じにする
      constructor(ports, seed, settings) {
        this.ports = ports; this.seed = seed;
        this.settings = normalizeSettings(settings);
        this.specs = islandSpecs(seed, this.settings);
        this.stepCount = 0; this.migrated = 0; this.dropped = 0;
        this.computeMs = this.specs.map(() => 0);   // 島ごとの run の計算時間の累計
      }
      // 各 worker に島を作らせる。戻り値は島ごとの init の返信
      init() { return Promise.all(this.ports.map((p, i) => p.ask('init', { spec: this.specs[i] }))); }
      // n ステップ進める。移住の区切りでいったん止め、全島がそろってから移住する
      async advance(n) {
        while (n > 0) {
          const m = Math.min(n, stepsToNextMigration(this.settings, this.stepCount));
          const rs = await Promise.all(this.ports.map((p) => p.ask('run', { steps: m })));
          rs.forEach((r, i) => { this.computeMs[i] += r.computeMs; });
          this.stepCount += m; n -= m;
          if (isMigrationStep(this.settings, this.stepCount)) await this.migrate();
        }
      }
      // 全島の移出を待ってから、全島に移入させる。島 i は migrationSource(i, n) の移民を受け取る
      async migrate() {
        const n = this.ports.length, k = this.settings.migrants;
        const out = await Promise.all(this.ports.map((p, i) => p.ask('emigrate', { k, rngSeed: migrationSeed(this.seed, this.stepCount, i) })));
        const imm = await Promise.all(this.ports.map((p, i) => {
          const src = migrationSource(i, n);
          return p.ask('immigrate', { migrants: out[src].migrants, rngSeed: migrationSeed(this.seed, this.stepCount, src) });
        }));
        for (const r of imm) { this.migrated += r.placed; this.dropped += r.dropped; }
      }
    }
    ```
  - `src/sim/index.js` に `export { ParallelArchipelago, createPort, runIslandRequest } from './parallel-archipelago.js';` を足す
  - `tools/island-thread.mjs`(新規。Node の worker)
    ```js
    // 群島の 1 島を動かす worker_threads の worker（tools/archipelago-check.mjs --workers から使う）
    // workerData: { jitter }。jitter が true なら、各要求の処理の前に 0〜19 ms 待って応答順を揺らす
    import { parentPort, workerData } from 'node:worker_threads';
    import RAPIER from '@dimforge/rapier3d-compat';
    import { IslandHost, runIslandRequest } from '../src/sim/index.js';
    import { stateHash } from './state-hash.mjs';

    await RAPIER.init();
    let host = null;
    let chain = Promise.resolve();   // 要求は届いた順に 1 つずつ処理する
    parentPort.on('message', (msg) => { chain = chain.then(() => handle(msg)); });

    async function handle(msg) {
      if (workerData?.jitter) await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20)));
      try {
        let result;
        if (msg.type === 'init') { host = new IslandHost(RAPIER, msg.spec); result = {}; }
        else if (msg.type === 'hash') result = { hash: stateHash(host.sim) };
        else result = runIslandRequest(host, msg);
        if (!result) throw new Error(`知らない要求 ${msg.type}`);
        parentPort.postMessage({ id: msg.id, ...result });
      } catch (e) {
        parentPort.postMessage({ id: msg.id, error: String(e?.stack ?? e) });
      }
    }
    ```
  - `tools/archipelago-check.mjs`: `extractSettings` の前に `args` から `--workers` と `--jitter` を取り除いてフラグにする。使い方のコメントに `[--workers] [--jitter]` を足す。`--workers` が無いときは今のまま(出力も変えない)。`--workers` のとき
    - 島の数だけ `new Worker(new URL('./island-thread.mjs', import.meta.url), { workerData: { jitter } })` を作り、`createPort((m, t) => w.postMessage(m, t), (fn) => w.on('message', fn))` で port にする。`w.on('error', (e) => port.failAll(e))` を付ける
    - `arch = new ParallelArchipelago(ports, seed, settings)`、`await arch.init()`。計測は `t0` から `await arch.advance(steps)` までの壁時間
    - 島ごとのハッシュを `await Promise.all(ports.map((p) => p.ask('hash')))` で集め、最後に全 worker を `terminate()` する
    - 出力: 1 行目は今と同じ形式の後ろに `（worker ${n} 個${jitter ? '・応答を揺らす' : ''}）` を付ける。続けて `状態ハッシュ  ${combineIslandHashes(hs)}`、島ごとに `  島 ${i}: ハッシュ ${hs[i]}`、`移住 ${arch.migrated}（捨て ${arch.dropped}）`、`1 ステップ平均 ${壁時間/steps} ms（壁時間。CPU 合計 ${computeMs の合計/steps} ms）`(ms は小数 2 桁)
- **対象**: `src/sim/parallel-archipelago.js`, `src/sim/index.js`, `tools/island-thread.mjs`, `tools/archipelago-check.mjs`
- **要件**: R2, R3, R5, R6
- **参照ファイル**:
  - `tools/archipelago-check.mjs`(変更対象。`--workers` を足す確認ツール)
  - `src/sim/index.js`(変更対象。公開窓口)
  - `src/sim/island-host.js`(T1 で作った `IslandHost` と移住の関数)
  - `tools/scaling/island-run.mjs:47-87`(真似る worker の起こし方と返信の待ち方)
- **受け入れ基準**:
  - [ ] `node tools/archipelago-check.mjs 3000 1 --workers` の出力に `状態ハッシュ  80cdc8d4a3aa0c21` と `移住 16（捨て 0）` が含まれる
  - [ ] `node tools/archipelago-check.mjs 3000 1 --workers --jitter` の出力に `状態ハッシュ  80cdc8d4a3aa0c21` と `移住 16（捨て 0）` が含まれる
  - [ ] Git Bash で `node tools/archipelago-check.mjs 2000 2 --workers --jitter --settings '{"migrateEvery":700,"migrants":3}'` の出力に `状態ハッシュ  44622908485396e4` と `移住 24（捨て 0）` が含まれる
  - [ ] Git Bash で `node tools/archipelago-check.mjs 600 20261007 --workers --settings '{"islands":1}'` の出力に `状態ハッシュ  088bad967edb44ab` が含まれる
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま変わらず、`grep -rnE "worker_threads|document\.|window\.|from 'three'" src/sim` が何も出さない
- **依存**: T1

## T3: 4 島を 1 スレッドと worker で測り、検証記録に書く
- **目的**: T2 の `--workers` を使い、既定の群島(島 4・80 m・1500 ステップごと 2 体)の壁時間の ms/ステップ を 1 スレッドと worker で比べ、`docs/plans/scaling-study.md` に節を足す。コードは変えない
  - 実行するコマンド(順に実行し、同時に走らせない。合計 5 分程度):
    ```
    node tools/archipelago-check.mjs 3000 1
    node tools/archipelago-check.mjs 3000 1 --workers
    node tools/archipelago-check.mjs 3000 2
    node tools/archipelago-check.mjs 3000 2 --workers
    ```
  - `docs/plans/scaling-study.md` の「島モデルの本番化(Issue #26)」の節の後、「まとめと提案」の前に `## 島ごとの Worker 化(Issue #27)` の節を足す。中身は計測日(実行した日)・実行したコマンド・表(列: seed / 方式(1 スレッド・worker 4 個)/ 状態ハッシュ / 壁時間 ms/ステップ / CPU 合計 ms/ステップ。1 スレッドの CPU 合計は壁時間と同じ値)・1 スレッドに対する壁時間の比・状態ハッシュが方式によらず一致したかの結論。#23 の値(壁時間 4.00 ms・CPU 合計 11.23 ms。1500 ごと 2 体)にも触れる。計測時の CPU のコア数(`node -e "console.log(require('os').cpus().length)"`)を書く
- **対象**: `docs/plans/scaling-study.md`
- **要件**: R7
- **参照ファイル**:
  - `docs/plans/scaling-study.md:484-503`(変更対象。真似る直前の節の書き方)
- **受け入れ基準**:
  - [ ] 上の 4 つのコマンドの出力を報告に貼り、シードごとに 1 スレッドと worker の `状態ハッシュ` が一致している(シード 1 は `80cdc8d4a3aa0c21`)
  - [ ] `grep -n "^## 島ごとの Worker 化(Issue #27)" docs/plans/scaling-study.md` が 1 行を出し、その行番号が `grep -n "^## まとめと提案" docs/plans/scaling-study.md` の行番号より小さい
  - [ ] 足した節の表の壁時間 ms/ステップ が、上のコマンドの出力の値と同じである
- **依存**: T2

<!-- グループ browser-worker: ブラウザで全島を Web Worker で動かし、見ている島の写しで描画する -->

## T4: 見ている島の毎フレームの写し(個体・姿勢・気候)を作る
- **目的**: worker 側で `Sim` から毎フレーム送る分を詰める `packFrame` を `src/app/island-snapshot.js` に、主スレッド側でそれを受けて描画・パネルが読む形にする `SimMirror` を `src/app/sim-mirror.js` に作る。Node で写しの中身を確かめる `tools/mirror-check.mjs` を足す。`Climate` を写しで使うため `src/sim/index.js` から公開する。どちらのファイルも DOM・three・worker の API を使わない。骨格は次のとおり
  - `src/sim/index.js` に `export { Climate } from './climate.js';` を足す
  - `src/app/island-snapshot.js`(新規)
    ```js
    // ===== 見ている島の写しに送る中身を詰める（worker 側。DOM・three に依存しない） =====
    export const POSE_STRIDE = 7;   // 1 体節あたり [x, y, z, qx, qy, qz, qw]

    // 写しに送り済みのものを覚えておく（worker ごとに 1 つ）
    export function createSentState() {
      return { creatures: new Set(), species: new Set(), terrainVersion: -1, statsLen: -1, statsT: -1, eventsTop: null, eventsLen: -1 };
    }
    // 毎フレーム送る分。生きている（alive）個体の id・死骸か・姿勢と、はじめて送る個体・種の静的な情報
    export function packFrame(sim, sent) {
      const list = sim.creatures.filter((c) => c.alive);
      const ids = new Int32Array(list.length), dead = new Uint8Array(list.length);
      let nParts = 0; for (const c of list) nParts += c.pos.length;
      const poses = new Float32Array(nParts * POSE_STRIDE);
      const born = [], species = [], live = new Set();
      let k = 0;
      list.forEach((c, j) => {
        ids[j] = c.id; dead[j] = c.dead ? 1 : 0; live.add(c.id);
        for (let i = 0; i < c.pos.length; i++) { const p = c.pos[i], r = c.rot[i]; poses[k++] = p.x; poses[k++] = p.y; poses[k++] = p.z; poses[k++] = r.x; poses[k++] = r.y; poses[k++] = r.z; poses[k++] = r.w; }
        if (c.species && !sent.species.has(c.species.id)) { sent.species.add(c.species.id); species.push(speciesData(c.species)); }
        if (!sent.creatures.has(c.id)) { sent.creatures.add(c.id); born.push(creatureStatic(c)); }
      });
      for (const id of sent.creatures) if (!live.has(id)) sent.creatures.delete(id);   // 消えた個体は忘れる
      const packet = { t: sim.t, climate: climateData(sim.climate), ids, dead, poses, born, species };
      return { packet, transfer: [ids.buffer, dead.buffer, poses.buffer] };
    }
    // 個体の生涯変わらない情報
    function creatureStatic(c) {
      return { id: c.id, genome: c.genome, speciesId: c.species?.id ?? null, gen: c.gen, parents: c.parents, born: c.born,
        vol: c.vol, nParts: c.pos.length, nJoints: c.joints.length, maxE: c.maxE, topt: c.topt, tTol: c.tTol, aqua: c.aqua, eff: c.eff, mutations: c.mutations };
    }
    // 種の情報（代表ゲノム rep は送らない）
    export function speciesData(sp) { const { rep, ...rest } = sp; return rest; }
    // 気候の値（関数の rng・log は送れないので外す）
    function climateData(cl) { const { rng, log, ...rest } = cl; return rest; }
    ```
  - `src/app/sim-mirror.js`(新規)
    ```js
    // ===== 見ている島の写し：worker から届いた中身を、描画・パネルが Sim と同じ名前で読めるように持つ =====
    import { Climate, CFG, interfertile } from '../sim/index.js';
    import { POSE_STRIDE } from './island-snapshot.js';

    export class SimMirror {
      // info: worker の init の返信（{ index, seed, size, grid, settings }）。send(msg): 見ている島の worker に要求を送る
      constructor(info, send = () => {}) {
        Object.assign(this, { index: info.index, seed: info.seed, size: info.size, grid: info.grid, settings: info.settings });
        this.send = send;
        this.t = 0; this.climate = null;
        this.creatures = []; this.byId = new Map(); this.species = new Map();
        this.listeners = new Map();
      }
      get year() { return this.t / CFG.YEAR; }
      seasonName() { return Climate.seasonName(this.t); }
      interfertile(a, b) { return interfertile(a, b); }
      on(type, fn) { /* sim.js の on と同じ（解除関数を返す） */ }
      emit(type, payload) { /* sim.js の emit と同じ */ }
      forceWeather(w) { this.send({ type: 'forceWeather', weather: w }); }
      log(msg, kind = 'info') { this.send({ type: 'log', msg, kind }); }
      dispose() { this.listeners.clear(); }
      // packFrame の packet を反映する
      applyFrame(f) {
        this.t = f.t;
        this.climate = Object.assign(Object.create(Climate.prototype), f.climate);
        for (const s of f.species) this.mergeSpecies(s);
        for (const b of f.born) this.byId.set(b.id, makeCreature(b, this.species));
        const next = []; let k = 0;
        for (let j = 0; j < f.ids.length; j++) {
          const c = this.byId.get(f.ids[j]);
          c.alive = true; c.dead = f.dead[j] === 1;
          for (let i = 0; i < c.nParts; i++) { const p = c.pos[i], r = c.rot[i]; p.x = f.poses[k++]; p.y = f.poses[k++]; p.z = f.poses[k++]; r.x = f.poses[k++]; r.y = f.poses[k++]; r.z = f.poses[k++]; r.w = f.poses[k++]; }
          next.push(c);
        }
        // 届かなかった個体は消えた（alive = false）。byId からも外す
        const live = new Set(f.ids);
        for (const c of this.creatures) if (!live.has(c.id)) { c.alive = false; this.byId.delete(c.id); }
        this.creatures = next;
      }
      // 種は同じオブジェクトを使い続ける（個体の species が指したまま値だけ更新する）
      mergeSpecies(s) { const cur = this.species.get(s.id); if (cur) Object.assign(cur, s); else this.species.set(s.id, { ...s }); }
    }
    // 写しの個体。pos/rot は体節の数だけ持つ。energy などは T5 の詳細が届くまで 0
    function makeCreature(b, species) {
      return { ...b, species: species.get(b.speciesId), alive: true, dead: false,
        pos: Array.from({ length: b.nParts }, () => ({ x: 0, y: 0, z: 0 })), rot: Array.from({ length: b.nParts }, () => ({ x: 0, y: 0, z: 0, w: 1 })),
        energy: 0, corpseE: 0, age: 0, children: 0, kills: 0, eaten: 0, crowd: 0, litter: 0, cause: '', cost: { base: 0, move: 0, climate: 0, water: 0, crowd: 0 } };
    }
    ```
  - `tools/mirror-check.mjs`(新規)。使い方は `node tools/mirror-check.mjs [ステップ数=300] [シード=20261007]`。`new Sim(RAPIER, seed)` を作り、`createSentState()` と `new SimMirror({ index: 0, seed, size: sim.size, grid: sim.grid, settings: sim.settings })` を用意する。100 ステップごとに `packFrame` → `structuredClone(packet)` → `mirror.applyFrame` を行い、そのたびに次を照らす。照らすごとに `OK <項目>` か `NG <項目>: <期待> / <実際>` を 1 行出す。最後に NG が無ければ `すべて OK`、あれば `NG が <件数> 件` を出して `process.exitCode = 1`
    - 個体: `sim.creatures.filter(c => c.alive)` と `mirror.creatures` の id の並びが同じ。死骸の数が同じ。各個体の `pos[0]`・`rot[0]` の各成分の差が 1e-4 以下。`species.name` が同じ
    - 気候: `mirror.climate.tempAtHeight(5)` と `sim.climate.tempAtHeight(5)` の差が 1e-6 以下。`mirror.climate.iceAge === sim.climate.iceAge`。`mirror.seasonName() === sim.seasonName()`。`mirror.year === sim.year`
- **対象**: `src/app/island-snapshot.js`, `src/app/sim-mirror.js`, `tools/mirror-check.mjs`, `src/sim/index.js`
- **要件**: R1, R4
- **参照ファイル**:
  - `src/sim/creatures.js:18-46`(個体の持つ値 `makeCreatureState`・`spawnCreature`)
  - `src/sim/climate.js:9-23`(気候の値と `seasonName`・`iceAge`)
  - `src/sim/sim.js:70-80`(真似る `on`・`emit`・`log`)
  - `tools/sim-check.mjs`(真似る確認ツールの形)
  - `src/sim/index.js`(変更対象。`Climate` を公開する)
- **受け入れ基準**:
  - [ ] `node tools/mirror-check.mjs` の最後の行が `すべて OK` になる
  - [ ] `node tools/mirror-check.mjs 600 1` の最後の行が `すべて OK` になる
  - [ ] `grep -nE "from 'three'|document\.|window\.|postMessage" src/app/island-snapshot.js src/app/sim-mirror.js` が何も出さない
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま変わらない
- **依存**: T2

## T5: 写しにパネル用の中身(種・植物・地形・統計・出来事・選択中の個体)を足す
- **目的**: 250 ms ごとに送る分を詰める `packPanels` を `src/app/island-snapshot.js` に、それを受ける `applyPanels` を `SimMirror` に足し、`tools/mirror-check.mjs` で確かめる。T4 の `createSentState`・`speciesData`・`SimMirror` を使う。骨格は次のとおり
  - `src/app/island-snapshot.js` に足す
    ```js
    // 250 ms ごとに送る分。selectedId: 主スレッドで選んでいる個体の id（無ければ null）。sections: 区間計測の値（無ければ null）
    export function packPanels(sim, sent, selectedId, sections) {
      const out = {
        species: [...sim.species.values()].map(speciesData),
        counters: { ...sim.counters }, litters: sim.litters.slice(), physics: sim.physicsCounts(),
        plants: sim.plants.map((p) => ({ id: p.id, spIdx: p.spIdx, x: p.x, y: p.y, z: p.z, size: p.size, rot: p.rot, shapeSeed: p.shapeSeed, energy: p.energy, maxE: p.maxE })),
        stats: null, events: null, terrain: null, selected: null, sections,
      };
      const st = sim.stats, lastT = st.length ? st[st.length - 1].t : -1;
      if (st.length !== sent.statsLen || lastT !== sent.statsT) { out.stats = structuredClone(st); sent.statsLen = st.length; sent.statsT = lastT; }   // 間引かれることがあるので丸ごと送る
      if (sim.events[0] !== sent.eventsTop || sim.events.length !== sent.eventsLen) { out.events = sim.events.map((e) => ({ ...e })); sent.eventsTop = sim.events[0] ?? null; sent.eventsLen = sim.events.length; }
      if (sim.terrainVersion !== sent.terrainVersion) { out.terrain = { version: sim.terrainVersion, H: sim.H.slice(), distWater: sim.distWater.slice(), soil: sim.soil.slice() }; sent.terrainVersion = sim.terrainVersion; }
      const c = selectedId == null ? null : sim.creatures.find((x) => x.id === selectedId && x.alive);
      if (c) out.selected = { id: c.id, energy: c.energy, corpseE: c.corpseE ?? 0, age: c.age, children: c.children, kills: c.kills, eaten: c.eaten, crowd: c.crowd, litter: c.litter ?? 0, cause: c.cause ?? '', cost: { ...c.cost } };
      return out;
    }
    ```
  - `src/app/sim-mirror.js`: コンストラクタに `this.plants = []; this.H = null; this.distWater = null; this.soil = null; this.terrainVersion = -1; this.stats = []; this.counters = { births: 0, deaths: 0, predations: 0, matings: 0, stillborn: 0, rejected: 0 }; this.litters = []; this.events = []; this.physics = {}; this.sections = null;` を足す。`import { PLANT_SPECIES } from '../sim/index.js'` を足す。メソッドを足す
    ```js
    physicsCounts() { return this.physics; }
    // 区間計測を取り出してリセットする（SectionProfiler.take と同じ形 { 名前: { ms, n } }）
    takeSections() { const s = this.sections ?? {}; this.sections = null; return s; }
    // packPanels の中身を反映する
    applyPanels(p) {
      for (const s of p.species) this.mergeSpecies(s);
      this.counters = p.counters; this.litters = p.litters; this.physics = p.physics;
      this.plants = p.plants.map((x) => ({ ...x, sp: PLANT_SPECIES[x.spIdx] }));
      if (p.stats) this.stats = p.stats;
      if (p.terrain) { this.H = p.terrain.H; this.distWater = p.terrain.distWater; this.soil = p.terrain.soil; this.terrainVersion = p.terrain.version; }
      if (p.selected) { const c = this.byId.get(p.selected.id); if (c) Object.assign(c, p.selected); }
      if (p.sections) { /* this.sections に名前ごとに ms と n を足し込む（null なら {} から） */ }
      if (p.events) { this.events = p.events; this.emit('log'); }
    }
    ```
  - `tools/mirror-check.mjs`: 100 ステップごとに、T4 の `packFrame` → `applyFrame` の後で `packPanels(sim, sent, <その時点の生きている個体のうち id が最小のものの id>, null)` → `structuredClone` → `mirror.applyPanels` も行い、次を照らす項目を足す
    - `mirror.species` の id の集合と各種の `name`・`count` が `sim.species` と同じ
    - `mirror.plants.length === sim.plants.length`、先頭の植物の `sp.name`・`energy` が同じ
    - `mirror.H` の長さと全要素が `sim.H` と同じ。`mirror.terrainVersion === sim.terrainVersion`
    - `mirror.stats.length`・`mirror.events.length`・`mirror.litters.length` が同じ。`mirror.counters.births` が同じ。`JSON.stringify(mirror.physicsCounts()) === JSON.stringify(sim.physicsCounts())`
    - 選んだ個体の `energy`・`age`・`cost.base` が写しの個体と同じ
- **対象**: `src/app/island-snapshot.js`, `src/app/sim-mirror.js`, `tools/mirror-check.mjs`
- **要件**: R1
- **参照ファイル**:
  - `src/app/island-snapshot.js`(変更対象。T4 の `packFrame`)
  - `src/app/sim-mirror.js`(変更対象。T4 の `SimMirror`)
  - `tools/mirror-check.mjs`(変更対象。T4 の確認ツール)
  - `src/sim/sim.js:105-135`(写す値の取り出し元 `plants`・`H`・`physicsCounts` など)
- **受け入れ基準**:
  - [ ] `node tools/mirror-check.mjs` の最後の行が `すべて OK` になり、出力に `species`・`plants`・`H`・`stats` を含む `OK` の行がある
  - [ ] `node tools/mirror-check.mjs 600 1` の最後の行が `すべて OK` になる
  - [ ] `grep -nE "from 'three'|document\.|window\.|postMessage" src/app/island-snapshot.js src/app/sim-mirror.js` が何も出さない
- **依存**: T4

## T6: ブラウザの島の Web Worker と、全島を進める IslandRunner を作る
- **目的**: ブラウザで 1 島を動かす module Worker `src/app/island-worker.js` と、主スレッドで全島の Worker を起こしてフレームごとに進める `IslandRunner` を `src/app/island-runner.js` に作る。T2 の `ParallelArchipelago`・`createPort`・`runIslandRequest`・`IslandHost`、T4/T5 の `packFrame`・`packPanels`・`createSentState`・`SimMirror` を使う。`main.js` への配線は T7 で行う。骨格は次のとおり
  - `src/app/island-worker.js`(新規)
    ```js
    // ===== ブラウザで 1 つの島を動かす module Worker =====
    // Worker では import map が効かないため、rapier は index.html の import map と同じ URL を直接読む。
    import RAPIER from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/dist/rapier.mjs';
    import { IslandHost, runIslandRequest, SectionProfiler, NULL_PROFILER } from '../sim/index.js';
    import { packFrame, packPanels, createSentState } from './island-snapshot.js';

    const ready = RAPIER.init();
    const profiler = new SectionProfiler();
    const sent = createSentState();
    let host = null;
    let chain = Promise.resolve();   // 要求は届いた順に 1 つずつ処理する
    self.onmessage = (e) => { chain = chain.then(() => handle(e.data)); };

    async function handle(msg) {
      await ready;
      try {
        let result = null, transfer = [];
        if (msg.type === 'init') {
          host = new IslandHost(RAPIER, msg.spec);
          const s = host.sim;
          result = { info: { index: host.index, seed: s.seed, size: s.size, grid: s.grid, settings: s.settings } };
        } else if (msg.type === 'frame') {
          // msg: { panels: bool, selectedId, profile: bool }
          host.sim.profiler = msg.profile ? profiler : NULL_PROFILER;
          const f = packFrame(host.sim, sent);
          transfer = f.transfer;
          result = { frame: f.packet, panels: msg.panels ? packPanels(host.sim, sent, msg.selectedId ?? null, msg.profile ? profiler.take() : null) : null };
        } else if (msg.type === 'forceWeather') { host.sim.forceWeather(msg.weather); result = {}; }
        else if (msg.type === 'log') { host.sim.log(msg.msg, msg.kind); result = {}; }
        else result = runIslandRequest(host, msg);
        if (!result) throw new Error(`知らない要求 ${msg.type}`);
        self.postMessage({ id: msg.id, ...result }, transfer);
      } catch (err) {
        self.postMessage({ id: msg.id, error: String(err?.stack ?? err) });
      }
    }
    ```
  - `src/app/island-runner.js`(新規)
    ```js
    // ===== ブラウザで群島を進める：島ごとの Worker を起こし、実時間と倍速からフレームごとに進める =====
    // 進め方の規則は sim-runner.js の SimRunner と同じ（予算・最大速度・遅れの捨て方）。
    // 姿勢は見ている島（view）の Worker からだけ受け取り、mirror に反映する。
    import { ParallelArchipelago, createPort, normalizeSettings, CFG } from '../sim/index.js';
    import { SimMirror } from './sim-mirror.js';
    import { SPEED_MAX } from './sim-runner.js';

    const BUDGET_MS = 22, BUDGET_MAX_MS = 30, MAX_BACKLOG = 0.5;
    const PANELS_MS = 250;   // パネル用の中身を取り寄せる間隔（実時間）

    export class IslandRunner {
      // 島の数だけ Worker を起こして島を作り、見ている島の最初の中身を受け取ってから返す
      static async create(seed, settings, view = 0) {
        // workers: new Worker(new URL('./island-worker.js', import.meta.url), { type: 'module' }) を島の数（normalizeSettings(settings).islands）だけ
        // ports: createPort((m, t) => w.postMessage(m, t), (fn) => w.addEventListener('message', (e) => fn(e.data)))
        //        w.addEventListener('error', (e) => port.failAll(new Error(e.message ?? 'Worker のエラー')))
        // arch = new ParallelArchipelago(ports, seed, settings); const infos = await arch.init();
        // mirror = new SimMirror(infos[view].info, (m) => ports[view].ask(m.type, m))
        // runner = new IslandRunner(workers, ports, arch, mirror, view); await runner.fetchFrame(true); return runner
      }
      constructor(workers, ports, arch, mirror, view) {
        Object.assign(this, { workers, ports, arch, mirror, view });
        this.acc = 0; this.busy = false; this.msPerStep = 5; this.lastPanels = -Infinity;
        this.selectedId = null; this.profile = false; this.disposed = false; this.error = null;
      }
      get settings() { return this.arch.settings; }
      reset() { this.acc = 0; }
      // 見ている島の中身を取り寄せて mirror に反映する
      async fetchFrame(panels) {
        const r = await this.ports[this.view].ask('frame', { panels, selectedId: this.selectedId, profile: this.profile });
        this.mirror.applyFrame(r.frame);
        if (r.panels) this.mirror.applyPanels(r.panels);
      }
      // 毎フレーム呼ぶ。dtr: 前フレームからの実時間（秒）。戻り値は計測用 { steps, simSeconds, dropped }
      advance(dtr, speed, { selectedId = null, profile = false } = {}) {
        let dropped = 0, n = 0;
        if (speed > 0 && speed < SPEED_MAX) {
          this.acc += dtr * speed;
          if (this.acc > MAX_BACKLOG) { dropped = this.acc; this.acc = 0; }
        }
        if (this.busy || this.disposed || this.error) return { steps: 0, simSeconds: 0, dropped };
        if (speed >= SPEED_MAX) n = Math.max(1, Math.floor(BUDGET_MAX_MS / this.msPerStep));
        else if (speed > 0) { n = Math.min(Math.floor(this.acc / CFG.DT), Math.max(1, Math.floor(BUDGET_MS / this.msPerStep))); this.acc -= n * CFG.DT; }
        this.selectedId = selectedId; this.profile = profile;
        const now = performance.now(), panels = now - this.lastPanels >= PANELS_MS;
        if (panels) this.lastPanels = now;
        this.busy = true;
        this.arch.advance(n)
          .then(() => { if (n > 0) this.msPerStep = 0.7 * this.msPerStep + 0.3 * Math.max(0.05, (performance.now() - now) / n); return this.fetchFrame(panels); })
          .then(() => { this.busy = false; })
          .catch((err) => { if (!this.disposed) { this.error = err; console.error(err); } });
        return { steps: n, simSeconds: n * CFG.DT, dropped };
      }
      // Worker をすべて止める。待っている要求は失敗にする
      dispose() { this.disposed = true; for (const w of this.workers) w.terminate(); for (const p of this.ports) p.failAll(new Error('世界を閉じました')); this.mirror.dispose(); }
    }
    ```
- **対象**: `src/app/island-worker.js`, `src/app/island-runner.js`
- **要件**: R1, R3, R4, R9
- **参照ファイル**:
  - `src/app/sim-runner.js`(真似る進め方の規則と `SPEED_MAX`)
  - `tools/bench/sim-worker.js`(真似る module Worker の rapier の読み方)
  - `src/sim/parallel-archipelago.js`(T2 の `ParallelArchipelago`・`createPort`・`runIslandRequest`)
  - `src/app/sim-mirror.js`(T4/T5 の `SimMirror`)
- **受け入れ基準**:
  - [ ] `node --check src/app/island-worker.js` と `node --check src/app/island-runner.js` がどちらも何も出さずに exit 0 で終わる
  - [ ] `grep -c "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/dist/rapier.mjs" src/app/island-worker.js index.html` が両方のファイルで `1` 以上を出す
  - [ ] `grep -nE "from 'three'|from 'rapier'|document\." src/app/island-worker.js src/app/island-runner.js` が何も出さない
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま変わらない
- **依存**: T2, T5

## T7: 画面を IslandRunner と写しで動かす
- **目的**: `src/app/main.js` が `Sim` を直接作るのをやめ、T6 の `IslandRunner` で群島を動かし、`runner.mirror`(島 0 の写し)をストアの `sim` に置く。描画・パネルは写しを読む。写しには剛体(`bodies`)と `joints` が無いので、それらを読んでいる 3 か所を `pos`・`rot`・`nJoints` に変える。変更点は次のとおり
  - `src/app/main.js`
    - `import RAPIER from 'rapier'` と `Sim` の import、`rapierReady`・`rapierLoading` を消す。`import { IslandRunner } from './island-runner.js'` を足す。`SimRunner` は使わなくなるので import を `SPEED_MAX` だけにする。モジュールの変数 `let islands = null;`(いまの `IslandRunner`)を持つ
    - `start(seed, settings)`: `$('loading-msg').textContent = '島をつくり、最初の生物を試走させています…'`、`await nextFrame()`。古い世界は `store.set({ sim: null, selected: null, follow: false })` の後に `islands?.dispose(); islands = null;`。`islands = await IslandRunner.create(seed, settings)`、`const sim = islands.mirror`。`world = { seed, settings: islands.settings, label: settingsLabel(islands.settings) }`。`sim.log(...)`・`window.__sim = sim`・`view.attach(sim)`・`panels.attach(sim)`・`showWorldInfo(world)`・`store.set({ sim, world })` は今のまま。`runner.reset()` と `simProfiler.take()` の行は消す
    - ループの 'シム': `if (!islands || !store.get().sim) return;` の後、`const r = islands.advance(dtr, speed, { selectedId: store.get().selected?.id ?? null, profile: store.get().perfOpen });` にする。perf への `add` は今のまま
    - `store.subscribe((s, prev) => { if (s.speed !== prev.speed) runner.reset(); })` を `islands?.reset()` にする
    - `applyPerfVisibility` は `overlay.setVisible(perfOpen)` だけにする(区間計測の切り替えは worker への `profile` で行う)。perf の情報源 `simSections` は `() => store.get().sim?.takeSections() ?? null`。`SectionProfiler`・`NULL_PROFILER`・`simProfiler` の import と変数を消す
    - 起動の最後の `rapierLoading.catch(failLoading)` を消す。`start(...).catch(failLoading)` は残す
  - `src/render/creature-view.js`: `cr.bodies.length` を `cr.pos.length` に、`selected.bodies[0]` を `selected.pos.length` にする
  - `src/render/world-view.js`: `selected.bodies[0]` を `selected.pos.length` に、`selected.bodies[0].translation()` を `selected.pos[0]` にする
  - `src/ui/panels/inspector-panel.js`: `c.joints.length || c.nParts - 1` を `c.nJoints || c.nParts - 1` に。`drawBody` は `if (!c.pos.length) return;`、`const pts = c.pos.map((t, i) => { const ax = qRot(c.rot[i], { x: 0, y: c.genome.parts[i].len / 2, z: 0 }); return { x: t.x, z: t.z, ax: ax.x, az: ax.z, r: c.genome.parts[i].r }; });` にする
- **対象**: `src/app/main.js`, `src/render/creature-view.js`, `src/render/world-view.js`, `src/ui/panels/inspector-panel.js`
- **要件**: R1, R4, R8, R9
- **参照ファイル**:
  - `src/app/main.js`(変更対象。起動とループの配線)
  - `src/render/creature-view.js:36-80`(変更対象。`bodies` を読む箇所)
  - `src/render/world-view.js:30-40`(変更対象。追跡のカメラ)
  - `src/ui/panels/inspector-panel.js:36-40`(変更対象。関節の数)
  - `src/app/island-runner.js`(T6 の `IslandRunner`)
- **受け入れ基準**:
  - [ ] `grep -rnE "\.bodies|\.joints\.|translation\(\)|rotation\(\)" src/render src/ui src/app/main.js` が何も出さない
  - [ ] `grep -nE "from 'rapier'|new Sim\(|SimRunner" src/app/main.js` が何も出さない
  - [ ] `node --check` を `src/app/main.js`・`src/render/creature-view.js`・`src/render/world-view.js`・`src/ui/panels/inspector-panel.js` に実行し、すべて exit 0 で終わる
  - [ ] `node tools/world-form-check.mjs` の最後の行が `すべて OK` になり、`npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま変わらない
  - [ ] 報告に「ブラウザでの確認(`npm run serve` → http://localhost:8000 で等速・8 倍速・個体の選択と追跡・天候の強制・新しい世界)はしていない」旨を書く(親が行う)
- **依存**: T6

## T8: ARCHITECTURE.md と AGENTS.md に Worker 化と確認ツールを書く
- **目的**: T1〜T7 で入れた構成を文書に反映する。コードは変えない
  - `ARCHITECTURE.md`
    - 「sim/ の中身」の表に `island-host.js`(`IslandHost`・`islandSpecs` と移住の判定・乱数シードの関数。1 スレッド版と Worker 版で共通)と `parallel-archipelago.js`(`ParallelArchipelago`・`createPort`・`runIslandRequest`。worker の API を知らず、送受信の関数を受け取る)の行を足す
    - 「群島(`archipelago.js`)」の節の「**画面**」の項目を書き換える: ブラウザは島ごとに Web Worker(`app/island-worker.js`)を持ち、`app/island-runner.js` の `IslandRunner` が全島をそろえて進める。見ている島(いまは島 0)の Worker だけが姿勢(毎フレーム)とパネル用の中身(250 ms ごと)を送り、主スレッドの `app/sim-mirror.js` の `SimMirror` が受ける。描画・パネルは `Sim` の代わりにこの写しを読む。中身を詰めるのは `app/island-snapshot.js`。見る島の切り替えは #28
    - 「剛体の姿勢は写しを読む」の節に、描画・パネルは剛体を持たない写しを読むので `bodies`・`joints` を使わず `pos`・`rot`・`nJoints` を読む、と 1 文足す
    - 「動作確認」の節に `node tools/archipelago-check.mjs 3000 1 --workers [--jitter]`(worker_threads で並行に動かす。1 スレッドと同じハッシュになること)と `node tools/mirror-check.mjs`(写しが `Sim` と同じ値を持つか。最後の行が `すべて OK`)を足す
  - `AGENTS.md` の「テスト・検証の注意」の群島の項目に、`--workers` で worker_threads の並行版になり、1 スレッドと同じハッシュになること・`--jitter` で応答順を揺らしても同じになることを足す。写しの確認は `node tools/mirror-check.mjs` であることを足す
- **対象**: `ARCHITECTURE.md`, `AGENTS.md`
- **要件**: なし
- **参照ファイル**:
  - `ARCHITECTURE.md:35-90`(変更対象。sim/ の表・剛体の姿勢・群島の節)
  - `ARCHITECTURE.md:161-178`(変更対象。動作確認の節)
  - `AGENTS.md:24-36`(変更対象。テスト・検証の注意)
- **受け入れ基準**:
  - [ ] `grep -c "island-host.js\|parallel-archipelago.js\|sim-mirror.js\|island-worker.js" ARCHITECTURE.md` が 4 以上を出す
  - [ ] `grep -c "\-\-workers" ARCHITECTURE.md AGENTS.md` が両方のファイルで 1 以上を出す
  - [ ] `grep -c "mirror-check" ARCHITECTURE.md AGENTS.md` が両方のファイルで 1 以上を出す
- **依存**: T7

## T9: IslandRunner が遅れを消費する前に捨てて止まる不具合と、性能表示の 1 ステップ時間を直す
- **目的**: フレームが遅いブラウザ(ヘッドレスで 8 fps)で 8 倍速にすると、シミュレーションがほとんど進まない(性能表示が「実効 ×0.00 · 1ステップ —」)。原因は `src/app/island-runner.js` の `advance` にある。進めるべき時間 `acc` が `MAX_BACKLOG`(0.5 シム秒)を超えると、ステップ数 `n` を決める**前に** 0 へ捨てている。しかも Worker の応答待ち(`busy`)のフレームでも `acc` が増え続ける。そのため、1 フレームでためる時間が 0.5 秒を超えると、毎回 `n = 0` になる。`SimRunner`(`src/app/sim-runner.js`)と同じく「先に消費し、残りが多すぎたら捨てる」順にする。性能表示の「1ステップ」は main スレッドの 'シム' の時間をステップ数で割っているので、Worker で動かすと実際の 1 ステップ時間を表さない。`IslandRunner` が測っている `msPerStep` を使うように変える。変更点は次のとおり
  - `src/app/island-runner.js` の `advance` を次の流れにする(ほかのメソッドは変えない)
    ```js
    advance(dtr, speed, { selectedId = null, profile = false } = {}) {
      let dropped = 0, n = 0;
      if (speed > 0 && speed < SPEED_MAX) this.acc += dtr * speed;
      if (this.busy || this.disposed || this.error) {
        // 応答待ちの間は遅れを MAX_BACKLOG で頭打ちにする(全部は捨てない)
        if (this.acc > MAX_BACKLOG) { dropped = this.acc - MAX_BACKLOG; this.acc = MAX_BACKLOG; }
        return { steps: 0, simSeconds: 0, dropped, workerMs: 0 };
      }
      if (speed >= SPEED_MAX) n = Math.max(1, Math.floor(BUDGET_MAX_MS / this.msPerStep));
      else if (speed > 0) { n = Math.min(Math.floor(this.acc / CFG.DT), Math.max(1, Math.floor(BUDGET_MS / this.msPerStep))); this.acc -= n * CFG.DT; }
      // 消費した後に、残りが多すぎるときだけ捨てる(SimRunner と同じ順)
      if (this.acc > MAX_BACKLOG) { dropped += this.acc; this.acc = 0; }
      // ここから下(selectedId・profile・panels・busy・arch.advance の then/catch)は今のまま
      ...
      return { steps: n, simSeconds: n * CFG.DT, dropped, workerMs: n * this.msPerStep };
    }
    ```
  - `src/app/main.js` のループの 'シム' で、`perf.add('dropped', r.dropped);` の後に `perf.add('workerMs', r.workerMs);` を足す
  - `src/perf/perf-overlay.js` の `render` の `stepMs` を `const stepMs = steps ? fmtMs((s.counters.workerMs ?? simMs * s.frames) / steps) + ' ms' : '—';` にする(`workerMs` が無い計測では今の計算のまま)
  - 新規 `tools/island-runner-check.mjs`(ブラウザ不要の確認): `IslandRunner` を `new IslandRunner(workers, ports, arch, mirror, 0)` で直接作る。偽物は `workers = []`、`ports = [{ ask: async () => ({ frame: null }) }]`、`mirror = { applyFrame() {}, applyPanels() {}, dispose() {} }`、`arch = { settings: {}, advance: async (n) => { total += n; } }`(`total` は進めたステップの合計)。次の 2 つを確かめ、`OK` / `NG` を 1 行ずつ出し、最後の行に NG が無ければ `すべて OK`、あれば `NG あり` を出して終了コード 1 にする
    1. 応答をすぐ返す場合: `dtr = 0.125`・`speed = 8` で 40 フレーム、毎フレーム `advance` を呼んで `await new Promise(r => setTimeout(r, 0))` で応答を待つ。`total * CFG.DT` が 0 より大きい(直す前は 0 になる)
    2. 応答が 3 フレームに 1 回しか返らない場合: `arch.advance` を、呼ばれたら Promise を配列に積んで返す形にし、3 フレームごとに積んだ Promise を解決してから `setTimeout(0)` を待つ。`dtr = 1 / 60`・`speed = 8` で 180 フレーム(実時間 3 秒・目標 24 シム秒)回して、`total` が 0 より大きい
- **対象**: `src/app/island-runner.js`, `src/app/main.js`, `src/perf/perf-overlay.js`, `tools/island-runner-check.mjs`
- **グループ**: browser-worker
- **要件**: R8
- **参照ファイル**:
  - `src/app/island-runner.js`(変更対象。`advance`)
  - `src/app/sim-runner.js`(真似る消費と捨て方の順)
  - `src/app/main.js:100-107`(変更対象。ループの 'シム')
  - `src/perf/perf-overlay.js:80-96`(変更対象。`stepMs`)
- **受け入れ基準**:
  - [ ] `node tools/island-runner-check.mjs` の最後の行が `すべて OK` になり、終了コード 0 で終わる
  - [ ] `node --check` を `src/app/island-runner.js`・`src/app/main.js`・`src/perf/perf-overlay.js` に実行し、すべて exit 0 で終わる
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま変わらない
  - [ ] 報告に「ブラウザでの確認(等速・8 倍速で年数・気温が進むこと、性能表示の 1 ステップに ms が出ること)はしていない」旨を書く(親が行う)
- **依存**: T7
