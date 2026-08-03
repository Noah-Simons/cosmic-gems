/* Tests for js/cloud.js using a mocked global fetch (the new direct-REST model).
 * Confirms: offline fallback (no config), email sign-up/in with the right REST
 * endpoints, score submission (scores POST with Prefer merge + user_id),
 * leaderboard read/ordering (leveled by level, infinite by score), and the
 * two-call profiles/scores join for display names. Run: node test/cloud.test.js
 */
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.error('  FAIL:', m)));

global.window = global;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k){ delete this._d[k]; } };

// ---- mock fetch that records the last request + returns scripted responses ----
let lastReq = null;
let lastScoresReq = null;
let mode = 'ok'; // 'ok' | 'badLogin' | 'fetchFail'
function makeFetch(apiBase, store) {
  return async (url, opts) => {
    url = String(url); opts = opts || {};
    lastReq = { url, method: (opts.method || 'GET').toUpperCase(), headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null };
    const isScores = url.includes('/rest/v1/scores');
    const isProfiles = url.includes('/rest/v1/profiles');
    const isSignup = url.endsWith('/auth/v1/signup');
    const isToken = url.includes('/auth/v1/token');
    const isUser = url.endsWith('/auth/v1/user');
    const isLogout = url.endsWith('/auth/v1/logout');
    if (mode === 'fetchFail') return Promise.reject(new Error('network down'));

    if (isSignup) {
      const uid = 'u1';
      store.profiles.push({ id: uid, display_name: 'Commander' });
      return { ok: true, status: 200, json: async () => ({ data: { user: { id: uid, email: lastReq.body.email }, session: { access_token: 'tok_' + uid, refresh_token: 'r', user: { id: uid } } } }) };
    }
    if (isToken) {
      if (mode === 'badLogin') return { ok: false, status: 400, json: async () => ({ error: { message: 'Invalid login credentials' } }) };
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok_u1', refresh_token: 'r', user: { id: 'u1', email: lastReq.body.email } }) };
    }
    if (isUser) return { ok: true, status: 200, json: async () => ({ user: { id: 'u1', email: 'me@x.com' } }) };
    if (isLogout) return { ok: true, status: 204, json: async () => ({}) };
    if (isScores && lastReq.method === 'POST') {
      const row = lastReq.body[0];
      const ex = store.scores.find(s => s.user_id === row.user_id && s.mode === row.mode);
      if (ex) Object.assign(ex, row); else store.scores.push(row);
      ok(row.user_id === 'u1', 'submitScore POST includes user_id');
      ok(/resolution=merge-duplicates/.test(lastReq.headers.Prefer || ''), 'submitScore sends Prefer merge-duplicates');
      ok(lastReq.headers.Authorization === 'Bearer tok_u1', 'submitScore sends auth token');
      return { ok: true, status: 201, json: async () => ({}) };
    }
    if (isProfiles) return { ok: true, status: 200, json: async () => store.profiles };
    if (isScores && lastReq.method === 'GET') {
      const q = new URL(url).searchParams;
      let rows = store.scores.slice();
      if (q.get('mode')) rows = rows.filter(s => s.mode === q.get('mode').replace('eq.', ''));
      if (q.get('user_id')) rows = rows.filter(s => s.user_id === q.get('user_id').replace('eq.', ''));
      const order = q.get('order') || 'score.desc';
      const [col, dir] = order.split('.');
      rows.sort((a, b) => dir === 'desc' ? b[col] - a[col] : a[col] - b[col]);
      lastScoresReq = lastReq.url;
      return { ok: true, status: 200, json: async () => rows };
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
  };
}

function loadCloud({ enabled, fetchImpl, apiBase }) {
  global.COSMIC_CONFIG = enabled
    ? { url: apiBase || 'https://demo.supabase.co', anon: 'public-anon-key' }
    : { url: 'REPLACE_WITH_YOUR_SUPABASE_URL', anon: '' };
  global.fetch = fetchImpl;
  const fs = require('fs'), path = require('path');
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');
  delete global.Cloud;
  // cloud.js reads window.COSMIC_CONFIG + fetch from globals; run in this scope
  (function () { const window = global; eval(code); })();
  return global.Cloud;
}

(async () => {
  // 1. offline fallback when config not set
  let C = loadCloud({ enabled: false, fetchImpl: makeFetch('https://demo.supabase.co', { scores: [], profiles: [] }) });
  ok(C.isEnabled() === false, 'disabled when config not set');
  ok((await C.signInEmail('a@b.com', 'pw', false)).offline === true, 'sign-in offline=true when disabled');
  ok((await C.getLeaderboard('leveled')).offline === true, 'leaderboard offline when disabled');

  // 2. enabled: sign-up + submit + leaderboard
  const store = { scores: [], profiles: [] };
  mode = 'ok';
  C = loadCloud({ enabled: true, fetchImpl: makeFetch('https://demo.supabase.co', store), apiBase: 'https://demo.supabase.co' });
  ok(C.isEnabled() === true, 'enabled when config + fetch present');

  const su = await C.signInEmail('me@x.com', 'pw123', true);
  ok(su.ok === true && su.user, 'email sign-up succeeds (REST)');
  ok(lastReq.url.endsWith('/auth/v1/signup'), 'sign-up hits /auth/v1/signup');

  const si = await C.signInEmail('me@x.com', 'pw123', false);
  ok(si.ok === true && si.session && typeof si.session.access_token === 'string', 'email sign-in returns session token (REST)');
  ok(lastReq.url.includes('/auth/v1/token?grant_type=password'), 'sign-in hits token grant');

  await C.submitScore('leveled', 9, 9);
  ok(store.scores.some(s => s.mode === 'leveled' && s.score === 9 && s.user_id === 'u1'), 'submitScore stored a leveled row for the signed-in user');

  // leaderboard: submit infinite scores (production enforces one row per mode
  // via upsert, so we use submitScore, not hand-push duplicates)
  await C.submitScore('infinite', 800, 1);
  await C.submitScore('infinite', 1200, 1); // higher best replaces
  const lbI = await C.getLeaderboard('infinite');
  ok(lbI.ok && lbI.rows.length === 1 && lbI.rows[0].score === 1200, 'infinite leaderboard shows single best (1200) sorted by score desc');
  ok(lbI.rows[0].name === 'Commander', 'leaderboard joins display name from profiles');
  ok(lastScoresReq.includes('order=score.desc'), 'infinite request orders by score desc');

  // 3. leveled ordering (replacing best via upsert)
  await C.submitScore('leveled', 3, 4);
  await C.submitScore('leveled', 5, 9); // higher level replaces
  const lbL = await C.getLeaderboard('leveled');
  ok(lbL.ok && lbL.rows.length === 1 && lbL.rows[0].level === 9, 'leveled leaderboard shows single best (L9) sorted by level desc');
  ok(lastScoresReq.includes('order=level.desc'), 'leveled request orders by level desc');

  // 4. getMyBest (one row per mode in store => correct per-mode map)
  const mine = await C.getMyBest();
  ok(mine && mine.leveled && mine.leveled.level === 9 && mine.infinite.score === 1200, 'getMyBest returns per-mode bests');

  // 4.5 one entry per user: seed two rows for the same user in one mode and
  // confirm the leaderboard collapses them to a single entry (their best).
  const dupStore = {
    scores: [
      { id: 'a', user_id: 'uX', mode: 'infinite', score: 500, level: 1 },
      { id: 'b', user_id: 'uX', mode: 'infinite', score: 900, level: 1 }, // same user, higher
      { id: 'c', user_id: 'uY', mode: 'infinite', score: 700, level: 1 },
    ],
    profiles: [{ id: 'uX', display_name: 'X' }, { id: 'uY', display_name: 'Y' }],
  };
  const C2 = loadCloud({ enabled: true, fetchImpl: makeFetch('https://demo.supabase.co', dupStore), apiBase: 'https://demo.supabase.co' });
  const dupLb = await C2.getLeaderboard('infinite');
  ok(dupLb.ok && dupLb.rows.length === 2, 'duplicate (same user) rows collapse to one entry per user');
  const xRow = dupLb.rows.find(r => r.name === 'X');
  ok(xRow && xRow.score === 900, 'collapsed entry keeps the user best (900), not a duplicate');

  // 5. error path: bad login surfaced, no throw
  mode = 'badLogin';
  const bad = await C.signInEmail('me@x.com', 'wrong', false);
  ok(bad.ok === false && /Invalid login/.test(bad.error || ''), 'sign-in error surfaced (no hang)');

  // 6. network failure path
  mode = 'fetchFail';
  const nf = await C.signInEmail('me@x.com', 'pw123', false);
  ok(nf.ok === false, 'network failure does not throw');

  console.log(`\nCloud tests: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
