import { BSON, ObjectId } from 'mongodb';

const FIRST = ['An', 'Binh', 'Chi', 'Dung', 'Giang', 'Hoa', 'Khanh', 'Lan', 'Minh', 'Nam', 'Oanh', 'Phuc', 'Quang', 'Son', 'Thao', 'Uyen', 'Vy'];
const LAST = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Huynh', 'Phan', 'Vu', 'Dang', 'Bui', 'Do', 'Ngo'];
const STATUSES = ['new', 'active', 'pending', 'suspended', 'closed'];
const TAGS = ['alpha', 'beta', 'gamma', 'delta', 'omega', 'vip', 'retail', 'wholesale', 'promo', 'legacy'];
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const YEAR_MS = 365 * 24 * 3600 * 1000;

export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pool chuoi base64 ngau nhien; payload = lat cat tu pool (nhanh, it nen duoc).
function makePool(rng, size) {
  const out = new Array(size);
  for (let i = 0; i < size; i++) out[i] = B64[(rng() * 64) | 0];
  return out.join('');
}

export function createDocFactory(rng, padBytes) {
  const pick = (arr) => arr[(rng() * arr.length) | 0];
  const now = Date.now();
  const pool = padBytes > 0 ? makePool(rng, Math.max(1 << 20, padBytes * 2)) : '';

  const payload = () => {
    if (padBytes <= 0) return '';
    const start = (rng() * pool.length) | 0;
    return start + padBytes <= pool.length
      ? pool.slice(start, start + padBytes)
      : pool.slice(start) + pool.slice(0, padBytes - (pool.length - start));
  };

  return function makeDoc(idx) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const tags = [];
    for (let n = 2 + ((rng() * 3) | 0); n > 0; n--) tags.push(pick(TAGS));
    return {
      idx,
      name: `${first} ${last}`,
      email: `${first}.${last}${(rng() * 100000) | 0}@example.com`.toLowerCase(),
      status: pick(STATUSES),
      amount: Math.round(rng() * 1e6) / 100,
      createdAt: new Date(now - ((rng() * YEAR_MS) | 0)),
      tags,
      payload: payload(),
    };
  };
}

// Kich thuoc BSON trung binh cua doc khi payload rong (gom _id).
export function sampleBaseDocBytes(rng) {
  const make = createDocFactory(rng, 0);
  let total = 0;
  const n = 500;
  for (let i = 0; i < n; i++) total += BSON.calculateObjectSize({ _id: new ObjectId(), ...make(i) });
  return total / n;
}
