import * as THREE from "three";
import { hexToWorld, key, DIRS } from "../shared/hex.js";
import {
  makeTile,
  makeBlorp,
  makeFruit,
  makeToken,
  makeCapture,
  makeHighlight,
  tileDepth,
} from "./meshes.js";
import { tween, lerp, easeInOut } from "./tweens.js";
import { sfx } from "./audio.js";

const UP = new THREE.Vector3(0, 1, 0);

export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = null;
    this.localId = null;
    this.hexes = new Map();
    this.blorps = new Map();
    this.fruits = new Map();
    this.tokens = new Map();
    this.captures = new Map();
    this.highlights = [];
    this.animating = false;
    this.queue = Promise.resolve();
    this.target = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.spherical = { theta: 0.55, phi: 0.92, r: 16 };
    this.dragging = false;
    this.moved = false;
    this.last = { x: 0, y: 0 };
    this.pointers = new Map();
    this.pinch0 = 0;
    this.debug = new URLSearchParams(location.search).has("debug");

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x7eccef, 1);
    this.renderer.shadowMap.enabled = !this.isMobile();
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x7eccef, 22, 48);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.clock = new THREE.Clock();
    this.buildLights();
    this.buildGround();
    this.buildLobbyIsland();
    this.bindInput();
    this.resize();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    window.addEventListener("resize", () => this.resize());
  }

  isMobile() {
    return window.matchMedia("(max-width: 720px)").matches || "ontouchstart" in window;
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xd8f4ff, 0x7cb86a, 1.05));
    const sun = new THREE.DirectionalLight(0xfff4d2, 1.35);
    sun.position.set(10, 18, 8);
    sun.castShadow = this.renderer.shadowMap.enabled;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 40;
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    this.scene.add(sun);
    this.sun = sun;
  }

  buildGround() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(18, 48),
      new THREE.MeshStandardMaterial({ color: "#8fd39a", roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  buildLobbyIsland() {
    this.clearBoard();
    const demo = [
      { q: 0, r: 0, terrain: "open", elevation: 0 },
      { q: 1, r: 0, terrain: "open", elevation: 0 },
      { q: 0, r: 1, terrain: "water", elevation: -1 },
      { q: -1, r: 1, terrain: "open", elevation: 1 },
      { q: -1, r: 0, terrain: "tree", elevation: 0 },
      { q: 0, r: -1, terrain: "open", elevation: 0 },
      { q: 1, r: -1, terrain: "open", elevation: 0 },
    ];
    for (const h of demo) this.addHex(h);
    const a = makeBlorp("#7adf4a");
    const b = makeBlorp("#ff6b9d");
    this.placeOnHex(a, 0, 0, demo[0], 0.28);
    this.placeOnHex(b, 1, -1, demo[6], 0.28);
    a.userData.idle = true;
    b.userData.idle = true;
    a.userData.baseY = a.position.y;
    b.userData.baseY = b.position.y;
    this.scene.add(a, b);
    this.blorps.set("demoA", a);
    this.blorps.set("demoB", b);
    const apple = makeFruit({ type: "apple" });
    this.placeOnHex(apple, 1, 0, demo[1], 0.2);
    this.scene.add(apple);
    this.look.set(0, 0, 0);
    this.target.copy(this.look);
    this.spherical = { theta: 0.7, phi: 0.95, r: 11 };
    this.mode = "lobby";
  }

  clearBoard() {
    for (const map of [this.hexes, this.blorps, this.fruits, this.tokens, this.captures]) {
      for (const obj of map.values()) this.scene.remove(obj);
      map.clear();
    }
    for (const h of this.highlights) this.scene.remove(h);
    this.highlights = [];
  }

  addHex(hex) {
    const tile = makeTile(hex);
    const { x, z } = hexToWorld(hex.q, hex.r);
    tile.position.set(x, 0, z);
    this.scene.add(tile);
    this.hexes.set(key(hex.q, hex.r), { mesh: tile, hex });
    if (this.debug) {
      const div = makeLabel(`${hex.q},${hex.r}`);
      div.position.set(x, tileDepth(hex) + 0.02, z);
      this.scene.add(div);
    }
  }

  hexRecord(q, r) {
    return this.hexes.get(key(q, r));
  }

  topY(q, r) {
    const rec = this.hexRecord(q, r);
    return rec ? tileDepth(rec.hex) : 0.26;
  }

  placeOnHex(obj, q, r, hex, extra = 0) {
    const { x, z } = hexToWorld(q, r);
    const depth = hex ? tileDepth(hex) : this.topY(q, r);
    obj.position.set(x, depth + extra, z);
  }

  setLocal(id) {
    this.localId = id;
  }

  applyState(state, events = []) {
    if (!state || state.status === "lobby") return;
    if (this.mode !== "play" || !this.boardMatches(state)) {
      this.rebuild(state);
    }
    this.state = state;
    if (events?.length && this.mode === "play") {
      this.enqueue(() => this.playEvents(events, state));
    } else {
      this.syncEntities(state);
      this.syncHighlights(state);
      this.follow(state, true);
    }
  }

  boardMatches(state) {
    if (this.hexes.size !== (state.hexes?.length || 0)) return false;
    return true;
  }

  rebuild(state) {
    this.clearBoard();
    this.mode = "play";
    for (const h of state.hexes) this.addHex(h);
    this.syncEntities(state, true);
    this.spherical = { theta: 0.55, phi: 0.9, r: this.isMobile() ? 18 : 15 };
    this.follow(state, true);
  }

  syncEntities(state, snap = false) {
    this.syncMap(this.blorps, state.players.filter((p) => !p.isSpectator), (p) => {
      const m = makeBlorp(p.color.hex);
      this.scene.add(m);
      return m;
    }, (m, p) => {
      this.placeOnHex(m, p.q, p.r, this.hexRecord(p.q, p.r)?.hex, blorpLift(p.slime));
      const s = blorpScale(p.slime);
      m.scale.setScalar(s);
      m.userData.playerId = p.id;
      m.userData.idle = true;
      m.userData.baseY = m.position.y;
      offsetStack(m, p, state.players);
    });

    this.syncMap(this.fruits, state.fruits, (f) => {
      const m = makeFruit(f);
      this.scene.add(m);
      return m;
    }, (m, f) => {
      this.placeOnHex(m, f.q, f.r, this.hexRecord(f.q, f.r)?.hex, 0.22);
    });

    this.syncMap(this.tokens, state.slimes, (t) => {
      const m = makeToken(t.color);
      this.scene.add(m);
      return m;
    }, (m, t) => {
      this.placeOnHex(m, t.q, t.r, this.hexRecord(t.q, t.r)?.hex, 0.12);
    });

    this.syncMap(this.captures, state.captures, () => {
      const m = makeCapture();
      this.scene.add(m);
      return m;
    }, (m, c) => {
      this.placeOnHex(m, c.q, c.r, this.hexRecord(c.q, c.r)?.hex, 0.02);
    });
    void snap;
  }

  syncMap(map, list, create, update) {
    const seen = new Set();
    for (const item of list) {
      const id = item.id;
      seen.add(id);
      let m = map.get(id);
      if (!m) {
        m = create(item);
        map.set(id, m);
      }
      update(m, item);
    }
    for (const [id, m] of map) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        map.delete(id);
      }
    }
  }

  syncHighlights(state) {
    for (const h of this.highlights) this.scene.remove(h);
    this.highlights = [];
    for (const hex of state.legalHexes || []) {
      const ring = makeHighlight();
      const { x, z } = hexToWorld(hex.q, hex.r);
      ring.position.set(x, this.topY(hex.q, hex.r) + 0.04, z);
      this.scene.add(ring);
      this.highlights.push(ring);
    }
  }

  enqueue(fn) {
    this.queue = this.queue.then(fn).catch((e) => console.warn(e));
  }

  async playEvents(events, state) {
    this.animating = true;
    for (const ev of events) {
      if (ev.type === "hop") await this.animHop(ev);
      else if (ev.type === "absorbFruit" || ev.type === "absorbSlime") {
        sfx("slurp");
        await this.pulse(ev.playerId);
      } else if (ev.type === "bop") {
        sfx("bop");
        await this.animHop({
          playerId: ev.targetId,
          from: ev.from,
          to: ev.to,
          kind: "bop",
        });
      } else if (ev.type === "win") sfx("win");
      else if (ev.type === "capture") sfx("card");
      else if (ev.type === "drop") {
        /* tokens sync at end */
      }
    }
    this.syncEntities(state);
    this.syncHighlights(state);
    this.follow(state, false);
    this.animating = false;
  }

  async animHop(ev) {
    const mesh = this.blorps.get(ev.playerId);
    if (!mesh) return;
    sfx("hop");
    const from = hexToWorld(ev.from.q, ev.from.r);
    const to = hexToWorld(ev.to.q, ev.to.r);
    const y0 = this.topY(ev.from.q, ev.from.r) + 0.28;
    const y1 = this.topY(ev.to.q, ev.to.r) + 0.28;
    mesh.userData.idle = false;
    await tween({
      duration: ev.kind === "bop" ? 380 : 300,
      ease: easeInOut,
      onUpdate: (t) => {
        mesh.position.x = lerp(from.x, to.x, t);
        mesh.position.z = lerp(from.z, to.z, t);
        const arc = Math.sin(t * Math.PI) * (ev.kind === "bop" ? 1.1 : 0.55);
        mesh.position.y = lerp(y0, y1, t) + arc;
        mesh.scale.y = blorpScale(3) * (1 - Math.sin(t * Math.PI) * 0.12);
      },
    });
    mesh.userData.idle = true;
    mesh.userData.baseY = mesh.position.y;
    this.look.lerp(new THREE.Vector3(to.x, 0, to.z), 0.6);
  }

  async pulse(playerId) {
    const mesh = this.blorps.get(playerId);
    if (!mesh) return;
    const s0 = mesh.scale.x;
    await tween({
      duration: 220,
      onUpdate: (t) => {
        const k = 1 + Math.sin(t * Math.PI) * 0.22;
        mesh.scale.setScalar(s0 * k);
      },
    });
  }

  follow(state, instant) {
    const cur = state.players.find((p) => p.id === state.turnPlayerId);
    if (!cur) return;
    const { x, z } = hexToWorld(cur.q, cur.r);
    const dest = new THREE.Vector3(x, 0, z);
    if (instant) {
      this.look.copy(dest);
      this.target.copy(dest);
    } else this.target.copy(dest);
  }

  bindInput() {
    const el = this.canvas;
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragging = true;
      this.moved = false;
      this.last = { x: e.clientX, y: e.clientY };
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    el.addEventListener("pointermove", (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch0) {
          const ratio = this.pinch0 / d;
          this.spherical.r = clamp(this.spherical.r * ratio, 8, 30);
          this.pinch0 = d;
        }
        return;
      }
      if (!this.dragging) return;
      const dx = e.clientX - this.last.x;
      const dy = e.clientY - this.last.y;
      if (Math.hypot(dx, dy) > 6) this.moved = true;
      this.last = { x: e.clientX, y: e.clientY };
      this.spherical.theta -= dx * 0.005;
      this.spherical.phi = clamp(this.spherical.phi - dy * 0.004, 0.45, 1.25);
    });
    const up = (e) => {
      if (this.dragging && !this.moved && this.pointers.size <= 1) {
        this.pick(e.clientX, e.clientY);
      }
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) this.dragging = false;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.spherical.r = clamp(this.spherical.r + e.deltaY * 0.01, 8, 30);
      },
      { passive: false }
    );
  }

  pick(cx, cy) {
    if (this.animating || !this.onHex) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((cx - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((cy - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const tiles = [...this.hexes.values()].map((h) => h.mesh);
    const hits = this.raycaster.intersectObjects(tiles, false);
    if (!hits.length) return;
    const { q, r } = hits[0].object.userData;
    this.onHex(q, r);
  }

  dirFromPad(index) {
    const d = DIRS[index];
    if (!this.state) return;
    const me = this.state.players.find((p) => p.id === this.localId);
    const cur = this.state.players.find((p) => p.id === this.state.turnPlayerId);
    const who = this.state.phase === "bop"
      ? this.state.players.find((p) => p.name === this.state.ui?.otherName) || cur
      : cur || me;
    if (!who) return;
    const q = who.q + d.q;
    const r = who.r + d.r;
    this.onHex?.(q, r);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  updateCamera() {
    this.look.lerp(this.target, 0.08);
    if (this.mode === "lobby") this.spherical.theta += 0.0018;
    const { theta, phi, r } = this.spherical;
    const x = this.look.x + r * Math.sin(phi) * Math.sin(theta);
    const y = this.look.y + r * Math.cos(phi);
    const z = this.look.z + r * Math.sin(phi) * Math.cos(theta);
    this.camera.position.set(x, y, z);
    this.camera.up.copy(UP);
    this.camera.lookAt(this.look);
  }

  loop() {
    const t = this.clock.getElapsedTime();
    this.updateCamera();
    for (const mesh of this.blorps.values()) {
      if (mesh.userData.idle) {
        const squish = 1 + Math.sin(t * 3.2 + mesh.id) * 0.04;
        mesh.scale.y = mesh.scale.x * squish;
        const base = mesh.userData.baseY ?? mesh.position.y;
        mesh.userData.baseY = base;
        mesh.position.y = base + Math.sin(t * 3.2 + mesh.id) * 0.04;
      }
      const eyes = [mesh.userData.eyeL, mesh.userData.eyeR];
      for (const e of eyes) {
        if (!e) continue;
        e.lookAt(this.camera.position);
      }
    }
    for (const cap of this.captures.values()) {
      if (cap.userData.crystal) cap.userData.crystal.rotation.y = t * 0.9;
    }
    for (const [i, h] of this.highlights.entries()) {
      h.position.y += Math.sin(t * 4 + i) * 0.0008;
      h.material.opacity = 0.55 + Math.sin(t * 5 + i) * 0.25;
    }
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  }
}

function blorpScale(slime) {
  return 0.72 + Math.min(slime, 12) * 0.08;
}

function blorpLift(slime) {
  return 0.22 + Math.min(slime, 12) * 0.03;
}

function offsetStack(mesh, player, all) {
  const others = all.filter(
    (p) => !p.isSpectator && p.id !== player.id && p.q === player.q && p.r === player.r
  );
  if (!others.length) return;
  mesh.position.x += player.id < others[0].id ? -0.28 : 0.28;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function makeLabel(text) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.font = "28px sans-serif";
  g.fillText(text, 8, 40);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.2, 0.6, 1);
  return s;
}
