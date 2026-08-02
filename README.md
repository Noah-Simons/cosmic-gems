# Cosmic Gems

A space-themed **match-3** puzzle game — swap adjacent crystals to line up runs of
3+ and rack up points. Built in plain HTML/CSS/JS, no build step, no dependencies.
Runs anywhere a static site runs (GitHub Pages out of the box).

## How to play
- **Home screen**: pick a mode, then play.
  - **Leveled** — climb endless levels. Each level has a rising score **goal** and a
    20-move budget. Hit the goal and you advance; score carries, moves reset.
    Per-level best (highest level reached) is saved.
  - **Infinite** — pure score-attack. 20 moves, no goal. Chase your personal best
    (saved to `localStorage`).
- **Swap** two adjacent gems by clicking one then a neighbor, or dragging.
- Match **3+ in a row or column** to clear them.
- Cleared gems make the ones above **fall**, and new ones drop in from the top —
  chains create **combos** with a score multiplier.
- **Power-ups**: match **4** gems in a line → a **Line Blaster** (clears its whole
  row + column when triggered). Match **5+** in a line → a **Bomb** (clears every
  gem of its color). They sit on the board as glowing gems and fire when swapped
  into a match or matched directly.
## Accounts & leaderboard (Supabase)
The game has **Sign In** (email or Google) and a global **leaderboard**. Progress
(best score / highest level) syncs across devices through the cloud. This needs a
free [Supabase](https://supabase.com) project — GitHub Pages is static and can't
store user data itself.

1. Create a project at https://supabase.com.
2. Run `supabase/schema.sql` in the project's **SQL Editor** (creates `profiles`
   + `scores` tables, row-level security, and the new-user trigger).
3. **Authentication → Providers**: enable **Email** (and **Google** if you want
   one-click sign-in; add your site URL as a redirect URL).
4. **Project Settings → API**: copy the **Project URL** and **anon/public key**
   into `js/config.js` (replace the `REPLACE_WITH_...` placeholders).
5. That's it — the anon key is meant to be public and is safe in client code.

Without config, the game still runs fully (local bests only; the leaderboard
shows a "not configured" note). Nothing breaks.

## Run it locally
No install needed — just serve the folder:

```bash
cd cosmic-gems
python3 -m http.server 8123
# open http://localhost:8123
```

(Opening `index.html` directly with `file://` also works in most browsers, but a
local server is the reliable path.)

## Project layout
```
cosmic-gems/
  index.html        # structure + HUD + overlay + ad slot + auth/leaderboard UI
  css/style.css     # cosmic theme, animations, responsive sizing
  js/config.js      # Supabase credentials (you fill this in)
  js/cloud.js       # auth + leaderboard wrapper (Supabase), degrades if unconfigured
  js/engine.js      # PURE match-3 math (board gen, match detect, gravity, shuffle)
  js/game.js        # rendering, input, cascades, scoring, win/lose, auto-shuffle
  supabase/
    schema.sql      # tables + row-level security for accounts & leaderboard
  test/
    engine.test.js     # unit tests for the pure engine (Node)
    game.logic.test.js # headless integration test of game.js via a fake DOM
    cloud.test.js      # auth + leaderboard logic via a mocked Supabase client
```

## Tests
The game logic is verified headlessly with Node (no browser required):

```bash
node test/engine.test.js      # ~107 checks on the pure engine
node test/game.logic.test.js  # integration of the real game.js controller
node test/cloud.test.js       # auth + leaderboard logic (mocked Supabase)
```

`engine.js` is written so the same file runs in the browser (`window.CosmicEngine`)
and in Node (`require`), which is what makes the math testable.

## Tunable knobs (top of `js/game.js`)
- `SIZE` – board dimension (default 8×8)
- `START_MOVES` – moves per level / per infinite run (default 20)
- `BASE_GOAL` – level 1 score goal (default 800); `goalForLevel(lv)` scales it up
- `GEM_TYPES` – number of gem colors in `js/engine.js` (default 6)
- Scoring: `matches * 15 * (comboLevel + 1)` per cascade; power activations add `cleared * 20`

## Monetization notes
- An **ad slot** is already wired in `index.html` (`#ad-slot`) — drop an AdSense /
  banner unit there. Match-3 is ad-friendly: show an interstitial on "Play Again",
  or a rewarded ad for a "shuffle hint" power-up.
- Like Stardust Tycoon, this is **MIT** and free to host on GitHub Pages.
- Easy add-ons when you want them: a "hint" button (use `CosmicEngine.hasMoves` +
  a swap finder), a "shuffle" power-up spending points, or special gems.

## Deploy to GitHub Pages
1. Put the `cosmic-gems/` folder in its own repo (or a `/cosmic-gems` path).
2. Repo **Settings → Pages** → source: `main` branch, `/ (root)`.
3. Push and wait ~1 min; your game is live at `https://<user>.github.io/<repo>/`.
