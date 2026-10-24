import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeHex } from "../src/hexTip.js";

describe("hex hover tip", () => {
  it("lists a slime, a crystal, and fruit on the same hex", () => {
    const lines = describeHex(
      {
        hexes: [{ q: 1, r: 0, terrain: "open", elevation: 0 }],
        fruits: [{ q: 1, r: 0, type: "apple" }],
        slimes: [{ q: 1, r: 0, ownerId: "b" }],
        captures: [{ q: 1, r: 0, claimedBy: ["a"] }],
        players: [
          {
            id: "a",
            name: "Pip",
            q: 1,
            r: 0,
            slime: 3,
            score: 4,
            upgrades: [{ name: "Zoomies" }],
          },
          { id: "b", name: "Goo", q: 4, r: 0, slime: 3, score: 3 },
        ],
      },
      1,
      0,
      "a"
    );
    const text = lines.map((line) => line.text).join(" ");
    assert.match(text, /Crystal pool/);
    assert.match(text, /The crystals stay on the tile/);
    assert.match(text, /Apple\. Worth 1 point/);
    assert.match(text, /Goo's slime drop/);
    assert.match(text, /free bounce/);
    assert.match(text, /You already drew a card/);
    assert.match(text, /Pip is standing here/);
    assert.match(text, /Zoomies/);
    assert.match(text, /4 points/);
    assert.doesNotMatch(text, /Size /);
  });

  it("describes water, height, and an unused crystal", () => {
    const water = describeHex(
      { hexes: [{ q: 0, r: 1, terrain: "water", elevation: -1 }], players: [] },
      0,
      1,
      "a"
    );
    assert.match(water[0].text, /Under 6 points, leaving costs 2/);
    const hill = describeHex(
      { hexes: [{ q: 2, r: 0, terrain: "open", elevation: 1 }] },
      2,
      0,
      "a"
    );
    assert.match(hill[0].text, /stepping up costs 2 moves/);
    const crystal = describeHex(
      {
        hexes: [{ q: 3, r: 0, terrain: "open", elevation: 0 }],
        captures: [{ q: 3, r: 0, claimedBy: [] }],
      },
      3,
      0,
      "a"
    );
    assert.match(crystal.map((line) => line.text).join(" "), /Draw one power-up card/);
  });
});
