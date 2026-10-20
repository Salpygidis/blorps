import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { makeBlorp } from "../src/meshes.js";

describe("slime mesh", () => {
  it("has a black top hat and no white dot on the crown", () => {
    const g = makeBlorp("#5b9dff");
    const hat = g.userData.hat;
    assert.ok(hat);
    const hatBox = new THREE.Box3().setFromObject(hat);
    const midX = (hatBox.min.x + hatBox.max.x) / 2;
    const midZ = (hatBox.min.z + hatBox.max.z) / 2;
    assert.ok(Math.abs(midX) < 0.02);
    assert.ok(Math.abs(midZ) < 0.02);
    assert.ok(hatBox.max.y > 0.55);
    assert.ok(Math.abs(g.userData.hatTop - hatBox.max.y) < 1e-4);

    hat.traverse((obj) => {
      if (!obj.isMesh) return;
      const c = obj.material.color;
      assert.ok(c.r < 0.15 && c.g < 0.15 && c.b < 0.15);
    });

    g.traverse((obj) => {
      if (!obj.isMesh || !obj.material?.color) return;
      const c = obj.material.color;
      if (c.r < 0.95 || c.g < 0.95 || c.b < 0.95) return;
      assert.ok(obj.position.y < 0.22);
    });
  });
});
