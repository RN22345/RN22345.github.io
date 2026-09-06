# Hood Sorcery — v2.10.00 (simultaneous casting)

A **serverless, P2P-capable HTML prototype** of *Hood Sorcery* (Siyaman Studios),
built to match the mechanics in `HOOD_SORCERY_SRD_v1.md`. It runs on static hosting
(GitHub Pages) and is engine-first data-driven: the rules come from CSVs.

What this version does differently from a plain hot-seat or turn-based sandbox:

- **Simultaneous turns.** Every wizard secretly plans a Finger Line, then everyone
  reveals and resolves at the same instant. There is no "play one card, pass".
- **Finger Line packing.** Each round you can cast as many cards as you like **up
  to 8 elements** (10 with *Big Green*), max 5 cards — using **chaining + nesting**
  to fit more in.
- **Real setup.** Each wizard picks 1 **Sigil**, the **finger slot** it sits on, and
  **2 Contraband** (one per thumb).
- **Up to 4 wizards**, each Human (hot-seat) or **AI**.
- **One CSV per game type** (cards / buffs / debuffs / sigils / contraband), plus a
  `config.csv` of playtest knobs.
- **Fate Bones → Trigger Thumbs**, count configurable.
- Procedural **WebAudio SFX + CSS animations** (no audio assets needed).

New in v2.10.00:

- **Victory screen** — a dedicated "last crew standing" screen (trophy + final
  standings + scrollback) once a single wizard remains.
- **Planning timer** — optional `PLAN_TIMER` (seconds) countdown during the
  preparation phase; on expiry the current decks auto-lock and reveal early. Set to
  `0` to disable. Everyone can also just **confirm & lock early** to start the round.
- **Card readability** — cards get an element-colour accent in hand (no more
  "no colour until placed"), noisy `Splash: 0` / `Target: enemy` dumps are replaced
  by meaningful chips, non-Common rarities are highlighted, and the flavour text
  renders once as the italic quote (no duplicate bubble).
- **Player HUD during planning** — see your own HP, **projected Block** (empty-slot
  block + buff block, with a breakdown; Freeze forces "no block"), and every buff /
  affliction with its description shown inline.
- **Reference codex (📖 Reference)** — a sidebar on both the plan and board screens
  listing every card, buff, debuff, sigil and contraband with its description, for
  easy tracking.
- **Self-explaining controls** — Trigger Thumbs spends describe their exact Fate
  roll outcome, Contraband list their effect + Active/Passive state, and a
  collapsible **Rules & reminder** section lives on the plan screen.
- **100% data-driven content** — every card / buff / debuff / sigil / contraband
  name, icon, colour, description and effect value comes straight from the CSVs;
  only UI chrome text is code-side. Edit `data/*.csv` without touching code.
- **Playtester / bugfixer QOL** — `Clear line`, live deck count, a **State (debug)**
  JSON toggle with a **Copy state** button, and a `assets/` folder with pre-named
  favicon + logo placeholders for the artist.
- **Anti-lock & leave handling** — when a wizard leaves/disconnects mid-session, the
  host removes them from the game (`removePlayer`) and re-pumps the round so it can't
  stall waiting on someone who'll never lock. A host-only **"Force reveal & resolve"**
  button appears on the waiting screen, heartbeats detect silent drops, and a persistent
  error banner surfaces any rules bug instead of freezing.
- **Opponent intel (planning)** — see each opponent's last known HP / Block / Trigger
  Thumbs / hand size, active buffs & afflictions, Contraband with its `[armed|used|gear]`
  state, how much damage you'd deal to them (assuming no Block), and their current Debuff
  DoT.
- **Fair self-serve loadouts** — in P2P the host no longer picks your Sigil / slot /
  Contraband. Each client sets up their own wizard and sends it to the host; the host only
  configures AI. Non-host loadouts default to a random one so nothing ever stalls.

---

## How to run

The CSVs are loaded with `fetch()`, so serve the folder over HTTP (GitHub Pages
works out of the box). Locally:

```bash
cd hood-sorcery-prototype/v2.10.00
python -m http.server 8080
# open http://localhost:8080
```

- **Local Match (vs AI)** — fastest way to see the engine: set up 2–4 wizards,
  each Human/AI, pick Sigil + slot + 2 Contraband, then Start.
- **Host Game / Connect** — PeerJS P2P (free cloud broker). Host configures the
  table + AI; each human wizard picks their own Sigil / slot / Contraband and sends it
  to the host. Everyone plans their line, locks in, and the host reveals + resolves once
  everyone has locked.


---

## Architecture (engine-first, data-driven)

```
v2.10.00/
  index.html           Entry point. Loads PeerJS + PapaParse (CDN), then modules.
  assets/              Placeholder favicons + logo (drop finished art over these).
    favicon.svg/.ico   16x16/32x32 PNG + ICO + apple-touch-icon.png
    logo.png / logo.svg (brand wordmark shown beside the title).
  data/
    cards.csv          Spell cards (ID/Name core; everything else -> attributes).
    buffs.csv          Buff statuses        -> Effect Registry (generic hooks).
    debuffs.csv        Debuff statuses      -> Effect Registry.
    sigils.csv         Player Sigils        (slot-based conditions).
    contraband.csv     Active one-shots + Passive gear.
    config.csv         key,value playtest knobs (Heat, HP, Dmg multiplier, Thumbs...).
  css/style.css        Theme + animations.
  js/
    loader.js          Multi-CSV, schema-agnostic loader + config merge.
    effects.js         Decoupled Effect Registry (built FROM buffs/debuffs CSVs).
    packing.js         The Finger Line cost engine: chain + nest.
    game.js            State, setup, PLAN phase, locking, round pump.
    resolution.js      The SIMULTANEOUS reveal -> resolve pass.
    ai.js              Auto planner (packs, aims, gambles, arms).
    network.js         PeerJS pipe (isolated; relays JSON action payloads).
    ui.js              Dynamic renderer (setup / plan / reveal / board).
    script.js          Controller wiring loader + engine + network + ui.
```

### Data (schema-agnostic)

Every table is read by header. **Rules:**

- `cards.csv`: core `ID`/`Name`; every other column (`Damage`, `Block`, `Heal`,
  `Draw`, `Target`, `Splash`, `Rarity`, `Keywords`, …) is dumped into
  `card.attributes`. `Element`, `Buffs`, `Debuffs`, `Keywords` are comma-split
  arrays. **Add a column → it renders and resolves automatically.**
- `buffs.csv` / `debuffs.csv`: define statuses. Columns like `DamagePerTurn`,
  `BlockPerTurn`, `HealPerTurn`, `SkipTurn`, `LoseBlock`, `DrawPenalty`,
  `DrawBonus`, `DamageBonus`, `ImmediateDamage` are turned into standard
  `onApply` / `onRoundStart` / `onRoundEnd` hooks. **Add a row → new status.**
- `sigils.csv`: `Require` (the element, or `EMPTY`/`ANY`), `BonusType`
  (`damage`/`block`/`reflect`), `Amount`.
- `contraband.csv`: `Class` (`Active`/`Passive`), `Type` (`heal`, `block`,
  `bignext`, `damage`, `aoe`, `shatter`, `lineSize`, `fireDmg`, `cleanKit`,
  `markCap`, `blockOnBlock`, `dmgTaken`), `Amount`, `Element`.
- `config.csv`: playtest knobs.

### Config knobs (`data/config.csv`)

| Key | Default | Meaning |
|---|---|---|
| `START_HP` | 32 | Starting HP |
| `LINE_SIZE` | 8 | Finger Line element budget |
| `HAND_SIZE` | 5 | Cards drawn each round |
| `MAX_CARDS` | 5 | Max cards per round |
| `HEAT_START` | 1 | Starting Heat |
| `HEAT_INCREMENT` | 1 | Heat ramp per round |
| `HEAT_GLOBAL_DIVISOR` | 2 | Global bleed = floor(heat ÷ this) |
| `HIDE_MULTIPLIER` | 2 | Anti-turtle: 0-damage-wizard takes +heat × this |
| `DAMAGE_MULTIPLIER` | 1 | Multiply all damage by this (playtest) |
| `TRIGGER_THUMBS` | 2 | Number of Trigger Thumbs per wizard |
| `PLAN_TIMER` | 0 | Planning-phase countdown in seconds (0 = off). On expiry, current decks auto-lock and reveal. |
| `EMPTY_FINGER_BLOCK` | 3 | Block per empty finger slot |
| `CREW_MARK_CAP` | 3 | Max cards aimed at one wizard |
| `MIN/MAX_PLAYERS` | 2/4 | Table size |

Edit `config.csv` and reload — no code changes.

---

## The round (simultaneous)

1. **Plan (secret)** — draw to hand, optionally **Turn In** cards (scrap → +2 Block,
   or flip → draw 1), **pack** cards onto the 8-element Finger Line (chain/nest),
   **aim** each card with a Crew Mark (anti-focus cap), **gamble** Trigger Thumbs,
   **arm** Contraband. Lock in.
2. **Reveal** — all lines flip at once.
3. **Resolve** — empty-finger Block → buff recovery (Hard/Regen) → Sigils → active
   Contraband → Trigger Thumbs roll → all Casts fire → statuses DoT → The Heat →
   eliminations (checked at the end, so a lethal spell still resolves even if its
   caster died this round).

**The Heat** rises each round and bleeds everyone (`floor(heat/divisor)`); wizards
who dealt nothing are punished harder.

**Trigger Thumbs** (renamed Fate Bones): roll 1–6. 1 = Backfire (damage reflects),
2 = Fizzle (half), 3–4 = Steady, 5 = Amp (+2), 6 = Double (×2). Clean Kit removes
the "1" face.

---

## P2P

Star topology: everyone connects to the **host**, which is authoritative. Clients
submit their locked plan as a JSON action payload (`{ kind:'LOCK', playerId, plan }`);
when all alive wizards have locked, the host resolves and broadcasts the revealed
`STATE` to everyone. WebRTC data channels are peer-to-peer; the PeerJS broker only
does signaling. The `network.js` layer is a pure pipe and knows nothing about rules.

---

## Extending

- **Add a card** → append a row to `data/cards.csv`.
- **Add a status** → append a row to `data/buffs.csv` or `data/debuffs.csv`.
- **Add a Sigil / gear** → append a row to `data/sigils.csv` / `data/contraband.csv`.
- **Tune balance** → edit `data/config.csv`.

## Validation

Headless tests (in workspace `.tmp`, not shipped):

```bash
node .tmp/test-v21000.js      # multi-CSV + packing + full AI match to a winner (+ victory config)
node .tmp/dom-smoke-v21000.js # UI render paths (setup/plan/board + timer & victory screens)
node .tmp/net-smoke-v21000.js # PeerJS protocol routing (stubbed Peer)
```
