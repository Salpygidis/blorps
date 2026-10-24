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

let slimeTokenMap = null;

function slimeTokenTexture() {
  if (slimeTokenMap) return slimeTokenMap;
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  g.beginPath();
  g.arc(128, 128, 126, 0, Math.PI * 2);
  g.fillStyle = "#ffe7a0";
  g.fill();
  g.fillStyle = "#7adf4a";
  g.beginPath();
  g.ellipse(128, 146, 78, 64, 0, 0, Math.PI * 2);
  g.fill();
  const eye = (x, y) => {
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(x, y, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1b2430";
    g.beginPath();
    g.arc(x + 2, y + 3, 7, 0, Math.PI * 2);
    g.fill();
  };
  eye(104, 136);
  eye(152, 136);
  g.strokeStyle = "#c4456a";
  g.lineWidth = 5;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(106, 162);
  g.quadraticCurveTo(128, 186, 150, 162);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  slimeTokenMap = tex;
  return tex;
}

/** Flat board token. The disc uses the drop color; the face is a slime. */
export function makeToken(color = "#e6b325") {
  const radius = 0.5;
  const height = 0.05;
  const g = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 32),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.42,
      metalness: 0.22,
    })
  );
  disc.position.y = height / 2;
  disc.castShadow = true;
  disc.receiveShadow = true;
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.84, 32),
    new THREE.MeshBasicMaterial({
      map: typeof document === "undefined" ? null : slimeTokenTexture(),
      color: typeof document === "undefined" ? "#7adf4a" : "#ffffff",
    })
  );
  face.rotation.x = -Math.PI / 2;
  face.position.y = height + 0.004;
  g.add(disc, face);
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
