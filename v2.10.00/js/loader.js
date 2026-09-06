// loader.js
// Multi-CSV, schema-agnostic data loader.
//
// The game is 100% data-driven. Instead of one gamedata.csv with everything, there
// is one CSV per game type. Each is read with PapaParse; the schema of each table is
// discovered from its header row (no hard-coded column mapping).
//
//   data/cards.csv       spell cards (core: ID/Name; everything else -> attributes)
//   data/buffs.csv       buff statuses            -> feed the Effect Registry
//   data/debuffs.csv     debuff statuses          -> feed the Effect Registry
//   data/sigils.csv      player Sigils
//   data/contraband.csv  one-shot + passive gear
//   data/config.csv      key,value -> playtest tuning knobs
//
// Rule: add a column to any table and it flows through automatically. Add a whole
// new table and register one loader — no engine/UI code change is needed to see it.
(function () {
  "use strict";

  const CORE_CARD = ["ID", "Name"];            // the two core card fields we map
  const LIST_HEADERS = [/^buffs$/i, /^debuffs$/i, /^keywords$/i, /^elements?$/i];

  // Merge knobs from config.csv over these defaults (single source of truth).
  const CONFIG_DEFAULTS = {
    START_HP: 30, LINE_SIZE: 8, HAND_SIZE: 5, MAX_CARDS: 5,
    HEAT_START: 1, HEAT_INCREMENT: 1, HEAT_GLOBAL_DIVISOR: 2, HIDE_MULTIPLIER: 2,
    DAMAGE_MULTIPLIER: 1, TRIGGER_THUMBS: 2, PLAN_TIMER: 0,
    MIN_PLAYERS: 2, MAX_PLAYERS: 4, EMPTY_FINGER_BLOCK: 3,
    CREW_MARK_CAP: 3, CONTRABAND_CAP: 2,
  };

  function coerce(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (s === "") return null;
    if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  }
  function toList(raw) {
    if (raw === null || raw === undefined) return [];
    if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
    return String(raw).split(",").map((x) => x.trim()).filter(Boolean);
  }
  function isListHeader(h) { return LIST_HEADERS.some((re) => re.test(h)); }

  async function loadRows(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load " + url + " (HTTP " + res.status + ")");
    const parsed = Papa.parse(await res.text(), { header: true, skipEmptyLines: true, dynamicTyping: false });
    return parsed.data || [];
  }

  // Header-first union of every column that exists.
  function headersOf(rows) {
    const out = [];
    rows.forEach((r) => Object.keys(r || {}).forEach((k) => {
      const t = String(k).trim();
      if (t && out.indexOf(t) === -1) out.push(t);
    }));
    return out;
  }

  function hasContent(row) {
    return Object.keys(row).some((k) => row[k] !== null && row[k] !== undefined && String(row[k]).trim() !== "");
  }

  // Generic table: plain objects with typed values + a raw .meta mirror.
  function parseTable(rows) {
    const headers = headersOf(rows);
    const out = [];
    rows.forEach((row) => {
      if (!row || !hasContent(row)) return;
      const obj = { meta: {} };
      headers.forEach((h) => { obj[h] = coerce(row[h]); obj.meta[h] = row[h]; });
      out.push(obj);
    });
    return out;
  }

  // Cards: map ID/Name to core, dump every other column into attributes + arrays.
  function parseCards(rows) {
    const headers = headersOf(rows);
    const cards = [];
    rows.forEach((row, idx) => {
      if (!row || !hasContent(row)) return;
      const rawId = row["ID"];
      const id = (rawId !== null && rawId !== undefined && String(rawId).trim() !== "")
        ? String(rawId).trim() : "auto-" + idx;
      const core = { id: id, name: row["Name"] ? String(row["Name"]).trim() : "(unnamed)", type: "Spell" };

      const card = { core, id, name: core.name, type: core.type, meta: {}, attributes: {}, elements: [], buffs: [], debuffs: [], keywords: [] };
      headers.forEach((h) => { card.meta[h] = row[h]; if (CORE_CARD.indexOf(h) === -1 && !isListHeader(h)) card.attributes[h] = coerce(row[h]); });

      const elRaw = row["Element"] != null && String(row["Element"]).trim() !== "" ? row["Element"] : (row["Elements"] != null ? row["Elements"] : null);
      card.elements = toList(elRaw).map((e) => e.toUpperCase());
      card.buffs = toList(row["Buffs"] != null ? row["Buffs"] : row["buff"]);
      card.debuffs = toList(row["Debuffs"] != null ? row["Debuffs"] : row["debuff"]);
      card.keywords = toList(row["Keywords"] != null ? row["Keywords"] : row["keyword"]);

      card.attributes["Element"] = card.elements;
      card.attributes["Elements"] = card.elements;
      card.attributes["Buffs"] = card.buffs;
      card.attributes["Debuffs"] = card.debuffs;
      card.attributes["Keywords"] = card.keywords;
      cards.push(card);
    });
    return cards;
  }

  function mergeConfig(cfgRows) {
    const conf = Object.assign({}, CONFIG_DEFAULTS);
    cfgRows.forEach((r) => {
      if (!r || !hasContent(r)) return;
      const k = String(r["Key"] || "").trim();
      if (!k) return;
      const v = coerce(r["Value"]);
      if (v !== null) conf[k] = v;
    });
    return conf;
  }

  // Load everything. Returns { cards, buffs, debuffs, sigils, contraband, config }.
  async function loadData(base) {
    base = base || "";
    const [cardRows, buffRows, debuffRows, sigilRows, cbRows, cfgRows] = await Promise.all([
      loadRows(base + "data/cards.csv"),
      loadRows(base + "data/buffs.csv"),
      loadRows(base + "data/debuffs.csv"),
      loadRows(base + "data/sigils.csv"),
      loadRows(base + "data/contraband.csv"),
      loadRows(base + "data/config.csv"),
    ]);

    return {
      cards: parseCards(cardRows),
      buffs: parseTable(buffRows),
      debuffs: parseTable(debuffRows),
      sigils: parseTable(sigilRows),
      contraband: parseTable(cbRows),
      config: mergeConfig(cfgRows),
      // Raw parsed rows (header object format) so the UI can export current data
      // back to CSV without losing columns.
      rawCards: cardRows,
      rawBuffs: buffRows,
      rawDebuffs: debuffRows,
      rawSigils: sigilRows,
      rawContraband: cbRows,
      rawConfig: cfgRows,
    };
  }

  // Serialize a table of raw rows (PapaParse header:true objects) to CSV text.
  function toCsv(rows) {
    const headers = headersOf(rows || []);
    if (!headers.length) return "";
    const esc = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.map(esc).join(",")];
    (rows || []).forEach((r) => {
      if (!r || !hasContent(r)) return;
      lines.push(headers.map((h) => esc(r[h])).join(","));
    });
    return lines.join("\r\n");
  }

  // Re-parse one table's rows from CSV text. Returns PapaParse header rows.
  function parseCsvText(text) {
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false });
    return parsed.data || [];
  }

  window.HS2 = window.HS2 || {};
  window.HS2.loader = { loadData, loadRows, parseTable, parseCards, coerce, toList, mergeConfig, CONFIG_DEFAULTS, toCsv, parseCsvText };
})();
