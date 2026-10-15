// Khoi tao replica set + user admin + user mongosync. Idempotent: chay lai nhieu lan van an toan.
// Chay bang mongosh tren node dau tien qua localhost (dung "localhost exception": khi chua co user
// nao, ket noi tu localhost duoc phep tao user dau tien du da bat auth + keyFile).
//
// Bien moi truong:
//   RS_NAME        ten replica set (src-rs | dst-rs)
//   RS_MEMBERS     host:port cua cac member, cach nhau dau phay; member dau tien uu tien lam PRIMARY
//   ADMIN_USER / ADMIN_PASSWORD   user root
//   SYNC_USER  / SYNC_PASSWORD    user cho mongosync
//
// Dung tren VM:  RS_NAME=src-rs RS_MEMBERS=10.20.0.11:27017,10.20.0.12:27017,10.20.0.13:27017 \
//                ADMIN_USER=admin ADMIN_PASSWORD=... SYNC_USER=mongosync SYNC_PASSWORD=... \
//                mongosh --quiet init-replset.js
// Dung voi Docker: xem local/docker-compose.yml (service src-init / dst-init).
const env = process.env;
const members = env.RS_MEMBERS.split(',');
const admin = db.getSiblingDB('admin');

// Role theo docs mongosync cho cluster self-managed, du de 1 user dung duoc o ca 2 vai tro
// source / destination (va reverse sync): https://www.mongodb.com/docs/mongosync/current/reference/permissions/
const SYNC_ROLES = [
  'backup', 'clusterManager', 'clusterMonitor',
  'readWriteAnyDatabase', 'restore', 'dbAdminAnyDatabase',
].map((role) => ({ role, db: 'admin' }));
// Custom role: doc oplog + bat/tat/vuot qua user write blocking (dung khi commit / reverse).
const EXTRA_ROLE = 'mongosyncOplog';
const EXTRA_PRIVILEGES = [
  { resource: { db: 'local', collection: 'oplog.rs' }, actions: ['find', 'collStats'] },
  { resource: { cluster: true }, actions: ['bypassWriteBlockingMode', 'setUserWriteBlockMode'] },
];

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
  if (!admin.getRole(EXTRA_ROLE)) {
    admin.createRole({ role: EXTRA_ROLE, privileges: EXTRA_PRIVILEGES, roles: [] });
    print('created role ' + EXTRA_ROLE);
  } else {
    admin.updateRole(EXTRA_ROLE, { privileges: EXTRA_PRIVILEGES });
  }
  if (!admin.getUser(env.SYNC_USER)) {
    admin.createUser({
      user: env.SYNC_USER,
      pwd: env.SYNC_PASSWORD,
      roles: SYNC_ROLES.concat([{ role: EXTRA_ROLE, db: 'admin' }]),
    });
    print('created user ' + env.SYNC_USER);
  }
}

// Neu host cua member doi (vd IP WSL doi sau restart), cap nhat host cua cac member. force:true vi khi IP cu hong
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
