/* Cosmic Gems - game controller.
 * Uses CosmicEngine (engine.js) for the pure match-3 math and renders the board
 * with absolutely-positioned gems so swaps and falls animate smoothly.
 *
 * Power-ups: matching 4 gems in a line spawns a LINE BLASTER (clears its entire
 * row + column); matching 5+ spawns a BOMB (clears every gem of its color).
 *
 * Modes:
 *   - leveled:  climb endless levels; each level has a rising score goal + a
 *               move budget. Hit the goal to advance (carry score, restore moves).
 *   - infinite: score-attack, no goal, 20 moves, then it's over.
 */
(function () {
  'use strict';

  const SIZE = 8;
  const START_MOVES = 20;
  const BASE_GOAL = 800;          // leveled mode: goal for level 1
  const BEST_KEY = 'cosmicGemsBest';
  const BEST_LEVEL_KEY = 'cosmicGemsBestLevel';

  const POWER = { NONE: 0, LINE: 1, BOMB: 2 };
  const GEM_EMOJI = ['◆', '●', '▲', '★', '✦', '❖'];

  // DOM
  const homeScreen = document.getElementById('home');
  const gameScreen = document.getElementById('game');
  const boardEl = document.getElementById('board');
  const scoreEl = document.getElementById('score');
  const movesEl = document.getElementById('moves');
  const targetEl = document.getElementById('target');
  const bestEl = document.getElementById('best');
  const levelChip = document.getElementById('level-chip');
  const goalLabel = document.getElementById('goal-label');
  const comboEl = document.getElementById('combo');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayMsg = document.getElementById('overlay-msg');
  const overlayActions = document.getElementById('overlay-actions');
  const restartBtn = document.getElementById('restart');
  const homeBtn = document.getElementById('home-btn');
  const bestLeveledEl = document.getElementById('best-leveled');
  const bestInfiniteEl = document.getElementById('best-infinite');

  // sizing from CSS vars
  const css = getComputedStyle(document.documentElement);
  const CELL = parseFloat(css.getPropertyValue('--cell'));
  const GAP = parseFloat(css.getPropertyValue('--gap'));
  const STEP = CELL + GAP;

  let grid = [];
  let powers = [];
  let gemEls = [];
  let score = 0;
  let moves = START_MOVES;
  let selected = null;
  let busy = false;
  let mode = 'leveled';      // 'leveled' | 'infinite'
  let level = 1;
  let goal = BASE_GOAL;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let bestLevel = Number(localStorage.getItem(BEST_LEVEL_KEY) || 1);

  // Debug: records every power gem spawned (match-4/match-5) so tests/inspection
  // can confirm spawning deterministically even if a later cascade consumes the gem.
  const spawnLog = [];

  bestEl.textContent = 'Best: Lv ' + bestLevel;
  bestLeveledEl.textContent = 'Best: Lv ' + bestLevel;
  bestInfiniteEl.textContent = 'Best: ' + best;

  function pos(r, c) {
    return { x: GAP + c * STEP, y: GAP + r * STEP };
  }

  function applySkin(el, type, power) {
    el.className = 'gem-el g' + type;
    if (power === POWER.LINE) el.classList.add('power-line');
    else if (power === POWER.BOMB) el.classList.add('power-bomb');
    const inner = el.querySelector('.gem');
    inner.textContent = GEM_EMOJI[type];
  }

  function makeGemEl(type, power) {
    const el = document.createElement('div');
    const inner = document.createElement('div');
    inner.className = 'gem';
    el.appendChild(inner);
    applySkin(el, type, power || POWER.NONE);
    return el;
  }

  function placeGem(el, r, c) {
    const { x, y } = pos(r, c);
    el.style.transform = `translate(${x}px, ${y}px)`;
  }

  function buildBoard(preset) {
    boardEl.innerHTML = '';
    boardEl.style.width = GAP * 2 + SIZE * CELL + (SIZE - 1) * GAP + 'px';
    boardEl.style.height = boardEl.style.width;

    grid = preset ? preset.map((r) => r.slice()) : CosmicEngine.makeGrid(SIZE);
    powers = [];
    gemEls = [];
    for (let r = 0; r < SIZE; r++) {
      powers.push(new Array(SIZE).fill(POWER.NONE));
      gemEls.push([]);
      for (let c = 0; c < SIZE; c++) {
        const el = makeGemEl(grid[r][c]);
        placeGem(el, r, c);
        el.dataset.r = r;
        el.dataset.c = c;
        boardEl.appendChild(el);
        gemEls[r].push(el);
      }
    }
  }

  function setSelected(sel) {
    if (selected) {
      const prev = gemEls[selected.r][selected.c];
      if (prev) prev.classList.remove('selected');
    }
    selected = sel;
    if (selected) gemEls[selected.r][selected.c].classList.add('selected');
  }

  function setCell(r, c, type, power, el) {
    grid[r][c] = type;
    powers[r][c] = power || POWER.NONE;
    gemEls[r][c] = el;
    if (el) {
      el.dataset.r = r; el.dataset.c = c;
      applySkin(el, type, powers[r][c]);
    }
  }

  async function swapCells(a, b) {
    const ta = grid[a.r][a.c], pa = powers[a.r][a.c], ea = gemEls[a.r][a.c];
    const tb = grid[b.r][b.c], pb = powers[b.r][b.c], eb = gemEls[b.r][b.c];
    setCell(a.r, a.c, tb, pb, eb);
    setCell(b.r, b.c, ta, pa, ea);
    placeGem(eb, a.r, a.c);
    placeGem(ea, b.r, b.c);
    await wait(190);
  }

  function centerOf(group) {
    const mid = Math.floor(group.len / 2);
    return group.cells[mid];
  }

  // Collect every cell that should clear from this activation, applying the
  // power's effect when a power gem is in the matched set.
  function collectClear(initial, seen) {
    const queue = [...initial];
    while (queue.length) {
      const { r, c } = queue.pop();
      const key = r * SIZE + c;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = powers[r][c];
      if (p === POWER.LINE) {
        for (let k = 0; k < SIZE; k++) {
          if (!seen.has(r * SIZE + k)) queue.push({ r, c: k });
          if (!seen.has(k * SIZE + c)) queue.push({ r: k, c });
        }
      } else if (p === POWER.BOMB) {
        const color = grid[r][c];
        for (let rr = 0; rr < SIZE; rr++)
          for (let cc = 0; cc < SIZE; cc++)
            if (grid[rr][cc] === color && !seen.has(rr * SIZE + cc))
              queue.push({ r: rr, c: cc });
      }
    }
    return [...seen].map((v) => ({ r: Math.floor(v / SIZE), c: v % SIZE }));
  }

  async function resolveBoard(comboLevel) {
    const groups = CosmicEngine.findMatchGroups(grid);
    if (groups.length === 0) return 0;

    const spawnPlan = [];
    for (const g of groups) {
      if (g.len === 4) spawnPlan.push({ at: centerOf(g), type: grid[g.cells[0].r][g.cells[0].c], power: POWER.LINE });
      else if (g.len >= 5) spawnPlan.push({ at: centerOf(g), type: grid[g.cells[0].r][g.cells[0].c], power: POWER.BOMB });
    }
    spawnPlan.forEach((s) => spawnLog.push({ ...s }));

    const matchedCells = new Set();
    groups.forEach((g) => g.cells.forEach(({ r, c }) => matchedCells.add(r * SIZE + c)));
    const allCleared = collectClear(
      [...matchedCells].map((v) => ({ r: Math.floor(v / SIZE), c: v % SIZE })),
      new Set()
    );

    const gained = allCleared.length * 15 * (comboLevel + 1);
    addScore(gained);
    if (comboLevel >= 1 || spawnPlan.length > 0) flashCombo(comboLevel, allCleared.length, spawnPlan);

    allCleared.forEach(({ r, c }) => {
      const el = gemEls[r][c];
      if (el) el.classList.add('pop');
    });
    await wait(220);

    allCleared.forEach(({ r, c }) => {
      if (grid[r][c] === null) return;
      grid[r][c] = null;
      powers[r][c] = POWER.NONE;
      const el = gemEls[r][c];
      if (el) el.remove();
      gemEls[r][c] = null;
    });

    spawnPlan.forEach(({ at, type, power }) => {
      if (grid[at.r][at.c] === null) {
        const el = makeGemEl(type, power);
        setCell(at.r, at.c, type, power, el);
        placeGem(el, at.r, at.c);
        el.dataset.r = at.r; el.dataset.c = at.c;
        boardEl.appendChild(el);
        el.classList.add('blast');
        setTimeout(() => el.classList.remove('blast'), 300);
      }
    });

    for (let c = 0; c < SIZE; c++) {
      let writeRow = SIZE - 1;
      for (let r = SIZE - 1; r >= 0; r--) {
        if (grid[r][c] !== null) {
          if (writeRow !== r) {
            const t = grid[r][c], p = powers[r][c], el = gemEls[r][c];
            setCell(writeRow, c, t, p, el);
            grid[r][c] = null; powers[r][c] = POWER.NONE; gemEls[r][c] = null;
            if (el) placeGem(el, writeRow, c);
          }
          writeRow--;
        }
      }
      for (let r = writeRow; r >= 0; r--) {
        const type = CosmicEngine.randInt(CosmicEngine.GEM_TYPES);
        const el = makeGemEl(type);
        el.style.opacity = '0';
        placeGem(el, r - (writeRow + 1), c);
        boardEl.appendChild(el);
        setCell(r, c, type, POWER.NONE, el);
        requestAnimationFrame(() => {
          el.style.opacity = '1';
          placeGem(el, r, c);
        });
      }
    }
    await wait(200);

    return allCleared.length + (await resolveBoard(comboLevel + 1));
  }

  async function activatePowerAt(r, c) {
    const p = powers[r][c];
    if (!p) return false;
    const cleared = collectClear([{ r, c }], new Set());
    if (cleared.length <= 1) return false;
    flashCombo(0, cleared.length, [{ power: p }]);
    cleared.forEach(({ r: rr, c: cc }) => {
      const el = gemEls[rr][cc];
      if (el) el.classList.add('blast');
    });
    addScore(cleared.length * 20);
    await wait(280);
    cleared.forEach(({ r: rr, c: cc }) => {
      grid[rr][cc] = null; powers[rr][cc] = POWER.NONE;
      const el = gemEls[rr][cc];
      if (el) el.remove();
      gemEls[rr][cc] = null;
    });
    for (let c = 0; c < SIZE; c++) {
      let writeRow = SIZE - 1;
      for (let r = SIZE - 1; r >= 0; r--) {
        if (grid[r][c] !== null) {
          if (writeRow !== r) {
            const t = grid[r][c], pp = powers[r][c], el = gemEls[r][c];
            setCell(writeRow, c, t, pp, el);
            grid[r][c] = null; powers[r][c] = POWER.NONE; gemEls[r][c] = null;
            if (el) placeGem(el, writeRow, c);
          }
          writeRow--;
        }
      }
      for (let r = writeRow; r >= 0; r--) {
        const type = CosmicEngine.randInt(CosmicEngine.GEM_TYPES);
        const el = makeGemEl(type);
        el.style.opacity = '0';
        placeGem(el, r - (writeRow + 1), c);
        boardEl.appendChild(el);
        setCell(r, c, type, POWER.NONE, el);
        requestAnimationFrame(() => {
          el.style.opacity = '1';
          placeGem(el, r, c);
        });
      }
    }
    await wait(200);
    return true;
  }

  function flashCombo(level, count, spawnPlan) {
    let msg;
    if (spawnPlan && spawnPlan.some((s) => s.power === POWER.BOMB)) msg = 'BOMB CREATED!';
    else if (spawnPlan && spawnPlan.some((s) => s.power === POWER.LINE)) msg = 'LINE BLASTER!';
    else if (level >= 1) msg = `COMBO x${level + 1}  +${count * 15 * (level + 1)}`;
    else msg = `+${count * 15}`;
    comboEl.textContent = msg;
    comboEl.classList.remove('show');
    void comboEl.offsetWidth;
    comboEl.classList.add('show');
  }

  function addScore(n) {
    score += n;
    scoreEl.textContent = score;
    scoreEl.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }],
      { duration: 240, easing: 'ease-out' }
    );
  }

  async function trySwap(a, b) {
    if (busy) return;
    if (!adjacent(a, b)) return;
    busy = true;
    setSelected(null);
    await swapCells(a, b);

    if (powers[a.r][a.c] || powers[b.r][b.c]) {
      moves--;
      movesEl.textContent = moves;
      if (powers[a.r][a.c]) await activatePowerAt(a.r, a.c);
      if (powers[b.r][b.c]) await activatePowerAt(b.r, b.c);
      await resolveBoard(0);
      await ensurePlayable();
      busy = false;
      checkEnd();
      return;
    }

    if (CosmicEngine.findMatches(grid).length === 0) {
      await swapCells(a, b);
      busy = false;
      return;
    }

    moves--;
    movesEl.textContent = moves;
    await resolveBoard(0);
    await ensurePlayable();
    busy = false;
    checkEnd();
  }

  async function ensurePlayable() {
    if (CosmicEngine.findMatches(grid).length > 0) return;
    if (CosmicEngine.hasMoves(grid)) return;
    comboEl.textContent = 'SHUFFLE!';
    comboEl.classList.remove('show');
    void comboEl.offsetWidth;
    comboEl.classList.add('show');
    await wait(120);
    CosmicEngine.reshuffle(grid);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        powers[r][c] = POWER.NONE;
        applySkin(gemEls[r][c], grid[r][c], POWER.NONE);
      }
    }
    await wait(220);
  }

  function adjacent(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  }

  function goalForLevel(lv) {
    // ~800, then +350 per level with a gentle curve so it keeps climbing forever.
    return BASE_GOAL + (lv - 1) * 350 + Math.floor((lv - 1) * (lv - 1) * 20);
  }

  function refreshHud() {
    scoreEl.textContent = score;
    movesEl.textContent = String(moves);
    levelChip.textContent = 'Lv ' + level;
    if (mode === 'leveled') {
      goalLabel.textContent = 'GOAL';
      targetEl.textContent = goal;
    } else {
      goalLabel.textContent = 'BEST';
      targetEl.textContent = best;
    }
  }

  function checkEnd() {
    if (mode === 'leveled') {
      if (score >= goal) return endGame('level');
    } else {
      if (moves <= 0) return endGame('over');
    }
  }

  async function recordBest() {
    if (mode === 'infinite' && score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
      bestInfiniteEl.textContent = 'Best: ' + best;
    } else if (mode === 'leveled' && level > bestLevel) {
      bestLevel = level;
      localStorage.setItem(BEST_LEVEL_KEY, String(bestLevel));
      bestLeveledEl.textContent = 'Best: Lv ' + bestLevel;
    }
    bestEl.textContent = mode === 'leveled' ? 'Best: Lv ' + bestLevel : 'Best: ' + best;

    // Cross-device: push the new best to the cloud if signed in.
    // Leveled ranks by level reached; infinite ranks by score (see cloud.js).
    if (window.Cloud && window.Cloud.isEnabled()) {
      const scoreArg = mode === 'leveled' ? bestLevel : best;
      const levelArg = mode === 'leveled' ? bestLevel : 1;
      window.Cloud.submitScore(mode, scoreArg, levelArg).catch(() => {});
    }
  }

  function endGame(kind) {
    recordBest();
    overlayActions.innerHTML = '';
    if (kind === 'level') {
      overlayTitle.textContent = `Level ${level} Clear!`;
      overlayMsg.textContent = `Goal reached with ${moves} move${moves === 1 ? '' : 's'} to spare. Onward!`;
      addAction('Next Level', false, () => nextLevel());
      addAction('Home', true, () => goHome());
    } else {
      overlayTitle.textContent = 'Run Over';
      overlayMsg.textContent = `You scored ${score} in Infinite mode. Best: ${best}.`;
      addAction('Play Again', false, () => startMode('infinite'));
      addAction('Home', true, () => goHome());
    }
    overlay.classList.remove('hidden');
  }

  function addAction(label, ghost, fn) {
    const b = document.createElement('button');
    b.className = 'btn' + (ghost ? ' ghost' : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    overlayActions.appendChild(b);
  }

  function nextLevel() {
    level++;
    goal = goalForLevel(level);
    moves = START_MOVES;
    overlay.classList.add('hidden');
    buildBoard();
    refreshHud();
  }

  function startMode(which) {
    mode = which;
    level = 1;
    score = 0;
    moves = START_MOVES;
    goal = goalForLevel(1);
    homeScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    overlay.classList.add('hidden');
    selected = null; busy = false;
    buildBoard();
    refreshHud();
  }

  function goHome() {
    overlay.classList.add('hidden');
    gameScreen.classList.add('hidden');
    homeScreen.classList.remove('hidden');
  }

  // ---- input ----
  function cellFromEvent(e) {
    const t = e.target.closest('.gem-el');
    if (!t || !boardEl.contains(t)) return null;
    return { r: +t.dataset.r, c: +t.dataset.c };
  }

  let dragStart = null;
  boardEl.addEventListener('click', (e) => {
    const cell = cellFromEvent(e);
    if (!cell) return;
    if (!selected) { setSelected(cell); return; }
    if (selected.r === cell.r && selected.c === cell.c) { setSelected(null); return; }
    if (adjacent(selected, cell)) trySwap(selected, cell);
    else setSelected(cell);
  });

  boardEl.addEventListener('pointerdown', (e) => { dragStart = cellFromEvent(e); });
  boardEl.addEventListener('pointerup', (e) => {
    if (!dragStart) return;
    const end = cellFromEvent(e);
    if (end && adjacent(dragStart, end)) trySwap(dragStart, end);
    dragStart = null;
  });

  function wait(ms) { return new Promise((res) => setTimeout(res, ms)); }

  restartBtn.addEventListener('click', () => {
    if (mode === 'leveled') { level = 1; goal = goalForLevel(1); }
    score = 0; moves = START_MOVES;
    overlay.classList.add('hidden');
    selected = null; busy = false;
    buildBoard();
    refreshHud();
  });

  homeBtn.addEventListener('click', goHome);

  // home screen mode buttons
  document.querySelectorAll('.mode-card').forEach((btn) => {
    btn.addEventListener('click', () => startMode(btn.dataset.mode));
  });

  // ---------- cloud: auth + leaderboard ----------
  const Cloud = window.Cloud;
  const signinOpenBtn = document.getElementById('signin-open');
  const accountStatus = document.getElementById('account-status');
  const authModal = document.getElementById('auth-modal');
  const authClose = document.getElementById('auth-close');
  const authSubmit = document.getElementById('auth-submit');
  const authToggle = document.getElementById('auth-toggle');
  const authGoogle = document.getElementById('google-btn');
  const authEmail = document.getElementById('auth-email');
  const authPass = document.getElementById('auth-pass');
  const authMsg = document.getElementById('auth-msg');
  const lbList = document.getElementById('lb-list');
  const lbTabs = document.querySelectorAll('.lb-tab');
  let lbMode = 'leveled';
  let isSignUp = false;

  function setAuthMsg(text, ok) {
    authMsg.textContent = text || '';
    authMsg.classList.toggle('ok', !!ok);
  }

  function updateAccountUI(user) {
    if (!user) {
      signinOpenBtn.classList.remove('hidden');
      accountStatus.innerHTML = '';
      lbList.innerHTML = '<li class="lb-empty">Sign in to sync scores &amp; see the galaxy rank.</li>';
      return;
    }
    signinOpenBtn.classList.add('hidden');
    const name = (user.user_metadata && user.user_metadata.display_name) || user.email || 'Commander';
    accountStatus.innerHTML = `${name} <span class="signout" id="signout-btn">Sign out</span>`;
    const so = document.getElementById('signout-btn');
    if (so) so.addEventListener('click', async () => { await Cloud.signOut(); });
    loadLeaderboard();
  }

  async function loadLeaderboard() {
    if (!Cloud || !Cloud.isEnabled()) {
      lbList.innerHTML = '<li class="lb-empty">Cloud not configured — runs locally. Add Supabase keys in js/config.js.</li>';
      return;
    }
    const res = await Cloud.getLeaderboard(lbMode, 25);
    if (!res.ok) { lbList.innerHTML = `<li class="lb-empty">${res.error || 'Could not load leaderboard.'}</li>`; return; }
    const me = await Cloud.currentUser();
    if (!res.rows.length) { lbList.innerHTML = '<li class="lb-empty">No scores yet — be the first!</li>'; return; }
    lbList.innerHTML = '';
    res.rows.forEach((row) => {
      const li = document.createElement('li');
      if (me && row.name === ((me.user_metadata && me.user_metadata.display_name) || me.email)) li.classList.add('me');
      const val = lbMode === 'leveled' ? `Lv ${row.level}` : row.score.toLocaleString();
      li.innerHTML = `<span class="lb-name">${escapeHtml(row.name)}</span><span class="lb-score">${val}</span>`;
      lbList.appendChild(li);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function syncBestFromCloud() {
    const mine = await Cloud.getMyBest();
    if (!mine) return;
    if (mine.leveled && mine.leveled.level > bestLevel) {
      bestLevel = mine.leveled.level;
      localStorage.setItem(BEST_LEVEL_KEY, String(bestLevel));
      bestLeveledEl.textContent = 'Best: Lv ' + bestLevel;
    }
    if (mine.infinite && mine.infinite.score > best) {
      best = mine.infinite.score;
      localStorage.setItem(BEST_KEY, String(best));
      bestInfiniteEl.textContent = 'Best: ' + best;
    }
    bestEl.textContent = mode === 'leveled' ? 'Best: Lv ' + bestLevel : 'Best: ' + best;
  }

  if (Cloud) {
    signinOpenBtn.addEventListener('click', () => { setAuthMsg(''); authModal.classList.remove('hidden'); });
    authClose.addEventListener('click', () => authModal.classList.add('hidden'));
    authToggle.addEventListener('click', () => {
      isSignUp = !isSignUp;
      authToggle.textContent = isSignUp ? 'Have an account? Sign in' : 'No account? Create one';
      authSubmit.textContent = isSignUp ? 'Sign Up' : 'Sign In';
    });
    authSubmit.addEventListener('click', async () => {
      const email = authEmail.value.trim();
      const pass = authPass.value;
      if (!email || !pass) { setAuthMsg('Enter email and password.'); return; }
      setAuthMsg('Working…');
      const r = await Cloud.signInEmail(email, pass, isSignUp);
      if (!r.ok) { setAuthMsg(r.offline ? 'Cloud not configured.' : r.error); return; }
      setAuthMsg(isSignUp ? 'Account created! Check your email to confirm.' : 'Signed in!', true);
      setTimeout(() => authModal.classList.add('hidden'), 800);
    });
    authGoogle.addEventListener('click', async () => {
      const r = await Cloud.signInGoogle();
      if (!r.ok) { setAuthMsg(r.offline ? 'Cloud not configured.' : r.error); return; }
      if (r.url) window.location.href = r.url;
    });
    lbTabs.forEach((t) => t.addEventListener('click', () => {
      lbTabs.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      lbMode = t.dataset.lb;
      loadLeaderboard();
    }));
    Cloud.onAuthChange((session) => {
      const user = session && session.user;
      updateAccountUI(user);
      if (user) syncBestFromCloud();
    });
    // initial state
    Cloud.currentUser().then((u) => updateAccountUI(u));
  }

  // Debug hook (harmless in the browser; used by the Node logic test + manual tweaking)
  if (typeof window !== 'undefined') {
    window.CosmicGame = {
      POWER,
      goalForLevel,
      startMode,
      nextLevel,
      goHome,
      getSpawnLog: () => spawnLog.slice(),
      clearSpawnLog: () => { spawnLog.length = 0; },
      trySwap: (a, b) => trySwap(a, b),
      ensurePlayable: () => ensurePlayable(),
      getState: () => ({ mode, level, score, moves, goal, grid: grid.map((r) => r.slice()), powers: powers.map((r) => r.slice()), busy }),
      setBoard: (g, p) => {
        grid = g.map((r) => r.slice());
        selected = null; busy = false;
        buildBoard(grid);
        powers = (p ? p.map((r) => r.slice())
                    : Array.from({ length: SIZE }, () => new Array(SIZE).fill(POWER.NONE)));
        for (let r = 0; r < SIZE; r++)
          for (let c = 0; c < SIZE; c++)
            if (powers[r][c]) applySkin(gemEls[r][c], grid[r][c], powers[r][c]);
      },
    };
  }
})();
