import { MongoClient } from 'mongodb';
import { cfg, maskUri } from './config.js';
import { Targets } from './targets.js';
import { createOps } from './ops.js';

const ts = () => new Date().toTimeString().slice(0, 8);
const log = (...a) => console.log(`[${ts()}]`, ...a);

// Timeout ngan de op bi treo (server chet/failover) fail nhanh thay vi chiem het MAX_INFLIGHT.
const client = new MongoClient(cfg.uri, {
  appName: 'mongo-connector',
  maxPoolSize: 100,
  serverSelectionTimeoutMS: 5000,
  waitQueueTimeoutMS: 10000,
  socketTimeoutMS: 15000,
});
const targets = new Targets(client, cfg);
const ops = createOps(client, cfg);

const newStats = () => ({ ok: 0, err: 0, skipped: 0, dropped: 0, lat: [], lastErr: '' });
const stats = { read: newStats(), write: newStats() };
const total = { read: 0, write: 0, err: 0 };

// Phat op theo toc do `rate`/giay: moi tick cong don "credit", du 1 thi chay 1 op.
// Vuot MAX_INFLIGHT (DB cham hon toc do muon) => drop va dem lai.
function startRateLoop(kind, rate, fn) {
  if (rate <= 0) return null;
  let credit = 0;
  let last = performance.now();
  let inflight = 0;
  return setInterval(() => {
    const now = performance.now();
    credit += (rate * (now - last)) / 1000;
    last = now;
    const n = Math.min(Math.floor(credit), cfg.maxInflight);
    credit = Math.min(credit - n, rate); // chan burst sau khi event loop bi nghen
    const st = stats[kind];
    for (let i = 0; i < n; i++) {
      if (targets.empty) { st.skipped++; continue; }
      if (inflight >= cfg.maxInflight) { st.dropped++; continue; }
      inflight++;
      const t0 = performance.now();
      fn(targets.pick())
        .then((r) => {
          if (r === 'skip') st.skipped++;
          else { st.ok++; total[kind]++; st.lat.push(performance.now() - t0); }
        })
        .catch((e) => { st.err++; total.err++; st.lastErr = e.message; })
        .finally(() => { inflight--; });
    }
  }, 20);
}

const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : 0);

function printStats() {
  const sec = cfg.statsIntervalSec;
  const fmt = (kind, rate) => {
    const s = stats[kind];
    s.lat.sort((a, b) => a - b);
    const line = `${kind} ${(s.ok / sec).toFixed(0)}/s (target ${rate}) p50 ${pct(s.lat, 50).toFixed(1)}ms p95 ${pct(s.lat, 95).toFixed(1)}ms` +
      ` err ${s.err} drop ${s.dropped}${s.skipped ? ` skip ${s.skipped}` : ''}`;
    if (s.lastErr) log(`  last ${kind} error: ${s.lastErr}`);
    stats[kind] = newStats();
    return line;
  };
  log(`${fmt('read', cfg.readRate)} | ${fmt('write', cfg.writeRate)} | targets ${targets.byDb.size} db / ${targets.flat.length} coll`);
}

async function refreshTargets(initial = false) {
  try {
    const r = await targets.refresh();
    if (initial || r.delta !== 0) log(`discovered ${r.dbs} db / ${r.colls} collection${initial ? '' : ` (${r.delta >= 0 ? '+' : ''}${r.delta})`}`);
    if (targets.empty && initial) log('WARN: chua co DB/collection nao de doc/ghi (se quet lai theo DISCOVERY_REFRESH_SEC)');
  } catch (e) {
    log(`discovery failed: ${e.message}`);
  }
}

const timers = [];
async function shutdown(code = 0) {
  timers.forEach((t) => t && clearInterval(t));
  await new Promise((r) => setTimeout(r, 300)); // cho op dang bay
  log(`stopped. total ok: read ${total.read}, write ${total.write}, errors ${total.err}`);
  await client.close().catch(() => {});
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

log(`mongo-connector -> ${maskUri(cfg.uri)}`);
log(`rate: read ${cfg.readRate}/s, write ${cfg.writeRate}/s (${cfg.writeUpdatePercent}% update), pick by ${cfg.pickBy}`);
try {
  await client.connect();
  await client.db('admin').command({ ping: 1 });
} catch (e) {
  console.error(`Cannot connect: ${e.message}`);
  process.exit(1);
}
await refreshTargets(true);

timers.push(startRateLoop('read', cfg.readRate, ops.read));
timers.push(startRateLoop('write', cfg.writeRate, ops.write));
timers.push(setInterval(printStats, cfg.statsIntervalSec * 1000));
if (cfg.discoveryRefreshSec > 0) timers.push(setInterval(() => refreshTargets(), cfg.discoveryRefreshSec * 1000));
if (cfg.runSeconds > 0) setTimeout(() => shutdown(0), cfg.runSeconds * 1000);
