import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../.env') });

const env = process.env;
const str = (k, d = '') => (env[k] !== undefined && env[k] !== '' ? env[k] : d);
const num = (k, d) => {
  const v = str(k);
  if (v === '') return d;
  const n = Number(v);
  if (Number.isNaN(n) || n < 0) throw new Error(`${k} must be a number >= 0, got "${v}"`);
  return n;
};
const re = (k) => (str(k) ? new RegExp(str(k)) : null);

const pickBy = str('PICK_BY', 'collection');
if (!['collection', 'db'].includes(pickBy)) throw new Error(`PICK_BY must be collection|db, got "${pickBy}"`);

export const cfg = {
  uri: str('MONGO_URI'),
  readRate: num('READ_RATE', 100),
  writeRate: num('WRITE_RATE', 20),
  writeUpdatePercent: Math.min(100, num('WRITE_UPDATE_PERCENT', 30)),
  readBatchSize: Math.max(1, num('READ_BATCH_SIZE', 1)),
  writePayloadBytes: num('WRITE_PAYLOAD_BYTES', 256),
  dbInclude: re('DB_INCLUDE_REGEX'),
  collInclude: re('COLLECTION_INCLUDE_REGEX'),
  pickBy,
  discoveryRefreshSec: num('DISCOVERY_REFRESH_SEC', 30),
  maxInflight: Math.max(1, num('MAX_INFLIGHT', 200)),
  statsIntervalSec: Math.max(1, num('STATS_INTERVAL_SEC', 5)),
  runSeconds: num('RUN_SECONDS', 0),
};

if (!cfg.uri) throw new Error('MONGO_URI is required (copy .env.example to .env)');

export const maskUri = (u) => u.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');
