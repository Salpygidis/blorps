import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../server/game.js";
import { applyBotAction } from "../server/bot.js";
import { START_SLIME, WIN_SLIME } from "../shared/constants.js";

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
  it("drops a slime token on the first hex of a move and shrinks", () => {
    const g = twoPlayers();
    const r = g.clickHex("a", 1, 0);
    assert.equal(r.ok, true);
    assert.equal(g.slimes.length, 1);
    assert.equal(g.slimes[0].q, 1);
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
  });

  it("eats fruit for +1 / +2 and does not respawn it", () => {
    const g = twoPlayers({
      fruits: [
        { id: "ap", q: 1, r: 0, type: "apple", value: 1 },
        { id: "gr", q: 2, r: 0, type: "grapes", value: 2 },
      ],
    });
    g.clickHex("a", 1, 0);
    assert.equal(g.playerById("a").slime, START_SLIME - 1 + 1);
    assert.equal(g.fruits.length, 1);
    g.clickHex("a", 2, 0);
    assert.equal(g.playerById("a").slime, START_SLIME - 1 + 1 + 2);
    assert.equal(g.fruits.length, 0);
    assert.equal(g.current().id, "b");
  });

  it("bounces over fruit and absorbs it", () => {
    const g = twoPlayers({
      slimes: [{ id: "s1", q: 1, r: 0, ownerId: "b", color: "#fff" }],
      fruits: [{ id: "ap", q: 2, r: 0, type: "apple", value: 1 }],
    });
    g.clickHex("a", 1, 0);
    assert.equal(g.phase, "bounce");
    g.clickHex("a", 3, 0);
    assert.equal(g.fruits.length, 0);
    assert.equal(g.playerById("a").q, 3);
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
    assert.equal(g.playerById("b").slime, 4);
  });

  it("drops movement from 2 to 1 at size 6", () => {
    const g = twoPlayers();
    g.playerById("a").slime = 6;
    g.beginTurn(0);
    assert.equal(g.remainingMove, 1);
    g.playerById("a").upgrades.push({ id: "zoomies" });
    g.beginTurn(0);
    assert.equal(g.remainingMove, 2);
  });

  it("claims a capture once per player, draws an upgrade, and +1 goo", () => {
    const g = twoPlayers({
      captures: [{ id: "c1", q: 1, r: 0, claimedBy: [] }],
    });
    const before = g.playerById("a").slime;
    g.clickHex("a", 1, 0);
    assert.equal(g.phase, "upgrade");
    assert.equal(g.playerById("a").slime, before - 1 + 1);
    assert.equal(g.playerById("a").upgrades.length, 1);
    assert.equal(g.captures[0].claimedBy[0], "a");
    g.ackUpgrade("a");
    g.clickHex("a", 2, 0);
    assert.equal(g.current().id, "b");
    g.playerById("a").q = 0;
    g.playerById("a").r = 0;
    g.beginTurn(0);
    g.clickHex("a", 1, 0);
    assert.notEqual(g.phase, "upgrade");
    assert.equal(g.playerById("a").upgrades.length, 1);
  });

  it("wins at 10 slime points", () => {
    const g = twoPlayers({
      fruits: [{ id: "gr", q: 1, r: 0, type: "grapes", value: 2 }],
    });
    g.playerById("a").slime = WIN_SLIME - 1;
    g.clickHex("a", 1, 0);
    assert.equal(g.status, "finished");
    assert.equal(g.winnerId, "a");
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
    g.phase = "bounce";
    g.phaseData = { reason: "slime" };
    const without = g.legalHexes();
    assert.equal(
      without.some((h) => h.q === 4 && h.r === -1),
      false
    );
    g.playerById("a").upgrades.push({ id: "treehopper" });
    const withUp = g.legalHexes();
    assert.equal(
      withUp.some((h) => h.q === 4 && h.r === -1),
      true
    );
  });

  it("Slip-n-Slide grants extra movement on water", () => {
    const g = twoPlayers();
    g.playerById("a").q = 1;
    g.playerById("a").r = 0;
    g.playerById("a").upgrades.push({ id: "slider" });
    g.beginTurn(0);
    assert.equal(g.remainingMove, 2);
    g.clickHex("a", 2, 0);
    g.clickHex("a", 2, 1);
    assert.equal(g.playerById("a").q, 2);
    assert.equal(g.playerById("a").r, 1);
    assert.ok(g.remainingMove >= 1);
    assert.equal(g.current().id, "a");
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
  });
});
