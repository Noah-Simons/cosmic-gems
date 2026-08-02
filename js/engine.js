/*
 * Cosmic Gems - core match-3 logic.
 * Pure functions over a 2D grid of gem "types" (integers 0..n-1, or null for empty).
 * Works in the browser (window.CosmicEngine) and in Node (module.exports) so the
 * math can be unit-tested without a DOM.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CosmicEngine = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function randInt(n, rng) {
    return Math.floor((rng || Math.random)() * n);
  }

  // Build a size x size grid with NO pre-existing matches.
  function makeGrid(size, rng) {
    const grid = [];
    for (let r = 0; r < size; r++) {
      grid.push([]);
      for (let c = 0; c < size; c++) {
        let type;
        let guard = 0;
        do {
          type = randInt(GEM_TYPES, rng);
          guard++;
        } while (guard < 50 && createsMatchAt(grid, r, c, type));
        grid[r].push(type);
      }
    }
    return grid;
  }

  // Would placing `type` at (r,c) complete a run of 3 with already-filled cells,
  // or complete a 2x2 square with already-filled cells?
  // (makeGrid fills top-to-bottom, left-to-right, so only the square whose
  //  top-left is (r-1,c-1) can be completed by placing (r,c) as its bottom-right.)
  function createsMatchAt(grid, r, c, type) {
    // two to the left
    if (c >= 2 && grid[r][c - 1] === type && grid[r][c - 2] === type) return true;
    // two above
    if (r >= 2 && grid[r - 1][c] === type && grid[r - 2][c] === type) return true;
    // 2x2 square where (r,c) is the bottom-right corner (other three already filled)
    if (r >= 1 && c >= 1 && grid[r - 1][c - 1] === type && grid[r - 1][c] === type && grid[r][c - 1] === type) return true;
    return false;
  }

  // Return every 2x2 block of identical non-null gems (a "square" match).
  // Each group: { cells:[{r,c}x4], len:4, dir:'sq' }
  // The top-left corner of a square at (r,c) covers rows r,r+1 and cols c,c+1.
  function findSquares(grid) {
    const size = grid.length;
    const groups = [];
    for (let r = 0; r + 1 < size; r++) {
      for (let c = 0; c + 1 < size; c++) {
        const t = grid[r][c];
        if (t === null) continue;
        if (grid[r][c + 1] === t && grid[r + 1][c] === t && grid[r + 1][c + 1] === t) {
          groups.push({
            cells: [
              { r, c },
              { r, c: c + 1 },
              { r: r + 1, c },
              { r: r + 1, c: c + 1 },
            ],
            len: 4,
            dir: 'sq',
          });
        }
      }
    }
    return groups;
  }

  // Return an array of {r,c} for every cell that is part of a horizontal or
  // vertical run of 3+ identical (non-null) gems, OR a 2x2 square match.
  function findMatches(grid) {
    const size = grid.length;
    const matched = new Set();
    const key = (r, c) => r * size + c;

    // horizontal runs
    for (let r = 0; r < size; r++) {
      let runStart = 0;
      for (let c = 1; c <= size; c++) {
        const prev = grid[r][c - 1];
        const cur = c < size ? grid[r][c] : null;
        if (c === size || cur !== prev || prev === null) {
          const len = c - runStart;
          if (prev !== null && len >= 3) {
            for (let k = runStart; k < c; k++) matched.add(key(r, k));
          }
          runStart = c;
        }
      }
    }

    // vertical runs
    for (let c = 0; c < size; c++) {
      let runStart = 0;
      for (let r = 1; r <= size; r++) {
        const prev = grid[r - 1][c];
        const cur = r < size ? grid[r][c] : null;
        if (r === size || cur !== prev || prev === null) {
          const len = r - runStart;
          if (prev !== null && len >= 3) {
            for (let k = runStart; k < r; k++) matched.add(key(k, c));
          }
          runStart = r;
        }
      }
    }

    // 2x2 square matches
    for (const sq of findSquares(grid)) {
      sq.cells.forEach(({ r, c }) => matched.add(key(r, c)));
    }

    return [...matched].map((v) => ({ r: Math.floor(v / size), c: v % size }));
  }

  // Count the number of separate matches (a horizontal line + vertical line that
  // cross count as 2). Useful for combo/score tuning.
  function countMatches(grid) {
    return findMatches(grid).length;
  }

  // Return every match as a group (horizontal/vertical runs of 3+ AND 2x2
  // squares). Each group: { cells:[{r,c}...], len, dir:'h'|'v'|'sq' }
  function findMatchGroups(grid) {
    const size = grid.length;
    const groups = [];

    // horizontal runs
    for (let r = 0; r < size; r++) {
      let runStart = 0;
      for (let c = 1; c <= size; c++) {
        const prev = grid[r][c - 1];
        const cur = c < size ? grid[r][c] : null;
        if (c === size || cur !== prev || prev === null) {
          const len = c - runStart;
          if (prev !== null && len >= 3) {
            const cells = [];
            for (let k = runStart; k < c; k++) cells.push({ r, c: k });
            groups.push({ cells, len, dir: 'h' });
          }
          runStart = c;
        }
      }
    }

    // vertical runs
    for (let c = 0; c < size; c++) {
      let runStart = 0;
      for (let r = 1; r <= size; r++) {
        const prev = grid[r - 1][c];
        const cur = r < size ? grid[r][c] : null;
        if (r === size || cur !== prev || prev === null) {
          const len = r - runStart;
          if (prev !== null && len >= 3) {
            const cells = [];
            for (let k = runStart; k < r; k++) cells.push({ r: k, c });
            groups.push({ cells, len, dir: 'v' });
          }
          runStart = r;
        }
      }
    }

    // 2x2 squares
    for (const sq of findSquares(grid)) groups.push(sq);

    return groups;
  }

  // Is there any single adjacent swap that would create a match?
  function hasMoves(grid) {
    const size = grid.length;
    const test = (r1, c1, r2, c2) => {
      const t = grid[r1][c1];
      grid[r1][c1] = grid[r2][c2];
      grid[r2][c2] = t;
      const ok = findMatches(grid).length > 0;
      const t2 = grid[r1][c1];
      grid[r1][c1] = grid[r2][c2];
      grid[r2][c2] = t2;
      return ok;
    };
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (c + 1 < size && test(r, c, r, c + 1)) return true;
        if (r + 1 < size && test(r, c, r + 1, c)) return true;
      }
    }
    return false;
  }

  // Reassign every non-null cell a fresh random type, keeping the same count/shape,
  // until the board both (a) has no immediate matches and (b) has at least one move.
  // Mutates `grid` in place. Returns true on success; falls back to a guaranteed
  // match-free regeneration if permutations can't find a solvable arrangement.
  function reshuffle(grid, rng) {
    const size = grid.length;
    // 1) try random permutations of the existing gems
    for (let attempt = 0; attempt < 1000; attempt++) {
      const types = [];
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++) if (grid[r][c] !== null) types.push(grid[r][c]);
      for (let i = types.length - 1; i > 0; i--) {
        const j = randInt(i + 1, rng);
        const tmp = types[i];
        types[i] = types[j];
        types[j] = tmp;
      }
      let idx = 0;
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++) if (grid[r][c] !== null) grid[r][c] = types[idx++];
      if (findMatches(grid).length === 0 && hasMoves(grid)) return true;
    }
    // 2) fallback: regenerate a fresh match-free board in place (astronomically rare)
    const fresh = makeGrid(size, rng);
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++) if (grid[r][c] !== null) grid[r][c] = fresh[r][c];
    return findMatches(grid).length === 0;
  }

  // Number of distinct gem types. 6 keeps boards solvable and lively.
  const GEM_TYPES = 6;

  return {
    GEM_TYPES,
    randInt,
    makeGrid,
    findMatches,
    findSquares,
    findMatchGroups,
    countMatches,
    hasMoves,
    reshuffle,
  };
});
