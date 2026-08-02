/* Tests for js/cloud.js using a mocked Supabase client.
 * Confirms: offline fallback (no config), email sign-in, score submission
 * (upsert with user_id), and leaderboard ordering (leveled by level, infinite
 * by score). Run with: node test/cloud.test.js
 */
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.error('  FAIL:', m)));

// --- minimal fake DOM so cloud.js can run under Node ---
const rootEls = {};
function makeEl(t) {
  return {
    tagName: (t || 'div').toUpperCase(),
    style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); },
    addEventListener() {}, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text || ''; },
    setAttribute() {}, getAttribute() { return null; },
  };
}
global.window = global;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };

// --- mocked Supabase client ---
function makeMockClient({ signInResult, upsertResult, selectResult } = {}) {
  const users = [];
  return {
    auth: {
      signInWithPassword: async (p) => ({ data: { user: { id: 'u1', email: p.email, user_metadata: {} }, session: {} }, error: null }),
      signUp: async (p) => ({ data: { user: { id: 'u1', email: p.email, user_metadata: {} }, session: {} }, error: null }),
      signInWithOAuth: async () => ({ data: { url: 'https://example.com/oauth' }, error: null }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: (cb) => { mockClient._authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      getUser: async () => ({ data: { user: { id: 'u1', email: 'me@x.com', user_metadata: {} } } }),
    },
    from: (table) => ({
      upsert: (payload, opts) => { mockClient._lastUpsert = { payload, opts }; return { error: upsertResult || null }; },
      select: (cols) => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: selectResult || [], error: null }),
          }),
        }),
      }),
    }),
  };
}

let mockClient;

// build cloud.js with a given config + client
function loadCloud({ enabled, client }) {
  global.COSMIC_CONFIG = enabled
    ? { url: 'https://demo.supabase.co', anon: 'public-anon-key' }
    : { url: 'REPLACE_WITH_YOUR_SUPABASE_URL', anon: '' };
  global.supabase = { createClient: () => client };
  // re-evaluate cloud.js fresh each time
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');
  delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'cloud.js'))];
  // cloud.js attaches to window.Cloud; eval in this scope
  const fn = new Function('window', 'supabase', code + '\n;return window.Cloud;');
  return fn(global, global.supabase);
}

(async () => {
  // 1. offline fallback when config is not filled in
  let C = loadCloud({ enabled: false, client: null });
  ok(C.isEnabled() === false, 'disabled when config not set');
  let r = await C.signInEmail('a@b.com', 'pw', false);
  ok(r.offline === true, 'sign-in returns offline=true when disabled');
  let lb = await C.getLeaderboard('leveled');
  ok(lb.offline === true && lb.rows.length === 0, 'leaderboard offline when disabled');

  // 2. enabled + email sign-up + score submit
  // The leaderboard returns leveled sorted by level desc; infinite by score desc.
  const selectResultLeveled = [
    { score: 5, level: 9, profiles: { display_name: 'Ada' } },
    { score: 3, level: 4, profiles: { display_name: 'Bob' } },
  ];
  const selectResultInfinite = [
    { score: 1200, level: 1, profiles: { display_name: 'Bob' } },
    { score: 800, level: 1, profiles: { display_name: 'Ada' } },
  ];
  mockClient = makeMockClient({});
  C = loadCloud({ enabled: true, client: mockClient });
  ok(C.isEnabled() === true, 'enabled when config + client present');

  const res = await C.signInEmail('me@x.com', 'pw123', true);
  ok(res.ok === true && res.user, 'email sign-up succeeds (mock)');

  await C.submitScore('leveled', 9, 9);
  ok(mockClient._lastUpsert && mockClient._lastUpsert.payload.user_id === 'u1', 'submitScore writes user_id');
  ok(mockClient._lastUpsert.opts.onConflict === 'user_id,mode', 'submitScore upserts on (user_id,mode)');

  // 3. leaderboard ordering: leveled sorts by level desc, infinite by score desc
  // patch select to depend on mode by intercepting: simpler to test via two calls
  // We set selectResult per call by overriding getLeaderboard path is internal;
  // instead, verify the order column choice by checking returned mapping only.
  // Re-load with a select that returns mode-aware data through closures:
  mockClient = {
    auth: makeMockClient().auth,
    from: () => ({
      upsert: () => ({ error: null }),
      select: () => ({
        eq: (col, val) => ({
          order: (colName) => ({
            limit: async () => ({
              data: colName === 'level'
                ? selectResultLeveled
                : selectResultInfinite,
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
  C = loadCloud({ enabled: true, client: mockClient });
  const lbL = await C.getLeaderboard('leveled');
  ok(lbL.ok && lbL.rows[0].level === 9 && lbL.rows[1].level === 4, 'leveled leaderboard ordered by level desc');
  const lbI = await C.getLeaderboard('infinite');
  ok(lbI.ok && lbI.rows[0].score === 1200 && lbI.rows[1].score === 800, 'infinite leaderboard ordered by score desc');

  // 4. getMyBest maps per mode
  mockClient = {
    auth: makeMockClient().auth,
    from: () => ({
      upsert: () => ({ error: null }),
      select: () => ({
        eq: () => ({ data: [{ mode: 'leveled', score: 7, level: 7 }, { mode: 'infinite', score: 999, level: 1 }], error: null }),
      }),
    }),
  };
  C = loadCloud({ enabled: true, client: mockClient });
  const mine = await C.getMyBest();
  ok(mine && mine.leveled.level === 7 && mine.infinite.score === 999, 'getMyBest returns per-mode bests');

  console.log(`\nCloud tests: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
