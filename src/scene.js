import * as THREE from "three";
import { hexToWorld, hexLine, key, DIRS, sameHexLayout } from "../shared/hex.js";
import {
  makeTile,
  makeBlorp,
  makeFruit,
  makeToken,
  makeHighlight,
  tileDepth,
  useBoardModels,
  layoutBoard,
} from "./meshes.js";
import { loadBoardModels, withoutTileFloors } from "./boardModels.js";
import { tween, lerp, easeInOut } from "./tweens.js";
import { hopLookPoint } from "./cameraFollow.js";
import { describeResults } from "./results.js";
import { announceFreeBounce, hideHexTip, showHexTip, showResults } from "./ui.js";
import { describeHex } from "./hexTip.js";
import { sfx } from "./audio.js";
import { SLIME_DROP_COLOR } from "../shared/constants.js";

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
    this.hopTracking = false;
    this.epoch = 0;
    this.models = null;
    this.modelsReady = false;
    this.pendingApply = null;
    this.queue = Promise.resolve();
    this.target = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.spherical = { theta: 0.55, phi: 0.92, r: 16 };
    this.pointers = new Map();
    this.pinch0 = 0;
    this.hoverKey = "";
    this.hoverAt = { x: 0, y: 0 };
    this.hoverTimer = 0;
    this.pressTimer = 0;
    this.tipOn = false;
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
    this.mode = "lobby";
    this.bindInput();
    this.resize();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    window.addEventListener("resize", () => this.resize());
    this.loadBoard();
  }

  loadBoard() {
    loadBoardModels()
      .then((models) => {
        useBoardModels(models);
        this.models = models;
      })
      .catch((err) => {
        console.warn("Board models unavailable, using simple tiles.", err);
        this.models = null;
      })
      .finally(() => {
        this.modelsReady = true;
        const pending = this.pendingApply;
        this.pendingApply = null;
        if (pending) this.applyState(pending.state, pending.events);
        else this.buildLobbyIsland();
      });
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
    this.ground = ground;
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
    if (this.models) layoutBoard(demo);
    this.addFoundations(undefined, demo);
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
    this.placeOnHex(apple, 1, 0, demo[1], 0.02);
    this.scene.add(apple);
    this.look.set(0, 0, 0);
    this.target.copy(this.look);
    this.spherical = { theta: 0.7, phi: 0.95, r: 11 };
    this.mode = "lobby";
  }

  clearBoard() {
    const keep = new Set([this.ground, this.sun, this.moveBadge].filter(Boolean));
    for (const child of [...this.scene.children]) {
      if (keep.has(child) || child.isLight) continue;
      child.traverse((obj) => {
        if (obj.userData?.ownedGeo) obj.userData.ownedGeo.dispose();
      });
      this.scene.remove(child);
    }
    this.hexes.clear();
    this.blorps.clear();
    this.fruits.clear();
    this.tokens.clear();
    this.captures.clear();
    this.highlights = [];
  }

  addFoundations(origins, hexes) {
    const layout = this.models?.layout;
    if (!layout) return;
    const plates = origins?.length ? origins : [{ q: 0, r: 0 }];
    const tiled = new Set();
    for (const h of hexes || []) {
      if (h.terrain === "water" || h.pool || (h.elevation || 0) > 0) tiled.add(key(h.q, h.r));
    }
    for (const origin of plates) {
      const { x, z } = hexToWorld(origin.q || 0, origin.r || 0);
      // Pose measured in boardFit: +30° yaw turns the plate's flat-top hexes
      // into the game's pointy-top grid. Each extra plate sits on its own center.
      const plateGeo = withoutTileFloors(this.models.foundation, origin, tiled);
      const base = new THREE.Mesh(plateGeo, this.models.foundationMat);
      if (plateGeo !== this.models.foundation) base.userData.ownedGeo = plateGeo;
      base.rotation.y = layout.yaw;
      base.scale.setScalar(layout.scale);
      base.position.set(layout.x + x, 0, layout.z + z);
      base.receiveShadow = true;
      base.castShadow = false;
      base.renderOrder = 1;
      base.userData.kind = "foundation";
      if (this.models.foundationTop && this.models.grassTopMat) {
        const grassGeo = withoutTileFloors(this.models.foundationTop, origin, tiled);
        const grass = new THREE.Mesh(grassGeo, this.models.grassTopMat);
        if (grassGeo !== this.models.foundationTop) grass.userData.ownedGeo = grassGeo;
        grass.renderOrder = 2;
        grass.castShadow = false;
        grass.receiveShadow = false;
        grass.raycast = () => {};
        base.add(grass);
      }
      this.scene.add(base);
    }
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

  fitBoard(hexes) {
    let max = 0;
    for (const h of hexes || []) {
      const { x, z } = hexToWorld(h.q, h.r);
      max = Math.max(max, Math.hypot(x, z));
    }
    const span = max + 10;
    if (this.ground) this.ground.scale.setScalar(Math.max(1, span / 18));
    const wide = (hexes || []).length > 40;
    this.scene.fog.near = wide ? 30 : 22;
    this.scene.fog.far = wide ? Math.max(110, span * 5) : 48;
    if (this.sun?.shadow?.camera) {
      const half = Math.max(14, span);
      const cam = this.sun.shadow.camera;
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.far = Math.max(40, half * 3);
      cam.updateProjectionMatrix();
    }
    return clamp(span * 1.05, this.isMobile() ? 18 : 15, 48);
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

  placeCollectible(obj, q, r, extra) {
    const hex = this.hexRecord(q, r)?.hex;
    obj.userData.kind = "collectible";
    obj.userData.q = q;
    obj.userData.r = r;
    const onTree = hex?.terrain === "tree";
    obj.visible = !onTree;
    if (onTree) return;
    this.placeOnHex(obj, q, r, hex, extra);
  }

  setLocal(id) {
    this.localId = id;
  }

  applyState(state, events = []) {
    if (!state || state.status === "lobby") return;
    if (!this.modelsReady) {
      this.pendingApply = { state, events };
      return;
    }
    const previous = this.state;
    if (previous && (state.roomCode !== previous.roomCode || state.version < previous.version)) {
      this.epoch++;
      this.queue = Promise.resolve();
      this.animating = false;
      this.hopTracking = false;
    }
    if (this.mode !== "play" || !this.boardMatches(state)) {
      this.rebuild(state);
    }
    this.state = state;
    this.syncCollectibles(state);
    this.syncHighlights(state);
    if (this.tipOn && this.hoverKey) {
      const [q, r] = this.hoverKey.split(",").map(Number);
      this.showHexTip(q, r, this.hoverAt.x, this.hoverAt.y);
    }
    if (events?.length && this.mode === "play") {
      this.enqueue(() => this.playEvents(events, state));
    } else {
      this.syncEntities(state);
      this.follow(state, true);
      this.onTurnReady?.(state);
    }
  }

  boardMatches(state) {
    const current = [...this.hexes.values()].map((rec) => rec.hex);
    return sameHexLayout(current, state.hexes || []);
  }

  rebuild(state) {
    if (!this.modelsReady) {
      this.pendingApply = { state, events: [] };
      return;
    }
    if (this.models) layoutBoard(state.hexes);
    this.epoch++;
    this.clearBoard();
    this.mode = "play";
    const fit = this.fitBoard(state.hexes);
    const pools = new Set((state.captures || []).map((c) => key(c.q, c.r)));
    for (const h of state.hexes) {
      if (
        pools.has(key(h.q, h.r)) &&
        h.terrain !== "tree" &&
        h.terrain !== "water" &&
        !(h.elevation > 0)
      ) {
        h.pool = true;
      }
    }
    this.addFoundations(state.foundations, state.hexes);
    for (const h of state.hexes) this.addHex(h);
    this.syncEntities(state, true);
    this.spherical = { theta: 0.55, phi: 0.9, r: fit };
    this.follow(state, true);
  }

  syncCollectibles(state) {
    if (!state) return;
    this.syncMap(this.fruits, state.fruits || [], (f) => {
      const m = makeFruit(f);
      this.scene.add(m);
      return m;
    }, (m, f) => {
      this.placeCollectible(m, f.q, f.r, 0.02);
    });

    this.syncMap(this.tokens, state.slimes || [], (t) => {
      const m = makeToken(t.color || SLIME_DROP_COLOR);
      this.scene.add(m);
      return m;
    }, (m, t) => {
      this.placeCollectible(m, t.q, t.r, 0.02);
    });

    this.syncCrystalPools(state);
  }

  syncCrystalPools(state) {
    const spent = new Set();
    for (const cap of state.captures || []) {
      if ((cap.claimedBy || []).includes(this.localId)) spent.add(key(cap.q, cap.r));
    }
    for (const [id, rec] of this.hexes) {
      if (!rec.mesh.userData.crystalMat) continue;
      rec.mesh.userData.crystalSpent = spent.has(id);
    }
  }

  syncEntities(state, snap = false) {
    this.syncMap(this.blorps, (state.players || []).filter((p) => !p.isSpectator), (p) => {
      const m = makeBlorp(p.color.hex);
      this.scene.add(m);
      return m;
    }, (m, p) => {
      const points = bodyPoints(p);
      this.placeOnHex(m, p.q, p.r, this.hexRecord(p.q, p.r)?.hex, blorpLift(points));
      const s = blorpScale(points);
      m.scale.setScalar(s);
      m.userData.playerId = p.id;
      m.userData.q = p.q;
      m.userData.r = p.r;
      m.userData.kind = "blorp";
      m.userData.idle = true;
      m.userData.baseY = m.position.y;
      offsetStack(m, p, state.players);
    });
    this.syncCollectibles(state);
    void snap;
  }

  syncMap(map, list, create, update) {
    const seen = new Set();
    for (const item of list || []) {
      const id = item.id ?? `${item.q},${item.r}`;
      seen.add(id);
      let m = map.get(id);
      if (!m) {
        m = create(item);
        map.set(id, m);
      }
      update(m, item);
    }
    for (const [id, m] of [...map]) {
      if (!seen.has(id)) {
        m.parent?.remove(m);
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
    const epoch = this.epoch;
    this.animating = true;
    try {
      const lines = describeResults(events, state.players || []);
      if (lines.length) showResults(lines);
      for (const ev of events) {
        if (this.epoch !== epoch) return;
        if (ev.type === "hop") await this.animHop(ev);
        else if (ev.type === "absorbFruit" || ev.type === "absorbSlime") {
          this.syncCollectibles(this.state?.version >= state.version ? this.state : state);
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
        else if (ev.type === "freeBounce") {
          const who = (state.players || []).find((p) => p.id === ev.playerId);
          announceFreeBounce(who?.name || "Someone", ev);
        } else if (ev.type === "drop") {
          this.syncCollectibles(this.state?.version >= state.version ? this.state : state);
        }
      }
    } finally {
      if (this.epoch !== epoch) return;
      const newer = this.state && (this.state.version ?? 0) > (state.version ?? 0);
      const latest = newer ? this.state : state;
      if (!newer) {
        this.syncEntities(latest);
        this.follow(latest, false);
      } else {
        this.syncCollectibles(latest);
      }
      this.syncHighlights(latest);
      this.animating = false;
      this.onTurnReady?.(latest);
    }
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
    const crossesTree =
      ev.from &&
      ev.to &&
      hexLine(ev.from, ev.to)
        .slice(1, -1)
        .some((h) => this.hexRecord(h.q, h.r)?.hex?.terrain === "tree");
    const arcHeight = ev.kind === "bop" ? 1.1 : crossesTree ? 1.8 : 0.55;
    this.hopTracking = true;
    try {
      await tween({
        duration: ev.kind === "bop" ? 380 : 300,
        ease: easeInOut,
        onUpdate: (t) => {
          mesh.position.x = lerp(from.x, to.x, t);
          mesh.position.z = lerp(from.z, to.z, t);
          const arc = Math.sin(t * Math.PI) * arcHeight;
          mesh.position.y = lerp(y0, y1, t) + arc;
          mesh.scale.y = blorpScale(3) * (1 - Math.sin(t * Math.PI) * 0.12);
          const look = hopLookPoint(from, to, t, arcHeight);
          this.look.set(look.x, look.y, look.z);
          this.target.copy(this.look);
        },
      });
    } finally {
      this.hopTracking = false;
      this.look.set(to.x, 0, to.z);
      this.target.copy(this.look);
    }
    mesh.userData.idle = true;
    mesh.userData.baseY = mesh.position.y;
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
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      const mouse = e.pointerType === "mouse";
      if (mouse && e.button !== 0 && e.button !== 2) return;
      // Mouse spins with the right button. Touch and pen still drag to spin.
      const orbit = !mouse || e.button === 2;
      const pick = !mouse || e.button === 0;
      el.setPointerCapture(e.pointerId);
      const rec = { x: e.clientX, y: e.clientY, orbit, pick, moved: false };
      this.pointers.set(e.pointerId, rec);
      if (pick) {
        clearTimeout(this.pressTimer);
        this.pressTimer = setTimeout(() => {
          const held = this.pointers.get(e.pointerId);
          if (!held || held.moved) return;
          const hex = this.hexAtPointer(held.x, held.y);
          if (!hex) return;
          held.moved = true;
          this.showHexTip(hex.q, hex.r, held.x, held.y);
        }, 1000);
      }
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    el.addEventListener("pointermove", (e) => {
      if (e.buttons === 0) this.trackHover(e.clientX, e.clientY);
      else clearTimeout(this.hoverTimer);
      const rec = this.pointers.get(e.pointerId);
      if (!rec) return;
      const dx = e.clientX - rec.x;
      const dy = e.clientY - rec.y;
      rec.x = e.clientX;
      rec.y = e.clientY;
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
      if (Math.hypot(dx, dy) > 6) rec.moved = true;
      if (!rec.orbit) return;
      this.spherical.theta -= dx * 0.005;
      this.spherical.phi = clamp(this.spherical.phi - dy * 0.004, 0.45, 1.25);
    });
    const up = (e) => {
      clearTimeout(this.pressTimer);
      const rec = this.pointers.get(e.pointerId);
      if (rec?.pick && !rec.moved && this.pointers.size <= 1) {
        this.pick(e.clientX, e.clientY);
      }
      this.pointers.delete(e.pointerId);
    };
    el.addEventListener("pointerleave", () => this.cancelHover(true));
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

  trackHover(cx, cy) {
    if (!this.state || this.state.status !== "playing") {
      this.cancelHover(true);
      return;
    }
    const hex = this.hexAtPointer(cx, cy);
    const k = hex ? key(hex.q, hex.r) : "";
    this.hoverAt = { x: cx, y: cy };
    if (k === this.hoverKey) return;
    this.hoverKey = k;
    clearTimeout(this.hoverTimer);
    this.dismissTip();
    if (!hex) return;
    this.hoverTimer = setTimeout(() => {
      this.showHexTip(hex.q, hex.r, cx, cy);
    }, 1000);
  }

  cancelHover(hide) {
    clearTimeout(this.hoverTimer);
    clearTimeout(this.pressTimer);
    this.hoverKey = "";
    if (hide) this.dismissTip();
  }

  dismissTip() {
    this.tipOn = false;
    hideHexTip();
  }

  showHexTip(q, r, x, y) {
    if (!this.state) return;
    this.hoverKey = key(q, r);
    this.hoverAt = { x, y };
    this.tipOn = true;
    showHexTip(describeHex(this.state, q, r, this.localId), x, y);
  }

  hexAtPointer(cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.x = ((cx - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((cy - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const stuff = [
      ...[...this.hexes.values()].map((h) => h.mesh),
      ...this.fruits.values(),
      ...this.tokens.values(),
      ...this.captures.values(),
      ...this.blorps.values(),
    ];
    const hits = this.raycaster.intersectObjects(stuff, true);
    if (!hits.length) return null;
    const blorp = blorpOf(hits[0].object);
    if (blorp && Number.isFinite(blorp.userData.q)) {
      return { q: blorp.userData.q, r: blorp.userData.r };
    }
    const collectible = collectibleOf(hits[0].object);
    if (collectible) return { q: collectible.userData.q, r: collectible.userData.r };
    const tile = hexTileOf(hits[0].object);
    if (!tile) return null;
    return { q: tile.userData.q, r: tile.userData.r };
  }

  pick(cx, cy) {
    if (!this.onHex) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((cx - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((cy - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const tiles = [...this.hexes.values()].map((h) => h.mesh);
    const stuff = [
      ...tiles,
      ...this.fruits.values(),
      ...this.tokens.values(),
      ...this.captures.values(),
    ];
    const hits = this.raycaster.intersectObjects(stuff, true);
    if (!hits.length) return;
    const collectible = collectibleOf(hits[0].object);
    if (collectible) {
      const { q, r } = collectible.userData;
      if (this.hexRecord(q, r)?.hex?.terrain === "tree") return;
      this.onHex(q, r);
      return;
    }
    const tile = hexTileOf(hits[0].object);
    if (!tile) return;
    const { q, r } = tile.userData;
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
    if (!this.hopTracking) this.look.lerp(this.target, 0.08);
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
    for (const rec of this.hexes.values()) {
      const mat = rec.mesh.userData.crystalMat;
      if (!mat) continue;
      mat.color.setHex(rec.mesh.userData.crystalSpent ? 0x7a7a7a : 0xffffff);
    }
    for (const [i, h] of this.highlights.entries()) {
      h.position.y += Math.sin(t * 4 + i) * 0.0008;
      const pulse = h.userData.pulse;
      if (pulse) pulse.opacity = 0.34 + Math.sin(t * 5 + i) * 0.1;
    }
    this.placeMoveBadge();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  }
}

function blorpOf(obj) {
  let cur = obj;
  while (cur) {
    if (cur.userData?.kind === "blorp") return cur;
    cur = cur.parent;
  }
  return null;
}

function collectibleOf(obj) {
  let cur = obj;
  while (cur) {
    if (cur.userData?.kind === "collectible") return cur;
    cur = cur.parent;
  }
  return null;
}

function hexTileOf(obj) {
  let cur = obj;
  while (cur) {
    if (cur.userData?.kind === "hex") return cur;
    cur = cur.parent;
  }
  return null;
}

function bodyPoints(player) {
  const points = Number(player?.score);
  if (Number.isFinite(points)) return points;
  return player?.slime || 0;
}

function blorpScale(points) {
  return 0.72 + Math.min(points, 12) * 0.08;
}

function blorpLift(points) {
  return 0.22 + Math.min(points, 12) * 0.03;
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

GameScene.prototype.placeMoveBadge = function placeMoveBadge() {
  const state = this.state;
  const show =
    this.mode === "play" &&
    state?.status === "playing" &&
    state.phase === "move" &&
    state.turnPlayerId;
  const mesh = show ? this.blorps.get(state.turnPlayerId) : null;
  if (!mesh) {
    if (this.moveBadge) this.moveBadge.visible = false;
    return;
  }
  const count = state.remainingMove ?? 0;
  if (!this.moveBadge) {
    this.moveBadge = makeMoveBadge(count);
    this.scene.add(this.moveBadge);
  } else if (this.moveBadge.userData.count !== count) {
    paintMoveBadge(this.moveBadge, count);
  }
  this.moveBadge.visible = true;
  const scaleY = mesh.scale.y || mesh.scale.x || 1;
  const hatTop = mesh.userData.hatTop ?? 0.34;
  this.moveBadge.position.set(mesh.position.x, mesh.position.y + hatTop * scaleY + 0.38, mesh.position.z);
};

function paintMoveBadge(sprite, count) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.fillStyle = "#fffdf6";
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = "#1b2a38";
  g.stroke();
  g.fillStyle = "#1b2a38";
  g.font = "700 72px Fredoka, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(count), 64, 68);
  const tex = new THREE.CanvasTexture(c);
  if (sprite.material.map) sprite.material.map.dispose();
  sprite.material.map = tex;
  sprite.userData.count = count;
}

function makeMoveBadge(count) {
  const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.58, 0.58, 1);
  sprite.renderOrder = 10;
  paintMoveBadge(sprite, count);
  return sprite;
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
