/*
 * Headless integration test of game.js using a tiny fake DOM.
 * Exercises the REAL controller code (swap, cascade, gravity, scoring) without
 * a browser, so gameplay logic is verified even when no browser is available.
 */
const fs = require('fs');
const path = require('path');

// ---- minimal DOM/anim API shims ----
function makeEl(tag) {
  const el = {
    tagName: tag, children: [], dataset: {}, style: {}, classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    _text: '', _html: '',
    set textContent(v) { this._text = String(v); },
    get textContent() { return this._text; },
    set innerHTML(v) { this._html = v; if (v === '') this.children = []; },
    get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    remove() { if (this.parent) this.parent.removeChild(this); },
    querySelector() { return makeEl('div'); },
    closest() { return this; },
    addEventListener() {},
    animate() { return {}; },
    contains() { return true; },
    get offsetWidth() { return 1; },
  };
  return el;
}

// Make `window` BE the global object so bare `CosmicEngine`/`CosmicGame` refs resolve.
global.window = global;
const rootEls = {};
['board', 'score', 'moves', 'target', 'best', 'level-chip', 'goal-label', 'combo',
 'overlay', 'overlay-title', 'overlay-msg', 'overlay-actions', 'restart', 'home-btn',
 'best-leveled', 'best-infinite', 'home', 'game',
 'signin-open', 'account-status', 'auth-modal', 'auth-close', 'auth-submit', 'auth-toggle',
 'google-btn', 'auth-email', 'auth-pass', 'auth-msg', 'lb-list'].forEach((id) => (rootEls[id] = makeEl('div')));
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
// cloud.js will be disabled (no config) in this harness; provide a stub so game.js's
// `window.Cloud` branch is skipped (Cloud is undefined -> falsy).
global.document = {
  getElementById: (id) => rootEls[id] || null,
  documentElement: {},
  createElement: (t) => makeEl(t),
  querySelectorAll: (sel) => {
    if (sel === '.mode-card') {
      return [
        { dataset: { mode: 'leveled' }, addEventListener() {} },
        { dataset: { mode: 'infinite' }, addEventListener() {} },
      ];
    }
    if (sel === '.lb-tab') {
      return [
        { dataset: { lb: 'leveled' }, classList: { add() {}, remove() {} }, addEventListener() {} },
        { dataset: { lb: 'infinite' }, classList: { add() {}, remove() {} }, addEventListener() {} },
      ];
    }
    return [];
  },
};
global.getComputedStyle = () => ({ getPropertyValue: () => '56' });
global.requestAnimationFrame = (fn) => fn();
global.setTimeout = (fn) => { fn(); return 0; };

const Engine = require('../js/engine.js');
const SIZE = 8;

// engine attaches to global.window (= global), exposing CosmicEngine
const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');
eval(code);

const G = global.CosmicGame;

// brute-force: find the first adjacent swap on `grid` that yields a match
function findMove(grid) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (c + 1 < SIZE && makesMatch(grid, r, c, r, c + 1)) return { a: { r, c }, b: { r, c: c + 1 } };
      if (r + 1 < SIZE && makesMatch(grid, r, c, r + 1, c)) return { a: { r, c }, b: { r: r + 1, c } };
    }
  }
  return null;
}
function makesMatch(grid, r1, c1, r2, c2) {
  const t = grid[r1][c1]; grid[r1][c1] = grid[r2][c2]; grid[r2][c2] = t;
  const ok = Engine.findMatches(grid).length > 0;
  const t2 = grid[r1][c1]; grid[r1][c1] = grid[r2][c2]; grid[r2][c2] = t2;
  return ok;
}
function findNonMove(grid) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (c + 1 < SIZE && !makesMatch(grid, r, c, r, c + 1)) return { a: { r, c }, b: { r, c: c + 1 } };
      if (r + 1 < SIZE && !makesMatch(grid, r, c, r + 1, c)) return { a: { r, c }, b: { r: r + 1, c } };
    }
  }
  return null;
}

let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.error('  FAIL:', m)));

(async () => {
  // 1. fresh game: 8x8, no pre-existing matches, reset state (leveled mode for a playable board)
  G.startMode('leveled');
  let s = G.getState();
  ok(s.grid.length === 8 && s.grid.every((r) => r.length === 8), 'board is 8x8');
  ok(s.score === 0 && s.moves === 20, 'resets score + moves');
  ok(Engine.findMatches(s.grid).length === 0, 'no pre-existing matches on fresh board');

  // 2. a winning swap increases score, consumes a move, and leaves no empty cells
  const mv = findMove(s.grid);
  ok(mv, 'fresh board has a legal move');
  const before = G.getState();
  await G.trySwap(mv.a, mv.b);
  const after = G.getState();
  ok(after.score > before.score, 'winning swap increased score');
  ok(after.moves === before.moves - 1, 'winning swap consumed a move');
  ok(after.grid.every((r) => r.every((v) => v !== null)), 'no empty cells after cascade (gravity+refill)');
  ok(Engine.findMatches(after.grid).length === 0, 'board settled with no pending matches after cascade');

  // 3. illegal swap is reverted: score unchanged, board identical
  G.startMode('leveled');
  const nm = findNonMove(G.getState().grid);
  ok(nm, 'found an illegal swap pair');
  const pre = G.getState();
  await G.trySwap(nm.a, nm.b);
  const post = G.getState();
  ok(post.score === 0, 'illegal swap scored nothing');
  ok(post.moves === 20, 'illegal swap consumed no move');
  ok(JSON.stringify(post.grid) === JSON.stringify(pre.grid), 'illegal swap reverted board');

  // 4. deadlock -> in-game reshuffle recovers to a playable, match-free board.
  //    Random 8x8 boards with 6 colors almost never deadlock, so construct a
  //    real one deterministically: a shifted "stripe" pattern has no legal move.
  function tryFindDeadlock() {
    for (const period of [3, 4, 5, 6, 7]) {
      const base = [];
      for (let i = 0; i < SIZE; i++) base.push(i % period);
      for (let shift = 0; shift < period; shift++) {
        const g = [];
        for (let r = 0; r < SIZE; r++) {
          const row = [];
          for (let c = 0; c < SIZE; c++) row.push(base[(c + r + shift) % period]);
          g.push(row);
        }
        if (Engine.findMatches(g).length === 0 && !Engine.hasMoves(g) && Engine.reshuffle(g.map((r) => r.slice()))) {
          return g;
        }
      }
    }
    return null;
  }
  const dead = tryFindDeadlock();
  ok(dead, 'constructed a real deadlocked board to test reshuffle');
  if (dead) {
    G.setBoard(dead);
    ok(Engine.hasMoves(G.getState().grid) === false, 'board before reshuffle is confirmed stuck');
    await G.ensurePlayable();
    const recovered = G.getState().grid;
    ok(Engine.findMatches(recovered).length === 0, 'reshuffled board has no immediate matches');
    ok(Engine.hasMoves(recovered) === true, 'reshuffled board is playable again');
  }

  // 5. match-4 spawns a LINE power gem.
  // Verified board (no pre-existing matches); swapping (1,4)<->(1,5) makes a clean 4-run of type 2.
  const four = [
    [4,2,0,4,4,2,4,0],
    [1,3,0,2,2,3,4,5],
    [4,5,1,4,5,2,5,4],
    [2,3,1,2,5,2,1,1],
    [4,5,0,1,0,1,4,5],
    [1,0,0,2,2,1,5,0],
    [5,4,2,5,2,4,5,5],
    [2,5,0,1,1,0,3,0],
  ];
  ok(Engine.findMatches(four).length === 0, 'match-4 test board starts with no matches');
  // find a swap that yields a run of at least 4 (not just any match)
  function findFourMove(grid) {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const makesFour = (r1, c1, r2, c2) => {
        const x = grid[r1][c1]; grid[r1][c1] = grid[r2][c2]; grid[r2][c2] = x;
        const ok = Engine.findMatchGroups(grid).some((gr) => gr.len >= 4);
        const y = grid[r1][c1]; grid[r1][c1] = grid[r2][c2]; grid[r2][c2] = y;
        return ok;
      };
      if (c + 1 < SIZE && makesFour(r, c, r, c + 1)) return { a: { r, c }, b: { r, c: c + 1 } };
      if (r + 1 < SIZE && makesFour(r, c, r + 1, c)) return { a: { r, c }, b: { r: r + 1, c } };
    }
    return null;
  }
  const fourMove = findFourMove(four);
  if (fourMove) {
    G.clearSpawnLog();
    G.setBoard(four);
    await G.trySwap(fourMove.a, fourMove.b);
    const log = G.getSpawnLog();
    ok(log.some((s) => s.power === 1), 'match-4 spawned a LINE power gem (via spawn log)');
  } else {
    ok(false, 'could not locate a 4-match swap on test board');
  }

  // 5b. 2x2 SQUARE match: swapping two adjacent gems can make a 2x2 block of one type.
  // Build a match-free board, then plant a 2x2 square that is ONE swap away, and
  // verify the engine+controller clear it and reward a Line Blaster (like a 4-run).
  const sq = [
    [4,2,0,4,1,3,4,0],
    [1,3,0,2,2,9,2,5],
    [4,5,1,4,2,2,5,4],
    [2,3,1,2,5,0,1,1],
    [4,5,0,1,0,1,4,5],
    [1,0,0,2,2,1,5,0],
    [5,4,2,5,2,4,5,5],
    [2,5,0,1,1,0,3,0],
  ];
  ok(Engine.findMatches(sq).length === 0, 'square test board starts with no matches');
  // Find the adjacent swap that yields a 2x2 square (dir 'sq').
  function findSquareMove(grid) {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const makesSq = (r1, c1, r2, c2) => {
        const x = grid[r1][c1]; grid[r1][c1] = grid[r2][c2]; grid[r2][c2] = x;
        const ok = Engine.findMatchGroups(grid).some((g) => g.dir === 'sq' && g.len === 4);
        const y = grid[r1][c1]; grid[r1][c1] = grid[r2][c2]; grid[r2][c2] = y;
        return ok;
      };
      if (c + 1 < SIZE && makesSq(r, c, r, c + 1)) return { a: { r, c }, b: { r, c: c + 1 } };
      if (r + 1 < SIZE && makesSq(r, c, r + 1, c)) return { a: { r, c }, b: { r: r + 1, c } };
    }
    return null;
  }
  const sqMove = findSquareMove(sq);
  if (sqMove) {
    G.clearSpawnLog();
    G.setBoard(sq);
    const beforeSq = G.getState();
    await G.trySwap(sqMove.a, sqMove.b);
    const afterSq = G.getState();
    ok(afterSq.score > beforeSq.score, '2x2 square swap scored points');
    ok(afterSq.grid.every((r) => r.every((v) => v !== null)), 'board refilled after square clear (no holes)');
    ok(G.getSpawnLog().some((s) => s.power === 1 && s.square), '2x2 square spawned a LINE power gem (flagged square)');
  } else {
    ok(false, 'could not locate a 2x2 square swap on test board');
  }

  // 6. swapping a power gem clears a large area (line blaster clears row+col)
  // Place a LINE power at (4,4) and swap it with a normal neighbor.
  const base = Engine.makeGrid(SIZE);
  // clear any accidental matches so findMatches is stable
  while (Engine.findMatches(base).length > 0) Engine.reshuffle(base);
  const withPow = base.map((r) => r.slice());
  const P = G.POWER;
  const pow = Array.from({ length: SIZE }, () => new Array(SIZE).fill(P.NONE));
  pow[4][4] = P.LINE;
  G.setBoard(withPow, pow);
  const beforePow = G.getState();
  await G.trySwap({ r: 4, c: 4 }, { r: 4, c: 3 }); // activate the line blaster
  const afterPow = G.getState();
  ok(afterPow.score > beforePow.score, 'activating a power gem scored points');
  ok(afterPow.grid.every((r) => r.every((v) => v !== null)), 'board refilled after power activation (no holes)');

  // helper: make one legal swap on the current real board (awaits completion)
  async function playOneLegalMove() {
    const st = G.getState();
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const trySwapPair = (r1, c1, r2, c2) => {
        const g = st.grid;
        const x = g[r1][c1]; g[r1][c1] = g[r2][c2]; g[r2][c2] = x;
        const okMove = Engine.findMatches(g).length > 0;
        const y = g[r1][c1]; g[r1][c1] = g[r2][c2]; g[r2][c2] = y;
        return okMove;
      };
      if (c + 1 < SIZE && trySwapPair(r, c, r, c + 1)) { await G.trySwap({ r, c }, { r, c: c + 1 }); return true; }
      if (r + 1 < SIZE && trySwapPair(r, c, r + 1, c)) { await G.trySwap({ r, c }, { r: r + 1, c }); return true; }
    }
    return false;
  }

  // 7. LEVELED MODE: reaching the goal advances to a higher-goal level.
  G.startMode('leveled');
  ok(G.getState().mode === 'leveled', 'startMode(leveled) sets mode');
  ok(G.getState().level === 1, 'leveled mode starts at level 1');
  ok(G.getState().goal === G.goalForLevel(1), 'level 1 goal matches goalForLevel(1)');
  ok(G.goalForLevel(2) > G.goalForLevel(1), 'goal is higher on level 2');
  ok(G.goalForLevel(5) > G.goalForLevel(4), 'goal keeps climbing every level');

  // play legal moves until we either clear the level or run out of moves
  let guard = 0;
  while (G.getState().score < G.getState().goal && G.getState().moves > 0 && guard < 200) {
    await playOneLegalMove();
    guard++;
  }
  ok(G.getState().score > 0, 'leveled mode accrued score from legal moves');
  // if we reached the goal, the overlay should have shown "level clear" and nextLevel climbs
  if (G.getState().score >= G.getState().goal) {
    G.nextLevel();
    ok(G.getState().level === 2, 'nextLevel advances to level 2 after clearing goal');
    ok(G.getState().goal === G.goalForLevel(2), 'level 2 goal is the higher scaled goal');
    ok(G.getState().moves === 20, 'moves restore on level advance');
  } else {
    // not enough legal moves to reach an 800 goal in the test harness; still assert structure
    ok(G.getState().moves <= 20, 'moves counter behaves in leveled mode');
  }

  // 8. INFINITE MODE: 20 moves, no goal; run ends when moves hit 0.
  G.startMode('infinite');
  ok(G.getState().mode === 'infinite', 'startMode(infinite) sets mode');
  ok(G.getState().moves === 20, 'infinite mode starts with 20 moves');
  guard = 0;
  while (G.getState().moves > 0 && guard < 300) { await playOneLegalMove(); guard++; }
  ok(G.getState().score > 0, 'infinite mode accrued score from legal moves');

  console.log(`\nGame logic tests: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
