// effects.js
// Decoupled Effect Registry, now populated from data/buffs.csv + data/debuffs.csv.
//
// The game loop never hard-codes status behavior. A status is a NAME looked up in
// this registry; the registry's entries are built generically from CSV rows. Columns
// like DamagePerTurn / BlockPerTurn / SkipTurn / DrawBonus are turned into standard
// onApply / onTurnStart hooks automatically. Special-status behavior that can't be
// expressed as data is registered in code via register().
//
// Adding a status = add a row to buffs.csv or debuffs.csv. No JS change.
(function () {
  "use strict";

  const EFFECTS = {};

  function register(def) { EFFECTS[def.id] = def; return def; }
  function registerAll(list) { (list || []).forEach(register); }
  function get(name) { return EFFECTS[name]; }

  // ---------- damage helpers ----------
  function hurt(target, amount) {
    let remaining = Math.max(0, Math.round(amount));
    const absorbed = Math.min(target.block, remaining);
    target.block -= absorbed; remaining -= absorbed;
    const hpLoss = Math.min(target.hp, remaining);
    target.hp -= hpLoss; remaining -= hpLoss;
    return absorbed + hpLoss;
  }
  function rawHurt(target, amount) {
    const d = Math.max(0, Math.round(amount));
    const hpLoss = Math.min(target.hp, d);
    target.hp -= hpLoss; return hpLoss;
  }
  function heal(target, amount) {
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + Math.max(0, Math.round(amount)));
    return target.hp - before;
  }

  // ---------- membership ----------
  function hasBuff(p, n) { return p && p.buffs && p.buffs.indexOf(n) !== -1; }
  function hasDebuff(p, n) { return p && p.debuffs && p.debuffs.indexOf(n) !== -1; }
  function addBuff(p, n) { if (p.buffs.indexOf(n) === -1) p.buffs.push(n); }
  function addDebuff(p, n) { if (p.debuffs.indexOf(n) === -1) p.debuffs.push(n); }
  function removeBuff(p, n) { const i = p.buffs.indexOf(n); if (i !== -1) p.buffs.splice(i, 1); }
  function removeDebuff(p, n) { const i = p.debuffs.indexOf(n); if (i !== -1) p.debuffs.splice(i, 1); }

  // Sum the damage bonus a player currently gets from buffs (e.g. Lit).
  function damageBonusOf(p) {
    let b = 0;
    (p.buffs || []).forEach((n) => { const e = EFFECTS[n]; if (e && e.DamageBonus) b += e.DamageBonus; });
    return b;
  }

  // ---------- invocation ----------
  function apply(name, ctx) {
    ctx.log = ctx.log || [];
    const e = EFFECTS[name];
    if (!e) { ctx.log.push("Unknown effect \"" + name + "\" — extend js/effects.js or data/*.csv."); return false; }
    if (e.onApply) e.onApply(ctx);
    return true;
  }

  // Grant a status to a player, deduped, running onApply on first application.
  function applyStatus(player, kind, name, ctx) {
    if (!player) return;
    if (!EFFECTS[name]) { ctx.log.push("Unknown status \"" + name + "\"."); return; }
    if (kind === "buff") {
      if (hasBuff(player, name)) return;
      addBuff(player, name);
      if (EFFECTS[name].onApply) EFFECTS[name].onApply(ctx);
    } else {
      if (hasDebuff(player, name)) return;
      addDebuff(player, name);
      if (EFFECTS[name].onApply) EFFECTS[name].onApply(ctx);
    }
  }

  function runRoundStart(player, state) {
    const log = state.log;
    const run = (name) => { const e = EFFECTS[name]; if (e && e.onRoundStart) e.onRoundStart({ player, state, log, name }); };
    (player.buffs || []).slice().forEach(run);
  }
  function runRoundEnd(player, state) {
    const log = state.log;
    const run = (name) => { const e = EFFECTS[name]; if (e && e.onRoundEnd) e.onRoundEnd({ player, state, log, name }); };
    (player.debuffs || []).slice().forEach(run);
  }

  // ---------- build effects from CSV rows ----------
  function fromRow(row, kind) {
    const id = row.Name || row.meta.Name || ("status" + Math.random().toString(36).slice(2));
    const def = {
      id: id, kind: kind,
      icon: row.Icon || "\u2022", color: row.Color || "#888",
      desc: row.Desc || "",
      DamageBonus: row.DamageBonus || 0,
      DrawBonus: row.DrawBonus || 0,
      // Exposed so the UI can show what a status does / project round-start effects.
      BlockPerTurn: row.BlockPerTurn || 0,
      HealPerTurn: row.HealPerTurn || 0,
      DamagePerTurn: row.DamagePerTurn || 0,
    };
    if (kind === "buff") {
      def.onApply = function (ctx) {
        if (row.DrawBonus) ctx.player.drawBonus += row.DrawBonus;
        ctx.log.push(ctx.player.name + " is " + id + ".");
      };
      // Buffs recover at the start of the round's reveal (Block / HP).
      def.onRoundStart = function (ctx) {
        if (row.BlockPerTurn) { ctx.player.block += row.BlockPerTurn; ctx.log.push(ctx.player.name + " is " + id + ": +" + row.BlockPerTurn + " Block (now " + ctx.player.block + ")."); }
        if (row.HealPerTurn) { const h = heal(ctx.player, row.HealPerTurn); if (h > 0) ctx.log.push(ctx.player.name + " is " + id + ": +" + h + " HP."); }
      };
    } else {
      def.onApply = function (ctx) {
        if (row.SkipTurn) ctx.player.turnLost += 1;
        if (row.LoseBlock) ctx.player.frozen = true;
        if (row.DrawPenalty) ctx.player.handReduced += row.DrawPenalty;
        if (row.ImmediateDamage) { const d = rawHurt(ctx.player, row.ImmediateDamage); if (d > 0) ctx.log.push(ctx.player.name + " is " + id + ": " + d + " damage."); }
        ctx.log.push(ctx.player.name + " is " + id + ".");
      };
      // Debuffs tick (DoT) at the end of the round, ignoring Block.
      def.onRoundEnd = function (ctx) {
        if (row.DamagePerTurn) { const d = rawHurt(ctx.player, row.DamagePerTurn); if (d > 0) ctx.log.push(ctx.player.name + " suffers " + id + ": " + d + " damage (ignores Block)."); }
      };
    }
    return def;
  }
  function fromData(buffs, debuffs) {
    const list = [];
    (buffs || []).forEach((r) => { if (r.Name) list.push(fromRow(r, "buff")); });
    (debuffs || []).forEach((r) => { if (r.Name) list.push(fromRow(r, "debuff")); });
    registerAll(list);
    return list;
  }

  window.HS2 = window.HS2 || {};
  window.HS2.effects = {
    EFFECTS, register, registerAll, get, fromData, fromRow,
    apply, applyStatus, runRoundStart, runRoundEnd,
    hurt, rawHurt, heal,
    hasBuff, hasDebuff, addBuff, addDebuff, removeBuff, removeDebuff, damageBonusOf,
  };
})();
