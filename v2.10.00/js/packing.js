// packing.js
// The 8-element Finger Line "packing" cost model (chaining + nesting).
//
//   Chaining: if card A's LAST element equals card B's FIRST element, they overlap
//             and the shared element is counted once.  [FIRE][WATER]+[WATER][WIND]
//             = [FIRE][WATER][WIND]  (3 elements for two cards).
//   Nesting:  if a card's whole element line is a contiguous substring of the
//             packed line, it rides for 0 extra elements.
//
// This is the puzzle at the heart of the round — every player packs up to
// LINE_SIZE (8, or 10 with Big Green) elements' worth of cards, max MAX_CARDS.
(function () {
  "use strict";

  function els(card) { return card.elements || card.els || []; }

  // Largest k such that the last k of `a` equals the first k of `b`.
  function suffixPrefixOverlap(a, b) {
    let best = 0;
    const max = Math.min(a.length, b.length);
    for (let k = 1; k <= max; k++) {
      let ok = true;
      for (let i = 0; i < k; i++) { if (a[a.length - k + i] !== b[i]) { ok = false; break; } }
      if (ok) best = k;
    }
    return best;
  }

  // Is `sub` a contiguous subsequence of `line`?
  function isContiguous(line, sub) {
    const n = line.length, m = sub.length;
    if (m === 0) return true;
    if (m > n) return false;
    for (let s = 0; s + m <= n; s++) {
      let ok = true;
      for (let i = 0; i < m; i++) { if (line[s + i] !== sub[i]) { ok = false; break; } }
      if (ok) return true;
    }
    return false;
  }

  // Cost to place `card` after the existing `line`. Returns added cost + merged line.
  function place(line, card) {
    const el = els(card);
    if (isContiguous(line, el)) return { added: 0, merged: line }; // nest -> free
    const o = suffixPrefixOverlap(line, el);                        // chain
    const cost = el.length - o;
    return { added: cost, merged: line.concat(el.slice(o)) };
  }

  // Merge a SPECIFIC ordered list of cards into one line + cost. The player controls
  // placement order (needed to aim a chain element onto their Sigil slot).
  function mergeInOrder(cards) {
    let line = [];
    cards.forEach((c) => { line = place(line, c).merged; });
    return { elements: line, cost: line.length };
  }

  // Cheapest cost over every ordering (used by AI + cost previews).
  function minPackCost(cards) {
    return buildLine(cards).cost;
  }

  // Find the best ordering and its merged line + cost.
  function buildLine(cards) {
    if (!cards.length) return { order: [], elements: [], cost: 0 };
    let best = null;
    const rec = (used, cost, line, order) => {
      if (used.length === cards.length) {
        if (!best || cost < best.cost) best = { cost, elements: line.slice(), order: order.slice() };
        return;
      }
      if (best && cost > best.cost) return; // prune: cost never decreases
      for (let i = 0; i < cards.length; i++) {
        if (used.indexOf(i) !== -1) continue;
        const r = place(line, cards[i]);
        rec(used.concat(i), cost + r.added, r.merged, order.concat(cards[i].id));
      }
    };
    rec([], 0, [], []);
    return best;
  }

  // Greedy "best value" pack within a budget (for AI): returns an ordered list.
  function packGreedy(hand, budget, maxCards) {
    let line = [], lineset = [], cost = 0;
    const pool = hand.slice();
    for (let i = 0; i < maxCards; i++) {
      let best = null, bestScore = -Infinity, bestMerged = null, bestAdd = 0;
      for (const c of pool) {
        const r = place(line, c);
        if (cost + r.added > budget) continue;
        const val = (c.attributes.Damage || 0) + (c.attributes.Block || 0) * 0.6 + (c.attributes.Heal || 0) * 0.5 + (c.attributes.Draw || 0) * 0.6;
        const score = r.added === 0 ? val * 2 : val / r.added;
        if (score > bestScore) { bestScore = score; best = c; bestMerged = r.merged; bestAdd = r.added; }
      }
      if (!best) break;
      lineset.push(best);
      line = bestMerged; cost += bestAdd;
      pool.splice(pool.indexOf(best), 1);
    }
    return { order: lineset, elements: line, cost };
  }

  window.HS2 = window.HS2 || {};
  window.HS2.packing = { place, isContiguous, suffixPrefixOverlap, mergeInOrder, minPackCost, buildLine, packGreedy, els };
})();
