// ===== シミュレーションの設定値と、神経回路の寸法 =====
// 値を調整するときはこのファイルだけを触ればよい。

export const CFG = {
  WORLD: 120,          // 世界の一辺
  GRID: 64,            // 地形の分割数
  DT: 1 / 30,          // 物理ステップ
  YEAR: 300,           // 1年の長さ（シム秒）
  MAXP: 10,            // 最大パーツ数
  MAX_POP: 200,
  MIN_POP: 30,         // これを下回ると新種の群れが移入する
  INIT_SPECIES: 14,
  GROUP: 8,            // 1種あたりの初期個体数
  MATE_E: 0.55,        // 繁殖に必要なエネルギー（最大値に対する割合）
  INVEST: 0.35,        // 繁殖で親が差し出すエネルギーの割合
  CHILD_COST: 0.19,    // 子1体に必要なエネルギー（子の最大エネルギーに対する割合）
  MAX_LITTER: 8,
  MATE_COST: 0.08,     // 繁殖行為そのものに使うエネルギー（各親の最大エネルギーに対する割合）
  MAX_PLANTS: 2000,
  DENSITY: 40,
  FOOD_GAIN: 3,        // 食べた量に対して得られるエネルギーの倍率
  GRAZE_FLOOR: 0.2,    // 草がここまで食べ尽くされると、しばらく回復を待つ
  RECOVER: [10, 20],   // 食べ尽くされた草が再び育ち始めるまでの秒数
  CANOPY: 1.1,         // 木の葉に届く高さ（地面からの m）
  SENSE_R: 14,
  FERTILE: 0.5,        // 雑種の生存力がこれ以上なら「同じ種」とみなす
};

// 処理の間隔（ステップ数）。step() のスケジュールはここで決まる
export const SCHEDULE = {
  CLIMATE: 4,
  PLANTS: 40,
  TERRAIN: 200,
  MOISTURE: 120,
  HOUSEKEEPING: 80,
  STATS: 80,
  SPECIES: 400,        // SPECIES_OFFSET ステップずらして実行
  SPECIES_OFFSET: 200,
  SENSE: 4,            // 各個体が周囲を感知する間隔
};

export const MAXJ = CFG.MAXP - 1;           // 関節の最大数
export const EDGE = CFG.WORLD / 2 - 4;      // 生物・植物が置かれる範囲
export const NMEM = 2;                      // 記憶ニューロン数

// 神経回路の寸法
export const NI = 18 + MAXJ + NMEM;         // 入力
export const NH = 12;                       // 隠れ層
export const NO = MAXJ + NMEM + 2;          // 関節 + 記憶 + 旋回 + 推進
export const O_TURN = MAXJ + NMEM, O_GO = MAXJ + NMEM + 1;
export const NW1 = NI * NH, NW2 = NH * NO, NWB = NW1 + NH + NW2 + NO;
