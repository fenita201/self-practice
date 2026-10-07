import { ObjectId } from 'mongodb';

const BOUNDS_TTL_MS = 60_000;
const SPAN_BITS = 48n;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const NAMES = ['An', 'Binh', 'Chi', 'Dung', 'Giang', 'Hoa', 'Khanh', 'Lan', 'Minh', 'Nam'];
const STATUSES = ['new', 'active', 'pending', 'suspended', 'closed'];
const TAGS = ['alpha', 'beta', 'gamma', 'delta', 'omega', 'vip', 'retail'];
const pick = (a) => a[(Math.random() * a.length) | 0];

const oidToBig = (oid) => BigInt(`0x${oid.toHexString()}`);
const bigToOid = (b) => new ObjectId(b.toString(16).padStart(24, '0'));

function randomPayload(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += B64[(Math.random() * 64) | 0];
  return s;
}

export function createOps(client, cfg) {
  // Cache min/max _id moi collection de chon ngau nhien theo _id (dung index, khong skip/sample ton kem).
  const bounds = new Map();

  async function getBounds(col, key) {
    const hit = bounds.get(key);
    if (hit && Date.now() - hit.at < BOUNDS_TTL_MS) return hit;
    const opts = { projection: { _id: 1 } };
    const first = await col.find({}, opts).sort({ _id: 1 }).limit(1).next();
    let entry;
    if (!first) entry = { kind: 'empty' };
    else if (!(first._id instanceof ObjectId)) entry = { kind: 'other' };
    else {
      const last = await col.find({}, opts).sort({ _id: -1 }).limit(1).next();
      entry = { kind: 'oid', lo: oidToBig(first._id), hi: oidToBig(last._id) };
    }
    entry.at = Date.now();
    bounds.set(key, entry);
    return entry;
  }

  const randomOidBetween = ({ lo, hi }) => {
    const r = BigInt(Math.floor(Math.random() * 2 ** 48));
    return bigToOid(lo + ((hi - lo) * r) / (1n << SPAN_BITS));
  };

  // Loc "chon doc ngau nhien": { _id: {$gte: oidNgauNhien} } hoac $sample neu _id khong phai ObjectId.
  async function randomIds(col, key, n) {
    const b = await getBounds(col, key);
    if (b.kind === 'empty') return null;
    if (b.kind === 'oid') {
      const docs = await col
        .find({ _id: { $gte: randomOidBetween(b) } }, { projection: { _id: 1 } })
        .sort({ _id: 1 })
        .limit(n)
        .toArray();
      return docs.map((d) => d._id);
    }
    const docs = await col.aggregate([{ $sample: { size: n } }, { $project: { _id: 1 } }]).toArray();
    return docs.map((d) => d._id);
  }

  async function read({ db, coll }) {
    const col = client.db(db).collection(coll);
    const key = `${db}.${coll}`;
    const b = await getBounds(col, key);
    if (b.kind === 'empty') return 'skip';
    if (b.kind === 'oid') {
      await col.find({ _id: { $gte: randomOidBetween(b) } }).sort({ _id: 1 }).limit(cfg.readBatchSize).toArray();
    } else {
      await col.aggregate([{ $sample: { size: cfg.readBatchSize } }]).toArray();
    }
  }

  async function insert({ db, coll }) {
    const name = pick(NAMES);
    await client.db(db).collection(coll).insertOne({
      idx: (Math.random() * 1e9) | 0,
      name,
      email: `${name}${(Math.random() * 1e6) | 0}@connector.example.com`.toLowerCase(),
      status: pick(STATUSES),
      amount: Math.round(Math.random() * 1e6) / 100,
      createdAt: new Date(),
      tags: [pick(TAGS), pick(TAGS)],
      payload: randomPayload(cfg.writePayloadBytes),
      source: 'mongo-connector',
    });
  }

  async function update({ db, coll }) {
    const col = client.db(db).collection(coll);
    const ids = await randomIds(col, `${db}.${coll}`, 1);
    if (!ids || !ids.length) return insert({ db, coll });
    await col.updateOne(
      { _id: ids[0] },
      { $set: { updatedAt: new Date(), updatedBy: 'mongo-connector' }, $inc: { touchCount: 1 } },
    );
  }

  async function write(target) {
    return Math.random() * 100 < cfg.writeUpdatePercent ? update(target) : insert(target);
  }

  return { read, write };
}
