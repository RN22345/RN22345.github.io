// resolution.js
// The SIMULTANEOUS Reveal -> Resolve pass. All committed Casts fire at the same
// instant; eliminations are only checked at the END of the round, so a wizard who
// cast a lethal spell still resolves it even if they also died this round.
//
// Order (per the SRD): finger/empty block -> buff recovery (Hard/Regen) -> Sigils
// -> active Contraband -> Trigger Thumbs -> ALL Casts -> statuses DoT -> The Heat
// -> eliminations -> winner.
//
// Cards resolve in seat order for the log only — the outcome is order-independent
// because damage is summed and eliminations are checked last.
(function () {
  "use strict";

  const E = () => HS2.effects;
  function num(v) { const n = Number(v); return (v == null || isNaN(n)) ? 0 : n; }
  function slotEl(player) { return HS2.game.slotElement(player, player.sigilSlot); }

  function resolveSigil(state, player, log) {
    if (!player.sigil || player.sigilBroken) return;
    const s = player.sigil, el = slotEl(player);
    if (s.BonusType === "block") {
      const req = s.Require;
      const hit = (req === "EMPTY" && el === "EMPTY") ||
                  (req !== "EMPTY" && req !== "ANY" && el === req);
      if (hit) { player.block += s.Amount; log.push(player.name + " " + s.Name + ": +" + s.Amount + " Block (" + el + " on the slot)."); }
    }
  }

  function rollThumbs(state, player, log) {
    const rolls = [];
    for (let i = 0; i < player.thumbsSpend; i++) rolls.push(1 + Math.floor(Math.random() * 6));
    player.triggerThumbs -= player.thumbsSpend;
    const fx = { amp: 0, double: 0, fizzle: 0, backfire: 0 };
    const labels = [];
    const cleanKit = (player.contraband || []).some((c) => c.passive && c.def.Type === "cleanKit");
    rolls.forEach((r) => {
      if (r === 1 && !cleanKit) { fx.backfire += 1; labels.push("Backfire"); }
      else if (r === 1) { labels.push("Clean"); }
      else if (r === 2) { fx.fizzle += 1; labels.push("Fizzle"); }
      else if (r === 3 || r === 4) { labels.push("Steady"); }
      else if (r === 5) { fx.amp += 1; labels.push("Amp"); }
      else if (r === 6) { fx.double += 1; labels.push("Double"); }
    });
    player.thumbsEffect = fx;
    log.push(player.name + " rolls Trigger Thumbs [" + rolls.join(", ") + "] => " + labels.join(" + ") + ".");
  }

  function fireContraband(state, player, item, log) {
    const cfg = state.config, t = item.def.Type, amt = num(item.def.Amount);
    item.fired = true;
    const target = HS2.game.pickTarget(state, player, null);
    switch (t) {
      case "heal":
        { const h = E().heal(player, amt); if (h > 0) log.push(player.name + " uses " + item.def.Name + ": +" + h + " HP."); }
        break;
      case "block":
        player.block += amt; log.push(player.name + " uses " + item.def.Name + ": +" + amt + " Block.");
        break;
      case "bignext":
        player.bigNext = true; log.push(player.name + " pops " + item.def.Name + ": next round line is " + (cfg.LINE_SIZE + 2) + " elements.");
        break;
      case "damage":
        if (target && target.alive) {
          const d = Math.round(amt * cfg.DAMAGE_MULTIPLIER);
          const dealt = E().hurt(target, d); player.dealtTodayTotal += dealt; player.dealtThisRound += dealt;
          log.push(player.name + " fires " + item.def.Name + " at " + target.name + ": " + dealt + " dmg.");
        }
        break;
      case "aoe":
        HS2.game.livingOpponents(state, player).forEach((o) => {
          const d = Math.round(amt * cfg.DAMAGE_MULTIPLIER);
          const dealt = E().hurt(o, d); player.dealtTodayTotal += dealt; player.dealtThisRound += dealt;
        });
        log.push(player.name + " throws " + item.def.Name + ": " + amt + " dmg to everyone else.");
        break;
      case "shatter":
        if (target) {
          if (target.sigil && !target.sigilBroken) { target.sigilBroken = true; log.push(player.name + " shatters " + target.name + "'s Sigil."); }
          if (target.contraband.length) { target.contraband = []; log.push(player.name + " wastes " + target.name + "'s Contraband."); }
        }
        break;
      default: break;
    }
  }

  function applyThumbsToDamage(caster, dmg) {
    const fx = caster.thumbsEffect || { amp: 0, double: 0, fizzle: 0, backfire: 0 };
    dmg += fx.amp * 2;
    dmg = Math.round(dmg * Math.pow(2, fx.double));
    if (fx.fizzle > 0 && fx.double === 0) dmg = Math.floor(dmg / 2);
    return dmg;
  }

  // Lead Vest passive: -1 damage from single-target spells (min 1).
  function reduceIncoming(target, dmg, singleTarget) {
    if (!singleTarget) return dmg;
    const vest = (target.contraband || []).find((c) => c.passive && c.def.Type === "dmgTaken");
    if (vest) dmg = Math.max(1, dmg - num(vest.def.Amount));
    return dmg;
  }

  function castSpell(state, caster, card, log) {
    const cfg = state.config;
    const target = HS2.game.pickTarget(state, caster, card);

    const scope = String(card.attributes.Target || "enemy").toLowerCase();
    const splash = num(card.attributes.Splash);
    const targets = scope === "all" ? HS2.game.livingOpponents(state, caster)
      : (scope === "self" ? [caster] : (target ? [target] : []));

    // Buffs to caster; debuffs to target(s) — applied whether or not it deals damage.
    (card.buffs || []).forEach((b) => E().applyStatus(caster, "buff", b, { player: caster, state, log }));
    const debuffTargets = scope === "self" ? [caster] : targets;
    (card.debuffs || []).forEach((d) => debuffTargets.forEach((t) => { if (t) E().applyStatus(t, "debuff", d, { player: t, state, log }); }));

    // Only a spell that actually deals damage gets boosted (Amp/Double/Lit/Sigil/etc).
    let dmg = num(card.attributes.Damage);
    if (dmg > 0) {
      dmg += E().damageBonusOf(caster); // Lit etc.
      if (caster.sigil && caster.sigil.BonusType === "damage" && !caster.sigilBroken &&
          card.elements.indexOf(caster.sigil.Require) !== -1 && slotEl(caster) === caster.sigil.Require) {
        dmg += num(caster.sigil.Amount); // Heat Brand
      }
      (caster.contraband || []).forEach((c) => {
        if (c.passive && c.def.Type === "fireDmg" && card.elements.indexOf("FIRE") !== -1) dmg += num(c.def.Amount);
      });
      dmg = applyThumbsToDamage(caster, dmg);
      dmg = Math.round(dmg * cfg.DAMAGE_MULTIPLIER);
    }

    if (dmg > 0 && targets.length) {
      const bone = caster.thumbsEffect || {};
      targets.forEach((t) => {
        if (!t || !t.alive) return;
        let receiver = t, note = "";
        if (bone.backfire) { receiver = caster; note = " (Backfire!)"; }
        else if (t.sigil && t.sigil.BonusType === "reflect" && !t.sigilBroken) {
          receiver = caster; t.sigilBroken = true; note = " (Mirror Brand reflects & shatters)";
        }
        const amount = reduceIncoming(receiver, dmg, scope === "enemy");
        const dealt = E().hurt(receiver, amount);
        caster.dealtTodayTotal += dealt; caster.dealtThisRound += dealt;
        log.push(caster.name + " casts " + card.name + " at " + receiver.name + ": " + dealt + " dmg" + note + ".");
      });
      if (splash > 0) {
        HS2.game.livingOpponents(state, caster).forEach((o) => {
          if (targets.indexOf(o) === -1) {
            const dealt = E().hurt(o, splash);
            caster.dealtTodayTotal += dealt; caster.dealtThisRound += dealt;
            log.push(caster.name + " splashes " + o.name + " for " + dealt + ".");
          }
        });
      }
    }
  }

  function applyHeat(state, player, log) {
    if (!player.alive) return;
    const cfg = state.config;
    const global = Math.floor(state.heat / cfg.HEAT_GLOBAL_DIVISOR);
    let taken = global;
    if (player.dealtThisRound === 0) { taken += state.heat; log.push(player.name + " dealt nothing — the Heat hits hard (" + taken + ")."); }
    else log.push(player.name + " takes the global bleed (" + taken + ", ignores Block).");
    E().rawHurt(player, taken);
  }

  // ---- main resolve ----
  function resolve(state) {
    const log = state.log;
    const cfg = state.config;
    log.push("--- Round " + state.round + " | The Heat is " + state.heat + " ---");

    // 1. Empty-finger Block + buff recovery (Hard/Regen). Freeze seals Block to 0.
    state.players.forEach((p) => {
      if (!p.alive || p.noBlock) { p.block = 0; return; }
      const empty = Math.max(0, p.lineLimit - p.line.cost);
      const fb = empty * cfg.EMPTY_FINGER_BLOCK;
      if (fb > 0) { p.block += fb; log.push(p.name + " finger armor (" + empty + " empty slot" + (empty === 1 ? "" : "s") + "): +" + fb + " Block."); }
    });
    state.players.forEach((p) => { if (p.alive && !p.noBlock) E().runRoundStart(p, state); });

    // 2. Sigils.
    state.players.forEach((p) => { if (p.alive) resolveSigil(state, p, log); });

    // 3. Active Contraband (one-shots).
    state.players.forEach((p) => {
      if (!p.alive) return;
      p.contraband.forEach((c) => { if (c.armed && !c.fired && !c.passive) fireContraband(state, p, c, log); });
    });

    // 4. Trigger Thumbs.
    state.players.forEach((p) => { if (p.alive && p.thumbsSpend > 0) rollThumbs(state, p, log); });

    // 5. ALL Casts simultaneously (seat order for the log only). Stunned players skip.
    state.players.forEach((p) => {
      if (!p.alive || p.skipRound) { if (p.alive) log.push(p.name + " is stunned — casts nothing."); return; }
      p.line.cards.forEach((card) => { if (p.alive) castSpell(state, p, card, log); });
    });

    // 6. Statuses DoT + The Heat.
    state.players.forEach((p) => { if (p.alive) E().runRoundEnd(p, state); });
    state.players.forEach((p) => { if (p.alive) applyHeat(state, p, log); });

    // 7. Eliminations at the END (simultaneous exchange).
    state.players.forEach((p) => { if (p.hp <= 0 && p.alive) { p.alive = false; log.push(p.name + " is taken out."); } });

    HS2.game.checkWinner(state);
    state.resolved = true;
    return log;
  }

  window.HS2 = window.HS2 || {};
  window.HS2.resolution = { resolve };
})();
