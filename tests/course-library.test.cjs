const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../backend.js'), 'utf8').split('// Private, revision-checked')[0];
const context = {window: {}, setTimeout, clearTimeout}; vm.runInNewContext(code, context);
const {normalize, merge, LibrarySync} = context.window.HamuCourseLibrary;
const copy = v => JSON.parse(JSON.stringify(v));
const file = title => ({rows: Array(16).fill('.'.repeat(40)), title, updatedAt: 1});
const library = files => ({format: 2, files});
function device(server, initial = library({}), initialMeta) {
  let local = copy(initial), meta = initialMeta, state, choose;
  const backups = [];
  const api = {
    async read() {if (server.offline) throw Error('offline'); return copy(server.row || null);},
    async write(value, version) {
      if (server.offline) throw Error('offline');
      if (version !== (server.row?.version || 0)) throw {code: 'conflict'};
      server.row = {value: copy(value), version: version + 1}; return version + 1;
    },
  };
  const sync = new LibrarySync({api, get: () => local, apply: v => local = copy(v),
    getMeta: () => meta, setMeta: v => meta = copy(v),
    status: (s, c) => {state = s; choose = c;}, backup: v => backups.push(copy(v))});
  return {sync, api, backups, get local() {return local;}, set local(v) {local = v;}, get meta() {return meta;}, get state() {return state;}, choose: k => choose(k)};
}
test('the existing single draft becomes the same legacy file locally and online', async () => {
  assert.deepEqual(copy(normalize(file('元の下書き'))), library({legacy: {...file('元の下書き'), updatedAt: 0}}));
  const server = {row: {value: file('元の下書き'), version: 1}}, pc = device(server, normalize(file('元の下書き')));
  await pc.sync.sync(); assert.equal(pc.state, 'saved'); assert.equal(Object.keys(pc.local.files).length, 1);
  pc.local.files.second = file('2つ目'); await pc.sync.sync(); assert.equal(server.row.value.format, 2);
  assert.equal(server.row.value.files.legacy.title, '元の下書き');
});
test('new courses created on different devices are both retained', async () => {
  const server = {}, phone = device(server, library({phone: file('スマホ')})), pc = device(server, library({pc: file('PC')}));
  await phone.sync.sync(); await pc.sync.sync(); await phone.sync.sync();
  assert.deepEqual(Object.keys(phone.local.files).sort(), ['pc', 'phone']);
  assert.deepEqual(phone.local, pc.local);
});
test('editing different courses merges without prompting', async () => {
  const server = {}, phone = device(server, library({a: file('A'), b: file('B')}));
  await phone.sync.sync(); const pc = device(server); await pc.sync.sync();
  phone.local.files.a.title = 'スマホでA'; pc.local.files.b.title = 'PCでB';
  await phone.sync.sync(); await pc.sync.sync(); await phone.sync.sync();
  assert.equal(pc.state, 'saved'); assert.equal(phone.local.files.a.title, 'スマホでA'); assert.equal(phone.local.files.b.title, 'PCでB');
});
test('same-course conflicts do not overwrite either device until chosen', async () => {
  const server = {}, phone = device(server, library({a: file('A')})); await phone.sync.sync();
  const pc = device(server); await pc.sync.sync(); phone.local.files.a.title = 'スマホ'; pc.local.files.a.title = 'PC';
  await phone.sync.sync(); await pc.sync.sync(); assert.equal(pc.state, 'conflict');
  assert.equal(server.row.value.files.a.title, 'スマホ'); assert.equal(pc.local.files.a.title, 'PC');
  await pc.choose('remote'); assert.equal(pc.local.files.a.title, 'スマホ'); assert.equal(pc.backups[0].files.a.title, 'PC');
});
test('choosing a conflict side still preserves unrelated courses from both sides', async () => {
  const result = merge(library({a: file('元')}), library({a: file('端末'), b: file('端末の新規')}), library({a: file('別端末'), c: file('別端末の新規')}), 'remote');
  assert.equal(result.value.files.a.title, '別端末'); assert.ok(result.value.files.b); assert.ok(result.value.files.c);
});
test('a trashed course stays trashed when an unchanged device reconnects and can be restored', async () => {
  const server = {}, phone = device(server, library({a: file('A')})); await phone.sync.sync();
  const pc = device(server); await pc.sync.sync(); phone.local.files.a.deleted = true;
  await phone.sync.sync(); await pc.sync.sync(); assert.equal(pc.local.files.a.deleted, true);
  pc.local.files.a.deleted = false; await pc.sync.sync(); await phone.sync.sync(); assert.equal(phone.local.files.a.deleted, false);
});
test('edit versus trash of the same course asks rather than discarding the edit', async () => {
  const result = merge(library({a: file('A')}), library({a: {...file('A'), deleted: true}}), library({a: file('編集中')}));
  assert.deepEqual(copy(result.conflicts), ['a']);
});
test('offline changes and a newly created file survive reload and merge after reconnection', async () => {
  const server = {}, pc = device(server, library({a: file('A')})); await pc.sync.sync(); server.offline = true;
  pc.local.files.b = file('オフライン新規'); await pc.sync.sync(); assert.equal(pc.state, 'offline');
  const reload = device(server, pc.local, pc.meta); server.offline = false; await reload.sync.sync();
  assert.equal(server.row.value.files.b.title, 'オフライン新規');
});
test('editing during an upload never replaces newer local text with the earlier snapshot', async () => {
  const server = {}, pc = device(server, library({a: file('最初')}));
  let release; const original = pc.api.write;
  pc.api.write = async (...args) => {await new Promise(r => release = r); return original(...args);};
  const p = pc.sync.sync(); await new Promise(r => setImmediate(r)); pc.local.files.a.title = '新しい編集'; pc.api.write = original; release();
  await p; await new Promise(r => setImmediate(r)); if (pc.sync.running) await pc.sync.running;
  assert.equal(server.row.value.files.a.title, '新しい編集');
});
test('a CAS collision re-reads and merges the competing new course', async () => {
  const server = {}, pc = device(server, library({a: file('A')})); const original = pc.api.write;
  pc.api.write = async (...args) => {pc.api.write = original; server.row = {value: library({b: file('B')}), version: 1}; throw {code: 'conflict'};};
  await pc.sync.sync(); await new Promise(r => setImmediate(r)); if (pc.sync.running) await pc.sync.running;
  assert.deepEqual(Object.keys(server.row.value.files).sort(), ['a', 'b']);
});
test('new remote edits invalidate an earlier conflict choice', async () => {
  const server = {row: {value: library({a: file('別端末')}), version: 1}}, pc = device(server, library({a: file('端末')}));
  await pc.sync.sync(); server.row.value.files.a.title = 'もっと新しい編集'; server.row.version++;
  await pc.choose('local'); assert.equal(pc.state, 'conflict'); assert.equal(server.row.value.files.a.title, 'もっと新しい編集');
});
test('malformed cloud data never replaces valid local courses', async () => {
  const server = {row: {value: {format: 2, files: {a: {rows: []}}}, version: 1}}, pc = device(server, library({a: file('無事')}));
  await pc.sync.sync(); assert.equal(pc.state, 'offline'); assert.equal(pc.local.files.a.title, '無事');
});
