// network.js
// Isolated network layer. This file is the ONLY place that talks to PeerJS. It does
// NOT know the game rules. Its single job is to be a PIPE that relays generalized
// JSON "action payloads" (e.g. { type: 'PLAY_CARD', cardId, target }) over a free
// WebRTC peer-to-peer data channel, using the free public PeerJS cloud broker.
//
//             host (authoritative)                       client(s) (thin renderers)
//   ┌──────────────────────────────┐      ┌──────────────────────────────┐
//   │ runs HS2.game, owns state    │      │ sends ACTION payloads up,    │
//   │ broadcasts STATE to all      │ ───▶ │ renders STATE it receives     │
//   └──────────────────────────────┘      └──────────────────────────────┘
//
// Topology: star. Everyone connects to the host; the host is authoritative and
// relays the authoritative STATE snapshot back to everyone. WebRTC data channels
// are peer-to-peer (the broker only handles signaling), so this still uses the
// free public PeerJS cloud for discovery.
//
// Wire messages:
//   { type:'JOIN',    data:{ name } }          client -> host  (presence)
//   { type:'WELCOME', data:{ selfId, role, code, players } }  host -> client
//   { type:'ROSTER',  data:{ players:[{id,name,connected}] } } host -> all
//   { type:'START',   data:{ state } }          host -> all
//   { type:'ACTION',  data:{ kind, playerId, cardId?, targetId? } } client -> host
//   { type:'STATE',   data:{ state } }          host -> all   (authoritative snapshot)
//   { type:'RESET',   data:{} }                 host -> all
//   { type:'CHAT',    data:{ text } }           any -> all
(function () {
  "use strict";

  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const PREFIX = "hood-sorcery-";

  function genCode(len) {
    len = len || 5;
    let s = "";
    for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  function parse(d) {
    if (typeof d === "string") { try { return JSON.parse(d); } catch (e) { return { type: "RAW", data: d }; } }
    if (d && typeof d === "object") return d;
    return { type: "RAW", data: d };
  }

  function resolvePeerId(input) {
    let v = String(input || "").trim();
    if (!v) return null;
    v = v.replace(/\s+/g, "");
    if (v.toLowerCase().indexOf(PREFIX) === 0) v = v.slice(PREFIX.length);
    return PREFIX + v.toLowerCase();
  }

  function Network() {
    this.role = null;        // 'host' | 'client'
    this.peer = null;
    this.peerId = null;
    this.code = null;
    this.conns = [];         // host only: array of { conn, meta }
    this.conn = null;        // client only: DataConnection to host
    this.selfId = null;      // my assigned player id
    this.roster = [];        // [{ id, name, connected }]
    this.handlers = {};      // msg type -> fn(data, fromId)
    this.onStatus = null;    // fn(statusString)
  }

  Network.prototype.on = function (type, fn) { this.handlers[type] = fn; };
  Network.prototype.emit = function (type, data, from) {
    if (this.handlers[type]) this.handlers[type](data, from);
  };
  Network.prototype.setStatus = function (s) { if (this.onStatus) this.onStatus(s); };

  Network.prototype.destroy = function () {
    if (this._hb) clearInterval(this._hb);
    if (this._chb) clearInterval(this._chb);
    if (this.peer) this.peer.destroy();
    this.peer = null;
  };

  // ---------------- HOST ----------------
  Network.prototype.hostGame = function (opts) {
    const self = this;
    this.role = "host";
    this.code = (opts && opts.code) || genCode();
    this.peerId = PREFIX + this.code.toLowerCase();
    this.selfId = "host";
    this.roster = [{ id: "host", name: (opts && opts.name) || "Host", connected: true }];

    // Use the free public PeerJS cloud broker (default 0.peerjs.com).
    const peer = new Peer(this.peerId, { debug: 1 });
    this.peer = peer;

    peer.on("open", function (id) {
      self.peerId = id;
      self.setStatus("host-open");
      self.emit("ready", { role: "host", code: self.code, peerId: id });
    });

    peer.on("connection", function (conn) {
      conn.on("open", function () {
        self.setStatus("client-connected");
        // We wait for the client's JOIN (name) before assigning an id.
      });
      conn.on("data", function (d) { self.handleHostData(conn, d); });
      conn.on("close", function () { self.dropClient(conn); });
      conn.on("error", function () { self.dropClient(conn); });
    });

    peer.on("error", function (err) {
      self.setStatus("error");
      if (opts.onError) opts.onError(err);
    });

    self.startHeartbeat();

    return this;
  };

  // Host heartbeat: ping every conn; drop a client that goes silent (close/error
  // can be missed if the tab dies without a clean WebRTC close). Prevents the host
  // waiting forever on someone who already left.
  Network.prototype.startHeartbeat = function () {
    const self = this;
    if (this._hb) clearInterval(this._hb);
    this._hb = setInterval(function () {
      const now = Date.now();
      self.conns.forEach(function (c) {
        if (!c.meta) return;
        if (!c.meta.lastAck) c.meta.lastAck = now;
        if (now - c.meta.lastAck > 15000) { self.dropClient(c); return; }
        self.reply(c, "PING", { t: now });
      });
    }, 5000);
  };

  function assignClientId(self) {
    let i = 2;
    let id;
    do { id = "p" + i; i++; } while (self.roster.some((p) => p.id === id));
    return id;
  }

  Network.prototype.handleHostData = function (conn, d) {
    const msg = parse(d);
    if (!msg || !msg.type) return;
    const data = msg.data || {};
    if (conn.meta) conn.meta.lastAck = Date.now();   // heartbeat freshness

    if (msg.type === "JOIN") {
      const id = assignClientId(this);
      conn.meta = { id: id, name: data.name || ("Player " + id), connected: true, lastAck: Date.now() };
      this.conns.push(conn);
      this.roster.push({ id: id, name: conn.meta.name, connected: true });
      // Tell the new client who it is.
      this.reply(conn, "WELCOME", { selfId: id, role: "client", code: this.code, players: this.roster });
      // Broadcast the updated roster to everyone (including the new client).
      this.broadcast("ROSTER", { players: this.roster });
      this.emit("roster", this.roster);
      return;
    }

    // Anything else a client sends is an app-level message we forward up, tagged
    // with the sender's assigned id (so SETUP / ACTION can be attributed).
    this.emit(msg.type, data, (conn.meta && conn.meta.id) || msg.from || "client");
  };

  Network.prototype.dropClient = function (conn) {
    const rec = this.conns.find((c) => c === conn);
    if (!rec) return;
    this.conns = this.conns.filter((c) => c !== conn);
    const id = (conn.meta && conn.meta.id) || null;
    const name = (conn.meta && conn.meta.name) || null;
    if (id) {
      // Remove the departed player from the lobby roster so stale entries don't
      // linger. The controller still receives "peer-left" to drop them from an
      // in-progress game (issue: left players block the round forever).
      this.roster = this.roster.filter((x) => x.id !== id);
      this.broadcast("ROSTER", { players: this.roster });
      this.emit("roster", this.roster);
      this.emit("peer-left", { id: id, name: name });
    }
  };

  // ---------------- CLIENT ----------------
  Network.prototype.joinGame = function (opts) {
    const self = this;
    this.role = "client";
    const target = resolvePeerId(opts.peerId);
    if (!target) { if (opts.onError) opts.onError(new Error("Enter the game code or Peer ID.")); return this; }

    // Random id -> the broker hands us a free auto id.
    const peer = new Peer({ debug: 1 });
    this.peer = peer;

    peer.on("open", function () {
      self.setStatus("connecting");
      const conn = peer.connect(target, { reliable: true });
      self.conn = conn;
      conn.on("open", function () {
        self.reply(conn, "JOIN", { name: opts.name || "Player" });
        self.setStatus("connected");
      });
      conn.on("data", function (d) { self.handleClientData(d); });
      conn.on("close", function () { self.setStatus("disconnected"); self.emit("disconnected", {}); });
      conn.on("error", function (e) { self.setStatus("error"); if (opts.onError) opts.onError(e); });
    });

    peer.on("error", function (err) { self.setStatus("error"); if (opts.onError) opts.onError(err); });
    self.startClientHeartbeat();
    return this;
  };

  // Client never blocks the round: if the host goes silent, surface "disconnected".
  Network.prototype.startClientHeartbeat = function () {
    const self = this;
    if (this._chb) clearInterval(this._chb);
    this._lastHostSeen = Date.now();
    this._chb = setInterval(function () {
      if (Date.now() - self._lastHostSeen > 15000) {
        self.setStatus("disconnected");
        self.emit("disconnected", {});
      }
    }, 5000);
  };

  Network.prototype.handleClientData = function (d) {
    const msg = parse(d);
    if (!msg || !msg.type) return;
    const data = msg.data || {};
    this._lastHostSeen = Date.now();

    if (msg.type === "PING") { this.reply(this.conn, "PONG", { t: data.t }); return; }
    if (msg.type === "WELCOME") {
      this.selfId = data.selfId;
      this.code = data.code;
      this.roster = data.players || [];
      this.emit("joined", data);
      return;
    }
    if (msg.type === "ROSTER") {
      this.roster = data.players || [];
      this.emit("roster", this.roster);
      return;
    }
    // Everything else (START / STATE / RESET / CHAT / SETUP_REQUEST / ...) is app-level.
    this.emit(msg.type, data, "host");
  };

  // ---------------- send helpers ----------------
  function encode(type, data) { return JSON.stringify({ type: type, data: data }); }

  Network.prototype.reply = function (conn, type, data) {
    try { conn.send(encode(type, data)); } catch (e) { console.warn("[network] send failed", e); }
  };

  Network.prototype.broadcast = function (type, data) {
    this.conns.forEach((c) => { this.reply(c, type, data); });
  };

  // Client -> host action payload.
  Network.prototype.sendAction = function (payload) {
    if (this.role === "client" && this.conn) this.reply(this.conn, "ACTION", payload);
  };

  // Client -> host self-served loadout (sigil / slot / 2 contraband).
  Network.prototype.sendSetup = function (setup) {
    if (this.role === "client" && this.conn) this.reply(this.conn, "SETUP", setup);
  };

  // Any player -> all (host relays; clients just send to host). Used for chat/log.
  Network.prototype.sendChat = function (text) {
    const payload = { text: text };
    if (this.role === "client") this.reply(this.conn, "CHAT", payload);
    else this.broadcast("CHAT", payload);
  };

  window.HS2 = window.HS2 || {};
  window.HS2.network = { Network, genCode, resolvePeerId };
})();
