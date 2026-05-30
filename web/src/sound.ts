// Tiny Web Audio synth — all game sounds are generated, no asset files.
// The AudioContext is created on the first user gesture (autoplay policy).
let ctx: AudioContext | null = null;
let muted = false;
try { muted = localStorage.getItem("ing_muted") === "1"; } catch { /* ignore */ }

function ac(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// Resume/create the context on the first interaction so later sounds play.
export function initAudio() {
  const unlock = () => { try { ac(); } catch { /* ignore */ } cleanup(); };
  const cleanup = () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem("ing_muted", m ? "1" : "0"); } catch { /* ignore */ }
}

interface NoteOpts { type?: OscillatorType; gain?: number; glideTo?: number; }
function note(freq: number, at: number, dur: number, o: NoteOpts = {}) {
  const c = ac();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? "triangle";
  osc.frequency.setValueAtTime(freq, at);
  if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, at + dur);
  const peak = o.gain ?? 0.14;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.03);
}

// A short filtered-noise "clack" for placing a tile.
function clack(at: number, gain = 0.22) {
  const c = ac();
  const len = Math.floor(c.sampleRate * 0.07);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  const src = c.createBufferSource(); src.buffer = buf;
  const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1100; bp.Q.value = 0.7;
  const g = c.createGain(); g.gain.value = gain;
  src.connect(bp).connect(g).connect(c.destination);
  src.start(at);
}

export const sound = {
  select() { if (muted) return; note(680, ac().currentTime, 0.05, { type: "square", gain: 0.05 }); },
  place() {
    if (muted) return;
    const t = ac().currentTime;
    clack(t);
    note(190, t, 0.09, { type: "sine", gain: 0.16, glideTo: 95 }); // low thunk
  },
  score(points: number) {
    if (muted) return;
    const t = ac().currentTime;
    const base = 460 + Math.min(points, 12) * 26; // higher pitch for bigger gains
    note(base, t, 0.13, { type: "triangle", gain: 0.1, glideTo: base * 1.5 });
  },
  ingenious() {
    if (muted) return;
    const t = ac().currentTime;
    [523, 659, 784, 1047].forEach((f, i) => note(f, t + i * 0.085, 0.2, { type: "triangle", gain: 0.16 }));
  },
  yourTurn() {
    if (muted) return;
    const t = ac().currentTime;
    note(587, t, 0.1, { type: "sine", gain: 0.09 });
    note(880, t + 0.1, 0.13, { type: "sine", gain: 0.09 });
  },
  gameOver() {
    if (muted) return;
    const t = ac().currentTime;
    [392, 523, 659, 784, 1047].forEach((f, i) => note(f, t + i * 0.12, 0.32, { type: "triangle", gain: 0.15 }));
  },
  undo() {
    if (muted) return;
    const t = ac().currentTime;
    note(520, t, 0.1, { type: "sine", gain: 0.1, glideTo: 320 }); // descending "rewind"
  },
};
