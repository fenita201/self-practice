import { MongoClient } from 'mongodb';
import { cfg, maskUri } from './config.js';
import { createDocFactory, createRng, sampleBaseDocBytes } from './gen.js';

const MB = 1024 * 1024;
const MAX_DOC_BYTES = 16 * MB - 1024;
const INDEX_SPECS = [{ idx: 1 }, { status: 1, createdAt: -1 }, { email: 1 }];

const dbName = (i) => `${cfg.dbPrefix}_${String(i).padStart(3, '0')}`;
const collName = (i) => `${cfg.collPrefix}_${String(i).padStart(3, '0')}`;

async function runPool(tasks, limit) {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]();
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

async function generate(client) {
  const docsPerDb = cfg.collectionsPerDb * cfg.docsPerCollection;
  const base = sampleBaseDocBytes(createRng(cfg.seed));
  const targetBytes = cfg.targetMbPerDb * MB;
  const padBytes = targetBytes > 0 ? Math.max(0, Math.floor(targetBytes / docsPerDb - base)) : 0;

  console.log(`URI: ${maskUri(cfg.uri)}`);
  console.log(`Plan: ${cfg.dbCount} DB x ${cfg.collectionsPerDb} coll x ${cfg.docsPerCollection} docs (seed=${cfg.seed})`);
  console.log(`Doc size: base ~${base.toFixed(0)} B + payload ${padBytes} B => ~${(base + padBytes).toFixed(0)} B/doc`);
  if (targetBytes > 0 && padBytes === 0) {
    console.warn(`WARN: TARGET_MB_PER_DB=${cfg.targetMbPerDb} qua nho; toi thieu ~${((base * docsPerDb) / MB).toFixed(2)} MB/DB (so doc duoc uu tien)`);
  }
  if (base + padBytes > MAX_DOC_BYTES) throw new Error('Doc size vuot 16MB; giam TARGET_MB_PER_DB hoac tang so doc');

  const tasks = [];
  for (let d = 1; d <= cfg.dbCount; d++) {
    for (let c = 1; c <= cfg.collectionsPerDb; c++) {
      const taskId = d * 100000 + c;
      tasks.push(async () => {
        const col = client.db(dbName(d)).collection(collName(c));
        if (cfg.dropExisting) await col.drop().catch(() => {});
        const makeDoc = createDocFactory(createRng(cfg.seed + taskId), padBytes);
        for (let i = 0; i < cfg.docsPerCollection; i += cfg.batchSize) {
          const n = Math.min(cfg.batchSize, cfg.docsPerCollection - i);
          const batch = Array.from({ length: n }, (_, k) => makeDoc(i + k));
          await col.insertMany(batch, { ordered: false });
        }
        const specs = INDEX_SPECS.slice(0, Math.max(0, cfg.indexesPerCollection));
        for (const spec of specs) await col.createIndex(spec);
        console.log(`  done ${dbName(d)}.${collName(c)} (${cfg.docsPerCollection} docs, ${specs.length} idx)`);
      });
    }
  }
  const t0 = Date.now();
  await runPool(tasks, cfg.concurrency);
  console.log(`Inserted in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await stats(client);
  if (targetBytes > 0) console.log(`Target: ${cfg.targetMbPerDb} MB dataSize / DB`);
}

async function listGenDbs(client) {
  const { databases } = await client.db().admin().listDatabases({ nameOnly: true });
  return databases.map((d) => d.name).filter((n) => n.startsWith(`${cfg.dbPrefix}_`)).sort();
}

async function stats(client) {
  const names = await listGenDbs(client);
  if (!names.length) return console.log(`No DB with prefix "${cfg.dbPrefix}_"`);
  console.log('\nDB'.padEnd(26), 'colls'.padStart(6), 'objects'.padStart(10), 'dataMB'.padStart(10), 'storageMB'.padStart(11), 'indexMB'.padStart(9));
  const tot = { colls: 0, objects: 0, data: 0, storage: 0, index: 0 };
  for (const n of names) {
    const s = await client.db(n).stats();
    tot.colls += s.collections; tot.objects += s.objects; tot.data += s.dataSize; tot.storage += s.storageSize; tot.index += s.indexSize;
    console.log(n.padEnd(25), String(s.collections).padStart(6), String(s.objects).padStart(10), (s.dataSize / MB).toFixed(2).padStart(10), (s.storageSize / MB).toFixed(2).padStart(11), (s.indexSize / MB).toFixed(2).padStart(9));
  }
  console.log('TOTAL'.padEnd(25), String(tot.colls).padStart(6), String(tot.objects).padStart(10), (tot.data / MB).toFixed(2).padStart(10), (tot.storage / MB).toFixed(2).padStart(11), (tot.index / MB).toFixed(2).padStart(9));
}

async function clean(client) {
  const names = await listGenDbs(client);
  for (const n of names) {
    await client.db(n).dropDatabase();
    console.log(`dropped ${n}`);
  }
  if (!names.length) console.log(`No DB with prefix "${cfg.dbPrefix}_"`);
}

const cmd = process.argv[2] || 'run';
const handlers = { run: generate, stats, clean };
if (!handlers[cmd]) {
  console.error(`Unknown command "${cmd}". Use: run | stats | clean`);
  process.exit(1);
}
const client = new MongoClient(cfg.uri);
try {
  await client.connect();
  await handlers[cmd](client);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await client.close();
}
