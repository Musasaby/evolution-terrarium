# タスク一覧: docs/plans/environment-ui-plan.html(環境と UI の改善計画。Issue #12 #34〜#39)

## 要件
- R1: 群島で、個体数の少ない種からは移住させない。移住で全個体が出て、個体数 0 のまま「現存」として残る種をなくす(#39)
- R2: 湖に落ちた個体の一部が陸に戻れる。目安は、上陸の回数が入水の回数の 3 割以上で、「転落」の死がほぼ 0(#34)
- R3: 山に登る個体がいる。標高の上位 40% の帯に、どの時点でも一定数の個体がいる(#35)
- R4: 個体が積極的に移動する。移動の速さの中央値を上げる。目安は 0.5 m/秒以上(#35)
- R5: 湖を餌場にして、水棲度の高い個体が湖で暮らせるようにする(#12)
- R6: 体節の多い複雑な種が増える。体節に直接の得を足すのではなく、体節が多いと自然に有利になる環境にする(#38)
- R7: 種が増えても系統樹が見やすい。絞り込み・横軸の範囲・個体数に応じた太さを入れ、表示と実装の食い違い(「ホバーで詳細」)をなくす(#36)
- R8: 系統樹で種を選ぶと、その種の特徴が図で出る。体の形・食性・適温・水棲度・個体数の推移・誕生と絶滅の時期が出て、その種の個体を 1 体選べる(#36)
- R9: 文章での説明を減らし、アイコン・図・レイアウトで見せる。ヘッダーの年・季節・気温・湖面・天候を図にし、ボタンをアイコンにする。ヘッダーと統計タブで重なる値は統計タブの数値カードにまとめる(#37)
- R10: 長く動かしてもグラフの直近の変化が読める。表示の範囲を「直近 1 年・直近 5 年・全期間」で切り替えられる(#37)

## 前提・解釈
- 計画書の 8 段(sim の 5 段と UI の 3 段)をすべて入れ、段ごとにグループにする。グループの順は計画書の実施順(sim: #39 → #34 → #35 → #12 → #38、UI: #37 前半 → #36 → #37 後半)。グループごとに PR を作る(利用者に確認済み)
- 作業ブランチは `develop/environment-ui`(`origin/main` から作成。前のブランチ `develop/environment-ui-plan` は PR #40 でマージ済み)
- #34 は計画書のおすすめどおり、A(浮力)と B(遠浅の湖)を入れる。浮力は Rapier の `addForce` ではなく `applyImpulse` で毎ステップかける(力積なので `resetForces` が要らない)。D(浅瀬での祖先の試走)は #35 の祖先の試走(T11)にまとめる
- #35 の「山の上の得」は標高の高い所にしか生えない草「高山草」を植物の種類に足して作る。あわせて、地面の摩擦を上げて坂を登りやすくする(利用者の回答)。山の形そのもの(高さ・裾野)は変えない
- #35 の「探索の動機」は新しい遺伝子や神経の入力を足さずに、同種が密集しているほど推進を強める規則で作る(神経の入力 `NI` を変えるとゲノムの長さが変わるため)
- #12 の水中の植物は、水面に浮かぶ草「浮草」にする。浮力で個体が水面近くに浮き、湖の底に生える植物には届かないためである。浮草は草類の枠(`MAX_SOFT_PLANTS`)を草・花・葦・苔・高山草と分け合い、植物の合計の上限は変えない。水棲度の高い個体ほど浮草から多くのエネルギーを得る
- #38 では体節の数に直接の得を与えない(利用者の希望)。代わりに、(1) 水の抵抗を体節の向きで変え(長軸に沿う動きは小さく、横切る動きは大きく抑える)、くねらせて泳ぐ長い体が物理の結果として速く泳げるようにする、(2) 体節数の差による繁殖の壁と体節ごとの固定費を下げ、体節を増やしたときの人為的な不利を減らす。これで体節が増えるかは計測で確かめる。増えなければ、その結果を報告して次のサイクルで検討する
- #38 の物理の重さは、今回は抑えない(利用者の回答)。剛体の数と 1 ステップの時間は計測して報告するだけにする。`MAXP` は 10 のまま
- sim の各段は振る舞いを変えるので、状態ハッシュが変わるのが正常。各段の計測・調整タスクで、多様性が悪くならないことを確かめる。多様性の基準は計画時に測った `node tools/diversity-check.mjs 9000 1,2` の 1.00 年の行(seed 1: 個体数 123・実効種数 10.7、seed 2: 個体数 193・実効種数 5.0。壁時間 約 2 分 30 秒)。各シードで個体数と実効種数がこの 8 割以上なら「悪くならない」とする(1 時点の値はばらつくため、8 割を下回ったら 1 回だけ測り直し、よい方を採る)
- UI の各タスクは sim の振る舞いを変えない。タスクの作業を始める前に `npm run check:sim` を実行してハッシュを控え、変更後も同じであることを確かめる(sim のグループでハッシュが変わるため、計画時の値は使えない)
- 計画時に確かめた値: `npm run check:sim` の状態ハッシュは `088bad967edb44ab`(世界の生成 約 9.4 秒、1 ステップ平均 約 13.4 ms、うち生物 2.47 ms・物理 10.01 ms)。`node tools/archipelago-check.mjs 1600 1 --settings '{"migrateEvery":700}'`(約 40 秒)は `状態ハッシュ  383fb6b1289aa722`・`移住 16（捨て 0）`・`個体数 282・実効種数 29.91・交配で束ねた実効種数 25.46（48 種 → 36 種）`
- 計画時に `tools/lake-shape-check.mjs`(世界を作った直後の湖の形を出す。`node tools/lake-shape-check.mjs <シード,...>`)を足した。T6 で湖の形を確かめるときに使う。計画時の出力は「計測の基準」の節に書く
- 湖と山の計測の道具 `tools/environment-check.mjs` は計画時には無い。T4 で作り、T4 の完了報告に今の振る舞いでの値(基準)を書く。後のタスクはその報告を読んで比べる
- 描画・UI の変更はブラウザでの確認が要る(`npm run serve` → http://localhost:8000)。子エージェントではブラウザを確かめられないので、各 UI グループの PR を作る前に、親が利用者に確認を依頼するか、確かめられなかった旨を報告する。島が 1 つの世界にするには、開発者ツールで `localStorage` の `evolution-terrarium:world` の `settings.islands` を 1 にして再読み込みする
- 絵文字は使わない。アイコンは SVG を自分で描き、外部のアイコン集は読み込まない(ビルド不要の静的サイトのまま)

## 計測の基準
- `node tools/lake-shape-check.mjs 1,2,20261007`(約 30 秒):
  - `seed 1: 湖 1 個・水面より低い格子 16.0%・最も低い地面 -14.8 m・水際の最大勾配 61°`
  - `seed 2: 湖 3 個・水面より低い格子 13.2%・最も低い地面 -23.6 m・水際の最大勾配 74°`
  - `seed 20261007: 湖 2 個・水面より低い格子 15.6%・最も低い地面 -14.3 m・水際の最大勾配 60°`
- `node tools/archipelago-diversity.mjs 9000 1`(約 3 分): `seed 1：ハッシュ b585befe99fde3c5・移住 48（捨て 0）・個体数 158.0・実効種数 22.94・交配で束ねた実効種数 15.34・11.83 ms/ステップ`
- `node tools/diversity-check.mjs 9000 1,2` の 1.00 年の行: seed 1 は個体数 123・現存種 14・実効種数 10.7、seed 2 は個体数 193・現存種 12・実効種数 5.0

## 対象外
- #34 の C(「最寄りの陸の方向」の感覚)。神経の入力が増えてゲノムの長さが変わるため。A・B と T9 の浅瀬の試走で上陸が足りなければ、次のサイクルで検討する
- #35 の E(推進の効き方・関節の強さの見直し)と、山の形(高さ・裾野)を変えること
- #38 の物理の負荷を抑える工夫(体節の合計で個体数の上限を決める・飾りの体節など)と、`MAXP` を上げること(利用者の回答)
- #38 の、新しい関節の神経が噛み合わない問題(複製元の神経の写し方の見直し)
- #36 の「群島では、その種がいる島を示す」。島をまたいだ種の対応(`speciesKey`)を集計に足す必要があり、範囲が広がるため
- #37 の 5 のうち、個体タブ「記録」の `dl` と、タイトル画面のテンプレートの説明の図示(計画書の実施順 C に入っていないため)

<!-- グループ migrate: #39 少数の種を移住させない -->

## T1: 移住で選ぶ個体から、島での個体数が少ない種を外す
- **目的**: `IslandHost#emigrate` が、島での個体数が `CFG.MIGRATE_MIN_SPECIES`(既定 6)未満の種の個体を選ばないようにする。あわせて、`kill` の絶滅の判定を関数に切り出し、移住でも呼ぶ(上の規則が正しければ通らない保険)。骨格は次のとおり
  ```js
  // creatures.js（export する）。種の生きている個体が 0 になっていたら、いなくなった時刻を記録してログを出す。記録したら true
  export function markGoneIfEmpty(sim, sp, message) {
    if (!sp || sp.extinct !== null || sp.count > 0) return false;
    if (sim.creatures.some(o => o.alive && !o.dead && o.species === sp)) return false;
    sp.extinct = sim.t;
    sim.log(message(sp), 'extinct');
    return true;
  }
  // kill の中の sp.count-- の後を、これに置き換える（振る舞いは今と同じ）
  //   markGoneIfEmpty(sim, sp, (s) => `種「${s.name}」が絶滅した`);

  // island-host.js の emigrate。Fisher-Yates で順に引き、引いた個体の種の「島に残る数」が MIGRATE_MIN_SPECIES 以上なら選ぶ
  emigrate(k, rngSeed) {
    const sim = this.sim, rng = makeRng(rngSeed), min = CFG.MIGRATE_MIN_SPECIES;
    const live = sim.creatures.filter(isLiving).sort((a, b) => a.id - b.id);
    const n = live.length;
    const left = new Map();   // 種 → その島に残る数
    for (const c of live) left.set(c.species, (left.get(c.species) || 0) + 1);
    const order = Array.from({ length: n }, (_, i) => i);
    const chosen = [];
    let skipped = 0;          // 少数の種を守るために飛ばした個体の数
    for (let i = 0; i < n && chosen.length < k; i++) {
      const j = i + Math.floor(rng() * (n - i));
      [order[i], order[j]] = [order[j], order[i]];
      const c = live[order[i]], m = left.get(c.species);
      if (m < min) { skipped++; continue; }
      left.set(c.species, m - 1);
      chosen.push(c);
    }
    this.lastSkipped = skipped;   // T2 で群島の集計に足す
    // migrants の作り方と、count-- と removeCreature は今のまま。その後に次を足す
    // for (const sp of new Set(chosen.map((c) => c.species))) markGoneIfEmpty(sim, sp, (s) => `種「${s.name}」はすべて移住して島からいなくなった`);
  }
  ```
  - `CFG.MIGRATE_MIN_SPECIES: 6` を `src/sim/config.js` の `CFG` に、説明のコメント付きで足す(「その島での個体数がこれ未満の種からは移住させない」)
  - `island-host.js` は `CFG` を `./config.js` から、`markGoneIfEmpty` を `./creatures.js` から import する。constructor で `this.lastSkipped = 0` を置く
- **対象**: `src/sim/island-host.js`, `src/sim/creatures.js`, `src/sim/config.js`
- **要件**: R1
- **参照ファイル**:
  - `src/sim/island-host.js:38-62`(変更対象。今の `emigrate`)
  - `src/sim/creatures.js:82-97`(変更対象。`kill` の絶滅の判定)
  - `src/sim/config.js:1-40`(変更対象。`CFG` の書き方)
- **受け入れ基準**:
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま(島が 1 つなら移住は起きず、`kill` の振る舞いも変わらない)
  - [ ] `node tools/archipelago-check.mjs 1600 1 --settings '{"migrateEvery":700}'`(約 40 秒)が最後まで動き、状態ハッシュが `383fb6b1289aa722` から変わる(選ばれる個体が変わるため。新しい値を報告する)
  - [ ] 上と同じ引数に `--workers` を付けても、付けないときと同じ状態ハッシュになる
- **依存**: なし

## T2: 少数の種を守って見送った数を群島で数え、確認の道具に出す
- **目的**: T1 の `IslandHost#lastSkipped` を、1 スレッド版(`Archipelago`)と Worker 版(`ParallelArchipelago`)の両方で累計し(`this.skipped`)、確認の道具に出す。移住で個体数 0 の「現存種」が残っていないかも、道具で数えて出す
  - `src/sim/archipelago.js`: constructor に `this.skipped = 0;   // 少数の種を守るために移住を見送った個体の累計`。`migrate()` で `emigrate` を呼んだ直後に、各島の `isl.lastSkipped` を足す
  - `src/sim/parallel-archipelago.js`: `runIslandRequest` の `emigrate` の返り値を `{ migrants: host.emigrate(msg.k, msg.rngSeed), skipped: host.lastSkipped }` にする(`host.emigrate` を先に呼んでから `lastSkipped` を読むよう、2 行に分ける)。constructor に `this.skipped = 0`。移出の応答 `out[i].skipped` を足す。`onMigrate` に渡す `moves` は変えない
  - `tools/archipelago-check.mjs`: `移住 ${arch.migrated}（捨て ${arch.dropped}）` の 2 か所を `移住 ${arch.migrated}（捨て ${arch.dropped}・少数で見送り ${arch.skipped}）` にする。最後に `現存なのに個体 0 の種 ${n}` の 1 行を足す(`n` は全島の `sim.species` のうち `extinct === null && count === 0` の数の合計。Worker 版で `sim.species` を直接読めない場合は、その分岐では出さない)
  - `tools/archipelago-diversity.mjs`: 結果に `skipped: arch.skipped` を足し、`移住 ${r.migrated}（捨て ${r.dropped}）` を `移住 ${r.migrated}（捨て ${r.dropped}・少数で見送り ${r.skipped}）` にする
- **対象**: `src/sim/archipelago.js`, `src/sim/parallel-archipelago.js`, `tools/archipelago-check.mjs`, `tools/archipelago-diversity.mjs`
- **要件**: R1
- **参照ファイル**:
  - `src/sim/archipelago.js:7-35`(変更対象。`migrate`)
  - `src/sim/parallel-archipelago.js:26-72`(変更対象。`runIslandRequest` と移住)
  - `tools/archipelago-check.mjs:40-70`(変更対象。出力)
  - `tools/archipelago-diversity.mjs:90-130`(変更対象。出力)
- **受け入れ基準**:
  - [ ] `node tools/archipelago-check.mjs 1600 1 --settings '{"migrateEvery":700}'` が T1 の完了報告と同じ状態ハッシュを出し、`少数で見送り` を含む移住の行と `現存なのに個体 0 の種 0` の行を出す
  - [ ] 上と同じ引数に `--workers` を付けると、同じ状態ハッシュと同じ `移住 … 少数で見送り …` の行を出す
  - [ ] `node tools/archipelago-check.mjs 9000 1`(数分)が `現存なのに個体 0 の種 0` を出す
- **依存**: T1

## T3: 移住を見送るしきい値を 4・6・8 で比べて決める
- **目的**: `CFG.MIGRATE_MIN_SPECIES` を 4・6・8 にして、それぞれ `node tools/archipelago-diversity.mjs 9000 1`(1 回 2〜4 分)を実行し、移住の回数・見送りの数・群島の実効種数・交配で束ねた実効種数を比べる。交配で束ねた実効種数が最も大きい値を採る(差が 0.5 未満なら 6 を採る)。T1 の前の値(計画時の値。tasks.md の「計測の基準」の節)とも比べて報告する。値を変えるのは `src/sim/config.js` だけ
- **対象**: `src/sim/config.js`
- **要件**: R1
- **参照ファイル**:
  - `src/sim/config.js`(変更対象。`MIGRATE_MIN_SPECIES`)
  - `.agents/workflow/tasks.md`(「計測の基準」の節。変更前の値)
- **受け入れ基準**:
  - [ ] 4・6・8 の 3 通りの `archipelago-diversity` の結果の行(`seed 1：ハッシュ …・移住 …・個体数 …・実効種数 …・交配で束ねた実効種数 …`)を、完了報告に表で書く
  - [ ] 上の規則で選んだ値が `src/sim/config.js` に入っており、`node tools/archipelago-check.mjs 1600 1 --settings '{"migrateEvery":700}'` が `現存なのに個体 0 の種 0` を出す
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま
- **依存**: T2

<!-- グループ lake: #34 浮力と遠浅の湖 -->

## T4: 水・標高・移動の速さ・体節数を測る道具 environment-check を足す
- **目的**: #34・#35・#12・#38 の前後比較に使う計測の道具 `tools/environment-check.mjs` を新しく作る。sim は変えない。`tools/diversity-check.mjs` と同じく、シードごとに自分を子プロセス(`--worker <ステップ数> <シード>`)で起動して並行に進め、JSON を親が集めて表示する。`--settings` は `tools/settings-arg.mjs` の `extractSettings` で受ける。骨格は次のとおり
  ```js
  // 使い方: node tools/environment-check.mjs <ステップ数=9000> <シード=1,2> [--settings ...]
  const SAMPLE = 30;   // 調べる間隔（ステップ。約 1 シム秒）
  async function runSeed(steps, seed, settings) {
    await RAPIER.init();
    const sim = new Sim(RAPIER, seed, { settings });
    const base = sim.climate.baseWater;
    let top = -Infinity; for (const h of sim.H) top = Math.max(top, h);
    const band = base + 0.6 * (top - base);     // 標高の上位 40% の帯の下限（湖面から最高点までの 6 割の高さ）
    const st = new Map();                       // 個体 id → { wet, x, z, dist, t0, t1, wetN, n, aqua, done }
    let entries = 0, exits = 0, wetDeaths = 0, falls = 0, maxGround = -Infinity, highSum = 0, highMin = Infinity, samples = 0;
    for (let s = 1; s <= steps; s++) {
      sim.step();
      if (s % SAMPLE) continue;
      const wl = sim.climate.water; let high = 0;
      for (const c of sim.creatures) {
        if (!c.alive) continue;
        const p = c.pos[0], e = st.get(c.id);
        if (c.dead) { if (e && !e.done) { e.done = true; if (e.wet) wetDeaths++; if (c.cause === '転落') falls++; } continue; }
        const wet = sim.isWater(p.x, p.z) && p.y < wl + 0.3;   // 水域の上にいて、根の体節が水面 +0.3 m より下
        const g = sim.heightAt(p.x, p.z);
        if (!e) st.set(c.id, { wet, x: p.x, z: p.z, dist: 0, t0: sim.t, t1: sim.t, wetN: wet ? 1 : 0, n: 1, aqua: c.aqua ?? 0, done: false });
        else {
          if (wet && !e.wet) entries++; if (!wet && e.wet) exits++;
          e.dist += Math.hypot(p.x - e.x, p.z - e.z); e.x = p.x; e.z = p.z; e.t1 = sim.t; e.wet = wet; e.n++; if (wet) e.wetN++;
        }
        if (g > maxGround) maxGround = g;
        if (g >= band) high++;
      }
      highSum += high; highMin = Math.min(highMin, high); samples++;
    }
    // 速さ: 10 秒以上たどれた個体の dist / (t1 - t0)。10・50・90 パーセンタイル
    // 水中の時間: 全サンプルのうち wet の割合。水中に長くいた個体（wetN / n > 0.5）の aqua 平均と、全個体の aqua 平均
    // 体節数: 最後の時点の生きている個体の nParts の中央値・上位 10%（90 パーセンタイル）・最大
    // 植物: 最後の時点の sim.flora.countBySpecies() を PLANT_SPECIES の名前と組にする
  }
  ```
  - 出力の形は次のとおり(シードごとの 6 行と、最後に合計の 1 行。数値の桁は例のとおり)
    ```
    seed 1 / 9000 ステップ
      水: 入水 20・上陸 1・水中で死亡 18・転落 1
      標高: 最高点 26.0 m・帯の下限 16.1 m・個体がいた最も高い地面 4.8 m・帯の個体（1 時点の平均 0.0・最小 0）
      速さ m/秒（10 / 50 / 90 %）: 0.11 / 0.20 / 0.35
      水中の時間 12.3%・水中に長くいた個体の水棲度 0.45（全体 0.50）
      体節数（最後の時点）: 中央値 4・上位 10% 6・最大 6
      植物（最後の時点）: 草 300・花 120・…
    合計: 入水 175・上陸 1（上陸の割合 0.6%）・水中で死亡 159・転落 12
    ```
  - `package.json` の `scripts` に `"check:environment": "node tools/environment-check.mjs"` を足す
  - ファイルの先頭に、使い方と数え方(水中・上陸・帯の定義)のコメントを書く
- **対象**: `tools/environment-check.mjs`, `package.json`
- **要件**: R2, R3, R4, R5, R6
- **参照ファイル**:
  - `tools/diversity-check.mjs`(子プロセスで並行実行する書き方を真似る)
  - `tools/diversity-worker.mjs:1-20`(Rapier の初期化と Sim の作り方)
  - `tools/settings-arg.mjs`(`--settings` の受け方)
  - `package.json`(変更対象。scripts)
- **受け入れ基準**:
  - [ ] `node tools/environment-check.mjs 600 1` が、上の形のシードごとの 6 行と合計の行を出して exit 0 で終わる
  - [ ] `node tools/environment-check.mjs 9000 1,2`(数分)の出力全体を、完了報告に「基準(変更前)」としてそのまま書く
  - [ ] `node tools/environment-check.mjs 27000 1,2`(10 分以内。長ければ `run_in_background` で実行する)の出力全体を、完了報告に「3 年の基準」として書く(T22 で比べる)
  - [ ] `npm run check:sim` の状態ハッシュが `088bad967edb44ab` のまま(道具を足すだけで sim は変えない)
- **依存**: なし

## T5: 水面より下の体節に浮力をかける
- **目的**: 水中で個体が湖の底まで沈むのをやめ、水面近くに浮くようにする。新しいファイル `src/sim/water.js` に水の中の力をまとめる(T9 の祖先の試走と T20 の水の抵抗でも使う)。骨格は次のとおり
  ```js
  // ===== 水の中の力：浮力（水面より下の体節を持ち上げる） =====
  import { CFG } from './config.js';
  const G = 9.81;
  // 体節の浸かった割合（0〜1）。中心の高さ y・半径 r の球として近似する
  export function submerged(y, r, wl) { return Math.min(1, Math.max(0, (wl - (y - r)) / (2 * r))); }
  // 水面 wl より下の体節に、上向きの力積（体節の質量 × G × BUOYANCY × 浸かった割合 × dt）をかける。物理ステップの前に毎ステップ呼ぶ
  // c.masses（体節ごとの質量）と c.pos（姿勢の写し）を使う。戻り値は中心が水面より下の体節の数（今の updateCreatures の sub と同じ数え方）
  export function applyWater(c, wl, dt) {
    let sub = 0;
    for (let i = 0; i < c.bodies.length; i++) {
      const P = c.pos[i];
      if (P.y < wl) sub++;
      const s = submerged(P.y, c.genome.parts[i].r, wl);
      if (s > 0) c.bodies[i].applyImpulse({ x: 0, y: c.masses[i] * G * CFG.BUOYANCY * s * dt, z: 0 }, true);
    }
    return sub;
  }
  ```
  - `src/sim/creatures.js` の `spawnCreature` で、`Object.assign(c, body)` の直後に `c.masses = body.bodies.map((b) => b.mass());` を足す
  - `updateCreatures` の `for (const P of c.pos) if (P.y < wl) sub++;` を `sub = applyWater(c, wl, dt);` に置き換える(`let wet = 0, sub = 0;` の宣言は残す)。減衰(`setLinearDamping`)の処理は今のまま。死骸には浮力をかけない(死骸は `decayCorpse` の分岐で先に `continue` するので、そのままでよい)
  - `CFG.BUOYANCY: 1.15` を、`// 浮力の強さ（体の重さに対する割合。1 を超えると水面に浮く）` のコメント付きで `src/sim/config.js` の水中の費用の近くに足す
- **対象**: `src/sim/water.js`, `src/sim/creatures.js`, `src/sim/config.js`
- **要件**: R2
- **参照ファイル**:
  - `src/sim/creatures.js:34-46`(変更対象。`spawnCreature`)
  - `src/sim/creatures.js:196-225`(変更対象。`updateCreatures` の水中の処理)
  - `src/sim/config.js:30-45`(変更対象。水中の費用の設定)
- **受け入れ基準**:
  - [ ] `node -e "import('./src/sim/water.js').then(m => console.log(m.submerged(0, 0.5, 1), m.submerged(1, 0.5, 1), m.submerged(2, 0.5, 1)))"` が `1 0.5 0` を出す
  - [ ] `npm run check:sim` が最後まで動き、状態ハッシュが `088bad967edb44ab` から変わる(新しい値と区間ごとの所要時間を報告する)
  - [ ] `node tools/environment-check.mjs 9000 1,2` の出力を完了報告に書き、T4 の基準と比べて上陸の回数がどう変わったかを書く
- **依存**: T4

## T6: 湖を遠浅にして、底を浅くする
- **目的**: 湖の窪みの形を、今の深い甕状(`h -= depth * exp(-(d/r)^3)`)から、水際で傾きが 0 になる遠浅の形に変える。今の形では深さが縁の 2.2〜3.0 倍あるため、実際の水際は `u = d / radius ≈ 1.0` まで広がっている(`exp(-u^3) = 1/2.6` を解くと u ≈ 0.99)。水際を `u = 1.0` に置いて、湖の面積を今とほぼ同じに保つ。骨格は次のとおり
  ```js
  const SHORE = 1.0;    // 水際（u = 距離 / radius）。今の深い窪みで実際に水際になっていた位置にほぼ合わせる（面積を保つ）
  const RIM = 1.75;     // 水際の外で、元の地面の高さに戻りきる位置
  // 湖 1 つ分の窪みを当てた高さ。h: それまでの高さ / u: 湖の中心からの距離 ÷ radius
  function lakeHeight(h, u) {
    if (u < SHORE) {
      const x = u / SHORE;
      const bed = BASE_WATER - CFG.LAKE_DEPTH * (1 - x * x) ** 2;   // 水際で傾き 0、中央で深さ LAKE_DEPTH
      return Math.min(h, bed);
    }
    if (u < RIM && h > BASE_WATER) {
      const t = (u - SHORE) / (RIM - SHORE), s = t * t * (3 - 2 * t);   // smoothstep
      return Math.min(h, BASE_WATER + (h - BASE_WATER) * s);
    }
    return h;
  }
  // generate の格子のループでは、h = this.baseHeight(x, z, nz) のあと、湖ごとに h = lakeHeight(h, Math.hypot(x - lk.x, z - lk.z) / lk.radius)
  ```
  - `CFG.LAKE_DEPTH: 4` を、`// 湖の中央の水深（m。底は湖面 1.2 m からこれだけ下。「転落」の判定 y < -20 より十分浅く保つ）` のコメント付きで `src/sim/config.js` の `LAKE_FRAC` の近くに足す
  - 湖を置く処理の `rimMax` の計算と、`depth = Math.max(rimMax - BASE_WATER, 2) * rng.range(2.2, 3.0)` は、深さとしては使わなくなる。乱数の消費順を保つため `rng.range(2.2, 3.0)` の呼び出しは残し(戻り値は捨てる)、`this.lakes.push({ x: bx, z: bz, depth: CFG.LAKE_DEPTH, radius })` にする。`rimMax` の計算(乱数を使わない)は消してよい。`generate` の前のコメント「底の平らな甕状の深い窪み」も形に合わせて直す
  - 川(`generateRivers`)と土壌(`generateSoil`)は変えない
- **対象**: `src/sim/terrain.js`, `src/sim/config.js`
- **要件**: R2
- **参照ファイル**:
  - `src/sim/terrain.js:47-99`(変更対象。湖の置き方と格子のループ)
  - `src/sim/config.js:20-30`(変更対象。`LAKE_FRAC` の近く)
  - `tools/lake-shape-check.mjs`(確かめに使う道具)
- **受け入れ基準**:
  - [ ] `node tools/lake-shape-check.mjs 1,2,20261007` で、各シードの「最も低い地面」が −3.0 m 以上、「水際の最大勾配」が tasks.md の「計測の基準」の値より小さい(出力を報告する)
  - [ ] 同じ出力で、各シードの「水面より低い格子」の割合が「計測の基準」の値の 0.8〜1.2 倍に収まる(収まらなければ `SHORE` を 0.05 刻みで動かして合わせ、採った値を報告する)
  - [ ] `npm run check:sim` が最後まで動く(状態ハッシュは変わる。新しい値を報告する)
- **依存**: T5

## T7: 浮力と湖の形を計測して調整する
- **目的**: T5・T6 の後で、`node tools/environment-check.mjs 9000 1,2` と `node tools/diversity-check.mjs 9000 1,2` を実行し、上陸と多様性を確かめる。上陸の割合が 3 割に届かない、または「転落」が 2 以上なら、次の順に 1 つずつ試し、最初に満たした組を採る: (1) `BUOYANCY` 1.3、(2) (1) に加えて `LAKE_DEPTH` 3、(3) (2) に加えて `BUOYANCY` 1.5。どれも満たさなければ、上陸の割合が最も高い組を採り、その旨を報告する。値を変えるのは `src/sim/config.js` だけ
- **対象**: `src/sim/config.js`
- **要件**: R2
- **参照ファイル**:
  - `src/sim/config.js`(変更対象。`BUOYANCY`・`LAKE_DEPTH`)
  - `.agents/workflow/tasks.md`(「前提・解釈」の多様性の基準)
- **受け入れ基準**:
  - [ ] 採った組の `node tools/environment-check.mjs 9000 1,2` の出力全体と、試した組ごとの合計の行を完了報告に書く。採った組で、合計の上陸の割合が 30% 以上かつ転落が 1 以下(満たせなかった場合は、その旨と最もよい値)
  - [ ] 採った組の `node tools/diversity-check.mjs 9000 1,2` の 1.00 年の行が、各シードで個体数と実効種数とも多様性の基準の 8 割以上(出力を報告する)
  - [ ] `npm run check:sim` の 1 ステップ平均と区間ごとの所要時間を報告する(計画時は 13.4 ms・生物 2.47 ms)
- **依存**: T4, T5, T6

## T8: #39・#34 の結果を計画の記録に書く
- **目的**: 新しいファイル `docs/plans/environment-ui.md` を作り、計画書 `docs/plans/environment-ui-plan.html` の結果の記録にする。この PR では「#39 少数の種を移住させない」と「#34 浮力と遠浅の湖」の 2 節を書く。各節に、変えた規則と設定値(`MIGRATE_MIN_SPECIES`・`BUOYANCY`・`LAKE_DEPTH`・湖の形の式)、前後の計測の表(T3・T4・T7 の完了報告の値)、採った値と理由を書く。後のグループが節を足していくので、冒頭に「節は Issue ごと。計測の道具は `tools/environment-check.mjs`」と書く。あわせて `ARCHITECTURE.md` に `src/sim/water.js`(水の中の力)と `tools/environment-check.mjs`・`tools/lake-shape-check.mjs` を、既存の一覧の書き方に合わせて足す
- **対象**: `docs/plans/environment-ui.md`, `ARCHITECTURE.md`
- **要件**: R1, R2
- **参照ファイル**:
  - `docs/plans/biodiversity.md:142-210`(結果の節の書き方を真似る)
  - `ARCHITECTURE.md`(変更対象。ファイルの一覧)
- **受け入れ基準**:
  - [ ] `docs/plans/environment-ui.md` に `## #39` と `## #34` で始まる見出しがあり、それぞれに前後の計測の表がある
  - [ ] `ARCHITECTURE.md` に `water.js` と `environment-check` の記述がある(`grep -c "water.js\|environment-check" ARCHITECTURE.md` が 2 以上)
- **依存**: T3, T7

<!-- グループ mountain: #35 坂と探索 -->

## T9: 高山草を足し、地面の摩擦を上げる
- **目的**: 山の上に得を作るため、標高の高い所にしか生えない草「高山草」を植物の種類に足す。あわせて、地面の摩擦を設定値にして上げ、坂を登りやすくする
  - `src/sim/plant-species.js` の `PLANT_SPECIES` の**末尾**に足す(既存の種の番号 `spIdx` を変えないため): `{ name: '高山草', temp: [-12, 14], moist: [0.2, 0.9], maxE: 40, grow: 1.5, spread: 4, rate: 0.10, life: 160, col: 0.9, hh: 0.2, soft: true, minAlt: 7, soil: [1.1, 0.9, 1.0, 1.0] }`。先頭のコメントに `minAlt: 湖面(基準)からこの高さ(m)以上にしか生えない` を足す
  - `src/sim/environment.js` の `suitability` の先頭(高さ `h` を求めた直後)に `if (sp.minAlt !== undefined && h - climate.baseWater < sp.minAlt) return 0;` を足す
  - `CFG.GROUND_FRICTION: 1.6` を、`// 地面（地形の当たり判定）の摩擦係数。体節は 1.0。大きいほど坂を登りやすい` のコメント付きで `src/sim/config.js` に足す。`src/sim/sim.js` の地形の当たり判定の `.setFriction(1.0)` を `.setFriction(CFG.GROUND_FRICTION)` にする
  - 描画の形と色は T10 で足す(それまで高山草は描かれないが、sim は動く)
- **対象**: `src/sim/plant-species.js`, `src/sim/environment.js`, `src/sim/config.js`, `src/sim/sim.js`
- **要件**: R3
- **参照ファイル**:
  - `src/sim/plant-species.js`(変更対象。植物の種類)
  - `src/sim/environment.js:10-17`(変更対象。`suitability`)
  - `src/sim/sim.js:90-96`(変更対象。地形の当たり判定)
  - `src/sim/config.js`(変更対象)
- **受け入れ基準**:
  - [ ] `node -e "import('./src/sim/index.js').then(m => console.log(m.PLANT_SPECIES.length, m.PLANT_SPECIES.at(-1).name, m.CFG.GROUND_FRICTION))"` が `9 高山草 1.6` を出す
  - [ ] `node tools/environment-check.mjs 9000 1` の「植物（最後の時点）」の行に `高山草` が 1 以上ある(出力を報告する。0 なら `minAlt` を 5 にして測り直し、その値を報告する)
  - [ ] `npm run check:sim` が最後まで動く(状態ハッシュは変わる。新しい値を報告する)
- **依存**: なし

## T10: 高山草の形と色を描く
- **目的**: T9 で足した高山草を 3D で描く。`src/render/palette.js` の `PLANT_COLORS` に `高山草: '#7f9c5c'` を足す。`src/render/plant-view.js` の `SHAPES` に `高山草` を足す。形は「草」より背の低い葉の束(高さ `(0.12 + 0.25 * f) * s`、葉 5 枚)に、元気なとき(`f > 0.4`)だけ小さな白い花(`ball`、`BLOOM_COLORS[2]` の色、大きさ `0.06 * s`)を 1〜2 個のせる。部品の数が増えるので、`CAPACITY` の `blade` を 9000 から 11000 に、`ball` を 5000 から 6000 にする
- **対象**: `src/render/palette.js`, `src/render/plant-view.js`
- **要件**: R3
- **参照ファイル**:
  - `src/render/plant-view.js:1-40`(変更対象。`SHAPES` と `CAPACITY`)
  - `src/render/palette.js:20-25`(変更対象。`PLANT_COLORS`)
- **受け入れ基準**:
  - [ ] `node -e "import('./src/render/palette.js').then(m => console.log(m.PLANT_COLORS['高山草']))"` が `#7f9c5c` を出す
  - [ ] `grep -n "高山草" src/render/plant-view.js` が `SHAPES` の中の 1 か所以上を出す
  - [ ] `npm run check:sim` のハッシュが変更前に控えた値と同じ(描画だけの変更)。ブラウザでの見た目は確かめられない旨を報告する
- **依存**: T9

## T11: 祖先の試走に坂と浅瀬を入れる
- **目的**: 祖先の事前進化(`evolvedFounder`)の評価に「浅瀬から坂を登れるか」を足す。今の平地の試走(`trialDistance`)は残し、新しい坂の試走 `trialClimb` の結果を足し合わせる。坂の試走では感覚 `waterAhead`・`slope` を実際の値にし、T5 の浮力(`applyWater`)をかける。骨格は次のとおり
  ```js
  import { applyWater } from './water.js';
  const RAMP_X = 1, RAMP_DEG = 15, RAMP_L = 20, TRIAL_WL = 0.5;   // 坂は x = 1 から +x 向きに 15°・長さ 20 m。床の上 0.5 m までは水（個体は x = 0 の浅瀬に置かれる）
  const RAMP_A = RAMP_DEG * Math.PI / 180;
  const rampH = (x) => x <= RAMP_X ? 0 : Math.min((x - RAMP_X) * Math.tan(RAMP_A), RAMP_L * Math.sin(RAMP_A));
  function climbWorld(R) {
    const w = trialWorld(R, 50);
    // 厚さ 1 m の板を RAMP_A だけ傾けて置く。上面が (RAMP_X, 0) から始まるように中心を決める
    const cx = RAMP_X + Math.cos(RAMP_A) * RAMP_L / 2 + Math.sin(RAMP_A) * 0.5;
    const cy = Math.sin(RAMP_A) * RAMP_L / 2 - Math.cos(RAMP_A) * 0.5;
    w.createCollider(R.ColliderDesc.cuboid(RAMP_L / 2, 0.5, 10).setTranslation(cx, cy, 0)
      .setRotation(qAxis({ x: 0, y: 0, z: 1 }, RAMP_A)).setFriction(CFG.GROUND_FRICTION));
    return w;
  }
  // 浅瀬から坂を登る試走。根の体節が最も遠くまで進んだ所の坂の高さ rampH(x)（m）を返す
  // （根の y を使うと、浮力で浮いただけでも値が出るため、坂の上の位置で測る）
  export function trialClimb(sim, genome, secs = 4) {
    const rng = sim.rng;
    const w = climbWorld(sim.R);
    const c = trialCreature(sim, w, genome, () => rng.range(-0.5, 0.5));   // おおむね +x（坂の方）を向ける
    c.masses = c.bodies.map((b) => b.mass());
    readPose(c);
    c.energy = c.maxE * 0.5;
    const s = c.sense = { ps: 0, pc: 0, pp: 0, cs: 0, cc: 0, cp: 0, kin: 1, size: 0, waterAhead: 0, slope: 0, temp: 0, up: 0 };
    const tx = RAMP_X + RAMP_L * Math.cos(RAMP_A), tz = 0;   // 坂の上を「食べ物」として感じさせる（trialSteer と同じ計算）
    let best = 0;
    for (let i = 0; i < secs / CFG.DT; i++) {
      if (i % 4 === 0) {
        const pos = c.bodies[0].translation(), q = c.bodies[0].rotation(), f = travelDir(c, q);
        const ax = pos.x + f.x * 2.5;
        s.waterAhead = rampH(ax) < TRIAL_WL ? 1 : 0;
        s.slope = clamp((rampH(ax) - rampH(pos.x)) / 2.5, -1, 1);
        // s.ps / s.pc / s.pp / s.up は trialSteer と同じ式で、目標 (tx, tz) に向けて求める
      }
      applyWater(c, TRIAL_WL, CFG.DT);
      tick(c, w);
      const x = c.bodies[0].translation().x;
      if (isFinite(x)) best = Math.max(best, rampH(x));
    }
    w.free();
    return best;
  }
  // evolvedFounder の score を次にする（平地の試走を 6 秒から 4 秒にし、坂の試走 4 秒を足す。世界の生成時間の増加を抑えるため）
  //   const score = (g) => trialDistance(sim, g, 4) / (0.6 + Math.sqrt(genomeStats(g).vol)) + CLIMB_W * trialClimb(sim, g, 4);
  const CLIMB_W = 1;   // 坂で登った高さ（m）の重み
  ```
  - `qAxis` は `./math.js` から、`clamp` は `./math.js` から import する(無ければ `body.js` の import 元を確かめる)。`trialWorld` の床の摩擦も `CFG.GROUND_FRICTION` にする
- **対象**: `src/sim/founder.js`
- **要件**: R3, R2
- **参照ファイル**:
  - `src/sim/founder.js`(変更対象。試走と事前進化)
  - `src/sim/water.js`(T5 の `applyWater`)
  - `src/sim/body.js:1-20`(`qAxis` 等の import 元)
- **受け入れ基準**:
  - [ ] `npm run check:sim` が最後まで動き、「世界の生成」の時間が計画時(9353 ms)の 1.4 倍以下(実測を報告する。超えたら `trialClimb` を 3 秒にして測り直す)
  - [ ] `node -e "import('@dimforge/rapier3d-compat').then(async ({ default: R }) => { await R.init(); const { Sim } = await import('./src/sim/index.js'); const { trialClimb } = await import('./src/sim/founder.js'); const sim = new Sim(R, 1); const v = [...sim.species.values()].map((s) => trialClimb(sim, s.rep, 4)).sort((a, b) => a - b); console.log(v.length, v[Math.floor(v.length / 2)].toFixed(2)); })"` が種の数と、坂で登った高さの中央値を出す。中央値が 0 より大きい(祖先が坂に乗れている)。値を報告する
  - [ ] `node tools/environment-check.mjs 9000 1,2` の出力を完了報告に書く
- **依存**: T5, T9

## T12: 同種が密集しているほど、遠くへ動くようにする
- **目的**: 周りの餌を取り合う同種が多いと遠くへ移動する傾向を、新しい遺伝子や神経の入力を足さずに入れる。`src/sim/body.js` の `driveMotors` で、推進 `go` に密集の項を足す
  ```js
  // 近くの同種が CROWD_FREE を超えた分だけ（CROWD_FREE 体ぶんで頭打ち）、歩みを速める
  const roam = CFG.CROWD_GO * Math.min(1, Math.max(0, ((c.crowd ?? 0) - CFG.CROWD_FREE) / CFG.CROWD_FREE));
  const go = Math.tanh(c.out[O_GO] + (g.seek ?? 0) * (c.ate > 0 ? -0.6 : 0.6) + roam);
  ```
  - `CFG.CROWD_GO: 0.8` を、`// 密集しているほど推進を強める量（神経の出力に足す値の上限）` のコメント付きで `src/sim/config.js` の密集の設定の近くに足す
  - 祖先の試走では `c.crowd` が 0 なので、試走の結果は変わらない
- **対象**: `src/sim/body.js`, `src/sim/config.js`
- **要件**: R4
- **参照ファイル**:
  - `src/sim/body.js:117-139`(変更対象。`driveMotors`)
  - `src/sim/config.js`(変更対象。密集の設定 `CROWD_*`)
- **受け入れ基準**:
  - [ ] `npm run check:sim` が最後まで動く(状態ハッシュは変わる。新しい値を報告する)
  - [ ] `node tools/environment-check.mjs 9000 1,2` の出力を完了報告に書き、T11 の完了報告の値と比べて速さの中央値がどう変わったかを書く
- **依存**: T9, T11

## T13: 山と移動を計測して調整する
- **目的**: T9〜T12 の後で、`node tools/environment-check.mjs 9000 1,2` と `node tools/diversity-check.mjs 9000 1,2` を実行し、山に登る個体・移動の速さ・多様性を確かめる。目標は各シードで「帯の個体」の 1 時点の最小が 1 以上、速さの中央値 0.5 m/秒以上。届かなければ次の順に 1 つずつ試し、最初に満たした組を採る: (1) `CROWD_GO` 1.5、(2) (1) に加えて `GROUND_FRICTION` 2.0、(3) (2) に加えて高山草の `minAlt` 5。どれも満たさなければ、目標に最も近い組を採り、その旨を報告する。値を変えるのは `src/sim/config.js` と `src/sim/plant-species.js` だけ
- **対象**: `src/sim/config.js`, `src/sim/plant-species.js`
- **要件**: R3, R4
- **参照ファイル**:
  - `src/sim/config.js`(変更対象。`CROWD_GO`・`GROUND_FRICTION`)
  - `src/sim/plant-species.js`(変更対象。高山草の `minAlt`)
  - `.agents/workflow/tasks.md`(「前提・解釈」の多様性の基準)
- **受け入れ基準**:
  - [ ] 採った組の `node tools/environment-check.mjs 9000 1,2` の出力全体と、試した組ごとの標高と速さの行を完了報告に書く(目標を満たせなかった場合は、その旨と最もよい値)
  - [ ] 採った組で、合計の上陸の割合が T7 の完了報告の値の 8 割以上
  - [ ] 採った組の `node tools/diversity-check.mjs 9000 1,2` の 1.00 年の行が、各シードで個体数と実効種数とも多様性の基準の 8 割以上
  - [ ] `npm run check:sim` の世界の生成時間・1 ステップ平均・区間ごとの所要時間を報告する
- **依存**: T10, T12

## T14: #35 の結果を計画の記録に書く
- **目的**: `docs/plans/environment-ui.md` に `## #35 坂と探索` の節を足す。変えた規則と設定値(高山草・`GROUND_FRICTION`・坂の試走・`CROWD_GO`)、前後の計測の表(T11・T12・T13 の完了報告の値。基準は T8 の節の #34 の後の値)、採った値と理由を書く
- **対象**: `docs/plans/environment-ui.md`
- **要件**: R3, R4
- **参照ファイル**:
  - `docs/plans/environment-ui.md`(変更対象。T8 で作った節の書き方に合わせる)
- **受け入れ基準**:
  - [ ] `docs/plans/environment-ui.md` に `## #35` で始まる見出しがあり、標高と速さの前後の表がある
- **依存**: T8, T13

<!-- グループ lakeplants: #12 湖の植物 -->

## T15: 水面に浮かぶ草「浮草」を足す
- **目的**: 湖を餌場にするため、水面に浮かぶ草「浮草」を植物の種類に足す。浮草は、水深が `float` の範囲の水面に生え、当たり判定を地面ではなく水面の高さに置く(浮力で水面近くに浮く個体が食べられるように)
  - `src/sim/plant-species.js` の `PLANT_SPECIES` の**末尾**に足す: `{ name: '浮草', temp: [6, 32], moist: [0.6, 1.0], maxE: 26, grow: 1.2, spread: 4, rate: 0.10, life: 150, col: 0.8, hh: 0.08, soft: true, float: [0.4, 8], soil: [1, 1, 1, 1] }`。先頭のコメントに `float: [最小, 最大] の水深(m)の水面に浮かんで生える` を足す
  - `src/sim/environment.js` の `suitability`: 今の `if (sp.wet) … else if (h < wl + 0.05) return 0;` の前に `if (sp.float) { const d = wl - h; if (d < sp.float[0] || d > sp.float[1]) return 0; }` を置き、続く分岐を `else if (sp.wet) …` / `else if (h < wl + 0.05) return 0;` にする(浮草は陸の判定を通らない)
  - `src/sim/flora.js`:
    - `add` の高さ: `const y = sp.float ? this.climate.water : this.terrain.heightAt(x, z);`
    - `update` の追従: `const ny = p.sp.float ? wl : this.terrain.heightAt(p.x, p.z);`(0.05 m 以上ずれたら当たり判定を動かす処理は今のまま)
    - `update` の水没の傷み: `if (!p.sp.wet && !p.sp.float && ny < wl - 0.1)` にする
  - 浮草は草類の枠(`soft`)に入り、枠の上限は変えない
  - 描画は T17 で足す
- **対象**: `src/sim/plant-species.js`, `src/sim/environment.js`, `src/sim/flora.js`
- **要件**: R5
- **参照ファイル**:
  - `src/sim/plant-species.js`(変更対象)
  - `src/sim/environment.js:10-17`(変更対象。`suitability`)
  - `src/sim/flora.js:48-100`(変更対象。`add` と `update`)
- **受け入れ基準**:
  - [ ] `node -e "import('./src/sim/index.js').then(m => console.log(m.PLANT_SPECIES.length, m.PLANT_SPECIES.at(-1).name))"` が `10 浮草` を出す
  - [ ] `node tools/environment-check.mjs 9000 1` の「植物（最後の時点）」の行に `浮草` が 1 以上ある(出力を報告する)
  - [ ] `npm run check:sim` が最後まで動く(状態ハッシュは変わる。新しい値を報告する)
- **依存**: なし

## T16: 水棲度の高い個体ほど浮草から多く得る。水棲度のばらつきを集計する
- **目的**: 浮草を湖のニッチにするため、水棲度 `aqua` が高い個体ほど浮草から多くのエネルギーを得るようにする。あわせて、`computeDiversity` の `traitSd` で 0 に固定されている `tTol` と `aqua` のばらつきを実際の値にする
  - `src/sim/interactions.js` の `graze`: `const gain = dmg * 0.85 * CFG.FOOD_GAIN * cr.eff.soft;` に、浮草のときだけ `* (CFG.FLOAT_FEED_MIN + (1 - CFG.FLOAT_FEED_MIN) * (cr.aqua ?? 0))` を掛ける(浮草でなければ 1)
  - `CFG.FLOAT_FEED_MIN: 0.4` を、`// 水棲度 0 の個体が浮草から得られる割合（水棲度 1 で 1 倍）` のコメント付きで `src/sim/config.js` の水棲適応の設定の近くに足す
  - `src/sim/diversity.js` の `traitSd`: `tTolArr[i] = c.tTol`、`aquaArr[i] = c.aqua ?? 0` の配列を足し、`tTol: sd(tTolArr), aqua: sd(aquaArr)` にする。「まだ実装されていない」のコメントを消す
- **対象**: `src/sim/interactions.js`, `src/sim/config.js`, `src/sim/diversity.js`
- **要件**: R5
- **参照ファイル**:
  - `src/sim/interactions.js:36-53`(変更対象。`graze`)
  - `src/sim/diversity.js:38-60`(変更対象。`traitSd`)
  - `src/sim/config.js`(変更対象。水棲適応の設定)
- **受け入れ基準**:
  - [ ] `npm run check:sim` が最後まで動く(状態ハッシュは変わる。新しい値を報告する)
  - [ ] `node -e` で 600 ステップ進めた世界の `computeDiversity(sim).traitSd.aqua` と `.tTol` が 0 より大きいことを示し、値を報告する
- **依存**: T15

## T17: 浮草の形と色を描く
- **目的**: T15 で足した浮草を 3D で描く。`src/render/palette.js` の `PLANT_COLORS` に `浮草: '#6f9e4a'` を足す。`src/render/plant-view.js` の `SHAPES` に `浮草` を足す。形は水面(植物の `y`)に置いた平たい円盤(`disc`)を 3〜5 枚、植物の中心から `0.6 * s` 以内にばらして置く(大きさ `0.25〜0.4 * s`、元気さ `f` で大きさを変える)。円盤が増えるので、`CAPACITY` の `disc` を 1800 から 4000 にする
- **対象**: `src/render/palette.js`, `src/render/plant-view.js`
- **要件**: R5
- **参照ファイル**:
  - `src/render/plant-view.js:1-40`(変更対象。`SHAPES` と `CAPACITY`。`disc` の使い方は 35 行目の例)
  - `src/render/palette.js:20-25`(変更対象。`PLANT_COLORS`)
- **受け入れ基準**:
  - [ ] `node -e "import('./src/render/palette.js').then(m => console.log(m.PLANT_COLORS['浮草']))"` が `#6f9e4a` を出す
  - [ ] `grep -n "浮草" src/render/plant-view.js` が `SHAPES` の中の 1 か所以上を出す
  - [ ] `npm run check:sim` のハッシュが変更前に控えた値と同じ(描画だけの変更)。ブラウザでの見た目は確かめられない旨を報告する
- **依存**: T15

## T18: 湖の植物を計測して調整する
- **目的**: T15・T16 の後で、`node tools/environment-check.mjs 9000 1,2` と `node tools/diversity-check.mjs 9000 1,2` を実行し、浮草の数・水中の時間・水中に長くいた個体の水棲度・多様性を確かめる。目標は水中に長くいた個体の水棲度の平均が全体の平均より 0.1 以上高いこと(湖で暮らす個体が、水に適応している)。届かなければ次の順に 1 つずつ試し、最初に満たした組を採る: (1) `FLOAT_FEED_MIN` 0.2、(2) (1) に加えて浮草の `maxE` 40。どれも満たさなければ、目標に最も近い組を採り、その旨を報告する。最後に `npm run check:diversity`(3 年・3 シード。4〜5 分。長ければ `run_in_background` で実行する)の「判定」の節を報告する。値を変えるのは `src/sim/config.js` と `src/sim/plant-species.js` だけ
- **対象**: `src/sim/config.js`, `src/sim/plant-species.js`
- **要件**: R5
- **参照ファイル**:
  - `src/sim/config.js`(変更対象。`FLOAT_FEED_MIN`)
  - `src/sim/plant-species.js`(変更対象。浮草の `maxE`)
  - `docs/plans/biodiversity.md:211-230`(Issue #10 の結果。判定の ○ の数の比較元)
- **受け入れ基準**:
  - [ ] 採った組の `node tools/environment-check.mjs 9000 1,2` の出力全体と、試した組ごとの「水中の時間」の行を完了報告に書く(目標を満たせなかった場合は、その旨と最もよい値)
  - [ ] 採った組の `node tools/diversity-check.mjs 9000 1,2` の 1.00 年の行が、各シードで個体数と実効種数とも多様性の基準の 8 割以上
  - [ ] 採った組の `npm run check:diversity` の「判定」の節を報告し、○ の数を Issue #10 の結果(5 つのうち 2 つ)と比べる
- **依存**: T16

## T19: #12 の結果を計画の記録に書く
- **目的**: `docs/plans/environment-ui.md` に `## #12 湖の植物` の節を足す。浮草の定義と、水棲度による得られる割合(`FLOAT_FEED_MIN`)、前後の計測の表(T18 の完了報告の値。基準は #35 の節の後の値)、`check:diversity` の判定、採った値と理由を書く
- **対象**: `docs/plans/environment-ui.md`
- **要件**: R5
- **参照ファイル**:
  - `docs/plans/environment-ui.md`(変更対象。前の節の書き方に合わせる)
- **受け入れ基準**:
  - [ ] `docs/plans/environment-ui.md` に `## #12` で始まる見出しがあり、水中の時間と水棲度の前後の表と、`check:diversity` の判定がある
- **依存**: T14, T18

<!-- グループ segments: #38 体節の多い体が自然に有利になる環境 -->

## T20: 水の抵抗を体節の向きで変える
- **目的**: 水中の減衰を、向きによらない `setLinearDamping(2.5 * wetK)` から、体節の長軸に沿う動きは小さく、横切る動きは大きく抑える抵抗に変える。くねらせて泳ぐ長い体が物理の結果として速く進めるようになる。T5 の `applyWater` を次のように広げる
  ```js
  import { qRot } from './math.js';
  const AXIS = { x: 0, y: 1, z: 0 };   // 体節の長軸（カプセルの向き）
  // wetK: 水中の費用と減衰の倍率（1 − AQUA_WATER_CUT × aqua）。省略時は 1（祖先の試走）
  export function applyWater(c, wl, dt, wetK = 1) {
    let sub = 0;
    for (let i = 0; i < c.bodies.length; i++) {
      const P = c.pos[i];
      if (P.y < wl) sub++;
      const s = submerged(P.y, c.genome.parts[i].r, wl);
      if (s <= 0) continue;
      const b = c.bodies[i], m = c.masses[i] * s * dt, v = b.linvel(), a = qRot(c.rot[i], AXIS);
      const vp = v.x * a.x + v.y * a.y + v.z * a.z, px = vp * a.x, py = vp * a.y, pz = vp * a.z;
      const kPar = CFG.WATER_DRAG_PAR * wetK, kPerp = CFG.WATER_DRAG_PERP * wetK;
      b.applyImpulse({
        x: -m * (kPar * px + kPerp * (v.x - px)),
        y: -m * (kPar * py + kPerp * (v.y - py)) + c.masses[i] * G * CFG.BUOYANCY * s * dt,
        z: -m * (kPar * pz + kPerp * (v.z - pz)),
      }, true);
    }
    return sub;
  }
  ```
  - `src/sim/creatures.js` の `updateCreatures`: `sub = applyWater(c, wl, dt, wetK)` にする(`wetK` の計算を `applyWater` の呼び出しより前に移す)。水中の体節に `setLinearDamping(2.5 * wetK)` をかける処理と、`c.wasWet` で減衰を 0.1 に戻す処理を消す(減衰は生成時の 0.1 のまま)。`c.wasWet` を他で使っていなければ一緒に消す
  - `CFG.WATER_DRAG_PERP: 2.5`(`// 水の抵抗：体節の長軸を横切る動きの係数（1 秒あたり）`)と `CFG.WATER_DRAG_PAR: 0.5`(`// 水の抵抗：長軸に沿う動きの係数。横切る動きより小さいので、くねらせると前に進む`)を `src/sim/config.js` の `BUOYANCY` の近くに足す
- **対象**: `src/sim/water.js`, `src/sim/creatures.js`, `src/sim/config.js`
- **要件**: R6
- **参照ファイル**:
  - `src/sim/water.js`(変更対象。T5 の `applyWater`)
  - `src/sim/creatures.js:196-225`(変更対象。水中の処理)
  - `src/sim/config.js`(変更対象。`BUOYANCY` の近く)
- **受け入れ基準**:
  - [ ] `grep -n "setLinearDamping(2.5" src/sim/creatures.js` が何も出さない
  - [ ] `npm run check:sim` が最後まで動く(状態ハッシュは変わる。新しい値と区間ごとの所要時間を報告する)
  - [ ] `node tools/environment-check.mjs 9000 1,2` の出力を完了報告に書き、T18 の完了報告の値と比べて上陸の割合・水中の時間がどう変わったかを書く
- **依存**: なし

## T21: 体節を増やしたときの人為的な不利を減らす
- **目的**: 体節を 1 つ増やした変異体が繁殖と費用で過度に不利にならないようにする。体節に直接の得は与えない
  - `src/sim/genetics.js` の `compatibility`: 先頭の `if (Math.abs(a.parts.length - b.parts.length) >= 2) return 0;` を消す(体節数の差は `geneDistance` の `0.2 * |差|` で、差が大きいほど雑種が育ちにくくなる)
  - `src/sim/genetics.js` の `recognizes`: `dn * (0.3 + 1.5 * chooser.pick)` を `dn * (0.15 + 0.75 * chooser.pick)` にする
  - `src/sim/creatures.js` の `updateCreatures` の基礎代謝: `0.055 * c.nParts + 0.03 * c.joints.length` を `0.03 * c.nParts + 0.015 * c.joints.length` にする(体積の項 `0.65 * c.vol` はそのまま)
  - `src/sim/speciation.js` などに体節数の差で 0 を返す判定が別にあれば、完了報告に書く(変えない)
- **対象**: `src/sim/genetics.js`, `src/sim/creatures.js`
- **要件**: R6
- **参照ファイル**:
  - `src/sim/genetics.js:226-240`(変更対象。`compatibility` と `recognizes`)
  - `src/sim/creatures.js:192-196`(変更対象。基礎代謝)
  - `src/sim/speciation.js:1-20`(種の判定。確認だけ)
- **受け入れ基準**:
  - [ ] `node -e "import('./src/sim/index.js').then(m => { const r = m.makeRng(1); const a = m.randomGenome(r), b = m.cloneGenome(a); b.parts.push({ ...b.parts.at(-1), parent: 0 }); b.parts.push({ ...b.parts.at(-1), parent: 0 }); console.log(m.compatibility(a, b) > 0); })"` が `true` を出す(体節数が 2 違っても 0 にならない)
  - [ ] `npm run check:sim` が最後まで動く(状態ハッシュは変わる。新しい値を報告する)
- **依存**: T20

## T22: 3 年動かして体節数の分布を確かめ、調整する
- **目的**: T20・T21 の後で、`node tools/environment-check.mjs 27000 1,2`(10 分以内。`run_in_background` で実行してよい)を実行し、最後の時点の体節数の分布(中央値・上位 10%・最大)を T4 の完了報告の「3 年の基準」と比べる。目標はどちらかのシードで中央値か上位 10% が基準より大きいこと。届かなければ次の順に 1 つずつ試し、最初に満たした組を採る: (1) `WATER_DRAG_PERP` 4、(2) (1) に加えて基礎代謝の体節の係数を `0.02 * c.nParts + 0.01 * c.joints.length`。どれも満たさなければ、最も体節数が増えた組を採り、その旨を報告する(次のサイクルで検討する)。あわせて `npm run check:diversity` の「判定」の節と、`npm run check:sim` の 1 個体あたりの剛体の数(`生物` と物理の区間)を報告する(重さは抑えない方針なので報告だけ)。値を変えるのは `src/sim/config.js` と `src/sim/creatures.js` だけ
- **対象**: `src/sim/config.js`, `src/sim/creatures.js`
- **要件**: R6
- **参照ファイル**:
  - `src/sim/config.js`(変更対象。`WATER_DRAG_PERP`)
  - `src/sim/creatures.js:192-196`(変更対象。基礎代謝の体節の係数)
- **受け入れ基準**:
  - [ ] 採った組の `node tools/environment-check.mjs 27000 1,2` の出力全体と、試した組ごとの体節数の行を完了報告に書く(目標を満たせなかった場合は、その旨)
  - [ ] 採った組の `npm run check:diversity` の「判定」の節を報告し、○ の数が T18 の完了報告の値より少なくない(少なければ、その旨と理由の見当を書く)
  - [ ] `npm run check:sim` の 1 ステップ平均・物理の区間・生物と植物の数を報告する
- **依存**: T21

## T23: #38 の結果を計画の記録に書く
- **目的**: `docs/plans/environment-ui.md` に `## #38 体節の多い体が自然に有利になる環境` の節を足す。水の抵抗の式と係数、繁殖の壁と固定費の変更、3 年の体節数の分布の前後の表(T4 の「3 年の基準」と T22)、`check:diversity` の判定、物理の時間、採った値と理由、うまくいかなかった点を書く
- **対象**: `docs/plans/environment-ui.md`
- **要件**: R6
- **参照ファイル**:
  - `docs/plans/environment-ui.md`(変更対象。前の節の書き方に合わせる)
- **受け入れ基準**:
  - [ ] `docs/plans/environment-ui.md` に `## #38` で始まる見出しがあり、体節数の分布の前後の表がある
- **依存**: T19, T22

<!-- グループ ui-parts: #37 前半 共通部品とアイコン -->

## T24: SVG のアイコンを作る
- **目的**: UI で使い回す SVG のアイコンを、新しいファイル `src/ui/icons.js` にまとめる。DOM に依存しない(文字列を返す)ので Node でも読める。骨格は次のとおり
  ```js
  // ===== SVG のアイコン（絵文字は使わない） =====
  // 24×24 の座標で描く。線は stroke="currentColor"・stroke-width 2・丸い端、塗りは fill="currentColor"（ボタンの文字色に合わせる）
  const PATHS = {
    pause: '…', play: '…', play2: '…', play3: '…', ffwd: '…',   // 速度: 停止・×1（三角 1 つ）・×3（三角 2 つ）・×8（三角 3 つ）・最大（早送り + 縦棒）
    clear: '…', rain: '…', snow: '…', drought: '…', ice: '…',    // 天候: 晴（太陽）・雨（雲 + 雨粒）・雪（雲 + 点）・干ばつ（太陽 + ひび割れた地面）・氷河期（雪の結晶）
    panel: '…', perf: '…', world: '…',                          // パネル（右に列のある四角）・性能（折れ線グラフ）・新しい世界（地球）
  };
  export const ICON_NAMES = Object.keys(PATHS);
  // name のアイコンの SVG 文字列。label を渡すと role="img" と aria-label を付け、無ければ aria-hidden="true"
  export function iconSvg(name, { size = 16, label = '' } = {}) {
    const body = PATHS[name];
    if (!body) throw new Error(`知らないアイコン ${name}`);
    const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
    return `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" ${a11y} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  }
  // 気候から天候のアイコンの名前を返す（ヘッダーの今の表示の規則と同じ: 雨で 1℃ 未満は雪、氷河期は ice）
  export function weatherIcon(climate) {
    if (climate.iceAge) return 'ice';
    if (climate.weather === 'rain') return climate.temp < 1 ? 'snow' : 'rain';
    return climate.weather === 'drought' ? 'drought' : 'clear';
  }
  ```
  - 各アイコンの中身(`path`・`circle`・`rect` など)は、24×24 の中に収まるよう自分で描く。塗りが要る部品(停止の棒、再生の三角)は要素に `fill="currentColor" stroke="none"` を付ける
- **対象**: `src/ui/icons.js`
- **要件**: R9
- **参照ファイル**:
  - `src/ui/header.js`(天候の表示の今の規則)
- **受け入れ基準**:
  - [ ] `node -e "import('./src/ui/icons.js').then(m => { for (const n of m.ICON_NAMES) if (!m.iconSvg(n).startsWith('<svg')) throw n; console.log(m.ICON_NAMES.length, m.weatherIcon({ weather: 'rain', temp: 0 }), m.weatherIcon({ weather: 'clear', temp: 20, iceAge: true })); })"` が `13 snow ice` を出す
  - [ ] `node -e "const s = require('fs').readFileSync('src/ui/icons.js', 'utf8'); console.log(/\p{Extended_Pictographic}/u.test(s))"` が `false` を出す(絵文字を使っていない)
  - [ ] `npm run check:sim` のハッシュが変更前に控えた値と同じ
- **依存**: なし

## T25: 食性・適温・水棲度の帯を共通の部品にする
- **目的**: 個体タブの「生き方」(食性・適温・水棲度の帯)を、系統樹の種のカード(T31)でも使えるよう、新しいファイル `src/ui/traits.js` の部品にする。個体タブはこの部品を使うように書き換え、見た目と値は今のまま保つ。骨格は次のとおり
  ```js
  import { CFG, dietEfficiency, dietName } from '../sim/index.js';
  export const T_MIN = -10, T_MAX = 42;   // 適温の帯を描く温度軸（℃）。inspector-panel.js から移す
  // ゲノムから生き方の値を求める（makeCreatureState と同じ既定値）
  export function traitsOfGenome(g) { return { eff: dietEfficiency(g), diet: dietName(g), topt: g.topt ?? 17, tTol: g.tTol ?? CFG.COMFORT, aqua: g.aqua ?? 0 }; }
  // 個体から（個体が持っている値を使う）
  export function traitsOfCreature(c) { return { eff: c.eff, diet: dietName(c.genome), topt: c.topt, tTol: c.tTol, aqua: c.aqua ?? 0 }; }
  // container の中に 3 行（食性・適温・水棲度）を作り、値を入れる。はじめの 1 回だけ DOM を作り、以後は値だけ更新する
  // 要素は id ではなく class で探す（同じページに複数置けるように）。中身の構造と class は今の index.html の .trait / .mini3 / .tband と同じ
  export function renderTraits(container, t) { … }
  ```
  - `index.html` の個体タブの「生き方」の 3 つの `.trait`(`#i-diet` から `#a-text` まで)を、空の `<div id="i-traits"></div>` に置き換える
  - `src/ui/panels/inspector-panel.js` の `drawTraits` を `renderTraits($('i-traits'), traitsOfCreature(c))` に置き換え、`T_MIN`・`T_MAX` を traits.js から使う。各帯の `title`(数値の説明)は今と同じ文言を renderTraits で付ける
  - `src/styles.css` に id で指定した規則があれば class に書き換える
- **対象**: `src/ui/traits.js`, `src/ui/panels/inspector-panel.js`, `index.html`, `src/styles.css`
- **要件**: R8
- **参照ファイル**:
  - `src/ui/panels/inspector-panel.js:64-82`(変更対象。今の `drawTraits`)
  - `index.html:95-110`(変更対象。「生き方」の DOM)
  - `src/styles.css:110-118`(変更対象。`.trait` などの規則)
- **受け入れ基準**:
  - [ ] `node -e "import('./src/ui/traits.js').then(async m => { const s = await import('./src/sim/index.js'); const t = m.traitsOfGenome(s.randomGenome(s.makeRng(1))); console.log(Object.keys(t).join(','), typeof t.eff.soft); })"` が `eff,diet,topt,tTol,aqua number` を出す
  - [ ] `grep -n 'id="d-soft"\|id="t-band"\|id="a-bar"' index.html` が何も出さない
  - [ ] `npm run check:sim` のハッシュが変更前に控えた値と同じ。ブラウザでの見た目は確かめられない旨を報告する
- **依存**: なし

## T26: グラフの表示範囲を切り替え、長い期間は振れ幅の帯で描く
- **目的**: 長く動かしてもグラフの直近の変化が読めるよう、`src/ui/charts.js` に表示範囲の部品を足し、統計タブに範囲の切り替え(直近 1 年・直近 5 年・全期間。既定は直近 1 年)を置く。系統樹(T30)でも同じ部品を使う。骨格は次のとおり
  ```js
  // 表示範囲。years は直近何年を描くか（Infinity は全期間）
  export const RANGES = [{ id: '1y', label: '1 年', years: 1 }, { id: '5y', label: '5 年', years: 5 }, { id: 'all', label: '全期間', years: Infinity }];
  // 範囲 id と、記録の最初と最後の時刻から、描く区間 { t0, t1 } を返す（純粋関数。知らない id は全期間）
  export function timeWindow(range, tFirst, tLast) {
    const r = RANGES.find((x) => x.id === range) ?? RANGES[2];
    return { t0: Math.max(tFirst, tLast - r.years * CFG.YEAR), t1: tLast };
  }
  // 目盛の間隔（年）。区間の長さ（年）が 1.5 以下なら季節（0.25 年）、8 以下なら 1 年、それより長ければ 5 年
  export function tickStep(years) { return years <= 1.5 ? 0.25 : years <= 8 ? 1 : 5; }
  // 区間 [t0, t1] の点を、cols 本の列に分けて { t, min, max, last } にまとめる（純粋関数。点の無い列は飛ばす）
  export function bucketize(points, get, t0, t1, cols) { … }
  // lineChart(cv, stats, series, colors, { range = 'all' } = {})
  //   区間の外の点は描かない。区間内の点の数が描く幅（w - L - R）の px 数より多いときは bucketize して、
  //   最小〜最大を透明度 0.25 の帯で、各列の last を線で描く。目盛は tickStep で決め、0.25 年刻みのときは季節名（Climate.seasonName）を、それ以外は「N年」を書く
  ```
  - `index.html` の統計タブの先頭(群島の節の前)に、範囲の切り替え `<div class="seg" role="group" aria-label="グラフの表示範囲" id="chart-range">` と 3 つのボタン(`data-range="1y"` など、文字は RANGES の label)を置く
  - `src/ui/panels/stats-panel.js`: constructor で `this.range = '1y'` とし、`#chart-range` のボタンを押したら `this.range` を変えて `aria-pressed` を付け直す(次の定期更新で描き直される)。3 つの `lineChart` に `{ range: this.range }` を渡す
  - `src/styles.css`: パネルの中の `.seg` の大きさを、ヘッダーのものより小さくする規則を足す(`.pane .seg button` など)
- **対象**: `src/ui/charts.js`, `src/ui/panels/stats-panel.js`, `index.html`, `src/styles.css`
- **要件**: R10
- **参照ファイル**:
  - `src/ui/charts.js`(変更対象。`lineChart`)
  - `src/ui/panels/stats-panel.js:1-30`(変更対象)
  - `index.html:52-60`(変更対象。統計タブの先頭)
  - `src/sim/climate.js:18-21`(季節名の求め方)
- **受け入れ基準**:
  - [ ] `node -e "import('./src/ui/charts.js').then(m => console.log(JSON.stringify(m.timeWindow('1y', 0, 3000)), JSON.stringify(m.timeWindow('all', 10, 3000)), m.tickStep(1), m.tickStep(5), m.tickStep(12), m.bucketize([{ t: 0, v: 1 }, { t: 1, v: 3 }, { t: 2, v: 2 }], (p) => p.v, 0, 2, 1).length))"` が `{"t0":2700,"t1":3000} {"t0":10,"t1":3000} 0.25 1 5 1` を出す
  - [ ] `grep -c 'data-range=' index.html` が `3` を出す
  - [ ] `npm run check:sim` のハッシュが変更前に控えた値と同じ。ブラウザでの見た目は確かめられない旨を報告する
- **依存**: T25

<!-- グループ ui-tree: #36 系統樹と種のカード -->

## T27: 種ごとの個体数の推移を記録し、体の静止姿勢を求める関数を切り出す
- **目的**: 種のカード(T31)で使うデータを sim に用意する。振る舞いは変えない(状態ハッシュは変わらない)
  - `src/sim/stats.js` の `recordStats` の最後に、種ごとの個体数の推移を足す
    ```js
    const HIST_MAX = 120;   // 種ごとの推移の点の上限。超えたら 1 つおきに間引く（最後の点は残る）
    for (const sp of sim.species.values()) {
      const hn = sp.histN;
      if (sp.extinct !== null && (!hn || hn[hn.length - 1] === 0)) continue;   // 絶滅後は 0 を 1 点足したら止める
      (sp.histT ??= []).push(sim.t); (sp.histN ??= []).push(sp.extinct === null ? sp.count : 0);
      if (sp.histT.length > HIST_MAX) { sp.histT = sp.histT.filter((_, i) => i % 2 === 0); sp.histN = sp.histN.filter((_, i) => i % 2 === 0); }
    }
    ```
  - `src/sim/body.js` の `buildBody` の先頭の、体節ごとの姿勢 `tf` を求めるループを `export function restTransforms(genome, yaw = 0)`(戻り値は `[{ q, p }]`。今の `tf` と同じ)に切り出し、`buildBody` はそれを呼ぶ
  - `src/sim/index.js` から `restTransforms` を export する(`body.js` から)
- **対象**: `src/sim/stats.js`, `src/sim/body.js`, `src/sim/index.js`
- **要件**: R8
- **参照ファイル**:
  - `src/sim/stats.js`(変更対象)
  - `src/sim/body.js:21-35`(変更対象。`buildBody` の姿勢の計算)
  - `src/sim/index.js`(変更対象。export)
  - `tools/state-hash.mjs`(ハッシュに種の中身が入らないことの確認)
- **受け入れ基準**:
  - [ ] `npm run check:sim` のハッシュが変更前に控えた値と同じ
  - [ ] `node -e` で 600 ステップ進めた世界の、生きている種の 1 つで `histT.length === histN.length` かつ 1 以上で、`restTransforms(sp.rep).length === sp.rep.parts.length` であることを示す
- **依存**: なし

## T28: 選んだ種の詳しい情報を Worker から写しへ届ける
- **目的**: 種の代表ゲノム `rep` と個体数の推移(T27 の `histT`・`histN`)は大きいので、毎回は送らず、主スレッドが選んでいる種(`speciesId`)の分だけを送る
  - `src/app/island-snapshot.js`:
    - `speciesData` で `rep` に加えて `histT`・`histN` も外す: `const { rep, histT, histN, ...rest } = sp; return rest;`
    - `packPanels(sim, sent, selectedId, sections, speciesId = null)`: `out.speciesDetail` を足す。`speciesId` が null でなく、その種があれば `{ id, rep: sp.rep, histT: (sp.histT ?? []).slice(), histN: (sp.histN ?? []).slice() }`、無ければ `null`
  - `src/app/island-worker.js` の `frame` 要求: `packPanels(…, msg.speciesId ?? null)` を渡す。要求の形のコメントに `speciesId` を足す
  - `src/app/sim-mirror.js`: constructor に `this.speciesDetail = null;`。`applyPanels` で `this.speciesDetail = p.speciesDetail ?? null;`
  - `tools/mirror-check.mjs`: 生きている種の id を `speciesId` に渡して packPanels を呼び、写しの `speciesDetail.rep.parts.length > 0` と `histT.length === histN.length` を確かめるケースを 1 つ足す(既存のケースの書き方に合わせる)
- **対象**: `src/app/island-snapshot.js`, `src/app/island-worker.js`, `src/app/sim-mirror.js`, `tools/mirror-check.mjs`
- **要件**: R8
- **参照ファイル**:
  - `src/app/island-snapshot.js:30-50`(変更対象。`packPanels` と `speciesData`)
  - `src/app/island-worker.js:20-30`(変更対象。`frame` 要求)
  - `src/app/sim-mirror.js:45-60`(変更対象。`applyPanels`)
  - `tools/mirror-check.mjs`(変更対象。確認のケース)
- **受け入れ基準**:
  - [ ] `node tools/mirror-check.mjs` の最後の行が `すべて OK`(足したケースも通る)
  - [ ] `node tools/island-runner-check.mjs` の最後の行が `すべて OK`
  - [ ] `npm run check:sim` のハッシュが変更前に控えた値と同じ
- **依存**: T27

## T29: 系統樹で選んだ種をストアに置き、要求に載せる
- **目的**: 系統樹で選んだ種の id をストアの `treeSpecies` に置き、`IslandRunner` が `frame` 要求に `speciesId` として載せる(T28 の受け口)
  - `src/app/store.js`: 状態の説明に `treeSpecies … 系統樹で選んでいる種の id（無ければ null）` を足し、初期値 `treeSpecies: null` を足す
  - `src/app/island-runner.js`: constructor に `this.speciesId = null`。`fetchFrame` の要求に `speciesId: this.speciesId` を足す。`advance(dtr, speed, { selectedId = null, speciesId = null, profile = false } = {})` で `this.speciesId = speciesId` にする
  - `src/app/main.js`: `islands.advance(…)` に `speciesId: store.get().treeSpecies ?? null` を渡す。新しい世界を始めるとき(`start` の `store.set({ sim: null, … })`)と見る島を切り替えるとき(`switchIsland` の `store.set({ selected: null, follow: false })`)に `treeSpecies: null` も入れる
- **対象**: `src/app/store.js`, `src/app/island-runner.js`, `src/app/main.js`
- **要件**: R8
- **参照ファイル**:
  - `src/app/store.js:15-36`(変更対象)
  - `src/app/island-runner.js:52-60`(変更対象。`fetchFrame`)
  - `src/app/island-runner.js:92-110`(変更対象。`advance`)
  - `src/app/main.js:85-130`(変更対象。島の切り替えと毎フレームの処理)
- **受け入れ基準**:
  - [ ] `node tools/island-runner-check.mjs` の最後の行が `すべて OK`
  - [ ] `grep -n "treeSpecies" src/app/main.js src/app/store.js` が 4 行以上を出す(初期値・advance・新しい世界・島の切り替え)
  - [ ] `npm run check:sim` のハッシュが変更前に控えた値と同じ
- **依存**: T28

## T30: 系統樹に絞り込み・表示範囲・太さ・選択を入れる
- **目的**: 種が増えても系統樹が見やすいようにし、種をクリックで選べるようにする。並べ方の計算は DOM に依存しない新しいファイル `src/ui/tree-layout.js` に移し、Node で確かめられるようにする
  - `src/ui/tree-layout.js`:
    ```js
    // 表示する種と、その祖先を深さ優先の並びで返す（純粋関数）
    //   scope: 'live' = 現存種とその祖先だけ / 'all' = 今の規則（現存種と、peak >= 2 か total >= 3 の絶滅種）
    //   t0: 描く区間の始まり。（extinct ?? 今）が t0 より前に終わった種は、表示する種の祖先でなければ外す
    export function treeOrder(speciesList, scope, t0, now) { … }   // 今の tree-panel.js の treeOrder の並べ方を使う
    // 選んだ種の祖先と子孫の id の集合（自分を含む）
    export function lineageIds(speciesList, id) { … }
    ```
  - `src/ui/panels/tree-panel.js`:
    - constructor を `(store, colors)` にし、canvas のクリックで行を求め(`Math.floor((y - 14 + ROW_H / 2) / ROW_H)`)、その種の id を `store.set({ treeSpecies: 同じ id なら null、違えば id })` にする
    - 表示の切り替え `#tree-scope`(`現存の系統`・`すべて`。既定は `live`)と、表示範囲 `#tree-range`(T26 の `RANGES`。既定は `5y`)のボタンを constructor でつなぎ、選んだボタンに `aria-pressed` を付ける
    - 横軸は T26 の `timeWindow` の `[t0, t1]` で描き、始まりが t0 より前の線は t0 から描く。目盛は `tickStep`
    - 現存種の線の太さを `2 + 4 * Math.sqrt(count / 現存種の最大の count)` にする
    - 選んだ種があれば、その行の背景を `COL.line` で塗り、`lineageIds` に入らない種を `globalAlpha = 0.3` で描く。選んだ種は絶滅種でも名前を出す
  - `index.html`: 系統樹タブの `.tree-note`(「ホバーで詳細」の文)を、2 つの切り替え(`.seg`)と凡例に置き換える。凡例は `.legend` の書き方で、太線 = 現存種・細線 = 絶滅種・縦の細線 = 分岐・赤い印 = 絶滅の時点 を、線の見本(`<i>`)と短い語で示す。種の判定の説明は `title` に残す
  - `src/app/main.js`: `new TreePanel(COL)` を `new TreePanel(store, COL)` にする
- **対象**: `src/ui/tree-layout.js`, `src/ui/panels/tree-panel.js`, `index.html`, `src/app/main.js`
- **要件**: R7
- **参照ファイル**:
  - `src/ui/panels/tree-panel.js`(変更対象。今の並べ方と描き方)
  - `index.html:136-140`(変更対象。系統樹タブ)
  - `src/ui/charts.js`(T26 の `RANGES`・`timeWindow`・`tickStep`)
  - `src/app/main.js:45-55`(変更対象。パネルの登録)
- **受け入れ基準**:
  - [ ] `node -e "import('./src/ui/tree-layout.js').then(m => { const sp = [{ id: 1, parent: null, born: 0, extinct: 10, peak: 5, total: 9 }, { id: 2, parent: 1, born: 5, extinct: null, count: 3, peak: 3, total: 3 }, { id: 3, parent: 1, born: 6, extinct: 8, peak: 1, total: 1 }]; console.log(m.treeOrder(sp, 'live', 0, 20).map(s => s.id).join(','), m.treeOrder(sp, 'all', 0, 20).map(s => s.id).join(','), [...m.lineageIds(sp, 2)].sort().join(',')); })"` が `1,2 1,2 1,2` を出す
  - [ ] `grep -n "ホバー" index.html src/ui/panels/tree-panel.js` が何も出さない
  - [ ] `npm run check:sim` のハッシュが変更前に控えた値と同じ。ブラウザでの見た目は確かめられない旨を報告する
- **依存**: T26, T29

## T31: 系統樹の下に、選んだ種のカードを出す
- **目的**: 系統樹で選んだ種の特徴を、文章ではなく図で見せるカードを、新しいファイル `src/ui/panels/species-card.js` に作る。TreePanel の `render` の最後で呼ぶ
  - カードの中身(上から): 種の色の丸と名前、体の形(真上から)の canvas、生き方の帯(T25 の `renderTraits(el, traitsOfGenome(rep))`)、個体数の推移の小さな折れ線(canvas、`histT`・`histN`。縦軸は 0〜最大、横軸は誕生から今まで)、数値の小さな並び(誕生 N 年・絶滅 N 年 か「現存」・最大 N 体・累計 N 体・親の種の名前・子の種の数。見出しは短い語にし、`dl` の文章にはしない)、「この種の個体を 1 体選ぶ」ボタン
  - 体の形: `restTransforms(rep, 0)`(T27)の各体節を、個体タブの `drawBody` と同じ描き方(長軸 `qRot(q, { x: 0, y: len / 2, z: 0 })` の x・z を線で、太さは半径)で真上から描く
  - データ: 名前・誕生・絶滅・count・peak・total・parent は `sim.species`、`rep`・`histT`・`histN` は `sim.speciesDetail`(T28。`id` が選んだ種と同じときだけ使う。届くまでは体の形・帯・推移を空にする)。子の種の数は `sim.species` で `parent === id` の数
  - ボタン: `sim.creatures` から `alive && !dead && species.id === id` の個体を 1 体(先頭)選び、`store.set({ selected: c, follow: true, tab: 'p-ind' })`。いなければボタンを `disabled` にする
  - 選んだ種が無いときはカードを隠す(`hidden`)
  - `index.html` の系統樹タブの canvas の下に `<div id="sp-card" class="sp-card" hidden>` と中の要素を置く。`src/styles.css` にカードの規則を足す
- **対象**: `src/ui/panels/species-card.js`, `src/ui/panels/tree-panel.js`, `index.html`, `src/styles.css`
- **要件**: R8
- **参照ファイル**:
  - `src/ui/panels/inspector-panel.js:89-111`(体の形の描き方を真似る)
  - `src/ui/traits.js`(T25 の部品)
  - `src/ui/panels/tree-panel.js`(変更対象。render の最後でカードを呼ぶ)
  - `index.html:136-142`(変更対象。系統樹タブ)
- **受け入れ基準**:
  - [ ] `grep -n "species-card" src/ui/panels/tree-panel.js` が import の行を出す
  - [ ] `node -e "const s = require('fs').readFileSync('src/ui/panels/species-card.js', 'utf8'); console.log(/\p{Extended_Pictographic}/u.test(s), s.includes('restTransforms'), s.includes('renderTraits'))"` が `false true true` を出す
  - [ ] `npm run check:sim` のハッシュが変更前に控えた値と同じ。ブラウザでの見た目は確かめられない旨を報告する
- **依存**: T25, T30

<!-- グループ ui-header: #37 後半 ヘッダーと統計タブ -->

## T32: ヘッダーの年・季節・気温・湖面・天候を図で見せる
- **目的**: ヘッダーの「10.4年 秋 17.6℃ 湖-1.17 晴」の文字の並びを、小さな図と数値にする。個体・種・世代はヘッダーから外す(T34 で統計タブのカードに移す)。図は `src/ui/header.js` が SVG で描く(はじめの 1 回だけ要素を作り、以後は値だけ更新する)
  - 年と季節: 直径 22 px の円環。1 年を 1 周とし、春・夏・秋・冬の 4 色の弧で塗り分ける(春は位相 −0.125〜0.125。`Climate.seasonName` と同じ区切り)。今の位相に針を描き、円環の右に年数(小数 1 桁)を数字で出す。季節名は `title` と `aria-label` に置く
  - 気温: 幅 48 px の横の帯(−10℃ の青から 40℃ の赤への線形グラデーション)に、今の値の位置に印を描き、右に数値(小数 1 桁 + ℃)を出す
  - 湖の高さ: 幅 30 px・高さ 16 px の湖の断面(窪みの線)に、基準の水面を点線で、今の水面を塗りで描く。基準との差を上下の矢印の向きで示し、右に差の数値(符号付き・小数 2 桁)を出す
  - 天候: T24 の `iconSvg(weatherIcon(climate), { label })`。`label` は今の表示の語(晴・雨・雪・干ばつ、氷河期なら「・氷河期」を足す)
  - 各図の色は CSS 変数(`--water`・`--danger`・`--accent`・`--muted` など)を使う
  - `index.html` の `#readings` の中身を、図を入れる空の枠(`#g-year`・`#g-temp`・`#g-water`・`#g-weather`)に置き換え、`#r-pop`・`#r-sp`・`#r-gen` の `span` を消す。`src/styles.css` の `.readings` の規則を図に合わせて直す
- **対象**: `src/ui/header.js`, `index.html`, `src/styles.css`
- **要件**: R9
- **参照ファイル**:
  - `src/ui/header.js`(変更対象)
  - `index.html:21-35`(変更対象。ヘッダー)
  - `src/styles.css:27-40`(変更対象。`.readings` と `.chip`)
  - `src/ui/icons.js`(T24 のアイコン)
  - `src/sim/climate.js:15-21`(季節の区切りと湖面の範囲)
- **受け入れ基準**:
  - [ ] `grep -n "r-pop\|r-sp\|r-gen" index.html src/ui/header.js` が何も出さない
  - [ ] `node -e "for (const f of ['src/ui/header.js', 'index.html']) { const s = require('fs').readFileSync(f, 'utf8'); if (/\p{Extended_Pictographic}/u.test(s)) throw f; } console.log('ok')"` が `ok` を出す
  - [ ] `npm run check:sim` のハッシュが変更前に控えた値と同じ。ブラウザでの見た目は確かめられない旨を報告する
- **依存**: T24

## T33: ヘッダーのボタンをアイコンにする
- **目的**: ヘッダーのボタンの中身を、文字ではなく T24 のアイコンにする。意味は `title` と `aria-label` に今の文言を残す。幅 900 px 前後でもボタンが 3 段に折り返さないようにする
  - `index.html`: 各ボタンに `data-icon` と `aria-label` を付け、中の文字を消す。対応は 停止 `pause`・×1 `play`・×3 `play2`・×8 `play3`・最大 `ffwd`・雨 `rain`・干ばつ `drought`・氷河期 `ice`・パネル `panel`・性能 `perf`・新しい世界 `world`。`aria-label` は今のボタンの文字(「停止」「×1」…「新しい世界」)にする。`title` は今のまま
  - `src/ui/controls.js` の `bindControls` の先頭で、`document.querySelectorAll('button[data-icon]')` のそれぞれに `b.innerHTML = iconSvg(b.dataset.icon)` を入れる
  - `src/styles.css`: アイコンだけのボタンの大きさと余白をそろえ(`button .icon { display: block; }` など)、ヘッダーの `.controls` が幅 900 px で 2 段以内に収まるようにする(`gap` を詰める、`flex-wrap` の単位を `.seg` ごとにする 等)
- **対象**: `index.html`, `src/ui/controls.js`, `src/styles.css`
- **要件**: R9
- **参照ファイル**:
  - `index.html:36-55`(変更対象。ボタン)
  - `src/ui/controls.js:1-20`(変更対象)
  - `src/styles.css:20-50`(変更対象。ヘッダーとボタンの規則)
  - `src/ui/icons.js`(T24 のアイコン名)
- **受け入れ基準**:
  - [ ] `grep -c 'data-icon=' index.html` が `11` を出す
  - [ ] `node -e "const s = require('fs').readFileSync('index.html', 'utf8'); const b = [...s.matchAll(/<button[^>]*data-icon[^>]*>/g)].map(m => m[0]); console.log(b.every(t => /aria-label=/.test(t) && /title=/.test(t)))"` が `true` を出す
  - [ ] `npm run check:sim` のハッシュが変更前に控えた値と同じ。ブラウザでの見た目(幅 900 px で 2 段以内)は確かめられない旨を報告する
- **依存**: T24, T32

## T34: 統計タブの先頭に「見ている島」と「群島全体」の数値カードを置く
- **目的**: ヘッダーから外した個体・種・世代と、群島の注記の 1 行の文章(`#arch-note`)を、統計タブの先頭の数値カードにまとめる
  - カード「見ている島」(島が 1 つなら「世界」): 個体・種・世代の 3 つの大きな数値。値の求め方は今の `updateHeader` の個体・種・世代と同じ(生きている個体を数え、種は個体の種の数、世代は最大の `gen`)
  - カード「群島全体」(島が 2 つ以上のときだけ): 個体・種・実効種数の 3 つの大きな数値と、小さな副数値(種の下に「交配で束ねると N」、実効種数の下に「交配で束ねると N」)。その下に移住の 1 行を数値の並びで出す(移住 N・降り立てず N・少数で見送り N)
  - 群島の表(島ごとの個体・種)は今のまま残し、`#arch-note` の文章は消す
  - `src/app/island-runner.js` の `fetchSummary` の `this.summary` に `skipped: this.arch.skipped`(T2 の累計)を足す
  - `index.html` の統計タブの先頭(T26 の範囲の切り替えの下)にカードの枠(`#sum-view`・`#sum-arch`)を置き、`#arch-note` を消す。`src/styles.css` にカードの規則を足す(2 枚を横に並べ、狭ければ縦に積む)
- **対象**: `src/ui/panels/stats-panel.js`, `index.html`, `src/styles.css`, `src/app/island-runner.js`
- **要件**: R9
- **参照ファイル**:
  - `src/ui/panels/stats-panel.js:31-44`(変更対象。群島の表と注記)
  - `src/ui/header.js`(個体・種・世代の今の求め方。T32 の前の版は git の履歴にある)
  - `index.html:50-60`(変更対象。統計タブの先頭)
  - `src/app/island-runner.js:60-72`(変更対象。`fetchSummary`)
- **受け入れ基準**:
  - [ ] `grep -n "arch-note" index.html src/ui/panels/stats-panel.js` が何も出さない
  - [ ] `node tools/island-runner-check.mjs` の最後の行が `すべて OK`
  - [ ] `npm run check:sim` のハッシュが変更前に控えた値と同じ。ブラウザでの見た目(島 1 つと 4 島の両方)は確かめられない旨を報告する
- **依存**: T2, T33

## T35: 統計タブの「最大の種・疫病」と「繁殖」を数値のタイルにする
- **目的**: 統計タブに残る文章の注記を、レイアウトで読めるようにする
  - 「個体数と種数」の下の `#topline`(「最大 ○○ 86%　疫病 なし」の文): 最大の種は「種の色の丸 + 名前 + 割合の小さな横棒と数値」、疫病は流行中の種の名前のチップ(種の色の丸付き)を並べ、流行が無ければ「疫病なし」の淡いチップ 1 つにする
  - 「繁殖」の `<dl id="repro">`: 6 つの値(交配・誕生・平均産子数・育たぬ雑種・断った相手・種分化)を、大きな数値と短い見出しのタイルを 3 列の格子に並べる(`dl` をやめ、`<div class="tiles" id="repro">` にする)。見出しの語は今と同じ
  - `index.html` と `src/styles.css` を合わせて直す(タイルの規則は T34 のカードと見た目をそろえる)
- **対象**: `src/ui/panels/stats-panel.js`, `index.html`, `src/styles.css`
- **要件**: R9
- **参照ファイル**:
  - `src/ui/panels/stats-panel.js:12-30`(変更対象。繁殖)
  - `src/ui/panels/stats-panel.js:46-55`(変更対象。`renderTopline`)
  - `index.html:60-72`(変更対象。統計タブ)
  - `src/render/palette.js`(`speciesCss`)
- **受け入れ基準**:
  - [ ] `grep -n '<dl id="repro"' index.html` が何も出さず、`grep -n 'id="repro"' index.html` が 1 行を出す
  - [ ] `npm run check:sim` のハッシュが変更前に控えた値と同じ。ブラウザでの見た目は確かめられない旨を報告する
- **依存**: T34

## T36: UI の新しい部品と、種の詳しい情報の流れを ARCHITECTURE.md に書く
- **目的**: `ARCHITECTURE.md` に、この計画で足した UI の部品(`src/ui/icons.js`・`src/ui/traits.js`・`src/ui/tree-layout.js`・`src/ui/panels/species-card.js`)と、グラフの表示範囲(`charts.js` の `RANGES`・`timeWindow`)を、既存の一覧の書き方に合わせて足す。あわせて、系統樹で選んだ種の詳しい情報の流れ(ストアの `treeSpecies` → `IslandRunner` の `speciesId` → Worker の `packPanels` の `speciesDetail` → `SimMirror#speciesDetail` → 種のカード)を、既存の写しの説明の近くに 1 段落で書く。「よくある変更の入口」に「アイコンを足す: `src/ui/icons.js` の `PATHS`」を足す
- **対象**: `ARCHITECTURE.md`
- **要件**: なし
- **参照ファイル**:
  - `ARCHITECTURE.md`(変更対象)
- **受け入れ基準**:
  - [ ] `grep -c "icons.js\|traits.js\|tree-layout.js\|species-card.js\|speciesDetail" ARCHITECTURE.md` が 5 以上を出す
- **依存**: T31, T35
