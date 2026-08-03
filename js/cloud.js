/* Cosmic Gems - cloud backend (Supabase).
 *
 * Uses Supabase's plain REST APIs (GoTrue auth + PostgREST) via native fetch.
 * No external library is loaded, so there is no version/CDN/init failure
 * surface (the previous "@supabase/supabase-js" UMD build would throw
 * "reading 'storage'"/"reading 'fetch'" in some browsers). Everything is
 * testable from Node by supplying a fetch implementation.
 *
 * Exposed as window.Cloud. Public API consumed by js/game.js:
 *   isEnabled(), signInEmail(email,password,isSignUp), signOut(),
 *   onAuthChange(cb), currentUser(), submitScore(mode,score,level),
 *   getLeaderboard(mode,limit), getMyBest()
 *
 * Tables (see supabase/schema.sql):
 *   profiles(id uuid PK references auth.users, display_name text)
 *   scores(id, user_id references auth.users, mode text, score int, level int)
 *
 * RLS: leaderboard is publicly readable; a user may only insert/update their
 * own scores. The anon key is public by design; the per-user session JWT is
 * sent as the Authorization header so RLS resolves auth.uid().
 */
(function () {
  'use strict';

  const cfg = (window.COSMIC_CONFIG || {});
  const enabled = !!(cfg.url && cfg.anon && !String(cfg.url).startsWith('REPLACE'));
  const ANON = cfg.anon || '';
  const API = (cfg.url || '').replace(/\/+$/, '');
  const AUTH = API + '/auth/v1';
  const REST = API + '/rest/v1';
  const SKEY = 'cosmic-gems-auth';

  const sto = (typeof localStorage !== 'undefined')
    ? localStorage
    : { getItem: () => null, setItem() {}, removeItem() {} };

  const doFetch = (...args) => (typeof fetch !== 'undefined' ? fetch : (() => { throw new Error('fetch unavailable'); }))(...args);

  // In-memory session, restored from localStorage so sign-in persists.
  let session = null; // { access_token, refresh_token, user }
  try {
    const raw = sto.getItem(SKEY);
    if (raw) session = JSON.parse(raw);
  } catch (e) { /* ignore corrupt storage */ }

  const listeners = new Set();
  function notify(s) {
    const wrapped = (s && s.user) ? { user: s.user } : null;
    listeners.forEach((cb) => { try { cb(wrapped); } catch (e) {} });
  }
  function setSession(s) {
    session = s;
    try {
      if (s && s.access_token) sto.setItem(SKEY, JSON.stringify(s));
      else sto.removeItem(SKEY);
    } catch (e) { /* storage may be blocked */ }
    notify(s);
  }

  function headers(extra, withAuth) {
    const h = { apikey: ANON, 'Content-Type': 'application/json' };
    if (withAuth && session && session.access_token) h.Authorization = 'Bearer ' + session.access_token;
    return Object.assign(h, extra || {});
  }

  if (!enabled) {
    console.warn('[Cosmic] Cloud disabled — add Supabase url/anon in js/config.js to enable accounts & leaderboard.');
  } else if (!doFetch) {
    console.error('[Cosmic] Cloud enabled but fetch() is unavailable in this environment.');
  }

  function isEnabled() { return enabled && (typeof fetch !== 'undefined'); }

  async function signUp(email, password) {
    const r = await doFetch(AUTH + '/signup', {
      method: 'POST', headers: headers(), body: JSON.stringify({ email, password }),
    });
    const j = await r.json().catch(() => ({}));
    const d = j.data || j;
    if (!r.ok || j.error) {
      return { ok: false, error: (j.error && j.error.message) || j.error_description || 'Sign-up failed.' };
    }
    // With "Confirm email" on, the response has a user but no session.
    if (!d.session) {
      return { ok: false, needsConfirmation: true, error: 'Signed up! Check your email, then sign in.' };
    }
    return { ok: true, user: d.user, session: d.session };
  }

  async function signIn(email, password) {
    const r = await doFetch(AUTH + '/token?grant_type=password', {
      method: 'POST', headers: headers(), body: JSON.stringify({ email, password }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) {
      return { ok: false, error: (j.error && (j.error.message || j.error_description)) || j.message || 'Sign-in failed.' };
    }
    const s = { access_token: j.access_token, refresh_token: j.refresh_token, user: j.user };
    return { ok: true, user: j.user, session: s };
  }

  async function signInEmail(email, password, isSignUp) {
    if (!isEnabled()) return { ok: false, offline: true };
    try {
      const r = isSignUp ? await signUp(email, password) : await signIn(email, password);
      if (!r.ok) return r;
      setSession(r.session);
      return { ok: true, user: r.user, session: r.session };
    } catch (e) {
      // Never let an exception leave the caller hanging on "Working…".
      return { ok: false, error: (e && e.message) ? e.message : 'Sign-in failed. Check your connection.' };
    }
  }

  async function signOut() {
    if (!isEnabled()) return { ok: true };
    if (session && session.access_token) {
      try {
        await doFetch(AUTH + '/logout', { method: 'POST', headers: headers({}, true) });
      } catch (e) { /* best-effort */ }
    }
    setSession(null);
    return { ok: true };
  }

  function onAuthChange(cb) {
    listeners.add(cb);
    cb(session && session.user ? session : null);
    return () => listeners.delete(cb);
  }

  async function currentUser() {
    if (!isEnabled() || !session) return null;
    try {
      const r = await doFetch(AUTH + '/user', { headers: headers({}, true) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) { setSession(null); return null; }
      return j.user || (session.user) || null;
    } catch (e) {
      return (session && session.user) || null;
    }
  }

  async function submitScore(mode, score, level) {
    if (!isEnabled() || !session) return { ok: false, cloud: false };
    try {
      const r = await doFetch(REST + '/scores', {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates, return=minimal' }, true),
        body: JSON.stringify([{ user_id: session.user.id, mode, score, level, created_at: new Date().toISOString() }]),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return { ok: false, cloud: false, error: (e.error && e.error.message) || 'Save failed.' };
      }
      return { ok: true, cloud: true };
    } catch (e) {
      return { ok: false, cloud: false, error: 'Network error.' };
    }
  }

  async function getLeaderboard(mode, limit) {
    limit = limit || 25;
    if (!isEnabled()) return { ok: false, offline: true, rows: [] };
    const orderCol = mode === 'leveled' ? 'level' : 'score';
    const url = REST + '/scores?select=score,level,user_id'
      + '&mode=eq.' + encodeURIComponent(mode)
      + '&order=' + orderCol + '.desc'
      + '&limit=' + limit;
    try {
      const r = await doFetch(url, { headers: headers({ Accept: 'application/json' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) {
        return { ok: false, error: (j.error && j.error.message) || 'Failed to load.', rows: [] };
      }
      const rows = Array.isArray(j) ? j : [];
      // Guarantee one entry per user: rows are ordered by the ranking column
      // descending, so the first occurrence of each user_id is their best.
      // Keep only that one (defensive against any duplicate rows from the DB).
      const seen = new Set();
      const dedupedRows = [];
      rows.forEach((x) => {
        if (!x.user_id || seen.has(x.user_id)) return;
        seen.add(x.user_id);
        dedupedRows.push(x);
      });
      // Join display names. scores.user_id references auth.users, not profiles,
      // so we fetch profiles separately and merge (no FK relationship exists).
      let nameById = {};
      const ids = dedupedRows.map((x) => x.user_id).filter(Boolean);
      if (ids.length) {
        const pUrl = REST + '/profiles?select=id,display_name&id=in.(' + ids.map(encodeURIComponent).join(',') + ')';
        try {
          const pr = await doFetch(pUrl, { headers: headers({ Accept: 'application/json' }) });
          const pj = await pr.json().catch(() => ({}));
          if (Array.isArray(pj)) pj.forEach((p) => { nameById[p.id] = p.display_name; });
        } catch (e) { /* names fall back to 'Player' */ }
      }
      return {
        ok: true,
        rows: dedupedRows.map((x) => ({
          score: x.score,
          level: x.level,
          name: nameById[x.user_id] || 'Player',
        })),
      };
    } catch (e) {
      return { ok: false, error: 'Network error.', rows: [] };
    }
  }

  async function getMyBest() {
    if (!isEnabled() || !session) return null;
    try {
      const uid = session.user.id;
      const url = REST + '/scores?select=mode,score,level&user_id=eq.' + encodeURIComponent(uid);
      const r = await doFetch(url, { headers: headers({}, true) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) return null;
      const rows = Array.isArray(j) ? j : [];
      const out = {};
      rows.forEach((x) => { out[x.mode] = { score: x.score, level: x.level }; });
      return out;
    } catch (e) {
      return null;
    }
  }

  if (typeof window !== 'undefined') {
    window.Cloud = {
      isEnabled,
      signInEmail,
      signOut,
      onAuthChange,
      currentUser,
      submitScore,
      getLeaderboard,
      getMyBest,
    };
  }
})();
