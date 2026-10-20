import { key, ring, distance } from "../shared/hex.js";
import { pickN, shuffle } from "../shared/rng.js";
import { FRUIT } from "../shared/constants.js";

const STARTS = {
  2: [
    { q: 3, r: -3 },
    { q: -3, r: 3 },
  ],
  3: [
    { q: 3, r: -3 },
    { q: -3, r: 0 },
    { q: -1, r: 3 },
  ],
  4: [
    { q: 3, r: -3 },
    { q: 3, r: 0 },
    { q: -3, r: 3 },
    { q: -3, r: 0 },
  ],
};

export function startSpots(playerCount) {
  return STARTS[playerCount] || STARTS[2];
}

/**
 * The foundation plate only covers about a third of these cells, so a slime
 * would stand on a hex the mesh cuts in half. They are not spaces.
 * Measured on public/models/foundation.obj after foundationPose().
 */
const CLIPPED_EDGES = [
  { q: 0, r: -3 },
  { q: 0, r: 3 },
  { q: 4, r: -2 },
  { q: -4, r: 2 },
];

export function buildBoard(playerCount, rand) {
  const clipped = new Set(CLIPPED_EDGES.map((h) => key(h.q, h.r)));
  const cells = ring(3).filter((h) => !clipped.has(key(h.q, h.r)));

  const map = {};
  for (const h of cells) {
    map[key(h.q, h.r)] = {
      q: h.q,
      r: h.r,
      terrain: "open",
      elevation: 0,
    };
  }

  const starts = startSpots(playerCount);
  const startKeys = new Set(starts.map((s) => key(s.q, s.r)));

  const allKeys = Object.keys(map);
  const pickFree = (n, pred) => {
    const pool = allKeys.filter((k) => pred(map[k], k));
    return pickN(pool, n, rand);
  };

  for (const k of pickFree(
    5,
    (c, k) => c.terrain === "open" && !startKeys.has(k)
  )) {
    map[k].terrain = "tree";
  }

  for (const k of pickFree(
    5,
    (c, k) => c.terrain === "open" && !startKeys.has(k)
  )) {
    map[k].terrain = "water";
    map[k].elevation = -1;
  }

  for (const k of pickFree(
    3,
    (c, k) => c.terrain === "open" && !startKeys.has(k)
  )) {
    map[k].elevation = 1;
  }

  restoreConnectivity(map, starts);
  for (const s of starts) {
    const cell = map[key(s.q, s.r)];
    if (cell) {
      cell.terrain = "open";
      cell.elevation = 0;
    }
    for (const n of [
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
    ]) {
      const nk = key(s.q + n[0], s.r + n[1]);
      if (map[nk] && map[nk].terrain === "tree") map[nk].terrain = "open";
    }
  }

  // Fruit and crystals only sit on open ground. A tree hex never holds one.
  const blocked = new Set();
  const fruitTypes = [
    "apple",
    "apple",
    "apple",
    "banana",
    "banana",
    "banana",
    "grapes",
    "grapes",
  ];
  const fruitKeys = takeClearings(map, startKeys, blocked, fruitTypes.length, rand);
  const fruits = fruitKeys.map((k, i) => {
    const type = fruitTypes[i];
    return {
      id: `f${i}`,
      q: map[k].q,
      r: map[k].r,
      type,
      value: FRUIT[type].value,
    };
  });

  const capKeys = takeClearings(
    map,
    startKeys,
    blocked,
    playerCount,
    rand,
    (c) => distance(c, { q: 0, r: 0 }) >= 1
  );
  const captures = capKeys.map((k, i) => ({
    id: `c${i}`,
    q: map[k].q,
    r: map[k].r,
    claimedBy: [],
  }));
  shiftOntoClearings([...fruits, ...captures], map, startKeys, blocked, rand);

  return {
    hexes: map,
    fruits,
    captures,
    starts,
  };
}

function takeClearings(map, startKeys, blocked, n, rand, extra) {
  const pool = Object.keys(map).filter((k) => {
    const cell = map[k];
    if (!cell || cell.terrain !== "open" || startKeys.has(k) || blocked.has(k)) return false;
    return extra ? extra(cell, k) : true;
  });
  const chosen = pickN(pool, n, rand);
  for (const k of chosen) blocked.add(k);
  return chosen;
}

function shiftOntoClearings(items, map, startKeys, blocked, rand) {
  for (const item of items) {
    const here = key(item.q, item.r);
    const cell = map[here];
    if (cell && cell.terrain === "open" && !startKeys.has(here)) continue;
    blocked.delete(here);
    const next = takeClearings(map, startKeys, blocked, 1, rand)[0];
    if (!next) continue;
    item.q = map[next].q;
    item.r = map[next].r;
  }
}

function restoreConnectivity(map, starts) {
  const walkable = (h) => h && h.terrain !== "tree";
  const reach = from(map, starts[0], walkable);
  const blocked = Object.values(map).filter(
    (h) => h.terrain !== "tree" && !reach.has(key(h.q, h.r))
  );
  for (const h of blocked) {
    const nk = neighborsOnMap(map, h).find((n) => map[n]?.terrain === "tree");
    if (nk) map[nk].terrain = "open";
  }
  for (const s of starts) {
    const cell = map[key(s.q, s.r)];
    if (cell) {
      cell.terrain = "open";
      cell.elevation = 0;
    }
  }
}

function neighborsOnMap(map, h) {
  const dirs = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  return dirs
    .map(([dq, dr]) => key(h.q + dq, h.r + dr))
    .filter((k) => map[k]);
}

function from(map, start, walkable) {
  const seen = new Set();
  const q = [key(start.q, start.r)];
  seen.add(q[0]);
  while (q.length) {
    const k = q.shift();
    const h = map[k];
    if (!h || !walkable(h)) continue;
    for (const n of neighborsOnMap(map, h)) {
      if (seen.has(n)) continue;
      if (!walkable(map[n])) continue;
      seen.add(n);
      q.push(n);
    }
  }
  return seen;
}

export function hexCount(hexes) {
  return Object.keys(hexes).length;
}
