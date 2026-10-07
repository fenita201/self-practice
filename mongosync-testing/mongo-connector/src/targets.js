// Discovery: liet ke DB + collection, va chon ngau nhien 1 target (db, collection).
const SYSTEM_DBS = new Set(['admin', 'local', 'config']);

export class Targets {
  constructor(client, cfg) {
    this.client = client;
    this.cfg = cfg;
    this.byDb = new Map(); // db -> [collection names]
    this.flat = []; // [{db, coll}]
  }

  async refresh() {
    const { databases } = await this.client.db().admin().listDatabases({ nameOnly: true });
    const dbs = databases
      .map((d) => d.name)
      .filter((n) => !SYSTEM_DBS.has(n) && (!this.cfg.dbInclude || this.cfg.dbInclude.test(n)));

    const byDb = new Map();
    for (let i = 0; i < dbs.length; i += 10) {
      await Promise.all(
        dbs.slice(i, i + 10).map(async (name) => {
          const cols = await this.client.db(name).listCollections({ type: 'collection' }, { nameOnly: true }).toArray();
          const names = cols
            .map((c) => c.name)
            .filter((n) => !n.startsWith('system.') && (!this.cfg.collInclude || this.cfg.collInclude.test(n)));
          if (names.length) byDb.set(name, names);
        }),
      );
    }

    const before = this.flat.length;
    this.byDb = byDb;
    this.flat = [...byDb].flatMap(([db, colls]) => colls.map((coll) => ({ db, coll })));
    return { dbs: byDb.size, colls: this.flat.length, delta: this.flat.length - before };
  }

  get empty() {
    return this.flat.length === 0;
  }

  pick() {
    if (this.cfg.pickBy === 'db') {
      const dbs = [...this.byDb.keys()];
      const db = dbs[(Math.random() * dbs.length) | 0];
      const colls = this.byDb.get(db);
      return { db, coll: colls[(Math.random() * colls.length) | 0] };
    }
    return this.flat[(Math.random() * this.flat.length) | 0];
  }
}
