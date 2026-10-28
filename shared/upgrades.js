export const UPGRADES = {
  zoomies: {
    id: "zoomies",
    name: "Zoomies",
    emoji: "💨",
    desc: "Your first move can be a straight hop of 2 hexes.",
  },
  treehopper: {
    id: "treehopper",
    name: "Treehopper",
    emoji: "🌳",
    desc: "Once per turn, move onto a tree and treat it as a free bounce.",
  },
  slider: {
    id: "slider",
    name: "Slip-n-Slide",
    emoji: "🌊",
    desc: "Once per turn, move onto a water tile and treat it as a free bounce.",
  },
  superbounce: {
    id: "superbounce",
    name: "Super Bounce",
    emoji: "🏀",
    desc: "Bops and free bounces go 3 hexes instead of 2.",
  },
  applefan: {
    id: "applefan",
    name: "Apple Fan",
    emoji: "🍎",
    desc: "+1 per apple in your inventory.",
  },
  bananabunch: {
    id: "bananabunch",
    name: "Banana Bunch",
    emoji: "🍌",
    desc: "+1 per banana in your inventory.",
  },
  grapestomp: {
    id: "grapestomp",
    name: "Grape Stomp",
    emoji: "🍇",
    desc: "+1 per grape in your inventory.",
  },
  gooarmor: {
    id: "gooarmor",
    name: "Bop Armor",
    emoji: "🛡️",
    desc: "When you are bopped, they push you but cannot steal slime or fruit.",
  },
  longreach: {
    id: "longreach",
    name: "Long Reach",
    emoji: "🦵",
    desc: "While you have fewer than 6 points, base movement +1.",
  },
};

export function buildDeck() {
  const ids = [
    "zoomies",
    "zoomies",
    "treehopper",
    "slider",
    "slider",
    "superbounce",
    "superbounce",
    "applefan",
    "bananabunch",
    "grapestomp",
    "gooarmor",
    "longreach",
  ];
  return ids.map((id) => ({ ...UPGRADES[id] }));
}

export function hasUpgrade(player, id) {
  return (player.upgrades || []).some((u) => u.id === id);
}
