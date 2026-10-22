const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('// Each page owns a counter shard;'), html.indexOf('function likeCount(cid)'));
const copy = x => JSON.parse(JSON.stringify(x));
function harness(){
  const local = new Map(), social = {people: new Map(), uid: 'a', db: null, peopleLoaded: true};
  const writes = [];
  const c = {social, crypto: require('node:crypto').webcrypto, Uint32Array,
    store: {get: k => copy(local.get(k) || null), set: (k,v) => local.set(k, copy(v))},
    current: {course: {id:'c'}, mode:'play'}, me: () => social.people.get(social.uid),
    window: {addEventListener(){}}, renderAll(){},
    patchMe: async p => { writes.push(copy(p)); if (!social.people.has('a')) social.people.set('a', {}); return true; },
    el: (tag, props, ...children) => ({tag, props, children})};
  vm.createContext(c); vm.runInContext(source, c);
  return {c, social, local, writes, rate: () => copy(c.courseRate('c')), state: s => c.trackCourseRun(s)};
}
test('no data stays unknown and old fastest times do not invent attempts', () => {
  const h = harness(); h.social.people.set('b', {clears:{c:4.5}});
  assert.deepEqual(h.rate(), {attempts:0, clears:0, rate:null});
});
test('opening is not an attempt; retries, abandonment and repeated clears count correctly', () => {
  const h = harness(); h.state('ready'); assert.equal(h.rate().attempts, 0);
  h.state('run'); h.state('run'); h.state('dead');
  assert.deepEqual(h.rate(), {attempts:1, clears:0, rate:0});
  h.state('ready'); h.state('run'); h.state('clear'); h.state('clear');
  assert.deepEqual(h.rate(), {attempts:2, clears:1, rate:50});
  h.state('ready'); h.state('run'); h.state('clear');
  assert.equal(h.rate().clears, 2);
  h.state('ready'); h.state('run'); h.c.current = null;
  assert.deepEqual(h.rate(), {attempts:4, clears:2, rate:50});
});
test('test, endless and battle modes never enter course statistics', () => {
  const h = harness();
  for (const mode of ['test','endless','battle']){
    h.c.current.mode = mode; for (const s of ['ready','run','dead','ready','run','clear']) h.state(s);
  }
  assert.equal(h.rate().attempts, 0);
});
test('sum independent players and devices; local and remote copies are deduplicated', () => {
  const h = harness();
  h.social.people.set('a', {courseRuns:{c:{device1:{attempts:5,clears:2}, device2:{attempts:2,clears:1}}}});
  h.local.set('hi-course-runs', {c:{device1:{attempts:6,clears:3}}});
  h.social.people.set('b', {courseRuns:{c:{device3:{attempts:2,clears:0}}}});
  assert.deepEqual(h.rate(), {attempts:10, clears:4, rate:40});
});
test('malformed counts cannot produce NaN, negative rates or rates over 100%', () => {
  const h = harness(); h.social.people.set('b', {courseRuns:{c:{bad:{attempts:-4,clears:Infinity}, odd:{attempts:2,clears:9}, text:{attempts:'3',clears:true}}}});
  assert.deepEqual(h.rate(), {attempts:2, clears:2, rate:100});
});
test('a clear during an in-flight attempt save is sent and retries are idempotent', async () => {
  const h = harness(); h.social.db = {}; h.state('run'); h.state('clear');
  await new Promise(resolve => setImmediate(resolve));
  await h.c.syncCourseRuns();
  assert.deepEqual(h.rate(), {attempts:1, clears:1, rate:100});
  assert.equal(h.writes.length, 2);
  await h.c.syncCourseRuns(); assert.equal(h.writes.length, 2);
});
test('failed saves remain local and sync when connectivity returns', async () => {
  const h = harness(); h.social.db = {}; const real = h.c.patchMe;
  h.c.patchMe = async () => false; h.state('run'); h.state('clear');
  await new Promise(resolve => setImmediate(resolve));
  h.c.patchMe = real; await h.c.syncCourseRuns();
  assert.deepEqual(h.rate(), {attempts:1, clears:1, rate:100});
  assert.equal(h.writes.length, 1);
});
