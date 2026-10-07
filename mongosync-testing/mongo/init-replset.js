// Chay bang mongosh trong network namespace cua node1 (localhost exception).
// Idempotent: chay lai nhieu lan van an toan.
const env = process.env;
const members = env.RS_MEMBERS.split(',');
const admin = db.getSiblingDB('admin');

const SYNC_ROLES = [
  'backup', 'clusterManager', 'clusterMonitor',
  'readWriteAnyDatabase', 'restore', 'dbAdminAnyDatabase', // dbAdminAnyDatabase: cho reverse sync
].map((role) => ({ role, db: 'admin' }));
const OPLOG_ROLE = 'mongosyncOplog'; // custom role theo docs mongosync (local.oplog.rs)

function tryAuth() {
  try { admin.auth(env.ADMIN_USER, env.ADMIN_PASSWORD); return true; } catch (e) { return false; }
}

function waitPrimary() {
  for (let i = 0; i < 60; i++) {
    try { if (db.hello().isWritablePrimary) return; } catch (e) { /* retry */ }
    sleep(2000);
  }
  throw new Error('timeout waiting for primary');
}

function ensureSyncUser() {
  if (!admin.getRole(OPLOG_ROLE)) {
    admin.createRole({
      role: OPLOG_ROLE,
      privileges: [{ resource: { db: 'local', collection: 'oplog.rs' }, actions: ['find', 'collStats'] }],
      roles: [],
    });
    print('created role ' + OPLOG_ROLE);
  }
  if (!admin.getUser(env.SYNC_USER)) {
    admin.createUser({
      user: env.SYNC_USER,
      pwd: env.SYNC_PASSWORD,
      roles: SYNC_ROLES.concat([{ role: OPLOG_ROLE, db: 'admin' }]),
    });
    print('created user ' + env.SYNC_USER);
  }
}

// Neu MONGO_HOST (IP WSL...) doi, cap nhat host cua cac member. force:true vi khi IP cu hong
// cac node khong thay nhau => khong co primary de reconfig thuong.
function syncMemberHosts() {
  const conf = rs.conf();
  const current = conf.members.map((m) => m.host).join(',');
  if (current === env.RS_MEMBERS) return;
  print('[' + env.RS_NAME + '] member hosts changed: ' + current + ' -> ' + env.RS_MEMBERS);
  conf.members.forEach((m, i) => { m.host = members[i]; });
  conf.version += 1;
  rs.reconfig(conf, { force: true });
}

if (tryAuth()) {
  print('[' + env.RS_NAME + '] already initialized, checking users');
  syncMemberHosts();
  waitPrimary();
  ensureSyncUser();
  print('[' + env.RS_NAME + '] OK');
  quit(0);
}

let initiated = true;
try {
  rs.status();
} catch (e) {
  if (e.code === 94 || e.codeName === 'NotYetInitialized') initiated = false;
  else throw e;
}

if (!initiated) {
  rs.initiate({
    _id: env.RS_NAME,
    members: members.map((host, i) => ({ _id: i, host, priority: i === 0 ? 2 : 1 })),
  });
  print('[' + env.RS_NAME + '] rs.initiate done');
}

waitPrimary();

admin.createUser({ user: env.ADMIN_USER, pwd: env.ADMIN_PASSWORD, roles: [{ role: 'root', db: 'admin' }] });
print('created user ' + env.ADMIN_USER);
admin.auth(env.ADMIN_USER, env.ADMIN_PASSWORD);
ensureSyncUser();
print('[' + env.RS_NAME + '] OK');
