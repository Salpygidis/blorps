import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

function firstGeometry(root) {
  let geo = null;
  root.traverse((obj) => {
    if (!geo && obj.isMesh && obj.geometry) geo = obj.geometry;
  });
  if (!geo) throw new Error("Board model has no mesh");
  geo.computeVertexNormals();
  return geo;
}

async function loadObj(url) {
  const text = await fetch(url).then((res) => {
    if (!res.ok) throw new Error(`Missing ${url}`);
    return res.text();
  });
  return firstGeometry(new OBJLoader().parse(text));
}

export async function loadBoardModels() {
  const [foundation, liquid, height, metrics] = await Promise.all([
    loadObj("/models/foundation.obj"),
    loadObj("/models/liquid.obj"),
    loadObj("/models/height.obj"),
    fetch("/models/metrics.json").then((res) => res.json()),
  ]);
  return {
    foundation,
    liquid,
    height,
    foundationMat: new THREE.MeshStandardMaterial({
      color: "#6fbf63",
      roughness: 0.82,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
    liquidMat: new THREE.MeshStandardMaterial({
      color: "#3ec8ea",
      roughness: 0.16,
      metalness: 0.06,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
    }),
    heightMat: new THREE.MeshStandardMaterial({
      color: "#a97449",
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
    foundationSize: {
      width: metrics.foundation.width,
      depth: metrics.foundation.depth,
      height: metrics.foundation.height,
    },
    liquidHeight: metrics.liquid.height,
    heightHeight: metrics.height.height,
    pieceMaxX: Math.max(metrics.liquid.maxX, metrics.height.maxX),
  };
}
