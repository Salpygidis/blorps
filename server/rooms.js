import { Game, uid } from "./game.js";
import { applyBotAction, BOT_NAMES } from "./bot.js";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  MAX_SPECTATORS,
  MAX_BOTS,
  ROOM_CODE_LEN,
  ROOM_ALPHABET,
  NAMES,
} from "../shared/constants.js";

const IDLE_MS = 1000 * 60 * 90;
const TURN_MS = {
  move: 90_000,
  bounce: 45_000,
  bop: 45_000,
  contact: 30_000,
  upgrade: 14_000,
};

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.bySocket = new Map();
    this.botDelayMs = Number(process.env.BOT_DELAY_MS || 650);
  }

  makeCode() {
    for (let n = 0; n < 40; n++) {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LEN; i++) {
        code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    return uid("R").slice(0, 4).toUpperCase();
  }

  sanitizeName(name) {
    const cleaned = String(name || "")
      .replace(/[^\w \-'.]/g, "")
      .trim()
      .slice(0, 14);
    if (cleaned) return cleaned;
    return NAMES[Math.floor(Math.random() * NAMES.length)];
  }

  uniqueName(room, name) {
    const used = new Set(room.lobby.map((p) => p.name.toLowerCase()));
    if (!used.has(name.toLowerCase())) return name;
    for (let i = 2; i < 30; i++) {
      const next = `${name} ${i}`;
      if (!used.has(next.toLowerCase())) return next;
    }
    return `${name} ${uid("").slice(0, 3)}`;
  }

  create(socket, { name, spectator, bots }) {
    const code = this.makeCode();
    const player = {
      id: uid("p"),
      name: this.sanitizeName(name),
      isSpectator: !!spectator,
      isBot: false,
      socketId: socket.id,
    };
    const room = {
      code,
      hostId: player.id,
      lobby: [player],
      game: null,
      createdAt: Date.now(),
      timer: null,
      botTimer: null,
    };
    this.rooms.set(code, room);
    this.bySocket.set(socket.id, { code, playerId: player.id });
    socket.join(code);
    if (!player.isSpectator) this.syncBots(room, bots);
    this.touch(room);
    return { room, player };
  }

  join(socket, { code, name, spectator }) {
    const room = this.rooms.get(String(code || "").trim().toUpperCase());
    if (!room) return { error: "No room with that code." };
    const wantSpec = !!spectator || !!room.game;
    const live = room.lobby.filter((p) => !p.isSpectator);
    const specs = room.lobby.filter((p) => p.isSpectator);
    if (!wantSpec && live.length >= MAX_PLAYERS) {
      return { error: "That room is full. Join as a spectator." };
    }
    if (wantSpec && specs.length >= MAX_SPECTATORS) {
      return { error: "Too many spectators in this room." };
    }
    const player = {
      id: uid("p"),
      name: this.uniqueName(room, this.sanitizeName(name)),
      isSpectator: wantSpec,
      isBot: false,
      socketId: socket.id,
    };
    room.lobby.push(player);
    this.bySocket.set(socket.id, { code: room.code, playerId: player.id });
    socket.join(room.code);
    if (room.game) {
      room.game.players.push({
        id: player.id,
        name: player.name,
        isSpectator: true,
        connected: true,
        color: { id: "gray", hex: "#9aa3b5", ink: "#fff", name: "Gray" },
        q: 0,
        r: 0,
        slime: 0,
        upgrades: [],
        claimedCaptures: [],
      });
    }
    this.touch(room);
    return { room, player, spectating: player.isSpectator };
  }

  rejoin(socket, { code, playerId }) {
    const room = this.rooms.get(String(code || "").trim().toUpperCase());
    if (!room) return { error: "Room is gone." };
    const player = room.lobby.find((p) => p.id === playerId);
    if (!player) return { error: "That seat is gone." };
    player.socketId = socket.id;
    player.connected = true;
    this.bySocket.set(socket.id, { code: room.code, playerId: player.id });
    socket.join(room.code);
    if (room.game) {
      const gp = room.game.playerById(playerId);
      if (gp) gp.connected = true;
    }
    this.touch(room);
    return { room, player };
  }

  start(socket) {
    const ctx = this.bySocket.get(socket.id);
    if (!ctx) return { error: "Join a room first." };
    const room = this.rooms.get(ctx.code);
    if (!room) return { error: "Room is gone." };
    if (ctx.playerId !== room.hostId) return { error: "Only the host can start." };
    if (room.game && room.game.status === "playing") {
      return { error: "Already racing." };
    }
    const live = room.lobby.filter((p) => !p.isSpectator);
    if (live.length < MIN_PLAYERS) {
      return { error: `Need at least ${MIN_PLAYERS} players to start.` };
    }
    room.game = Game.fromLobby(room.lobby, room.code);
    room.game.hostId = room.hostId;
    this.armTimer(room);
    this.scheduleBot(room);
    this.touch(room);
    return { room };
  }

  again(socket) {
    const ctx = this.bySocket.get(socket.id);
    if (!ctx) return { error: "Join a room first." };
    const room = this.rooms.get(ctx.code);
    if (!room) return { error: "Room is gone." };
    if (ctx.playerId !== room.hostId) return { error: "Only the host can play again." };
    const live = room.lobby.filter((p) => !p.isSpectator);
    if (live.length < MIN_PLAYERS) {
      return { error: `Need at least ${MIN_PLAYERS} players.` };
    }
    room.game = Game.fromLobby(room.lobby, room.code + ":" + Date.now());
    room.game.roomCode = room.code;
    room.game.hostId = room.hostId;
    this.armTimer(room);
    this.scheduleBot(room);
    this.touch(room);
    return { room };
  }

  setBots(socket, { count }) {
    const ctx = this.bySocket.get(socket.id);
    if (!ctx) return { error: "Join a room first." };
    const room = this.rooms.get(ctx.code);
    if (!room) return { error: "Room is gone." };
    if (ctx.playerId !== room.hostId) return { error: "Only the host can add bots." };
    if (room.game) return { error: "The race already started." };
    this.syncBots(room, count);
    this.touch(room);
    return { room };
  }

  syncBots(room, count) {
    let n = Math.round(Number(count) || 0);
    if (n < 0) n = 0;
    if (n > MAX_BOTS) n = MAX_BOTS;
    const humans = room.lobby.filter((p) => !p.isSpectator && !p.isBot).length;
    const maxFit = Math.max(0, MAX_PLAYERS - humans);
    if (n > maxFit) n = maxFit;
    let bots = room.lobby.filter((p) => p.isBot);
    while (bots.length > n) {
      const gone = bots.pop();
      room.lobby = room.lobby.filter((p) => p.id !== gone.id);
    }
    bots = room.lobby.filter((p) => p.isBot);
    while (bots.length < n) {
      const bot = {
        id: uid("b"),
        name: this.uniqueName(room, BOT_NAMES[bots.length] || `Bot ${bots.length + 1}`),
        isSpectator: false,
        isBot: true,
        socketId: null,
      };
      room.lobby.push(bot);
      bots.push(bot);
    }
  }

  act(socket, fn) {
    const ctx = this.bySocket.get(socket.id);
    if (!ctx) return { error: "Join a room first." };
    const room = this.rooms.get(ctx.code);
    if (!room || !room.game) return { error: "Game has not started." };
    const result = fn(room.game, ctx.playerId);
    if (result && result.ok) {
      this.armTimer(room);
      this.scheduleBot(room);
    }
    this.touch(room);
    return { room, result };
  }

  disconnect(socket) {
    const ctx = this.bySocket.get(socket.id);
    if (!ctx) return;
    this.bySocket.delete(socket.id);
    const room = this.rooms.get(ctx.code);
    if (!room) return;
    const player = room.lobby.find((p) => p.id === ctx.playerId);
    if (player) player.socketId = null;
    if (room.game) {
      const gp = room.game.playerById(ctx.playerId);
      if (gp) gp.connected = false;
    }
    const anyone = room.lobby.some((p) => p.socketId);
    if (!anyone) {
      this.scheduleIdle(room);
    } else if (player && player.id === room.hostId) {
      const next = room.lobby.find((p) => p.socketId);
      if (next) {
        room.hostId = next.id;
        if (room.game) room.game.hostId = next.id;
      }
    }
    this.broadcast(room);
  }

  lobbyPayload(room) {
    return {
      code: room.code,
      hostId: room.hostId,
      players: room.lobby.map((p) => ({
        id: p.id,
        name: p.name,
        isSpectator: p.isSpectator,
        isBot: !!p.isBot,
        connected: p.isBot || !!p.socketId,
      })),
      started: !!(room.game && room.game.status !== "lobby"),
    };
  }

  broadcast(room, extraEvents = null) {
    const lobby = this.lobbyPayload(room);
    if (room.game) {
      const state = room.game.toJSON();
      const events = extraEvents || room.game.events || [];
      this.io.to(room.code).emit("state", { lobby, state, events });
    } else {
      this.io.to(room.code).emit("lobby", lobby);
    }
  }

  armTimer(room) {
    clearTimeout(room.timer);
    if (!room.game || room.game.status !== "playing") return;
    const phase = room.game.phase;
    const ms = TURN_MS[phase] || 90_000;
    room.timer = setTimeout(() => this.autoAct(room), ms);
    room.timer.unref?.();
  }

  autoAct(room) {
    if (!room.game || room.game.status !== "playing") return;
    const g = room.game;
    const id = g.current()?.id;
    if (!id) return;
    g.events = [];
    if (g.phase === "upgrade") g.ackUpgrade(id);
    else if (g.phase === "contact") g.chooseContact(id, "bounce");
    else if (g.phase === "bounce" || g.phase === "bop") {
      const hexes = g.legalHexes();
      if (hexes.length) g.clickHex(id, hexes[0].q, hexes[0].r);
      else g.continueAfterSpecial(g.current());
    } else if (g.phase === "move") {
      if (g.movedThisTurn) g.skipTurn(id);
      else {
        const hexes = g.legalHexes();
        if (hexes.length) g.clickHex(id, hexes[0].q, hexes[0].r);
        else g.endTurn();
      }
    }
    this.broadcast(room, g.events);
    this.armTimer(room);
    this.scheduleBot(room);
  }

  scheduleBot(room) {
    clearTimeout(room.botTimer);
    if (!room.game || room.game.status !== "playing") return;
    const cur = room.game.current();
    if (!cur?.isBot) return;
    const first = room.game.phase === "move" && !room.game.movedThisTurn;
    const ms = first ? this.botDelayMs + 200 : this.botDelayMs;
    room.botTimer = setTimeout(() => this.runBot(room), ms);
    room.botTimer.unref?.();
  }

  runBot(room) {
    if (!room.game || room.game.status !== "playing") return;
    const cur = room.game.current();
    if (!cur?.isBot) return;
    const result = applyBotAction(room.game);
    if (!result?.ok) {
      room.game.events = [];
      if (room.game.phase === "move" && room.game.movedThisTurn) {
        room.game.skipTurn(cur.id);
      } else if (room.game.phase === "upgrade") {
        room.game.ackUpgrade(cur.id);
      } else if (room.game.status === "playing") {
        room.game.endTurn();
      }
    }
    this.broadcast(room, room.game.events);
    this.armTimer(room);
    this.scheduleBot(room);
  }

  touch(room) {
    room.touched = Date.now();
  }

  scheduleIdle(room) {
    clearTimeout(room.idle);
    room.idle = setTimeout(() => {
      const stillEmpty = room.lobby.every((p) => !p.socketId);
      if (stillEmpty) this.destroy(room.code);
    }, IDLE_MS);
    room.idle.unref?.();
  }

  destroy(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    clearTimeout(room.timer);
    clearTimeout(room.idle);
    clearTimeout(room.botTimer);
    this.rooms.delete(code);
  }
}
