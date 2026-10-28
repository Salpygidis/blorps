import { NAMES } from "../shared/constants.js";
import { tally } from "../shared/score.js";
import { UPGRADES } from "../shared/upgrades.js";
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
  btnBotsLess: $("btn-bots-less"),
  btnBotsMore: $("btn-bots-more"),
  botCount: $("bot-count"),
  btnStart: $("btn-start"),
  btnLeave: $("btn-leave"),
  btnCopy: $("btn-copy"),
  hudCode: $("hud-code"),
  deckCount: $("deck-count"),
  announce: $("announce"),
  turnCall: $("turn-call"),
  turnBanner: $("turn-banner"),
  turnText: $("turn-text"),
  scoreboard: $("scoreboard"),
  powerupTip: $("powerup-tip"),
  inventory: $("inventory"),
  feedDock: $("feed-dock"),
  feedToggle: $("feed-toggle"),
  feed: $("feed"),
  actionBar: $("action-bar"),
  btnEnd: $("btn-end"),
  btnMute: $("btn-mute"),
  volume: $("volume"),
  btnHelp: $("btn-help"),
  toast: $("toast"),
  hexTip: $("hex-tip"),
};

export function randomName() {
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}

export function showScreen(name) {
  els.lobby.classList.toggle("hidden", name !== "lobby");
  els.waiting.classList.toggle("hidden", name !== "waiting");
  els.hud.classList.toggle("hidden", name !== "hud");
}

export function hideHexTip() {
  if (!els.hexTip) return;
  els.hexTip.classList.add("hidden");
  els.hexTip.innerHTML = "";
}

export function showHexTip(lines, x, y) {
  if (!els.hexTip || !lines?.length) return hideHexTip();
  els.hexTip.innerHTML = lines
    .map(
      (line) =>
        `<p><span class="emoji" aria-hidden="true">${line.emoji || ""}</span>${escapeHtml(line.text)}</p>`
    )
    .join("");
  els.hexTip.classList.remove("hidden");
  const pad = 12;
  const width = els.hexTip.offsetWidth;
  const height = els.hexTip.offsetHeight;
  let left = x + 18;
  let top = y + 18;
  if (left + width > window.innerWidth - pad) left = x - width - 14;
  if (top + height > window.innerHeight - pad) top = y - height - 14;
  els.hexTip.style.left = `${Math.max(pad, left)}px`;
  els.hexTip.style.top = `${Math.max(pad, top)}px`;
}

export function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

let feedRoom = "";
let feedVersion = -1;

const feedDrawerQuery = window.matchMedia("(max-width: 720px)");

function feedIsDrawer() {
  return feedDrawerQuery.matches;
}

function syncFeedToggle() {
  if (!els.feed || !els.feedToggle || !els.feedDock) return;
  const count = els.feed.childElementCount;
  const drawer = feedIsDrawer();
  const open = els.feedDock.classList.contains("open");
  els.feedToggle.hidden = !drawer || count === 0;
  els.feedToggle.setAttribute("aria-expanded", open ? "true" : "false");
  els.feedToggle.textContent = open ? "Hide notes" : `Notes (${count})`;
  if (drawer && !open) els.feed.setAttribute("inert", "");
  else els.feed.removeAttribute("inert");
  if (!drawer) els.feedDock.classList.remove("open");
}

export function prepareFeed(state) {
  if (!els.feed || !state) return;
  const fresh = state.roomCode !== feedRoom || state.version < feedVersion;
  if (fresh) {
    els.feed.replaceChildren();
    els.feedDock?.classList.remove("open");
    els.feedToggle?.classList.remove("fresh");
    feedRoom = state.roomCode || "";
  }
  feedVersion = state.version ?? 0;
  syncFeedToggle();
}

export function showResults(lines) {
  if (!els.feed || !lines?.length) return;
  for (const row of els.feed.querySelectorAll(".fresh")) row.classList.remove("fresh");
  const nearBottom = els.feed.scrollHeight - els.feed.scrollTop - els.feed.clientHeight < 48;
  const closedDrawer = feedIsDrawer() && !els.feedDock?.classList.contains("open");
  for (const line of lines) {
    const row = document.createElement("article");
    row.className = "result-line fresh";
    row.innerHTML = `<span class="emoji" aria-hidden="true">${line.emoji}</span><p>${escapeHtml(line.text)}</p>`;
    els.feed.appendChild(row);
  }
  if (nearBottom) els.feed.scrollTop = els.feed.scrollHeight;
  if (closedDrawer) els.feedToggle?.classList.add("fresh");
  syncFeedToggle();
}

if (els.feedToggle && els.feedDock) {
  els.feedToggle.addEventListener("click", () => {
    els.feedDock.classList.toggle("open");
    if (els.feedDock.classList.contains("open")) {
      els.feedToggle.classList.remove("fresh");
      requestAnimationFrame(() => {
        els.feed.scrollTop = els.feed.scrollHeight;
      });
    }
    syncFeedToggle();
  });
  feedDrawerQuery.addEventListener("change", syncFeedToggle);
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
  refreshPowerupTip();
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
      ? `Bounce off ${state.ui.otherName}, or bop them for a slime${state.ui.fruitCount ? " or a fruit" : ""}?`
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
      ? `Push ${state.ui.otherName} up to ${hops} in a straight line. You'll take ${state.ui.steal === "fruit" ? "a fruit" : "a slime"}.`
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
    const known = UPGRADES[upgrade.id] || {};
    const found = items.find((item) => item.id === upgrade.id);
    if (found) found.count += 1;
    else {
      items.push({
        id: upgrade.id,
        name: upgrade.name || known.name || "Power-up",
        emoji: upgrade.emoji || known.emoji || "✨",
        desc: upgrade.desc || known.desc || "",
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
  return `<article class="player-card${current}${open}" data-id="${escapeHtml(p.id)}" tabindex="0" style="border-left-color:${p.color.hex};color:${p.color.hex}">
    <div class="who"><span>${escapeHtml(p.name)}${mark}</span><span>${score}</span></div>
    <div class="pips">${pips}</div>
    <div class="up-row">${ups}</div>
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
  els.scoreboard.addEventListener("pointerover", (e) => {
    const card = e.target.closest(".player-card");
    if (card) showPowerupTip(card);
  });
  els.scoreboard.addEventListener("pointerout", (e) => {
    const card = e.target.closest(".player-card");
    if (!card) return;
    const next = e.relatedTarget;
    if (next && (card.contains(next) || els.powerupTip?.contains(next))) return;
    if (openPowerupId) {
      const pinned = els.scoreboard.querySelector(".player-card.open");
      if (pinned) showPowerupTip(pinned);
      else hidePowerupTip();
      return;
    }
    hidePowerupTip();
  });
  els.powerupTip?.addEventListener("pointerleave", () => {
    if (openPowerupId) {
      const pinned = els.scoreboard.querySelector(".player-card.open");
      if (pinned) showPowerupTip(pinned);
      return;
    }
    hidePowerupTip();
  });
  els.scoreboard.addEventListener("click", (e) => {
    const card = e.target.closest(".player-card");
    if (!card) return;
    const id = card.dataset.id;
    openPowerupId = openPowerupId === id ? "" : id;
    for (const el of els.scoreboard.querySelectorAll(".player-card")) {
      el.classList.toggle("open", el.dataset.id === openPowerupId);
    }
    if (openPowerupId) showPowerupTip(card);
    else hidePowerupTip();
  });
}

function showPowerupTip(card) {
  const source = card.querySelector(".powerups");
  const tip = els.powerupTip;
  if (!source || !tip) return;
  tip.innerHTML = source.innerHTML;
  tip.dataset.for = card.dataset.id || "";
  tip.classList.add("show");
  const cardRect = card.getBoundingClientRect();
  tip.style.left = "0px";
  tip.style.top = "0px";
  const tipRect = tip.getBoundingClientRect();
  const gap = 10;
  let left = cardRect.left - tipRect.width - gap;
  let top = cardRect.top;
  if (left < 8) {
    left = Math.max(8, Math.min(cardRect.left, window.innerWidth - tipRect.width - 8));
    top = cardRect.bottom + gap;
  }
  if (top + tipRect.height > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - tipRect.height - 8);
  }
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function hidePowerupTip() {
  els.powerupTip?.classList.remove("show");
}

function refreshPowerupTip() {
  const tip = els.powerupTip;
  if (!tip?.classList.contains("show") && !openPowerupId) return;
  const id = openPowerupId || tip?.dataset.for;
  const card = id
    ? els.scoreboard.querySelector(`.player-card[data-id="${CSS.escape(id)}"]`)
    : null;
  if (card) showPowerupTip(card);
  else hidePowerupTip();
}

function renderActions(state, me) {
  const mine = me && !me.isSpectator && me.id === state.turnPlayerId && state.status === "playing";
  els.actionBar.classList.add("hidden");
  els.btnEnd.classList.add("hidden");
  els.actionBar.innerHTML = "";
  if (!mine) return;

  const kind = state.ui?.kind;
  if (kind === "contact") {
    els.actionBar.classList.remove("hidden");
    const fruitBtn = state.ui?.fruitCount
      ? `<button class="btn" data-act="bop-fruit" type="button">Bop for fruit</button>`
      : "";
    els.actionBar.innerHTML = `
      <button class="btn primary" data-act="bounce" type="button">Bounce</button>
      <button class="btn" data-act="bop" type="button">Bop for slime</button>
      ${fruitBtn}
    `;
    return;
  }
  if (kind === "move") {
    els.btnEnd.classList.toggle("hidden", !state.ui.canEnd);
  }
}

export function showHow() {
  els.modalBody.innerHTML = `
    <h2>How to play</h2>
    <p>You are a cute ooze. First to <strong>10 points</strong> wins, and only after you have touched <strong>every crystal</strong>. The tray at the bottom right is everything you are holding. Add it up.</p>
    <ul>
      <li>Each slime you hold is <strong>1 point</strong>. Everyone starts with 2. A random Blorp goes first. A turn that starts at <strong>6 points</strong> or more has 1 move. <strong>Zoomies</strong> lets that first step be a straight hop of 2 hexes. <strong>Long Reach</strong> adds 1 move while you have fewer than 6 points.</li>
      <li>Hold the pointer on a hex for a second to see everything there, including a slime standing on a crystal pool.</li>
      <li>Stepping up onto a higher hex costs 2 moves, or 1 if you have <strong>6 points</strong> or more. <strong>Slip-n-Slide</strong> leaves water for 1 move while you have fewer than 6 points, even uphill.</li>
      <li>On your turn, tap a glowing hex. You may change direction between steps. A Zoomies hop flies straight over the hex in the middle.</li>
      <li>Trees block the way. You cannot move onto one or be pushed onto one. <strong>Treehopper</strong> lets a free bounce or a bop hop <em>over</em> a tree and land on a hex past it.</li>
      <li>Your first move <strong>leaves 1 goo</strong> on the hex you started from. You cannot jump straight back onto that hex with your next hop. A later hop can, including a free bounce after you land on a slime.</li>
      <li>Land on a slime token (yours or theirs): it goes in your tray for <strong>1 point</strong> and a <strong>free bounce</strong>.</li>
      <li>A free bounce leaves through <strong>one of the six sides</strong> and keeps going straight, up to 2 hexes. You cannot turn.</li>
      <li>Land on a player: <strong>Bounce</strong> off them the same way, or <strong>Bop</strong> them up to 2 hexes in a straight line. Choose to steal 1 goo, or a random fruit from their tray. If that push lands on another Blorp, they get bumped 1 hex the same way. <strong>Goo Armor</strong> makes the first bop against you each round steal nothing and push only 1 hex.</li>
      <li>If you are pushed onto a hex, you do not drop goo. You do pick up fruit, slime, or a new crystal there. A slime you pick up while being pushed does not give a free bounce.</li>
      <li>The board starts with one apple, one banana, and one bunch of grapes per player. Each fruit in your tray is <strong>1 point</strong>. Flying over fruit leaves it behind.</li>
      <li>Every power-up you hold is <strong>1 point</strong>. <strong>Apple Fan</strong>, <strong>Banana Bunch</strong>, and <strong>Grape Stomp</strong> also add +1 for each of that fruit in your tray.</li>
      <li>Each foundation has <strong>two crystal pools</strong>. A pool is a liquid tile with crystals printed on it. Land on one you have not used yet and draw the top card. Touch <strong>every crystal</strong> on the board, and reach 10 points, to win. Each pool works once for you.</li>
    </ul>
    <p>Race solo with bots, or share a room code. Up to <strong>10</strong> racers. One foundation holds 2–5, and 6–10 add a second. Spectators watch the board live.</p>
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

export function showYourTurn() {
  if (!els.turnCall) return;
  els.turnCall.classList.remove("show");
  void els.turnCall.offsetWidth;
  els.turnCall.classList.add("show");
  sfx("turn");
  clearTimeout(showYourTurn._t);
  showYourTurn._t = setTimeout(() => els.turnCall.classList.remove("show"), 1700);
}

export function announceFreeBounce() {
  if (!els.announce) return;
  sfx("freebounce");
  els.announce.innerHTML = `<div class="announce-card"><strong>free bounce</strong></div>`;
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
    <p>First to 10 points, after touching every crystal. Rematch?</p>
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


