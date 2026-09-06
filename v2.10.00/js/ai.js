// ai.js
// A simple AI that plans a round the same way a human would: turn in a dead card,
// pack its Finger Line greedily within the 8/10-element budget, aim each card at the
// weakest rival (respecting the Crew Mark cap), gamble a Trigger Thumb when losing,
// and arm its active Contraband.
(function () {
  "use strict";

  const C = () => HS2.config || HS2.loader.CONFIG_DEFAULTS;

  function pickTarget(state, player, opps) {
    const cap = HS2.game.markCap(player);
    const sorted = opps.slice().sort((a, b) => a.hp - b.hp);
    // Prefer the lowest-HP wizards, but avoid everyone dog-piling the first
    // opponent on round one. Spread marks across equally-healthy targets by
    // choosing the one already carrying the fewest global Crew Marks.
    const lowestHp = sorted.length ? sorted[0].hp : null;
    const pool = lowestHp == null ? sorted : sorted.filter((o) => o.hp === lowestHp);
    const focus = {};
    state.players.forEach((q) => Object.values(q.targets || {}).forEach((tid) => { focus[tid] = (focus[tid] || 0) + 1; }));
    pool.sort((a, b) => (focus[a.id] || 0) - (focus[b.id] || 0));
    for (const o of pool) {
      const used = Object.keys(player.targets).filter((k) => player.targets[k] === o.id).length;
      if (used < cap) return o;
    }
    return sorted[0] || null;
  }

  function planAI(state, player) {
    if (player.type !== "ai" || !player.alive) return;
    const cfg = state.config;

    // Reset the plan.
    player.lineSet = []; HS2.game.recalcLine(player); player.targets = {}; player.thumbsSpend = 0;

    // Optionally scrap a low-value card for +2 Block (keep if hand is thin).
    const value = (c) => (Number(c.attributes.Damage) || 0) + (Number(c.attributes.Block) || 0) + (Number(c.attributes.Heal) || 0) + (Number(c.attributes.Draw) || 0);
    let worst = null;
    player.hand.forEach((c) => { if (!worst || value(c) < value(worst)) worst = c; });
    if (value(worst) === 0 && player.alive) HS2.game.turnInCard(state, player, worst.id, "scrap");

    // Pack greedily within budget.
    const pack = HS2.packing.packGreedy(player.hand, player.lineLimit, cfg.MAX_CARDS);
    player.lineSet = pack.order; HS2.game.recalcLine(player);

    // Aim each card.
    const opps = HS2.game.livingOpponents(state, player);
    player.lineSet.forEach((card) => {
      const scope = String(card.attributes.Target || "enemy").toLowerCase();
      if (scope === "all" || scope === "self") return;
      const t = pickTarget(state, player, opps);
      if (t) player.targets[card.id] = t.id;
    });

    // Gamble a Trigger Thumb when behind, sometimes anyway.
    if (player.triggerThumbs > 0) {
      if (player.hp <= player.maxHp * 0.5) player.thumbsSpend = Math.min(1, player.triggerThumbs);
      else if (Math.random() < 0.3) player.thumbsSpend = Math.min(1, player.triggerThumbs);
    }

    // Arm all active one-shots.
    player.contraband.forEach((c) => { if (!c.passive) c.armed = true; });
  }

  window.HS2 = window.HS2 || {};
  window.HS2.ai = { planAI };
})();
