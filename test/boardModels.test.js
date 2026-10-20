import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { HEX_SIZE, hexToWorld, ring } from "../shared/hex.js";
import { capScaleFor, foundationPose, PIECE_SPAN } from "../shared/boardFit.js";
import { layoutBoard, tileDepth, useBoardModels } from "../src/meshes.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const models = join(root, "public", "models");

function loadObj(name) {
  const verts = [];
  let up = 0;
  let down = 0;
  for (const line of readFileSync(join(models, name), "utf8").split(/\n/)) {
    if (line.startsWith("v ")) {
      const p = line.trim().split(/\s+/);
      verts.push([+p[1], +p[2], +p[3]]);
    } else if (line.startsWith("f ")) {
      const ids = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((token) => +token.split("/")[0] - 1);
      const [a, b, c] = ids.map((i) => verts[i]);
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      if (ny >= 0) up += ny;
      else down -= ny;
    }
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let far = { r: 0, deg: 0 };
  for (const [x, y, z] of verts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    const r = Math.hypot(x, z);
    if (r > far.r) far = { r, deg: (Math.atan2(z, x) * 180) / Math.PI };
  }
  return {
    verts: verts.length,
    up,
    down,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    far,
    absX: Math.max(Math.abs(minX), Math.abs(maxX)),
    absZ: Math.max(Math.abs(minZ), Math.abs(maxZ)),
  };
}

function pointyError(deg) {
  let best = 180;
  for (let k = 0; k < 6; k++) {
    let d = Math.abs(deg - (30 + 60 * k));
    d %= 360;
    best = Math.min(best, d, 360 - d);
  }
  return best;
}

function island() {
  const cells = ring(3);
  cells.push({ q: 4, r: -2 }, { q: -4, r: 2 });
  return cells;
}

describe("board models", () => {
  const metrics = JSON.parse(readFileSync(join(models, "metrics.json"), "utf8"));
  const liquid = loadObj("liquid.obj");
  const height = loadObj("height.obj");
  const foundation = loadObj("foundation.obj");

  it("sits the water and height tiles on y=0 with a pointy-top vertex", () => {
    for (const mesh of [liquid, height]) {
      assert.ok(Math.abs(mesh.minY) < 1e-4);
      assert.ok(mesh.maxY > 0.1);
      assert.ok(mesh.far.r > 0.98 && mesh.far.r < 1.02);
      assert.ok(mesh.absZ > mesh.absX);
      assert.ok(pointyError(mesh.far.deg) < 12, `vertex at ${mesh.far.deg}°`);
      assert.ok(mesh.up > 0 && mesh.down > 0);
    }
    assert.ok(Math.abs(liquid.maxY - metrics.liquid.height) < 1e-3);
    assert.ok(Math.abs(height.maxY - metrics.height.height) < 1e-3);
    assert.ok(Math.abs(liquid.absX - metrics.liquid.maxX) < 0.02);
    assert.ok(Math.abs(height.absX - metrics.height.maxX) < 0.02);
  });

  it("fills each hex a little past the shared edge", () => {
    const neighbor = HEX_SIZE * Math.sqrt(3);
    for (const mesh of [liquid, height]) {
      const scale = capScaleFor(mesh.absX);
      const width = 2 * mesh.absX * scale;
      assert.ok(Math.abs(width / neighbor - PIECE_SPAN) < 1e-6);
      assert.ok(mesh.far.r * scale < HEX_SIZE);
    }
  });

  it("turns the foundation's flat-top hexes onto the game grid", () => {
    assert.ok(Math.abs(foundation.minY) < 1e-3);
    assert.ok(Math.abs(foundation.maxX - foundation.minX - metrics.foundation.width) < 0.05);
    assert.ok(Math.abs(foundation.maxZ - foundation.minZ - metrics.foundation.depth) < 0.05);

    const pose = foundationPose();
    const plate = new THREE.Object3D();
    plate.rotation.y = pose.yaw;
    plate.scale.setScalar(pose.scale);
    plate.position.set(pose.x, 0, pose.z);
    plate.updateMatrixWorld();
    const worldOf = (x, z) => new THREE.Vector3(x, 0, z).applyMatrix4(plate.matrixWorld);

    // Interior centers measured on foundation.obj, and the axial cell they belong to.
    const centers = [
      [0.0, -77.84, 0, -2],
      [-33.77, -58.43, -1, -1],
      [-0.02, -39.01, 0, -1],
      [33.64, -19.47, 1, -1],
      [-67.56, -39.06, -2, 0],
      [-0.02, -0.14, 0, 0],
      [67.58, 39.05, 2, 0],
      [0.01, 39.04, 0, 1],
      [33.74, 58.52, 1, 1],
      [-0.04, 78.01, 0, 2],
    ];
    for (const [x, z, q, r] of centers) {
      const world = worldOf(x, z);
      const hex = hexToWorld(q, r);
      const miss = Math.hypot(world.x - hex.x, world.z - hex.z);
      assert.ok(miss < 0.03, `${q},${r} is ${miss.toFixed(3)} off its foundation hex`);
    }

    for (const cell of island()) {
      const hex = hexToWorld(cell.q, cell.r);
      const point = new THREE.Vector3(hex.x, 0, hex.z);
      plate.worldToLocal(point);
      assert.ok(point.x > foundation.minX && point.x < foundation.maxX);
      assert.ok(point.z > foundation.minZ && point.z < foundation.maxZ);
    }
  });

  it("stands pieces on the plate, the water, and the hill", () => {
    useBoardModels({
      foundation: {},
      foundationSize: {
        width: foundation.maxX - foundation.minX,
        depth: foundation.maxZ - foundation.minZ,
        height: foundation.maxY - foundation.minY,
      },
      liquidHeight: liquid.maxY - liquid.minY,
      heightHeight: height.maxY - height.minY,
      pieceMaxX: Math.max(liquid.absX, height.absX),
    });
    const cells = island();
    const layout = layoutBoard(cells);
    assert.ok(layout);
    const open = tileDepth({ terrain: "open", elevation: 0 });
    const tree = tileDepth({ terrain: "tree", elevation: 0 });
    const water = tileDepth({ terrain: "water", elevation: -1 });
    const hill = tileDepth({ terrain: "open", elevation: 1 });
    const scale = capScaleFor(Math.max(liquid.absX, height.absX));
    assert.equal(tree, open);
    assert.ok(Math.abs(open - (foundation.maxY - foundation.minY) * layout.scale) < 1e-6);
    assert.ok(Math.abs(water - liquid.maxY * scale) < 1e-6);
    assert.ok(Math.abs(hill - height.maxY * scale) < 1e-6);
    assert.ok(water > open);
    assert.ok(hill > water);
    assert.ok(hill < 2);
  });
});
