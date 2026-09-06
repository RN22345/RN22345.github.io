// game.js
// The rule engine: game state, setup, the PLAN phase, and locking. The actual
// simultaneous RESOLUTION lives in resolution.js. This module knows nothing about
// the network; it is the authoritative state the host owns. The controller drives
// it for local (hot-seat + AI) games and for P2P (host authoritative; clients submit
// their locked plan through applyPayload).
//
// Phases: 'setup' -> 'planning' -> ('lock' per player) -> 'reveal' -> next round.
//   * Planning is SECRET and SIMULTANEOUS: each player packs a Finger Line, aims
//     cards with Crew Marks, gambles Trigger Thumbs (renamed Fate Bones), arms
//     Contraband; everyone locks, then ALL lines flip and resolve at once.
(function () {
  "use strict";

  const C = () => HS2.config || HS2.loader.CONFIG_DEFAULTS;
  const E = () => HS2.effects;

  function makePlayer(meta, idx) {
    const cfg = C();
    return {
      index: idx, id: meta.id, name: meta.name || meta.id, type: meta.type === "ai" ? "ai" : "human",
      hp: cfg.START_HP, maxHp: cfg.START_HP, block: 0,
      hand: [], lineSet: [], line: { elements: [], cost: 0, cards: [] },
      lineLimit: cfg.LINE_SIZE, targets: {}, turnInBlock: 0,
      sigil: null, sigilSlot: meta.sigilSlot || 1, sigilBroken: false,
      contraband: [], triggerThumbs: cfg.TRIGGER_THUMBS, thumbsSpend: 0, thumbsEffect: null,
      buffs: [], debuffs: [], pendingCuff: false, bigNext: false,
      turnLost: 0, frozen: false, drawBonus: 0, handReduced: 0,
      dealtTodayTotal: 0, dealtThisRound: 0,
      alive: true, locked: false,
    };
  }

  function newGame(setup) {
    const cfg = setup.config || C();
    HS2.config = cfg;
    const pool = (setup.cards || []).slice();
    const state = {
      phase: "setup", round: 0, heat: cfg.HEAT_START,
      players: setup.players.map((p, i) => makePlayer(p, i)),
      deck: shuffle(pool), spellPool: pool,
      log: [], winner: null, resolved: false, config: cfg,
    };
    state.players.forEach((p) => {
      const meta = setup.players[p.index];
      p.sigil = (setup.sigils || []).find((s) => String(s.ID) === String(meta.sigilId)) || null;
      p.contraband = (meta.contrabandIds || []).map((id) => {
        const def = (setup.contraband || []).find((c) => String(c.ID) === String(id));
        return def ? { def, armed: true, fired: false, passive: def.Class === "Passive" } : null;
      }).filter(Boolean);
    });
    return state;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  function byId(state, id) { return state.players.find((p) => p.id === id) || null; }
  function living(state) { return state.players.filter((p) => p.alive); }
  function livingOpponents(state, actor) { return state.players.filter((p) => p !== actor && p.alive); }
  function cardInHand(player, id) { return player.hand.find((c) => String(c.id) === String(id)); }

  function drawCards(state, player, n) {
    let drawn = 0;
    for (let i = 0; i < (n || 0); i++) {
      if (!state.deck.length) { if (state.spellPool && state.spellPool.length) state.deck = shuffle(state.spellPool); else break; }
      player.hand.push(state.deck.pop());
      drawn++;
    }
    return drawn;
  }

  // ---- line packing (mutates a player's plan) ----
  function recalcLine(player) {
    const m = HS2.packing.mergeInOrder(player.lineSet);
    player.line = { elements: m.elements, cost: m.cost, cards: player.lineSet.slice() };
  }

  function addToLine(player, handCard) {
    if (!handCard) return false;
    if (player.lineSet.indexOf(handCard) !== -1) return false;
    if (player.lineSet.length >= C().MAX_CARDS) return false;
    const cand = player.lineSet.concat([handCard]);
    const cost = HS2.packing.mergeInOrder(cand).cost;
    if (cost > player.lineLimit) return false;
    player.lineSet = cand; recalcLine(player); return true;
  }

  function moveLineCard(player, cardId, dir) {
    const i = player.lineSet.findIndex((c) => String(c.id) === String(cardId));
    const j = i + dir;
    if (i === -1 || j < 0 || j >= player.lineSet.length) return;
    const t = player.lineSet[i]; player.lineSet[i] = player.lineSet[j]; player.lineSet[j] = t;
    recalcLine(player);
  }

  function removeFromLine(player, cardId) {
    player.lineSet = player.lineSet.filter((c) => String(c.id) !== String(cardId));
    delete player.targets[cardId];
    recalcLine(player);
  }

  // ---- Crew Mark targeting (with anti-focus cap) ----
  function markCap(player) {
    let cap = C().CREW_MARK_CAP;
    (player.contraband || []).forEach((c) => { if (c.def.Type === "markCap" && c.passive) cap += c.def.Amount; });
    return cap;
  }

  function setTarget(state, player, cardId, targetId) {
    const target = byId(state, targetId);
    if (!target) return false;
    // Cap how many cards may aim at one wizard.
    const count = Object.values(player.targets).filter((t) => t === targetId).length;
    if (count >= markCap(player)) return false;
    player.targets[cardId] = targetId;
    return true;
  }

  // ---- Trigger Thumbs (renamed Fate Bones) ----
  function setThumbsSpend(player, n) { player.thumbsSpend = Math.max(0, Math.min(player.triggerThumbs, n)); }

  // ---- Contraband arming (one-shots only) ----
  function toggleContraband(player, defId) {
    const item = player.contraband.find((c) => String(c.def.ID) === String(defId) && !c.fired && !c.passive);
    if (item) item.armed = !item.armed;
  }

  // ---- Discard "Turn It In": scrap (+2 Block) or flip (draw 1) ----
  function turnInCard(state, player, cardId, mode) {
    const i = player.hand.findIndex((c) => String(c.id) === String(cardId));
    if (i === -1) return false;
    const card = player.hand.splice(i, 1)[0];
    if (mode === "scrap") { player.turnInBlock += 2; }
    else { drawCards(state, player, 1); }
    return true;
  }

  // ---- locking ----
  // Start a round: reset per-round state, draw hands, enter planning.
  function beginRound(state) {
    const cfg = C();
    state.resolved = false; state.round += 1; state.heat += cfg.HEAT_INCREMENT;
    state.players.forEach((p) => {
      if (!p.alive) return;
      p.block = 0; p.lineSet = []; recalcLine(p); p.targets = {}; p.turnInBlock = 0;
      p.thumbsSpend = 0; p.thumbsEffect = null; p.dealtThisRound = 0; p.locked = false;
      // Stun/Freeze from last round: skip casting / no block.
      p.skipRound = p.turnLost > 0; p.turnLost = Math.max(0, p.turnLost - 1);
      p.noBlock = p.frozen; p.frozen = false;
      p.contraband = p.contraband.filter((c) => !c.fired);
      p.contraband.forEach((c) => { c.armed = true; });
      let lim = cfg.LINE_SIZE;
      if (p.bigNext) { lim = cfg.LINE_SIZE + 2; p.bigNext = false; }
      if (p.pendingCuff) { lim = Math.max(1, lim - 1); p.pendingCuff = false; }
      p.lineLimit = lim;
      if (p.skipRound) state.log.push(p.name + " is stunned — cannot pack this round.");
      // Draw a fresh hand (drawBonus/handReduced from statuses apply here).
      const toDraw = Math.max(0, cfg.HAND_SIZE + p.drawBonus - p.handReduced);
      p.hand = [];
      drawCards(state, p, toDraw);
    });
    state.phase = "planning";
    return state;
  }

  function allLocked(state) { return state.phase === "planning" && living(state).every((p) => p.locked); }
  function allLockedOrDead(state) { return living(state).every((p) => p.locked); }

  // Agent (human/AI) has finished plan -> mark locked. Returns true when all locked.
  function lockPlayer(state, playerId, plan) {
    const p = byId(state, playerId);
    if (!p || p.locked) return allLocked(state);
    if (plan) applyPlan(state, p, plan);
    p.locked = true;
    state.log.push(p.name + " locks in their line.");
    return allLocked(state);
  }

  // P2P: apply a submitted plan (line order, targets, thumbs, armed contraband).
  function applyPlan(state, player, plan) {
    const ids = plan.lineSet || [];
    player.lineSet = ids.map((id) => cardInHand(player, id)).filter(Boolean);
    recalcLine(player);
    player.targets = {};
    Object.keys(plan.targets || {}).forEach((cid) => { player.targets[cid] = plan.targets[cid]; });
    player.thumbsSpend = Math.max(0, Math.min(player.triggerThumbs, plan.thumbsSpend || 0));
    player.contraband.forEach((c) => { if (!c.passive) c.armed = (plan.armed || []).indexOf(String(c.def.ID)) !== -1; });
  }

  // Build a serializable plan snapshot from a player's current state (for P2P client).
  function buildPlan(player) {
    return {
      lineSet: player.lineSet.map((c) => c.id),
      targets: Object.assign({}, player.targets),
      thumbsSpend: player.thumbsSpend,
      armed: player.contraband.filter((c) => c.armed && !c.passive).map((c) => String(c.def.ID)),
    };
  }

  function slotElement(player, slot) {
    const els = player.line.elements;
    if (slot < 1 || slot > C().LINE_SIZE) return "EMPTY";
    return els[slot - 1] || "EMPTY";
  }

  function pickTarget(state, caster, card) {
    if (state.players.length === 2) return livingOpponents(state, caster)[0] || null;
    const alive = livingOpponents(state, caster);
    if (!alive.length) return null;
    let id = card && caster.targets && caster.targets[card.id];
    let found = alive.find((p) => p.id === id);
    if (!found) { found = defaultTarget(state, caster); }
    return found;
  }

  function defaultTarget(state, caster) {
    const alive = livingOpponents(state, caster);
    return alive[0] || null;
  }

  function checkWinner(state) {
    const alive = living(state);
    if (alive.length > 1) return;
    let winner;
    if (alive.length === 1) winner = alive[0];
    else winner = state.players.slice().sort((a, b) => (b.dealtTodayTotal - a.dealtTodayTotal) || (b.hp - a.hp))[0];
    state.winner = winner; state.phase = "gameOver";
    state.log.push(winner.name + " is the last crew standing.");
  }

  function serialize(state) { return JSON.parse(JSON.stringify(state)); }

  // Apply a generic action payload from the network / controller. Returns {ok,state,error}.
  function applyPayload(state, payload) {
    if (!payload || !payload.kind) return { ok: false, state, error: "Malformed action." };
    switch (payload.kind) {
      case "LOCK": {
        const all = lockPlayer(state, payload.playerId, payload.plan);
        return { ok: true, state, allLocked: all };
      }
      case "RESOLVE":
        return { ok: true, state };
      default:
        return { ok: false, state, error: "Unknown action kind: " + payload.kind };
    }
  }

  window.HS2 = window.HS2 || {};
  // The controller provides HS2.cards (deck builder) — see script.js.
  window.HS2.game = {
    makePlayer, newGame, byId, living, livingOpponents,
    drawCards, recalcLine, addToLine, moveLineCard, removeFromLine,
    setTarget, setThumbsSpend, toggleContraband, turnInCard,
    beginRound, allLocked, lockPlayer, applyPlan, buildPlan,
    slotElement, pickTarget, defaultTarget, checkWinner,
    markCap, serialize, applyPayload, shuffle,
  };
})();
