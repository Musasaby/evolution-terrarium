// --settings 引数の解釈（確認スクリプト共通）
//   --settings terrain:mountain             … テンプレート（<カテゴリ>:<ID>。ID だけでも、一意なら可）
//   --settings terrain:mountain,climate:cold … カンマ区切りで複数を重ねる
//   --settings '{"lakeCount":4}'             … JSON で項目を直接指定
import { SETTING_PRESETS } from '../src/sim/index.js';

function findPreset(key) {
  const [cat, id] = key.includes(':') ? key.split(':') : [null, key];
  const hits = [];
  for (const [c, list] of Object.entries(SETTING_PRESETS)) {
    if (cat && c !== cat) continue;
    for (const p of list) if (p.id === id) hits.push(p);
  }
  if (hits.length !== 1) throw new Error(`テンプレート "${key}" を一つに決められません（${hits.length} 件）。<カテゴリ>:<ID> で指定してください`);
  return hits[0];
}

export function parseSettingsArg(text) {
  if (text === undefined) return undefined;
  if (text.trim().startsWith('{')) return JSON.parse(text);
  return Object.assign({}, ...text.split(',').map((k) => findPreset(k.trim()).values));
}

// argv から --settings <値> を取り除き、{ args, settings } を返す
export function extractSettings(argv) {
  const i = argv.indexOf('--settings');
  if (i < 0) return { args: argv, settings: undefined, text: undefined };
  const text = argv[i + 1];
  return { args: [...argv.slice(0, i), ...argv.slice(i + 2)], settings: parseSettingsArg(text), text };
}
