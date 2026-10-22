// Supabase backend for ハムとイガグリ.
// Exposes the same small document API the page uses (collection/doc, onSnapshot, set/update/delete/add)
// on top of one `docs` table. Access rules live in supabase/schema.sql (row level security).
(() => {
  const cfg = window.HAMU_CONFIG || {};
  const AUTH_INTENT = 'hi-auth-intent';
  const readIntent = () => { try { const v = JSON.parse(sessionStorage.getItem(AUTH_INTENT)); return v && Date.now() - v.at < 15 * 60 * 1000 ? v : null; } catch { return null; } };
  const clearIntent = () => { try { sessionStorage.removeItem(AUTH_INTENT); } catch {} };
  const authErrorText = e => {
    const s = `${e && e.code || ''} ${e && e.message || e || ''}`;
    if (/identity_already_exists|identity_already_linked|already linked|already been linked/i.test(s)) return 'このGoogleアカウントは別のハムと連携済みです。そのハムを使う場合は「登録済みのハムでログイン」を選んでください。今のハムはそのままです。';
    if (/manual.*link.*disabled|manual_linking_disabled/i.test(s)) return 'Googleとの連携は準備中です。メールでの登録・ログインを利用できます。';
    if (/provider.*not.*enabled|unsupported provider|provider_disabled/i.test(s)) return 'Googleログインは現在利用できません。メールでの登録・ログインを利用できます。';
    if (/access_denied|cancel|拒否/i.test(s)) return 'Googleでの操作をキャンセルしました。今のハムでそのまま遊べます。';
    if (/email_exists|email.*already|already.*registered/i.test(s)) return 'このメールアドレスは登録済みです。登録済みのハムでログインするか、別のメールアドレスを使ってください。';
    if (/rate.limit|too many|over_email_send_rate_limit/i.test(s)) return '少し時間をおいてから、もう一度お試しください。';
    if (/network|fetch|timeout|timed out/i.test(s)) return '通信できませんでした。接続を確認して、もう一度お試しください。';
    return 'ログインの操作を完了できませんでした。今のハムを確認してから、もう一度お試しください。';
  };
  window.hamuBackend = async function connect() {
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return null;
    const callbackUrl = new URL(location.href), hash = new URLSearchParams(callbackUrl.hash.slice(1));
    const callbackError = callbackUrl.searchParams.get('error_code') || hash.get('error_code') || callbackUrl.searchParams.get('error') || hash.get('error');
    const hasAuthCallback = callbackUrl.searchParams.has('code') || hash.has('access_token');
    const intent = readIntent();
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

    // getSession waits for the SDK to finish the OAuth/email callback before creating a guest.
    let signInProblem = '';
    let { data: { session } } = await sb.auth.getSession();
    if (callbackError) {
      const clean = new URL(location.href), cleanHash = new URLSearchParams(clean.hash.slice(1));
      for (const key of ['error', 'error_code', 'error_description']) { clean.searchParams.delete(key); cleanHash.delete(key); }
      clean.hash = cleanHash.toString();
      history.replaceState(history.state, '', clean.pathname + clean.search + clean.hash);
    }
    if (!session) {
      const r = await sb.auth.signInAnonymously();
      if (r.error) { console.warn('anonymous sign-in failed', r.error.message); signInProblem = r.error.message; }
      session = r.data && r.data.session;
    }
    const authUser = session && session.user;
    const uid = authUser ? authUser.id : null;
    const hasGoogle = !!(authUser && (authUser.identities || []).some(i => i.provider === 'google'));
    let authNotice = callbackError ? authErrorText({code: callbackError}) : '';
    if (intent && !callbackError) {
      if (intent.kind === 'link' && uid === intent.uid && hasGoogle) authNotice = 'Googleと連携しました。記録や作ったコースは、今までと同じハムで使えます。';
      else if (intent.kind === 'signin' && hasAuthCallback && hasGoogle && authUser && !authUser.is_anonymous) authNotice = 'ログインしました。このハムで遊べます。';
      else authNotice = 'Googleでの操作は完了していません。今のハムでそのまま遊べます。';
    }
    clearIntent();
    let isAdmin = false;
    if (uid) {
      const { data } = await sb.from('admins').select('user_id').eq('user_id', uid).maybeSingle();
      isAdmin = !!data;
    }

    const clone = o => JSON.parse(JSON.stringify(o));
    const merge = (a, b) => { for (const [k, v] of Object.entries(b)) { if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) merge(a[k], v); else a[k] = clone(v); } return a; };
    const err = (e) => ({ code: /quota|too large|size/i.test(e.message || '') ? 'quota_exceeded' : 'invalid_argument', message: e.message || String(e) });
    const split = path => { const i = path.indexOf('/'); return [path.slice(0, i), path.slice(i + 1)]; };
    const snapDoc = (id, row) => ({ id, exists: !!row, data: () => row ? clone(row.data) : undefined, metadata: { fromCache: false, hasPendingWrites: false } });

    // live updates: one realtime channel, listeners re-read their collection on any change to it
    const listeners = new Map(); // col -> Set<fn>
    sb.channel('docs').on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, (p) => {
      const col = (p.new && p.new.col) || (p.old && p.old.col);
      const set = listeners.get(col); if (set) set.forEach(f => f());
    }).subscribe();
    const listen = (col, f) => { if (!listeners.has(col)) listeners.set(col, new Set()); listeners.get(col).add(f); f(); return () => listeners.get(col).delete(f); };
    const bump = col => { const set = listeners.get(col); if (set) set.forEach(f => f()); };

    async function readCol(col) {
      const rows = [];
      for (let offset = 0; ; offset += 1000){
        const { data, error } = await sb.from('docs').select('id,data').eq('col', col).order('id').range(offset, offset + 999);
        if (error) throw err(error);
        rows.push(...data);
        if (data.length < 1000) return rows;
      }
    }
    function query(col, ord, lim) {
      async function run() {
        let rows = await readCol(col);
        if (ord) rows.sort((a, b) => { const x = a.data[ord[0]], y = b.data[ord[0]]; return (x > y ? 1 : x < y ? -1 : 0) * (ord[1] === 'desc' ? -1 : 1); });
        if (lim) rows = rows.slice(0, lim);
        const docs = rows.map(r => snapDoc(r.id, r));
        return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
      }
      return {
        orderBy: (f, d = 'asc') => query(col, [f, d], lim),
        limit: n => query(col, ord, n),
        get: run,
        onSnapshot(next, onErr) { return listen(col, () => run().then(next, e => onErr && onErr(e))); },
      };
    }
    function doc(path) {
      const [col, id] = split(path);
      const getRow = async () => { const { data, error } = await sb.from('docs').select('id,data,updated_at').eq('col', col).eq('id', id).maybeSingle(); if (error) throw err(error); return data; };
      return {
        id, path,
        get: async () => snapDoc(id, await getRow()),
        async set(v) { const { error } = await sb.from('docs').upsert({ col, id, data: v, owner: uid }); if (error) throw err(error); bump(col); },
        async update(v) {
          // Keep simultaneous tabs/devices from replacing each other's counters or profile edits.
          for (let attempt = 0; attempt < 5; attempt++){
            const row = await getRow(); if (!row) throw { code: 'invalid_argument', message: 'missing document' };
            const next = merge(clone(row.data), v);
            for (const [cid, shards] of Object.entries(v.courseRuns || {})) for (const [source, counts] of Object.entries(shards)){
              const old = row.data.courseRuns?.[cid]?.[source];
              next.courseRuns[cid][source] = {attempts: Math.max(old?.attempts || 0, counts.attempts), clears: Math.max(old?.clears || 0, counts.clears)};
            }
            const { data, error } = await sb.from('docs').update({ data: next }).eq('col', col).eq('id', id).eq('updated_at', row.updated_at).select('id');
            if (error) throw err(error);
            if (data.length){ bump(col); return; }
          }
          throw { code: 'conflict', message: 'Concurrent update; please retry' };
        },
        async delete() { const { error } = await sb.from('docs').delete().eq('col', col).eq('id', id); if (error) throw err(error); bump(col); },
        onSnapshot(next, onErr) { return listen(col, () => getRow().then(r => next(snapDoc(id, r)), e => onErr && onErr(e))); },
      };
    }
    const collection = col => Object.assign(query(col), {
      path: col,
      doc: id => doc(col + '/' + (id || crypto.randomUUID().replace(/-/g, '').slice(0, 20))),
      add: async v => { const d = doc(col + '/' + crypto.randomUUID().replace(/-/g, '').slice(0, 20)); await d.set(v); return d; },
    });

    const user = {
      id: async () => uid,
      isOwner: async () => isAdmin,
      canEdit: async () => isAdmin,
      can: async () => !!uid,
      profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: '', avatarUrl: '', color: '#888', email: null, isMe: i === uid, guest: false }])),
    };
    const account = {
      isGuest: !!(authUser && authUser.is_anonymous),
      signInProblem,
      email: authUser && authUser.email || '',
      uid,
      hasGoogle,
      googleStatus: 'loading',
      authNotice,
      returnToAccount: !!(intent || callbackError),
      errorText: authErrorText,
      async attachGoogle() { return googleAuth('link'); },
      async signInGoogle() { return googleAuth('signin'); },
      // keep this hamster and attach an email so it can be used on other devices
      async attachEmail(email) { const r = await sb.auth.updateUser({ email }, { emailRedirectTo: location.origin + location.pathname }); if (r.error) throw r.error; },
      // sign in to an existing hamster from another device
      async signInEmail(email) { const r = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } }); if (r.error) throw r.error; },
      // move this login to another browser (e.g. Safari → the home-screen app, which keeps its own storage).
      // The code is the session's refresh token: using it elsewhere ends the session here.
      // Once the code is shown this browser lets go of the session (no refresh, nothing saved), otherwise its next
      // refresh would reuse the token and the server would revoke the session on the new device too.
      async transferCode() {
        const { data } = await sb.auth.getSession(); if (!data.session) throw new Error('ログインしていません');
        sb.auth.stopAutoRefresh();
        for (const k of Object.keys(localStorage)) if (/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k);
        return data.session.refresh_token;
      },
      async useTransferCode(code) { const r = await sb.auth.refreshSession({ refresh_token: code.trim() }); if (r.error || !r.data.session) throw r.error || new Error('invalid'); location.reload(); },
      async signOut() { await sb.auth.signOut(); location.reload(); },
    };
    // A disabled provider must not appear as a working sign-in option.
    let googleCheck = null;
    account.checkGoogle = () => {
      if (googleCheck) return googleCheck;
      googleCheck = (async () => {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/auth/v1/settings', {headers: {apikey: cfg.supabaseAnonKey}, signal: controller.signal});
          if (!response.ok) throw new Error('settings unavailable');
          const settings = await response.json();
          account.googleStatus = settings.external && settings.external.google === true ? 'enabled' : 'disabled';
        } catch { account.googleStatus = 'unavailable'; }
        finally { clearTimeout(timer); }
        return account.googleStatus === 'enabled';
      })();
      return googleCheck;
    };
    async function googleAuth(kind) {
      if (!await account.checkGoogle()) throw new Error('provider not enabled');
      if (kind === 'link' && !uid) throw new Error('no current user');
      try { sessionStorage.setItem(AUTH_INTENT, JSON.stringify({kind, uid, at: Date.now()})); } catch {}
      const options = {redirectTo: location.origin + location.pathname, queryParams: {prompt: 'select_account'}};
      try {
        const r = kind === 'link' ? await sb.auth.linkIdentity({provider: 'google', options}) : await sb.auth.signInWithOAuth({provider: 'google', options});
        if (r.error) throw r.error;
      } catch (e) { clearIntent(); throw e; }
    }
    // A different tab may complete a login. Reload once to rebuild UID-bound data access.
    const authStamp = u => u ? `${u.id}:${!!u.is_anonymous}:${(u.identities || []).some(i => i.provider === 'google')}` : '';
    const initialStamp = authStamp(authUser);
    let reloadQueued = false;
    sb.auth.onAuthStateChange((_event, nextSession) => {
      if (!reloadQueued && authStamp(nextSession && nextSession.user) !== initialStamp) {
        reloadQueued = true;
        setTimeout(() => location.reload(), 0);
      }
    });
    // live rooms for friend battles: broadcast messages + who is in the room (nothing is stored)
    const realtime = {
      join(name, key) { return sb.channel(name, { config: { broadcast: { self: false }, presence: { key } } }); },
      leave(ch) { return sb.removeChannel(ch); },
    };
    // everyone on the operator team, so their names can carry the 運営 badge
    async function admins() { const { data, error } = await sb.from('admins').select('user_id'); return error ? [] : (data || []).map(r => r.user_id); }
    return { db: { doc, collection }, user, account, realtime, admins };
  };
})();
