import { key, neighbors, sameHex, hexLine, DIRS, onFaceLine } from "../shared/hex.js";
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
  SLIME_DROP_COLOR,
} from "../shared/constants.js";
import { buildDeck, hasUpgrade } from "../shared/upgrades.js";
import { fruitPickupPoints, tally } from "../shared/score.js";
import { buildBoard } from "./map.js";

/**
 * Authoritative Blorps rules.
 *
 * Movement: tap an adjacent legal hex, up to remainingMove times.
 * Zoomies: the first move may be a straight hop of 2 hexes. 6+ points still starts with 1 move.
 * Long Reach: +1 movement while you have fewer than 6 points.
 * Stepping onto a higher hex costs 2. At 6 points or more, climbing costs 1.
 * Slip-n-Slide: under 6 points, leaving water costs 1, even uphill.
 * First move of the turn: leave 1 slime token on the hex you started from (you always keep at least 1 slime).
 * You cannot step straight back onto that hex with the next hop. A later hop, including a free bounce after your second move, can. A longer bounce may fly over it.
 * Landing on another Blorp still offers Bounce or Bop. It does not hand them the slime.
 * Land on a slime token (anyone's): pick it up for +1 and one free bounce.
 * Free bounce: leave through one of the six sides and keep going, up to 2 hexes.
 * The board places one apple, one banana, and one bunch of grapes per player.
 * Fruit stays in your tray. Apples, bananas, and grapes are 1 point each.
 * Each foundation has two crystal pools. Touch every crystal on the board to win.
 * Every power-up you hold is worth 1. Apple Fan, Banana Bunch, and Grape Stomp
 * also add +1 for each of that fruit currently in your tray.
 * Points are the tray total. First to 10 wins, and only after touching every
 * crystal on the board. Each foundation has two crystals. Slowing down and
 * climbing use the point total.
 * A new crystal draws the top power-up card. Each player draws once per crystal.
 * Land on a player: Bounce (same free bounce) or Bop (push up to 2 straight).
 * A bop steals 1 slime, or a random fruit from their tray if you choose that.
 * A bop that lands on another Blorp bumps that Blorp 1 hex in the same direction.
 * A pushed Blorp does not drop goo. They pick up fruit, slime, and a new crystal
 * on the landing hex. A slime picked up while pushed does not grant a free bounce.
 * Goo Armor: the first bop against you each round steals nothing and pushes only 1.
 * Treehopper hops over a tree on a free bounce or a bop.
 * A random player goes first. Every racer starts with the same goo.
 * Food and tokens never respawn.
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
    this.freshDrop = null;
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
    game.foundations = board.foundations;

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
        basket: [],
        upgrades: [],
        claimedCaptures: [],
      };
    });

    game.hostId = lobbyPlayers[0]?.id || "";
    game.upgradeDeck = shuffle(buildDeck(), game.rand);
    game.status = "playing";
    const racers = game.actors();
    const start = racers.length ? Math.floor(game.rand() * racers.length) : 0;
    const first = racers[start];
    if (first) {
      game.events.push({ type: "firstPlayer", playerId: first.id, name: first.name });
      game.note(`${first.name} goes first.`);
    }
    game.beginTurn(start);
    game.note("The race is on! First to 10 points wins, once you have touched every crystal.");
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
      basket: [],
      slime: START_SLIME,
      color: COLORS[i] || COLORS[0],
      isSpectator: false,
      ...p,
    }));
    game.fruits = fruits.map((f, i) => ({
      id: f.id || `f${i}`,
      value: 1,
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

  pointTotal(player) {
    return tally(player).points;
  }

  moveRange(p) {
    const points = this.pointTotal(p);
    let m = points >= SIZE_SLOW_AT ? BASE_MOVE_BIG : BASE_MOVE_SMALL;
    if (hasUpgrade(p, "longreach") && points < SIZE_SLOW_AT) m += 1;
    return m;
  }

  /** One lap of the table. Goo Armor refreshes when this changes. */
  roundIndex() {
    const n = Math.max(1, this.actors().length);
    return Math.floor(Math.max(0, this.turnNumber - 1) / n);
  }

  armorReady(player) {
    if (!player || !hasUpgrade(player, "gooarmor")) return false;
    return player.armorRound !== this.roundIndex();
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
    this.freshDrop = null;
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
    this.checkScore(player);
  }

  /** Win at 10 points after touching every crystal. */
  checkScore(player) {
    if (!player || player.isSpectator || this.status !== "playing") return;
    const points = this.pointTotal(player);
    const touchedAll = (this.captures || []).every(
      (c) =>
        (c.claimedBy || []).includes(player.id) || (player.claimedCaptures || []).includes(c.id)
    );
    if (points < WIN_SLIME || !touchedAll) return;
    this.status = "finished";
    this.phase = "over";
    this.winnerId = player.id;
    this.note(`${player.name} counts ${points} points, has touched every crystal, and wins!`);
    this.events.push({
      type: "win",
      playerId: player.id,
      name: player.name,
      points,
    });
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
    if (this.hexAt(q, r)?.terrain === "tree") {
      return fail("A tree blocks that hex.");
    }
    const player = this.current();
    if (this.phase === "bounce" || this.phase === "bop") {
      const origin =
        this.phase === "bop" ? this.playerById(this.phaseData?.otherId) : player;
      const range = this.phase === "bop" ? this.bopRange(player) : this.bounceRange(player);
      if (!origin || !onFaceLine(origin, { q, r }, range)) {
        return fail("That has to stay straight through one side.");
      }
    }
    const legal = this.legalHexes();
    if (!legal.some((h) => h.q === q && h.r === r)) {
      return fail("That hex is out of reach.");
    }
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
    const owedBounce = !!this.phaseData.pendingBounce;
    if (action === "bounce") {
      this.note(`${player.name} bounces off ${other?.name || "a Blorp"}!`);
      this.startFreeBounce(player, "player", {
        otherId: other?.id,
        otherName: other?.name,
      });
    } else if (action === "bop" || action === "bop-fruit") {
      if (!other) return fail("They already wiggled away.");
      const steal = action === "bop-fruit" ? "fruit" : "slime";
      this.phase = "bop";
      this.phaseData = { otherId: other.id, pendingBounce: owedBounce, steal };
      const prize = steal === "fruit" ? "a fruit" : "a slime";
      this.note(`${player.name} winds up a bop on ${other.name} for ${prize}!`);
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
      const cost = this.moveCost(player, from, { q, r });
      this.remainingMove = Math.max(0, this.remainingMove - cost);
      this.noteSlide(player, from, { q, r });
    }

    const firstMain = kind === "move" && !this.movedThisTurn;
    if (firstMain) this.movedThisTurn = true;

    const pendingBounce = this.absorbSlimeToken(player, q, r);
    if (this.status !== "playing") return;

    if (firstMain) {
      const before = this.slimes.length;
      this.placeSlime(player, from.q, from.r);
      this.freshDrop = { q: Number(from.q), r: Number(from.r) };
      if (this.slimes.length > before) {
        this.addSlime(player, -1, "drop");
        this.note(`${player.name} leaves a goo drop behind.`);
      }
      if (this.status !== "playing") return;
    } else {
      // The hop after the opening step has landed somewhere else.
      // A later hop, including the free bounce from a slime, may return.
      this.freshDrop = null;
    }

    this.tryClaimCapture(player, q, r);
    if (this.status !== "playing") return;
    const other = this.occupant(q, r, player.id);

    if (this.phase === "upgrade") {
      this.phaseData.pendingBounce = pendingBounce;
      this.phaseData.pendingContact = !!other;
      if (other) this.phaseData.otherId = other.id;
      return;
    }

    if (other) {
      this.phase = "contact";
      this.phaseData = { otherId: other.id, pendingBounce };
      this.events.push({ type: "contact", playerId: player.id, otherId: other.id });
      this.note(`${player.name} splats into ${other.name}!`);
      return;
    }

    if (pendingBounce) {
      this.startFreeBounce(player, "slime");
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

  startFreeBounce(player, reason, detail = {}) {
    if (this.status !== "playing") return;
    this.phase = "bounce";
    this.phaseData = { reason, ...detail };
    if (this.legalHexes().length === 0) {
      this.note(`${player.name} has no room for a free bounce.`);
      this.phaseData = {};
      this.continueAfterSpecial(player);
      return;
    }
    const range = this.bounceRange(player);
    const why =
      reason === "player"
        ? `bounced off ${detail.otherName || "another Blorp"}`
        : "picked up a slime";
    this.events.push({
      type: "freeBounce",
      playerId: player.id,
      range,
      reason,
      otherId: detail.otherId,
      otherName: detail.otherName,
    });
    this.note(`${player.name} gets a free bounce because they ${why}!`);
  }

  placeSlime(player, q, r) {
    if (this.hexAt(q, r)?.terrain === "tree") return;
    if (this.fruitAt(q, r) || this.slimeAt(q, r)) return;
    if (this.occupant(q, r, player.id)) return;
    const token = {
      id: uid("s"),
      q,
      r,
      ownerId: player.id,
      color: SLIME_DROP_COLOR,
    };
    this.slimes.push(token);
    this.events.push({ type: "drop", token });
  }

  absorbSlimeToken(player, q, r, { pushed = false } = {}) {
    const token = this.slimeAt(q, r);
    if (!token) return false;
    this.slimes = this.slimes.filter((s) => s.id !== token.id);
    const amount = 1;
    this.addSlime(player, amount, "slime");
    this.events.push({
      type: "absorbSlime",
      playerId: player.id,
      q,
      r,
      amount,
      pushed,
    });
    this.note(
      pushed
        ? `${player.name} is pushed onto a slime (+${amount}).`
        : `${player.name} picks up a slime (+${amount}).`
    );
    return true;
  }

  absorbFruit(player, q, r, bouncedOver, { pushed = false } = {}) {
    const fruit = this.fruitAt(q, r);
    if (!fruit) return;
    this.fruits = this.fruits.filter((f) => f.id !== fruit.id);
    player.basket = player.basket || [];
    player.basket.push({ id: fruit.id, type: fruit.type });
    const amount = fruitPickupPoints(player, fruit.type);
    this.events.push({
      type: "absorbFruit",
      playerId: player.id,
      q,
      r,
      fruitType: fruit.type,
      amount,
      bouncedOver: !!bouncedOver,
      pushed,
    });
    const verb = pushed ? "is pushed onto" : bouncedOver ? "bounces through" : "eats";
    this.note(`${player.name} ${verb} a ${fruit.type} (+${amount}).`);
    this.checkScore(player);
  }

  tryClaimCapture(player, q, r, { interrupt = true, pushed = false } = {}) {
    const cap = this.captureAt(q, r);
    if (!cap) return;
    if (cap.claimedBy.includes(player.id)) return;
    cap.claimedBy.push(player.id);
    player.claimedCaptures.push(cap.id);
    const card = this.drawUpgrade();
    player.upgrades.push(card);
    this.events.push({
      type: "capture",
      playerId: player.id,
      captureId: cap.id,
      q,
      r,
      card,
      deckRemaining: this.upgradeDeck.length,
      pushed,
    });
    this.note(
      pushed
        ? `${player.name} is pushed onto a crystal and draws ${card.name}!`
        : `${player.name} draws ${card.name} from the power-up deck!`
    );
    this.checkScore(player);
    if (interrupt && this.status === "playing") {
      this.phase = "upgrade";
      this.phaseData = { ...(this.phaseData || {}), card };
    }
  }

  drawUpgrade() {
    if (!this.upgradeDeck.length && this.upgradeDiscard.length) {
      this.upgradeDeck = shuffle(this.upgradeDiscard, this.rand);
      this.upgradeDiscard = [];
      this.events.push({ type: "shuffle", count: this.upgradeDeck.length });
      this.note("The power-up deck is reshuffled.");
    }
    if (!this.upgradeDeck.length) {
      return { ...buildDeck()[0] };
    }
    const card = this.upgradeDeck.shift();
    this.upgradeDiscard.push(card);
    return { ...card };
  }

  noteSlide(player, from, to) {
    if (!hasUpgrade(player, "slider") || this.pointTotal(player) >= SIZE_SLOW_AT) return;
    const start = this.hexAt(from.q, from.r);
    const dest = this.hexAt(to.q, to.r);
    const climbing = (dest?.elevation ?? 0) > (start?.elevation ?? 0);
    if (start?.terrain !== "water" || !climbing) return;
    this.events.push({ type: "slide", playerId: player.id });
    this.note(`${player.name} slides out of the water.`);
  }

  stealFrom(actor, victim) {
    const stealFruit = this.phaseData?.steal === "fruit";
    if (this.armorReady(victim)) {
      victim.armorRound = this.roundIndex();
      this.note(`${victim.name}'s Goo Armor holds — no steal!`);
      this.events.push({
        type: "bopSteal",
        actorId: actor.id,
        targetId: victim.id,
        stolen: 0,
        armored: true,
      });
      return;
    }
    if (stealFruit) {
      const basket = victim.basket || [];
      if (!basket.length) {
        this.note(`${victim.name} has no fruit to take.`);
        this.events.push({
          type: "bopSteal",
          actorId: actor.id,
          targetId: victim.id,
          stolen: 0,
          fruit: null,
        });
        return;
      }
      const index = Math.floor(this.rand() * basket.length);
      const [fruit] = basket.splice(index, 1);
      victim.basket = basket;
      actor.basket = actor.basket || [];
      actor.basket.push(fruit);
      this.events.push({
        type: "bopSteal",
        actorId: actor.id,
        targetId: victim.id,
        stolen: 0,
        fruit: fruit.type,
      });
      const fruitName =
        fruit.type === "apple" ? "an apple" : fruit.type === "banana" ? "a banana" : fruit.type === "grapes" ? "grapes" : `a ${fruit.type}`;
      this.note(`${actor.name} bops ${victim.name} and takes ${fruitName}!`);
      this.checkScore(actor);
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
    if (this.hexAt(q, r)?.terrain === "tree") return;
    const line = hexLine(from, { q, r }).slice(1);
    for (const h of line) {
      const hex = this.hexAt(h.q, h.r);
      if (hex?.terrain === "tree") {
        if (sameHex(h, { q, r }) || !hasUpgrade(actor, "treehopper")) return;
        continue;
      }
      if (!this.canLand(h.q, h.r, victim.id)) return;
      if (!sameHex(h, { q, r }) && this.occupant(h.q, h.r, victim.id)) return;
    }
    const dir = this.bopStep(from, { q, r });
    const chain = dir ? this.bopChain({ q, r }, dir, new Set([victim.id, actor.id]), actor) : null;
    if (!dir || !chain) return;
    const moved = [];
    for (const blorp of [...chain].reverse()) {
      const start = { q: blorp.q, r: blorp.r };
      const dest = { q: blorp.q + dir.q, r: blorp.r + dir.r };
      blorp.q = dest.q;
      blorp.r = dest.r;
      this.events.push({
        type: "bop",
        actorId: actor.id,
        targetId: blorp.id,
        from: start,
        to: dest,
        chain: true,
      });
      this.note(`${blorp.name} is bumped 1 hex.`);
      moved.push(blorp);
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
    moved.push(victim);
    this.stealFrom(actor, victim);
    if (this.status !== "playing") return;
    // Each pushed Blorp collects the hex they land on. They do not drop,
    // and a slime token does not start a free bounce.
    for (const blorp of moved) {
      this.absorbFruit(blorp, blorp.q, blorp.r, false, { pushed: true });
      if (this.status !== "playing") return;
      this.absorbSlimeToken(blorp, blorp.q, blorp.r, { pushed: true });
      this.tryClaimCapture(blorp, blorp.q, blorp.r, { interrupt: false, pushed: true });
      if (this.status !== "playing") return;
    }
    this.continueAfterSpecial(actor);
  }

  bopStep(from, to) {
    const line = hexLine(from, to);
    if (line.length < 2) return null;
    return { q: line[1].q - from.q, r: line[1].r - from.r };
  }

  /**
   * Blorps who must slide 1 hex in `dir` so `hex` is free to land on.
   * Listed near to far. Null when the slide would leave the board, hit a tree,
   * or land on the bopper.
   */
  bopChain(hex, dir, ignoreIds, actor) {
    const chain = [];
    const seen = new Set(ignoreIds);
    let q = hex.q;
    let r = hex.r;
    for (let guard = 0; guard < 8; guard++) {
      const blocker = this.actors().find((p) => p.q === q && p.r === r && !seen.has(p.id));
      if (!blocker) return chain;
      const nq = q + dir.q;
      const nr = r + dir.r;
      if (!this.canLand(nq, nr, blocker.id)) return null;
      if (actor && actor.q === nq && actor.r === nr) return null;
      chain.push(blocker);
      seen.add(blocker.id);
      q = nq;
      r = nr;
    }
    return null;
  }

  continueAfterSpecial(player) {
    if (this.status !== "playing") return;
    const data = this.phaseData || {};
    if (data.pendingContact && this.playerById(data.otherId)) {
      const other = this.playerById(data.otherId);
      this.phase = "contact";
      this.phaseData = { otherId: other.id, pendingBounce: !!data.pendingBounce };
      this.events.push({ type: "contact", playerId: player.id, otherId: other.id });
      this.note(`${player.name} splats into ${other.name}!`);
      return;
    }
    if (data.pendingBounce) {
      this.startFreeBounce(player, "slime");
      return;
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

  isFreshDrop(h) {
    if (!this.freshDrop || !h) return false;
    return Number(h.q) === Number(this.freshDrop.q) && Number(h.r) === Number(this.freshDrop.r);
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

  /** Flat and downhill cost 1. Climbing costs 2 under 6 points, or 1 at 6 points or more. Slip-n-Slide leaves water for 1. */
  moveCost(player, from, to) {
    const start = this.hexAt(from.q, from.r);
    const dest = this.hexAt(to.q, to.r);
    const climbing = (dest?.elevation ?? 0) > (start?.elevation ?? 0);
    if (climbing && this.pointTotal(player) < SIZE_SLOW_AT) {
      if (hasUpgrade(player, "slider") && start?.terrain === "water") return 1;
      return 2;
    }
    return 1;
  }

  legalMoveHexes(p) {
    if (this.remainingMove <= 0) return [];
    const out = [];
    const seen = new Set();
    const add = (h) => {
      if (this.isFreshDrop(h)) return;
      const k = key(h.q, h.r);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ q: h.q, r: h.r });
    };
    for (const n of neighbors(p)) {
      if (!this.canLand(n.q, n.r, p.id)) continue;
      if (this.moveCost(p, p, n) > this.remainingMove) continue;
      add(n);
    }
    if (!this.movedThisTurn && hasUpgrade(p, "zoomies")) {
      for (const d of DIRS) {
        const mid = { q: p.q + d.q, r: p.r + d.r };
        const far = { q: p.q + d.q * 2, r: p.r + d.r * 2 };
        const between = this.hexAt(mid.q, mid.r);
        if (!between || between.terrain === "tree") continue;
        if (!this.canLand(far.q, far.r, p.id)) continue;
        if (this.moveCost(p, p, far) > this.remainingMove) continue;
        add(far);
      }
    }
    return out;
  }

  legalBounceHexes(p) {
    const range = this.bounceRange(p);
    const hopper = hasUpgrade(p, "treehopper");
    const out = [];
    for (const d of DIRS) {
      for (let dist = 1; dist <= range; dist++) {
        const h = { q: Number(p.q) + d.q * dist, r: Number(p.r) + d.r * dist };
        if (!onFaceLine(p, h, range)) break;
        const hex = this.hexAt(h.q, h.r);
        if (!hex) break;
        if (hex.terrain === "tree") {
          if (!hopper) break;
          continue;
        }
        // The hex you just left is not a landing. A longer hop may still fly over it.
        if (this.isFreshDrop(h)) continue;
        out.push({ q: h.q, r: h.r });
      }
    }
    return out;
  }

  legalBopHexes(p) {
    const victim = this.playerById(this.phaseData.otherId);
    if (!victim) return [];
    let range = this.bopRange(p);
    if (this.armorReady(victim)) range = Math.min(range, 1);
    const out = [];
    const dirs = neighbors({ q: 0, r: 0 });
    for (const d of dirs) {
      for (let dist = 1; dist <= range; dist++) {
        const h = { q: Number(victim.q) + d.q * dist, r: Number(victim.r) + d.r * dist };
        if (!onFaceLine(victim, h, range)) break;
        const hex = this.hexAt(h.q, h.r);
        if (!hex) break;
        if (hex.terrain === "tree") {
          if (!hasUpgrade(p, "treehopper")) break;
          continue;
        }
        if (!this.canLand(h.q, h.r, victim.id)) break;
        if (sameHex(h, p)) break;
        const occ = this.occupant(h.q, h.r, victim.id);
        if (occ) {
          if (occ.id === p.id) break;
          if (!this.bopChain(h, d, new Set([victim.id, p.id]), p)) break;
          out.push(h);
          break;
        }
        out.push(h);
      }
    }
    return out;
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
        fruitCount: o?.basket?.length || 0,
      };
    }
    if (this.phase === "bop") {
      const o = this.playerById(this.phaseData.otherId);
      let range = p ? this.bopRange(p) : BOP_RANGE;
      if (this.armorReady(o)) range = Math.min(range, 1);
      return {
        kind: "bop",
        otherId: o?.id,
        otherName: o?.name || "Blorp",
        range,
        steal: this.phaseData?.steal || "slime",
      };
    }
    if (this.phase === "bounce") {
      return {
        kind: "bounce",
        range: p ? this.bounceRange(p) : BOUNCE_RANGE,
        reason: this.phaseData?.reason || "slime",
        otherName: this.phaseData?.otherName,
      };
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
        basket: p.basket || [],
        score: tally(p).points,
        upgrades: p.upgrades,
        claimedCaptures: p.claimedCaptures,
      })),
      hexes: Object.values(this.hexes),
      foundations: this.foundations || [{ q: 0, r: 0 }],
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
      winPoints: WIN_SLIME,
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
