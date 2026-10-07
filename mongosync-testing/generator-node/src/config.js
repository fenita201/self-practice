import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

const env = process.env;
const str = (k, d) => (env[k] !== undefined && env[k] !== '' ? env[k] : d);
const int = (k, d) => {
  const v = str(k);
  if (v === undefined) return d;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`${k} must be an integer, got "${v}"`);
  return n;
};

function buildUri() {
  const custom = str('MONGO_URI');
  const target = str('TARGET', 'src');
  if (custom) return custom;
  if (target === 'custom') throw new Error('TARGET=custom requires MONGO_URI');
  const isSrc = target === 'src';
  const ports = [1, 2, 3].map((i) => str(`${isSrc ? 'SRC' : 'DST'}_PORT_${i}`, (isSrc ? 27016 : 27026) + i));
  const host = str('MONGO_HOST');
  if (!host) throw new Error('MONGO_HOST is required in .env (or set MONGO_URI)');
  const hosts = ports.map((p) => `${host}:${p}`).join(',');
  const rs = str(isSrc ? 'SRC_RS' : 'DST_RS', isSrc ? 'src-rs' : 'dst-rs');
  const user = encodeURIComponent(str('ADMIN_USER', 'admin'));
  const pass = encodeURIComponent(str('ADMIN_PASSWORD', 'admin_pass'));
  return `mongodb://${user}:${pass}@${hosts}/?replicaSet=${rs}&authSource=admin`;
}

export const cfg = {
  uri: buildUri(),
  dbCount: int('DB_COUNT', 3),
  dbPrefix: str('DB_PREFIX', 'synctest_db'),
  collectionsPerDb: int('COLLECTIONS_PER_DB', 5),
  collPrefix: str('COLL_PREFIX', 'coll'),
  docsPerCollection: int('DOCS_PER_COLLECTION', 10000),
  targetMbPerDb: int('TARGET_MB_PER_DB', 50),
  indexesPerCollection: int('INDEXES_PER_COLLECTION', 2),
  batchSize: int('BATCH_SIZE', 1000),
  concurrency: int('CONCURRENCY', 4),
  dropExisting: str('DROP_EXISTING', 'true') === 'true',
  seed: int('SEED', Date.now() % 2147483647),
};

export const maskUri = (u) => u.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');
