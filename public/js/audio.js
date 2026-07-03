// ============================================================
// KRELL client — procedural audio (WebAudio, zero asset files)
// All effects synthesized: noise bursts, filtered oscillators.
// Positional sounds pan/attenuate relative to the listener.
// ============================================================

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.listener = { x: 0, y: 0 };
    this._noise = null;
    this._defuseLoop = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.6;
      this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch { return false; }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // -------- routing helpers --------

  _out(x, y, baseGain) {
    // returns a gain node routed (optionally panned) to master
    const g = this.ctx.createGain();
    let vol = baseGain;
    if (x != null) {
      const dx = x - this.listener.x, dy = y - this.listener.y;
      const d = Math.hypot(dx, dy);
      vol *= 1 / (1 + d / 520);
      const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (pan) {
        pan.pan.value = Math.max(-0.85, Math.min(0.85, dx / 900));
        g.connect(pan); pan.connect(this.master);
      } else g.connect(this.master);
    } else {
      g.connect(this.master);
    }
    g.gain.value = vol;
    return g;
  }

  _burst(out, { dur = 0.1, filter = 'lowpass', freq = 1000, q = 0.8, gain = 1, slide = 0 }) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filter; f.frequency.value = freq; f.Q.value = q;
    if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.05);
  }

  _tone(out, { type = 'sine', freq = 440, dur = 0.15, gain = 0.5, slide = 0, delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // -------- game sounds --------

  shot(weaponId, x, y, mine = false) {
    if (!this.ctx) return;
    const v = mine ? 0.5 : 0.62;
    const out = this._out(mine ? null : x, y, v);
    switch (weaponId) {
      case 'pistol':
        this._burst(out, { dur: 0.07, filter: 'bandpass', freq: 1500, gain: 1.0 });
        this._tone(out, { type: 'square', freq: 190, dur: 0.06, gain: 0.5, slide: -120 });
        break;
      case 'smg':
        this._burst(out, { dur: 0.05, filter: 'bandpass', freq: 2100, gain: 0.8 });
        this._tone(out, { type: 'square', freq: 230, dur: 0.045, gain: 0.4, slide: -140 });
        break;
      case 'rifle':
        this._burst(out, { dur: 0.085, filter: 'bandpass', freq: 1200, q: 0.6, gain: 1.1 });
        this._tone(out, { type: 'sawtooth', freq: 160, dur: 0.08, gain: 0.55, slide: -110 });
        break;
      case 'shotgun':
        this._burst(out, { dur: 0.18, filter: 'lowpass', freq: 900, gain: 1.4 });
        this._tone(out, { type: 'square', freq: 95, dur: 0.14, gain: 0.7, slide: -55 });
        break;
      case 'sniper':
        this._burst(out, { dur: 0.3, filter: 'lowpass', freq: 1400, gain: 1.5, slide: -1100 });
        this._tone(out, { type: 'sawtooth', freq: 120, dur: 0.26, gain: 0.8, slide: -85 });
        break;
      default:
        this._burst(out, { dur: 0.06, filter: 'highpass', freq: 2500, gain: 0.4 });
    }
  }

  swing(x, y, mine) {
    if (!this.ctx) return;
    const out = this._out(mine ? null : x, y, 0.35);
    this._burst(out, { dur: 0.12, filter: 'bandpass', freq: 900, q: 2.5, gain: 0.7, slide: 1400 });
  }

  dryfire() { if (this.ctx) this._tone(this._out(null, 0, 0.4), { type: 'square', freq: 950, dur: 0.03, gain: 0.35 }); }

  reload(x, y, mine) {
    if (!this.ctx) return;
    const out = this._out(mine ? null : x, y, mine ? 0.4 : 0.25);
    this._burst(out, { dur: 0.04, filter: 'bandpass', freq: 2600, q: 4, gain: 0.8 });
    setTimeout(() => this.ctx && this._burst(out, { dur: 0.05, filter: 'bandpass', freq: 1900, q: 4, gain: 0.8 }), 140);
  }

  impact(x, y) {
    if (!this.ctx) return;
    this._burst(this._out(x, y, 0.3), { dur: 0.04, filter: 'highpass', freq: 2000, gain: 0.6 });
  }

  hitmarker() {
    if (!this.ctx) return;
    const out = this._out(null, 0, 0.45);
    this._tone(out, { type: 'sine', freq: 1250, dur: 0.04, gain: 0.5 });
    this._tone(out, { type: 'sine', freq: 880, dur: 0.05, gain: 0.4, delay: 0.04 });
  }

  hurt() {
    if (!this.ctx) return;
    const out = this._out(null, 0, 0.5);
    this._burst(out, { dur: 0.09, filter: 'lowpass', freq: 500, gain: 1.0 });
    this._tone(out, { type: 'sawtooth', freq: 140, dur: 0.1, gain: 0.4, slide: -70 });
  }

  kill() {
    if (!this.ctx) return;
    const out = this._out(null, 0, 0.5);
    [660, 880, 1320].forEach((f, i) => this._tone(out, { type: 'triangle', freq: f, dur: 0.07, gain: 0.45, delay: i * 0.055 }));
  }

  multikill(streak) {
    if (!this.ctx || streak < 2) return;
    const out = this._out(null, 0, 0.55);
    // rising arpeggio, longer + higher with each tier
    const base = 520 + streak * 60;
    const steps = Math.min(streak + 1, 5);
    for (let i = 0; i < steps; i++) {
      this._tone(out, { type: 'triangle', freq: base * Math.pow(1.26, i), dur: 0.1, gain: 0.4, delay: i * 0.075 });
    }
  }

  death() {
    if (!this.ctx) return;
    const out = this._out(null, 0, 0.55);
    this._tone(out, { type: 'sawtooth', freq: 220, dur: 0.5, gain: 0.5, slide: -170 });
    this._burst(out, { dur: 0.4, filter: 'lowpass', freq: 600, gain: 0.8, slide: -480 });
  }

  footstep(x, y, mine) {
    if (!this.ctx) return;
    const out = this._out(mine ? null : x, y, mine ? 0.10 : 0.22);
    this._burst(out, { dur: 0.035, filter: 'lowpass', freq: 480 + Math.random() * 160, gain: 0.9 });
  }

  explosion(x, y, big) {
    if (!this.ctx) return;
    const out = this._out(x, y, big ? 1.0 : 0.8);
    this._burst(out, { dur: big ? 1.1 : 0.55, filter: 'lowpass', freq: big ? 380 : 600, gain: 2.2, slide: big ? -330 : -480 });
    this._tone(out, { type: 'sine', freq: 55, dur: big ? 0.9 : 0.45, gain: 1.2, slide: -25 });
    this._burst(out, { dur: 0.18, filter: 'highpass', freq: 1500, gain: 0.7 });
  }

  bombBeep(x, y, urgency) {
    if (!this.ctx) return;
    const out = this._out(x, y, 0.5);
    this._tone(out, { type: 'square', freq: 1080 + urgency * 240, dur: 0.05, gain: 0.4 });
  }

  plantTick(x, y) {
    if (!this.ctx) return;
    this._tone(this._out(x, y, 0.35), { type: 'square', freq: 760, dur: 0.03, gain: 0.4 });
  }

  defuseTick() {
    if (!this.ctx) return;
    this._tone(this._out(null, 0, 0.3), { type: 'sawtooth', freq: 320 + Math.random() * 60, dur: 0.05, gain: 0.3 });
  }

  planted() {
    if (!this.ctx) return;
    const out = this._out(null, 0, 0.6);
    this._tone(out, { type: 'square', freq: 740, dur: 0.16, gain: 0.4 });
    this._tone(out, { type: 'square', freq: 560, dur: 0.22, gain: 0.4, delay: 0.18 });
  }

  defused() {
    if (!this.ctx) return;
    const out = this._out(null, 0, 0.6);
    [520, 700, 1040].forEach((f, i) => this._tone(out, { type: 'triangle', freq: f, dur: 0.12, gain: 0.45, delay: i * 0.1 }));
  }

  roundStart() {
    if (!this.ctx) return;
    const out = this._out(null, 0, 0.5);
    this._tone(out, { type: 'sawtooth', freq: 110, dur: 0.5, gain: 0.35 });
    this._tone(out, { type: 'triangle', freq: 440, dur: 0.14, gain: 0.4, delay: 0.05 });
    this._tone(out, { type: 'triangle', freq: 587, dur: 0.2, gain: 0.4, delay: 0.2 });
  }

  win() {
    if (!this.ctx) return;
    const out = this._out(null, 0, 0.55);
    [392, 494, 587, 784].forEach((f, i) => this._tone(out, { type: 'triangle', freq: f, dur: 0.18, gain: 0.4, delay: i * 0.11 }));
  }

  lose() {
    if (!this.ctx) return;
    const out = this._out(null, 0, 0.55);
    [392, 330, 262, 196].forEach((f, i) => this._tone(out, { type: 'triangle', freq: f, dur: 0.2, gain: 0.4, delay: i * 0.12 }));
  }

  buy() { if (this.ctx) this._tone(this._out(null, 0, 0.45), { type: 'sine', freq: 980, dur: 0.07, gain: 0.4, slide: 250 }); }
  deny() { if (this.ctx) this._tone(this._out(null, 0, 0.45), { type: 'square', freq: 140, dur: 0.13, gain: 0.4 }); }
  click() { if (this.ctx) this._tone(this._out(null, 0, 0.3), { type: 'sine', freq: 600, dur: 0.03, gain: 0.3 }); }
  chat() { if (this.ctx) this._tone(this._out(null, 0, 0.3), { type: 'sine', freq: 1320, dur: 0.05, gain: 0.25 }); }
  tink(x, y) { if (this.ctx) this._tone(this._out(x, y, 0.4), { type: 'triangle', freq: 1700 + Math.random() * 400, dur: 0.06, gain: 0.4, slide: -500 }); }
}

export const audio = new AudioEngine();
