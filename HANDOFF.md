# Project REVIVE / REBUILD — Developer Handoff

> A single-file browser game. This document is written for a coding agent (Claude Code)
> or developer taking over development. Read it top to bottom once before editing.

---

## 0. TL;DR — what this is

A **spelling-driven tower-defense / auto-battler**. A 9-year-old boy (default name **Daniel**)
newly arrived abroad with limited English, and a damaged AI (default name **Robert**), shelter
in a bunker during a zombie apocalypse. **The player spells words to summon units.** The boy's
limited vocabulary *is* the difficulty curve: boy learns English = player learns spelling = AI recovers.

The whole game is **one self-contained HTML file**: `project-revive.html` (~273 KB, ~4,530 lines).
No build step, no dependencies, no external assets. Open it in a browser and it runs.

**Current state:** feature-complete vertical slice. 10 chapters / 50 levels of story, 8 playable
characters with active skills, a 4-element affix system, meta-progression (upgrades), save system,
and a themed main menu. It has a real beginning, middle, and end ("THE END. Thank you for playing.").

---

## 1. How to work on this project

### File layout
- **Working file:** `project-revive.html` — edit this.
- **Output copy:** after each change, copy to wherever the user retrieves it (previously
  `/mnt/user-data/outputs/project-revive.html`). In a normal repo, just commit the working file.
- The entire game is inside one `<script>` tag near the bottom of the HTML. CSS is in one `<style>`
  in the `<head>`. Markup for menus/panels is between them.

### The iteration loop (do this EVERY change)
1. Edit `project-revive.html`.
2. **Extract the script and syntax-check it:**
   ```bash
   node -e "const fs=require('fs');const h=fs.readFileSync('project-revive.html','utf8');fs.writeFileSync('/tmp/pr.js',h.match(/<script>([\s\S]*?)<\/script>/)[1]);"
   node --check /tmp/pr.js && echo "SYNTAX OK"
   ```
3. **Write an inline Node test harness** with stubbed browser globals (see §7), eval the script,
   and assert on the behavior you changed. This is how every feature so far was verified without a
   browser. Do not skip this — many bugs (prefix collisions, NaN stats, render crashes) only surface
   at runtime.
4. Copy to the output location and hand back to the user.

### Communicating with the user ("Ling")
- Terse, mixes Chinese and English. **Reply in Chinese when they write Chinese.**
- Frequent one-word confirmations and typos ("ok", "ko", "contuine"). When a decision is needed and
  they don't answer specifically, **pick the most sensible default, state it explicitly, and proceed.**
- They like to **see the design/plan listed before implementation** (e.g. "list the 8 characters
  first"). Confirm the shape of a big change before writing 35 levels of it.
- Locked decisions are locked (see §3). Don't reopen without an explicit signal.

---

## 2. Architecture overview

Everything lives in the global `G` object (game state, ~line 928) plus a set of top-level `const`
definition tables and free functions. There is no framework and no module system.

### Coordinate system
- **World space:** `wx` (horizontal, scrolls with camera) and `wy` (lane, `0..LANES`).
- **Screen space:** `sx(wx,wy)` and `sy(wy)` convert to canvas pixels. `sx` applies camera + a
  vertical shear so lanes read as depth. Anything drawn to the canvas goes through these.
- The battlefield is a horizontal strip; our base is on the left (`OUR_BASE_X`), the enemy
  rift/portal on the right (`FOE_BASE_X`).

### The main loop
`loop(now)` (~line 1612) → computes `dt` (capped at 0.05, zeroed when paused) → `update(dt)` then
`draw(t)`. Uses `requestAnimationFrame`.

- **`update(dt)`** advances units (`updateUnit`), nodes, the enemy rift spawner (`updateRiftPool` /
  `updateFoes`), projectiles/fx, revive bars, skill zones, and win/lose checks.
- **`draw(t)`** renders the field (`drawField` → sky/atmosphere/mountains/skyline/shops), skill
  zones, then all units sorted back-to-front (`drawUnit`), then fx, floaters, and the minimap.

### The core game loop (fiction → mechanic)
AI scans a defeated enemy → "clones" its DNA → the player **spells the unit's name** to summon that
clone. Units and zombies are townspeople the boy recognizes (emotional weight). **Core Shards** are a
triple-unity: plague source + affix-mutation energy + meta-currency.

---

## 3. LOCKED design decisions (do not change without explicit sign-off)

These were deliberated and fixed. They are the identity of the game.

### Economy
- **Dual currency:** Energy 💎 (`G.gold`, tactical, resets to `START_ENERGY` each battle) and
  **Core Shards** 🔷 (`G.shards`, strategic, persists across runs / meta-progression).
- Summon price = additive word + affix cost. Revive cost = full configured total × 1.2 per revive
  (an intentional trap: heavily-buffed units get expensive to protect).
- No bailout on death spiral — player can quit / auto-quit on guaranteed loss.
- Settlement rating = Efficiency 50% + Base integrity 25% + Speed 25%; shown as star ratings;
  S ≈ 3× the shards of C. See `computeSettlement()`.

### Combat identity
- Feel = **idle/auto-battler + a few key manual actions** (choose lane, cast a skill).
- **Spelling is the core operation. Combat must never compete with it for attention.**
- **One unit per root type on the field** (`unitExists()` enforces it). This is the whole point:
  it forces players to spell *different* words, not stack one. Do not remove this.
- Hero vs swarm: allies are buffed (`HERO_HP`/`HERO_DMG`), zombies nerfed (`SWARM_HP`/`SWARM_DMG`),
  so one hero beats ~5–6 swarm. `CAP_PER_TYPE` forces mixed zombie spawns.

### Affixes — "Delivery Model B"
- Affixes are **separate consumable cards dragged onto already-deployed units** (NOT spelled into
  one long word). Max 2 per unit. Chosen specifically to keep each unit's spelled word short.
- On death→revive, a unit keeps its affixes. Dead units go to a **fallen / awaiting-revival queue**
  (`G.fallen`), never back to hand (prevents soft-lock).
- Two tiers: 6 core affixes default (angry/giant/swift/fire/frost/vamp); advanced affixes
  (toxic, zap) unlock by defeating **elite** zombies that carry them.

### Story canon (see §6 for the full arc)
- Boy is ethnic Chinese, limited English. Family = parents + older sister **Sarah**.
- The AI is a **redemptive guardian**: it was ordered to seal/kill everyone in the labs to contain
  the plague, refused, let people run, containment failed anyway — it carries guilt, and helping the
  boy is its atonement. **Not a villain.**
- Plague = an **engineered bioweapon** by a defense contractor; the contractor's cold AI ("The Other
  Voice") lay dormant in the network.
- Villain = **"The Ashguard,"** a grey-shield military remnant that wants the crystal; the commander
  is fear-driven, not evil. Daniel shows mercy at the end.
- Ending: plague ends, settlement named **REBUILD**, boy teaches children letters. Level 50 =
  "THE END. Thank you for playing."

---

## 4. Key data tables (definitions to edit content)

| Table | ~Line | What it holds |
|---|---|---|
| `G` | 928 | All mutable game state. Defaults for `wordSlots`, `cardSlots`, `cloneLevels`, `buildLevels`, `affixUnlocked`, `settings`, names, etc. |
| `TYPES` | 864 | The 8 characters. Each: `name` (the **spellable root**), `glyph`, `role`, stats (`hp/dmg/range/rate/speed`), `cost`, `color`, `kit` (weapon art), plus metadata `person`, `title`, `story`, `skill`, `chapter`. |
| `BUILDINGS` | 898 | tower / forge (placed on nodes). |
| `AFFIX` | 906 | 8 affixes. Each: `cost`, `cat`, `group` (mutual-exclusion), `glyph`, `desc`, optional `advanced:true`. |
| `CHAPTERS` | ~3107 | 10 chapters, each with `eyebrow`, `name`, `blurb`, and `levels:[{n,name,desc}]`. |
| `STORY` | 3782 | Per-level pre/post dialogue, keyed by level number 1–50, plus `'intro'`. Each level: `{title, unlocks, lines:[{who,text}]}`. `who` ∈ boy/ai/narrator/mom/dad/sister/okafor. `{boy}`/`{ai}` placeholders are substituted with the player's chosen names. |
| difficulty table | inside `setupCombatLevel` ~3631 | Per-level `{nest, base, accel, unlock}`. `unlock:'ALL'` expands to all clone types. |
| intros | inside `setupCombatLevel` | Per-level one-line intro banner text. |
| `SKY` | inside `drawField` ~1825 | Per-level 3-color sky palette (sets each level's mood). |

### Spelling roots — CRITICAL rule
The spellable word for a unit is `TYPES[key].name`. Affix words are `AFFIX[key].name`.
**No root may be a prefix of another root** or `routeLetter()` breaks (e.g. you could not add
`fire` and `fireball` together). Before adding ANY new spellable word, run this check:

```bash
node -e "const w=['cook','guard','brute','sling','potion','medic','thief','miner','tower','forge','angry','giant','swift','fire','frost','vamp','toxic','zap','YOURNEWWORD'];let bad=false;for(const a of w)for(const b of w){if(a!==b&&b.startsWith(a)){console.log('COLLISION',a,'<',b);bad=true;}}console.log(bad?'FAIL':'OK');"
```

Also **spread first letters** across the alphabet — the letter tray gets crowded if many roots share
an initial (M was overloaded with mage/medic/miner; that's why mage→potion). Prefer unused initials.

---

## 5. Major systems (where they live, how they work)

### Characters (8, Chapter One)
`cook` (Marco, warrior), `guard` (Dale, warrior/wall), `brute` (Big Tom, warrior/heavy),
`sling` (Rae, ranged slingshot), `potion` (Iris, magic/corrosive splash), `medic` (Grace, support/heal),
`thief` (Pico, special/energy-steal), `miner` (Sal, special/energy-produce).
Weapon art is drawn by `kit` in `drawKitOn` (~line 2182+): kits include `cook`, `bow`, `staff`,
`cross`, `dagger`, `shield`, `club`, `pick`, `slingshot`, `flask`. Portraits (`drawPortrait`) reuse
the same kit drawing, so codex cards and battlefield stay consistent.

### Active skills (`fireSkill`, ~line 1311)
Every ally with a `skill` charges over `SKILL_CHARGE_TIME` (12s). When ready, a ✨ appears above the
unit; tapping it (screen→world hit-test in `canvasTap`) fires the skill. All 8 are implemented:
- cook **Sizzle Slam** (AoE dmg + stun via `frozenT`), medic **Field Triage** (area heal),
  potion **Toxic Cloud** (lingering `G.zones` DoT), guard **Shield Wall** (`shieldT` full block in
  `applyHit`), brute **Ground Breaker** (AoE + knockback), sling **Ricochet** (bounces up to 5),
  thief **Smoke & Run** (+50💎 + `dashT` speed), miner **Deep Vein** (`boostT` doubles production).
- Charge state lives on the unit (`skillMax/skillT/skillReady`); effect timers (`shieldT/dashT/boostT/
  frozenT/poisonT`) decay in `updateUnit`. `G.zones` are processed in `update` and drawn under units.

### Four elements (in `applyAffixStats` + `affixOnHit`, ~1264)
Distinct mechanics, mutually exclusive (`group:'element'`):
- **fire** = fast burn (high dmg/s, short), **toxic** = stacking poison (up to 5 stacks),
  **frost** = slow + 25% freeze chance (`frozenT` immobilizes), **zap** = lightning chain to 3 foes
  with damage falloff (`zapChain` + `zapArc` visual). toxic and zap are advanced (elite-unlocked in order).

### Meta-progression / upgrades (`openUpgrades`, tabs ~3285+)
Three tabs, all spend Core Shards, all persist in save:
- **Base:** word slots (2→5), card slots (3→10) — `upgradeTracks()` / `buyUpgrade()`.
- **Heroes:** per-character level 1→10, +8% hp/dmg per level (`cloneLevels`, applied in `spawnUnit`).
- **Structures:** per-building level 1→10 (`buildLevels`, applied in `placeBuildingCard`).
- Level helpers: `cloneLvl` / `buildLvl` / `lvlMul` / `lvlPrice`, `LVL_MAX=10`. Buy via `buyLevel`.

### Save system (`collectSave`/`applySave`/`saveGame`/`loadGame`/`autoSave`)
- `SAVE_KEY='project-revive-save-v1'`. Serializes shards, bestGrade, `affixUnlocked` (Set↔array),
  unlocked clones, wordSlots, cardSlots, cloneLevels, buildLevels, names, seenIntro, settings.
- `localStorage` is often **blocked in preview/sandbox iframes** — save degrades gracefully and the
  reliable persistence path is **Download / Import JSON** (in Settings). Opening the file locally gives
  full autosave. Don't "fix" the try/catch away.

### Chapters, levels, story
- `CHAPTERS` (10) drive the menu. `chapterUnlocked(ci)` gates a chapter behind clearing all of the
  previous chapter's built levels (empty chapter → locked). `renderChapter()` builds the level cards;
  ‹ › arrows page chapters.
- `setupCombatLevel(n)` sets difficulty (`nest/base/accel/unlock`), the intro banner, and (via `SKY`)
  the palette. `startLevel(n)` boots a level; `startDialogue(level, after, opts)` runs pre/post story
  (skippable via `{skippable:true}`). AI speech evolves glitchy→simple→full→emotional across the game.
- Story log (📜) replays any unlocked chapter; the cinematic intro (`playIntroCinematic`) is the first
  entry there.

---

## 6. The full story arc (10 chapters, 50 levels)

1. **The Long Way Home** (L1–5) — small town; tutorial; find family's trail.
2. **The Road to Northreach** (L6–10) — travel toward the city.
3. **The City of Ash** (L11–15) — ruined city; trail leads to Blackpine Dam.
4. **The Heart of the Plague** (L16–20) — reach the dam (AI's lab + family's refuge, same place).
5. **Reunion** (L21–25) — reunite with parents; **Sarah is trapped in the deep levels** (hook); AI's
   confession (L24); find Sarah (L25).
6. **The Truth** (L26–30) — plague was an **engineered bioweapon**; the dormant **Other Voice** wakes.
7. **The Cure** (L31–35) — Sarah synthesizes a crystal counter-agent; plan to broadcast it city-wide.
8. **The Fall** (L36–40) — **the Ashguard** reveal/betrayal/siege; reactor breach; the long night.
9. **The Last Stand** (L41–45) — retake the gates; the commander; the towers; final swarm; the Heart.
10. **What We Rebuild** (L46–50) — cure spreads; mercy to the Ashguard; the quiet; ending → REBUILD.

Post-level dialogue is a simple text box + simple avatars (no elaborate cutscenes). Keep that style.

---

## 7. The test harness pattern (copy/paste starting point)

Every feature was verified this way. Stub the browser, eval the script, expose internals via
`window.__hook`, assert.

```bash
node -e '
const fs=require("fs");
let src=fs.readFileSync("project-revive.html","utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
// expose whatever internals you need to test:
src=src.replace("init();","init(); if(typeof window!==\"undefined\")window.__hook={G,startLevel,spawnUnit,fireSkill,TYPES,STORY,CHAPTERS,draw};");
let store={};global.localStorage={getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=v;}};
const ctx=()=>new Proxy({},{get:(o,k)=>{if(k.includes("Gradient"))return()=>({addColorStop(){}});if(k==="measureText")return()=>({width:10});return()=>{};}});
function el(){const c=ctx();return new Proxy({style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},appendChild(){},querySelector(){return el();},querySelectorAll(){return[];},getContext(){return c;},getBoundingClientRect(){return{left:0,top:0,width:900,height:506};},getAttribute(){return"cook";},setAttribute(){},innerHTML:"",width:900,height:506,textContent:"",value:"",remove(){}},{get:(o,k)=>k in o?o[k]:(()=>{})});}
global.document={getElementById:()=>el(),createElement:()=>el(),querySelectorAll:()=>[],addEventListener(){},body:{appendChild(){}}};
global.window={addEventListener(){},AudioContext:function(){this.createGain=()=>({gain:{value:0},connect(){},disconnect(){}});this.destination={};this.currentTime=0;this.createOscillator=()=>({type:"",frequency:{value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},start(){},stop(){}});}};
global.performance={now:()=>0};
global.requestAnimationFrame=()=>0;      // MUST be a no-op or the loop recurses → stack overflow
global.setTimeout=()=>0; global.clearTimeout=()=>{};
let pass=0,fail=0;const ok=(n,c)=>{c?pass++:(fail++,console.log("FAIL",n));};
const h=(()=>{eval(src);return global.window.__hook;})();
// ---- your assertions here ----
h.startLevel(2);
ok("a unit spawns", !!h.spawnUnit("cook","ally",300,1));
console.log(pass+"/"+(pass+fail)+" passed");
'
```

### Harness gotchas (learned the hard way)
- **`requestAnimationFrame` must be a no-op** in tests, or `loop` recurses forever → stack overflow.
- Canvas ctx stub: gradient methods must return `{addColorStop(){}}`; `measureText` → `{width:...}`.
- AudioContext stub: `gain.value`, `frequency.value` + `setValueAtTime` + `exponentialRampToValueAtTime`
  must all exist, or audio init throws.
- For DOM tests, a naive `className=` setter does **not** populate `classList`; parse it, or use a
  browser-like stub. `innerHTML` setter should clear a `kids[]` array if you count children.
- **Units drift forward while charging.** If you tick `updateUnit` many times with no enemies present,
  the unit walks toward the enemy base — place test enemies near the unit's *post-drift* x, not spawn x.
- Dialogue strings use `\'` for apostrophes; a stray unescaped quote has broken syntax before. When
  bulk-editing story text, prefer a small Python replace script over sed to avoid escaping mistakes.
- There's a hidden `SKIP` cheat: typing "skip" in a battle instantly S-ranks it (handy for testing
  later levels). Typing progresses via `typeChar`.

---

## 8. Coding conventions in this file

- **One giant script**, plain ES2015+ functions and `const` tables. No classes for game objects —
  units are plain objects created in `spawnUnit`. Keep it that way; don't introduce a framework.
- Per-unit stat mutations must **clone `u.def`** first (`u._defOwned` guard) so the shared `TYPES`
  object is never mutated. Affix/level code already does this — follow the pattern.
- Name collisions bite: there is already a `ROLE_LABEL`; the friendly labels use `CLASS_LABEL`.
  Grep before declaring a new top-level `const`.
- Drawing: everything world-positioned goes through `sx`/`sy`. Screen-space fx (particles, zaps,
  floaters) are drawn in their own passes.
- Colors/among-unit tints live in `drawUnit`; per-element auras and status FX (burn, poison motes,
  ice shell, spark crackle, shield bubble) are there too.

---

## 9. Build order discipline & what's next

The user prefers systems built in a set order and content confirmed before mass-production.

**Done:** economy, combat, affixes (Model B), 4 elements, 8 characters + art + cards, 8 active skills,
meta-upgrades (slots + hero levels + building levels), save/settings, 10 chapters × 5 levels of story,
themed main menu.

**Not yet built / designed but deferred:**
- **Skill upgrades** (per-skill leveling) — deferred until skills existed; they now do, so this is a
  natural next step. Would slot into the Upgrades panel as a 4th thing or fold into Heroes.
- **Per-chapter character rotation:** design was locked as "carry only 2 clones into the next chapter;
  new-chapter characters have higher base stats and a growth cap, to encourage swapping" (growth
  **direction A**: level binds permanently to the character). New characters for road/city/dam scenes
  (truck driver, gas-station clerk, cop, firefighter, etc.) are **not built yet**.
- **Level-specific mechanics** (command system, contested capture nodes, spells) — currently every
  level reuses rift + node + affix + scaling. Node/capture belongs to level 2+, not the tutorial.
- **Balance knobs the user may want to tune:** `riftBaseRate`/`accel` per level, `HERO_*`/`SWARM_*`
  multipliers, `SKILL_CHARGE_TIME` (12s), clone +8%/level, freeze chance 25%, zap chain 3, poison max 5.
- **Part Two hook:** the family note about a big-city refuge sets up a sequel.

**When adding characters:** give each a real name + title + story + a `skill` placeholder, pick a
spellable root with no prefix collision and a spread-out initial, add a `kit` (or reuse one), and set
`chapter`. List them for the user before implementing.

---

## 10. Quick reference — important symbols

- State: `G` (~928). Constants near it: `HERO_HP/HERO_DMG/SWARM_HP/SWARM_DMG`, `CAP_PER_TYPE`,
  `START_ENERGY`, `LANES`, `SKILL_CHARGE_TIME`, `LVL_MAX`, `TYPE_KEYS`, `AFFIX_KEYS`, `BUILD_KEYS`.
- Spawning/combat: `spawnUnit`, `spawnFoe`, `updateUnit`, `moveToward`, `dealDamage`, `applyHit`,
  `affixOnHit`, `zapChain`, `killUnit`, `fireSkill`, `enemiesNear`.
- Economy/cards: `rollTray`, `reroll`, `spellableWords`, `routeLetter`, `typeChar`, `mintCard`,
  `playUnitCard`, `placeBuildingCard`, `unitConfigCost`, `reviveCost`, `renderFallen`, `reviveFallen`.
- Rift/spawner: `foePool`, `updateFoes`, `updateRiftPool`, `updateNodes`, `updateBaseTurret`.
- Rendering: `draw`, `drawField`, `drawUnit`, `drawBase`, `drawPortrait`, `drawKitOn`, `SKY`.
- Flow: `startLevel`, `setupCombatLevel`, `resetBattle`, `victory`, `gameOver`, `onPortalDestroyed`,
  `computeSettlement`, `settlementScreen`.
- Menu/UI: `showMenu`, `refreshMenu`, `renderChapter`, `openUpgrades`/`showUpgTab`/`renderLevelGrid`/
  `buyLevel`/`buyUpgrade`, `openCodex`/`openCharacterCard`, `openStoryLog`/`renderStoryLog`/`replayStory`,
  `openSettings`, `openNames`, `setMenuScene` (themed backdrop toggle).
- Story/cinematics: `STORY`, `startDialogue`, `playIntroCinematic`, `avatarFor` + the `*Avatar()` fns.
- Save: `collectSave`, `applySave`, `saveGame`, `loadGame`, `autoSave`, `downloadSave`, `importSaveFile`.
- Entry point: `init()` (~4513) then `loop()`.

---

*Written as a snapshot of the project at 10 chapters / 50 levels complete. Line numbers drift as the
file changes — grep by function name, which is stable.*
