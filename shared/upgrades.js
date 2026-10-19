export const UPGRADES = {
  zoomies: {
    id: "zoomies",
    name: "Zoomies",
    emoji: "💨",
    desc: "Your first move is 2 hexes instead of 1. Big Blorps stay speedy!",
  },
  treehopper: {
    id: "treehopper",
    name: "Treehopper",
    emoji: "🌳",
    desc: "Free bounces can hop over trees.",
  },
  slider: {
    id: "slider",
    name: "Slip-n-Slide",
    emoji: "🌊",
    desc: "Sliding into water grants extra movement.",
  },
  superbounce: {
    id: "superbounce",
    name: "Super Bounce",
    emoji: "🏀",
    desc: "Bops and free bounces go 3 hexes instead of 2.",
  },
  sweettooth: {
    id: "sweettooth",
    name: "Sweet Tooth",
    emoji: "😋",
    desc: "Fruit gives +1 extra goo.",
  },
  sponge: {
    id: "sponge",
    name: "Sponge",
    emoji: "🧽",
    desc: "Absorbing a slime token gives +1 extra goo.",
  },
  gooarmor: {
    id: "gooarmor",
    name: "Goo Armor",
    emoji: "🛡️",
    desc: "When someone bops you, they do not steal any goo.",
  },
  longreach: {
    id: "longreach",
    name: "Long Reach",
    emoji: "🦵",
    desc: "Base movement +1.",
  },
};

export function buildDeck() {
  const ids = [
    "zoomies",
    "zoomies",
    "treehopper",
    "treehopper",
    "slider",
    "slider",
    "superbounce",
    "superbounce",
    "sweettooth",
    "sponge",
    "gooarmor",
    "longreach",
  ];
  return ids.map((id) => ({ ...UPGRADES[id] }));
}

export function hasUpgrade(player, id) {
  return (player.upgrades || []).some((u) => u.id === id);
}
