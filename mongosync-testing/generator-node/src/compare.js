// So sanh du lieu source (src-rs) va destination (dst-rs) sau khi mongosync sync xong.
//   npm run compare                  # so sanh DB/collection/so doc/so index
//   HASH=true npm run compare        # them dbHash (md5 noi dung tung collection) - chinh xac nhat
//   COMPARE_DB_REGEX=^synctest npm run compare   # chi so sanh DB khop regex
// Chi co y nghia khi KHONG con ghi vao source (tat mongo-connector) va da commit mongosync.
import { MongoClient } from 'mongodb';
import { buildClusterUri } from './config.js';

const SYSTEM_DBS = new Set(['admin', 'local', 'config']);
const dbRegex = process.env.COMPARE_DB_REGEX ? new RegExp(process.env.COMPARE_DB_REGEX) : null;
const useHash = process.env.HASH === 'true';
const CONCURRENCY = 8;

async function snapshot(client) {
  const { databases } = await client.db().admin().listDatabases({ nameOnly: true });
  const names = databases.map((d) => d.name).filter((n) => !SYSTEM_DBS.has(n) && (!dbRegex || dbRegex.test(n))).sort();
  const out = new Map(); // "db.coll" -> { count, indexes }
  const hashes = new Map(); // "db.coll" -> md5

  const colls = [];
  for (const name of names) {
    const list = await client.db(name).listCollections({ type: 'collection' }, { nameOnly: true }).toArray();
    for (const c of list) if (!c.name.startsWith('system.')) colls.push([name, c.name]);
  }

  let next = 0;
  const worker = async () => {
    while (next < colls.length) {
      const [db, coll] = colls[next++];
      const col = client.db(db).collection(coll);
      const [count, idx] = await Promise.all([col.countDocuments({}), col.indexes()]);
      out.set(`${db}.${coll}`, { count, indexes: idx.map((i) => i.name).sort().join(',') });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (useHash) {
    for (const name of names) {
      const r = await client.db(name).command({ dbHash: 1 });
      for (const [coll, md5] of Object.entries(r.collections)) if (!coll.startsWith('system.')) hashes.set(`${name}.${coll}`, md5);
    }
  }
  return { names, out, hashes };
}

const src = new MongoClient(buildClusterUri('src'), { appName: 'compare' });
const dst = new MongoClient(buildClusterUri('dst'), { appName: 'compare' });
try {
  await Promise.all([src.connect(), dst.connect()]);
  console.log(`Comparing src-rs vs dst-rs${dbRegex ? ` (DB ~ ${dbRegex})` : ''}${useHash ? ' + dbHash' : ''} ...`);
  const [s, d] = await Promise.all([snapshot(src), snapshot(dst)]);

  const problems = [];
  const keys = new Set([...s.out.keys(), ...d.out.keys()]);
  let docsSrc = 0;
  let docsDst = 0;
  for (const k of [...keys].sort()) {
    const a = s.out.get(k);
    const b = d.out.get(k);
    if (a) docsSrc += a.count;
    if (b) docsDst += b.count;
    if (!b) problems.push(`MISSING on dst : ${k} (${a.count} docs)`);
    else if (!a) problems.push(`EXTRA on dst   : ${k} (${b.count} docs)`);
    else {
      if (a.count !== b.count) problems.push(`COUNT differs  : ${k} src=${a.count} dst=${b.count} (diff ${b.count - a.count})`);
      if (a.indexes !== b.indexes) problems.push(`INDEX differs  : ${k} src=[${a.indexes}] dst=[${b.indexes}]`);
      if (useHash && s.hashes.get(k) !== d.hashes.get(k)) problems.push(`HASH differs   : ${k} src=${s.hashes.get(k)} dst=${d.hashes.get(k)}`);
    }
  }

  console.log(`src: ${s.names.length} db / ${s.out.size} coll / ${docsSrc} docs`);
  console.log(`dst: ${d.names.length} db / ${d.out.size} coll / ${docsDst} docs`);
  if (problems.length === 0) {
    console.log(`\nOK: dst khop src (so collection, so doc, index${useHash ? ', hash' : ''}).`);
  } else {
    console.log(`\nFAIL: ${problems.length} khac biet`);
    problems.slice(0, 50).forEach((p) => console.log('  ' + p));
    if (problems.length > 50) console.log(`  ... va ${problems.length - 50} dong nua`);
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await Promise.all([src.close(), dst.close()]);
}
