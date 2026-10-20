import { NAMES } from "../shared/constants.js";
import { tally } from "../shared/score.js";
import { sfx } from "./audio.js";
import { freeBounceWhy } from "./results.js";

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
  deckCount: $("deck-count"),
  announce: $("announce"),
  turnBanner: $("turn-banner"),
  turnText: $("turn-text"),
  scoreboard: $("scoreboard"),
  inventory: $("inventory"),
  feed: $("feed"),
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

let feedRoom = "";
let feedVersion = -1;

export function prepareFeed(state) {
  if (!els.feed || !state) return;
  const fresh = state.roomCode !== feedRoom || state.version < feedVersion;
  if (fresh) {
    els.feed.replaceChildren();
    feedRoom = state.roomCode || "";
  }
  feedVersion = state.version ?? 0;
}

export function showResults(lines) {
  if (!els.feed || !lines?.length) return;
  for (const row of els.feed.querySelectorAll(".fresh")) row.classList.remove("fresh");
  const nearBottom = els.feed.scrollHeight - els.feed.scrollTop - els.feed.clientHeight < 48;
  for (const line of lines) {
    const row = document.createElement("article");
    row.className = "result-line fresh";
    row.innerHTML = `<span class="emoji" aria-hidden="true">${line.emoji}</span><p>${escapeHtml(line.text)}</p>`;
    els.feed.appendChild(row);
  }
  if (nearBottom) els.feed.scrollTop = els.feed.scrollHeight;
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
  if (els.deckCount) els.deckCount.textContent = String(state.deckRemaining ?? 0);
  els.scoreboard.innerHTML = state.players
    .filter((p) => !p.isSpectator)
    .map((p) => playerCard(p, state))
    .join("");
  renderInventory(state, me);
  prepareFeed(state);
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
    const hops = state.ui.range === 1 ? "1 hex" : `${state.ui.range} hexes`;
    const why = freeBounceWhy(state.ui);
    return you
      ? `Free bounce — you ${why}. Up to ${hops}, straight through one side`
      : `${cur.name}'s free bounce — they ${why}`;
  }
  if (phase === "bop") {
    const hops = state.ui.range === 1 ? "1 hex" : `${state.ui.range} hexes`;
    return you
      ? `Push ${state.ui.otherName} up to ${hops} in a straight line`
      : `${cur.name} is bopping`;
  }
  if (phase === "upgrade") return you ? "You drew a power-up!" : `${cur.name} drew a card`;
  const moves = state.remainingMove;
  if (you) return `Your turn · ${moves} move${moves === 1 ? "" : "s"}`;
  return `${cur.name}'s turn · ${moves} left`;
}

let openPowerupId = "";

function powerupItems(upgrades) {
  const items = [];
  for (const upgrade of upgrades || []) {
    const found = items.find((item) => item.id === upgrade.id);
    if (found) found.count += 1;
    else {
      items.push({
        id: upgrade.id,
        name: upgrade.name,
        emoji: upgrade.emoji,
        desc: upgrade.desc,
        count: 1,
      });
    }
  }
  return items;
}

function powerupPopup(upgrades) {
  const items = powerupItems(upgrades);
  if (!items.length) {
    return `<div class="powerups" role="tooltip"><p class="powerups-empty">No powerups yet.</p></div>`;
  }
  const rows = items
    .map((item) => {
      const count = item.count > 1 ? ` ×${item.count}` : "";
      return `<li>
        <span class="emoji" aria-hidden="true">${item.emoji}</span>
        <span>
          <strong>${escapeHtml(item.name)}${count}</strong>
          <span class="desc">${escapeHtml(item.desc || "")}</span>
        </span>
      </li>`;
    })
    .join("");
  return `<div class="powerups" role="tooltip"><p class="powerups-title">Powerups</p><ul>${rows}</ul></div>`;
}

function playerCard(p, state) {
  const current = p.id === state.turnPlayerId ? " current" : "";
  const open = p.id === openPowerupId ? " open" : "";
  const score = Number.isFinite(p.score) ? p.score : tally(p).points;
  const pips = Array.from({ length: 10 }, (_, i) => `<i class="${i < score ? "on" : ""}"></i>`).join("");
  const ups = (p.upgrades || []).map((u) => u.emoji).join(" ");
  const mark = p.isBot ? " 🤖" : p.connected ? "" : " (away)";
  const extras = [`size ${p.slime}`, ups].filter(Boolean).join(" · ");
  return `<article class="player-card${current}${open}" data-id="${escapeHtml(p.id)}" tabindex="0" style="border-left-color:${p.color.hex};color:${p.color.hex}">
    <div class="who"><span>${escapeHtml(p.name)}${mark}</span><span>${score}</span></div>
    <div class="pips">${pips}</div>
    <div class="up-row">${extras}</div>
    ${powerupPopup(p.upgrades)}
  </article>`;
}

function inventoryOwner(state, me) {
  const mine = state.players.find((p) => p.id === me?.id && !p.isSpectator);
  if (mine) return mine;
  return (
    state.players.find((p) => p.id === state.turnPlayerId && !p.isSpectator) ||
    state.players.find((p) => !p.isSpectator) ||
    null
  );
}

function chips(emoji, count) {
  const n = Math.max(0, Math.min(count, 12));
  if (!n) return "";
  return Array.from({ length: n }, () => emoji).join("");
}

function renderInventory(state, me) {
  if (!els.inventory) return;
  const owner = inventoryOwner(state, me);
  if (!owner) {
    els.inventory.innerHTML = "";
    return;
  }
  const mine = me && owner.id === me.id;
  const tray = tally(owner);
  const rows = tray.lines
    .map((line) => {
      const pieces = line.kind === "bonus" ? "" : chips(line.emoji, line.count);
      const detail =
        line.kind === "fruit"
          ? `${line.each} each`
          : line.kind === "bonus"
            ? `×${line.count}`
            : line.count > 1
              ? `×${line.count}`
              : "";
      return `<li class="inv-row${line.kind === "bonus" ? " bonus" : ""}">
        <span class="inv-chips" aria-hidden="true">${pieces}</span>
        <span class="inv-label">${escapeHtml(line.label)}${detail ? ` <em>${escapeHtml(detail)}</em>` : ""}</span>
        <span class="inv-pts">${line.points}</span>
      </li>`;
    })
    .join("");
  els.inventory.innerHTML = `
    <div class="inv-head">
      <span>${mine ? "Your stuff" : `${escapeHtml(owner.name)}'s stuff`}</span>
      <strong>${tray.points}</strong>
    </div>
    <ul>${rows}</ul>
    <p class="inv-total"><span>Add it up</span><strong>${tray.points}</strong></p>
  `;
}

if (els.scoreboard) {
  els.scoreboard.addEventListener("click", (e) => {
    const card = e.target.closest(".player-card");
    if (!card) return;
    const id = card.dataset.id;
    openPowerupId = openPowerupId === id ? "" : id;
    for (const el of els.scoreboard.querySelectorAll(".player-card")) {
      el.classList.toggle("open", el.dataset.id === openPowerupId);
    }
  });
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
    <p>You are a cute ooze. First to <strong>10 points</strong> wins. The tray at the bottom right is everything you are holding. Add it up.</p>
    <ul>
      <li>Each slime you hold is <strong>1 point</strong> and is also your size. Start with 3. At size 6 you slow to 1 move. <strong>Zoomies</strong> lets your first step be a straight hop of 2 hexes, and big Blorps still move 2. <strong>Long Reach</strong> adds 1 move while you are smaller than size 6.</li>
      <li>Stepping up onto a higher hex costs 2 moves, or 1 if you are size 6 or bigger. <strong>Slip-n-Slide</strong> leaves water for 1 move, even uphill.</li>
      <li>On your turn, tap a glowing hex. You may change direction between steps. A Zoomies hop flies straight over the hex in the middle.</li>
      <li>Trees block the way. You cannot move onto one or be pushed onto one. <strong>Treehopper</strong> lets a free bounce or a bop hop <em>over</em> a tree and land on a hex past it.</li>
      <li>You <strong>must drop 1 goo</strong> on the first hex you land on.</li>
      <li>Land on a slime token (yours or theirs): it goes in your tray for <strong>1 point</strong> and a <strong>free bounce</strong>.</li>
      <li>A free bounce leaves through <strong>one of the six sides</strong> and keeps going straight, up to 2 hexes. You cannot turn.</li>
      <li>Land on a player: <strong>Bounce</strong> off them the same way, or <strong>Bop</strong> them up to 2 hexes in a straight line and steal 1 goo. <strong>Goo Armor</strong> makes the first bop against you each round steal nothing and push only 1 hex.</li>
      <li>If you are pushed onto a hex, you do not drop goo. You do pick up fruit, slime, or a new crystal there. A slime you pick up while being pushed does not give a free bounce.</li>
      <li>Apples and bananas in your tray are <strong>1 point</strong>. Grapes are <strong>2</strong>. Fruit does not change your size. Flying over it leaves it behind.</li>
      <li>Every power-up you hold is <strong>1 point</strong>. <strong>Apple Fan</strong>, <strong>Banana Bunch</strong>, and <strong>Grape Stomp</strong> also add +1 for each of that fruit in your tray.</li>
      <li>Land on a crystal you have not used yet and draw the top card of the power-up deck. Each crystal works once for you.</li>
    </ul>
    <p>Race solo with <strong>1 or 2 bots</strong>, or share a room code. Spectators watch the board live.</p>
    <button class="btn primary" id="close-modal" type="button">Got it</button>
  `;
  els.modal.classList.remove("hidden");
}

export function showCard(card, deckRemaining) {
  const left = Number.isFinite(deckRemaining) ? Number(deckRemaining) : null;
  const leftText =
    left === null
      ? ""
      : `<p class="muted">${left} card${left === 1 ? "" : "s"} left in the deck.</p>`;
  els.modalBody.innerHTML = `
    <p class="eyebrow">Power-up deck</p>
    <div class="deck-draw">
      <div class="deck-pile" aria-hidden="true">Deck</div>
      <div class="card-art"><div class="emoji">${card.emoji}</div></div>
    </div>
    <h2>${escapeHtml(card.name)}</h2>
    <p>You draw the top card.</p>
    <p>${escapeHtml(card.desc)}</p>
    <p>Every card you hold is worth 1 point.</p>
    ${leftText}
    <button class="btn primary" id="close-modal" data-ack="1" type="button">Nice!</button>
  `;
  els.modal.classList.remove("hidden");
}

export function announceFreeBounce(name, ev = {}) {
  if (!els.announce) return;
  sfx("freebounce");
  const range = ev.range ?? 2;
  const hops = range === 1 ? "1 hex" : `${range} hexes`;
  const why = freeBounceWhy(ev);
  const lead = why.charAt(0).toUpperCase() + why.slice(1);
  els.announce.innerHTML = `
    <div class="announce-card">
      <strong>Free bounce!</strong>
      <span>${escapeHtml(lead)}</span>
      <span>${escapeHtml(name)} · up to ${hops} in a straight line</span>
    </div>
  `;
  els.announce.classList.remove("show");
  void els.announce.offsetWidth;
  els.announce.classList.add("show");
  clearTimeout(announceFreeBounce._t);
  announceFreeBounce._t = setTimeout(() => els.announce.classList.remove("show"), 2600);
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
