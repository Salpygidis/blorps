import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeResults } from "../src/results.js";
import { hopLookPoint } from "../src/cameraFollow.js";

const players = [
  { id: "a", name: "Pip" },
  { id: "b", name: "Goo" },
];

describe("result notifications", () => {
  it("describes a grape pickup as points gained", () => {
    const lines = describeResults(
      [{ type: "absorbFruit", playerId: "a", fruitType: "grapes", amount: 2, bouncedOver: false }],
      players
    );
    assert.equal(lines[0].emoji, "🍇");
    assert.equal(lines[0].text, "Pip picked up grapes and gained 2 points.");
  });

  it("describes landing on a slime as a pickup", () => {
    const lines = describeResults(
      [{ type: "absorbSlime", playerId: "a", amount: 1 }],
      players
    );
    assert.equal(
      lines[0].text,
      "Pip landed on a slime, picked it up, and gained 1 point."
    );
  });

  it("announces a free bounce, including super bounce range", () => {
    const slime = describeResults(
      [{ type: "freeBounce", playerId: "a", range: 3, reason: "slime" }],
      players
    );
    assert.equal(slime[0].emoji, "🌀");
    assert.equal(
      slime[0].text,
      "Free bounce! Pip picked up a slime, so they can hop up to 3 hexes in a straight line."
    );
    const player = describeResults(
      [{ type: "freeBounce", playerId: "a", range: 2, reason: "player", otherName: "Goo" }],
      players
    );
    assert.equal(
      player[0].text,
      "Free bounce! Pip bounced off Goo, so they can hop up to 2 hexes in a straight line."
    );
  });

  it("describes a pickup from being pushed", () => {
    const lines = describeResults(
      [
        { type: "absorbFruit", playerId: "b", fruitType: "apple", amount: 1, pushed: true },
        { type: "absorbSlime", playerId: "b", amount: 2, pushed: true },
        { type: "capture", playerId: "b", pushed: true, card: { name: "Sponge", emoji: "🧽" } },
      ],
      players
    );
    assert.deepEqual(
      lines.map((l) => l.text),
      [
        "Goo was pushed onto an apple and gained 1 point.",
        "Goo was pushed onto a slime, picked it up, and gained 2 points.",
        "Goo was pushed onto a new crystal and drew Sponge from the power-up deck.",
      ]
    );
  });

  it("says who goes first", () => {
    const lines = describeResults([{ type: "firstPlayer", playerId: "a", name: "Pip" }], players);
    assert.equal(lines[0].text, "Pip goes first.");
  });

  it("describes a crystal draw from the power-up deck", () => {
    const lines = describeResults(
      [{ type: "capture", playerId: "a", card: { name: "Zoomies", emoji: "💨" } }],
      players
    );
    assert.equal(
      lines[0].text,
      "Pip hopped on a new crystal and drew Zoomies from the power-up deck."
    );
  });

  it("describes a bounce over fruit, a drop, a slide, a bop, and a win", () => {
    const lines = describeResults(
      [
        { type: "absorbFruit", playerId: "a", fruitType: "apple", amount: 1, bouncedOver: true },
        { type: "drop", token: { ownerId: "a" } },
        { type: "slide", playerId: "a" },
        { type: "bop", actorId: "a", targetId: "b" },
        { type: "bopSteal", actorId: "a", targetId: "b", stolen: 1 },
        { type: "win", name: "Pip" },
        { type: "hop", playerId: "a" },
        { type: "log", text: "ignored" },
      ],
      players
    );
    assert.deepEqual(
      lines.map((l) => l.text),
      [
        "Pip bounced over an apple and gained 1 point.",
        "Pip dropped a slime and lost 1 point.",
        "Pip slid out of the water.",
        "Pip bopped Goo and stole 1 point.",
        "Pip reached 10 points and wins!",
      ]
    );
  });

  it("describes a slime handoff and a fruit bop", () => {
    const lines = describeResults(
      [
        { type: "handoff", playerId: "a", otherId: "b" },
        { type: "bop", actorId: "a", targetId: "b" },
        { type: "bopSteal", actorId: "a", targetId: "b", stolen: 0, fruit: "grapes" },
      ],
      players
    );
    assert.deepEqual(
      lines.map((l) => l.text),
      ["Pip handed a slime to Goo.", "Pip bopped Goo and took grapes."]
    );

    const armor = describeResults(
      [
        { type: "bop", actorId: "a", targetId: "b" },
        { type: "bopSteal", actorId: "a", targetId: "b", stolen: 0, armored: true },
      ],
      players
    );
    assert.equal(armor[0].text, "Pip bopped Goo, but Goo's armor held. No points stolen.");

    const none = describeResults(
      [
        { type: "bop", actorId: "a", targetId: "b" },
        { type: "bopSteal", actorId: "a", targetId: "b", stolen: 0, fruit: null },
      ],
      players
    );
    assert.equal(none[0].text, "Pip bopped Goo, who had no fruit to take.");
  });
});

describe("camera follow", () => {
  it("glides the look point along a hop instead of jumping to the landing hex", () => {
    const from = { x: 0, z: 0 };
    const to = { x: 4, z: 2 };
    const samples = [];
    for (let i = 0; i <= 10; i++) samples.push(hopLookPoint(from, to, i / 10, 0.55));

    assert.equal(samples[0].x, 0);
    assert.equal(samples[0].z, 0);
    assert.equal(samples[0].y, 0);
    assert.equal(samples[10].x, 4);
    assert.equal(samples[10].z, 2);
    assert.ok(Math.abs(samples[10].y) < 1e-9);
    assert.ok(samples[5].y > 0.2);

    for (let i = 1; i < samples.length; i++) {
      const dx = samples[i].x - samples[i - 1].x;
      const dz = samples[i].z - samples[i - 1].z;
      assert.ok(dx > 0.3 && dx < 0.5, `x step ${dx}`);
      assert.ok(dz > 0.15 && dz < 0.25, `z step ${dz}`);
    }
  });
});
