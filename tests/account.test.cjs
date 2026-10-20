'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('let accountBusy = false, accountMessage = ');
const end = html.indexOf('\nfunction googleButton(', start);
assert.ok(start >= 0 && end > start, 'The account action helpers must be present');
const source = html.slice(start, end);
const plain = value => JSON.parse(JSON.stringify(value));
const DAY = 86400000;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// These are ordinary in-memory test doubles. No browser, DOM implementation,
// Supabase client, network request or real authentication operation is run.
class Node {
  constructor(tag, props = {}, children = []) {
    this.tag = tag;
    this.children = children.filter(Boolean);
    this.attributes = {};
    this.hidden = true;
    this.disabled = false;
    this.textContent = '';
    for (const [key, value] of Object.entries(props)) {
      if (key === 'text') this.textContent = value;
      else if (key.startsWith('on')) this[key] = value;
      else this.attributes[key] = value;
    }
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  replaceChildren(...children) { this.children = children; }
  querySelectorAll() { return this.controls || []; }
  getBoundingClientRect() { return { height: this.height || 600 }; }
  scrollIntoView() { this.scrolled = true; }
  focus() { this.focused = true; }
}

function fixture(options = {}) {
  const state = {
    now: 1800000000000,
    local: new Map(Object.entries(options.local || {})),
    profile: options.profile === undefined ? {} : options.profile,
    patchResult: true,
    patches: [],
    calls: [],
    confirmResult: true,
  };
  const nodes = Object.fromEntries(['account', 'acct-note', 'pl-stage', 'pl-account-hint', 'play-account-hint'].map(id => [id, new Node('div')]));
  nodes.account.controls = [new Node('button'), new Node('input')];
  nodes['pl-stage'].height = options.height || 600;
  const social = {
    uid: 'guest-a', db: {}, canWrite: true, peopleLoaded: true,
    account: { uid: 'guest-a', isGuest: true, googleStatus: 'enabled', errorText: e => `認証エラー: ${e.message}` },
    ...options.social,
  };
  if (options.account) social.account = { ...social.account, ...options.account };
  const context = {
    Date: class extends Date { static now() { return state.now; } },
    $: id => nodes[id],
    el: (tag, props, ...children) => new Node(tag, props, children),
    social,
    store: { get: key => state.local.get(key) ?? null, set: (key, value) => state.local.set(key, value) },
    formDirty: !!options.formDirty,
    writeChain: options.writeChain || Promise.resolve(true),
    saveDraft: () => state.calls.push('saveDraft'),
    me: () => state.profile,
    myLook: () => state.local.get('hi-look'),
    patchMe: async patch => { state.calls.push('patchMe'); state.patches.push(plain(patch)); return state.patchResult; },
    closePlayer: () => state.calls.push('closePlayer'),
    closeSheet: () => state.calls.push('closeSheet'),
    setTab: name => state.calls.push(`tab:${name}`),
    confirm: text => { state.calls.push(['confirm', text]); return state.confirmResult; },
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.api = { prepareAccountChange, runAccountAction, showAccountHint, confirmAccountSwitch, get busy() { return accountBusy; }, get message() { return accountMessage; } };', context, { filename: 'index.html:account-actions' });
  return { state, nodes, social, context, api: context.api };
}

test('account navigation waits for the current save before opening authentication', async () => {
  const save = deferred();
  const f = fixture({ writeChain: save.promise });
  const pending = f.api.runAccountAction(async () => f.state.calls.push('auth'), '完了');
  assert.equal(f.api.busy, true);
  assert.ok(f.nodes.account.controls.every(node => node.disabled));
  assert.deepEqual(f.state.calls, ['saveDraft']);
  save.resolve(true);
  await pending;
  assert.deepEqual(f.state.calls, ['saveDraft', 'auth']);
  assert.equal(f.api.message, '完了');
  assert.equal(f.api.busy, false);
  assert.ok(f.nodes.account.controls.every(node => !node.disabled));
});

test('only improved scores, wins, collected items and faster clears are synchronized', async () => {
  const f = fixture({
    local: {
      'hi-endless': 500, 'hi-wins': 7,
      'hi-items': { pan: true, fork: true, absent: false },
      'hi-clears': { faster: 12.5, slower: 18, same: 10, first: 23, invalid: -1, malformed: '5' },
      'hi-name': 'ローカル名', 'hi-look': { hat: 'fork' },
    },
    profile: { endless: 450, battle: { wins: 5 }, items: { pan: true }, clears: { faster: 16, slower: 13, same: 10 }, name: 'オンライン名', look: { hat: 'pan' } },
  });
  await f.api.prepareAccountChange();
  assert.deepEqual(f.state.patches, [{ endless: 500, battle: { wins: 7 }, items: { fork: true }, clears: { faster: 12.5, first: 23 } }]);
});

test('better online records and an existing online profile are never overwritten by stale local data', async () => {
  const f = fixture({ local: { 'hi-endless': 10, 'hi-wins': 1, 'hi-clears': { course: 20 }, 'hi-name': '古い名前', 'hi-look': { hat: 'old' } }, profile: { endless: 200, battle: { wins: 3 }, clears: { course: 12 } } });
  await f.api.prepareAccountChange();
  assert.deepEqual(f.state.patches, []);
});

test('a first online profile also preserves this hamster’s saved name and appearance', async () => {
  const f = fixture({ profile: null, local: { 'hi-name': 'saved hamster name', 'hi-look': { hat: 'pan' }, 'hi-endless': 60 } });
  await f.api.prepareAccountChange();
  assert.deepEqual(f.state.patches, [{ endless: 60, name: 'saved hamste', look: { hat: 'pan' } }]);
});

for (const [label, options, setup, expected] of [
  ['unsaved profile edits', { formDirty: true }, () => {}, /未保存/],
  ['profile loading', { social: { peopleLoaded: false } }, () => {}, /読み込み中/],
  ['a failed progress save', { local: { 'hi-endless': 50 } }, f => { f.state.patchResult = false; }, /保存できません/],
]) {
  test(`${label} prevents authentication and releases the busy state`, async () => {
    const f = fixture(options); setup(f);
    let authenticated = false;
    await f.api.runAccountAction(async () => { authenticated = true; }, '完了');
    assert.equal(authenticated, false);
    assert.match(f.api.message, expected);
    assert.equal(f.nodes['acct-note'].hidden, false);
    assert.equal(f.api.busy, false);
    assert.ok(f.nodes.account.controls.every(node => !node.disabled));
  });
}

test('an unavailable guest session can still begin an existing-account login', async () => {
  const f = fixture({ social: { uid: null, canWrite: false, peopleLoaded: false }, account: { uid: null } });
  let authenticated = false;
  await f.api.runAccountAction(async () => { authenticated = true; }, '完了');
  assert.equal(authenticated, true);
  assert.deepEqual(f.state.patches, []);
});

test('double activation starts one account action and restores controls after an OAuth error', async () => {
  const auth = deferred(), f = fixture();
  let calls = 0;
  const action = () => { calls++; return auth.promise; };
  const first = f.api.runAccountAction(action, '完了');
  await Promise.resolve(); await Promise.resolve();
  await f.api.runAccountAction(action, '二度目');
  assert.equal(calls, 1);
  assert.equal(f.api.busy, true);
  auth.reject(new Error('cancelled'));
  await first;
  assert.equal(f.api.message, '認証エラー: cancelled');
  assert.equal(f.api.busy, false);
  assert.ok(f.nodes.account.controls.every(node => !node.disabled));
});

for (const [label, account] of [['registered hamster', { isGuest: false }], ['missing guest UID', { uid: null }]]) {
  test(`the optional hint stays hidden for a ${label}`, () => {
    const f = fixture({ account });
    f.api.showAccountHint('play-account-hint');
    assert.equal(f.nodes['play-account-hint'].hidden, true);
    assert.equal(f.state.local.has('hi-auth-nudge-after'), false);
  });
}

test('a hint appears at most once in the current page and suppresses the next day', () => {
  const f = fixture();
  f.api.showAccountHint('pl-account-hint');
  assert.equal(f.nodes['pl-account-hint'].hidden, false);
  assert.equal(f.state.local.get('hi-auth-nudge-after'), f.state.now + DAY);
  f.api.showAccountHint('play-account-hint');
  assert.equal(f.nodes['play-account-hint'].hidden, true);
  const next = fixture({ local: Object.fromEntries(f.state.local) });
  next.api.showAccountHint('play-account-hint');
  assert.equal(next.nodes['play-account-hint'].hidden, true);
});

test('dismissing a hint leaves the game running and suppresses reminders for seven days', () => {
  const f = fixture();
  f.api.showAccountHint('pl-account-hint');
  const close = f.nodes['pl-account-hint'].children.find(node => node.attributes['aria-label']);
  let stopped = false;
  close.onclick({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(f.nodes['pl-account-hint'].hidden, true);
  assert.equal(f.state.local.get('hi-auth-nudge-after'), f.state.now + 7 * DAY);
  assert.deepEqual(f.state.calls, []);
});

test('a small game viewport leaves the result unobstructed and allows a later publication hint', () => {
  const f = fixture({ height: 350 });
  f.api.showAccountHint('pl-account-hint');
  assert.equal(f.nodes['pl-account-hint'].hidden, true);
  assert.equal(f.state.local.has('hi-auth-nudge-after'), false);
  f.api.showAccountHint('play-account-hint');
  assert.equal(f.nodes['play-account-hint'].hidden, false);
});

test('hint pointer presses cannot trigger a game retry and the call to action only opens account settings', () => {
  const f = fixture();
  f.api.showAccountHint('pl-account-hint');
  const hint = f.nodes['pl-account-hint'];
  let stopped = 0;
  hint.onpointerdown({ stopPropagation() { stopped++; } });
  assert.deepEqual(f.state.calls, []);
  hint.children.find(node => node.textContent === '引き継ぎ設定').onclick({ stopPropagation() { stopped++; } });
  assert.equal(stopped, 2);
  assert.equal(hint.hidden, true);
  assert.deepEqual(f.state.calls, ['closePlayer', 'closeSheet', 'tab:me']);
  assert.equal(f.nodes.account.scrolled, true);
  assert.equal(f.nodes.account.focused, true);
});

test('a disabled Google provider is not advertised in the reminder', () => {
  const f = fixture({ account: { googleStatus: 'disabled' } });
  f.api.showAccountHint('play-account-hint');
  const text = f.nodes['play-account-hint'].children.map(node => node.textContent).join(' ');
  assert.match(text, /メールを登録/);
  assert.doesNotMatch(text, /Google/);
});

test('a player can decline account switching without an authentication or navigation side effect', () => {
  const f = fixture(); f.state.confirmResult = false;
  assert.equal(f.api.confirmAccountSwitch(), false);
  assert.equal(f.state.calls.length, 1);
  assert.match(f.state.calls[0][1], /記録は自動では移りません/);
  assert.match(f.state.calls[0][1], /先にGoogle連携かメール登録/);
});
