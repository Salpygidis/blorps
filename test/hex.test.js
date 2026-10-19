import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  distance,
  neighbors,
  hexToWorld,
  hexRound,
  ring,
  hexLine,
  key,
} from "../shared/hex.js";
import { buildBoard, hexCount } from "../server/map.js";
import { mulberry32 } from "../shared/rng.js";

describe("hex math", () => {
  it("counts a radius-3 hex as 37 cells", () => {
    assert.equal(ring(3).length, 37);
  });

  it("builds an island of 39 hexes", () => {
    const board = buildBoard(3, mulberry32(42));
    assert.equal(hexCount(board.hexes), 39);
    assert.equal(board.starts.length, 3);
    assert.equal(board.captures.length, 3);
    assert.equal(board.fruits.length, 8);
  });

  it("neighbor distance is 1", () => {
    const h = { q: 0, r: 0 };
    for (const n of neighbors(h)) {
      assert.equal(distance(h, n), 1);
    }
  });

  it("round-trips world coordinates at the origin", () => {
    const { x, z } = hexToWorld(2, -1);
    const back = hexRound(
      ((Math.sqrt(3) / 3) * x - (1 / 3) * z) / 1.08,
      ((2 / 3) * z) / 1.08
    );
    assert.equal(back.q, 2);
    assert.equal(back.r, -1);
  });

  it("draws a straight hex line", () => {
    const line = hexLine({ q: 0, r: 0 }, { q: 2, r: 0 });
    assert.equal(line.length, 3);
    assert.equal(key(line[1].q, line[1].r), "1,0");
  });

  it("keeps a walkable neighbor at every start", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const board = buildBoard(4, mulberry32(seed));
      for (const s of board.starts) {
        const open = neighbors(s).some((n) => {
          const cell = board.hexes[key(n.q, n.r)];
          return cell && cell.terrain !== "tree";
        });
        assert.equal(open, true);
      }
    }
  });
});
