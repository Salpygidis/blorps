import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../server/game.js";
import { applyBotAction, chooseBotAction } from "../server/bot.js";
import { START_SLIME, WIN_SLIME, SLIME_DROP_COLOR } from "../shared/constants.js";
import { tally } from "../shared/score.js";
import { faceStep } from "../shared/hex.js";

function lineBoard() {
  const hexes = [];
  for (let q = 0; q <= 8; q++) hexes.push({ q, r: 0, terrain: "open" });
  hexes.push({ q: 1, r: -1, terrain: "open" });
  hexes.push({ q: 2, r: -1, terrain: "open" });
  hexes.push({ q: 3, r: -1, terrain: "tree" });
  hexes.push({ q: 4, r: -1, terrain: "open" });
  hexes.push({ q: 2, r: 1, terrain: "water" });
  return hexes;
}

function twoPlayers(extra = {}) {
  return Game.testHarness({
    hexes: lineBoard(),
    players: [
      { id: "a", name: "Pip", q: 0, r: 0, slime: START_SLIME },
      { id: "b", name: "Goo", q: 8, r: 0, slime: START_SLIME },
    ],
    ...extra,
  });
}

describe("core rules", () => {
  it("gives a random player the first turn and one fewer point", () => {
    const lobby = [
      { id: "a", name: "Pip" },
      { id: "b", name: "Goo" },
      { id: "c", name: "Nub" },
    ];
    const seen = new Set();
    for (let i = 0; i < 24; i++) {
      const g = Game.fromLobby(lobby, `SEED${i}`);
      const first = g.current();
      seen.add(first.id);
      assert.equal(first.slime, START_SLIME - 1);
      assert.equal(tally(first).points, START_SLIME - 1);
      for (const player of g.actors()) {
        if (player.id !== first.id) assert.equal(player.slime, START_SLIME);
      }
      assert.equal(g.events.some((ev) => ev.type === "firstPlayer" && ev.playerId === first.id), true);
    }
    assert.ok(seen.size > 1);
    const again = Game.fromLobby(lobby, "SEED0");
    const once = Game.fromLobby(lobby, "SEED0");
    assert.equal(again.current().id, once.current().id);
  });

  it("drops a slime token on the first hex of a move and shrinks", () => {
    const g = twoPlayers();
    const r = g.clickHex("a", 1, 0);
    assert.equal(r.ok, true);
    assert.equal(g.slimes.length, 1);
    assert.equal(g.slimes[0].q, 1);
    assert.equal(g.slimes[0].color, SLIME_DROP_COLOR);
    assert.equal(g.playerById("a").slime, START_SLIME - 1);
    assert.equal(g.playerById("a").q, 1);
    assert.equal(g.remainingMove, 1);
  });

  it("absorbs an existing slime then drops, granting a free bounce", () => {
    const g = twoPlayers({
      slimes: [{ id: "s1", q: 1, r: 0, ownerId: "b", color: "#fff" }],
    });
    g.clickHex("a", 1, 0);
    assert.equal(g.phase, "bounce");
    assert.equal(g.slimes.length, 1);
    assert.equal(g.slimes[0].ownerId, "a");
    assert.equal(g.playerById("a").slime, START_SLIME);
    const bounce = g.events.find((e) => e.type === "freeBounce");
    assert.equal(bounce.reason, "slime");
    assert.equal(bounce.range, 2);
  });

  it("picks up a slime on any landing, not only the first hex", () => {
    const g = twoPlayers({
      slimes: [{ id: "s1", q: 2, r: 0, ownerId: "b", color: "#fff" }],
    });
    g.clickHex("a", 1, 0);
    assert.equal(g.phase, "move");
    assert.equal(g.slimes.some((s) => s.id === "s1"), true);
    assert.equal(g.playerById("a").slime, START_SLIME - 1);
    g.clickHex("a", 2, 0);
    assert.equal(g.phase, "bounce");
    assert.equal(g.slimes.some((s) => s.id === "s1"), false);
    assert.equal(g.playerById("a").slime, START_SLIME);
    assert.equal(g.events.find((e) => e.type === "freeBounce").range, 2);
  });

  it("eats fruit for +1 / +2 and does not respawn it", () => {
    const g = twoPlayers({
      fruits: [
        { id: "ap", q: 1, r: 0, type: "apple", value: 1 },
        { id: "gr", q: 2, r: 0, type: "grapes", value: 2 },
      ],
    });
    g.clickHex("a", 1, 0);
    assert.equal(g.playerById("a").slime, START_SLIME - 1);
    assert.deepEqual(g.playerById("a").basket.map((f) => f.type), ["apple"]);
    assert.equal(tally(g.playerById("a")).points, START_SLIME - 1 + 1);
    assert.equal(g.fruits.length, 1);
    assert.equal(g.toJSON().fruits.some((f) => f.id === "ap"), false);
    g.clickHex("a", 2, 0);
    assert.equal(g.playerById("a").slime, START_SLIME - 1);
    assert.equal(tally(g.playerById("a")).points, START_SLIME - 1 + 1 + 2);
    assert.equal(g.fruits.length, 0);
    assert.equal(g.toJSON().fruits.length, 0);
    assert.equal(g.current().id, "b");
    g.playerById("a").q = 1;
    g.playerById("a").r = 0;
    g.beginTurn(0);
    const after = g.playerById("a").slime;
    g.clickHex("a", 2, 0);
    assert.equal(g.fruitAt(2, 0), null);
    assert.equal(g.playerById("a").slime, after - 1);
  });

  it("picks up fruit on the hex where a bounce stops", () => {
    const g = twoPlayers({
      slimes: [{ id: "s1", q: 1, r: 0, ownerId: "b", color: "#fff" }],
      fruits: [{ id: "ap", q: 2, r: 0, type: "apple", value: 1 }],
    });
    g.clickHex("a", 1, 0);
    const before = g.playerById("a").slime;
    g.clickHex("a", 2, 0);
    assert.equal(g.fruits.length, 0);
    assert.equal(g.playerById("a").q, 2);
    assert.equal(g.playerById("a").slime, before);
    assert.equal(g.playerById("a").basket[0].type, "apple");
  });

  it("leaves fruit and slime behind when a bounce flies over them", () => {
    const g = twoPlayers({
      slimes: [
        { id: "s1", q: 1, r: 0, ownerId: "b", color: "#fff" },
        { id: "s2", q: 2, r: 0, ownerId: "b", color: "#fff" },
      ],
      fruits: [{ id: "ap", q: 2, r: 0, type: "apple", value: 1 }],
    });
    g.clickHex("a", 1, 0);
    assert.equal(g.phase, "bounce");
    g.clickHex("a", 3, 0);
    assert.equal(g.playerById("a").q, 3);
    assert.equal(g.fruits.length, 1);
    assert.equal(g.slimes.some((s) => s.id === "s2"), true);
    assert.notEqual(g.phase, "bounce");
  });

  it("only offers a free bounce in a straight line", () => {
    const g = twoPlayers();
    g.phase = "bounce";
    g.phaseData = { reason: "slime" };
    const legal = g.legalHexes();
    assert.equal(legal.some((h) => h.q === 2 && h.r === 0), true);
    assert.equal(legal.some((h) => h.q === 1 && h.r === 0), true);
    // East, then a turn, is the open bend. The water at (2,1) is the same kind of turn.
    assert.equal(legal.some((h) => h.q === 2 && h.r === -1), false);
    assert.equal(legal.some((h) => h.q === 2 && h.r === 1), false);
    for (const h of legal) {
      const step = faceStep({ q: 0, r: 0 }, h);
      assert.ok(step && step.dist <= 2, `${h.q},${h.r}`);
    }
    assert.equal(g.clickHex("a", 2, -1).ok, false);
    assert.equal(g.clickHex("a", 2, 1).ok, false);
    assert.equal(g.playerById("a").q, 0);
  });

  it("bumps the next slime 1 hex when a bop lands on them", () => {
    const g = Game.testHarness({
      hexes: lineBoard(),
      players: [
        { id: "a", name: "Pip", q: 0, r: 0, slime: START_SLIME },
        { id: "b", name: "Goo", q: 1, r: 0, slime: 5 },
        { id: "c", name: "Blobbo", q: 3, r: 0, slime: 4 },
      ],
    });
    g.clickHex("a", 1, 0);
    assert.equal(g.events.some((e) => e.type === "handoff" && e.otherId === "b"), true);
    assert.equal(g.slimes.length, 0);
    g.chooseContact("a", "bop");
    assert.equal(g.legalHexes().some((h) => h.q === 3 && h.r === 0), true);
    assert.equal(g.legalHexes().some((h) => h.q === 4 && h.r === 0), false);
    assert.equal(g.clickHex("a", 3, 0).ok, true);
    assert.equal(g.playerById("b").q, 3);
    assert.equal(g.playerById("c").q, 4);
    // Landing handed Goo a slime, then the steal took it back.
    assert.equal(g.playerById("b").slime, 5);
    assert.equal(g.playerById("c").slime, 4);
    assert.equal(g.slimes.length, 0);
    assert.equal(g.events.filter((e) => e.type === "bop" && e.chain).length, 1);
    assert.equal(g.events.some((e) => e.type === "bopSteal" && e.targetId === "c"), false);

    const blocked = Game.testHarness({
      hexes: lineBoard().map((h) => (h.q === 4 ? { ...h, terrain: "tree" } : h)),
      players: [
        { id: "a", name: "Pip", q: 0, r: 0, slime: START_SLIME },
        { id: "b", name: "Goo", q: 1, r: 0, slime: 5 },
        { id: "c", name: "Blobbo", q: 3, r: 0, slime: 4 },
      ],
    });
    blocked.clickHex("a", 1, 0);
    blocked.chooseContact("a", "bop");
    assert.equal(blocked.legalHexes().some((h) => h.q === 3 && h.r === 0), false);
    assert.equal(blocked.clickHex("a", 3, 0).ok, false);
    assert.equal(blocked.playerById("b").q, 1);
    assert.equal(blocked.playerById("c").q, 3);
  });

  it("lets you bounce off another player or bop them", () => {
    const g = twoPlayers();
    g.playerById("b").q = 1;
    g.playerById("b").r = 0;
    g.playerById("b").slime = 5;
    g.clickHex("a", 1, 0);
    assert.equal(g.phase, "contact");
    g.chooseContact("a", "bop");
    assert.equal(g.phase, "bop");
    const dests = g.legalHexes();
    assert.ok(dests.length > 0);
    const push = dests.find((h) => h.q === 3 && h.r === 0) || dests[0];
    g.clickHex("a", push.q, push.r);
    assert.equal(g.playerById("b").q, push.q);
    assert.equal(g.playerById("a").slime, START_SLIME - 1 + 1);
    assert.equal(g.playerById("b").slime, 5);
    assert.equal(g.slimes.length, 0);
  });

  it("hands the first-move slime to the player you land on", () => {
    const g = twoPlayers({
      fruits: [{ id: "ap", q: 1, r: 0, type: "apple", value: 1 }],
      captures: [{ id: "c1", q: 1, r: 0, claimedBy: ["a", "b"] }],
    });
    g.playerById("b").q = 1;
    g.playerById("b").r = 0;
    g.playerById("b").slime = 5;
    g.clickHex("a", 1, 0);
    assert.equal(g.phase, "contact");
    assert.equal(g.slimes.length, 0);
    assert.equal(g.fruits.length, 0);
    assert.equal(g.playerById("a").basket[0].type, "apple");
    assert.equal(g.playerById("b").basket.length, 0);
    assert.equal(g.playerById("a").slime, START_SLIME - 1);
    assert.equal(g.playerById("b").slime, 6);
    assert.equal(g.playerById("a").q, 1);
    assert.equal(g.playerById("b").q, 1);
    assert.equal(g.captureAt(1, 0) != null, true);
    assert.equal(g.events.some((e) => e.type === "handoff" && e.otherId === "b"), true);
    assert.equal(g.events.some((e) => e.type === "drop"), false);
    assert.equal(g.uiHints().fruitCount, 0);

    const tiny = twoPlayers();
    tiny.playerById("a").slime = 1;
    tiny.playerById("b").q = 1;
    tiny.playerById("b").r = 0;
    tiny.playerById("b").slime = 4;
    tiny.clickHex("a", 1, 0);
    assert.equal(tiny.playerById("a").slime, 1);
    assert.equal(tiny.playerById("b").slime, 5);
    assert.equal(tiny.slimes.length, 0);

    const win = twoPlayers();
    win.playerById("b").q = 1;
    win.playerById("b").r = 0;
    win.playerById("b").slime = WIN_SLIME - 1;
    win.clickHex("a", 1, 0);
    assert.equal(win.status, "finished");
    assert.equal(win.winnerId, "b");
    assert.equal(win.phase, "over");
    assert.equal(win.playerById("b").slime, WIN_SLIME);
    assert.equal(win.slimes.length, 0);

    const later = twoPlayers();
    later.clickHex("a", 1, 0);
    assert.equal(later.slimes.length, 1);
    later.playerById("b").q = 2;
    later.playerById("b").r = 0;
    const bSlime = later.playerById("b").slime;
    later.clickHex("a", 2, 0);
    assert.equal(later.phase, "contact");
    assert.equal(later.playerById("b").slime, bSlime);
    assert.equal(later.events.some((e) => e.type === "handoff"), false);
    assert.equal(later.slimes.length, 1);
    assert.equal(later.slimes[0].q, 1);
  });

  it("lets a bop take a random fruit instead of a slime", () => {
    const g = twoPlayers();
    g.playerById("b").q = 1;
    g.playerById("b").r = 0;
    g.playerById("b").slime = 5;
    g.playerById("b").basket = [
      { id: "ba", type: "banana" },
      { id: "gr", type: "grapes" },
    ];
    g.clickHex("a", 1, 0);
    assert.equal(g.uiHints().fruitCount, 2);
    const aSlime = g.playerById("a").slime;
    const bSlime = g.playerById("b").slime;
    g.chooseContact("a", "bop-fruit");
    assert.equal(g.phase, "bop");
    assert.equal(g.uiHints().steal, "fruit");
    g.clickHex("a", 3, 0);
    assert.equal(g.playerById("b").q, 3);
    assert.equal(g.playerById("a").slime, aSlime);
    assert.equal(g.playerById("b").slime, bSlime);
    assert.equal(g.playerById("a").basket.length, 1);
    assert.equal(g.playerById("b").basket.length, 1);
    const taken = g.playerById("a").basket[0];
    assert.ok(taken.id === "ba" || taken.id === "gr");
    assert.equal(
      g.playerById("b").basket.some((f) => f.id === taken.id),
      false
    );
    const steal = g.events.find((e) => e.type === "bopSteal");
    assert.equal(steal.stolen, 0);
    assert.equal(steal.fruit, taken.type);
    assert.equal(steal.armored, undefined);

    const empty = twoPlayers();
    empty.playerById("b").q = 1;
    empty.playerById("b").r = 0;
    empty.playerById("b").slime = 5;
    empty.clickHex("a", 1, 0);
    const emptyA = empty.playerById("a").slime;
    const emptyB = empty.playerById("b").slime;
    empty.chooseContact("a", "bop-fruit");
    empty.clickHex("a", 3, 0);
    assert.equal(empty.playerById("b").q, 3);
    assert.equal(empty.playerById("a").basket.length, 0);
    assert.equal(empty.playerById("a").slime, emptyA);
    assert.equal(empty.playerById("b").slime, emptyB);
    assert.equal(empty.events.find((e) => e.type === "bopSteal").fruit, null);

    const armor = twoPlayers();
    armor.playerById("b").q = 1;
    armor.playerById("b").r = 0;
    armor.playerById("b").slime = 5;
    armor.playerById("b").basket = [{ id: "ap", type: "apple" }];
    armor.playerById("b").upgrades.push({ id: "gooarmor" });
    armor.clickHex("a", 1, 0);
    armor.chooseContact("a", "bop-fruit");
    armor.clickHex("a", 2, 0);
    assert.equal(armor.playerById("b").q, 2);
    assert.equal(armor.playerById("b").basket[0].type, "apple");
    assert.equal(armor.playerById("a").basket.length, 0);
    assert.equal(armor.playerById("b").slime, 6);
    assert.equal(armor.events.find((e) => e.type === "bopSteal").armored, true);
    assert.equal(armor.events.find((e) => e.type === "bopSteal").stolen, 0);
  });

  it("announces a free bounce when you bounce off a player", () => {
    const g = twoPlayers();
    g.playerById("b").q = 1;
    g.playerById("b").r = 0;
    g.clickHex("a", 1, 0);
    g.chooseContact("a", "bounce");
    assert.equal(g.phase, "bounce");
    const bounce = g.events.find((e) => e.type === "freeBounce");
    assert.equal(bounce.reason, "player");
    assert.equal(bounce.otherName, "Goo");
    assert.equal(bounce.range, 2);
    assert.equal(g.toJSON().ui.reason, "player");
    assert.equal(g.toJSON().ui.otherName, "Goo");
    assert.equal(g.legalHexes().some((h) => h.q === 3 && h.r === 0), true);
    assert.equal(g.legalHexes().some((h) => h.q === 2 && h.r === 1), false);
  });

  it("charges 2 moves to step up, and 1 for a big slime", () => {
    const g = twoPlayers();
    g.hexes["1,0"].elevation = 1;
    assert.equal(g.legalHexes().some((h) => h.q === 1 && h.r === 0), true);
    g.clickHex("a", 1, 0);
    assert.equal(g.playerById("a").q, 1);
    assert.equal(g.current().id, "b");

    const down = twoPlayers();
    down.hexes["1,0"].elevation = 1;
    down.playerById("a").q = 1;
    down.beginTurn(0);
    down.clickHex("a", 2, 0);
    assert.equal(down.playerById("a").q, 2);
    assert.equal(down.remainingMove, 1);
    assert.equal(down.current().id, "a");

    const short = twoPlayers();
    short.clickHex("a", 1, 0);
    short.hexes["2,0"].elevation = 1;
    assert.equal(short.legalHexes().some((h) => h.q === 2 && h.r === 0), false);
    assert.equal(short.clickHex("a", 2, 0).ok, false);
    assert.equal(short.playerById("a").q, 1);
    assert.equal(short.legalHexes().some((h) => h.q === 1 && h.r === -1), true);

    const big = twoPlayers();
    big.playerById("a").slime = 6;
    big.hexes["1,0"].elevation = 1;
    big.beginTurn(0);
    assert.equal(big.remainingMove, 1);
    assert.equal(big.legalHexes().some((h) => h.q === 1 && h.r === 0), true);
    big.clickHex("a", 1, 0);
    assert.equal(big.playerById("a").q, 1);
    assert.equal(big.current().id, "b");

    const climbOut = twoPlayers();
    climbOut.hexes["2,1"].elevation = -1;
    climbOut.playerById("a").q = 2;
    climbOut.playerById("a").r = 1;
    climbOut.beginTurn(0);
    climbOut.clickHex("a", 2, 0);
    assert.equal(climbOut.playerById("a").r, 0);
    assert.equal(climbOut.current().id, "b");
  });

  it("drops movement from 2 to 1 at size 6", () => {
    const g = twoPlayers();
    g.playerById("a").slime = 6;
    g.beginTurn(0);
    assert.equal(g.remainingMove, 1);
    g.playerById("a").upgrades.push({ id: "zoomies" });
    g.beginTurn(0);
    assert.equal(g.remainingMove, 1);
    g.clickHex("a", 1, 0);
    assert.equal(g.current().id, "b");
  });

  it("draws one deck card from a new crystal and will not draw it again", () => {
    const g = twoPlayers({
      captures: [{ id: "c1", q: 1, r: 0, claimedBy: [] }],
    });
    const before = g.playerById("a").slime;
    const deckBefore = g.upgradeDeck.length;
    g.clickHex("a", 1, 0);
    assert.equal(g.phase, "upgrade");
    assert.equal(g.playerById("a").slime, before - 1);
    assert.equal(g.playerById("a").upgrades.length, 1);
    assert.equal(g.upgradeDeck.length, deckBefore - 1);
    assert.equal(g.events.find((e) => e.type === "capture").card.name, g.playerById("a").upgrades[0].name);
    g.ackUpgrade("a");
    g.clickHex("a", 2, 0);
    assert.equal(g.current().id, "b");
    g.playerById("a").q = 0;
    g.playerById("a").r = 0;
    g.beginTurn(0);
    const deckAfter = g.upgradeDeck.length;
    g.clickHex("a", 1, 0);
    assert.notEqual(g.phase, "upgrade");
    assert.equal(g.playerById("a").upgrades.length, 1);
    assert.equal(g.upgradeDeck.length, deckAfter);
    assert.equal(g.events.some((e) => e.type === "capture"), false);

    g.playerById("b").q = 0;
    g.playerById("b").r = 0;
    g.beginTurn(1);
    g.clickHex("b", 1, 0);
    assert.equal(g.phase, "upgrade");
    assert.equal(g.playerById("b").upgrades.length, 1);
    assert.ok(g.captures[0].claimedBy.includes("a"));
    assert.ok(g.captures[0].claimedBy.includes("b"));
  });

  it("wins at 10 slime points", () => {
    const g = twoPlayers({
      fruits: [{ id: "gr", q: 1, r: 0, type: "grapes", value: 2 }],
    });
    g.playerById("a").slime = WIN_SLIME - 1;
    g.clickHex("a", 1, 0);
    assert.equal(g.status, "finished");
    assert.equal(g.winnerId, "a");
    assert.equal(g.playerById("a").slime, WIN_SLIME - 1);
    assert.equal(g.playerById("a").basket[0].type, "grapes");
    assert.equal(tally(g.playerById("a")).points, WIN_SLIME + 1);
  });

  it("rejects spectator actions and off-turn clicks", () => {
    const g = twoPlayers();
    g.players.push({
      id: "s",
      name: "Eye",
      isSpectator: true,
      connected: true,
      q: 0,
      r: 0,
      slime: 0,
      upgrades: [],
      claimedCaptures: [],
      color: { hex: "#999" },
    });
    assert.equal(g.clickHex("s", 1, 0).ok, false);
    assert.equal(g.clickHex("b", 7, 0).ok, false);
  });

  it("blocks trees unless Treehopper bounces over them", () => {
    const g = twoPlayers();
    g.playerById("a").q = 2;
    g.playerById("a").r = -1;
    g.beginTurn(0);
    assert.equal(
      g.legalHexes().some((h) => h.q === 3 && h.r === -1),
      false
    );
    const blocked = g.clickHex("a", 3, -1);
    assert.equal(blocked.ok, false);
    assert.equal(g.playerById("a").q, 2);
    assert.equal(g.playerById("a").r, -1);

    g.phase = "bounce";
    g.phaseData = { reason: "slime" };
    const without = g.legalHexes();
    assert.equal(
      without.some((h) => h.q === 3 && h.r === -1),
      false
    );
    assert.equal(
      without.some((h) => h.q === 4 && h.r === -1),
      false
    );
    g.playerById("a").upgrades.push({ id: "treehopper" });
    const withUp = g.legalHexes();
    assert.equal(
      withUp.some((h) => h.q === 3 && h.r === -1),
      false
    );
    assert.equal(
      withUp.some((h) => h.q === 4 && h.r === -1),
      true
    );
    assert.equal(g.clickHex("a", 3, -1).ok, false);
    assert.equal(g.playerById("a").q, 2);
    assert.equal(g.clickHex("a", 4, -1).ok, true);
    assert.equal(g.playerById("a").q, 4);
    assert.equal(g.playerById("a").r, -1);
  });

  it("cannot bop a Blorp onto a tree", () => {
    const g = twoPlayers();
    g.playerById("a").q = 2;
    g.playerById("a").r = -1;
    g.playerById("b").q = 2;
    g.playerById("b").r = 0;
    g.playerById("b").slime = 5;
    g.beginTurn(0);
    g.clickHex("a", 2, 0);
    assert.equal(g.phase, "contact");
    g.chooseContact("a", "bop");
    assert.equal(
      g.legalHexes().some((h) => h.q === 3 && h.r === -1),
      false
    );
    const pushed = g.clickHex("a", 3, -1);
    assert.equal(pushed.ok, false);
    assert.equal(g.playerById("b").q, 2);
    assert.equal(g.playerById("b").r, 0);
  });

  it("does not leave a slime token on a tree, fruit, a token, or another player", () => {
    const g = twoPlayers({
      fruits: [{ id: "ap", q: 1, r: 0, type: "apple" }],
      slimes: [{ id: "s1", q: 2, r: 0, ownerId: "b", color: "#fff" }],
      captures: [{ id: "c1", q: 4, r: 0, claimedBy: [] }],
    });
    g.playerById("b").q = 3;
    g.playerById("b").r = 0;
    g.placeSlime(g.playerById("a"), 3, -1);
    g.placeSlime(g.playerById("a"), 1, 0);
    g.placeSlime(g.playerById("a"), 2, 0);
    g.placeSlime(g.playerById("a"), 3, 0);
    assert.equal(g.slimes.length, 1);
    assert.equal(g.slimes[0].id, "s1");
    g.placeSlime(g.playerById("a"), 4, 0);
    assert.equal(g.slimes.some((s) => s.q === 4 && s.r === 0), true);
  });

  it("will not let a crystal on a tree be entered or drawn", () => {
    const g = twoPlayers({
      captures: [{ id: "c1", q: 3, r: -1, claimedBy: [] }],
    });
    g.playerById("a").q = 2;
    g.playerById("a").r = -1;
    g.beginTurn(0);
    const res = g.clickHex("a", 3, -1);
    assert.equal(res.ok, false);
    assert.equal(g.playerById("a").q, 2);
    assert.equal(g.playerById("a").upgrades.length, 0);
    assert.equal(g.captures[0].claimedBy.length, 0);
  });

  it("Slip-n-Slide leaves water uphill for 1 move", () => {
    const g = twoPlayers();
    g.hexes["2,1"].elevation = -1;
    g.playerById("a").q = 2;
    g.playerById("a").r = 1;
    g.playerById("a").upgrades.push({ id: "slider" });
    g.beginTurn(0);
    assert.equal(g.remainingMove, 2);
    g.clickHex("a", 2, 0);
    assert.equal(g.playerById("a").q, 2);
    assert.equal(g.playerById("a").r, 0);
    assert.equal(g.remainingMove, 1);
    assert.equal(g.current().id, "a");
    assert.equal(g.phase, "move");
    const slide = g.events.find((e) => e.type === "slide");
    assert.ok(slide);
    assert.equal(slide.movement, undefined);

    g.clickHex("a", 2, 1);
    assert.equal(g.playerById("a").r, 1);
    assert.equal(g.events.some((e) => e.type === "slide"), false);
    assert.equal(g.current().id, "b");
  });

  it("Long Reach adds a move only while small", () => {
    const g = twoPlayers();
    g.playerById("a").upgrades.push({ id: "longreach" });
    g.beginTurn(0);
    assert.equal(g.remainingMove, 3);
    g.playerById("a").slime = 6;
    g.beginTurn(0);
    assert.equal(g.remainingMove, 1);
    g.playerById("a").upgrades.push({ id: "zoomies" });
    g.beginTurn(0);
    assert.equal(g.remainingMove, 1);
  });

  it("Zoomies opens with a straight 2-hex hop", () => {
    const g = twoPlayers({
      fruits: [{ id: "ap", q: 1, r: 0, type: "apple", value: 1 }],
    });
    g.playerById("a").upgrades.push({ id: "zoomies" });
    g.playerById("b").q = 1;
    g.playerById("b").r = 0;
    g.beginTurn(0);
    const legal = g.legalHexes();
    assert.equal(legal.some((h) => h.q === 2 && h.r === 0), true);
    assert.equal(legal.some((h) => h.q === 2 && h.r === -1), false);
    g.clickHex("a", 2, 0);
    assert.equal(g.playerById("a").q, 2);
    assert.equal(g.playerById("a").r, 0);
    assert.equal(g.remainingMove, 1);
    assert.equal(g.phase, "move");
    assert.equal(g.fruits.length, 1);
    assert.equal(g.playerById("b").q, 1);
    assert.equal(g.legalHexes().some((h) => h.q === 4 && h.r === 0), false);
    assert.equal(g.legalHexes().some((h) => h.q === 3 && h.r === 0), true);

    const blocked = twoPlayers();
    blocked.playerById("a").upgrades.push({ id: "zoomies" });
    blocked.hexes["1,0"].terrain = "tree";
    blocked.beginTurn(0);
    assert.equal(blocked.legalHexes().some((h) => h.q === 2 && h.r === 0), false);
  });

  it("fruit cards score the tray, and every card is worth 1", () => {
    const g = twoPlayers({
      fruits: [
        { id: "a1", q: 1, r: 0, type: "apple", value: 1 },
        { id: "a2", q: 2, r: 0, type: "apple", value: 1 },
      ],
    });
    g.clickHex("a", 1, 0);
    g.clickHex("a", 2, 0);
    const pip = g.playerById("a");
    assert.equal(pip.slime, START_SLIME - 1);
    assert.equal(tally(pip).points, START_SLIME - 1 + 2);
    pip.upgrades.push({ id: "applefan", name: "Apple Fan", emoji: "🍎", desc: "+1 per apple" });
    const scored = tally(pip);
    assert.equal(scored.lines.find((line) => line.kind === "bonus").points, 2);
    assert.equal(scored.points, START_SLIME - 1 + 2 + 1 + 2);
    pip.upgrades.push({ id: "zoomies", name: "Zoomies", emoji: "💨" });
    assert.equal(tally(pip).points, START_SLIME - 1 + 2 + 1 + 2 + 1);
    assert.equal(g.toJSON().players.find((p) => p.id === "a").score, tally(pip).points);

    const own = twoPlayers({
      slimes: [{ id: "s1", q: 1, r: 0, ownerId: "a", color: "#fff" }],
    });
    own.playerById("a").upgrades.push({ id: "applefan", name: "Apple Fan", emoji: "🍎" });
    own.beginTurn(0);
    own.clickHex("a", 1, 0);
    assert.equal(own.events.find((e) => e.type === "absorbSlime").amount, 1);
    assert.equal(own.playerById("a").slime, START_SLIME);
    assert.equal(own.phase, "bounce");

    const held = twoPlayers({
      fruits: [{ id: "ap", q: 1, r: 0, type: "apple", value: 1 }],
    });
    held.playerById("a").upgrades.push({ id: "applefan", name: "Apple Fan", emoji: "🍎" });
    held.beginTurn(0);
    held.clickHex("a", 1, 0);
    assert.equal(held.events.find((e) => e.type === "absorbFruit").amount, 2);
    assert.equal(tally(held.playerById("a")).points, START_SLIME - 1 + 1 + 1 + 1);
  });

  it("Treehopper bops past a tree and the deck has one copy", () => {
    const deck = twoPlayers();
    const cards = [...deck.upgradeDeck, ...deck.upgradeDiscard];
    assert.equal(cards.length, 12);
    assert.equal(cards.filter((c) => c.id === "treehopper").length, 1);
    assert.equal(cards.filter((c) => c.id === "applefan").length, 1);
    assert.equal(cards.filter((c) => c.id === "bananabunch").length, 1);
    assert.equal(cards.filter((c) => c.id === "grapestomp").length, 1);
    assert.equal(cards.some((c) => c.id === "sweettooth" || c.id === "sponge"), false);

    const g = twoPlayers();
    g.hexes["3,0"].terrain = "tree";
    g.playerById("a").q = 1;
    g.playerById("b").q = 2;
    g.playerById("b").slime = 5;
    g.beginTurn(0);
    g.clickHex("a", 2, 0);
    g.chooseContact("a", "bop");
    assert.equal(g.legalHexes().some((h) => h.q === 4 && h.r === 0), false);
    assert.equal(g.legalHexes().some((h) => h.q === 3 && h.r === 0), false);

    g.playerById("a").upgrades.push({ id: "treehopper" });
    assert.equal(g.legalHexes().some((h) => h.q === 3 && h.r === 0), false);
    assert.equal(g.legalHexes().some((h) => h.q === 4 && h.r === 0), true);
    assert.equal(g.clickHex("a", 4, 0).ok, true);
    assert.equal(g.playerById("b").q, 4);
    assert.equal(g.playerById("b").r, 0);
  });

  it("Goo Armor shrugs off the first bop each round", () => {
    const g = twoPlayers();
    g.playerById("a").q = 1;
    g.playerById("a").upgrades.push({ id: "superbounce" });
    g.playerById("b").q = 2;
    g.playerById("b").slime = 5;
    g.playerById("b").upgrades.push({ id: "gooarmor" });
    g.beginTurn(0);
    g.clickHex("a", 2, 0);
    assert.equal(g.phase, "contact");
    g.chooseContact("a", "bop");
    assert.equal(g.uiHints().range, 1);
    assert.equal(g.legalHexes().some((h) => h.q === 3 && h.r === 0), true);
    assert.equal(g.legalHexes().some((h) => h.q === 4 && h.r === 0), false);
    assert.equal(g.legalHexes().some((h) => h.q === 5 && h.r === 0), false);
    g.clickHex("a", 3, 0);
    assert.equal(g.playerById("b").q, 3);
    assert.equal(g.playerById("b").slime, 6);
    assert.equal(g.playerById("a").slime, START_SLIME - 1);
    assert.equal(g.events.find((e) => e.type === "bopSteal").stolen, 0);
    assert.equal(g.events.find((e) => e.type === "bopSteal").armored, true);

    g.playerById("b").armorRound = g.roundIndex();
    g.slimes = [];
    g.playerById("a").q = 1;
    g.playerById("b").q = 2;
    g.playerById("b").r = 0;
    g.phase = "move";
    g.phaseData = {};
    g.movedThisTurn = true;
    g.remainingMove = 1;
    const aBefore = g.playerById("a").slime;
    g.clickHex("a", 2, 0);
    g.chooseContact("a", "bop");
    assert.equal(g.uiHints().range, 3);
    assert.equal(g.legalHexes().some((h) => h.q === 5 && h.r === 0), true);
    g.clickHex("a", 5, 0);
    assert.equal(g.playerById("b").q, 5);
    assert.equal(g.playerById("b").slime, 5);
    assert.equal(g.playerById("a").slime, aBefore + 1);
    assert.equal(g.events.find((e) => e.type === "bopSteal").stolen, 1);
  });

  it("a pushed Blorp collects the landing hex without dropping or bouncing", () => {
    const fruit = twoPlayers({
      fruits: [{ id: "ap", q: 3, r: 0, type: "apple", value: 1 }],
    });
    fruit.playerById("a").q = 1;
    fruit.playerById("b").q = 2;
    fruit.playerById("b").slime = 5;
    fruit.beginTurn(0);
    fruit.clickHex("a", 2, 0);
    fruit.chooseContact("a", "bop");
    fruit.clickHex("a", 3, 0);
    assert.equal(fruit.playerById("b").q, 3);
    assert.equal(fruit.fruits.length, 0);
    assert.equal(fruit.playerById("b").slime, 5);
    assert.equal(fruit.playerById("b").basket[0].type, "apple");
    assert.equal(tally(fruit.playerById("b")).points, 6);
    assert.equal(fruit.slimes.some((s) => s.q === 3 && s.r === 0), false);
    assert.equal(fruit.slimes.some((s) => s.ownerId === "b"), false);
    assert.equal(fruit.events.some((e) => e.type === "freeBounce"), false);
    assert.equal(fruit.events.find((e) => e.type === "absorbFruit").pushed, true);
    assert.notEqual(fruit.phase, "bounce");

    const token = twoPlayers({
      slimes: [{ id: "s1", q: 3, r: 0, ownerId: "b", color: "#fff" }],
    });
    token.playerById("a").q = 1;
    token.playerById("b").q = 2;
    token.playerById("b").slime = 5;
    token.beginTurn(0);
    token.clickHex("a", 2, 0);
    token.chooseContact("a", "bop");
    token.clickHex("a", 3, 0);
    assert.equal(token.events.find((e) => e.type === "absorbSlime").amount, 1);
    assert.equal(token.playerById("b").slime, 6);
    assert.equal(token.slimes.some((s) => s.id === "s1"), false);
    assert.equal(token.slimes.some((s) => s.q === 3), false);
    assert.equal(token.events.some((e) => e.type === "freeBounce"), false);
    assert.notEqual(token.phase, "bounce");

    const crystal = twoPlayers({
      captures: [{ id: "c1", q: 3, r: 0, claimedBy: [] }],
    });
    crystal.playerById("a").q = 1;
    crystal.playerById("b").q = 2;
    crystal.playerById("b").slime = 5;
    crystal.beginTurn(0);
    const deckBefore = crystal.upgradeDeck.length;
    crystal.clickHex("a", 2, 0);
    crystal.chooseContact("a", "bop");
    crystal.clickHex("a", 3, 0);
    assert.equal(crystal.playerById("b").upgrades.length, 1);
    assert.equal(crystal.playerById("a").upgrades.length, 0);
    assert.equal(crystal.upgradeDeck.length, deckBefore - 1);
    assert.equal(crystal.events.find((e) => e.type === "capture").playerId, "b");
    assert.equal(crystal.events.find((e) => e.type === "capture").pushed, true);
    assert.notEqual(crystal.phase, "upgrade");
    assert.equal(crystal.current().id, "a");

    const flown = twoPlayers({
      fruits: [{ id: "ap", q: 3, r: 0, type: "apple", value: 1 }],
    });
    flown.playerById("a").q = 1;
    flown.playerById("b").q = 2;
    flown.playerById("b").slime = 5;
    flown.beginTurn(0);
    flown.clickHex("a", 2, 0);
    flown.chooseContact("a", "bop");
    flown.clickHex("a", 4, 0);
    assert.equal(flown.playerById("b").q, 4);
    assert.equal(flown.fruits.length, 1);
    assert.equal(flown.playerById("b").slime, 5);
    assert.equal(flown.events.some((e) => e.type === "absorbFruit"), false);
  });

  it("super bounce lists destinations 3 hexes away", () => {
    const g = twoPlayers({
      slimes: [{ id: "s1", q: 1, r: 0, ownerId: "b", color: "#fff" }],
    });
    g.playerById("a").upgrades.push({ id: "superbounce" });
    g.clickHex("a", 1, 0);
    assert.equal(g.phase, "bounce");
    assert.equal(
      g.legalHexes().some((h) => h.q === 4 && h.r === 0),
      true
    );
    assert.equal(
      g.legalHexes().some((h) => h.q === 2 && h.r === 1),
      false
    );
    assert.equal(g.events.find((e) => e.type === "freeBounce").range, 3);
  });

  it("serializes a full snapshot for late joiners", () => {
    const g = twoPlayers({
      fruits: [{ id: "ap", q: 3, r: 0, type: "apple", value: 1 }],
    });
    g.clickHex("a", 1, 0);
    const snap = g.toJSON();
    assert.equal(snap.hexes.length, lineBoard().length);
    assert.equal(snap.slimes.length, 1);
    assert.equal(snap.fruits.length, 1);
    assert.equal(snap.turnPlayerId, "a");
    assert.ok(Array.isArray(snap.legalHexes));
    assert.equal(typeof snap.deckRemaining, "number");
  });
});

describe("bots", () => {
  it("walks onto adjacent fruit", () => {
    const g = twoPlayers({
      fruits: [{ id: "ap", q: 1, r: 0, type: "apple", value: 1 }],
    });
    g.playerById("a").isBot = true;
    const r = applyBotAction(g);
    assert.equal(r.ok, true);
    assert.equal(g.playerById("a").q, 1);
    assert.equal(g.playerById("a").r, 0);
    assert.equal(g.fruits.length, 0);
  });

  it("bops a plump Blorp instead of bouncing off", () => {
    const g = twoPlayers();
    g.playerById("a").isBot = true;
    g.playerById("b").q = 1;
    g.playerById("b").r = 0;
    g.playerById("b").slime = 5;
    applyBotAction(g);
    assert.equal(g.phase, "contact");
    applyBotAction(g);
    assert.equal(g.phase, "bop");
    assert.equal(g.phaseData.steal, "slime");
  });

  it("bops for fruit when the other Blorp is too small to steal goo from", () => {
    const g = twoPlayers();
    g.playerById("a").isBot = true;
    g.phase = "contact";
    g.phaseData = { otherId: "b" };
    g.playerById("b").slime = 1;
    g.playerById("b").basket = [{ id: "ap", type: "apple" }];
    assert.deepEqual(chooseBotAction(g), { type: "contact", action: "bop-fruit" });

    g.playerById("b").slime = 4;
    assert.deepEqual(chooseBotAction(g), { type: "contact", action: "bop" });

    g.playerById("b").slime = 1;
    g.playerById("b").basket = [];
    assert.deepEqual(chooseBotAction(g), { type: "contact", action: "bounce" });
  });
});
