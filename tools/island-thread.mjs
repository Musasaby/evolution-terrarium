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
