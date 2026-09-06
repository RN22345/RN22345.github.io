// script.js
// The controller. The only layer that knows about loader + effects + game +
// resolution + ai + network + ui at once. It is deliberately thin: it routes data,
// kicks off the round pump, and re-renders.
//
// Two ways to play, driven by the SAME engine:
//   * Local  : 2-4 wizards, each Human (hot-seat, pass-and-play) or AI.
//   * P2P    : host is authoritative; connected clients submit their locked plan
//              (LINE lock) and receive the authoritative STATE after the reveal.
//
// Playtest config (data/config.csv) is applied on load and shown on the setup screen.
(function () {
  "use strict";

  const app = {
    root: () => document.getElementById("app"),
    data: null, config: null,
    network: null, role: null, selfId: null, code: null, roster: [],
    gameState: null,
    playersCfg: [],           // authoritative setup list [{id,name,type,sigilId,sigilSlot,contrabandIds}]
    mode: "lobby",            // lobby | setup | play
    status: "idle", error: null,
    codexOpen: false, codexTab: "cards",   // reference sidebar (cards/buffs/debuffs/sigils/contraband)
    plannerId: null,          // whose plan UI is currently shown (local hot-seat)
    waiting: false,
    timerId: null,            // planning countdown handle
    timerDeadline: 0, timerRemain: null, timerRound: 0,
    debugOpen: false,         // show raw STATE JSON (playtester / bugfixer)
    remoteSetups: {},         // host: playerId -> { sigilId, sigilSlot, contrabandIds }
    selfSetup: null,          // client: this wizard's selected loadout
    selfSetupDone: false,     // client: sent loadout to host
  };
  window.HS2 = window.HS2 || {};
  window.HS2.app = app;

  // ---- error surfacing (playtester / bugfixer) ----
  function reportFault(msg) {
    console.error("[hood-sorcery] " + msg);
    const box = document.getElementById("fault");
    if (box) {
      box.hidden = false;
      box.textContent = "⚠ " + msg + " (see console)";
      box.className = "fault";
    }
  }
  function safe(fn, label) {
    try { return fn(); }
    catch (e) { reportFault((label || "step") + " failed: " + (e && e.message ? e.message : e)); return null; }
  }

  const U = () => HS2.ui;

  // ---------- boot ----------
  async function boot() {
    window.addEventListener("error", (ev) => { if (ev && ev.message) reportFault(ev.message); });
    window.addEventListener("unhandledrejection", (ev) => { if (ev && ev.reason) reportFault("Promise rejection: " + (ev.reason && ev.reason.message ? ev.reason.message : ev.reason)); });
    renderLobby();
    try {
      const d = await HS2.loader.loadData();
      app.data = d;
      app.config = d.config;
      HS2.config = d.config;
      HS2.effects.fromData(d.buffs, d.debuffs);
      app.status = "idle";
    } catch (e) {
      app.error = "Could not load data CSVs (" + e.message + "). You must serve this folder over HTTP (GitHub Pages) — opening index.html directly blocks fetch().";
      app.status = "error";
    }
    renderLobby();
  }

  // ---------- lobby ----------
  function renderLobby() {
    U().renderLobby(app.root(), {
      status: app.status, role: app.role, code: app.code, selfId: app.selfId,
      roster: app.roster, error: app.error,
      cardCount: app.data ? app.data.cards.length : 0,
      buffCount: app.data ? app.data.buffs.length : 0,
      debuffCount: app.data ? app.data.debuffs.length : 0,
      onHost: (name) => { app.playersCfg = []; hostGame(name); },
      onJoin: (code, name) => joinGame(code, name),
      onSolo: () => { app.playersCfg = []; gotoSetup("local"); },
      onStart: () => { app.playersCfg = []; gotoSetup("host"); },
    });
  }

  // ---------- setup ----------
  function gotoSetup(origin) {
    app.mode = "setup";
    app.setupOrigin = origin; // 'local' | 'host'
    if (!app.playersCfg.length) {
      if (origin === "host" && app.roster.length) {
        app.playersCfg = app.roster.filter((p) => !p.left).slice(0, app.config.MAX_PLAYERS).map((p, i) => {
          const cfg = defaultCfg(p.id, p.name, "human", i);
          if (p.id !== "host") {
            // Remote human wizards pick their OWN loadout and send it to the host.
            cfg.remote = true;
            const rs = app.remoteSetups[p.id];
            cfg.setupReady = !!rs;
            applyLoadout(cfg, rs || randomLoadout());
          } else { cfg.setupReady = true; }
          return cfg;
        });
      } else {
        app.playersCfg = [defaultCfg("local0", "Wizard 1", "human", 0), defaultCfg("local1", "Wizard 2", "ai", 1)];
        // Auto-randomise non-host loadouts so the host doesn't hand-pick for them.
        app.playersCfg.forEach((c, i) => { if (i > 0) applyLoadout(c, randomLoadout()); });
      }
    }
    // Ask clients to open their own loadout picker (host -> all).
    if (origin === "host" && app.role === "host" && app.network) app.network.broadcast("SETUP_REQUEST", {});
    renderSetup();
  }

  function defaultCfg(id, name, type, i) {
    const sig = app.data.sigils[i % app.data.sigils.length];
    return {
      id, name, type, remote: false, setupReady: false,
      sigilId: sig ? String(sig.ID) : null,
      sigilSlot: 1 + (i % app.config.LINE_SIZE),
      contrabandIds: app.data.contraband.slice(0, 2).map((c) => String(c.ID)),
    };
  }

  // Random loadout (fair for a wizard the host isn't hand-picking for).
  function randomLoadout() {
    const sig = app.data.sigils[Math.floor(Math.random() * app.data.sigils.length)];
    const cb = app.data.contraband.slice().sort(() => Math.random() - 0.5).slice(0, 2).map((c) => String(c.ID));
    return { sigilId: sig ? String(sig.ID) : null, sigilSlot: 1 + Math.floor(Math.random() * app.config.LINE_SIZE), contrabandIds: cb };
  }
  function applyLoadout(cfg, l) {
    if (!l) return;
    if (l.sigilId != null && l.sigilId !== "") cfg.sigilId = String(l.sigilId);
    if (l.sigilSlot != null && l.sigilSlot !== "") cfg.sigilSlot = Number(l.sigilSlot);
    if (Array.isArray(l.contrabandIds)) cfg.contrabandIds = l.contrabandIds.map(String);
  }
  // Host applies a client's self-served loadout to the matching wizard.
  function applyRemoteSetup(playerId, data) {
    if (!data) return;
    app.remoteSetups[playerId] = data;
    const cfg = app.playersCfg.find((c) => String(c.id) === String(playerId));
    if (cfg) { applyLoadout(cfg, data); cfg.setupReady = true; if (app.mode === "setup") renderSetup(); }
  }

  // ---- client self-serve loadout (each wizard configures their own) ----
  function openSelfSetup() {
    if (app.role !== "client") return;
    app.mode = "selfSetup";
    if (!app.selfSetup) {
      const sig = app.data.sigils[Math.floor(Math.random() * app.data.sigils.length)];
      app.selfSetup = {
        sigilId: sig ? String(sig.ID) : null,
        sigilSlot: 1 + Math.floor(Math.random() * app.config.LINE_SIZE),
        contrabandIds: app.data.contraband.slice(0, 2).map((c) => String(c.ID)),
      };
    }
    U().renderSelfSetup(app.root(), {
      config: app.config, sigils: app.data.sigils, contraband: app.data.contraband,
      self: app.selfSetup, sent: app.selfSetupDone,
      onSend: () => submitSelfSetup(),
    });
  }
  function submitSelfSetup() {
    if (app.role !== "client" || !app.network) return;
    app.network.sendSetup({
      sigilId: String(app.selfSetup.sigilId),
      sigilSlot: Number(app.selfSetup.sigilSlot),
      contrabandIds: app.selfSetup.contrabandIds.map(String),
    });
    app.selfSetupDone = true;
    openSelfSetup();
  }

    function renderSetup() {
      U().renderSetup(app.root(), {
        players: app.playersCfg, sigils: app.data.sigils, contraband: app.data.contraband, config: app.config,
        onChange: () => renderSetup(),
        onAddAi: () => addAiPlayer(),
        onStart: () => startMatch(),
        onConfig: (key, value) => { app.config[key] = value; HS2.config = app.config; },
        onResetConfig: () => {
          app.config = HS2.loader.mergeConfig(app.data.rawConfig || []); app.data.config = app.config;
          HS2.config = app.config;
          renderSetup();
        },
        onExport: (kind) => exportDataFile(kind),
        onImport: (kind, file) => importDataFile(kind, file),
      });
    }

    // ---------- CSV export / import (session-only data editing) ----------
    // Each kind maps to a table in app.data and its raw PapaParse rows.
    function rawRowsFor(kind) {
      const map = {
        cards: "rawCards",
        buffs: "rawBuffs",
        debuffs: "rawDebuffs",
        sigils: "rawSigils",
        contraband: "rawContraband",
        config: "rawConfig",
      };
      return app.data[map[kind]] || [];
    }

    function downloadFile(name, text) {
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 0);
    }

    function exportDataFile(kind) {
      const names = {
        cards: "cards.csv", buffs: "buffs.csv", debuffs: "debuffs.csv",
        sigils: "sigils.csv", contraband: "contraband.csv", config: "config.csv",
      };
      const file = names[kind];
      if (!file) return;
      let text;
      if (kind === "config") {
        const rows = Object.keys(app.config).sort().map((k) => ({ Key: k, Value: app.config[k] }));
        text = HS2.loader.toCsv(rows);
      } else {
        text = HS2.loader.toCsv(rawRowsFor(kind));
      }
      downloadFile(file, text);
    }

    function readFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
    }

    async function importDataFile(kind, file) {
      try {
        const text = await readFile(file);
        const rows = HS2.loader.parseCsvText(text);
        const map = {
          cards: (raw) => { app.data.cards = HS2.loader.parseCards(raw); app.data.rawCards = raw; },
          buffs: (raw) => { app.data.buffs = HS2.loader.parseTable(raw); app.data.rawBuffs = raw; },
          debuffs: (raw) => { app.data.debuffs = HS2.loader.parseTable(raw); app.data.rawDebuffs = raw; },
          sigils: (raw) => { app.data.sigils = HS2.loader.parseTable(raw); app.data.rawSigils = raw; },
          contraband: (raw) => { app.data.contraband = HS2.loader.parseTable(raw); app.data.rawContraband = raw; },
          config: (raw) => { app.data.config = HS2.loader.mergeConfig(raw); app.config = app.data.config; HS2.config = app.config; app.data.rawConfig = raw; },
        };
        const apply = map[kind];
        if (!apply) return;
        apply(rows);
        if (kind === "buffs" || kind === "debuffs") HS2.effects.fromData(app.data.buffs, app.data.debuffs);
        // Rebuild any existing setup UI so new sigils/cards/contraband appear.
        if (app.mode === "setup") renderSetup();
      } catch (e) {
        console.error("CSV import failed:", e);
        app.error = "CSV import failed: " + e.message;
        renderSetup();
      }
    }

  function addAiPlayer() {
    if (app.playersCfg.length >= app.config.MAX_PLAYERS) return;
    const i = app.playersCfg.length;
    app.playersCfg.push(defaultCfg("ai" + i, "AI Wizard " + (i + 1), "ai", i));
    renderSetup();
  }

  // ---------- start match (local or host) ----------
  function startMatch() {
    const players = app.playersCfg.filter((p) => p.type === "human" || p.type === "ai").slice(0, app.config.MAX_PLAYERS);
    app.gameState = HS2.game.newGame({ players, cards: app.data.cards, sigils: app.data.sigils, contraband: app.data.contraband, config: app.config });
    app.mode = "play";
    app.waiting = false;
    HS2.game.beginRound(app.gameState);
    if (app.role === "host") {
      const snap = HS2.game.serialize(app.gameState);
      app.network.broadcast("START", { state: snap });
      app.network.broadcast("STATE", { state: snap });
    }
    stepPlanner();
  }

  // ---------- planning pump ----------
  // Plan + lock every AI now; then show the next un-locked HUMAN (local hot-seat) or
  // wait (P2P: host shows its own plan, clients lock via the network).
  function stepPlanner() {
    const s = app.gameState;
    if (!s || s.phase !== "planning") { stopPlanTimer(); renderBoard(); return; }

    // Start / refresh the planning countdown once per round.
    if (app.timerRound !== s.round) { app.timerRound = s.round; startPlanTimer(); }

    // Auto-plan AI players.
    s.players.forEach((p) => {
      if (p.alive && p.type === "ai" && !p.locked) {
        safe(() => HS2.ai.planAI(s, p), "ai plan");

        safe(() => HS2.game.lockPlayer(s, p.id), "ai lock");
      }
    });

    // Host's own human plan, or a local (hot-seat) human, or wait for P2P clients.
    const next = s.players.find((p) => p.alive && p.type === "human" && !p.locked);
    if (!next) { allLockedResolve(); return; }

    if (app.role === "host") {
      // Show host's own plan; remote clients lock independently.
      if (next.id === "host") { app.plannerId = "host"; app.selfId = "host"; renderPlan("host"); }
      else { app.plannerId = null; renderWaiting("the other wizards"); }
    } else if (app.role === null) {
      // Local hot-seat: show the next un-locked human, pass-and-play.
      app.plannerId = next.id; app.selfId = next.id; renderPlan(next.id);
    } else {
      // Client: all humans plan simultaneously; show your own plan if it's you.
      app.plannerId = app.selfId;
      renderPlan(app.selfId);
    }
  }

  function allLockedResolve() {
    const s = app.gameState;
    if (!HS2.game.allLocked(s)) return;
    HS2.sfx.reveal();
    // Wrap resolve so a rules bug never wedges the round.
    if (safe(() => HS2.resolution.resolve(s), "resolve") === null) { s.phase = "reveal"; }
    if (s.phase !== "gameOver") s.phase = "reveal";
    if (s.phase === "gameOver") HS2.sfx.win();
    if (app.role === "host" || app.role === "solo") {
      app.network && app.network.broadcast("STATE", { state: HS2.game.serialize(s) });
    }
    renderBoard();
  }

  // Host fail-safe: lock every un-locked alive wizard (AI auto-planned; humans pass
  // their current line) and reveal. Never lets a disconnected wizard stall the game.
  function forceResolve() {
    const s = app.gameState;
    if (!s || s.phase !== "planning") { renderBoard(); return; }
    stopPlanTimer();
    s.players.forEach((p) => {
      if (!p.alive || p.locked) return;
      if (p.type === "ai") safe(() => HS2.ai.planAI(s, p), "ai plan (force)");
      safe(() => HS2.game.lockPlayer(s, p.id), "lock (force)");
    });
    HS2.sfx.lock();
    allLockedResolve();
  }

  // A wizard left the session: drop them from the game so the round can't block.
  // During planning we broadcast a lightweight PLAYER_LEFT (NOT a full STATE) so
  // clients keep their in-progress plan; the host re-pumps to try to resolve.
  function handlePeerLeft(info) {
    const s = app.gameState;
    if (!s) { if (app.network) app.roster = app.network.roster; renderLobby(); return; }
    const removed = HS2.game.removePlayer(s, info.id);
    if (removed && (app.role === "host" || app.role === "solo")) {
      if (app.network) app.network.broadcast("PLAYER_LEFT", { id: info.id, name: info.name });
      if (s.phase === "planning") { stopPlanTimer(); stepPlanner(); }
      else renderBoard();
    }
  }

  // ---- planning countdown timer (config PLAN_TIMER seconds; 0 = off) ----
  function startPlanTimer() {
    stopPlanTimer();
    const secs = Number(app.config.PLAN_TIMER) || 0;
    if (secs <= 0) { app.timerRemain = null; return; }
    app.timerDeadline = Date.now() + secs * 1000;
    app.timerRemain = secs;
    app.timerId = setInterval(planTimerTick, 250);
  }
  function stopPlanTimer() {
    if (app.timerId) { clearInterval(app.timerId); app.timerId = null; }
  }
  function planTimerTick() {
    const s = app.gameState;
    if (!s || s.phase !== "planning") { stopPlanTimer(); app.timerRemain = null; return; }
    app.timerRemain = Math.max(0, Math.ceil((app.timerDeadline - Date.now()) / 1000));
    // Lightweight live update of the countdown chip only (avoids a full re-render
    // that would steal focus mid-plan).
    try {
      const chip = document.querySelector ? document.querySelector(".plan-timer") : null;
      if (chip) { chip.textContent = "\u23F1 " + app.timerRemain + "s"; chip.className = "chip plan-timer " + (app.timerRemain <= 5 ? "bad" : "heat"); }
    } catch (e) { /* non-DOM harness */ }
    if (app.timerRemain <= 0) autoLockOnTime();
  }
  // Which players this controller can lock on its own (others must send LOCK).
  function locallyControlled(p) {
    if (p.type === "ai") return true;
    if (app.role === null) return true;            // local hot-seat / solo
    if (app.role === "host") return p.id === "host"; // host's own wizard only
    return false;                                  // client — host's problem
  }
  // Timer ran out: lock everything we can (AI auto-planned), then pump.
  function autoLockOnTime() {
    const s = app.gameState;
    if (!s || s.phase !== "planning") return;
    stopPlanTimer();
    s.players.forEach((p) => {
      if (!p.alive || p.locked) return;
      if (!locallyControlled(p)) return;
      if (p.type === "ai") safe(() => HS2.ai.planAI(s, p), "ai plan (timer)");
      safe(() => HS2.game.lockPlayer(s, p.id), "lock (timer)");
    });
    HS2.sfx.lock();
    stepPlanner();
  }

  function renderPlan(playerId) {
    const s = app.gameState;
    const player = HS2.game.byId(s, playerId);
    if (!player) { renderBoard(); return; }
    // In P2P a client plans from its own snapshot copy; the host plans from the live state.
    U().renderPlan(app.root(), {
      state: s, player, config: app.config, data: app.data,
      opponents: HS2.game.livingOpponents(s, player).map((o) => ({ id: o.id, name: o.name })),
      timerRemain: app.timerRemain,
      codexOpen: app.codexOpen, codexTab: app.codexTab,
      onToggleCodex: () => { app.codexOpen = !app.codexOpen; renderPlan(playerId); },
      onCodexTab: (t) => { app.codexTab = t; renderPlan(playerId); },
      onAdd: (card) => { if (HS2.game.addToLine(player, card)) { renderPlan(playerId); } },
      onRemove: (cid) => { HS2.game.removeFromLine(player, cid); renderPlan(playerId); },
      onMove: (cid, dir) => { HS2.game.moveLineCard(player, cid, dir); renderPlan(playerId); },
      onTarget: (cid, tid) => { HS2.game.setTarget(s, player, cid, tid); renderPlan(playerId); },
      onThumbs: (n) => { HS2.game.setThumbsSpend(player, n); renderPlan(playerId); },
      onContraband: (defId) => { HS2.game.toggleContraband(player, defId); renderPlan(playerId); },
      onTurnIn: (cid, mode) => { HS2.game.turnInCard(s, player, cid, mode); renderPlan(playerId); },
      onClearLine: () => clearLine(playerId),
      onLock: () => commitLock(playerId),
    });
  }

  function clearLine(playerId) {
    const s = app.gameState;
    const player = HS2.game.byId(s, playerId);
    if (!player) return;
    player.lineSet = [];
    HS2.game.recalcLine(player);
    player.targets = {};
    renderPlan(playerId);
  }

  function commitLock(playerId) {
    if (app.role === "client") { app.clientLock(playerId); return; }
    lockLocal(playerId);
  }

  function renderWaiting(name) {
    const root = app.root();
    root.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "board";
    const h = document.createElement("h1"); h.className = "title"; h.textContent = "HOOD SORCERY";
    wrap.append(h);
    const b = document.createElement("div"); b.className = "banner";
    b.textContent = "Waiting for " + name + " to lock in their line…";
    wrap.append(b);
    if (app.role === "host" || app.role === "solo") {
      const fb = document.createElement("button");
      fb.className = "btn primary big"; fb.textContent = "Force reveal & resolve (host)";
      fb.addEventListener("click", () => forceResolve());
      wrap.append(fb);
      const note = document.createElement("div"); note.className = "muted small";
      note.textContent = "If a wizard disconnected or left, this locks their current/empty line and reveals the round so the game can't stall.";
      wrap.append(note);
    }
    root.append(wrap);
  }

  function lockLocal(playerId) {
    const s = app.gameState;
    if (s.phase !== "planning") return;
    HS2.sfx.lock();
    // Local humans (host or hot-seat) commit the plan they built in the live state.
    HS2.game.lockPlayer(s, playerId);
    if (HS2.game.allLocked(s)) { allLockedResolve(); return; }
    // P2P host: wait for clients (do NOT broadcast — clients keep their own plan).
    // Local hot-seat: advance to the next human.
    if (app.role === "host") renderWaiting("other wizards");
    else stepPlanner();
  }

  // ---------- board / next round ----------
  function renderBoard() {
    U().renderBoard(app.root(), {
      state: app.gameState, selfId: app.selfId, role: app.role, code: app.code || "LOCAL",
      data: app.data, codexOpen: app.codexOpen, codexTab: app.codexTab, debugOpen: app.debugOpen,
      isHost: (app.role === "host" || app.role === "solo" || app.role === null),
      onNextRound: () => {
        HS2.game.beginRound(app.gameState);
        if (app.role === "host") { const snap = HS2.game.serialize(app.gameState); app.network.broadcast("STATE", { state: snap }); }
        stepPlanner();
      },
      onReset: () => resetToLobby(),
      onToggleCodex: () => { app.codexOpen = !app.codexOpen; renderBoard(); },
      onCodexTab: (t) => { app.codexTab = t; renderBoard(); },
      onToggleDebug: () => { app.debugOpen = !app.debugOpen; renderBoard(); },
      onCopyState: () => { copyState(); },
    });
  }

  function copyState() {
    if (!app.gameState) return;
    try {
      const text = JSON.stringify(app.gameState);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
      else { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); }
    } catch (e) { console.warn("Copy state failed", e); }
  }

  function resetToLobby() {
    stopPlanTimer();
    app.gameState = null; app.codexOpen = false; app.codexTab = "cards"; app.waiting = false; app.plannerId = null;
    app.timerRemain = null; app.timerRound = 0; app.debugOpen = false;
    app.playersCfg = []; app.remoteSetups = {}; app.selfSetup = null; app.selfSetupDone = false;
    app.mode = "lobby";
    if (app.network && app.network.role === "host") app.network.broadcast("RESET", {});
    if (app.role) { app.roster = app.network.roster; app.selfId = app.network.selfId; app.status = "lobby"; }
    else { app.role = null; app.status = "idle"; }
    renderLobby();
  }

  // ---------- network plumbing ----------
  function wireNetwork() {
    const nw = app.network;
    nw.onStatus = (st) => { app.status = st; renderLobby(); };
    nw.on("ready", () => { app.role = "host"; app.code = nw.code; app.selfId = nw.selfId; app.roster = nw.roster; app.status = "lobby"; renderLobby(); });
    nw.on("joined", () => { app.role = "client"; app.code = nw.code; app.selfId = nw.selfId; app.roster = nw.roster; app.status = "joined"; renderLobby(); });
    nw.on("roster", (r) => { app.roster = r; renderLobby(); });
    nw.on("disconnected", () => { app.status = "disconnected"; renderLobby(); });
    nw.on("peer-left", (info) => { handlePeerLeft(info); });

    // Host is authoritative: it receives START (self no-op), STATE (no-op), ACTION (LOCK).
    nw.on("STATE", (d) => {
      app.gameState = d.state;
      app.config = app.config || d.state.config;
      if (app.role === "client") {
        if (app.gameState.phase === "planning") renderPlan(app.selfId);
        else renderBoard();
      }
    });
    nw.on("START", (d) => {
      app.gameState = d.state; app.mode = "play";
      if (app.role === "client") renderPlan(app.selfId);
    });
    nw.on("ACTION", (payload) => {
      if (app.role !== "host") return;
      const res = HS2.game.applyPayload(app.gameState, payload);
      // Only push a STATE once the reveal happens (all locked). During planning,
      // clients keep their own in-progress plan; broadcasting would clobber it.
      if (res.ok && res.allLocked) allLockedResolve();
    });
    // Client -> host self-served loadout (each wizard picks their own sigil/slot/contraband).
    nw.on("SETUP", (data, fromId) => { if (app.role === "host") applyRemoteSetup(fromId, data); });
    // Host asks clients to open their self-setup screen.
    nw.on("SETUP_REQUEST", () => { if (app.role === "client") openSelfSetup(); });
    // A remote wizard left while we're planning: mark them out WITHOUT clobbering
    // our own in-progress plan.
    nw.on("PLAYER_LEFT", (data) => {
      if (app.role === "client" && app.gameState) {
        HS2.game.removePlayer(app.gameState, data.id);
        if (app.gameState.phase === "planning") renderPlan(app.selfId);
        else renderBoard();
      }
    });
    nw.on("RESET", () => { app.gameState = null; app.role = "client"; app.status = "joined"; renderLobby(); });
  }

  function hostGame(name) {
    if (!app.network) { app.network = new HS2.network.Network(); wireNetwork(); }
    app.role = "host"; app.status = "connecting";
    app.network.hostGame({ name: name || "Host" });
    renderWaiting("broker");
  }
  function joinGame(code, name) {
    if (!app.network) { app.network = new HS2.network.Network(); wireNetwork(); }
    app.role = "client"; app.status = "connecting";
    app.network.joinGame({ peerId: code, name: name || "Player" });
    renderWaiting("broker");
  }

  // P2P client sends its committed plan to the host.
  app.sendLock = function (playerId, plan) {
    if (app.role === "client") app.network.sendAction({ kind: "LOCK", playerId, plan });
  };
  // Called from ui plan Lock when running as a CLIENT.
  app.clientLock = function (playerId) {
    const player = HS2.game.byId(app.gameState, playerId);
    if (player) { HS2.sfx.lock(); app.sendLock(playerId, HS2.game.buildPlan(player)); }
    app.plannerId = null;
    renderWaiting("the reveal");
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
