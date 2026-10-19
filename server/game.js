import { key, neighbors, sameHex, hexLine } from "../shared/hex.js";
import { hashString, mulberry32, shuffle, uid } from "../shared/rng.js";
import {
  START_SLIME,
  WIN_SLIME,
  SIZE_SLOW_AT,
  BASE_MOVE_SMALL,
  BASE_MOVE_BIG,
  BOUNCE_RANGE,
  BOP_RANGE,
  COLORS,
} from "../shared/constants.js";
import { buildDeck, hasUpgrade } from "../shared/upgrades.js";
import { buildBoard } from "./map.js";

/**
 * Authoritative Blorps rules.
 *
 * Movement: tap an adjacent legal hex, up to remainingMove times.
 * First hex of the main move: drop 1 slime token (size stays at least 1).
 * If that hex already had a token, absorb it first (+goo, free bounce), then drop yours.
 * Fruit on land or bounce-over: absorb, +value goo, no extra drop.
 * Capture (once per player): +1 goo, draw upgrade, drop a slime token if the hex is empty.
 * Land on a player: Bounce (free bounce) or Bop (push 2, steal 1 unless Goo Armor).
 * Size 6+: base move 1. Zoomies keeps it at 2. Long Reach +1.
 * First to 10 goo wins. Food and tokens never respawn.
 */
export class Game {
  constructor() {
    this.status = "lobby";
    this.players = [];
    this.hexes = {};
    this.fruits = [];
    this.slimes = [];
    this.captures = [];
    this.upgradeDeck = [];
    this.upgradeDiscard = [];
    this.turnIndex = 0;
    this.phase = "lobby";
    this.phaseData = {};
    this.remainingMove = 0;
    this.movedThisTurn = false;
    this.sliderUsed = new Set();
    this.winnerId = null;
    this.log = [];
    this.turnNumber = 0;
    this.version = 0;
    this.events = [];
    this.rand = Math.random;
    this.roomCode = "";
    this.hostId = "";
  }

  static fromLobby(lobbyPlayers, roomCode) {
    const game = new Game();
    game.roomCode = roomCode;
    game.rand = mulberry32(hashString(roomCode + ":map"));
    const actors = lobbyPlayers.filter((p) => !p.isSpectator);
    const board = buildBoard(actors.length, game.rand);
    game.hexes = board.hexes;
    game.fruits = board.fruits;
    game.captures = board.captures;

    game.players = lobbyPlayers.map((p, i) => {
      const actorIndex = actors.findIndex((a) => a.id === p.id);
      const start =
        actorIndex >= 0 ? board.starts[actorIndex] : { q: 0, r: 0 };
      const color = COLORS[actorIndex] || {
        id: "gray",
        hex: "#9aa3b5",
        ink: "#fff",
        name: "Gray",
      };
      return {
        id: p.id,
        name: p.name,
        isSpectator: !!p.isSpectator,
        isBot: !!p.isBot,
        connected: true,
        color,
        q: start.q,
        r: start.r,
        slime: p.isSpectator ? 0 : START_SLIME,
        upgrades: [],
        claimedCaptures: [],
      };
    });

    game.hostId = lobbyPlayers[0]?.id || "";
    game.upgradeDeck = shuffle(buildDeck(), game.rand);
    game.status = "playing";
    game.beginTurn(0);
    game.note("The race is on! First to 10 goo wins.");
    return game;
  }

  /** Build a tiny board for unit tests. */
  static testHarness({ hexes, players, fruits = [], captures = [], slimes = [] }) {
    const game = new Game();
    game.rand = mulberry32(1);
    game.hexes = {};
    for (const h of hexes) {
      game.hexes[key(h.q, h.r)] = {
        q: h.q,
        r: h.r,
        terrain: h.terrain || "open",
        elevation: h.elevation || 0,
      };
    }
    game.players = players.map((p, i) => ({
      connected: true,
      upgrades: [],
      claimedCaptures: [],
      slime: START_SLIME,
      color: COLORS[i] || COLORS[0],
      isSpectator: false,
      ...p,
    }));
    game.fruits = fruits.map((f, i) => ({
      id: f.id || `f${i}`,
      value: f.type === "grapes" ? 2 : 1,
      ...f,
    }));
    game.captures = captures.map((c, i) => ({
      id: c.id || `c${i}`,
      claimedBy: [],
      ...c,
    }));
    game.slimes = slimes.map((s, i) => ({
      id: s.id || `s${i}`,
      ...s,
    }));
    game.upgradeDeck = shuffle(buildDeck(), game.rand);
    game.status = "playing";
    game.hostId = game.players[0]?.id || "";
    game.beginTurn(0);
    return game;
  }

  actors() {
    return this.players.filter((p) => !p.isSpectator);
  }

  current() {
    const a = this.actors();
    if (!a.length) return null;
    return a[this.turnIndex % a.length];
  }

  playerById(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  hexAt(q, r) {
    return this.hexes[key(q, r)] || null;
  }

  fruitAt(q, r) {
    return this.fruits.find((f) => f.q === q && f.r === r) || null;
  }

  slimeAt(q, r) {
    return this.slimes.find((s) => s.q === q && s.r === r) || null;
  }

  captureAt(q, r) {
    return this.captures.find((c) => c.q === q && c.r === r) || null;
  }

  occupant(q, r, exceptId = null) {
    return (
      this.actors().find(
        (p) => p.q === q && p.r === r && p.id !== exceptId
      ) || null
    );
  }

  moveRange(p) {
    let m = p.slime >= SIZE_SLOW_AT ? BASE_MOVE_BIG : BASE_MOVE_SMALL;
    if (hasUpgrade(p, "zoomies")) m = Math.max(m, BASE_MOVE_SMALL);
    if (hasUpgrade(p, "longreach")) m += 1;
    return m;
  }

  bounceRange(p) {
    return hasUpgrade(p, "superbounce") ? 3 : BOUNCE_RANGE;
  }

  bopRange(p) {
    return hasUpgrade(p, "superbounce") ? 3 : BOP_RANGE;
  }

  beginTurn(index, hops = 0) {
    const a = this.actors();
    if (!a.length) return;
    this.turnIndex = ((index % a.length) + a.length) % a.length;
    const p = this.current();
    this.turnNumber += 1;
    this.phase = "move";
    this.phaseData = {};
    this.movedThisTurn = false;
    this.sliderUsed = new Set();
    this.remainingMove = this.moveRange(p);
    this.note(`${p.name}'s turn · ${this.remainingMove} move${this.remainingMove === 1 ? "" : "s"}.`);
    if (this.legalHexes().length === 0) {
      this.note(`${p.name} is stuck and skips.`);
      if (hops < a.length) this.endTurn(hops);
    }
  }

  endTurn(hops = 0) {
    if (this.status !== "playing") return;
    this.phase = "move";
    this.phaseData = {};
    this.beginTurn(this.turnIndex + 1, hops + 1);
  }

  note(text) {
    this.log.push({ id: uid("l"), text });
    if (this.log.length > 40) this.log.shift();
    this.events.push({ type: "log", text });
  }

  addSlime(player, amount, why) {
    if (amount === 0) return;
    player.slime = Math.max(1, player.slime + amount);
    this.events.push({
      type: "slime",
      playerId: player.id,
      slime: player.slime,
      amount,
      why,
    });
    if (player.slime >= WIN_SLIME && this.status === "playing") {
      this.status = "finished";
      this.phase = "over";
      this.winnerId = player.id;
      this.note(`${player.name} hit ${WIN_SLIME} goo and wins!`);
      this.events.push({ type: "win", playerId: player.id, name: player.name });
    }
  }

  assertActor(playerId) {
    if (this.status !== "playing") return fail("The game is not in play.");
    const p = this.playerById(playerId);
    if (!p) return fail("You are not in this room.");
    if (p.isSpectator) return fail("Spectators cannot act.");
    const cur = this.current();
    if (!cur || cur.id !== playerId) return fail("Wait for your turn.");
    return null;
  }

  clickHex(playerId, q, r) {
    this.events = [];
    const err = this.assertActor(playerId);
    if (err) return err;
    if (this.phase === "upgrade") return fail("Tap the card first.");
    if (this.phase === "contact") return fail("Choose Bounce or Bop.");
    const legal = this.legalHexes();
    if (!legal.some((h) => h.q === q && h.r === r)) {
      return fail("That hex is out of reach.");
    }
    const player = this.current();
    if (this.phase === "move") {
      this.step(player, q, r, "move");
    } else if (this.phase === "bounce") {
      this.step(player, q, r, "bounce");
    } else if (this.phase === "bop") {
      this.resolveBop(player, q, r);
    } else {
      return fail("Nothing to tap right now.");
    }
    this.afterAction();
    return ok();
  }

  chooseContact(playerId, action) {
    this.events = [];
    const err = this.assertActor(playerId);
    if (err) return err;
    if (this.phase !== "contact") return fail("No bounce/bop choice now.");
    const player = this.current();
    const other = this.playerById(this.phaseData.otherId);
    if (action === "bounce") {
      this.note(`${player.name} bounces off ${other?.name || "a Blorp"}!`);
      this.phase = "bounce";
      this.phaseData = { reason: "player" };
      if (this.legalHexes().length === 0) {
        this.note("No room to bounce — turn continues.");
        this.continueAfterSpecial(player);
      }
    } else if (action === "bop") {
      if (!other) return fail("They already wiggled away.");
      this.phase = "bop";
      this.phaseData = { otherId: other.id };
      this.note(`${player.name} winds up a bop on ${other.name}!`);
      if (this.legalHexes().length === 0) {
        this.stealFrom(player, other);
        this.note(`${other.name} has nowhere to fly.`);
        this.continueAfterSpecial(player);
      }
    } else {
      return fail("Pick Bounce or Bop.");
    }
    this.afterAction();
    return ok();
  }

  ackUpgrade(playerId) {
    this.events = [];
    const err = this.assertActor(playerId);
    if (err) return err;
    if (this.phase !== "upgrade") return fail("No card to acknowledge.");
    const player = this.current();
    this.continueAfterSpecial(player);
    this.afterAction();
    return ok();
  }

  skipTurn(playerId) {
    this.events = [];
    const err = this.assertActor(playerId);
    if (err) return err;
    if (this.phase !== "move") return fail("Finish this action first.");
    if (!this.movedThisTurn) return fail("Move at least one hex first.");
    this.note(`${this.current().name} ends their turn.`);
    this.endTurn();
    this.afterAction();
    return ok();
  }

  afterAction() {
    this.version += 1;
    if (this.status === "playing" && this.phase === "move") {
      if (this.remainingMove <= 0) this.endTurn();
      else if (this.legalHexes().length === 0 && this.movedThisTurn) this.endTurn();
    }
  }

  step(player, q, r, kind) {
    const from = { q: player.q, r: player.r };
    const path =
      kind === "bounce"
        ? this.pathTo(player, { q, r }, this.bounceRange(player), hasUpgrade(player, "treehopper"))
        : [{ q, r }];
    const over = path.slice(0, -1);
    for (const h of over) this.absorbFruit(player, h.q, h.r, true);
    this.absorbFruit(player, q, r, false);
    if (this.status !== "playing") {
      player.q = q;
      player.r = r;
      this.events.push({ type: "hop", playerId: player.id, from, to: { q, r }, kind });
      return;
    }

    player.q = q;
    player.r = r;
    this.events.push({
      type: "hop",
      playerId: player.id,
      from,
      to: { q, r },
      kind,
    });

    if (kind === "move") {
      this.remainingMove = Math.max(0, this.remainingMove - 1);
      this.applySlider(player, q, r);
    }

    const firstMain = kind === "move" && !this.movedThisTurn;
    if (firstMain) this.movedThisTurn = true;

    let pendingBounce = false;
    if (firstMain) {
      pendingBounce = this.dropOnFirstHex(player, q, r);
    } else if (kind === "bounce") {
      pendingBounce = this.absorbSlimeToken(player, q, r);
    }
    if (this.status !== "playing") return;

    this.tryClaimCapture(player, q, r);
    const other = this.occupant(q, r, player.id);

    if (this.phase === "upgrade") {
      this.phaseData.pendingBounce = pendingBounce;
      this.phaseData.pendingContact = !!other;
      if (other) this.phaseData.otherId = other.id;
      return;
    }

    if (other) {
      this.phase = "contact";
      this.phaseData = { otherId: other.id };
      this.note(`${player.name} splats into ${other.name}!`);
      return;
    }

    if (pendingBounce) {
      this.phase = "bounce";
      this.phaseData = { reason: "slime" };
      this.note(`${player.name} can pivot and launch!`);
      if (this.legalHexes().length === 0) this.continueAfterSpecial(player);
      return;
    }

    if (kind === "bounce") {
      this.phaseData = {};
      this.continueAfterSpecial(player);
      return;
    }

    this.phase = "move";
    this.phaseData = {};
  }

  dropOnFirstHex(player, q, r) {
    const existing = this.slimeAt(q, r);
    let bounce = false;
    if (existing) bounce = this.absorbSlimeToken(player, q, r);
    this.placeSlime(player, q, r);
    this.addSlime(player, -1, "drop");
    this.note(`${player.name} leaves a goo drop.`);
    return bounce;
  }

  placeSlime(player, q, r) {
    if (this.slimeAt(q, r)) return;
    const token = {
      id: uid("s"),
      q,
      r,
      ownerId: player.id,
      color: player.color.hex,
    };
    this.slimes.push(token);
    this.events.push({ type: "drop", token });
  }

  absorbSlimeToken(player, q, r) {
    const token = this.slimeAt(q, r);
    if (!token) return false;
    this.slimes = this.slimes.filter((s) => s.id !== token.id);
    const extra = hasUpgrade(player, "sponge") ? 1 : 0;
    const amount = 1 + extra;
    this.addSlime(player, amount, "slime");
    this.events.push({
      type: "absorbSlime",
      playerId: player.id,
      q,
      r,
      amount,
    });
    this.note(
      `${player.name} slurps a slime token (+${amount}).`
    );
    return true;
  }

  absorbFruit(player, q, r, bouncedOver) {
    const fruit = this.fruitAt(q, r);
    if (!fruit) return;
    this.fruits = this.fruits.filter((f) => f.id !== fruit.id);
    const extra = hasUpgrade(player, "sweettooth") ? 1 : 0;
    const amount = fruit.value + extra;
    this.addSlime(player, amount, "fruit");
    this.events.push({
      type: "absorbFruit",
      playerId: player.id,
      q,
      r,
      fruitType: fruit.type,
      amount,
      bouncedOver: !!bouncedOver,
    });
    this.note(
      `${player.name} ${bouncedOver ? "bounces through" : "eats"} a ${fruit.type} (+${amount}).`
    );
  }

  tryClaimCapture(player, q, r) {
    const cap = this.captureAt(q, r);
    if (!cap) return;
    if (cap.claimedBy.includes(player.id)) return;
    cap.claimedBy.push(player.id);
    player.claimedCaptures.push(cap.id);
    this.addSlime(player, 1, "capture");
    this.placeSlime(player, q, r);
    const card = this.drawUpgrade();
    player.upgrades.push(card);
    this.events.push({
      type: "capture",
      playerId: player.id,
      captureId: cap.id,
      q,
      r,
      card,
    });
    this.note(`${player.name} claims a crystal and draws ${card.name}!`);
    if (this.status === "playing") {
      this.phase = "upgrade";
      this.phaseData = { ...(this.phaseData || {}), card };
    }
  }

  drawUpgrade() {
    if (!this.upgradeDeck.length) {
      this.upgradeDeck = shuffle(this.upgradeDiscard, this.rand);
      this.upgradeDiscard = [];
    }
    if (!this.upgradeDeck.length) {
      return { ...buildDeck()[0] };
    }
    const card = this.upgradeDeck.shift();
    this.upgradeDiscard.push(card);
    return { ...card };
  }

  applySlider(player, q, r) {
    const hex = this.hexAt(q, r);
    if (!hex || hex.terrain !== "water") return;
    if (!hasUpgrade(player, "slider")) return;
    const k = key(q, r);
    if (this.sliderUsed.has(k)) return;
    this.sliderUsed.add(k);
    this.remainingMove += 1;
    this.note(`${player.name} slides through water (+1 move).`);
  }

  stealFrom(actor, victim) {
    if (hasUpgrade(victim, "gooarmor")) {
      this.note(`${victim.name}'s Goo Armor holds — no steal!`);
      this.events.push({
        type: "bopSteal",
        actorId: actor.id,
        targetId: victim.id,
        stolen: 0,
      });
      return;
    }
    if (victim.slime <= 1) {
      this.note(`${victim.name} is too tiny to steal from.`);
      return;
    }
    this.addSlime(victim, -1, "stolen");
    this.addSlime(actor, 1, "steal");
    this.events.push({
      type: "bopSteal",
      actorId: actor.id,
      targetId: victim.id,
      stolen: 1,
    });
    this.note(`${actor.name} bops ${victim.name} and steals 1 goo!`);
  }

  resolveBop(actor, q, r) {
    const victim = this.playerById(this.phaseData.otherId);
    if (!victim) {
      this.continueAfterSpecial(actor);
      return;
    }
    const from = { q: victim.q, r: victim.r };
    const line = hexLine(from, { q, r }).slice(1);
    for (const h of line) {
      if (!this.canLand(h.q, h.r, victim.id, { ignoreTrees: false })) {
        return;
      }
    }
    victim.q = q;
    victim.r = r;
    this.events.push({
      type: "bop",
      actorId: actor.id,
      targetId: victim.id,
      from,
      to: { q, r },
    });
    this.stealFrom(actor, victim);
    this.continueAfterSpecial(actor);
  }

  continueAfterSpecial(player) {
    if (this.status !== "playing") return;
    const data = this.phaseData || {};
    if (data.pendingContact && this.playerById(data.otherId)) {
      const other = this.playerById(data.otherId);
      this.phase = "contact";
      this.phaseData = { otherId: other.id };
      this.note(`${player.name} splats into ${other.name}!`);
      return;
    }
    if (data.pendingBounce) {
      this.phase = "bounce";
      this.phaseData = { reason: "slime" };
      this.note(`${player.name} can pivot and launch!`);
      if (this.legalHexes().length === 0) {
        this.note("No room to bounce — turn continues.");
      } else {
        return;
      }
    }
    if (this.remainingMove > 0) {
      this.phase = "move";
      this.phaseData = {};
      if (this.legalHexes().length === 0) this.endTurn();
    } else {
      this.endTurn();
    }
  }

  canLand(q, r, moverId, { ignoreTrees = false } = {}) {
    const hex = this.hexAt(q, r);
    if (!hex) return false;
    if (hex.terrain === "tree" && !ignoreTrees) return false;
    return true;
  }

  legalHexes() {
    if (this.status !== "playing") return [];
    const p = this.current();
    if (!p) return [];
    if (this.phase === "move") return this.legalMoveHexes(p);
    if (this.phase === "bounce") return this.legalBounceHexes(p);
    if (this.phase === "bop") return this.legalBopHexes(p);
    return [];
  }

  legalMoveHexes(p) {
    if (this.remainingMove <= 0) return [];
    const out = [];
    for (const n of neighbors(p)) {
      if (this.canLand(n.q, n.r, p.id)) out.push({ q: n.q, r: n.r });
    }
    return out;
  }

  legalBounceHexes(p) {
    const range = this.bounceRange(p);
    const hopper = hasUpgrade(p, "treehopper");
    return this.reachable(p, range, hopper).filter(
      (h) => !(h.q === p.q && h.r === p.r)
    );
  }

  legalBopHexes(p) {
    const victim = this.playerById(this.phaseData.otherId);
    if (!victim) return [];
    const range = this.bopRange(p);
    const out = [];
    const dirs = neighbors({ q: 0, r: 0 });
    for (const d of dirs) {
      for (let dist = 1; dist <= range; dist++) {
        const h = { q: victim.q + d.q * dist, r: victim.r + d.r * dist };
        if (!this.canLand(h.q, h.r, victim.id)) break;
        if (this.occupant(h.q, h.r, victim.id)) break;
        if (sameHex(h, p)) break;
        out.push(h);
      }
    }
    return out;
  }

  reachable(player, range, treehopper) {
    return this.bfs(player, range, treehopper).dests;
  }

  pathTo(player, dest, range, treehopper) {
    const { parent } = this.bfs(player, range, treehopper);
    const end = key(dest.q, dest.r);
    if (!parent.has(end) && end !== key(player.q, player.r)) {
      return [{ q: dest.q, r: dest.r }];
    }
    const path = [];
    let k = end;
    const start = key(player.q, player.r);
    while (k && k !== start) {
      const [q, r] = k.split(",").map(Number);
      path.push({ q, r });
      k = parent.get(k);
    }
    path.reverse();
    return path.length ? path : [{ q: dest.q, r: dest.r }];
  }

  bfs(player, range, treehopper) {
    const start = key(player.q, player.r);
    const distMap = new Map([[start, 0]]);
    const parent = new Map();
    const q = [{ q: player.q, r: player.r, d: 0 }];
    const dests = [];
    while (q.length) {
      const cur = q.shift();
      if (cur.d >= range) continue;
      for (const n of neighbors(cur)) {
        const hex = this.hexAt(n.q, n.r);
        if (!hex) continue;
        const k = key(n.q, n.r);
        const nd = cur.d + 1;
        if (distMap.has(k) && distMap.get(k) <= nd) continue;
        const isTree = hex.terrain === "tree";
        if (isTree && !treehopper) continue;
        distMap.set(k, nd);
        parent.set(k, key(cur.q, cur.r));
        if (!isTree) dests.push({ q: n.q, r: n.r });
        q.push({ q: n.q, r: n.r, d: nd });
      }
    }
    return { dests, parent, distMap };
  }

  uiHints() {
    const p = this.current();
    if (this.phase === "contact") {
      const o = this.playerById(this.phaseData.otherId);
      return {
        kind: "contact",
        otherId: o?.id,
        otherName: o?.name || "Blorp",
        otherColor: o?.color?.hex,
      };
    }
    if (this.phase === "bop") {
      const o = this.playerById(this.phaseData.otherId);
      return {
        kind: "bop",
        otherId: o?.id,
        otherName: o?.name || "Blorp",
        range: p ? this.bopRange(p) : BOP_RANGE,
      };
    }
    if (this.phase === "bounce") {
      return { kind: "bounce", range: p ? this.bounceRange(p) : BOUNCE_RANGE };
    }
    if (this.phase === "upgrade") {
      return { kind: "upgrade", card: this.phaseData.card };
    }
    if (this.phase === "over") {
      const w = this.playerById(this.winnerId);
      return { kind: "over", winnerName: w?.name, winnerId: this.winnerId };
    }
    if (this.phase === "move") {
      return {
        kind: "move",
        remaining: this.remainingMove,
        canEnd: this.movedThisTurn,
      };
    }
    return { kind: this.phase };
  }

  toJSON() {
    const cur = this.current();
    return {
      roomCode: this.roomCode,
      status: this.status,
      hostId: this.hostId,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        isSpectator: p.isSpectator,
        isBot: !!p.isBot,
        connected: p.connected,
        color: p.color,
        q: p.q,
        r: p.r,
        slime: p.slime,
        upgrades: p.upgrades,
        claimedCaptures: p.claimedCaptures,
      })),
      hexes: Object.values(this.hexes),
      fruits: this.fruits,
      slimes: this.slimes,
      captures: this.captures,
      deckRemaining: this.upgradeDeck.length,
      turnIndex: this.turnIndex,
      turnPlayerId: cur?.id || null,
      phase: this.phase,
      remainingMove: this.remainingMove,
      movedThisTurn: this.movedThisTurn,
      winnerId: this.winnerId,
      log: this.log.slice(-12),
      turnNumber: this.turnNumber,
      version: this.version,
      legalHexes: this.legalHexes(),
      ui: this.uiHints(),
    };
  }
}

function fail(error) {
  return { ok: false, error };
}
function ok() {
  return { ok: true };
}

export { uid };
