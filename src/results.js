const FRUIT = {
  apple: { label: "an apple", emoji: "🍎" },
  banana: { label: "a banana", emoji: "🍌" },
  grapes: { label: "grapes", emoji: "🍇" },
};

function playerName(players, id) {
  return players.find((p) => p.id === id)?.name || "Someone";
}

function points(n) {
  const v = Number(n) || 0;
  return `${v} point${v === 1 ? "" : "s"}`;
}

/** Why a free bounce was offered, as a mid-sentence phrase. */
export function freeBounceWhy(ev) {
  if (ev?.reason === "player") {
    return `bounced off ${ev.otherName || "another Blorp"}`;
  }
  if (ev?.reason === "tree") return "hopped onto a tree";
  if (ev?.reason === "water") return "hopped onto the water";
  return "picked up a slime";
}

/**
 * Plain-language result lines for one action.
 * Skips hops and log lines; those are motion and duplicates of the events below.
 */
export function describeResults(events = [], players = []) {
  const lines = [];
  for (const ev of events) {
    if (ev.type === "absorbFruit") {
      const fruit = FRUIT[ev.fruitType] || { label: ev.fruitType || "a fruit", emoji: "🍓" };
      const how = ev.pushed
        ? `was pushed onto ${fruit.label}`
        : ev.bouncedOver
          ? `bounced over ${fruit.label}`
          : `picked up ${fruit.label}`;
      lines.push({
        emoji: fruit.emoji,
        text: `${playerName(players, ev.playerId)} ${how} and gained ${points(ev.amount)}.`,
      });
    } else if (ev.type === "absorbSlime") {
      lines.push({
        emoji: "💧",
        text: ev.pushed
          ? `${playerName(players, ev.playerId)} was pushed onto a slime, picked it up, and gained ${points(ev.amount)}.`
          : `${playerName(players, ev.playerId)} landed on a slime, picked it up, and gained ${points(ev.amount)}.`,
      });
    } else if (ev.type === "freeBounce") {
      const range = ev.range ?? 2;
      lines.push({
        emoji: "🌀",
        text: `Free bounce! ${playerName(players, ev.playerId)} ${freeBounceWhy(ev)}, so they can hop up to ${range} hex${range === 1 ? "" : "es"} in a straight line.`,
      });
    } else if (ev.type === "handoff") {
      lines.push({
        emoji: "🫧",
        text: `${playerName(players, ev.playerId)} handed a slime to ${playerName(players, ev.otherId)}.`,
      });
    } else if (ev.type === "drop") {
      lines.push({
        emoji: "🫧",
        text: `${playerName(players, ev.token?.ownerId)} dropped a slime and lost 1 point.`,
      });
    } else if (ev.type === "capture") {
      const card = ev.card?.name || "a power-up";
      lines.push({
        emoji: ev.card?.emoji || "💎",
        text: ev.pushed
          ? `${playerName(players, ev.playerId)} was pushed onto a new crystal and drew ${card} from the power-up deck.`
          : `${playerName(players, ev.playerId)} hopped on a new crystal and drew ${card} from the power-up deck.`,
      });
    } else if (ev.type === "shuffle") {
      lines.push({
        emoji: "🃏",
        text: "The power-up deck is reshuffled.",
      });
    } else if (ev.type === "contact") {
      lines.push({
        emoji: "💥",
        text: `${playerName(players, ev.playerId)} landed on ${playerName(players, ev.otherId)}.`,
      });
    } else if (ev.type === "bop") {
      const actor = playerName(players, ev.actorId);
      const target = playerName(players, ev.targetId);
      if (ev.chain) {
        lines.push({ emoji: "👊", text: `${target} got bumped 1 hex.` });
        continue;
      }
      const steal = events.find(
        (e) => e.type === "bopSteal" && e.actorId === ev.actorId && e.targetId === ev.targetId
      );
      if (steal?.fruit) {
        const fruit = FRUIT[steal.fruit] || { label: steal.fruit, emoji: "🍓" };
        lines.push({
          emoji: fruit.emoji,
          text: `${actor} bopped ${target} and took ${fruit.label}.`,
        });
      } else if (steal && steal.stolen > 0) {
        lines.push({
          emoji: "👊",
          text: `${actor} bopped ${target} and stole ${points(steal.stolen)}.`,
        });
      } else if (steal?.armored) {
        lines.push({
          emoji: "🛡️",
          text: `${actor} bopped ${target}, but ${target}'s Bop Armor held. Nothing was stolen.`,
        });
      } else if (steal && steal.fruit === null) {
        lines.push({
          emoji: "👊",
          text: `${actor} bopped ${target}, who had no fruit to take.`,
        });
      } else {
        lines.push({ emoji: "👊", text: `${actor} bopped ${target}.` });
      }
    } else if (ev.type === "firstPlayer") {
      lines.push({
        emoji: "🎲",
        text: `${ev.name || playerName(players, ev.playerId)} goes first.`,
      });
    } else if (ev.type === "win") {
      lines.push({
        emoji: "🏆",
        text: `${ev.name || playerName(players, ev.playerId)} reached ${ev.points ?? 10} points${
          Number.isFinite(ev.cards) ? ` with ${ev.cards} power-ups` : ""
        } and wins!`,
      });
    }
  }
  return lines;
}
