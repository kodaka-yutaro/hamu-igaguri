const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ctx = {window: {}, setTimeout, clearTimeout};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../backend.js'), 'utf8').split('// Supabase backend')[0], ctx);
const DraftSync = ctx.window.HamuDraftSync;
const copy = x => x == null ? x : JSON.parse(JSON.stringify(x));
const draft = title => ({rows: Array(16).fill('.'.repeat(40)), title});
function device(server, initial = null, initialMeta = null) {
  let local = copy(initial), meta = copy(initialMeta), state, choose;
  const backups = [];
  const api = {
    async read() { if (server.offline) throw Error('offline'); return copy(server.row); },
    async write(value, version) {
      if (server.offline) throw Error('offline');
      if (version !== (server.row?.version || 0)) throw {code: 'conflict'};
      server.row = {value: copy(value), version: version + 1}; return version + 1;
    },
  };
  const sync = new DraftSync({api, get: () => local, apply: v => local = copy(v),
    getMeta: () => meta, setMeta: v => meta = copy(v),
    status: (s, c) => { state = s; choose = c; }, backup: v => backups.push(copy(v))});
  return {sync, api, backups, get local() {return local;}, set local(v) {local = v;},
    get meta() {return meta;}, get state() {return state;}, choose: k => choose(k)};
}
test('existing phone draft uploads, empty PC downloads it, and PC edits return to phone', async () => {
  const server = {row: null}, phone = device(server, draft('スマホ'));
  await phone.sync.sync();
  const pc = device(server); await pc.sync.sync();
  assert.deepEqual(pc.local, phone.local);
  pc.local = draft('PCで続き'); await pc.sync.sync(); await phone.sync.sync();
  assert.deepEqual(phone.local, pc.local); assert.equal(phone.state, 'saved');
});
test('reload keeps the baseline so offline changes upload when connected', async () => {
  const server = {row: null}, phone = device(server, draft('元'));
  await phone.sync.sync(); server.offline = true;
  phone.local = draft('通信なしで編集'); await phone.sync.sync();
  assert.equal(phone.state, 'offline');
  const reloaded = device(server, phone.local, phone.meta); server.offline = false;
  await reloaded.sync.sync(); assert.equal(server.row.value.title, '通信なしで編集');
});
test('both devices editing preserves both copies and requires a choice', async () => {
  const server = {row: null}, phone = device(server, draft('元'));
  await phone.sync.sync(); const pc = device(server); await pc.sync.sync();
  phone.local = draft('スマホ編集'); pc.local = draft('PC編集');
  await phone.sync.sync(); await pc.sync.sync();
  assert.equal(pc.state, 'conflict'); assert.equal(pc.local.title, 'PC編集');
  assert.equal(server.row.value.title, 'スマホ編集');
  await pc.choose('remote'); assert.equal(pc.local.title, 'スマホ編集');
  assert.equal(pc.backups[0].title, 'PC編集');
});
test('choosing local checks the latest server revision and backs up the remote', async () => {
  const server = {row: {value: draft('クラウド'), version: 2}}, pc = device(server, draft('端末'));
  await pc.sync.sync(); await pc.choose('local');
  assert.equal(server.row.value.title, '端末'); assert.equal(pc.backups[0].title, 'クラウド');
});
test('old local copy without synchronization metadata is never silently replaced', async () => {
  const server = {row: {value: draft('クラウド'), version: 4}}, pc = device(server, draft('古い下書き'));
  await pc.sync.sync(); assert.equal(pc.state, 'conflict');
  assert.equal(pc.local.title, '古い下書き'); assert.equal(server.row.version, 4);
});
test('a changed remote invalidates an earlier conflict choice', async () => {
  const server = {row: {value: draft('クラウド'), version: 1}}, pc = device(server, draft('端末'));
  await pc.sync.sync(); const choose = pc.choose;
  server.row = {value: draft('新しいクラウド'), version: 2};
  await choose('local'); assert.equal(pc.state, 'conflict');
  assert.equal(server.row.value.title, '新しいクラウド');
});
test('editing while an upload is in flight schedules another save', async () => {
  const server = {row: null}, pc = device(server, draft('最初'));
  let release; const original = pc.api.write;
  pc.api.write = async (...args) => { await new Promise(r => release = r); return original(...args); };
  const running = pc.sync.sync(); await new Promise(r => setImmediate(r));
  pc.local = draft('編集中'); pc.api.write = original; release(); await running;
  await new Promise(r => setImmediate(r)); if (pc.sync.running) await pc.sync.running;
  assert.equal(server.row.value.title, '編集中');
});
test('a failed compare-and-set re-reads and shows conflict instead of overwriting', async () => {
  const server = {row: null}, pc = device(server, draft('自分'));
  pc.api.write = async () => {server.row = {value: draft('別の端末'), version: 1}; throw {code: 'conflict'};};
  await pc.sync.sync(); await new Promise(r => setImmediate(r)); if (pc.sync.running) await pc.sync.running;
  assert.equal(pc.state, 'conflict'); assert.equal(server.row.value.title, '別の端末');
});
test('invalid cloud content cannot replace a valid local draft', async () => {
  const server = {row: {value: {rows: []}, version: 1}}, pc = device(server, draft('無事'));
  await pc.sync.sync(); assert.equal(pc.state, 'offline'); assert.equal(pc.local.title, '無事');
});
