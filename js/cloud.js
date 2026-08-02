/* Cosmic Gems - cloud backend (Supabase).
 * Handles sign-in (email + Google) and the global leaderboard. Degrades
 * gracefully to "offline" when COSMIC_CONFIG is not filled in, so the game
 * still runs without a backend. Exposed as window.Cloud.
 *
 * Tables (see supabase/schema.sql):
 *   profiles(id uuid PK references auth.users, display_name text, created_at)
 *   scores(id, user_id references auth.users, mode text, score int, level int, created_at)
 *
 * Security: row-level security lets anyone read the leaderboard, and lets a
 * user insert/update only their own scores. The anon key is public by design.
 */
(function () {
  'use strict';

  const cfg = (window.COSMIC_CONFIG || {});
  const enabled = !!(cfg.url && cfg.anon && !String(cfg.url).startsWith('REPLACE'));

  let client = null;
  if (enabled) {
    let supa;
    if (typeof window.supabase === 'undefined') {
      console.warn('[Cosmic] config present but @supabase/supabase-js not loaded. Add the CDN script in index.html.');
    } else {
      supa = window.supabase.createClient(cfg.url, cfg.anon);
    }
    client = supa || null;
  }

  function isEnabled() { return enabled && !!client; }

  async function signInEmail(email, password, isSignUp) {
    if (!isEnabled()) return { ok: false, offline: true };
    try {
      const fn = isSignUp ? client.auth.signUp : client.auth.signInWithPassword;
      const { data, error } = await fn({ email, password });
      if (error) {
        // Surface the real reason to the UI instead of failing silently.
        const msg = error.message || 'Sign-in failed.';
        return { ok: false, error: msg };
      }
      // signUp returns a user but, with email confirmation on, no active session.
      // Tell the user to check their inbox rather than leaving them stuck.
      if (isSignUp && (!data.session || (data.user && data.user.identities && data.user.identities.length === 0))) {
        return { ok: false, needsConfirmation: true, error: 'Signed up! Check your email, then sign in.' };
      }
      return { ok: true, user: data.user, session: data.session };
    } catch (e) {
      // Never let an exception leave the caller hanging.
      return { ok: false, error: (e && e.message) ? e.message : 'Sign-in failed. Check your connection.' };
    }
  }

  async function signOut() {
    if (!isEnabled()) return { ok: true };
    await client.auth.signOut();
    return { ok: true };
  }

  function onAuthChange(cb) {
    if (!isEnabled()) return () => {};
    const { data } = client.auth.onAuthStateChange((_event, session) => cb(session));
    return () => data.subscription.unsubscribe();
  }

  async function currentUser() {
    if (!isEnabled()) return null;
    const { data } = await client.auth.getUser();
    return data.user || null;
  }

  // Submit a score. If the user is signed in, writes to the cloud. On success
  // returns {ok, cloud:true}; offline or unsigned returns {ok, cloud:false}.
  async function submitScore(mode, score, level) {
    if (!isEnabled()) return { ok: false, cloud: false };
    const { data: userData } = await client.auth.getUser();
    const user = userData.user;
    if (!user) return { ok: false, cloud: false, reason: 'not signed in' };
    const { error } = await client
      .from('scores')
      .upsert(
        { user_id: user.id, mode, score, level, created_at: new Date().toISOString() },
        { onConflict: 'user_id,mode' }
      );
    if (error) return { ok: false, cloud: false, error: error.message };
    return { ok: true, cloud: true };
  }

  // Fetch the top N scores for a mode, joined to display names.
  // Leveled ranks by level reached; infinite ranks by score.
  async function getLeaderboard(mode, limit = 25) {
    if (!isEnabled()) return { ok: false, offline: true, rows: [] };
    const orderCol = mode === 'leveled' ? 'level' : 'score';
    const { data, error } = await client
      .from('scores')
      .select('score, level, profiles(display_name)')
      .eq('mode', mode)
      .order(orderCol, { ascending: false })
      .limit(limit);
    if (error) return { ok: false, error: error.message, rows: [] };
    return {
      ok: true,
      rows: (data || []).map((r) => ({
        score: r.score,
        level: r.level,
        name: (r.profiles && r.profiles.display_name) || 'Player',
      })),
    };
  }

  // Fetch the signed-in user's own best per mode (for cross-device sync).
  async function getMyBest() {
    if (!isEnabled()) return null;
    const { data: userData } = await client.auth.getUser();
    const user = userData.user;
    if (!user) return null;
    const { data, error } = await client
      .from('scores')
      .select('mode, score, level')
      .eq('user_id', user.id);
    if (error) return null;
    const out = {};
    (data || []).forEach((r) => { out[r.mode] = { score: r.score, level: r.level }; });
    return out;
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
