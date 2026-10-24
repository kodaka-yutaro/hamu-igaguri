'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('const localMemory = new Map();');
const end = html.indexOf('\nconst ago = ', start);
assert.ok(start >= 0 && end > start, 'The account storage block must be present');
const source = html.slice(start, end);
const plain = value => JSON.parse(JSON.stringify(value));
const userKey = (uid, key) => `hi-user:${uid}:${key}`;
const record = {
  'hi-endless': 450,
  'hi-wins': 7,
  'hi-items': { pan: true, hashi: true },
  'hi-clears': { 'my-course': 12.3 },
  'hi-course-runs': { 'my-course': { device: {attempts: 4, clears: 1} } },
  'hi-look': { body: '#f0b56a', hat: 'pan' },
  'hi-name': 'もとのハム',
  'hi-draft': { title: '作りかけ', rows: ['S..G'] },
  'hi-course-library': {format: 2, files: {first: {title: 'コース1', rows: ['S..G']}, second: {title: 'コース2', rows: ['S..G']}}},
  'hi-course-active': 'second',
  'hi-course-library-sync': {version: 3, value: {format: 2, files: {}}},
  'hi-course-library-backup': {format: 2, files: {backup: {title: '復元用', rows: ['S..G']}}},
  'hi-noti-seen': 123456,
  'hi-maker': 5,
  'hi-auth-nudge-after': 987654,
};

function disk(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  const state = { failRead: false, failWrite: false, failWriteFor: null };
  return {
    state,
    getItem(key) {
      if (state.failRead) throw new Error('Storage access denied');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (state.failWrite || state.failWriteFor && state.failWriteFor(key)) throw new Error('Storage quota exceeded');
      values.set(key, String(value));
    },
    read(key) { return values.has(key) ? JSON.parse(values.get(key)) : null; },
    write(key, value) { values.set(key, JSON.stringify(value)); },
  };
}

function tab(localStorage, config = { supabaseUrl: 'https://test-project.supabase.co' }) {
  const window = { HAMU_CONFIG: config, __hamuTest: true };
  // Only the storage block is evaluated; no game, Supabase, browser or network code runs.
  vm.runInNewContext(source, { window, localStorage, URL }, { filename: 'index.html:account-storage' });
  assert.ok(window.__accountStore, 'The production storage interface must be exposed');
  return window.__accountStore;
}

test('legacy records stay available and migrate to the first identified hamster', () => {
  const localStorage = disk(record);
  const store = tab(localStorage);
  assert.equal(store.get('hi-endless'), 450);
  assert.equal(store.useUser('guest-a'), false);
  for (const [key, value] of Object.entries(record)) {
    assert.deepEqual(plain(store.get(key)), value, key);
    assert.deepEqual(localStorage.read(userKey('guest-a', key)), value, key);
    assert.deepEqual(localStorage.read(key), value, 'Migration must not destroy the old backup');
  }
  assert.equal(localStorage.read('hi-local-owner'), 'guest-a');
  assert.equal(localStorage.read('hi-local-migrated'), true);
});

test('same-UID Google linkage preserves all local records and the course draft', () => {
  const localStorage = disk({ ...record, 'hi-local-owner': 'guest-a' });
  const store = tab(localStorage);
  assert.equal(store.useUser('guest-a'), false);
  for (const [key, value] of Object.entries(record)) assert.deepEqual(plain(store.get(key)), value, key);
  const afterRedirect = tab(localStorage);
  assert.equal(afterRedirect.useUser('guest-a'), false);
  for (const [key, value] of Object.entries(record)) assert.deepEqual(plain(afterRedirect.get(key)), value, key);
});

test('switching UID isolates scores, wins, items, clears, appearance and drafts', () => {
  const localStorage = disk({ ...record, 'hi-local-owner': 'guest-a' });
  const store = tab(localStorage);
  assert.equal(store.useUser('google-b'), true);
  for (const key of Object.keys(record)) assert.equal(store.get(key), null, key);
  assert.equal(localStorage.read('hi-local-owner'), 'google-b');
  assert.equal(localStorage.read(userKey('google-b', 'hi-endless')), null);
});

test('each hamster recovers its own values after switching back', () => {
  const localStorage = disk({ ...record, 'hi-local-owner': 'guest-a' });
  const store = tab(localStorage);
  store.useUser('google-b');
  store.set('hi-endless', 25);
  store.set('hi-items', { fork: true });
  store.set('hi-look', { body: '#ffffff', hat: 'none' });
  store.set('hi-draft', { title: '別のコース', rows: ['S.G'] });
  store.set('hi-name', '別のハム');
  assert.equal(store.useUser('guest-a'), true);
  for (const [key, value] of Object.entries(record)) assert.deepEqual(plain(store.get(key)), value, key);
  assert.equal(store.useUser('google-b'), true);
  assert.equal(store.get('hi-endless'), 25);
  assert.deepEqual(plain(store.get('hi-items')), { fork: true });
  assert.deepEqual(plain(store.get('hi-look')), { body: '#ffffff', hat: 'none' });
  assert.deepEqual(plain(store.get('hi-draft')), { title: '別のコース', rows: ['S.G'] });
  assert.equal(store.get('hi-name'), '別のハム');
  assert.equal(store.get('hi-wins'), null);
});

test('mute is shared across hamster accounts and browser tabs', () => {
  const localStorage = disk({ 'hi-local-owner': 'guest-a', 'hi-mute': false });
  const first = tab(localStorage);
  const second = tab(localStorage);
  first.set('hi-mute', true);
  first.useUser('google-b');
  assert.equal(first.get('hi-mute'), true);
  assert.equal(second.get('hi-mute'), true);
  second.set('hi-mute', false);
  assert.equal(first.get('hi-mute'), false, 'Successful writes must not leave stale per-tab cache entries');
  assert.equal(localStorage.read(userKey('google-b', 'hi-mute')), null);
});

test('legacy ownership is recovered from the saved Supabase session before an OAuth account switch', () => {
  const localStorage = disk({
    ...record,
    'sb-test-project-auth-token': { user: { id: 'original-guest', is_anonymous: true } },
  });
  const store = tab(localStorage);
  assert.equal(localStorage.read('hi-local-owner'), 'original-guest');
  assert.equal(store.get('hi-endless'), 450);
  // Simulate the SDK completing the first OAuth callback after the storage block was initialized.
  localStorage.write('sb-test-project-auth-token', { user: { id: 'existing-google', is_anonymous: false } });
  assert.equal(store.useUser('existing-google'), true);
  for (const key of Object.keys(record)) assert.equal(store.get(key), null, key);
  store.useUser('original-guest');
  for (const [key, value] of Object.entries(record)) assert.deepEqual(plain(store.get(key)), value, key);
});

test('an explicit old owner takes precedence over a newly stored OAuth session', () => {
  const localStorage = disk({
    ...record,
    'hi-local-owner': 'original-guest',
    'sb-test-project-auth-token': { user: { id: 'existing-google', is_anonymous: false } },
  });
  const store = tab(localStorage);
  assert.equal(localStorage.read('hi-local-owner'), 'original-guest');
  assert.equal(localStorage.read(userKey('original-guest', 'hi-endless')), 450);
  store.useUser('existing-google');
  assert.equal(store.get('hi-endless'), null);
  assert.equal(localStorage.read(userKey('existing-google', 'hi-endless')), null);
});

test('migration does not overwrite existing scoped records, including zero and false values', () => {
  const localStorage = disk({
    ...record,
    'hi-local-owner': 'guest-a',
    [userKey('guest-a', 'hi-endless')]: 0,
    [userKey('guest-a', 'hi-items')]: { pan: false },
    [userKey('guest-a', 'hi-maker')]: false,
  });
  const store = tab(localStorage);
  assert.equal(store.get('hi-endless'), 0);
  assert.deepEqual(plain(store.get('hi-items')), { pan: false });
  assert.equal(store.get('hi-maker'), false);
  assert.equal(store.get('hi-name'), 'もとのハム');
});

test('completed migration never imports the legacy backup into a different UID', () => {
  const localStorage = disk({ ...record, 'hi-local-owner': 'guest-a' });
  const first = tab(localStorage);
  first.useUser('google-b');
  const afterReload = tab(localStorage);
  assert.equal(afterReload.get('hi-endless'), null);
  assert.equal(afterReload.get('hi-draft'), null);
  afterReload.useUser('guest-a');
  assert.equal(afterReload.get('hi-endless'), 450);
});

test('tabs keep writing to their own bound UID when another tab changes the active owner', () => {
  const localStorage = disk({ ...record, 'hi-local-owner': 'guest-a' });
  const first = tab(localStorage);
  const second = tab(localStorage);
  second.useUser('google-b');
  second.set('hi-endless', 30);
  first.set('hi-endless', 500);
  assert.equal(localStorage.read(userKey('guest-a', 'hi-endless')), 500);
  assert.equal(localStorage.read(userKey('google-b', 'hi-endless')), 30);
  assert.equal(first.get('hi-endless'), 500);
  assert.equal(second.get('hi-endless'), 30);
});

test('successful writes observe newer same-UID values written by another tab', () => {
  const localStorage = disk({ 'hi-local-owner': 'guest-a' });
  const first = tab(localStorage);
  const second = tab(localStorage);
  first.set('hi-endless', 100);
  second.set('hi-endless', 200);
  assert.equal(first.get('hi-endless'), 200, 'Persistent values must not be shadowed by a stale successful-write cache');
});

test('storage access failure still allows play and isolation for the current page', () => {
  const localStorage = disk();
  localStorage.state.failRead = true;
  localStorage.state.failWrite = true;
  const store = tab(localStorage);
  store.set('hi-endless', 100);
  store.set('hi-draft', { title: '一時的な下書き', rows: ['S.G'] });
  assert.equal(store.useUser('guest-a'), false);
  assert.equal(store.get('hi-endless'), 100);
  store.useUser('google-b');
  assert.equal(store.get('hi-endless'), null);
  store.set('hi-endless', 20);
  store.useUser('guest-a');
  assert.equal(store.get('hi-endless'), 100);
  assert.deepEqual(plain(store.get('hi-draft')), { title: '一時的な下書き', rows: ['S.G'] });
  store.useUser('google-b');
  assert.equal(store.get('hi-endless'), 20);
});

test('quota failure retains readable legacy records in memory for the current page', () => {
  const localStorage = disk({ ...record, 'hi-local-owner': 'guest-a' });
  localStorage.state.failWrite = true;
  const store = tab(localStorage);
  for (const [key, value] of Object.entries(record)) assert.deepEqual(plain(store.get(key)), value, key);
  store.set('hi-endless', 600);
  assert.equal(store.get('hi-endless'), 600);
  store.useUser('google-b');
  assert.equal(store.get('hi-endless'), null);
  store.useUser('guest-a');
  assert.equal(store.get('hi-endless'), 600);
});

test('a later successful write clears a failed-write fallback so other tabs can update it', () => {
  const localStorage = disk({ 'hi-local-owner': 'guest-a' });
  const store = tab(localStorage);
  localStorage.state.failWrite = true;
  store.set('hi-endless', 100);
  assert.equal(store.get('hi-endless'), 100);
  localStorage.state.failWrite = false;
  store.set('hi-endless', 150);
  localStorage.write(userKey('guest-a', 'hi-endless'), 200);
  assert.equal(store.get('hi-endless'), 200);
});

test('a partially failed migration retries the large draft after storage recovers', () => {
  const localStorage = disk({ ...record, 'hi-local-owner': 'guest-a' });
  localStorage.state.failWriteFor = key => key === userKey('guest-a', 'hi-draft');
  const first = tab(localStorage);
  assert.deepEqual(plain(first.get('hi-draft')), record['hi-draft']);
  assert.equal(localStorage.read(userKey('guest-a', 'hi-draft')), null);
  localStorage.state.failWriteFor = null;
  const afterReload = tab(localStorage);
  assert.deepEqual(plain(afterReload.get('hi-draft')), record['hi-draft']);
  assert.deepEqual(localStorage.read(userKey('guest-a', 'hi-draft')), record['hi-draft']);
});

test('an unfinished migration remains owned by the old UID after an account switch and reload', () => {
  const localStorage = disk({ ...record, 'hi-local-owner': 'guest-a' });
  localStorage.state.failWriteFor = key => key === userKey('guest-a', 'hi-draft');
  const first = tab(localStorage);
  first.useUser('google-b');
  assert.equal(first.get('hi-draft'), null);
  localStorage.state.failWriteFor = null;
  const afterReload = tab(localStorage);
  assert.equal(afterReload.get('hi-endless'), null, 'Unfinished old records must not migrate to the current OAuth user');
  assert.equal(afterReload.get('hi-draft'), null);
  assert.equal(localStorage.read(userKey('google-b', 'hi-draft')), null);
  afterReload.useUser('guest-a');
  assert.deepEqual(plain(afterReload.get('hi-draft')), record['hi-draft']);
});

test('missing or malformed Supabase session does not break legacy access or first-user adoption', () => {
  for (const config of [{}, { supabaseUrl: 'not-a-url' }, { supabaseUrl: 'https://test-project.supabase.co' }]) {
    const localStorage = disk({ ...record, 'sb-test-project-auth-token': { user: null } });
    const store = tab(localStorage, config);
    assert.equal(store.get('hi-endless'), 450);
    assert.equal(store.useUser('guest-a'), false);
    assert.equal(store.get('hi-endless'), 450);
  }
});

test('a missing UID never resets the active hamster', () => {
  const store = tab(disk({ ...record, 'hi-local-owner': 'guest-a' }));
  for (const uid of [null, undefined, '']) {
    assert.equal(store.useUser(uid), false);
    assert.equal(store.get('hi-endless'), 450);
    assert.equal(store.get('hi-name'), 'もとのハム');
  }
});
