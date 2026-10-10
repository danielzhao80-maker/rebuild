#!/usr/bin/env node
// tools/test-arcade.js — automated test for REBUILD's Daniel's Arcade integration.
//
//   cd rebuild && npm install && node tools/test-arcade.js     (or: npm test)
//
// Loads index.html + arcade-shop.js into jsdom (real DOM, stubbed canvas/audio), then checks:
// script boot, shop buttons + pause, Core Shards trade (20/day cap, save/load), the 6 abilities
// (two passes with different ⚡ active sets), the 3-slot limit, live upgrades, the secret agent
// ability, admin Super Mode, no stacking across save/load, gun/ability/bg skins (URL param,
// localStorage, live, null restore) and that the Codes tab / secret corner never appear.
// The last line is "ARCADE TEST PASS" or "ARCADE TEST FAIL (n)"; exit code is nonzero on failure.
"use strict";
const fs = require("fs");
const path = require("path");
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (e) {
  console.error("jsdom not found. Run `npm install` in rebuild/ (or set NODE_PATH to a node_modules that has jsdom).");
  console.log("ARCADE TEST FAIL (1)");
  process.exit(2);
}

const R = path.resolve(__dirname, "..");
const HTML = fs.readFileSync(path.join(R, "index.html"), "utf8");
const SHOP_JS = fs.readFileSync(path.join(R, "arcade-shop.js"), "utf8");
const SAVE_KEY = "project-revive-save-v1", ARCADE_KEY = "daniels-arcade-v1", SKINS_KEY = "daniels-arcade-skins";
const HOOK = "window.__hook={G,saveGame,loadGame,collectSave,draw,fireSkill,spawnUnit,startLevel,projectile," +
  "ARCADE_SKINS,ARCADE_AB,setPaused,update,updateUnit,updateBaseTurret,applyHit,computeSettlement,loop};";

let pass = 0, fail = 0, section = "";
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log(`  FAIL [${section}] ${name}`); } };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const sect = (s) => { section = s; console.log("- " + s); };
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

// ------------------------------------------------------------------ harness
function boot(seed, query, { withShop = true } = {}) {
  let html = HTML;
  const tag = '<script src="arcade-shop.js"></script>';
  if (!html.includes(tag)) throw new Error("arcade-shop.js <script> tag missing from index.html");
  html = html.replace(tag, () => (withShop ? "<script>" + SHOP_JS + "</script>" : ""));
  html = html.replace(/<script defer src="nullp-widget\.js"[^>]*><\/script>/, "");
  if (!html.includes("init();\n})();")) throw new Error("init();\\n})(); marker missing — update the hook in tools/test-arcade.js");
  html = html.replace("init();\n})();", () => "init(); " + HOOK + "\n})();");
  const errs = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errs.push(String((e && e.message) || e)));
  vc.on("error", (e) => errs.push(String(e)));
  const calls = { styles: [], stops: [] };
  const ctx = () => new Proxy({}, {
    get: (o, k) => {
      if (k in o) return o[k];
      if (typeof k === "string" && k.includes("Gradient")) return () => ({ addColorStop(off, c) { calls.stops.push(c); } });
      if (k === "measureText") return () => ({ width: 10 });
      return () => {};
    },
    set: (o, k, v) => { o[k] = v; if (k === "fillStyle" || k === "strokeStyle") calls.styles.push(v); return true; },
  });
  const dom = new JSDOM(html, {
    url: "http://localhost/games/rebuild/index.html" + (query || ""),
    runScripts: "dangerously", virtualConsole: vc,
    beforeParse(w) {
      // The game loop must never run on its own: the test drives update/draw by hand.
      w.requestAnimationFrame = () => 0; w.cancelAnimationFrame = () => {};
      w.HTMLCanvasElement.prototype.getContext = function () { return this._c || (this._c = ctx()); };
      w.AudioContext = function () {
        const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
        this.createGain = () => ({ gain: param(), connect() {}, disconnect() {} });
        this.destination = {}; this.currentTime = 0; this.sampleRate = 44100; this.resume = () => Promise.resolve();
        this.createOscillator = () => ({ type: "", frequency: param(), connect() {}, start() {}, stop() {} });
        this.createBiquadFilter = () => ({ frequency: param(), Q: param(), connect() {} });
        this.createBuffer = () => ({ getChannelData: () => new Float32Array(10) });
        this.createBufferSource = () => ({ connect() {}, start() {}, stop() {} });
      };
      w.webkitAudioContext = w.AudioContext;
      for (const [k, v] of Object.entries(seed || {})) w.localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    },
  });
  const w = dom.window;
  const h = w.__hook;
  const S = w.ArcadeShop;
  const $ = (sel) => w.document.querySelector(sel);
  const $$ = (sel) => [...w.document.querySelectorAll(sel)];
  const arcade = () => JSON.parse(w.localStorage.getItem(ARCADE_KEY) || "{}");
  const tabs = () => $$(".as-tabs button").map((b) => b.textContent);
  const clickTab = (re) => { const b = $$(".as-tabs button").find((x) => re.test(x.textContent)); if (b) b.click(); return !!b; };
  return { dom, w, h, S, errs, calls, $, $$, arcade, tabs, clickTab };
}
const GAME_SAVE = { v: 1, shards: 7, seenIntro: true };
const LV = { "rebuild:tough": 2, "rebuild:power": 3, "rebuild:swift": 1, "rebuild:greed": 2, "rebuild:regen": 1, "rebuild:energy": 2 };
const ALL0 = { tough: 0, power: 0, swift: 0, greed: 0, regen: 0, energy: 0 };
const abEq = (h, exp) => JSON.stringify({ ...h.ARCADE_AB }) === JSON.stringify({ ...ALL0, ...exp });
const GRADE = { S: 30, A: 22, B: 15, C: 10, D: 6 };
const opened = [];
function start(seed, query, opts) { const r = boot(seed, query, opts); opened.push(r.w); return r; }

// Every ability effect, measured in a live battle, for an expected ARCADE_AB.
function checkEffects(r, exp, label) {
  const { h } = r, G = h.G;
  const e = { ...ALL0, ...exp };
  ok(`${label}: ARCADE_AB ${JSON.stringify(h.ARCADE_AB)}`, abEq(h, e));
  h.startLevel(2);
  const max = Math.round(100 * (1 + e.tough / 100));
  ok(`${label}: tough -> base ${G.base}/${G.baseMax} (want ${max})`, G.baseMax === max && G.base === max);
  ok(`${label}: energy -> start gold ${G.gold} (want ${120 + e.energy})`, G.gold === 120 + e.energy);
  // power: player side boosted (unit, and turret/tower pseudo-attacker), zombies not
  G.units = [];
  let z = h.spawnUnit("cook", "zombie", 600, 1), a = h.spawnUnit("cook", "ally", 300, 1);
  let hp = z.hp; h.applyHit(a, z, 10);
  ok(`${label}: power ally 10 -> ${hp - z.hp}`, near(hp - z.hp, 10 * (1 + e.power / 100)));
  hp = z.hp; h.applyHit({ team: "ally", def: { dmg: 14 } }, z, 14);
  ok(`${label}: power turret 14 -> ${hp - z.hp}`, near(hp - z.hp, 14 * (1 + e.power / 100)));
  hp = a.hp; h.applyHit(z, a, 10);
  ok(`${label}: zombie damage never boosted`, near(hp - a.hp, 10));
  // swift: attack cooldowns shrink for the player side only
  G.units = []; a = h.spawnUnit("cook", "ally", 400, 1); z = h.spawnUnit("cook", "zombie", 405, 1);
  a.cool = 0; z.cool = 0; z.hp = z.maxHp = 1e6; a.hp = a.maxHp = 1e6;
  h.updateUnit(a, 0.001); h.updateUnit(z, 0.001);
  ok(`${label}: swift ally cool ${a.cool}`, near(a.cool, a.def.rate / (1 + e.swift / 100)));
  ok(`${label}: swift zombie cool unchanged`, near(z.cool, z.def.rate));
  G.units = []; z = h.spawnUnit("cook", "zombie", 150, 1); z.x = 150; z.hp = 1e6; G._tc = 0; h.updateBaseTurret(0.001);
  ok(`${label}: swift base turret cd ${G._tc}`, near(G._tc, 0.9 / (1 + e.swift / 100)));
  // greed: settlement shards
  const s = h.computeSettlement();
  ok(`${label}: greed -> ${s.shards} shards for grade ${s.grade}`, s.shards === Math.round(GRADE[s.grade] * (1 + e.greed / 100)));
  // regen: +v every 2s of active battle time, capped at max, none while paused
  G.units = []; G.base = 50; G._regenT = 0; h.update(1);
  ok(`${label}: regen not before 2s`, G.base === 50);
  h.update(1.01);
  ok(`${label}: regen after 2s -> ${G.base}`, G.base === 50 + e.regen);
  G.base = G.baseMax - 0.5; G._regenT = 0; h.update(2.001);
  ok(`${label}: regen capped at max (${G.base}/${G.baseMax})`, G.base === (e.regen > 0 ? G.baseMax : G.baseMax - 0.5));
  G.base = 50; G._regenT = 0; G.paused = true;
  for (let t = 0; t <= 6000; t += 40) h.loop(t);
  ok(`${label}: no regen while paused`, G.base === 50);
  G.paused = false;
}

// ================================================================== 1. boot + shop + trade
sect("boot");
let r = start({ [ARCADE_KEY]: { coins: 30 }, [SAVE_KEY]: GAME_SAVE });
let { w, h, S, $, $$ } = r;
ok("script evaluated to the end (hook exposed)", !!h);
ok("ArcadeShop loaded", !!S);
ok("no load errors: " + r.errs.join(" | "), r.errs.length === 0);
ok("REBUILD save loaded (shards 7)", h.G.shards === 7);
ok("window.applyArcadeSkins / applyArcadeAbilities defined", typeof w.applyArcadeSkins === "function" && typeof w.applyArcadeAbilities === "function");
ok("CAPS.tradePerDay is 20", S.CAPS.tradePerDay === 20);
ok("ability bar mounted (0/3)", !!$(".as-bar") && $(".as-bar [data-count]").textContent === "0/3");

sect("shop buttons + pause");
const menuBtn = w.document.getElementById("openShop"), pauseBtn = w.document.getElementById("pauseShopBtn");
ok("menu shop button visible", menuBtn && menuBtn.style.display !== "none");
ok("pause shop button visible", pauseBtn && pauseBtn.style.display !== "none");
menuBtn.click();
ok("menu button opens shop", S.isOpen());
ok("Core Shards tab first: " + r.tabs().join(","), r.tabs()[0] === "🔷 Core Shards");
ok("tabs = shards, abilities, 3 skin tabs", JSON.stringify(r.tabs()) === JSON.stringify(["🔷 Core Shards", S.ABILITY_TAB, ...S.SKIN_TABS]));
ok("Codes tab absent from game shop", !r.tabs().includes(S.CODES_TAB) && !r.tabs().some((t) => /code/i.test(t)));
ok("Core Shards note shown", $(".as-cur").textContent.includes("permanent upgrades"));
$("[data-close]").click();
ok("shop closes", !S.isOpen());
h.startLevel(2);
ok("battle running, not paused", h.G.running && !h.G.paused);
pauseBtn.click();
ok("pause shop button opens shop and pauses battle", S.isOpen() && h.G.paused);
ok("pause overlay shown", w.document.getElementById("pauseOverlay").style.display !== "none");
const g0 = h.G.gold, t0 = h.G.time;
for (let t = 0; t <= 2000; t += 16) h.loop(t);
ok("battle frozen behind the shop", h.G.gold === g0 && h.G.time === t0);
S.close(); h.setPaused(false);
h.setPaused(true); S.open();
ok("opening while already paused keeps it paused", h.G.paused && S.isOpen());
S.close(); h.setPaused(false);

sect("Core Shards trade + 20/day cap");
h.G.running = false;
menuBtn.click();
$('[data-q="5"]').click(); $("[data-trade]").click();
ok("5 coins -> +300 shards (" + h.G.shards + ")", h.G.shards === 307);
ok("coins 30 -> 25", r.arcade().coins === 25);
ok("daily counter rebuild = 5", r.arcade().daily.day === todayKey() && r.arcade().daily.trade.rebuild === 5);
ok("tradeLeft = 15", S.tradeLeft("rebuild") === 15);
ok("shards saved to REBUILD save", JSON.parse(w.localStorage.getItem(SAVE_KEY)).shards === 307);
ok("menu counter refreshed", w.document.getElementById("mShards").textContent === "307");
ok("cap text 5 / 20", $(".as-cur").textContent.includes("5 / 20"));
const maxBtn = $$("[data-q]").find((b) => /Max/.test(b.textContent));
ok("Max button limited by cap (15)", maxBtn && maxBtn.dataset.q === "15");
const inp = $("[data-amount]"); inp.value = "99"; inp.dispatchEvent(new w.Event("input", { bubbles: true }));
ok("typing 99 clamps to 15", $("[data-trade]").textContent.includes("15"));
$("[data-trade]").click();
ok("traded 15 more -> 1207 shards", h.G.shards === 1207);
ok("coins 25 -> 10", r.arcade().coins === 10);
ok("daily counter = 20", r.arcade().daily.trade.rebuild === 20 && S.tradeLeft("rebuild") === 0);
ok("trade button disabled at cap", $("[data-trade]").disabled);
ok("cap reached message", $(".as-cur").textContent.includes("Daily trade cap reached"));
$("[data-trade]").disabled = false; $("[data-trade]").click();      // even a forced click must not trade
ok("forced click past the cap trades nothing", h.G.shards === 1207 && r.arcade().coins === 10);
S.close();
h.G.shards = 0; h.loadGame();
ok("shards survive loadGame", h.G.shards === 1207);
ok("no runtime errors: " + r.errs.join(" | "), r.errs.length === 0);

sect("trade cap persistence + daily reset");
r = start({ [ARCADE_KEY]: { coins: 30, daily: { day: todayKey(), play: 0, bugs: 0, trade: { rebuild: 20 } } }, [SAVE_KEY]: GAME_SAVE });
r.S.open(); r.$("[data-trade]").click();
ok("reload with today's counter at 20: nothing traded", r.h.G.shards === 7 && r.arcade().coins === 30);
ok("other games' counters independent", r.S.tradeLeft("monster-city") === 20);
r.S.close();
r = start({ [ARCADE_KEY]: { coins: 30, daily: { day: "2000-1-1", play: 0, bugs: 0, trade: { rebuild: 20 } } }, [SAVE_KEY]: GAME_SAVE });
ok("old day's counter resets", r.S.tradeLeft("rebuild") === 20);
r.S.open(); r.$('[data-q="10"]').click(); r.$("[data-trade]").click();
ok("trade works after reset", r.h.G.shards === 607 && r.arcade().daily.day === todayKey() && r.arcade().daily.trade.rebuild === 10);
r.S.close();

// ================================================================== 2. abilities
sect("baseline: no abilities");
r = start({ [SAVE_KEY]: GAME_SAVE });
checkEffects(r, {}, "none");

sect("pass A: active = tough, power, swift");
r = start({ [ARCADE_KEY]: { coins: 100, abilities: LV, active: { rebuild: ["rebuild:tough", "rebuild:power", "rebuild:swift"] } }, [SAVE_KEY]: GAME_SAVE });
checkEffects(r, { tough: 20, power: 24, swift: 6 }, "A");
ok("A: no errors: " + r.errs.join(" | "), r.errs.length === 0);

sect("pass B: active = greed, regen, energy");
r = start({ [ARCADE_KEY]: { coins: 100, abilities: LV, active: { rebuild: ["rebuild:greed", "rebuild:regen", "rebuild:energy"] } }, [SAVE_KEY]: GAME_SAVE });
checkEffects(r, { greed: 20, regen: 1, energy: 10 }, "B");
ok("B: no errors: " + r.errs.join(" | "), r.errs.length === 0);

sect("3-slot limit");
r = start({ [ARCADE_KEY]: { coins: 100, abilities: LV }, [SAVE_KEY]: GAME_SAVE });
ok("no `active` -> first 3 learned on", abEq(r.h, { tough: 20, power: 24, swift: 6 }));
ok("activeIds length 3", r.S.activeIds("rebuild").length === 3 && r.S.ACTIVE_SLOTS === 3);
r = start({ [ARCADE_KEY]: { coins: 100, abilities: LV, active: { rebuild: ["rebuild:regen", "rebuild:greed", "rebuild:energy", "rebuild:tough", "rebuild:power"] } }, [SAVE_KEY]: GAME_SAVE });
ok("5 ids stored -> only first 3 count", abEq(r.h, { regen: 1, greed: 20, energy: 10 }));
r = start({ [ARCADE_KEY]: { coins: 100, abilities: { "rebuild:power": 1 }, active: { rebuild: ["rebuild:tough", "rebuild:power"] } }, [SAVE_KEY]: GAME_SAVE });
ok("unlearned id in active is ignored", abEq(r.h, { power: 8 }));

sect("ability bar toggles (live)");
r = start({ [ARCADE_KEY]: { coins: 100, abilities: LV, active: { rebuild: ["rebuild:greed", "rebuild:regen", "rebuild:energy"] } }, [SAVE_KEY]: GAME_SAVE });
({ w, h, S, $, $$ } = r);
h.startLevel(2);
$(".as-bar .tab").click();
ok("bar opens with 6 chips, 3 on", $$(".as-bar [data-toggle]").length === 6 && $$(".as-bar .chip.on").length === 3);
ok("bar count 3/3", $(".as-bar [data-count]").textContent === "3/3");
ok("4th chip disabled while 3 are on", $('.as-bar [data-toggle="rebuild:tough"]').disabled);
$('.as-bar [data-toggle="rebuild:tough"]').disabled = false; $('.as-bar [data-toggle="rebuild:tough"]').click();
ok("forcing a 4th on is refused", r.arcade().active.rebuild.length === 3 && !r.arcade().active.rebuild.includes("rebuild:tough"));
ok("refused toggle keeps values", abEq(h, { greed: 20, regen: 1, energy: 10 }));
$('.as-bar [data-toggle="rebuild:energy"]').click();
ok("toggle energy off -> stored [greed, regen]", JSON.stringify(r.arcade().active.rebuild) === '["rebuild:greed","rebuild:regen"]');
ok("toggle off applies live: " + JSON.stringify(h.ARCADE_AB), abEq(h, { greed: 20, regen: 1 }));
$('.as-bar [data-toggle="rebuild:tough"]').click();
ok("toggle tough on applies live: " + JSON.stringify(h.ARCADE_AB), abEq(h, { greed: 20, regen: 1, tough: 20 }));
ok("tough on mid-battle: base 120/120", h.G.baseMax === 120 && h.G.base === 120);
$('.as-bar [data-toggle="rebuild:tough"]').click();
ok("tough off mid-battle: max back to 100, base clamped", h.G.baseMax === 100 && h.G.base === 100);
ok("bar toggles: no errors: " + r.errs.join(" | "), r.errs.length === 0);

sect("live upgrades (shop buy + applyArcadeAbilities)");
r = start({ [ARCADE_KEY]: { coins: 100, abilities: { "rebuild:tough": 2, "rebuild:power": 3 }, active: { rebuild: ["rebuild:tough", "rebuild:power"] } }, [SAVE_KEY]: GAME_SAVE });
({ w, h, S, $, $$ } = r);
h.startLevel(2);
ok("start: tough 20 power 24, base 120", abEq(h, { tough: 20, power: 24 }) && h.G.baseMax === 120);
h.G.base = 100;
w.document.getElementById("pauseShopBtn").click();
r.clickTab(/Abilit/);
const ids = $$("[data-lvl]").map((b) => b.dataset.lvl);
ok("ability tab lists only rebuild abilities: " + ids, ids.length === 6 && ids.every((i) => i.startsWith("rebuild:")));
ok("secret agent card shown locked", /Agent Protocol/.test($(".as-items").textContent) && /Find all/.test($(".as-items").textContent));
$('[data-lvl="rebuild:tough"]').click();
ok("buy tough lv3 mid-battle -> max 130, base +10", h.ARCADE_AB.tough === 30 && h.G.baseMax === 130 && h.G.base === 110);
ok("coins spent (100 - 6)", r.arcade().coins === 94);
$('[data-lvl="rebuild:regen"]').click();
ok("learn regen -> auto-switched on (3rd slot)", h.ARCADE_AB.regen === 1 && r.arcade().active.rebuild.includes("rebuild:regen"));
$('[data-lvl="rebuild:greed"]').click();
ok("learn greed with 3 on -> learned but NOT active", r.arcade().abilities["rebuild:greed"] === 1 && !r.arcade().active.rebuild.includes("rebuild:greed") && h.ARCADE_AB.greed === 0);
ok("greed card says off", /off \(switch on/.test($('[data-lvl="rebuild:greed"]').closest(".as-ab").textContent));
S.close();
w.applyArcadeAbilities({ "rebuild:tough": 4, "rebuild:power": 5, "rebuild:regen": 1 });
ok("applyArcadeAbilities(levels): tough 40 power 40 regen 1", abEq(h, { tough: 40, power: 40, regen: 1 }));
ok("applyArcadeAbilities(levels): base max 140", h.G.baseMax === 140);
let z = h.spawnUnit("cook", "zombie", 600, 1), hp = z.hp; h.applyHit({ team: "ally" }, z, 10);
ok("live power applied to hits", near(hp - z.hp, 14));
w.applyArcadeAbilities();
ok("applyArcadeAbilities() re-reads storage (tough 30)", h.ARCADE_AB.tough === 30 && h.G.baseMax === 130);
w.dispatchEvent(new w.CustomEvent("arcade-abilities-changed", { detail: { "rebuild:tough": 1 } }));
ok("arcade-abilities-changed event refreshes", h.ARCADE_AB.tough === 10 && h.G.baseMax === 110);
w.applyArcadeAbilities();
ok("live upgrades: no errors: " + r.errs.join(" | "), r.errs.length === 0);

sect("secret agent ability");
r = start({ [ARCADE_KEY]: { abilities: { "rebuild:agent": 1 }, active: { rebuild: ["rebuild:agent"] } }, [SAVE_KEY]: GAME_SAVE });
ok("agent bonus = {energy:20, power:15, greed:25}", JSON.stringify(r.S.ABILITIES.find((a) => a.id === "rebuild:agent").bonus) === '{"energy":20,"power":15,"greed":25}');
checkEffects(r, { energy: 20, power: 15, greed: 25 }, "agent");
r = start({ [ARCADE_KEY]: { abilities: { ...LV, "rebuild:agent": 1 }, active: { rebuild: ["rebuild:agent", "rebuild:power", "rebuild:energy"] } }, [SAVE_KEY]: GAME_SAVE });
ok("agent stacks with normal abilities (power 39, energy 30, greed 25)", abEq(r.h, { power: 39, energy: 30, greed: 25 }));
r = start({ [ARCADE_KEY]: { abilities: { ...LV, "rebuild:agent": 1 }, active: { rebuild: ["rebuild:tough", "rebuild:power", "rebuild:swift"] } }, [SAVE_KEY]: GAME_SAVE });
ok("agent learned but switched off -> no bonus", abEq(r.h, { tough: 20, power: 24, swift: 6 }));
r.S.open(); r.clickTab(/Abilit/);
ok("agent card unlocked, shows off", /Unlocked/.test(r.$(".as-items").textContent) && /Agent Protocol[\s\S]*off \(switch on/.test(r.$(".as-items").textContent));
ok("agent cannot be bought", !r.$('[data-lvl="rebuild:agent"]'));
r.S.close();

sect("admin Super Mode");
r = start({ [ARCADE_KEY]: { admin: { super: true } }, [SAVE_KEY]: GAME_SAVE });
checkEffects(r, { tough: 50, power: 50, swift: 20, greed: 50, regen: 3, energy: 50 }, "super");
r = start({ [ARCADE_KEY]: { admin: { super: true }, abilities: LV, active: { rebuild: ["rebuild:greed", "rebuild:regen", "rebuild:energy"] } }, [SAVE_KEY]: GAME_SAVE });
ok("super adds to active abilities", abEq(r.h, { tough: 50, power: 50, swift: 20, greed: 70, regen: 4, energy: 60 }));
r.w.applyArcadeAbilities({ ...LV });
ok("super kept after applyArcadeAbilities(levels): " + JSON.stringify(r.h.ARCADE_AB), abEq(r.h, { tough: 50, power: 50, swift: 20, greed: 70, regen: 4, energy: 60 }));
r.S.update((s) => { s.admin.super = false; }); r.w.applyArcadeAbilities();
ok("super off -> back to plain abilities", abEq(r.h, { greed: 20, regen: 1, energy: 10 }));

sect("no stacking across saveGame/loadGame");
r = start({ [ARCADE_KEY]: { coins: 5, abilities: LV, active: { rebuild: ["rebuild:tough", "rebuild:energy", "rebuild:greed"] } }, [SAVE_KEY]: GAME_SAVE });
({ w, h } = r);
h.startLevel(2);
ok("start: base 120, gold 130", h.G.baseMax === 120 && h.G.base === 120 && h.G.gold === 130);
h.G.shards = 50; h.saveGame();
const saved = w.localStorage.getItem(SAVE_KEY);
ok("REBUILD save holds no ability data", !/tough|power|greed|regen|baseMax|ARCADE|abilit|rebuild:|coins/.test(saved));
for (let i = 0; i < 4; i++) { h.saveGame(); h.loadGame(); }
ok("shards unchanged by save/load", h.G.shards === 50);
ok("arcade wallet untouched", r.arcade().coins === 5);
h.startLevel(2);
ok("after save/load: still base 120, gold 130", h.G.baseMax === 120 && h.G.base === 120 && h.G.gold === 130);
for (let i = 0; i < 3; i++) w.applyArcadeAbilities();
ok("repeated refresh: no stacking", h.G.baseMax === 120 && h.G.base === 120 && h.ARCADE_AB.tough === 20);
ok("no-stack: no errors: " + r.errs.join(" | "), r.errs.length === 0);

// ================================================================== 3. skins
sect("skins: live apply + null restore");
r = start({ [SAVE_KEY]: GAME_SAVE });
({ w, h } = r);
const calls = r.calls;
ok("no skins by default", h.ARCADE_SKINS.gun === null && h.ARCADE_SKINS.ability === null && h.ARCADE_SKINS.bg === null);
h.startLevel(2);
w.applyArcadeSkins({ gun: { bullet: "#ff0000", glow: "#00ff00", trail: "#0000ff" }, ability: { primary: "#123456", secondary: "#654321" },
  bg: { sky: "#111111", fog: "#222222", ground: "#333333", light: "#444444" } });
h.G.fx = [];
h.projectile({ x: 100, y: 1, team: "ally", def: { color: "#abcdef" } }, 200, 1);
h.projectile({ x: 300, y: 1, team: "zombie", def: { color: "#fedcba" } }, 200, 1);
calls.styles.length = 0; calls.stops.length = 0; h.draw(1);
ok("gun skin: ally bullet uses skin colours", calls.styles.includes("#ff0000") && calls.styles.includes("#0000ff"));
ok("gun skin: zombie bullet keeps its colour", calls.styles.includes("#fedcba"));
ok("bg skin: sky gradient", calls.stops.includes("#111111"));
ok("bg skin: ground used", calls.stops.includes("#333333"));
let u = h.spawnUnit("guard", "ally", 150, 1); u.skillReady = true; let n0 = h.G.fx.length;
ok("skill fires", h.fireSkill(u));
let added = h.G.fx.slice(n0).filter((f) => f.color);
ok(`ability skin tints skill fx (${added.length})`, added.length > 0 && added.every((f) => f.color === "#123456" || f.color === "#654321"));
w.applyArcadeSkins({ gun: null, ability: null, bg: null });
ok("null slots -> all null", h.ARCADE_SKINS.gun === null && h.ARCADE_SKINS.ability === null && h.ARCADE_SKINS.bg === null);
calls.styles.length = 0; calls.stops.length = 0; h.G.fx = [];
h.projectile({ x: 100, y: 1, team: "ally", def: { color: "#abcdef" } }, 200, 1); h.draw(2);
ok("null gun restores unit colour", calls.styles.includes("#abcdef") && !calls.styles.includes("#ff0000"));
ok("null bg restores level sky", !calls.stops.includes("#111111") && !calls.stops.includes("#333333"));
u = h.spawnUnit("medic", "ally", 160, 2); u.skillReady = true; n0 = h.G.fx.length; h.fireSkill(u);
added = h.G.fx.slice(n0).filter((f) => f.color);
ok("null ability restores skill colours", added.every((f) => f.color !== "#123456" && f.color !== "#654321"));
w.applyArcadeSkins({ gun: { rainbow: true }, ability: { rainbow: true } });
ok("rainbow parsed", h.ARCADE_SKINS.gun.rainbow && h.ARCADE_SKINS.ability.rainbow);
h.draw(3);
w.applyArcadeSkins({ gun: { bullet: "red;evil" }, bg: { sky: "url(x)" } });
ok("invalid colours rejected", h.ARCADE_SKINS.gun === null && h.ARCADE_SKINS.bg === null);
w.applyArcadeSkins({ gun: { bullet: "#ff0000" }, ability: { primary: "#00ff00" }, bg: { sky: "#101020" } });
for (let i = 0; i < 200; i++) { h.update(0.05); h.draw(i * 0.05); }
ok("200 frames with skins: no errors: " + r.errs.join(" | "), r.errs.length === 0);

sect("skins: shop equip applies live");
r = start({ [ARCADE_KEY]: { coins: 10 }, [SAVE_KEY]: GAME_SAVE });
r.S.open(); r.clickTab(/Gun Skins/);
r.$('[data-buy="gun-gold-rush"]').click();
ok("buying Gold Rush applies it live", r.h.ARCADE_SKINS.gun && r.h.ARCADE_SKINS.gun.bullet === "#ffd24a");
ok("skin shared to localStorage", JSON.parse(r.w.localStorage.getItem(SKINS_KEY)).gun.bullet === "#ffd24a");
r.$('[data-use="gun-none"]').click();
ok("equipping Normal -> gun null", r.h.ARCADE_SKINS.gun === null);
r.clickTab(/Backgrounds/); r.$('[data-buy^="bg-"]').click();
ok("buying a background applies it live", !!r.h.ARCADE_SKINS.bg);
r.S.close();

sect("skins: URL param + localStorage");
const sk = { gun: { id: "x", name: "X", bullet: "#ABCDEF", glow: "#000000", trail: "#111111", rainbow: false },
  ability: { primary: "#AA0000", secondary: "#00AA00" }, bg: { sky: "#010203", fog: "#040506", ground: "#070809", light: "#0a0b0c" } };
r = start({ [SAVE_KEY]: GAME_SAVE }, "?arcadeSkins=" + encodeURIComponent(JSON.stringify(sk)));
ok("URL: gun", r.h.ARCADE_SKINS.gun && r.h.ARCADE_SKINS.gun.bullet === "#abcdef");
ok("URL: ability", r.h.ARCADE_SKINS.ability && r.h.ARCADE_SKINS.ability.primary === "#aa0000");
ok("URL: bg", r.h.ARCADE_SKINS.bg && r.h.ARCADE_SKINS.bg.sky === "#010203");
r.h.startLevel(2); r.calls.stops.length = 0; r.h.draw(1);
ok("URL bg drawn", r.calls.stops.includes("#010203"));
r = start({ [SKINS_KEY]: sk, [SAVE_KEY]: GAME_SAVE });
ok("localStorage: gun/ability/bg", r.h.ARCADE_SKINS.gun.bullet === "#abcdef" && r.h.ARCADE_SKINS.ability.secondary === "#00aa00" && r.h.ARCADE_SKINS.bg.ground === "#070809");
r = start({ [SKINS_KEY]: sk, [SAVE_KEY]: GAME_SAVE }, "?arcadeSkins=" + encodeURIComponent(JSON.stringify({ gun: { bullet: "#123123" } })));
ok("URL param wins over localStorage", r.h.ARCADE_SKINS.gun.bullet === "#123123" && r.h.ARCADE_SKINS.bg === null);
r.w.applyArcadeSkins();
ok("applyArcadeSkins() with no arg re-reads localStorage", r.h.ARCADE_SKINS.gun.bullet === "#abcdef");
r = start({ [SKINS_KEY]: "not json{", [SAVE_KEY]: GAME_SAVE });
ok("garbage in localStorage -> normal look, no errors", r.h.ARCADE_SKINS.gun === null && r.errs.length === 0);

// ================================================================== 4. codes / secret corner
sect("Codes tab + secret corner absent");
r = start({ [ARCADE_KEY]: { coins: 3 }, [SAVE_KEY]: GAME_SAVE });
let secretCalled = false; r.w.arcadeSecret = () => { secretCalled = true; };
r.S.open({ tab: r.S.CODES_TAB });
ok("open({tab: Codes}) falls back to first tab", r.$(".as-tabs button.on").textContent === "🔷 Core Shards");
ok("no Codes tab button", !r.tabs().includes(r.S.CODES_TAB));
for (const t of r.tabs()) {
  r.clickTab(new RegExp("^" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
  ok(`tab "${t}": no code box / secret corner`, !r.$("[data-code]") && !r.$("[data-redeem]") && !r.$("[data-secret]") && !r.$(".as-secret"));
}
r.S.close();
r.w.document.getElementById("openShop").click();
ok("menu shop: no Codes tab", !r.tabs().includes(r.S.CODES_TAB));
r.S.close();
r.$(".as-bar .tab").click(); r.$(".as-bar .shop").click();
ok("bar's shop button opens Abilities, no Codes tab", r.S.isOpen() && r.$(".as-tabs button.on").textContent === r.S.ABILITY_TAB && !r.tabs().includes(r.S.CODES_TAB));
ok("secret never triggered", !secretCalled);
r.S.close();

sect("without arcade-shop.js");
r = start({ [SAVE_KEY]: GAME_SAVE }, "", { withShop: false });
ok("game boots without the shop", !!r.h && r.errs.length === 0);
ok("shop buttons hidden", r.w.document.getElementById("openShop").style.display === "none" && r.w.document.getElementById("pauseShopBtn").style.display === "none");
ok("abilities all 0", abEq(r.h, {}));
r.h.startLevel(2);
ok("plain battle: base 100, gold 120", r.h.G.baseMax === 100 && r.h.G.gold === 120);

// ------------------------------------------------------------------ summary
for (const win of opened) { try { win.close(); } catch {} }
console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(fail ? `ARCADE TEST FAIL (${fail})` : "ARCADE TEST PASS");
process.exit(fail ? 1 : 0);
