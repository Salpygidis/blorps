import { NAMES } from "../shared/constants.js";

const $ = (id) => document.getElementById(id);

export const els = {
  lobby: $("lobby"),
  waiting: $("waiting"),
  hud: $("hud"),
  modal: $("modal"),
  modalBody: $("modal-body"),
  name: $("name"),
  code: $("code"),
  spectator: $("spectator"),
  waitCode: $("wait-code"),
  waitRole: $("wait-role"),
  waitList: $("wait-list"),
  btnCreate: $("btn-create"),
  btnVs1: $("btn-vs-1"),
  btnVs2: $("btn-vs-2"),
  btnJoin: $("btn-join"),
  btnHow: $("btn-how"),
  botRow: $("bot-row"),
  btnBots0: $("btn-bots-0"),
  btnBots1: $("btn-bots-1"),
  btnBots2: $("btn-bots-2"),
  btnStart: $("btn-start"),
  btnLeave: $("btn-leave"),
  btnCopy: $("btn-copy"),
  hudCode: $("hud-code"),
  turnBanner: $("turn-banner"),
  turnText: $("turn-text"),
  scoreboard: $("scoreboard"),
  ticker: $("ticker"),
  actionBar: $("action-bar"),
  dirPad: $("dir-pad"),
  btnEnd: $("btn-end"),
  btnMute: $("btn-mute"),
  btnHelp: $("btn-help"),
  toast: $("toast"),
};

export function randomName() {
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}

export function showScreen(name) {
  els.lobby.classList.toggle("hidden", name !== "lobby");
  els.waiting.classList.toggle("hidden", name !== "waiting");
  els.hud.classList.toggle("hidden", name !== "hud");
}

export function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

export function renderLobbyList(lobby, meId) {
  els.waitCode.textContent = lobby.code;
  els.waitList.innerHTML = lobby.players
    .map((p) => {
      const tags = [
        p.id === lobby.hostId ? "host" : "",
        p.isBot ? "bot" : p.isSpectator ? "spectator" : "player",
        p.isBot || p.connected ? "" : "away",
        p.id === meId ? "you" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const tagClass = p.isBot ? "tag bot" : "tag";
      return `<li><span>${escapeHtml(p.name)}</span><span class="${tagClass}">${tags}</span></li>`;
    })
    .join("");
}

export function renderHud(state, me) {
  els.hudCode.textContent = state.roomCode;
  const cur = state.players.find((p) => p.id === state.turnPlayerId);
  const mine = me && cur && cur.id === me.id && !me.isSpectator;
  els.turnBanner.classList.toggle("mine", !!mine);
  els.turnText.textContent = turnLabel(state, cur, me);
  els.scoreboard.innerHTML = state.players
    .filter((p) => !p.isSpectator)
    .map((p) => playerCard(p, state))
    .join("");
  const last = state.log?.[state.log.length - 1];
  els.ticker.textContent = last?.text || "First to 10 goo wins.";
  renderActions(state, me);
}

function turnLabel(state, cur, me) {
  if (state.status === "finished") {
    const w = state.players.find((p) => p.id === state.winnerId);
    return `${w?.name || "Someone"} wins!`;
  }
  if (!cur) return "Waiting…";
  const you = me && cur.id === me.id;
  const phase = state.ui?.kind;
  if (phase === "contact") {
    return you
      ? `Bounce off ${state.ui.otherName} or bop them?`
      : `${cur.name} bumped ${state.ui.otherName}`;
  }
  if (phase === "bounce") {
    return you ? `Free bounce — pick a hex (${state.ui.range})` : `${cur.name} is bouncing`;
  }
  if (phase === "bop") {
    return you ? `Push ${state.ui.otherName} up to ${state.ui.range} hexes` : `${cur.name} is bopping`;
  }
  if (phase === "upgrade") return you ? "You drew an upgrade!" : `${cur.name} drew a card`;
  const moves = state.remainingMove;
  if (you) return `Your turn · ${moves} move${moves === 1 ? "" : "s"}`;
  return `${cur.name}'s turn · ${moves} left`;
}

function playerCard(p, state) {
  const current = p.id === state.turnPlayerId ? " current" : "";
  const pips = Array.from({ length: 10 }, (_, i) => `<i class="${i < p.slime ? "on" : ""}"></i>`).join("");
  const ups = (p.upgrades || []).map((u) => u.emoji).join(" ") || "—";
  const mark = p.isBot ? " 🤖" : p.connected ? "" : " (away)";
  return `<article class="player-card${current}" style="border-left-color:${p.color.hex};color:${p.color.hex}">
    <div class="who"><span>${escapeHtml(p.name)}${mark}</span><span>${p.slime}</span></div>
    <div class="pips">${pips}</div>
    <div class="up-row">${ups}</div>
  </article>`;
}

function renderActions(state, me) {
  const mine = me && !me.isSpectator && me.id === state.turnPlayerId && state.status === "playing";
  els.actionBar.classList.add("hidden");
  els.dirPad.classList.add("hidden");
  els.btnEnd.classList.add("hidden");
  els.actionBar.innerHTML = "";
  if (!mine) return;

  const kind = state.ui?.kind;
  if (kind === "contact") {
    els.actionBar.classList.remove("hidden");
    els.actionBar.innerHTML = `
      <button class="btn primary" data-act="bounce" type="button">Bounce</button>
      <button class="btn" data-act="bop" type="button">Bop</button>
    `;
    return;
  }
  if (kind === "move") {
    els.dirPad.classList.remove("hidden");
    els.btnEnd.classList.toggle("hidden", !state.ui.canEnd);
  }
  if (kind === "bounce" || kind === "bop") {
    els.dirPad.classList.remove("hidden");
  }
}

export function showHow() {
  els.modalBody.innerHTML = `
    <h2>How to play</h2>
    <p>You are a cute ooze. Collect goo. First to <strong>10 slime points</strong> wins.</p>
    <ul>
      <li>Start at size 3 with 2-hex moves. At size 6 you slow to 1 hex (unless you draw Zoomies).</li>
      <li>On your turn, tap a glowing neighbor. You may change direction freely.</li>
      <li>You <strong>must drop 1 goo</strong> on the first hex you land on.</li>
      <li>Land on a slime token (yours or theirs): slurp it, then <strong>pivot and launch</strong> a free bounce.</li>
      <li>Land on a player: <strong>Bounce</strong> off them, or <strong>Bop</strong> them up to 2 hexes and steal 1 goo.</li>
      <li>Fruit (apple/banana +1, grapes +2) is eaten when you land on or bounce over it. No respawns.</li>
      <li>Crystals are capture points. Each player may claim each one once: +1 goo, an upgrade card, and a slime drop.</li>
    </ul>
    <p>Race solo with <strong>1 or 2 bots</strong>, or share a room code. Spectators watch the board live.</p>
    <button class="btn primary" id="close-modal" type="button">Got it</button>
  `;
  els.modal.classList.remove("hidden");
}

export function showCard(card) {
  els.modalBody.innerHTML = `
    <div class="card-art"><div class="emoji">${card.emoji}</div></div>
    <h2>${escapeHtml(card.name)}</h2>
    <p>${escapeHtml(card.desc)}</p>
    <button class="btn primary" id="close-modal" data-ack="1" type="button">Nice!</button>
  `;
  els.modal.classList.remove("hidden");
}

export function showWin(state, me) {
  const w = state.players.find((p) => p.id === state.winnerId);
  const host = me && me.id === state.hostId;
  els.modalBody.innerHTML = `
    <div class="win-art">🏆</div>
    <h2>${escapeHtml(w?.name || "A Blorp")} wins!</h2>
    <p>First to 10 goo. Rematch?</p>
    ${host ? `<button class="btn primary" id="btn-again" type="button">Play again</button>` : `<p class="muted">Waiting for the host…</p>`}
    <button class="btn ghost" id="close-modal" type="button">Close</button>
  `;
  els.modal.classList.remove("hidden");
}

export function hideModal() {
  els.modal.classList.add("hidden");
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

export function buildDirPad() {
  const arrows = ["▲", "◥", "◢", "▼", "◣", "◤"];
  els.dirPad.innerHTML = arrows
    .map((a, i) => `<button type="button" data-dir="${i}" aria-label="Move ${i}">${a}</button>`)
    .join("");
}
