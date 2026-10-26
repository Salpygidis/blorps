import * as THREE from "three";
import { HEX_SIZE } from "../shared/hex.js";
import { capScaleFor, foundationPose } from "../shared/boardFit.js";

let kit = null;

export function useBoardModels(models) {
  kit = models;
  if (!kit.pickerGeo) {
    const geo = new THREE.ExtrudeGeometry(hexShape(HEX_SIZE * 0.9), {
      depth: 0.04,
      bevelEnabled: false,
    });
    geo.rotateX(-Math.PI / 2);
    kit.pickerGeo = geo;
    kit.pickerMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
  }
}

export function layoutBoard(hexes) {
  if (!kit || !hexes?.length) return null;
  const layout = foundationPose();
  kit.layout = layout;
  kit.capScale = capScaleFor(kit.pieceMaxX);
  kit.groundTop = kit.foundationSize.height * layout.scale;
  // Piece meshes are built with their base at local y=0. y=0 is the bottom
  // of the foundation, so the water and hills rest on that base.
  kit.grooveY = 0;
  kit.waterTop = kit.liquidHeight * kit.capScale;
  kit.hillTop = kit.heightHeight * kit.capScale;
  return layout;
}

export function hexShape(size = HEX_SIZE * 0.92) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const x = size * Math.cos(angle);
    const y = size * Math.sin(angle);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

export function tileDepth(hex) {
  if (kit?.groundTop) {
    if (hex.terrain === "water" || hex.pool) return kit.waterTop;
    if ((hex.elevation || 0) > 0) return kit.hillTop;
    return kit.groundTop;
  }
  if (hex.terrain === "water" || hex.pool || hex.elevation < 0) return 0.16;
  return 0.26 + Math.max(0, hex.elevation) * 0.42;
}

export function tileColor(hex) {
  if (hex.terrain === "water" || hex.pool) return "#3db8d9";
  if (hex.terrain === "tree") return "#5aa34e";
  if (hex.elevation > 0) return "#a97449";
  return "#6fbf63";
}

export function makeTile(hex) {
  if (kit?.foundation) return makeModelTile(hex);
  return makePrismTile(hex);
}

function makeModelTile(hex) {
  const depth = tileDepth(hex);
  const group = new THREE.Group();
  group.userData = {
    kind: "hex",
    q: hex.q,
    r: hex.r,
    depth,
    terrain: hex.terrain || "open",
  };
  const picker = new THREE.Mesh(kit.pickerGeo, kit.pickerMat);
  picker.position.y = depth;
  group.add(picker);
  if (hex.terrain === "water" || hex.pool) {
    const water = new THREE.Mesh(kit.liquid, kit.liquidMat);
    water.scale.setScalar(kit.capScale);
    water.position.y = kit.grooveY;
    water.receiveShadow = true;
    water.renderOrder = 1;
    group.add(water);
    const topMat = hex.pool ? kit.crystalTopMat : kit.waterTopMat;
    const capMat = attachTop(water, kit.liquidTop, topMat, hex.pool);
    if (capMat) group.userData.crystalMat = capMat;
  } else if ((hex.elevation || 0) > 0) {
    const rise = new THREE.Mesh(kit.height, kit.heightMat);
    rise.scale.setScalar(kit.capScale);
    rise.position.y = kit.grooveY;
    rise.castShadow = true;
    rise.receiveShadow = true;
    rise.renderOrder = 1;
    group.add(rise);
    attachTop(rise, kit.heightTop, kit.rockTopMat, false);
  }
  if (hex.terrain === "tree") {
    const tree = makeTree();
    // Bite the trunk a hair into the rim so the base meets the plate.
    tree.position.y = depth - 0.015;
    group.add(tree);
  }
  return group;
}

function attachTop(body, geometry, material, ownMaterial) {
  if (!geometry || !material) return null;
  const mat = ownMaterial ? material.clone() : material;
  const cap = new THREE.Mesh(geometry, mat);
  cap.renderOrder = 2;
  cap.castShadow = false;
  cap.receiveShadow = false;
  cap.raycast = () => {};
  body.add(cap);
  return ownMaterial ? mat : null;
}

function makePrismTile(hex) {
  const depth = tileDepth(hex);
  const geo = new THREE.ExtrudeGeometry(hexShape(), {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.03,
    bevelSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: tileColor(hex),
    roughness: hex.terrain === "water" || hex.pool ? 0.2 : 0.7,
    metalness: hex.terrain === "water" || hex.pool ? 0.15 : 0.02,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.userData = { kind: "hex", q: hex.q, r: hex.r, depth, terrain: hex.terrain || "open" };
  if (hex.terrain === "tree") {
    const tree = makeTree();
    tree.position.y = depth;
    mesh.add(tree);
  }
  if (hex.terrain === "water" || hex.pool) {
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(HEX_SIZE * 0.72, 6),
      new THREE.MeshStandardMaterial({
        color: "#7fe7ff",
        transparent: true,
        opacity: 0.45,
        roughness: 0.15,
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.rotation.z = Math.PI / 6;
    water.position.y = depth + 0.02;
    water.userData.water = true;
    mesh.add(water);
  }
  return mesh;
}

function makeTree() {
  const g = new THREE.Group();
  const trunkH = 0.34;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.1, trunkH, 6),
    new THREE.MeshStandardMaterial({ color: "#8a5a32", flatShading: true })
  );
  // Cylinder is centered, so half the height puts the base on the parent's y.
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  const leaf = new THREE.Mesh(
    new THREE.ConeGeometry(0.38, 0.7, 7),
    new THREE.MeshStandardMaterial({ color: "#2f8f4a", flatShading: true })
  );
  leaf.position.y = 0.55;
  leaf.castShadow = true;
  const leaf2 = leaf.clone();
  leaf2.position.y = 0.82;
  leaf2.scale.setScalar(0.72);
  g.add(trunk, leaf, leaf2);
  return g;
}

export function makeBlorp(colorHex) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.32,
    metalness: 0.04,
    emissive: colorHex,
    emissiveIntensity: 0.1,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 28, 20), mat);
  body.scale.y = 0.82;
  body.castShadow = true;
  const eyeWhite = new THREE.MeshStandardMaterial({ color: "#fff" });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), eyeWhite);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.12, 0.14, 0.32);
  eyeR.position.set(0.12, 0.14, 0.32);
  const pupilMat = new THREE.MeshStandardMaterial({ color: "#1b2430" });
  const pL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), pupilMat);
  const pR = pL.clone();
  pL.position.set(0.015, -0.005, 0.06);
  pR.position.set(0.015, -0.005, 0.06);
  eyeL.add(pL);
  eyeR.add(pR);
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.1, 0.018, 6, 10, Math.PI),
    new THREE.MeshStandardMaterial({ color: "#c4456a" })
  );
  smile.position.set(0, 0.02, 0.36);
  smile.rotation.set(Math.PI, 0, 0);
  const hat = makeTopHat();
  g.add(body, eyeL, eyeR, smile, hat);
  g.userData = { body, eyeL, eyeR, colorHex, kind: "blorp", hat, hatTop: hat.userData.top };
  return g;
}

function makeTopHat() {
  const hat = new THREE.Group();
  const felt = new THREE.MeshStandardMaterial({
    color: "#141414",
    roughness: 0.68,
    metalness: 0.04,
  });
  const bandMat = new THREE.MeshStandardMaterial({
    color: "#0c0c0c",
    roughness: 0.4,
    metalness: 0.35,
  });
  const brimH = 0.03;
  const brimY = 0.3;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, brimH, 24), felt);
  brim.position.y = brimY;
  brim.castShadow = true;
  const crownH = 0.34;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, crownH, 20), felt);
  crown.position.y = brimY + brimH / 2 + crownH / 2;
  crown.castShadow = true;
  const bandH = 0.045;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.162, bandH, 20), bandMat);
  band.position.y = brimY + brimH / 2 + bandH / 2 + 0.006;
  band.castShadow = true;
  hat.add(brim, crown, band);
  hat.userData.top = crown.position.y + crownH / 2;
  return hat;
}

export function makeFruit(fruit) {
  const g = new THREE.Group();
  if (fruit.type === "apple") {
    const apple = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 14, 12),
      new THREE.MeshStandardMaterial({ color: "#ff3b3b", roughness: 0.4 })
    );
    apple.scale.y = 0.9;
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6),
      new THREE.MeshStandardMaterial({ color: "#6b3a1f" })
    );
    stem.position.y = 0.18;
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshStandardMaterial({ color: "#3cb86a" })
    );
    leaf.scale.set(1.4, 0.3, 0.8);
    leaf.position.set(0.07, 0.18, 0);
    g.add(apple, stem, leaf);
  } else if (fruit.type === "banana") {
    const banana = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.07, 0.28, 4, 8),
      new THREE.MeshStandardMaterial({ color: "#ffd93b" })
    );
    banana.rotation.z = 0.6;
    banana.rotation.x = 0.3;
    g.add(banana);
  } else {
    const mat = new THREE.MeshStandardMaterial({ color: "#9b59d0" });
    for (const [x, y, z] of [
      [0, 0.08, 0],
      [0.08, 0.02, 0.04],
      [-0.07, 0.02, 0.05],
      [0.02, 0.02, -0.08],
      [-0.04, 0.12, -0.04],
      [0.05, 0.12, 0.04],
    ]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat);
      b.position.set(x, y, z);
      g.add(b);
    }
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}

function loopDelta(d) {
  let x = d % 1;
  if (x > 0.5) x -= 1;
  if (x < -0.5) x += 1;
  return x;
}

/** Radius of the slime splash at angle t (0..1 around the outline). */
function splatRadius(t) {
  const wobble =
    0.04 * Math.sin(t * Math.PI * 2 * 2 + 0.4) +
    0.025 * Math.sin(t * Math.PI * 2 * 5 + 1.4);
  const lobe = (at, width, height) =>
    Math.exp(-(loopDelta(t - at) ** 2) / width) * height;
  return (
    0.36 +
    wobble +
    lobe(0.06, 0.0028, 0.2) +
    lobe(0.38, 0.0022, 0.15) +
    lobe(0.74, 0.0018, 0.18)
  );
}

/** Rounder mound in the middle of the splash. */
function blobRadius(t) {
  return (
    0.3 +
    0.045 * Math.sin(t * Math.PI * 2 * 2 + 0.2) +
    0.025 * Math.sin(t * Math.PI * 2 * 4 + 1.1)
  );
}

function outlineShape(scale, radiusFn) {
  const steps = 48;
  const shape = new THREE.Shape();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * Math.PI * 2;
    const r = radiusFn(t) * scale;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function puddleGeometry(scale, depth, bevel = false, radiusFn = splatRadius) {
  const bevelThickness = bevel ? Math.min(0.007, depth * 0.4) : 0;
  const geo = new THREE.ExtrudeGeometry(outlineShape(scale, radiusFn), {
    depth,
    bevelEnabled: bevel,
    bevelThickness,
    bevelSize: bevel ? 0.018 * scale : 0,
    bevelSegments: bevel ? 2 : 0,
    curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  if (bevelThickness) geo.translate(0, bevelThickness, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Point just outside the puddle rim. Shape Y becomes world -Z. */
function rimPoint(t, extra) {
  const a = t * Math.PI * 2;
  const r = splatRadius(t) + extra;
  return { x: Math.cos(a) * r, z: -Math.sin(a) * r };
}

/**
 * Flat slime left on a hex: a thin splash, a glossy center,
 * a wet highlight, and a few droplets off the edge.
 */
export function makeToken(color = "#e6b325") {
  const g = new THREE.Group();
  const goo = new THREE.Color(color);
  const edge = goo.clone().multiplyScalar(0.78);
  const shine = goo.clone().lerp(new THREE.Color("#fff8dc"), 0.62);
  const gooMat = new THREE.MeshPhysicalMaterial({
    color: goo,
    roughness: 0.16,
    metalness: 0.02,
    clearcoat: 0.9,
    clearcoatRoughness: 0.16,
    emissive: goo,
    emissiveIntensity: 0.16,
  });
  const edgeMat = new THREE.MeshStandardMaterial({
    color: edge,
    roughness: 0.38,
    metalness: 0.02,
    emissive: edge,
    emissiveIntensity: 0.06,
  });
  const shineMat = new THREE.MeshBasicMaterial({
    color: shine,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const spread = new THREE.Mesh(puddleGeometry(1.08, 0.012, false), edgeMat);
  spread.receiveShadow = true;
  const body = new THREE.Mesh(puddleGeometry(1, 0.028, true, blobRadius), gooMat);
  body.position.y = 0.01;
  body.castShadow = true;
  body.receiveShadow = true;

  const sheenGeo = new THREE.ShapeGeometry(outlineShape(0.62, blobRadius));
  sheenGeo.rotateX(-Math.PI / 2);
  const sheen = new THREE.Mesh(sheenGeo, shineMat);
  sheen.position.set(-0.06, 0.046, 0.04);
  sheen.raycast = () => {};

  const droplet = (t, extra, radius) => {
    const { x, z } = rimPoint(t, extra);
    const drop = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), gooMat);
    drop.scale.set(1.25, 0.22, 0.85);
    drop.position.set(x, radius * 0.22, z);
    drop.rotation.y = Math.atan2(-z, x);
    drop.castShadow = true;
    drop.receiveShadow = true;
    return drop;
  };

  g.add(
    spread,
    body,
    sheen,
    droplet(0.07, 0.1, 0.075),
    droplet(0.39, 0.09, 0.055),
    droplet(0.71, 0.08, 0.05),
    droplet(0.22, 0.07, 0.038)
  );
  return g;
}

export function makeHighlight(color = "#fff3a8") {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(HEX_SIZE * 0.55, HEX_SIZE * 0.78, 6),
    new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.rotation.z = Math.PI / 6;
  return ring;
}
