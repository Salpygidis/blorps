export function attachSockets(io, rooms) {
  io.on("connection", (socket) => {
    socket.on("room:create", (payload = {}, cb) => {
      const { room, player } = rooms.create(socket, payload);
      ack(cb, joinedPayload(room, player));
      rooms.broadcast(room);
    });

    socket.on("room:join", (payload = {}, cb) => {
      const result = rooms.join(socket, payload);
      if (result.error) return ack(cb, { error: result.error });
      ack(cb, joinedPayload(result.room, result.player));
      rooms.broadcast(result.room);
    });

    socket.on("room:rejoin", (payload = {}, cb) => {
      const result = rooms.rejoin(socket, payload);
      if (result.error) return ack(cb, { error: result.error });
      ack(cb, joinedPayload(result.room, result.player));
      rooms.broadcast(result.room);
    });

    socket.on("room:start", (_payload, cb) => {
      try {
        const result = rooms.start(socket);
        if (result.error) return ack(cb, { error: result.error });
        ack(cb, { ok: true });
        rooms.broadcast(result.room, result.room.game?.events || []);
      } catch (err) {
        console.error("room:start failed", err);
        ack(cb, { error: "Could not start the race." });
      }
    });

    socket.on("room:bots", (payload = {}, cb) => {
      const result = rooms.setBots(socket, payload);
      if (result.error) return ack(cb, { error: result.error });
      ack(cb, { ok: true, count: result.room.lobby.filter((p) => p.isBot).length });
      rooms.broadcast(result.room);
    });

    socket.on("room:again", (_payload, cb) => {
      const result = rooms.again(socket);
      if (result.error) return ack(cb, { error: result.error });
      ack(cb, { ok: true });
      rooms.broadcast(result.room, result.room.game?.events || []);
    });

    socket.on("game:hex", (payload = {}, cb) => {
      const { q, r } = payload;
      const { room, result, error } = rooms.act(socket, (game, id) =>
        game.clickHex(id, Number(q), Number(r))
      );
      if (error) return ack(cb, { error });
      if (result && !result.ok) return ack(cb, { error: result.error });
      ack(cb, { ok: true });
      rooms.broadcast(room, room.game.events);
    });

    socket.on("game:contact", (payload = {}, cb) => {
      const { room, result, error } = rooms.act(socket, (game, id) =>
        game.chooseContact(id, payload.action)
      );
      if (error) return ack(cb, { error });
      if (result && !result.ok) return ack(cb, { error: result.error });
      ack(cb, { ok: true });
      rooms.broadcast(room, room.game.events);
    });

    socket.on("game:ack", (_payload, cb) => {
      const { room, result, error } = rooms.act(socket, (game, id) =>
        game.ackUpgrade(id)
      );
      if (error) return ack(cb, { error });
      if (result && !result.ok) return ack(cb, { error: result.error });
      ack(cb, { ok: true });
      rooms.broadcast(room, room.game.events);
    });

    socket.on("game:endTurn", (_payload, cb) => {
      const { room, result, error } = rooms.act(socket, (game, id) =>
        game.skipTurn(id)
      );
      if (error) return ack(cb, { error });
      if (result && !result.ok) return ack(cb, { error: result.error });
      ack(cb, { ok: true });
      rooms.broadcast(room, room.game.events);
    });

    socket.on("disconnect", () => {
      rooms.disconnect(socket);
    });
  });
}

function joinedPayload(room, player) {
  return {
    playerId: player.id,
    code: room.code,
    isHost: player.id === room.hostId,
    isSpectator: !!player.isSpectator,
    name: player.name,
  };
}

function ack(cb, payload) {
  if (typeof cb === "function") cb(payload);
}
