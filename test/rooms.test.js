import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { Server } from "socket.io";
import { io as ioc } from "socket.io-client";
import { RoomManager } from "../server/rooms.js";
import { attachSockets } from "../server/sockets.js";

function client(port) {
  return ioc(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    forceNew: true,
  });
}

function ask(socket, event, payload = {}) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function wait(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

describe("multiplayer rooms", () => {
  let httpServer;
  let io;
  let port;

  before(async () => {
    const app = express();
    httpServer = http.createServer(app);
    io = new Server(httpServer);
    attachSockets(io, new RoomManager(io));
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    port = httpServer.address().port;
  });

  after(async () => {
    await new Promise((resolve) => io.close(() => httpServer.close(resolve)));
  });

  it("creates a room, joins a player and a spectator, starts, and syncs a move", { timeout: 8000 }, async () => {
    const a = client(port);
    const b = client(port);
    const s = client(port);
    await Promise.all([wait(a, "connect"), wait(b, "connect"), wait(s, "connect")]);

    const created = await ask(a, "room:create", { name: "Pip" });
    assert.ok(created.code);
    assert.equal(created.isHost, true);

    const joined = await ask(b, "room:join", { name: "Goo", code: created.code });
    assert.equal(joined.code, created.code);
    assert.equal(joined.isSpectator, false);

    const spec = await ask(s, "room:join", {
      name: "Eye",
      code: created.code,
      spectator: true,
    });
    assert.equal(spec.isSpectator, true);

    const started = Promise.all([wait(b, "state"), wait(s, "state")]);
    const start = await ask(a, "room:start");
    assert.equal(start.ok, true);
    const [, snap] = await started;

    assert.equal(snap.state.status, "playing");
    assert.equal(snap.state.hexes.length, 35);
    assert.ok(snap.state.players.some((p) => p.isSpectator));
    const hex = snap.state.legalHexes[0];
    assert.ok(hex);

    const actor = snap.state.turnPlayerId;
    const mover = actor === created.playerId ? a : b;
    const moved = wait(s, "state");
    const res = await ask(mover, "game:hex", { q: hex.q, r: hex.r });
    assert.equal(res.ok, true);
    const after = await moved;
    assert.ok(after.state.slimes.length >= 1);
    assert.ok(after.events.some((e) => e.type === "hop" || e.type === "drop"));

    a.close();
    b.close();
    s.close();
  });

  it("lets a solo host add bots and start", { timeout: 8000 }, async () => {
    const a = client(port);
    await wait(a, "connect");
    const firstLobby = wait(a, "lobby");
    const created = await ask(a, "room:create", { name: "Pip" });
    await firstLobby;
    assert.ok(created.code);

    const botLobby = wait(a, "lobby");
    const bots = await ask(a, "room:bots", { count: 2 });
    assert.equal(bots.ok, true);
    const lobby = await botLobby;
    assert.equal(lobby.players.filter((p) => p.isBot).length, 2);

    const started = wait(a, "state");
    const start = await ask(a, "room:start");
    assert.equal(start.ok, true);
    const snap = await started;
    assert.equal(snap.state.status, "playing");
    assert.equal(snap.state.players.filter((p) => p.isBot).length, 2);
    assert.equal(
      snap.state.players.filter((p) => !p.isSpectator).length,
      3
    );
    a.close();
  });

  it("starts a race created with one bot", { timeout: 8000 }, async () => {
    const a = client(port);
    await wait(a, "connect");
    const lobbyP = wait(a, "lobby");
    await ask(a, "room:create", { name: "Pip", bots: 1 });
    const lobby = await lobbyP;
    assert.equal(lobby.players.filter((p) => p.isBot).length, 1);

    const started = wait(a, "state");
    const start = await ask(a, "room:start");
    assert.equal(start.ok, true);
    const snap = await started;
    const racers = snap.state.players.filter((p) => !p.isSpectator);
    const first = racers.find((p) => p.id === snap.state.turnPlayerId);
    assert.equal(first.slime, 2);
    assert.equal(racers.filter((p) => p.slime === 3).length, racers.length - 1);
    a.close();
  });
});
