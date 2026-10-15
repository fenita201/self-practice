// So sanh du lieu SRC_URI va DST_URI sau khi mongosync sync xong.
//   npm run compare                  # so sanh DB/collection/so doc/index (ten + key + option)
//   HASH=true npm run compare        # them dbHash (md5 noi dung tung collection) - chinh xac nhat
//   COMPARE_DB_REGEX=^synctest npm run compare   # chi so sanh DB khop regex
// Chi co y nghia khi KHONG con ghi vao source (tat connector) va mongosync da COMMITTED.
// Exit code 1 neu co khac biet => dung duoc trong script.
import { MongoClient } from 'mongodb';
import { compareCfg, isInternalDb, maskUri, uriFor } from './config.js';

const { dbRegex, useHash } = compareCfg();
const CONCURRENCY = 8;

// Dai dien 1 index bang ten + key + cac option anh huong hanh vi (unique, sparse, TTL, partial...).
const indexSig = (i) => {
  const { v, ns, background, ...rest } = i;
  return JSON.stringify(rest);
};

async function snapshot(client) {
  const { databases } = await client.db().admin().listDatabases({ nameOnly: true });
  const names = databases.map((d) => d.name).filter((n) => !isInternalDb(n) && (!dbRegex || dbRegex.test(n))).sort();
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
      out.set(`${db}.${coll}`, { count, indexes: idx.map(indexSig).sort().join(',') });
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

const src = new MongoClient(uriFor('src'), { appName: 'compare' });
const dst = new MongoClient(uriFor('dst'), { appName: 'compare' });
try {
  await Promise.all([src.connect(), dst.connect()]);
  console.log(`src: ${maskUri(uriFor('src'))}\ndst: ${maskUri(uriFor('dst'))}`);
  console.log(`Comparing${dbRegex ? ` (DB ~ ${dbRegex})` : ''}${useHash ? ' + dbHash' : ''} ...`);
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
      if (a.indexes !== b.indexes) problems.push(`INDEX differs  : ${k}\n      src=${a.indexes}\n      dst=${b.indexes}`);
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
