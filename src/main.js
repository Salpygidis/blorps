import { onFaceLine } from "../shared/hex.js";
import { socket, emit } from "./net.js";
import { GameScene } from "./scene.js";
import { sfx, setMuted, isMuted, unlockAudio, setMatchMusic } from "./audio.js";
import {
  els,
  randomName,
  showScreen,
  toast,
  renderLobbyList,
  renderHud,
  showHow,
  showCard,
  showWin,
  hideModal,
} from "./ui.js";

const canvas = document.getElementById("view");
const scene = new GameScene(canvas);

const session = {
  playerId: sessionStorage.getItem("blorps.id") || "",
  code: sessionStorage.getItem("blorps.code") || "",
  name: sessionStorage.getItem("blorps.name") || "",
  isHost: false,
  isSpectator: false,
};

els.name.value = session.name || randomName();

let lastState = null;
let lastLobby = null;
let shownUpgrade = null;
let shownWin = false;

scene.onHex = (q, r) => {
  if (!lastState || lastState.status !== "playing") return;
  if (session.isSpectator) return;
  if (lastState.turnPlayerId !== session.playerId) return;
  const legal = lastState.legalHexes || [];
  if (!legal.some((h) => h.q === q && h.r === r)) return;
  sfx("click");
  emit("game:hex", { q, r }).then((res) => {
    if (res.error) toast(res.error);
  });
};

els.btnCreate.onclick = () => join(true);
els.btnVs1.onclick = () => join(true, { bots: 1 });
els.btnVs2.onclick = () => join(true, { bots: 2 });
els.btnJoin.onclick = () => join(false);
els.btnBotsLess.onclick = () => setBots(Math.max(0, botCount(lastLobby) - 1));
els.btnBotsMore.onclick = () => setBots(botCount(lastLobby) + 1);
els.btnHow.onclick = showHow;
els.btnHelp.onclick = showHow;
els.btnLeave.onclick = () => location.reload();
els.btnCopy.onclick = async () => {
  const code = lastLobby?.code || session.code;
  try {
    await navigator.clipboard.writeText(code);
    toast("Copied " + code);
  } catch {
    toast(code);
  }
};
els.btnStart.onclick = () => {
  emit("room:start").then((res) => {
    if (res.error) toast(res.error);
  });
};
els.btnEnd.onclick = () => {
  emit("game:endTurn").then((res) => {
    if (res.error) toast(res.error);
  });
};
els.btnMute.onclick = () => {
  setMuted(!isMuted());
  els.btnMute.textContent = isMuted() ? "🔇" : "🔊";
};

els.actionBar.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  emit("game:contact", { action: btn.dataset.act }).then((res) => {
    if (res.error) toast(res.error);
  });
});

els.modal.addEventListener("click", (e) => {
  if (e.target.id === "close-modal") {
    const ack = e.target.dataset.ack;
    hideModal();
    if (ack) emit("game:ack");
  }
  if (e.target.id === "btn-again") {
    hideModal();
    emit("room:again").then((res) => {
      if (res.error) toast(res.error);
    });
  }
});

els.code.addEventListener("keydown", (e) => {
  if (e.key === "Enter") join(false);
});

window.addEventListener("pointerdown", unlockAudio, { once: true });

socket.on("connect", () => {
  if (session.playerId && session.code) {
    emit("room:rejoin", { code: session.code, playerId: session.playerId }).then((res) => {
      if (res.error) {
        session.playerId = "";
        sessionStorage.removeItem("blorps.id");
        return;
      }
      remember(res);
    });
  }
});

socket.on("lobby", (lobby) => {
  lastLobby = lobby;
  enterWaiting(lobby);
});

socket.on("state", ({ lobby, state, events }) => {
  lastLobby = lobby;
  keepStraightFaces(state);
  lastState = state;
  scene.setLocal(session.playerId);
  const me = {
    id: session.playerId,
    isSpectator: session.isSpectator || lobby.players.find((p) => p.id === session.playerId)?.isSpectator,
  };
  if (state.status === "playing" || state.status === "finished") {
    setMatchMusic(true);
    showScreen("hud");
    renderHud(state, {
      ...me,
      id: session.playerId,
      isSpectator: me.isSpectator,
      hostId: state.hostId,
    });
    maybeModals(state, me);
  } else {
    enterWaiting(lobby);
  }
  try {
    scene.applyState(state, events);
  } catch (err) {
    console.error("scene apply failed", err);
  }
});

socket.on("connect_error", () => toast("Can't reach the Blorps server"));

function enterWaiting(lobby) {
  if (!lobby) return;
  setMatchMusic(false);
  showScreen("waiting");
  renderLobbyList(lobby, session.playerId);
  const me = lobby.players.find((p) => p.id === session.playerId);
  session.isHost = me && me.id === lobby.hostId;
  session.isSpectator = !!me?.isSpectator;
  const bots = botCount(lobby);
  els.waitRole.textContent = session.isSpectator
    ? "You are watching."
    : session.isHost
      ? bots
        ? "Start whenever you’re ready — bots will take their own turns."
        : "Add a bot to race solo, or share the code with friends."
      : "Waiting for the host to start.";
  els.btnStart.classList.toggle("hidden", !session.isHost);
  els.botRow.classList.toggle("hidden", !session.isHost);
  if (els.botCount) els.botCount.textContent = String(bots);
}

function botCount(lobby) {
  return (lobby?.players || []).filter((p) => p.isBot).length;
}

function remember(res) {
  session.playerId = res.playerId;
  session.code = res.code;
  session.isHost = res.isHost;
  session.isSpectator = res.isSpectator;
  session.name = res.name;
  sessionStorage.setItem("blorps.id", res.playerId);
  sessionStorage.setItem("blorps.code", res.code);
  sessionStorage.setItem("blorps.name", res.name);
  scene.setLocal(res.playerId);
  if (lastLobby) enterWaiting(lastLobby);
}

function setBots(count) {
  emit("room:bots", { count }).then((res) => {
    if (res.error) toast(res.error);
  });
}

async function join(create, extra = {}) {
  unlockAudio();
  const name = els.name.value.trim() || randomName();
  const spectator = els.spectator.checked;
  const payload = { name, spectator, ...extra };
  const res = create
    ? await emit("room:create", payload)
    : await emit("room:join", { ...payload, code: els.code.value.trim().toUpperCase() });
  if (res.error) return toast(res.error);
  remember(res);
  if (res.isSpectator && !spectator) toast("Joined as spectator — the race already started.");
}

function maybeModals(state, me) {
  if (state.ui?.kind === "upgrade" && state.turnPlayerId === session.playerId) {
    const id = state.ui.card?.id + state.version;
    if (shownUpgrade !== id) {
      shownUpgrade = id;
      showCard(state.ui.card, state.deckRemaining);
    }
    return;
  }
  if (state.status === "finished" && !shownWin) {
    shownWin = true;
    showWin(state, { ...me, id: session.playerId, hostId: state.hostId });
    return;
  }
  if (state.status === "playing") shownWin = false;
}

/** Bounce and bop highlights must leave through one side and keep going. */
function keepStraightFaces(state) {
  if (!state || (state.phase !== "bounce" && state.phase !== "bop")) return;
  const players = state.players || [];
  let origin = players.find((p) => p.id === state.turnPlayerId);
  if (state.phase === "bop" && state.ui?.otherId) {
    origin = players.find((p) => p.id === state.ui.otherId) || origin;
  }
  if (!origin) return;
  const range = state.ui?.range || 3;
  state.legalHexes = (state.legalHexes || []).filter((h) => onFaceLine(origin, h, range));
}

showScreen("lobby");
