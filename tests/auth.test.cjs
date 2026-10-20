'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '..', 'backend.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const makeUser = (id = 'guest-a', extra = {}) => ({
  id, is_anonymous: true, email: '', identities: [], ...extra,
});
const makeSession = user => ({ user, access_token: 'fake-access', refresh_token: 'fake-refresh' });
const googleUser = (id = 'google-b') => makeUser(id, {
  is_anonymous: false, email: 'player@example.test', identities: [{ provider: 'google' }],
});

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

// All browser APIs and Supabase operations are fakes. This harness cannot send requests.
function harness(options = {}) {
  let session = Object.hasOwn(options, 'session') ? options.session : makeSession(makeUser());
  let currentUrl = new URL(options.url || 'https://game.example.test/?c=shared-course');
  const sessionStorage = storage(options.sessionStorage);
  const localStorage = storage(options.localStorage);
  const calls = {
    createClient: [], getSession: 0, anonymous: 0, link: [], oauth: [], signOut: 0,
    updateUser: [], otp: [], fetch: [], reload: 0, history: [], writes: [], warnings: [],
  };
  const authListeners = [];
  const timers = new Map();
  let nextTimer = 0;
  const setTimeoutFake = (fn, delay = 0) => {
    const id = ++nextTimer;
    timers.set(id, { fn, delay });
    return id;
  };
  const location = {
    get href() { return currentUrl.href; },
    get origin() { return currentUrl.origin; },
    get pathname() { return currentUrl.pathname; },
    reload() { calls.reload++; },
  };
  const history = {
    state: null,
    replaceState(state, _title, relativeUrl) {
      calls.history.push(relativeUrl);
      currentUrl = new URL(relativeUrl, currentUrl);
      this.state = state;
    },
  };
  const auth = {
    async getSession() {
      calls.getSession++;
      if (options.sessionGate) await options.sessionGate;
      return { data: { session }, error: null };
    },
    async signInAnonymously() {
      calls.anonymous++;
      if (options.anonymousError) return { data: { session: null }, error: options.anonymousError };
      session = makeSession(makeUser('new-guest'));
      return { data: { session }, error: null };
    },
    async linkIdentity(args) {
      calls.link.push(copy(args));
      return { data: { url: 'https://accounts.example.test/fake-link' }, error: options.linkError || null };
    },
    async signInWithOAuth(args) {
      calls.oauth.push(copy(args));
      return { data: { url: 'https://accounts.example.test/fake-signin' }, error: options.oauthError || null };
    },
    async signOut() { calls.signOut++; session = null; return { error: null }; },
    async updateUser(...args) { calls.updateUser.push(copy(args)); return { error: null }; },
    async signInWithOtp(args) { calls.otp.push(copy(args)); return { error: null }; },
    onAuthStateChange(fn) {
      authListeners.push(fn);
      if (options.emitInitial) fn('INITIAL_SESSION', session);
      return { data: { subscription: { unsubscribe() {} } } };
    },
    stopAutoRefresh() {},
    async refreshSession() { return { data: { session }, error: null }; },
  };
  function from(table) {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      async maybeSingle() { return { data: table === 'admins' && options.admin ? { user_id: session.user.id } : null, error: null }; },
      async limit() { return { data: [], error: null }; },
      async upsert(row) { calls.writes.push({ table, row: copy(row) }); return { error: null }; },
    };
    return chain;
  }
  const channel = () => ({ on() { return this; }, subscribe() { return this; } });
  const client = { auth, from, channel, removeChannel() {} };
  const window = {
    HAMU_CONFIG: options.config === null ? {} : { supabaseUrl: 'https://auth.example.test', supabaseAnonKey: 'fake-public-key' },
    supabase: { createClient(...args) { calls.createClient.push(copy(args)); return client; } },
  };
  const fetchFake = async (url, args) => {
    calls.fetch.push({ url, headers: copy(args.headers) });
    assert.equal(url, 'https://auth.example.test/auth/v1/settings', 'Only the fake settings endpoint may be used');
    if (options.fetchError) throw options.fetchError;
    if (options.fetchHangs) {
      return new Promise((_resolve, reject) => args.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
    return {
      ok: options.httpOk !== false,
      async json() {
        if (options.jsonError) throw options.jsonError;
        return Object.hasOwn(options, 'settings') ? options.settings : { external: { google: true } };
      },
    };
  };
  vm.runInNewContext(source, {
    window, location, history, sessionStorage, localStorage, fetch: fetchFake,
    URL, URLSearchParams, AbortController, Date,
    setTimeout: setTimeoutFake, clearTimeout: id => timers.delete(id),
    console: { warn: (...args) => calls.warnings.push(args) },
    crypto: { randomUUID: () => 'fake-uuid' },
  }, { filename: 'backend.js' });
  return {
    connect: () => window.hamuBackend(), calls, sessionStorage, localStorage,
    get url() { return currentUrl; },
    get session() { return session; },
    setSession(value) { session = value; },
    emit(event, nextSession = session) { for (const fn of authListeners) fn(event, nextSession); },
    runTimers(maxDelay = 0) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay > maxDelay || !timers.has(id)) continue;
        timers.delete(id);
        timer.fn();
      }
    },
  };
}

test('an existing guest plays without contacting Google or replacing the account', async () => {
  const h = harness({ emitInitial: true });
  const backend = await h.connect();
  assert.equal(backend.account.uid, 'guest-a');
  assert.equal(backend.account.isGuest, true);
  assert.equal(h.calls.anonymous, 0);
  assert.equal(h.calls.fetch.length, 0);
  assert.equal(h.calls.oauth.length, 0);
  assert.equal(h.calls.link.length, 0);
  h.runTimers();
  assert.equal(h.calls.reload, 0);
});

test('callback session resolution finishes before a guest can be created', async () => {
  let finishCallback;
  const sessionGate = new Promise(resolve => { finishCallback = resolve; });
  const h = harness({ session: null, sessionGate });
  const pending = h.connect();
  assert.equal(h.calls.anonymous, 0);
  h.setSession(makeSession(googleUser()));
  finishCallback();
  const backend = await pending;
  assert.equal(backend.account.uid, 'google-b');
  assert.equal(h.calls.anonymous, 0);
});

test('a first visit creates one guest and still does not begin OAuth', async () => {
  const h = harness({ session: null });
  const backend = await h.connect();
  assert.equal(h.calls.anonymous, 1);
  assert.equal(backend.account.uid, 'new-guest');
  assert.equal(h.calls.oauth.length + h.calls.link.length, 0);
});

for (const [name, user] of [
  ['guest', makeUser()],
  ['email account', makeUser('email-a', { is_anonymous: false, email: 'email@example.test', identities: [{ provider: 'email' }] })],
]) {
  test(`${name} links Google without signing out or changing document ownership`, async () => {
    const h = harness({ session: makeSession(user) });
    const backend = await h.connect();
    await backend.account.attachGoogle();
    assert.equal(h.calls.link.length, 1);
    assert.equal(h.calls.link[0].provider, 'google');
    assert.deepEqual(h.calls.link[0].options, {
      redirectTo: 'https://game.example.test/', queryParams: { prompt: 'select_account' },
    });
    assert.equal(h.calls.oauth.length, 0);
    assert.equal(h.calls.signOut, 0);
    assert.equal(backend.account.uid, user.id);
    assert.equal(await backend.user.id(), user.id);
    const intent = JSON.parse(h.sessionStorage.getItem('hi-auth-intent'));
    assert.equal(intent.kind, 'link');
    assert.equal(intent.uid, user.id);
    assert.equal(Object.keys(intent).some(key => /token|secret/i.test(key)), false);
    await backend.db.doc(`people/${user.id}`).set({ endless: 123, name: 'いまのハム' });
    assert.deepEqual(h.calls.writes[0], {
      table: 'docs', row: { col: 'people', id: user.id, data: { endless: 123, name: 'いまのハム' }, owner: user.id },
    });
  });
}

test('returning to a registered Google account uses OAuth without a preliminary sign-out', async () => {
  const h = harness();
  const backend = await h.connect();
  await backend.account.signInGoogle();
  assert.equal(h.calls.oauth.length, 1);
  assert.equal(h.calls.oauth[0].provider, 'google');
  assert.equal(h.calls.link.length, 0);
  assert.equal(h.calls.signOut, 0);
  assert.equal(JSON.parse(h.sessionStorage.getItem('hi-auth-intent')).kind, 'signin');
});

for (const code of ['identity_already_exists', 'manual_linking_disabled']) {
  test(`${code} keeps the guest and never falls back to a different login`, async () => {
    const error = Object.assign(new Error(code), { code });
    const h = harness({ linkError: error });
    const backend = await h.connect();
    await assert.rejects(backend.account.attachGoogle(), value => value === error);
    assert.equal(h.calls.link.length, 1);
    assert.equal(h.calls.oauth.length, 0);
    assert.equal(h.calls.signOut, 0);
    assert.equal(h.session.user.id, 'guest-a');
    assert.equal(h.sessionStorage.getItem('hi-auth-intent'), null);
    assert.match(backend.account.errorText(error), code === 'identity_already_exists' ? /別のハム/ : /準備中/);
  });
}

for (const [name, options, expectedStatus] of [
  ['disabled provider', { settings: { external: { google: false } } }, 'disabled'],
  ['missing provider settings', { settings: {} }, 'disabled'],
  ['HTTP failure', { httpOk: false }, 'unavailable'],
  ['network failure', { fetchError: new Error('network unavailable') }, 'unavailable'],
  ['invalid JSON', { jsonError: new Error('invalid JSON') }, 'unavailable'],
]) {
  test(`${name} makes Google unavailable while leaving the guest intact`, async () => {
    const h = harness(options);
    const backend = await h.connect();
    assert.equal(await backend.account.checkGoogle(), false);
    assert.equal(backend.account.googleStatus, expectedStatus);
    await assert.rejects(backend.account.attachGoogle(), /provider not enabled/);
    await assert.rejects(backend.account.signInGoogle(), /provider not enabled/);
    assert.equal(h.calls.oauth.length + h.calls.link.length, 0);
    assert.equal(h.calls.signOut, 0);
    assert.equal(h.session.user.id, 'guest-a');
  });
}

test('a hanging settings request times out without blocking guest play', async () => {
  const h = harness({ fetchHangs: true });
  const backend = await h.connect();
  const check = backend.account.checkGoogle();
  h.runTimers(5000);
  assert.equal(await check, false);
  assert.equal(backend.account.googleStatus, 'unavailable');
  assert.equal(h.session.user.id, 'guest-a');
});

test('concurrent provider checks use a single mocked request', async () => {
  const h = harness();
  const backend = await h.connect();
  assert.deepEqual(await Promise.all([backend.account.checkGoogle(), backend.account.checkGoogle()]), [true, true]);
  assert.equal(h.calls.fetch.length, 1);
  assert.deepEqual(h.calls.fetch[0].headers, { apikey: 'fake-public-key' });
});

for (const [name, url] of [
  ['fragment', 'https://game.example.test/?c=shared-course#error=access_denied&error_description=cancelled&keep=1'],
  ['query string', 'https://game.example.test/?c=shared-course&error=access_denied&error_description=cancelled#keep=1'],
]) {
  test(`a cancelled OAuth callback in the ${name} preserves the guest and cleans auth errors`, async () => {
    const h = harness({ url, sessionStorage: { 'hi-auth-intent': JSON.stringify({ kind: 'link', uid: 'guest-a', at: Date.now() }) } });
    const backend = await h.connect();
    assert.equal(backend.account.uid, 'guest-a');
    assert.equal(h.calls.anonymous, 0);
    assert.equal(h.calls.signOut, 0);
    assert.equal(backend.account.returnToAccount, true);
    assert.match(backend.account.authNotice, /キャンセル/);
    assert.equal(h.sessionStorage.getItem('hi-auth-intent'), null);
    assert.equal(h.url.searchParams.get('c'), 'shared-course');
    assert.equal(new URLSearchParams(h.url.hash.slice(1)).get('keep'), '1');
    assert.doesNotMatch(h.url.href, /error(?:_description|_code)?=/);
  });
}

test('a successful Google link reports success only for the original UID', async () => {
  const intent = { kind: 'link', uid: 'guest-a', at: Date.now() };
  const h = harness({ session: makeSession(googleUser('guest-a')), sessionStorage: { 'hi-auth-intent': JSON.stringify(intent) } });
  const backend = await h.connect();
  assert.equal(backend.account.uid, 'guest-a');
  assert.equal(backend.account.hasGoogle, true);
  assert.match(backend.account.authNotice, /Googleと連携しました/);
  assert.equal(h.sessionStorage.getItem('hi-auth-intent'), null);

  const changed = harness({ session: makeSession(googleUser('other')), sessionStorage: { 'hi-auth-intent': JSON.stringify(intent) } });
  const otherBackend = await changed.connect();
  assert.doesNotMatch(otherBackend.account.authNotice, /Googleと連携しました/);
});

test('an expired auth intent does not produce a success message or open the account view', async () => {
  const h = harness({ sessionStorage: { 'hi-auth-intent': JSON.stringify({ kind: 'link', uid: 'guest-a', at: Date.now() - 16 * 60 * 1000 }) } });
  const backend = await h.connect();
  assert.equal(backend.account.returnToAccount, false);
  assert.equal(backend.account.authNotice, '');
  assert.equal(h.sessionStorage.getItem('hi-auth-intent'), null);
});

test('email attachment and returning-user email login keep their existing contracts', async () => {
  const h = harness();
  const backend = await h.connect();
  await backend.account.attachEmail('email@example.test');
  await backend.account.signInEmail('email@example.test');
  assert.deepEqual(h.calls.updateUser, [[{ email: 'email@example.test' }, { emailRedirectTo: 'https://game.example.test/' }]]);
  assert.deepEqual(h.calls.otp, [{ email: 'email@example.test', options: { shouldCreateUser: false, emailRedirectTo: 'https://game.example.test/' } }]);
  assert.equal(h.calls.signOut, 0);
});

test('same-user sign-in and token refresh do not reload the game', async () => {
  const session = makeSession(googleUser('same-user'));
  const h = harness({ session, emitInitial: true });
  await h.connect();
  h.emit('SIGNED_IN', copy(session));
  h.emit('TOKEN_REFRESHED', { ...copy(session), access_token: 'another-fake-token' });
  h.emit('USER_UPDATED', { ...copy(session), user: { ...session.user, user_metadata: { ignored: true } } });
  h.runTimers();
  assert.equal(h.calls.reload, 0);
});

for (const [name, nextUser] of [
  ['UID change', makeUser('guest-b')],
  ['guest converted to an email account', makeUser('guest-a', { is_anonymous: false, email: 'email@example.test' })],
  ['Google identity added', makeUser('guest-a', { identities: [{ provider: 'google' }] })],
  ['sign out', null],
]) {
  test(`${name} queues exactly one reload outside the auth callback`, async () => {
    const h = harness();
    await h.connect();
    const nextSession = nextUser ? makeSession(nextUser) : null;
    h.emit('USER_UPDATED', nextSession);
    h.emit('SIGNED_IN', nextSession);
    h.emit('TOKEN_REFRESHED', nextSession);
    assert.equal(h.calls.reload, 0);
    h.runTimers();
    assert.equal(h.calls.reload, 1);
    h.emit('SIGNED_IN', nextSession);
    h.runTimers();
    assert.equal(h.calls.reload, 1);
  });
}

test('missing backend configuration keeps offline play available', async () => {
  const h = harness({ config: null });
  assert.equal(await h.connect(), null);
  assert.equal(h.calls.createClient.length, 0);
  assert.equal(h.calls.fetch.length, 0);
});
