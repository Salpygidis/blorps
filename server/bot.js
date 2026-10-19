import { distance } from "../shared/hex.js";
import { hasUpgrade } from "../shared/upgrades.js";

export const BOT_NAMES = ["Beep", "Blip"];

export function chooseBotAction(game) {
  const p = game.current();
  if (!p || !p.isBot) return null;
  if (game.status !== "playing") return null;

  if (game.phase === "upgrade") return { type: "ack" };

  if (game.phase === "contact") {
    const other = game.playerById(game.phaseData.otherId);
    if (other && other.slime > 1) return { type: "contact", action: "bop" };
    return { type: "contact", action: "bounce" };
  }

  const legal = game.legalHexes();
  if (game.phase === "move" || game.phase === "bounce" || game.phase === "bop") {
    if (!legal.length) {
      if (game.phase === "move" && game.movedThisTurn) return { type: "endTurn" };
      return null;
    }
    const hex = pickBest(game, p, legal, game.phase);
    return { type: "hex", q: hex.q, r: hex.r };
  }

  return null;
}

export function applyBotAction(game) {
  const p = game.current();
  if (!p?.isBot) return { ok: false, error: "Not a bot's turn." };
  const action = chooseBotAction(game);
  if (!action) return { ok: false, error: "No bot action." };
  if (action.type === "hex") return game.clickHex(p.id, action.q, action.r);
  if (action.type === "contact") return game.chooseContact(p.id, action.action);
  if (action.type === "ack") return game.ackUpgrade(p.id);
  if (action.type === "endTurn") return game.skipTurn(p.id);
  return { ok: false, error: "Unknown bot action." };
}

function pickBest(game, p, legal, phase) {
  let best = legal[0];
  let bestScore = -Infinity;
  for (const h of legal) {
    const s = scoreHex(game, p, h, phase);
    if (s > bestScore) {
      bestScore = s;
      best = h;
    }
  }
  return best;
}

function scoreHex(game, p, h, phase) {
  let s = Math.random() * 0.5;
  const fruit = game.fruitAt(h.q, h.r);
  if (fruit) s += 24 + fruit.value * 12;
  const slime = game.slimeAt(h.q, h.r);
  if (slime) s += 18;
  const cap = game.captureAt(h.q, h.r);
  if (cap && !cap.claimedBy.includes(p.id)) s += 26;
  const other = game.occupant(h.q, h.r, p.id);
  if (other) s += other.slime > 1 ? 20 : 5;

  if (phase === "bounce") {
    const path = game.pathTo(
      p,
      h,
      game.bounceRange(p),
      hasUpgrade(p, "treehopper")
    );
    for (const step of path) {
      const f = game.fruitAt(step.q, step.r);
      if (f) s += 16 + f.value * 8;
      if (game.slimeAt(step.q, step.r)) s += 10;
    }
  }

  if (phase === "bop") {
    const victim = game.playerById(game.phaseData.otherId);
    if (victim) s += distance(victim, h) * 7;
  }

  s += 10 / (1 + nearestPrize(game, p, h));
  return s;
}

function nearestPrize(game, p, h) {
  let d = 12;
  for (const f of game.fruits) d = Math.min(d, distance(h, f));
  for (const c of game.captures) {
    if (!c.claimedBy.includes(p.id)) d = Math.min(d, distance(h, c));
  }
  for (const sl of game.slimes) d = Math.min(d, distance(h, sl));
  return d;
}
