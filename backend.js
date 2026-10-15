// Supabase backend for ハムとイガグリ.
// Exposes the same small document API the page uses (collection/doc, onSnapshot, set/update/delete/add)
// on top of one `docs` table. Access rules live in supabase/schema.sql (row level security).
(() => {
  const cfg = window.HAMU_CONFIG || {};
  window.hamuBackend = async function connect() {
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return null;
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

    // every visitor gets an account: a guest (anonymous) one unless they signed in by email
    let signInProblem = '';
    let { data: { session } } = await sb.auth.getSession();
    if (!session) {
      const r = await sb.auth.signInAnonymously();
      if (r.error) { console.warn('anonymous sign-in failed', r.error.message); signInProblem = r.error.message; }
      session = r.data && r.data.session;
    }
    const authUser = session && session.user;
    const uid = authUser ? authUser.id : null;
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
      const { data, error } = await sb.from('docs').select('id,data').eq('col', col).limit(2000);
      if (error) throw err(error);
      return data;
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
      const getRow = async () => { const { data, error } = await sb.from('docs').select('id,data').eq('col', col).eq('id', id).maybeSingle(); if (error) throw err(error); return data; };
      return {
        id, path,
        get: async () => snapDoc(id, await getRow()),
        async set(v) { const { error } = await sb.from('docs').upsert({ col, id, data: v, owner: uid }); if (error) throw err(error); bump(col); },
        async update(v) {
          const row = await getRow(); if (!row) throw { code: 'invalid_argument', message: 'missing document' };
          const { error } = await sb.from('docs').update({ data: merge(clone(row.data), v) }).eq('col', col).eq('id', id); if (error) throw err(error); bump(col);
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
      // keep this hamster and attach an email so it can be used on other devices
      async attachEmail(email) { const r = await sb.auth.updateUser({ email }, { emailRedirectTo: location.origin + location.pathname }); if (r.error) throw r.error; },
      // sign in to an existing hamster from another device
      async signInEmail(email) { const r = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } }); if (r.error) throw r.error; },
      // finish either of the above with the code from the email, without leaving this app
      // (a home-screen app on iPhone keeps its own login, so opening the email link in Safari doesn't sign it in)
      async verifyCode(email, token, attaching) { const r = await sb.auth.verifyOtp({ email, token, type: attaching ? 'email_change' : 'email' }); if (r.error) throw r.error; location.reload(); },
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
    return { db: { doc, collection }, user, account };
  };
})();
