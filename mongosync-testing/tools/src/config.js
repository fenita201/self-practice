// Doc tools/.env va cung cap config cho generator / connector / compare.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../.env') });

const env = process.env;
const str = (k, d) => (env[k] !== undefined && env[k] !== '' ? env[k] : d);
const num = (k, d) => {
  const v = str(k);
  if (v === undefined) return d;
  const n = Number(v);
  if (Number.isNaN(n) || n < 0) throw new Error(`${k} must be a number >= 0, got "${v}"`);
  return n;
};
const re = (k) => (str(k) ? new RegExp(str(k)) : null);

// Database khong bao gio dem / doc / so sanh: DB he thong + DB metadata/verifier ma mongosync tao tren cluster.
export const SYSTEM_DBS = new Set(['admin', 'local', 'config']);
export const isInternalDb = (name) =>
  SYSTEM_DBS.has(name) || name.startsWith('mongosync_reserved_for') || name.startsWith('__mdb_internal');

export function uriFor(target) {
  const key = { src: 'SRC_URI', dst: 'DST_URI' }[target];
  if (!key) throw new Error(`target must be src|dst, got "${target}"`);
  const uri = str(key);
  if (!uri || uri.includes('<')) throw new Error(`${key} chua duoc dien trong tools/.env (copy tu .env.example)`);
  return uri;
}

export const maskUri = (u) => u.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');

export const generatorCfg = () => ({
  target: str('GEN_TARGET', 'src'),
  dbCount: num('DB_COUNT', 3),
  dbPrefix: str('DB_PREFIX', 'synctest_db'),
  collectionsPerDb: num('COLLECTIONS_PER_DB', 5),
  collPrefix: str('COLL_PREFIX', 'coll'),
  docsPerCollection: num('DOCS_PER_COLLECTION', 10000),
  targetMbPerDb: num('TARGET_MB_PER_DB', 50),
  indexesPerCollection: num('INDEXES_PER_COLLECTION', 2),
  batchSize: Math.max(1, num('BATCH_SIZE', 1000)),
  concurrency: Math.max(1, num('CONCURRENCY', 4)),
  dropExisting: str('DROP_EXISTING', 'true') === 'true',
  seed: num('SEED', Date.now() % 2147483647),
});

export const connectorCfg = () => {
  const pickBy = str('PICK_BY', 'collection');
  if (!['collection', 'db'].includes(pickBy)) throw new Error(`PICK_BY must be collection|db, got "${pickBy}"`);
  return {
    target: str('CONNECTOR_TARGET', 'src'),
    uri: str('CONNECTOR_URI'), // tuy chon: URI rieng cho connector (vd user app khong phai root)
    readRate: num('READ_RATE', 100),
    writeRate: num('WRITE_RATE', 20),
    writeUpdatePercent: Math.min(100, num('WRITE_UPDATE_PERCENT', 30)),
    readBatchSize: Math.max(1, num('READ_BATCH_SIZE', 1)),
    writePayloadBytes: num('WRITE_PAYLOAD_BYTES', 256),
    dbInclude: re('DB_INCLUDE_REGEX'),
    collInclude: re('COLLECTION_INCLUDE_REGEX'),
    pickBy,
    discoveryRefreshSec: num('DISCOVERY_REFRESH_SEC', 30),
    maxInflight: Math.max(1, num('MAX_INFLIGHT', 50)),
    statsIntervalSec: Math.max(1, num('STATS_INTERVAL_SEC', 5)),
    runSeconds: num('RUN_SECONDS', 0),
  };
};

export const compareCfg = () => ({
  dbRegex: re('COMPARE_DB_REGEX'),
  useHash: str('HASH', 'false') === 'true',
});
