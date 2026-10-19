/** Pointy-top axial hex math. World XZ, Y-up. */

export const HEX_SIZE = 1.08;

export const DIRS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function key(q, r) {
  return `${q},${r}`;
}

export function parseKey(k) {
  const [q, r] = k.split(",").map(Number);
  return { q, r };
}

export function add(a, d) {
  return { q: a.q + d.q, r: a.r + d.r };
}

export function neighbors(h) {
  return DIRS.map((d) => add(h, d));
}

export function distance(a, b) {
  return (
    (Math.abs(a.q - b.q) +
      Math.abs(a.r - b.r) +
      Math.abs(a.q + a.r - b.q - b.r)) /
    2
  );
}

export function hexToWorld(q, r, size = HEX_SIZE) {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const z = size * (1.5 * r);
  return { x, z };
}

export function hexRound(q, r) {
  let s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);
  if (qDiff > rDiff && qDiff > sDiff) rq = -rr - rs;
  else if (rDiff > sDiff) rr = -rq - rs;
  return { q: rq, r: rr };
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function hexLine(a, b) {
  const n = distance(a, b);
  if (n === 0) return [{ q: a.q, r: a.r }];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(hexRound(lerp(a.q, b.q, t), lerp(a.r, b.r, t)));
  }
  return out;
}

export function ring(radius) {
  const hexes = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) hexes.push({ q, r });
  }
  return hexes;
}

export function sameHex(a, b) {
  return a.q === b.q && a.r === b.r;
}
