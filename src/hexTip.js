/**
 * Plain lines for everything on one hex. Drawn from the rules state,
 * so a slime standing on a crystal pool is still listed.
 */
export function describeHex(state, q, r, localId) {
  const hex = (state?.hexes || []).find((h) => h.q === q && h.r === r);
  if (!hex) return [];
  const lines = [];
  const crystal = (state.captures || []).find((c) => c.q === q && c.r === r);
  if (crystal) {
    const mine = localId && (crystal.claimedBy || []).includes(localId);
    lines.push({
      emoji: "💎",
      text: mine
        ? "Crystal pool. Costs 1 move. You already drew a card from this one. The crystals stay on the tile."
        : "Crystal pool. Costs 1 move. Draw one power-up card. Each player can use it once. The crystals stay on the tile.",
    });
  } else if (hex.terrain === "water") {
    lines.push({
      emoji: "🌊",
      text: "Water. Stepping in costs 1 move. Under 6 points, leaving costs 2.",
    });
  } else if (hex.terrain === "tree") {
    lines.push({ emoji: "🌳", text: "Tree. Nobody can stop on this hex." });
  } else if ((hex.elevation || 0) > 0) {
    lines.push({
      emoji: "🟤",
      text: "Height. Under 6 points, stepping up costs 2 moves. Stepping down costs 1.",
    });
  } else {
    lines.push({ emoji: "🟩", text: "Open ground. Costs 1 move." });
  }

  for (const fruit of state.fruits || []) {
    if (fruit.q !== q || fruit.r !== r) continue;
    if (fruit.type === "grapes") {
      lines.push({ emoji: "🍇", text: "Grapes. Worth 1 point in your tray." });
    } else if (fruit.type === "banana") {
      lines.push({ emoji: "🍌", text: "Banana. Worth 1 point in your tray." });
    } else {
      lines.push({ emoji: "🍎", text: "Apple. Worth 1 point in your tray." });
    }
  }

  for (const token of state.slimes || []) {
    if (token.q !== q || token.r !== r) continue;
    const owner = (state.players || []).find((p) => p.id === token.ownerId);
    const whose = owner ? `${owner.name}'s slime drop` : "Slime drop";
    lines.push({
      emoji: "🫧",
      text: `${whose}. Pick it up for 1 point and a free bounce.`,
    });
  }

  for (const player of state.players || []) {
    if (player.isSpectator || player.q !== q || player.r !== r) continue;
    const cards = (player.upgrades || []).map((card) => card.name).filter(Boolean);
    const holding = cards.length ? ` Holding ${cards.join(", ")}.` : "";
    const points = Number.isFinite(player.score) ? player.score : player.slime;
    lines.push({
      emoji: "🟢",
      text: `${player.name} is standing here. ${points} points.${holding}`,
    });
  }

  return lines;
}
