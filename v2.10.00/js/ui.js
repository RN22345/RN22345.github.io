// ui.js
// Dynamic renderer. Screens: lobby (P2P connect), setup (sigil/slot/contraband),
// plan (Finger Line packer), reveal/board, victory, and a reference codex. Cards are built by
// iterating their metadata so new CSV columns render automatically.
(function () {
  "use strict";

  const EL_ICON = { FIRE: "\u{1F525}", WATER: "\u{1F4A7}", WIND: "\u{1F32A}\uFE0F", STONE: "\u{1FAA8}" };
  const EL_COLOR = { FIRE: "#ff5a3c", WATER: "#3ca7ff", WIND: "#37d67a", STONE: "#b08a5a" };

  function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function esc(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
  function btn(label, className, onClick) { const b = el("button", className, label); if (onClick) b.addEventListener("click", onClick); return b; }
  function chip(text, className, title) { const c = el("span", "chip " + (className || ""), text); if (title) c.title = title; return c; }
  function select(options, value, onChange, className) {
    const s = el("select", className || "");
    options.forEach((o) => { const opt = document.createElement("option"); opt.value = o.value; opt.textContent = o.label; if (String(o.value) === String(value)) opt.selected = true; s.append(opt); });
    if (onChange) s.addEventListener("change", () => onChange(s.value));
    return s;
  }
  function elementBadge(elm) {
    const b = el("span", "element-badge", EL_ICON[elm] || "?");
    b.style.setProperty("--el-color", EL_COLOR[elm] || "#888"); b.title = elm; return b;
  }
  function statusTag(name, kind) {
    const e = HS2.effects.get(name);
    const tag = el("span", "tag " + (kind === "buff" ? "buff" : "debuff"), (e ? e.icon : "?") + " " + name);
    if (e) { tag.style.borderColor = e.color; tag.title = e.desc; }
    return tag;
  }

  // Accent colour for a card so cards are identifiable at a glance even before
  // they're packed (addresses "no colour until placed"). Falls back from the first
  // element, then a keyword, then null (neutral).
  const KW_ACCENT = { Damage: "#ff5a3c", Defend: "#3ca7ff", Status: "#ffd447", Utility: "#37d67a", Support: "#ff8a5c", AoE: "#b06bff", Fire: "#ff5a3c", Water: "#3ca7ff", Wind: "#37d67a", Stone: "#b08a5a" };
  function cardAccent(card) {
    const el0 = (card.elements || [])[0];
    if (el0 && EL_COLOR[el0]) return EL_COLOR[el0];
    const kw = (card.keywords || [])[0];
    if (kw && KW_ACCENT[kw]) return KW_ACCENT[kw];
    return null;
  }

  // Brand header: shows the asset logo (assets/logo.png) beside the wordmark.
  // Falls back to the text title by removing the <img> if the file is missing.
  function brandHeader() {
    const wrap = el("div", "brand");
    const img = el("img", "brand-logo");
    img.src = "assets/logo.png";
    img.alt = "Hood Sorcery";
    img.onerror = function () { if (img.parentNode && img.parentNode.removeChild) img.parentNode.removeChild(img); };
    wrap.append(img);
    wrap.append(el("h1", "title", "HOOD SORCERY"));
    return wrap;
  }

  function renderCard(card, opts) {
    opts = opts || {};
    const node = el("div", "card" + (opts.selected ? " selected" : "") + (opts.packed ? " packed" : "") + (opts.clickable ? " clickable" : ""));
    const attr = card.attributes || {};
    const accent = cardAccent(card);
    if (accent) node.style.setProperty("--card-accent", accent);
    const head = el("div", "card-head");
    head.append(el("div", "card-name", card.name));
    const typeTag = el("span", "typetag", card.type);
    typeTag.style.background = "#7d5ce0";
    head.append(typeTag);
    node.append(head);

    if (card.elements && card.elements.length) { const e = el("div", "card-els"); card.elements.forEach((x) => e.append(elementBadge(x))); node.append(e); }

    // Numeric stats
    const stats = el("div", "card-stats");
    ["Damage", "Block", "Heal", "Draw"].forEach((k) => { const v = attr[k]; if (v != null && v !== 0 && v !== "0") stats.append(chip(k + " " + v, "stat")); });
    if (stats.children.length) node.append(stats);

    // Statuses + keywords
    const tags = el("div", "status-tags");
    (card.buffs || []).forEach((b) => tags.append(statusTag(b, "buff")));
    (card.debuffs || []).forEach((b) => tags.append(statusTag(b, "debuff")));
    (card.keywords || []).forEach((k) => tags.append(chip(k, "kw")));
    if (tags.children.length) node.append(tags);

    // Meaningful one-off chips (Target / Splash / Rarity) — shown only when they
    // actually matter, instead of a raw "Splash: 0" / "Target: enemy" dump.
    const extra = el("div", "card-extra");
    const scope = String(card.attributes.Target || "enemy").toLowerCase();
    if (scope === "all") extra.append(chip("AoE", "kw"));
    else if (scope === "self") extra.append(chip("self", "kw"));
    const splash = Number(card.attributes.Splash) || 0;
    if (splash > 0) extra.append(chip("Splash " + splash, "kw"));
    const rarity = String(card.attributes.Rarity || "").trim();
    if (rarity && rarity.toLowerCase() !== "common") extra.append(chip(rarity, "rarity " + rarity.toLowerCase()));
    if (extra.children.length) node.append(extra);

    // Remaining dynamic metadata chips (schema-agnostic) — noise fields excluded.
    // "Flavor" is rendered as the italic quote below, not as a "Flavor: ..." chip.
    const HIDDEN = ["Damage", "Block", "Heal", "Draw", "Element", "Elements", "Buffs", "Debuffs", "Keywords", "Splash", "Target", "Rarity", "Flavor"];
    const metaKeys = Object.keys(attr).filter((k) => HIDDEN.indexOf(k) === -1);
    if (metaKeys.length) {
      const m = el("div", "meta-keys");
      metaKeys.forEach((k) => { const v = attr[k]; const vs = Array.isArray(v) ? v.join(", ") : v; if (v == null || vs === "") return; m.append(chip(esc(k) + ": " + esc(vs), "meta")); });
      if (m.children.length) node.append(m);
    }
    if (card.meta && card.meta["Flavor"]) node.append(el("div", "flavor", card.meta["Flavor"]));
    if (opts.onClick) node.addEventListener("click", opts.onClick);
    return node;
  }

  // ---------------- LOBBY (P2P connect) ----------------
  function renderLobby(root, cfg) {
    clear(root);
    const app = el("div", "lobby");
    app.append(brandHeader());
    app.append(el("div", "subtitle", "serverless · P2P · simultaneous casting"));
    const bar = el("div", "statusbar");
    bar.append(chip(cfg.status || "idle", "phase"));
    if (cfg.code) bar.append(chip("Code: " + cfg.code, "heat"));
    bar.append(chip(cfg.cardCount + " cards · " + cfg.buffCount + " buffs · " + cfg.debuffCount + " debuffs", "muted"));
    app.append(bar);
    if (cfg.error) app.append(el("div", "banner error", cfg.error));

    const panel = el("div", "panel");
    panel.append(el("div", "label", "Your street name"));
    const nameInput = el("input", "text"); nameInput.type = "text"; nameInput.placeholder = "e.g. Ember Saint"; panel.append(nameInput);
    app.append(panel);

    const actions = el("div", "actions");
    actions.append(btn("Host Game", "btn primary", () => cfg.onHost(nameInput.value || "Host")));
    const joinWrap = el("div", "join-wrap");
    joinWrap.append(el("div", "label", "…or join a game"));
    const codeInput = el("input", "text"); codeInput.type = "text"; codeInput.placeholder = "paste game code / Peer ID"; joinWrap.append(codeInput);
    joinWrap.append(btn("Connect", "btn", () => cfg.onJoin(codeInput.value, nameInput.value || "Player")));
    actions.append(joinWrap);
    if (cfg.onSolo) actions.append(btn("Local Match (vs AI)", "btn", cfg.onSolo));
    app.append(actions);

    if (cfg.role && cfg.roster && cfg.roster.length) {
      const room = el("div", "panel room");
      room.append(el("div", "label", "Your crew"));
      if (cfg.role === "host") room.append(el("div", "code-big", "Share code: " + cfg.code));
      else room.append(el("div", "muted", "Connected. Waiting for the host to start…"));
      const list = el("div", "roster-list");
      cfg.roster.forEach((p) => { const r = el("div", "roster-row"); r.append(chip(p.name, "muted")); if (p.id === cfg.selfId) r.append(chip("you", "good")); if (p.left) r.append(chip("left", "bad")); if (p.connected === false) r.append(chip("disconnected", "heat")); list.append(r); });
      room.append(list);
      if (cfg.role === "host") {
        if (cfg.roster.length >= 2) room.append(btn("Start Game", "btn primary big", cfg.onStart));
        else room.append(el("div", "muted small", "Need at least 2 players to start."));
      }
      app.append(room);
    }
    root.append(app);
  }

  // ---------------- SETUP (sigil / slot / contraband) ----------------
  // cfg = { players:[{name,type,sigilId,sigilSlot,contrabandIds}], sigils, contraband,
  //         config, onStart(), onChange() }
  function renderSetup(root, cfg) {
    clear(root);
    const app = el("div", "board");
    app.append(brandHeader());
    app.append(el("div", "subtitle", "Set up each wizard — Sigil, finger slot, and two Contraband."));

    const cfgPanel = el("div", "panel");
    cfgPanel.append(el("div", "label", "Playtest config"));
    const cfgGrid = el("div", "config-grid");
    Object.keys(cfg.config || {}).sort().forEach((key) => {
      const row = el("div", "config-input-row");
      const lab = el("label", "muted small", key);
      const input = el("input", "config-input");
      input.type = "number";
      input.value = (cfg.config[key] != null ? cfg.config[key] : "");
      input.addEventListener("input", () => {
        const v = Number(input.value);
        if (cfg.onConfig && Number.isFinite(v)) cfg.onConfig(key, v);
      });
      row.append(lab, input);
      cfgGrid.append(row);
    });
    cfgPanel.append(cfgGrid);
    if (cfg.onResetConfig) cfgPanel.append(btn("Reset config to defaults", "btn small ghost", cfg.onResetConfig));
    cfgPanel.append(el("div", "muted small", "Knobs apply to the next match. Import/export below keeps this session's data in memory."));
    app.append(cfgPanel);

    const dataPanel = el("div", "panel");
    dataPanel.append(el("div", "label", "Data files (CSV)"));
    const dataActions = el("div", "opts-row");
    [["cards", "cards.csv"], ["buffs", "buffs.csv"], ["debuffs", "debuffs.csv"], ["sigils", "sigils.csv"], ["contraband", "contraband.csv"], ["config", "config.csv"]].forEach((pair) => {
      const kind = pair[0], file = pair[1];
      const label = el("span", "muted small", file + ":");
      dataActions.append(label);
      dataActions.append(btn("Export", "btn small ghost", () => { if (cfg.onExport) cfg.onExport(kind); }));
      const imp = el("input", "file-import");
      imp.type = "file"; imp.accept = ".csv,text/csv";
      imp.addEventListener("change", () => {
        const f = imp.files && imp.files[0];
        if (f && cfg.onImport) cfg.onImport(kind, f);
        imp.value = "";
      });
      dataActions.append(imp);
    });
    dataPanel.append(dataActions);
    dataPanel.append(el("div", "muted small", "Exports current tables as CSV. Imports are session-only; use them before starting a match."));
    app.append(dataPanel);

    const setup = el("div", "players-setup");
    let waitingRemotes = 0;
    cfg.players.forEach((p, i) => {
      const card = el("div", "player-setup-card");
      card.append(el("div", "label", "Wizard " + (i + 1)));
      if (p.remote) {
        // Remote human wizards self-serve on their own device; the host only watches.
        card.append(el("div", "muted", p.name + " (remote wizard \u2014 self-serve loadout)"));
        if (p.setupReady) card.append(chip("loadout received", "good"));
        else { card.append(chip("waiting for their loadout", "heat")); waitingRemotes++; }
        card.append(el("div", "muted small", "They pick their own Sigil / slot / Contraband on their screen. If you start before they send it, a random loadout is used so the game never stalls."));
      } else {
        // name + type
        const row1 = el("div", "setup-row");
        const name = el("input", "text"); name.type = "text"; name.value = p.name; name.placeholder = "Name";
        name.addEventListener("input", () => { p.name = name.value; cfg.onChange(); });
        const type = select([{ value: "human", label: "Human" }, { value: "ai", label: "AI" }], p.type, (v) => { p.type = v; cfg.onChange(); });
        row1.append(name, type);
        card.append(row1);
        // sigil + slot
        const row2 = el("div", "setup-row");
        const sigilSel = select(cfg.sigils.map((s) => ({ value: String(s.ID), label: String(s.Name) })), p.sigilId, (v) => { p.sigilId = v; cfg.onChange(); });
        row2.append(chip("Sigil", "muted"), sigilSel);
        const slotSel = select(Array.from({ length: cfg.config.LINE_SIZE }, (_, k) => ({ value: String(k + 1), label: "Slot " + (k + 1) })), p.sigilSlot, (v) => { p.sigilSlot = v; cfg.onChange(); });
        row2.append(slotSel);
        card.append(row2);
        if (p.sigilId) { const s = cfg.sigils.find((x) => String(x.ID) === String(p.sigilId)); if (s) card.append(el("div", "muted small", (s.Icon || "") + " " + s.Desc)); }
        // contraband (pick 2)
        const row3 = el("div", "setup-row");
        const cbSel = select(cfg.contraband.map((c) => ({ value: String(c.ID), label: (c.Icon || "") + " " + c.Name + " (" + c.Class + ")" })), p.contrabandIds[0], (v) => { p.contrabandIds[0] = v; cfg.onChange(); });
        const cbSel2 = select(cfg.contraband.map((c) => ({ value: String(c.ID), label: (c.Icon || "") + " " + c.Name + " (" + c.Class + ")" })), p.contrabandIds[1], (v) => { p.contrabandIds[1] = v; cfg.onChange(); });
        row3.append(chip("Contraband", "muted"), cbSel, cbSel2);
        card.append(row3);
        const descs = p.contrabandIds.map((id) => { const c = cfg.contraband.find((x) => String(x.ID) === String(id)); return c && c.Desc; }).filter(Boolean);
        if (descs.length) card.append(el("div", "muted small", descs.join(" · ")));
      }
      setup.append(card);
    });
    app.append(setup);
    if (waitingRemotes > 0) app.append(el("div", "banner", "\u23F3 " + waitingRemotes + " remote wizar" + (waitingRemotes === 1 ? "d" : "ds") + " ha" + (waitingRemotes === 1 ? "s" : "ve") + "n't sent a loadout yet \u2014 they'll get a random one if you start now."));
    const actions = el("div", "actions");
    if (cfg.onAddAi && cfg.players.length < cfg.config.MAX_PLAYERS) actions.append(btn("+ Add AI Wizard", "btn", cfg.onAddAi));
    actions.append(btn("Start Match", "btn primary big", cfg.onStart));
    app.append(actions);
    root.append(app);
  }

  // ---------------- SELF-SETUP (client picks their own loadout) ----------------
  // cfg = { config, sigils, contraband, self:{sigilId,sigilSlot,contrabandIds}, sent }
  function renderSelfSetup(root, cfg) {
    clear(root);
    const s = cfg.self;
    const app = el("div", "board");
    app.append(brandHeader());
    app.append(el("div", "subtitle", "Pick your own Sigil, finger slot, and two Contraband \u2014 then send it to the host."));
    const card = el("div", "player-setup-card");
    const row2 = el("div", "setup-row");
    const sigilSel = select(cfg.sigils.map((x) => ({ value: String(x.ID), label: String(x.Name) })), s.sigilId, (v) => { s.sigilId = v; });
    row2.append(chip("Sigil", "muted"), sigilSel);
    const slotSel = select(Array.from({ length: cfg.config.LINE_SIZE }, (_, k) => ({ value: String(k + 1), label: "Slot " + (k + 1) })), s.sigilSlot, (v) => { s.sigilSlot = v; });
    row2.append(slotSel);
    card.append(row2);
    if (s.sigilId) { const sig = cfg.sigils.find((x) => String(x.ID) === String(s.sigilId)); if (sig) card.append(el("div", "muted small", (sig.Icon || "") + " " + sig.Desc)); }
    const row3 = el("div", "setup-row");
    const cb1 = select(cfg.contraband.map((c) => ({ value: String(c.ID), label: (c.Icon || "") + " " + c.Name })), s.contrabandIds[0], (v) => { s.contrabandIds[0] = v; });
    const cb2 = select(cfg.contraband.map((c) => ({ value: String(c.ID), label: (c.Icon || "") + " " + c.Name })), s.contrabandIds[1], (v) => { s.contrabandIds[1] = v; });
    row3.append(chip("Contraband", "muted"), cb1, cb2);
    card.append(row3);
    const descs = s.contrabandIds.map((id) => { const c = cfg.contraband.find((x) => String(x.ID) === String(id)); return c && c.Desc; }).filter(Boolean);
    if (descs.length) card.append(el("div", "muted small", descs.join(" · ")));
    app.append(card);
    const actions = el("div", "actions");
    actions.append(btn(cfg.sent ? "Update loadout" : "Send loadout to host", "btn primary big", cfg.onSend));
    app.append(actions);
    if (cfg.sent) app.append(el("div", "banner", "\u2705 Loadout sent \u2014 the host has it. You can update it until they start."));
    app.append(el("div", "muted small", "The host configures AI / the table; your loadout is yours alone."));
    root.append(app);
  }

  // ---------------- PLAN (Finger Line packer) ----------------
  // view = { state, player, sigil, config, data, onAdd(card), onRemove(cardId), onMove(cardId,dir),
  //          onTarget(cardId,targetId), onThumbs(n), onContraband(defId), onTurnIn(cardId,mode),
  //          onLock(), onClearLine(), timerRemain, opponents, showingLocal }
  function thumbsText(n) {
    if (!n) return "No Trigger Thumbs spent — your casts resolve neutral (no Fate roll).";
    const s = n + " Trigger Thumb" + (n === 1 ? "" : "s");
    return "Spend " + s + ": roll " + n + "d6 — 1 Backfire (cast reflects onto you) · 2 Fizzle (half dmg) · 3–4 Steady · 5 Amp (+2 dmg) · 6 Double (×2).";
  }

  // Projected Block at reveal: empty-slot finger block + round-start buff block
  // (+ any block already set). Block isn't accrued until resolve, so show the preview.
  function projectedBlock(p, cfg) {
    const lineCost = (p.line && p.line.cost) || 0;
    const empty = Math.max(0, (p.lineLimit || cfg.LINE_SIZE) - lineCost);
    const emptyBlock = empty * (cfg.EMPTY_FINGER_BLOCK || 0);
    let buffBlock = 0;
    (p.buffs || []).forEach((name) => { const e = HS2.effects.get(name); if (e && e.BlockPerTurn) buffBlock += e.BlockPerTurn; });
    const total = emptyBlock + buffBlock + (p.block || 0);
    return { empty, emptyBlock, buffBlock, total };
  }

  // A buff/debuff rendered with its description visible (not only on hover).
  function statusDetail(name, kind) {
    const e = HS2.effects.get(name);
    const row = el("div", "status-hud " + (kind === "buff" ? "buff" : "debuff"));
    row.append(el("span", "status-hud-name", (e ? e.icon : "") + " " + name));
    row.append(el("span", "status-hud-desc", (e && e.desc) || ""));
    return row;
  }

  // ---- opponent intel: potential damage I deal + their DoT (last-known state) ----
  function damageOfCard(caster, card, cfg) {
    let dmg = Number(card.attributes.Damage) || 0;
    if (dmg <= 0) return 0;
    dmg += HS2.effects.damageBonusOf(caster);
    if (caster.sigil && caster.sigil.BonusType === "damage" && !caster.sigilBroken &&
        (card.elements || []).indexOf(caster.sigil.Require) !== -1 &&
        HS2.game.slotElement(caster, caster.sigilSlot) === caster.sigil.Require) {
      dmg += Number(caster.sigil.Amount) || 0;
    }
    (caster.contraband || []).forEach((c) => { if (c.passive && c.def.Type === "fireDmg" && (card.elements || []).indexOf("FIRE") !== -1) dmg += Number(c.def.Amount) || 0; });
    return Math.round(dmg * (cfg.DAMAGE_MULTIPLIER || 1));
  }
  function cardTargetFor(state, caster, card) {
    const scope = String(card.attributes.Target || "enemy").toLowerCase();
    if (scope === "all") return "all";
    if (scope === "self") return "self";
    const tid = caster.targets && caster.targets[card.id];
    if (tid) return tid;
    const opps = state.players.filter((o) => o !== caster && o.alive);
    return opps.length ? opps[0].id : null;
  }
  function threatTo(state, caster, targetId, cfg) {
    let t = 0;
    (caster.lineSet || []).forEach((card) => {
      const tgt = cardTargetFor(state, caster, card);
      if (tgt === "all" || tgt === targetId) t += damageOfCard(caster, card, cfg);
    });
    return t;
  }
  function debuffDot(target, cfg) {
    let d = 0;
    (target.debuffs || []).forEach((name) => { const e = HS2.effects.get(name); if (e && e.DamagePerTurn) d += e.DamagePerTurn; });
    return d;
  }
  function renderOpponentIntel(container, p, state, cfg) {
    const opps = state.players.filter((o) => o !== p && (o.alive || o.left));
    if (!opps.length) return;
    const box = el("div", "active-area");
    box.append(el("div", "label", "Opponents \u2014 last known intel"));
    const grid = el("div", "intel-grid");
    opps.forEach((o) => {
      const c = el("div", "intel-card" + (o.left ? " left" : ""));
      const head = el("div", "intel-head");
      head.append(el("span", "intel-name", o.name + (o.left ? " (left)" : "")));
      head.append(el("span", "intel-hp", o.hp + "/" + o.maxHp + " HP"));
      c.append(head);
      c.append(el("div", "meters small", "Block " + o.block + " \u00b7 Thumbs " + o.triggerThumbs + " \u00b7 " + o.hand.length + " in hand"));
      const tags = el("div", "status-tags");
      (o.buffs || []).forEach((b) => tags.append(statusTag(b, "buff")));
      (o.debuffs || []).forEach((b) => tags.append(statusTag(b, "debuff")));
      if (tags.children.length) c.append(tags);
      const cb = el("div", "intel-cb");
      (o.contraband || []).forEach((it) => {
        const st = it.passive ? "gear" : (it.fired ? "used" : (it.armed ? "armed" : "off"));
        cb.append(el("span", "intel-cb-item", (it.def.Icon || "") + " " + it.def.Name + " (" + st + ")"));
      });
      if (cb.children.length) c.append(el("div", "muted small", cb));
      const threat = threatTo(state, p, o.id, cfg);
      const dot = debuffDot(o, cfg);
      c.append(el("div", "intel-threat", (threat ? "You deal \u2248" + threat + " dmg" : "No damage lined up") + (dot ? " \u00b7 them DoT " + dot : "")));
      c.append(el("div", "muted small", "Assuming they have no Block; Thumbs are a gamble."));
      grid.append(c);
    });
    box.append(grid);
    if (opps.some((o) => o.left)) box.append(el("div", "banner error", "One or more wizards left \u2014 their seat is removed."));
    container.append(box);
  }

  // ---- Reference codex (all cards / buffs / debuffs / sigils / contraband) ----
  function statusRefList(rows, kind) {
    const list = el("div", "codex-list");
    (rows || []).forEach((r) => {
      const row = el("div", "codex-item");
      const head = el("div", "codex-item-head", (r.Icon || "") + " " + r.Name);
      head.style.color = r.Color || "";
      row.append(head);
      row.append(el("div", "codex-item-desc", r.Desc || ""));
      const m = el("div", "codex-item-meta");
      ["DamagePerTurn", "BlockPerTurn", "HealPerTurn", "DrawBonus", "DrawPenalty", "SkipTurn", "LoseBlock", "ImmediateDamage", "DamageBonus"].forEach((k) => { if (r[k]) m.append(chip(k.replace(/([A-Z])/g, " $1") + " " + r[k], "meta")); });
      if (m.children.length) row.append(m);
      list.append(row);
    });
    return list;
  }
  function sigilRefList(sigils) {
    const list = el("div", "codex-list");
    (sigils || []).forEach((s) => {
      const row = el("div", "codex-item");
      row.append(el("div", "codex-item-head", (s.Icon || "") + " " + s.Name + " (" + s.BonusType + " +" + s.Amount + ")"));
      row.append(el("div", "codex-item-desc", s.Desc || ""));
      list.append(row);
    });
    return list;
  }
  function contrabandRefList(items) {
    const list = el("div", "codex-list");
    (items || []).forEach((c) => {
      const row = el("div", "codex-item");
      row.append(el("div", "codex-item-head", (c.Icon || "") + " " + c.Name + " \u2014 " + c.Class));
      row.append(el("div", "codex-item-desc", (c.Desc || "") + (c.Element ? " [" + c.Element + "]" : "")));
      list.append(row);
    });
    return list;
  }
  function renderCodex(container, view) {
    const data = view.data;
    if (!data) return;
    const idx = view.codexTab || "cards";
    const box = el("div", "codex");
    box.append(el("div", "label", "Reference \u2014 every card, status, sigil & contraband"));
    const tabs = el("div", "opts-row codex-tabs");
    [["cards", "Cards", data.cards.length], ["buffs", "Buffs", data.buffs.length], ["debuffs", "Debuffs", data.debuffs.length], ["sigils", "Sigils", data.sigils.length], ["contraband", "Contraband", data.contraband.length]].forEach((t) => {
      tabs.append(btn(t[1] + " (" + t[2] + ")", "btn small" + (idx === t[0] ? " active" : ""), () => view.onCodexTab(t[0])));
    });
    box.append(tabs);
    const body = el("div", "codex-body");
    if (idx === "cards") { const g = el("div", "catalog"); data.cards.forEach((c) => g.append(renderCard(c, {}))); body.append(g); }
    else if (idx === "buffs") body.append(statusRefList(data.buffs, "buff"));
    else if (idx === "debuffs") body.append(statusRefList(data.debuffs, "debuff"));
    else if (idx === "sigils") body.append(sigilRefList(data.sigils));
    else if (idx === "contraband") body.append(contrabandRefList(data.contraband));
    box.append(body);
    container.append(box);
  }

  function renderPlan(root, view) {
    clear(root);
    const p = view.player, cfg = view.config, s = view.state;
    const app = el("div", "board");
    app.append(brandHeader());
    const bar = el("div", "header-row");
    const h = el("div", "statusbar");
    h.append(chip("Round " + s.round, "phase"));
    h.append(chip("Heat " + s.heat, "heat"));
    h.append(chip("Planning: " + p.name, "turn"));
    h.append(chip("Line budget " + p.line.cost + "/" + p.lineLimit, p.line.cost > p.lineLimit ? "bad" : "good"));
    h.append(chip("Deck " + (s.deck ? s.deck.length : 0), "muted"));
    if (view.timerRemain != null) {
      const t = view.timerRemain;
      h.append(chip("\u23F1 " + t + "s", "plan-timer " + (t <= 5 ? "bad" : "heat")));
    }
    bar.append(h);
    if (view.onToggleCodex) bar.append(btn(view.codexOpen ? "\u2715 Close reference" : "\u{1F4D6} Reference", "btn ghost small", view.onToggleCodex));
    app.append(bar);

    // Sanity: own HP / Block / statuses / afflictions — was missing during planning.
    const self = el("div", "self-status");
    self.append(chip("HP " + p.hp + "/" + p.maxHp, (p.hp / p.maxHp) <= 0.35 ? "bad" : "good"));
    const pb = projectedBlock(p, cfg);
    let blockChip;
    if (p.noBlock) blockChip = chip("Block 0 (no block)", "bad");
    else if (pb.total > 0) blockChip = chip("Block " + pb.total + (pb.empty ? " (+" + pb.empty + " empty)" : ""), "good");
    else blockChip = chip("Block 0", "muted");
    blockChip.title = "Block you'll have at reveal: " + pb.emptyBlock + " (empty slots × " + cfg.EMPTY_FINGER_BLOCK + ") + " + pb.buffBlock + " (buffs) + " + (p.block || 0) + " (current).";
    self.append(blockChip);
    if (p.skipRound) self.append(chip("stunned", "bad"));
    if (p.noBlock) self.append(chip("no block", "bad"));
    if (p.bigNext) self.append(chip("big line next", "good"));
    if (self.children.length) app.append(self);

    // Visible descriptions for every active buff / debuff / affliction.
    const haveBuffs = (p.buffs || []).length, haveDebuffs = (p.debuffs || []).length;
    if (haveBuffs || haveDebuffs) {
      const stWrap = el("div", "self-status-box");
      stWrap.append(el("div", "label", "Your statuses & afflictions"));
      const stList = el("div", "status-hud-list");
      (p.buffs || []).forEach((b) => stList.append(statusDetail(b, "buff")));
      (p.debuffs || []).forEach((b) => stList.append(statusDetail(b, "debuff")));
      stWrap.append(stList);
      app.append(stWrap);
    }

    if (p.skipRound) {
      const st = el("div", "banner error");
      st.textContent = "You are stunned this round — your line is locked and you cast nothing. Use Lock In to pass.";
      app.append(st);
      app.append(btn("Lock In (stunned — pass)", "btn primary big", view.onLock));
      root.append(app);
      return;
    }

    app.append(el("div", "banner", "Pack your Finger Line. Chain/nest to fit more — reveal happens all at once."));

    // Sigil slot visual
    if (p.sigil) {
      const slotBox = el("div", "sigil-box");
      slotBox.append(chip(p.sigil.Icon + " " + p.sigil.Name + " @ slot " + p.sigilSlot, "heat"));
      slotBox.append(el("span", "muted small", (p.sigil.Desc || "")));
      app.append(slotBox);
    }

    // Packed line
    const lineCard = el("div", "active-area");
    lineCard.append(el("div", "label", "Your Finger Line (" + p.line.elements.length + " elements used)"));
    const lineBox = el("div", "line-elements");
    p.line.elements.forEach((e) => lineBox.append(elementBadge(e)));
    if (!p.line.elements.length) lineBox.append(el("span", "muted", "empty — add cards below"));
    lineCard.append(lineBox);
    // packed card list with controls
    if (p.lineSet.length) {
      const packed = el("div", "hand");
      p.lineSet.forEach((card) => {
        const c = renderCard(card, { packed: true });
        const actions = el("div", "card-actions");
        actions.append(btn("\u2190", "btn small", () => view.onMove(card.id, -1)));
        actions.append(btn("\u2192", "btn small", () => view.onMove(card.id, 1)));
        actions.append(btn("\u2715", "btn small danger", () => view.onRemove(card.id)));
        // target selector (Crew Mark) for enemy-targeted cards
        const scope = String(card.attributes.Target || "enemy").toLowerCase();
        if (scope === "enemy" && view.opponents.length) {
          actions.append(select(view.opponents.map((o) => ({ value: o.id, label: "aim " + o.name })), p.targets[card.id], (v) => view.onTarget(card.id, v), "target-select"));
        }
        c.append(actions);
        packed.append(c);
      });
      lineCard.append(packed);
    }
    app.append(lineCard);
    if (view.onClearLine) app.append(btn("Clear line", "btn small ghost", view.onClearLine));

    // Hand
    const handWrap = el("div", "active-area");
    handWrap.append(el("div", "label", "Your hand (" + p.hand.length + " cards) — click a card to pack it"));
    const hand = el("div", "hand");
    p.hand.forEach((card) => hand.append(renderCard(card, { clickable: true, onClick: () => view.onAdd(card) })));
    handWrap.append(hand);
    app.append(handWrap);

    // Trigger Thumbs + Contraband + Turn In
    const opts = el("div", "active-area");
    const row1 = el("div", "opts-row");
    row1.append(chip("Trigger Thumbs (" + p.triggerThumbs + " left) — spend:", "muted"));
    [0, 1, 2].forEach((n) => { if (n <= p.triggerThumbs) row1.append(btn(String(n), "btn small" + (p.thumbsSpend === n ? " active" : ""), () => view.onThumbs(n))); });
    opts.append(row1);
    opts.append(el("div", "hint", thumbsText(p.thumbsSpend)));
    if (p.contraband.length) {
      const row2 = el("div", "opts-row");
      row2.append(chip("Contraband:", "muted"));
      p.contraband.forEach((c) => {
        const b = btn((c.def.Icon || "") + " " + c.def.Name + (c.passive ? " (gear)" : ""), "btn small" + (c.armed ? " active" : ""), () => view.onContraband(String(c.def.ID)));
        row2.append(b);
        const state = c.passive ? "Passive" : (c.armed ? "Armed" : "Disarmed");
        row2.append(el("span", "cb-desc", (c.def.Desc || "") + " [" + state + "]"));
      });
      opts.append(row2);
    }
    const row3 = el("div", "opts-row");
    row3.append(chip("Turn In (discard):", "muted"));
    p.hand.forEach((card) => {
      row3.append(btn(card.name + " \u2192 scrap +2 Blk", "btn small ghost", () => view.onTurnIn(card.id, "scrap")));
      row3.append(btn(card.name + " \u2192 flip draw 1", "btn small ghost", () => view.onTurnIn(card.id, "flip")));
    });
    opts.append(row3);
    if (p.turnInBlock > 0) opts.append(el("div", "hint", "Turned in this round: +" + p.turnInBlock + " Block banked."));
    app.append(opts);

    renderOpponentIntel(app, p, s, cfg);

    // Quick rules / reminder (collapsible)
    const rules = el("details", "rules");
    rules.append(el("summary", "", "? Rules & reminder"));
    const rb = el("div", "rules-body");
    rb.textContent = "Finger Line: chain = last element matches next first (count once) · nest = contiguous run (free). "
      + "Resolve: finger Block \u2192 buff recovery (Hard/Regen) \u2192 Sigils \u2192 active Contraband \u2192 Thumbs \u2192 all Casts \u2192 DoT \u2192 The Heat \u2192 eliminations (last). "
      + "Trigger Thumbs: 1 Backfire (reflect) · 2 Fizzle (half) · 3\u20134 Steady · 5 Amp (+2) · 6 Double (\u00d72). Clean Kit removes the 1. "
      + "The Heat: +" + cfg.HEAT_INCREMENT + "/round, global bleed = floor(heat\u00f7" + cfg.HEAT_GLOBAL_DIVISOR + "); wizards who dealt 0 take extra. "
      + "Turn In: scrap a card for +2 Block, or flip for +1 draw.";
    rules.append(rb);
    app.append(rules);

    app.append(btn("Lock In (commit — everyone reveals together; you can even out early)", "btn primary big", view.onLock));

    if (view.codexOpen && view.data) renderCodex(app, view);

    root.append(app);
  }

  // Debug / bug-report tools: raw state JSON toggle + copy button.
  function renderDebug(container, view) {
    if (!view.onToggleDebug) return;
    container.append(btn((view.debugOpen ? "Hide" : "Show") + " State (debug)", "btn ghost small", view.onToggleDebug));
    if (view.debugOpen) {
      container.append(el("pre", "debug-json", JSON.stringify(view.state, null, 2)));
      if (view.onCopyState) container.append(btn("Copy state JSON (report)", "btn small ghost", view.onCopyState));
    }
  }

  // ---------------- VICTORY ----------------
  // view = { state, selfId, role, code, data, onNextRound(), onReset(), isHost }
  function renderVictory(root, view) {
    clear(root);
    const s = view.state;
    const w = s.winner || {};
    const app = el("div", "board victory");
    app.append(brandHeader());

    const win = el("div", "victory-box");
    win.append(el("div", "victory-trophy", "\u{1F3C6}"));
    win.append(el("h2", "victory-title", (w.name || "A wizard") + " wins!"));
    win.append(el("div", "muted", "Last crew standing after " + s.round + " round" + (s.round === 1 ? "" : "s") + ", holding " + w.hp + " HP."));
    win.append(el("div", "muted small", "Dealt " + w.dealtTodayTotal + " damage across the match."));
    app.append(win);

    // Final standings (winner first, then by damage dealt, then HP).
    const rank = s.players.slice().sort((a, b) => (b.alive - a.alive) || (b.dealtTodayTotal - a.dealtTodayTotal) || (b.hp - a.hp));
    const stands = el("div", "panel standings");
    stands.append(el("div", "label", "Final standings"));
    rank.forEach((pl, i) => {
      const r = el("div", "standings-row");
      const rankNo = el("span", "standings-rank", "#" + (i + 1));
      r.append(rankNo);
      r.append(el("span", "standings-name", pl.name + (pl.id === view.selfId ? " (you)" : "") + (pl.alive ? " \u2713" : " \u2715")));
      r.append(el("span", "standings-meta", pl.hp + " HP \u00b7 " + pl.dealtTodayTotal + " dmg"));
      stands.append(r);
    });
    app.append(stands);

    // Scrollback log so the playtester can review the finish.
    const log = el("div", "log");
    log.append(el("div", "label", "Street log"));
    const list = el("ol", "log-list");
    (s.log || []).slice(-40).forEach((line) => list.append(el("li", "", line)));
    log.append(list);
    app.append(log);

    const actions = el("div", "actions");
    if (view.isHost || view.role === "solo") actions.append(btn("Next Match", "btn primary big", view.onNextRound));
    if (view.isHost || view.role === "solo") actions.append(btn("Reset / Lobby", "btn ghost", view.onReset));
    app.append(actions);
    renderDebug(app, view);
    root.append(app);
  }

  // ---------------- REVEAL / BOARD ----------------
  // view = { state, selfId, role, code, data, onNextRound(), onReset(), onToggleCodex(), isHost }
  function renderBoard(root, view) {
    clear(root);
    const s = view.state;
    // A dedicated victory screen once a single wizard remains.
    if (s.phase === "gameOver") { renderVictory(root, view); return; }
    const app = el("div", "board");
    app.append(brandHeader());
    const bar = el("div", "header-row");
    const h = el("div", "statusbar");
    h.append(chip("Round " + s.round, "phase"));
    h.append(chip("Code " + view.code, "heat"));
    h.append(chip("The Heat: " + s.heat, "heat"));
    bar.append(h);
    if ((view.isHost || view.role === "solo")) bar.append(btn("Reset / Lobby", "btn ghost small", view.onReset));
    app.append(bar);

    const row = el("div", "players-row");
    s.players.forEach((p) => row.append(renderPlayer(p, s, view)));
    app.append(row);

    const banner = el("div", "banner");
    if (s.phase === "gameOver") banner.textContent = "\u{1F3C6} " + s.winner.name + " is the last crew standing.";
    else if (s.phase === "reveal") banner.textContent = "All lines revealed! Resolving…";
    else banner.textContent = "All wizards locked in. Reveal & resolve now.";
    app.append(banner);

    if (s.phase === "gameOver") {
      if ((view.isHost || view.role === "solo")) app.append(btn("Next Match", "btn primary big", view.onNextRound));
    } else if (view.isHost || view.role === "solo") {
      app.append(btn(s.phase === "reveal" ? "Resolve & Next Round" : "Next Round", "btn primary big", view.onNextRound));
    }

    // Log
    const log = el("div", "log");
    log.append(el("div", "label", "Street log"));
    const list = el("ol", "log-list");
    (s.log || []).slice(-40).forEach((line) => list.append(el("li", "", line)));
    log.append(list);
    app.append(log);

    // Reference codex (cards / buffs / debuffs / sigils / contraband).
    if (view.onToggleCodex) app.append(btn(view.codexOpen ? "\u2715 Close reference" : "\u{1F4D6} Reference (cards, buffs, debuffs, sigils, contraband)", "btn ghost", view.onToggleCodex));
    if (view.codexOpen && view.data) renderCodex(app, view);

    renderDebug(app, view);

    root.append(app);
  }

  function renderPlayer(p, s, view) {
    const node = el("div", "player-card" + (p.alive ? "" : " dead") + (p.left ? " left" : "") + (s.phase === "reveal" ? " reveal-pop" : ""));
    if (p.id === view.selfId) node.append(chip("YOU", "good"));
    const pname = el("div", "pname", p.name + (p.alive ? "" : " ✕") + (p.left ? " (left)" : ""));
    node.append(pname);
    const bar = el("div", "bar");
    const fill = el("div", "fill hp" + (p.hp / p.maxHp <= 0.35 ? " low" : ""));
    fill.style.width = Math.max(0, (p.hp / p.maxHp) * 100) + "%";
    bar.append(fill); node.append(bar);
    node.append(el("div", "meters", p.hp + "/" + p.maxHp + " HP · " + p.block + " Block"));

    // Sigil + packed line (revealed)
    if (p.sigil) node.append(el("div", "meters small", "Sigil: " + (p.sigil.Icon || "") + " " + p.sigil.Name + " @slot " + p.sigilSlot));
    const lineCard = el("div", "linebox");
    lineCard.append(el("div", "line-head", "Finger Line (" + p.line.elements.length + "/" + p.lineLimit + ")"));
    const lines = el("div", "line-elements");
    p.line.elements.forEach((e) => lines.append(elementBadge(e)));
    if (!p.line.elements.length) lines.append(el("span", "muted", "no casts"));
    lineCard.append(lines);
    if (p.lineSet.length) {
      const names = el("div", "muted small", (p.line.cards || []).map((c) => c.name).join(" · "));
      lineCard.append(names);
    }
    node.append(lineCard);

    // Statuses
    const st = el("div", "status-tags");
    (p.buffs || []).forEach((b) => st.append(statusTag(b, "buff")));
    (p.debuffs || []).forEach((b) => st.append(statusTag(b, "debuff")));
    if (p.skipRound) st.append(chip("stunned", "debuff"));
    if (st.children.length) node.append(st);
    // Trigger Thumbs + contraband
    node.append(el("div", "meters small", "Thumbs: " + p.triggerThumbs + " · " + p.hand.length + " in hand"));
    return node;
  }

  window.HS2 = window.HS2 || {};
  window.HS2.ui = { renderLobby, renderSetup, renderSelfSetup, renderPlan, renderBoard, renderVictory, renderCard, statusTag };
})();
