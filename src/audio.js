let ctx;
let muted = false;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function setMuted(v) {
  muted = v;
}

export function isMuted() {
  return muted;
}

function beep(freq, dur, type = "sine", gain = 0.07) {
  if (muted) return;
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start();
  o.stop(c.currentTime + dur);
}

export function sfx(kind) {
  if (kind === "hop") {
    beep(420, 0.09, "triangle", 0.05);
    setTimeout(() => beep(540, 0.08, "triangle", 0.04), 70);
  } else if (kind === "slurp") {
    beep(220, 0.16, "sawtooth", 0.04);
    setTimeout(() => beep(380, 0.12, "sine", 0.05), 80);
  } else if (kind === "bop") {
    beep(90, 0.14, "square", 0.06);
  } else if (kind === "win") {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.2, "sine", 0.06), i * 120));
  } else if (kind === "click") {
    beep(700, 0.05, "sine", 0.03);
  } else if (kind === "card") {
    beep(880, 0.12, "triangle", 0.05);
  } else if (kind === "freebounce") {
    boing();
  }
}

function boing() {
  if (muted) return;
  const c = ac();
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(196, t);
  o.frequency.exponentialRampToValueAtTime(740, t + 0.08);
  o.frequency.exponentialRampToValueAtTime(280, t + 0.2);
  o.frequency.exponentialRampToValueAtTime(988, t + 0.32);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.08, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + 0.56);
  setTimeout(() => beep(1318, 0.14, "square", 0.035), 180);
}

export function unlockAudio() {
  try {
    ac();
  } catch {
    /* ignore */
  }
}
