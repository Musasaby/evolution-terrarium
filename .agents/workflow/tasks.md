# タスク一覧: Issue #28(島モデルを本番に入れる (3/3): 描画・UI で見る島を切り替える)

## 要件
- R1: 一度に描くのは 1 島だけにし、ヘッダーのセレクトボックスで見る島を選ぶ
- R2: 右パネル(統計タブの先頭)に、ほかの島も含めた島ごとの個体数・種数を表で出す
- R3: 群島全体の実効種数(交配で束ねたもの)を表示する
- R4: 移住が起きたら、各島の記録(イベントログ)にその島の出入り(どの島から何体来て、どの島へ何体出たか)を 1 行で書く
- R5: 島を切り替えたとき、カメラの位置と向きは保ち、選択中の個体と追跡は解除する
- R6: 島の数 1 の設定では今の画面と同じに見える(島の切り替えと群島の節を出さない)
- R7: 島 4 の設定で、切り替えると描画が変わり、右パネルの表と移住のログが更新されることをブラウザで確かめる(`npm run serve` → http://localhost:8000)。ヘッドレスで確かめられない部分はその旨を報告する

## 前提・解釈
- 見る島の切り替えはヘッダーのセレクトボックスで行う。選択肢の表示は 1 始まり(「島 1」〜「島 n」)で、内部の島番号は 0 始まりのまま。移住のログの島番号も 1 始まりで書く(利用者に確認済み)
- 切り替えでカメラは保つ。島が 2 つ以上のときはどの島も広さが `islandSize` で同じなので、視点をそのまま使える。選択中の個体と追跡は別の島の個体なので解除する(利用者に確認済み)
- 切り替えでは主スレッドの写し(`SimMirror`)を新しい島の分に作り直す。新しく見る島の Worker には「送り済み」の記録(`createSentState`)を捨てて、個体・種・地形・統計・出来事をすべて送り直させる(`frame` 要求の `fresh: true`)。前に見ていた島の Worker には区間計測を止めさせる(`profile` 要求)
- 移住のログは主スレッドの `IslandRunner` が文を作り、各島の Worker に既存の `log` 要求で送る。`IslandHost`(Node と共通の移住処理)は変えないので、Node の確認ツールの状態ハッシュは変わらない。文の形は「移住：島 1 から 2 体が移ってきて、島 3 へ 2 体が移っていった」。陸地が見つからず消えた移民がいれば「（1 体は降り立つ陸地が見つからなかった）」を足す。記録の種類(`kind`)は `migrate`(利用者に確認済み)
- 島ごとの表と群島全体の実効種数は、統計タブの先頭に「群島」の節を足して出す。島が 1 つのときは節ごと隠す(利用者に確認済み)
- 群島全体の集計は 2 秒ごとに全島の Worker から「1 島分の集計材料」(個体数・食性の数・種ごとの個体数と代表ゲノム最大 3 つ)を取り寄せ、主スレッドで束ねる。このため `computeArchipelagoDiversity` を「1 島分の材料を作る `islandDiversityGroups`」と「材料を束ねる `combineArchipelagoDiversity`」に分ける(T1。振る舞いは変えない)。計画時の計測で、4 島・1600 ステップの状態で束ねる計算は約 2〜3 ms、材料の複製は約 3 ms だった
- ヘッダーの個体数・種数・天候の強制(`forceWeather`)・「世界を始めました」のログは、今と同じく見ている島のものとする
- 計画時に確かめた値: `npm run check:sim` の状態ハッシュは `088bad967edb44ab`。`node tools/archipelago-check.mjs 1600 1 --settings '{"migrateEvery":700}'`(約 40 秒)は `状態ハッシュ  383fb6b1289aa722`・`移住 16（捨て 0）`・`個体数 282・実効種数 29.91・交配で束ねた実効種数 25.46（48 種 → 36 種）`。同じ引数に `--workers` を付けても `状態ハッシュ  383fb6b1289aa722`。`node tools/island-runner-check.mjs` と `node tools/mirror-check.mjs` の最後の行は `すべて OK`
- ブラウザの確認(R7)は子エージェントではできない。T6 の後に親が利用者に依頼するか、確かめられなかった旨を報告する。島の数 1 の確認は、タイトル画面に欄が無いため、開発者ツールで `localStorage` の `evolution-terrarium:world` の `settings.islands` を 1 にして再読み込みする

## 対象外
- タイトル画面への島の数・島の広さ・移住の設定欄の追加(Issue #28 に書かれていない。別の Issue で行う)
- 全島を同時に描くこと・島を並べて見せること(一度に描くのは 1 島だけ)
- 試作のファイル(`tools/scaling/`・`tools/bench/`)の変更

## T1: 群島の多様性の集計を「1 島分の材料」と「束ねる計算」に分ける
- **目的**: ブラウザでは各島が別の Worker にあるので、`src/sim/diversity.js` の `computeArchipelagoDiversity(sims)` を 2 つの純粋関数に分け、Worker で材料を作り、主スレッドで束ねられるようにする。振る舞いは変えない(リファクタリング)。材料は postMessage で送れる形(Map や個体のオブジェクトを含まない)にする。食性の数は元の実装と同じ順(島番号の順に、はじめて現れた順)で Map に入るよう、`[分類, 数]` の配列で持つ。骨格は次のとおり(union-find 以降は今のコードをそのまま使う)
  ```js
  // 1 島分の集計材料（純粋関数）。postMessage で送れる形にする
  //   living … 生きている個体数。diet … [食性の分類, 数] の配列（はじめて現れた順）
  //   groups … 種ごとの { n: 個体数, genomes: 代表ゲノム（id の小さい順に最大 SAMPLE 個） }（種がはじめて現れた順）
  export function islandDiversityGroups(sim) {
    const bySp = new Map(), diet = new Map();
    let living = 0;
    for (const c of sim.creatures) {
      if (!isLiving(c)) continue;
      living++;
      const members = bySp.get(c.species);
      if (members) members.push(c); else bySp.set(c.species, [c]);
      // 食性ニッチ: diet < 0.25 = 草, < 0.75 = 木の葉, それ以上 = 肉
      const d = c.genome.diet ?? 0.25;
      const cls = d < 0.25 ? 0 : d < 0.75 ? 1 : 2;
      diet.set(cls, (diet.get(cls) || 0) + 1);
    }
    const groups = [];
    for (const members of bySp.values()) {
      members.sort((a, b) => a.id - b.id);
      groups.push({ n: members.length, genomes: members.slice(0, SAMPLE).map((c) => c.genome) });
    }
    return { living, diet: [...diet], groups };
  }
  // 群島全体の多様性（純粋関数）。parts は島番号の順の islandDiversityGroups の戻り値
  export function combineArchipelagoDiversity(parts) {
    const groups = [], dietCounts = new Map();
    let living = 0;
    parts.forEach((p, island) => {
      living += p.living;
      for (const [cls, k] of p.diet) dietCounts.set(cls, (dietCounts.get(cls) || 0) + k);
      for (const g of p.groups) groups.push({ island, n: g.n, genomes: g.genomes });
    });
    // ここから下（union-find・speciesCounts・fertile・戻り値）は今の computeArchipelagoDiversity と同じ
  }
  // sims は島の Sim の配列（島番号の順）。戻り値の意味は今のコメントのとおり
  export function computeArchipelagoDiversity(sims) { return combineArchipelagoDiversity(sims.map(islandDiversityGroups)); }
  ```
  - `src/sim/index.js` の diversity の export に `islandDiversityGroups`・`combineArchipelagoDiversity` を足す
- **対象**: `src/sim/diversity.js`, `src/sim/index.js`
- **要件**: R2, R3
- **参照ファイル**:
  - `src/sim/diversity.js:60-110`(変更対象。今の `computeArchipelagoDiversity`)
  - `src/sim/index.js:13`(変更対象。diversity の export)
  - `tools/archipelago-check.mjs:60-70`(集計を使って表示している箇所)
- **受け入れ基準**:
  - [ ] `node tools/archipelago-check.mjs 1600 1 --settings '{"migrateEvery":700}'`(約 40 秒)が `状態ハッシュ  383fb6b1289aa722` と `個体数 282・実効種数 29.91・交配で束ねた実効種数 25.46（48 種 → 36 種）` を出す(変更前と同じ)
  - [ ] `node -e "import('./src/sim/index.js').then(m => console.log(typeof m.islandDiversityGroups, typeof m.combineArchipelagoDiversity, JSON.stringify(m.combineArchipelagoDiversity([{ living: 2, diet: [[0, 2]], groups: [{ n: 2, genomes: [] }] }, { living: 1, diet: [[2, 1]], groups: [{ n: 1, genomes: [] }] }]))))"` が `function function {"living":3,"species":2,` で始まる 1 行を出す
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま変わらない
- **依存**: なし

## T2: 移住の結果を知らせる onMigrate と、Worker の要求 summary・profile・frame の fresh を足す
- **目的**: T3 の `IslandRunner` が移住のログと群島の表を作れるよう、2 か所を変える。T1 の `islandDiversityGroups` を使う。Node の確認ツールの振る舞いは変えない(状態ハッシュは変わらない)
  - `src/sim/parallel-archipelago.js` の `ParallelArchipelago`
    - コンストラクタに `this.onMigrate = null;`(移住のたびに呼ぶ関数。使う側が代入する)を足す
    - `migrate()` の最後(`this.migrated` などを足した後)に次を足す。`out` は全島の `emigrate` の返信、`imm` は全島の `immigrate` の返信
      ```js
      // 島 i の行き来: from から sent 体が送られ、placed 体が降り立ち、dropped 体は陸地が無く消えた
      const moves = imm.map((r, i) => {
        const from = migrationSource(i, n);
        return { to: i, from, sent: out[from].migrants.length, placed: r.placed, dropped: r.dropped };
      });
      this.onMigrate?.(moves, this.stepCount);
      ```
  - `src/app/island-worker.js`
    - `const sent = createSentState();` を `let sent = createSentState();` にし、`frame` の処理の先頭で `if (msg.fresh) sent = createSentState();`(写しを作り直したとき、すべて送り直す)。`frame` のコメントの msg の形に `fresh` を足す
    - 要求 `summary` を足す: `result = { summary: islandDiversityGroups(host.sim) };`(`islandDiversityGroups` は `../sim/index.js` から import する)
    - 要求 `profile` を足す: `host.sim.profiler = msg.on ? profiler : NULL_PROFILER; if (!msg.on) profiler.take(); result = {};`(見なくなった島の区間計測を止める)
  - `tools/island-runner-check.mjs` に確認を 1 つ足す(`testFastResponse` 等と同じ書き方。`await` で呼ぶ行も足す)。偽の port で 3 島の `ParallelArchipelago` を作り、移住 1 回分の `onMigrate` の引数を照らす
    ```js
    // 移住のたびに onMigrate が島ごとの行き来を受け取る
    async function testOnMigrate() {
      const ports = [0, 1, 2].map((i) => ({ ask: async (type) => {
        if (type === 'run') return { computeMs: 0 };
        if (type === 'emigrate') return { migrants: [{}, {}] };
        return i === 1 ? { placed: 1, dropped: 1 } : { placed: 2, dropped: 0 };
      } }));
      const arch = new ParallelArchipelago(ports, 1, { islands: 3, migrateEvery: 10, migrants: 2 });
      const calls = [];
      arch.onMigrate = (moves, step) => calls.push({ moves, step });
      await arch.advance(10);
      const expected = JSON.stringify([{ moves: [
        { to: 0, from: 2, sent: 2, placed: 2, dropped: 0 },
        { to: 1, from: 0, sent: 2, placed: 1, dropped: 1 },
        { to: 2, from: 1, sent: 2, placed: 2, dropped: 0 }], step: 10 }]);
      check('onMigrate が島ごとの行き来を受け取る', JSON.stringify(calls) === expected, expected, JSON.stringify(calls));
    }
    ```
    `ParallelArchipelago` は `../src/sim/index.js` から import する
- **対象**: `src/sim/parallel-archipelago.js`, `src/app/island-worker.js`, `tools/island-runner-check.mjs`
- **要件**: R1, R2, R3, R4
- **参照ファイル**:
  - `src/sim/parallel-archipelago.js:34-65`(変更対象。`ParallelArchipelago` の移住)
  - `src/app/island-worker.js`(変更対象。ブラウザの島の Worker)
  - `tools/island-runner-check.mjs`(変更対象。確認の書き方)
  - `src/app/island-snapshot.js:4-7`(`createSentState`)
- **受け入れ基準**:
  - [ ] `node tools/island-runner-check.mjs` が `OK onMigrate が島ごとの行き来を受け取る` を含み、最後の行が `すべて OK`
  - [ ] `node tools/archipelago-check.mjs 1600 1 --settings '{"migrateEvery":700}' --workers` が `状態ハッシュ  383fb6b1289aa722` と `移住 16（捨て 0）` を出す
  - [ ] `node --check src/app/island-worker.js` と `node --check src/sim/parallel-archipelago.js` が exit 0 で終わり、`grep -nE "type === '(summary|profile)'|msg\.fresh" src/app/island-worker.js` が 3 行を出す
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま変わらない
- **依存**: T1

## T3: IslandRunner に見る島の切り替え・群島の集計・移住のログを足す
- **目的**: `src/app/island-runner.js` の `IslandRunner` に 3 つの機能を足す。T2 の `onMigrate` と Worker の要求 `summary`・`profile`・`frame` の `fresh` を使う。骨格は次のとおり
  ```js
  import { ParallelArchipelago, createPort, normalizeSettings, combineArchipelagoDiversity, CFG } from '../sim/index.js';
  const SUMMARY_MS = 2000;   // 全島の集計を取り寄せる間隔（実時間）。島が 1 つなら取り寄せない

  // 移住 1 回分の moves（ParallelArchipelago の onMigrate の引数）から、島ごとの記録の 1 行を作る。島番号は 1 始まりで書く
  export function migrationLogs(moves) {
    return moves.map((m) => {
      const out = moves.find((x) => x.from === m.to);
      let msg = `移住：島 ${m.from + 1} から ${m.placed} 体が移ってきて、島 ${out.to + 1} へ ${out.sent} 体が移っていった`;
      if (m.dropped) msg += `（${m.dropped} 体は降り立つ陸地が見つからなかった）`;
      return { island: m.to, msg };
    });
  }
  ```
  - `create`: `new IslandRunner(workers, ports, arch, mirror, view, infos)` と `infos` を渡す。続けて `arch.onMigrate = (moves) => runner.logMigration(moves);`。`await runner.fetchFrame(true);` の後に `if (count > 1) await runner.fetchSummary();`
  - コンストラクタ: 6 番目の引数 `infos = []` を足して持つ。`this.summary = null; this.lastSummary = -Infinity; this.job = null;` を足す(既存の確認ツールは 5 引数で作るので、省略できるようにする)
  - `fetchFrame(panels, fresh = false)`: `frame` 要求に `fresh` を足す
  - `fetchSummary()`: `this.lastSummary = performance.now();` の後、全 port に `ask('summary')` を並行に送り、`const parts = rs.map((r) => r.summary); const div = combineArchipelagoDiversity(parts);` から次を作って `this.summary` に置く
    ```js
    { islands: parts.map((p, i) => ({ index: i, living: p.living, species: p.groups.length })),
      living: div.living, species: div.species, effSpecies: div.effSpecies,
      speciesFertile: div.speciesFertile, effSpeciesFertile: div.effSpeciesFertile,
      migrated: this.arch.migrated, dropped: this.arch.dropped }
    ```
  - `logMigration(moves)`: `for (const { island, msg } of migrationLogs(moves)) this.ports[island].ask('log', { msg, kind: 'migrate' }).catch(() => {});`
  - `advance`: `const summary = this.ports.length > 1 && now - this.lastSummary >= SUMMARY_MS;` を求め、要求の連鎖を `this.job = this.arch.advance(n).then(...).then(() => this.fetchFrame(panels)).then(() => (summary ? this.fetchSummary() : null)).then(() => { this.busy = false; }).catch(...)` にする(ms/ステップ の更新と `catch` は今のまま)
  - `setView(i)`: 見る島を i に切り替え、新しい写しを返す
    ```js
    async setView(i) {
      while (this.busy) { if (this.error) throw this.error; await this.job?.catch(() => {}); }   // 進行中の要求が終わるまで待つ
      if (this.disposed || i === this.view || !(i >= 0 && i < this.ports.length)) return this.mirror;
      this.busy = true;
      this.job = (async () => {
        this.ports[this.view].ask('profile', { on: false }).catch(() => {});   // 前の島の区間計測を止める
        this.mirror.dispose();
        this.view = i;
        this.mirror = new SimMirror(this.infos[i].info, (m) => this.ports[i].ask(m.type, m));
        await this.fetchFrame(true, true);   // 送り済みの記録を捨てさせ、すべて送り直させる
        this.lastPanels = performance.now();
      })().finally(() => { this.busy = false; });
      await this.job;
      return this.mirror;
    }
    ```
  - `tools/island-runner-check.mjs` に確認を 3 つ足す(既存と同じ書き方。`await` で呼ぶ行も足す)
    - `migrationLogs` に T2 の確認と同じ 3 島の moves を渡し、島 1 の文が `移住：島 1 から 1 体が移ってきて、島 3 へ 2 体が移っていった（1 体は降り立つ陸地が見つからなかった）`、島 0 の文が `移住：島 3 から 2 体が移ってきて、島 2 へ 2 体が移っていった` になる
    - `setView`: 2 つの偽の port(受けた `{ type, payload }` を配列に記録し、`frame` には `{ frame: { t: 0, climate: {}, ids: new Int32Array(0), dead: new Uint8Array(0), poses: new Float32Array(0), born: [], species: [] }, panels: null }`、それ以外には `{}` を返す)と、`infos = [0, 1].map((i) => ({ info: { index: i, seed: i, size: 80, grid: 64, settings: {} } }))` で runner を作る。`await runner.setView(1)` の後、`runner.view === 1`、`runner.mirror.index === 1`、port 1 が `frame` を `fresh: true` で受け、port 0 が `profile` を `on: false` で受けている
    - `fetchSummary`: 2 つの偽の port が `summary` に `{ summary: { living: 5, diet: [[0, 5]], groups: [{ n: 3, genomes: [] }, { n: 2, genomes: [] }] } }` と `{ summary: { living: 3, diet: [[1, 3]], groups: [{ n: 3, genomes: [] }] } }` を返す。`await runner.fetchSummary()` の後、`JSON.stringify(runner.summary.islands)` が `[{"index":0,"living":5,"species":2},{"index":1,"living":3,"species":1}]`、`runner.summary.living === 8`
- **対象**: `src/app/island-runner.js`, `tools/island-runner-check.mjs`
- **要件**: R1, R2, R3, R4
- **参照ファイル**:
  - `src/app/island-runner.js`(変更対象。いまの `IslandRunner`)
  - `tools/island-runner-check.mjs`(変更対象。偽の port・mirror・arch の作り方)
  - `src/app/sim-mirror.js:5-16`(`SimMirror` のコンストラクタ)
  - `src/sim/parallel-archipelago.js:34-70`(T2 の `onMigrate`)
- **受け入れ基準**:
  - [ ] `node tools/island-runner-check.mjs` の最後の行が `すべて OK` で、`NG` を含む行が無い。足した 3 つの確認の `OK` 行が出る
  - [ ] `node --check src/app/island-runner.js` が exit 0 で終わる
  - [ ] `node tools/mirror-check.mjs` の最後の行が `すべて OK`
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま変わらない
- **依存**: T2

## T4: ヘッダーに見る島のセレクトボックスを足し、ストアに島の状態を置く
- **目的**: ヘッダーで見る島を選べるようにする。UI はストアの `island` を書くだけで、切り替えの中身は T5 で配線する。島が 1 つのときは出さない。変更点は次のとおり
  - `src/app/store.js`: `appStore` の初期値に `island: 0, islandCount: 1, archipelago: null` を足し、状態の説明コメントに 3 行を足す(`island` … 見ている島の番号(0 始まり)、`islandCount` … 実行中の世界の島の数、`archipelago` … 群島の集計(`IslandRunner#summary`。島が 1 つなら null))
  - `index.html`: ヘッダーの `<h1 id="title-h1">` の直後に `<label class="island-pick" id="island-pick" hidden title="見る島を選ぶ（描くのは 1 島だけ）"><select id="island-sel" aria-label="見る島"></select></label>` を足す
  - `src/ui/controls.js` の `bindControls`
    - `$('island-sel')` の `change` で `store.set({ island: +sel.value })`
    - `sync(s, prev)` に足す: `!prev || s.islandCount !== prev.islandCount` のとき、`$('island-pick').hidden = s.islandCount <= 1;` と、選択肢を `島 1`〜`島 n`(value は `'0'`〜`String(n - 1)`)で作り直す。そのあと毎回 `sel.value = String(s.island)`
  - `src/styles.css`: `.island-pick select` に、タイトル画面の `.title-grid select` と同じ見た目(`font: inherit; font-size: 12px; color: var(--fg); background: var(--raise); border: 1px solid var(--line); border-radius: var(--r); padding: 2px 4px;`)を付ける。記録の `migrate` 種類に `.log li.migrate span { color: var(--leaf); }` を足す(既存の `.log li.env span` の並び)
- **対象**: `src/app/store.js`, `index.html`, `src/ui/controls.js`, `src/styles.css`
- **要件**: R1, R4, R6
- **参照ファイル**:
  - `src/ui/controls.js`(変更対象。ボタンと sync の書き方)
  - `src/app/store.js:20-31`(変更対象。状態の初期値と説明)
  - `index.html:20-32`(変更対象。ヘッダー)
  - `src/styles.css:27-46`(変更対象。ヘッダーの見た目。`.log li` は 124 行目付近)
- **受け入れ基準**:
  - [ ] `node -e "import('./src/app/store.js').then(m => { const s = m.appStore.get(); console.log(s.island, s.islandCount, s.archipelago); })"` が `0 1 null` を出す
  - [ ] `grep -c 'id="island-sel"\|id="island-pick"' index.html` が `1` を出し、その行に `hidden` が含まれる
  - [ ] `node --check src/ui/controls.js` が exit 0 で終わり、`grep -nE "island-sel|islandCount" src/ui/controls.js` が 2 行以上を出す
  - [ ] `grep -nE "\.island-pick select|li\.migrate" src/styles.css` が 2 行を出す
- **依存**: なし

## T5: 見る島の切り替えを配線し、カメラを保って描き直す
- **目的**: ストアの `island` が変わったら T3 の `IslandRunner#setView` で写しを差し替え、描画とパネルを新しい写しにつなぐ。カメラは保ち、選択と追跡は解除する。群島の集計をストアの `archipelago` に置く。T4 の `island`・`islandCount`・`archipelago` を使う。変更点は次のとおり
  - `src/render/world-view.js`: `attach(sim, { keepCamera = false } = {})` にし、`this.stage.resetCamera(sim.size)` を `if (!keepCamera)` のときだけ呼ぶ
  - `src/app/main.js`
    - `start(seed, settings)`: 古い世界を止める `store.set` に `island: 0, archipelago: null` を足す。最後の `store.set({ sim, world })` を `store.set({ sim, world, islandCount: islands.settings.islands, archipelago: islands.summary })` にする
    - 切り替えの購読を足す。切り替えは 1 つずつ順に行う
      ```js
      // ---------- 見る島の切り替え ----------
      // 写しを作り直して描画とパネルをつなぎ直す。カメラは保ち、別の島の個体の選択と追跡は解除する
      let switching = Promise.resolve();
      store.subscribe((s, prev) => {
        if (s.island !== prev.island && s.sim) switching = switching.then(() => switchIsland(s.island)).catch((err) => console.error(err));
      });
      async function switchIsland(i) {
        const runner = islands;
        if (!runner || runner.view === i) return;
        store.set({ selected: null, follow: false });
        const sim = await runner.setView(i);
        if (runner !== islands) return;   // 待っている間に新しい世界になった
        window.__sim = sim; // デバッグ用
        view.attach(sim, { keepCamera: true });
        panels.attach(sim);
        store.set({ sim });
        refreshUI();
      }
      ```
    - `refreshUI()`: `panels.renderActive()` の前に `if (islands) store.set({ archipelago: islands.summary });` を足す
- **対象**: `src/app/main.js`, `src/render/world-view.js`
- **要件**: R1, R5, R6
- **参照ファイル**:
  - `src/app/main.js:94-165`(変更対象。ループ・起動の配線)
  - `src/render/world-view.js:20-29`(変更対象。`attach`)
  - `src/app/island-runner.js`(T3 の `setView`・`summary`)
- **受け入れ基準**:
  - [ ] `node --check src/app/main.js` と `node --check src/render/world-view.js` が exit 0 で終わる
  - [ ] `grep -nE "setView|keepCamera: true|islandCount: islands\.settings\.islands|archipelago: islands\.summary" src/app/main.js` が 4 行以上を出し、`grep -n "keepCamera" src/render/world-view.js` が 1 行以上を出す
  - [ ] `node tools/island-runner-check.mjs` の最後の行が `すべて OK` で、`npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま変わらない
  - [ ] 報告に「ブラウザでの確認(島の切り替え・カメラの保持・選択の解除)はしていない」旨を書く(親が行う)
- **依存**: T3, T4

## T6: 統計タブの先頭に群島の表と全体の実効種数を出す
- **目的**: 統計タブの先頭に「群島」の節を足し、ストアの `archipelago`(T3 の `IslandRunner#summary` を T5 が置いたもの)から島ごとの個体数・種数の表と、群島全体の数を出す。`archipelago` が null(島が 1 つ)なら節ごと隠す。変更点は次のとおり
  - `index.html`: `<section class="pane" id="p-stats" role="tabpanel">` の最初の子に次を足す
    ```html
    <div id="arch-box" hidden>
      <h2>群島</h2>
      <table class="arch" id="arch-table"><thead><tr><th>島</th><th>個体</th><th>種</th></tr></thead><tbody></tbody></table>
      <div class="note" id="arch-note"></div>
    </div>
    ```
  - `src/ui/panels/stats-panel.js`: `render(sim)` を `render(sim, state)` にし、先頭で `this.renderArchipelago(state.archipelago, state.island);` を呼ぶ
    ```js
    // 群島の表（島が 1 つなら集計が null なので隠す）。view: 見ている島の番号。その行に cur を付ける
    renderArchipelago(a, view) {
      $('arch-box').hidden = !a;
      if (!a) return;
      const td = (v) => Object.assign(document.createElement('td'), { textContent: String(v) });
      $('arch-table').tBodies[0].replaceChildren(...a.islands.map((r) => {
        const tr = document.createElement('tr');
        if (r.index === view) tr.className = 'cur';
        tr.append(td(`島 ${r.index + 1}`), td(r.living), td(r.species));
        return tr;
      }));
      $('arch-note').textContent = `全体 ${a.living} 体・${a.species} 種（交配で束ねると ${a.speciesFertile} 種）　実効種数 ${a.effSpecies.toFixed(1)}（交配で束ねると ${a.effSpeciesFertile.toFixed(1)}）　移住 ${a.migrated} 体（降り立てず ${a.dropped} 体）`;
    }
    ```
  - `src/styles.css`: `table.arch { width: 100%; border-collapse: collapse; font-family: var(--font-data); font-size: 11px; font-variant-numeric: tabular-nums; }`、`table.arch th, table.arch td { padding: 1px 6px; text-align: right; border-bottom: 1px solid var(--line); }`、`table.arch th:first-child, table.arch td:first-child { text-align: left; }`、`table.arch tr.cur td { color: var(--accent); }` を足す
- **対象**: `index.html`, `src/ui/panels/stats-panel.js`, `src/styles.css`
- **要件**: R2, R3, R6, R7
- **参照ファイル**:
  - `src/ui/panels/stats-panel.js:1-40`(変更対象。統計パネル)
  - `index.html:64-93`(変更対象。統計タブ)
  - `src/styles.css:100-130`(変更対象。パネルの見た目)
  - `src/ui/panels.js:31-35`(`render(sim, state)` の呼ばれ方)
- **受け入れ基準**:
  - [ ] `node --check src/ui/panels/stats-panel.js` が exit 0 で終わる
  - [ ] `grep -n 'id="arch-box" hidden' index.html` が 1 行を出し、その行番号が `id="p-stats"` の行の次の行より後で、`<h2>個体数と種数</h2>` の行より前にある
  - [ ] `grep -nE "renderArchipelago|arch-note|speciesFertile" src/ui/panels/stats-panel.js` が 3 行以上を出し、`grep -c "table\.arch" src/styles.css` が 4 以上を出す
  - [ ] 報告に「ブラウザでの確認(島 4 で表と移住のログが更新されること・島 1 で節が出ないこと)はしていない」旨を書く(親が行う)
- **依存**: T5

## T7: ARCHITECTURE.md に見る島の切り替えと群島の集計を書く
- **目的**: T1〜T6 の変更を `ARCHITECTURE.md` に反映する。変更点は次のとおり
  - 「部品どうしは直接呼び合わず…」の段落の状態の一覧に `island` `islandCount` `archipelago` を足す
  - 「sim/ の中身」の表の `diversity.js` の行に `islandDiversityGroups`(1 島分の材料)・`combineArchipelagoDiversity`(材料を束ねる)を足す
  - 「群島(`archipelago.js`)」の節の「画面」と「写し」の項を書き直す: 見る島はヘッダーのセレクトボックスで選ぶ(島が 1 つなら出さない)。切り替えは `IslandRunner#setView` が写しを作り直し、新しい島の Worker に `frame` の `fresh` ですべて送り直させ、前の島の Worker に `profile` で区間計測を止めさせる。カメラは保ち、選択と追跡は解除する。2 秒ごとに全島へ `summary` を送り、主スレッドで `combineArchipelagoDiversity` を使って束ね、統計タブの「群島」の節に出す。移住のたびに `ParallelArchipelago#onMigrate` から `IslandRunner` が各島の記録に 1 行書く(`kind` は `migrate`)。「見る島の切り替えは #28 で行います」の文は消す
  - 「動作確認」のコマンド一覧に `node tools/island-runner-check.mjs   # IslandRunner の進め方・島の切り替え・群島の集計・移住のログ（最後の行が「すべて OK」）` を足す
- **対象**: `ARCHITECTURE.md`
- **要件**: なし
- **参照ファイル**:
  - `ARCHITECTURE.md`(変更対象。構成メモ)
  - `src/app/island-runner.js`(T3 の `IslandRunner`)
- **受け入れ基準**:
  - [ ] `grep -nE "setView|islandDiversityGroups|combineArchipelagoDiversity|onMigrate|island-runner-check" ARCHITECTURE.md` が 5 行以上を出す
  - [ ] `grep -n "#28 で行います" ARCHITECTURE.md` が何も出さない
  - [ ] `grep -nE "\`island\`|\`islandCount\`|\`archipelago\`" ARCHITECTURE.md` が 1 行以上を出す
- **依存**: T5, T6
