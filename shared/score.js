import { FRUIT } from "./constants.js";

/** Cards that score +1 for each matching fruit currently in the tray. */
export const FRUIT_BONUS = {
  applefan: "apple",
  bananabunch: "banana",
  grapestomp: "grapes",
};

const FRUIT_FACE = {
  apple: { emoji: "🍎", word: "apple" },
  banana: { emoji: "🍌", word: "banana" },
  grapes: { emoji: "🍇", word: "grape" },
};

export function fruitCounts(player) {
  const counts = { apple: 0, banana: 0, grapes: 0 };
  for (const item of player?.basket || []) {
    if (counts[item.type] != null) counts[item.type] += 1;
  }
  return counts;
}

/** Points this one fruit adds as it enters the tray. */
export function fruitPickupPoints(player, type) {
  const each = FRUIT[type]?.value || 1;
  const copies = (player?.upgrades || []).filter((card) => FRUIT_BONUS[card.id] === type).length;
  return each + copies;
}

/**
 * Everything in front of a player, with the points each row is worth.
 * Slime is 1 each. Fruit keeps its own value. The total is the only score.
 * Every power-up is 1. Fruit cards add +1 per matching fruit in the tray.
 */
export function tally(player) {
  const counts = fruitCounts(player);
  const lines = [];
  const slime = player?.slime || 0;
  lines.push({
    kind: "slime",
    id: "slime",
    emoji: "💧",
    label: "Slime",
    count: slime,
    points: slime,
  });
  for (const type of ["apple", "banana", "grapes"]) {
    const count = counts[type];
    if (!count) continue;
    const each = FRUIT[type].value;
    lines.push({
      kind: "fruit",
      id: type,
      emoji: FRUIT_FACE[type].emoji,
      label: FRUIT[type].name,
      count,
      each,
      points: count * each,
    });
  }
  const groups = new Map();
  for (const card of player?.upgrades || []) {
    const group = groups.get(card.id) || { ...card, count: 0 };
    group.count += 1;
    groups.set(card.id, group);
  }
  for (const card of groups.values()) {
    lines.push({
      kind: "card",
      id: card.id,
      emoji: card.emoji || "🃏",
      label: card.name || "Power-up",
      count: card.count,
      points: card.count,
      desc: card.desc || "",
    });
    const fruitType = FRUIT_BONUS[card.id];
    if (!fruitType) continue;
    const n = counts[fruitType] || 0;
    lines.push({
      kind: "bonus",
      id: `${card.id}:bonus`,
      emoji: FRUIT_FACE[fruitType].emoji,
      label: `+1 per ${FRUIT_FACE[fruitType].word}`,
      count: n,
      each: card.count,
      points: n * card.count,
    });
  }
  const points = lines.reduce((sum, line) => sum + line.points, 0);
  return { lines, points, counts };
}
