// Générateur de musique libre de droits (synthèse simple en JavaScript).
// makeMusic({ style, seed, duration, bpm, dropAt, hits }) -> { sampleRate, left, right }
(function () {
  const SR = 48000;

  function rng(seed) {
    let s = (seed * 2654435761) >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // Filtre biquad (RBJ). type : 'lp' | 'hp' | 'bp'
  function coef(type, f, q = 0.707) {
    const w = 2 * Math.PI * Math.min(f, SR * 0.45) / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = a; b1 = 0; b2 = -a; }
    const a0 = 1 + a;
    return [b0 / a0, b1 / a0, b2 / a0, (-2 * c) / a0, (1 - a) / a0];
  }
  function filt(x, type, f, q) {
    const [b0, b1, b2, a1, a2] = coef(type, f, q);
    const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  // filtre dont la fréquence change dans le temps : fn(t01) -> fréquence
  function sweep(x, type, fn, q = 1.2) {
    const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0, c;
    for (let i = 0; i < x.length; i++) {
      if (i % 128 === 0) c = coef(type, fn(i / x.length), q);
      const v = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }

  const note = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function makeMusic(opt) {
    const style = opt.style || 'energy';
    const R = rng(opt.seed || 1);
    const DUR = opt.duration, N = Math.floor(DUR * SR);
    const BPM = opt.bpm || 120, BEAT = 60 / BPM, BAR = BEAT * 4;
    const DROP = opt.dropAt || BEAT * 6;
    const END = DUR - 1.0;
    const L = new Float32Array(N), Rr = new Float32Array(N);
    const noise = (n) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = R() * 2 - 1; return a; };
    const add = (sig, t, g = 1, pan = 0) => {
      const i0 = Math.floor(t * SR); if (i0 >= N) return;
      const gl = g * (1 - Math.max(pan, 0)), gr = g * (1 + Math.min(pan, 0));
      for (let i = 0; i < sig.length && i0 + i < N; i++) { if (i0 + i < 0) continue; L[i0 + i] += sig[i] * gl; Rr[i0 + i] += sig[i] * gr; }
    };
    const saw = (f, n, det = 0.08) => {
      const a = new Float32Array(n);
      for (const d of [-det, 0, det]) { const ff = f * Math.pow(2, d / 12); for (let i = 0; i < n; i++) a[i] += (2 * ((i / SR * ff) % 1) - 1) / 3; }
      return a;
    };
    const sine = (f, n) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.sin(2 * Math.PI * f * i / SR); return a; };

    // progressions (racine + accord) – on en choisit une avec la graine
    const PROGS = [
      [[57, [57, 60, 64]], [53, [53, 57, 60]], [48, [55, 60, 64]], [55, [55, 59, 62]]],   // Am F C G
      [[50, [50, 53, 57]], [46, [53, 58, 62]], [53, [53, 57, 60]], [48, [52, 55, 60]]],   // Dm Bb F C
      [[52, [52, 55, 59]], [48, [52, 55, 60]], [55, [55, 59, 62]], [50, [54, 57, 62]]],   // Em C G D
      [[45, [57, 60, 64]], [53, [57, 60, 65]], [50, [57, 62, 65]], [52, [56, 59, 64]]],   // Am F Dm E
    ];
    const prog = PROGS[Math.floor(R() * PROGS.length)];
    const tr = [0, -2, 2, -3][Math.floor(R() * 4)];
    const chordAt = (t) => prog[Math.floor(t / BAR) % 4];

    // ---------- instruments ----------
    const kick = (soft) => {
      const n = Math.floor(0.45 * SR), a = new Float32Array(n); let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR, f = (soft ? 50 : 45) + (soft ? 70 : 110) * Math.exp(-t * 30);
        ph += 2 * Math.PI * f / SR; a[i] = Math.tanh(Math.sin(ph) * Math.exp(-t * (soft ? 9 : 7)) * 1.6);
      }
      return a;
    };
    const clap = () => {
      const n = Math.floor(0.3 * SR), nz = filt(filt(noise(n), 'hp', 900), 'lp', 5000);
      for (let i = 0; i < n; i++) {
        const t = i / SR; let e = Math.exp(-t * 18);
        for (const k of [0, 0.011, 0.022]) if (t >= k) e += Math.exp(-(t - k) * 120) * 0.8;
        nz[i] *= e * 0.6;
      }
      return nz;
    };
    const hat = (open) => {
      const n = Math.floor((open ? 0.25 : 0.06) * SR), a = filt(noise(n), 'hp', 7000);
      for (let i = 0; i < n; i++) a[i] *= Math.exp(-i / SR * (open ? 12 : 70)) * 0.35;
      return a;
    };
    const impact = () => {
      const n = Math.floor(1.6 * SR), nz = filt(noise(n), 'lp', 2500), a = new Float32Array(n); let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR; ph += 2 * Math.PI * (38 + 60 * Math.exp(-t * 8)) / SR;
        a[i] = Math.tanh((Math.sin(ph) * Math.exp(-t * 2.2) + nz[i] * Math.exp(-t * 4) * 0.4) * 1.3);
      }
      return a;
    };
    const whoosh = (len) => {
      const n = Math.floor(len * SR);
      const a = sweep(noise(n), 'bp', (p) => 600 + 6000 * p, 1.0);
      for (let i = 0; i < n; i++) a[i] *= Math.pow(i / n, 2) * 0.5;
      return a;
    };
    const bell = (f, n) => { // son type piano / cloche
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        a[i] = (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 3) + 0.25 * Math.sin(2 * Math.PI * f * 3.01 * t) * Math.exp(-t * 6)) * Math.exp(-t * 2.5) * Math.min(t / 0.003, 1);
      }
      return a;
    };

    // ---------- pad (accords) ----------
    const padSoft = style === 'chill' || style === 'luxe';
    for (let b = 0; b * BAR < DUR; b++) {
      const t0 = b * BAR, [, ch] = prog[b % 4], n = Math.floor(BAR * SR);
      let pad = new Float32Array(n);
      for (const m of ch) {
        const s = padSoft ? sine(note(m + 12 + tr), n) : saw(note(m + 12 + tr), n);
        for (let i = 0; i < n; i++) pad[i] += s[i] / 3;
      }
      for (let i = 0; i < n; i++) pad[i] *= Math.min(i / (0.08 * SR), 1) * Math.min((n - i) / (0.08 * SR), 1);
      pad = filt(pad, 'lp', t0 < DROP ? 900 : (padSoft ? 1800 : 2600));
      add(pad, t0, padSoft ? 0.22 : 0.16);
    }

    // ---------- montée avant le drop ----------
    {
      const n = Math.floor(DROP * SR);
      const r = sweep(noise(n), 'bp', (p) => 400 + 9000 * p * p, 1.1);
      for (let i = 0; i < n; i++) r[i] *= Math.pow(i / n, 2) * 0.35;
      add(r, 0, 1);
      for (let t = BEAT / 4, k = 0; t < DROP; t += BEAT / 2, k++) add(hat(false), t, 0.4 + 0.5 * k / 12);
    }

    // impacts & whooshes aux changements de scène
    const hits = opt.hits || [];
    hits.forEach((t, i) => {
      add(impact(), t, i === 0 ? 0.55 : 0.3);
      if (i > 0) add(whoosh(0.5), t - 0.5, 0.8);
    });

    // ---------- rythme ----------
    let k = 0;
    for (let t = DROP; t < END - 1e-6; t += BEAT, k++) {
      if (style === 'urban') {
        if (k % 4 === 0 || (k % 8 === 5)) add(kick(false), t, 0.95);
        if (k % 4 === 2) add(clap(), t, 0.6);
        add(hat(false), t, 0.3, -0.2); add(hat(false), t + BEAT / 2, 0.35, 0.2);
        if (k % 4 === 3) { add(hat(false), t + BEAT * 0.25, 0.25); add(hat(false), t + BEAT * 0.75, 0.25); }
      } else if (style === 'chill') {
        add(kick(true), t, k % 2 === 0 ? 0.8 : 0.5);
        if (k % 2 === 1) add(clap(), t, 0.3);
        add(hat(false), t + BEAT / 2, 0.3, 0.25);
      } else if (style === 'luxe') {
        if (k % 2 === 0) add(kick(true), t, 0.75);
        if (k % 4 === 2) add(clap(), t, 0.35);
        add(hat(false), t + BEAT / 2, 0.25, 0.25);
      } else { // energy
        add(kick(false), t, 0.9);
        if (k % 2 === 1) add(clap(), t, 0.55);
        add(hat(false), t + BEAT / 2, 0.5, 0.25);
        if (k % 4 === 3) add(hat(true), t + BEAT / 2, 0.35, -0.25); else add(hat(false), t, 0.25, -0.2);
      }
    }

    // ---------- basse ----------
    if (style === 'urban') { // 808 longues
      for (let t = DROP; t < END - 1e-6; t += BEAT * 2) {
        const root = chordAt(t)[0] - 24 + tr, n = Math.floor(BEAT * 1.9 * SR), a = new Float32Array(n);
        let ph = 0;
        for (let i = 0; i < n; i++) { const tt = i / SR; ph += 2 * Math.PI * note(root) * (1 + 0.5 * Math.exp(-tt * 40)) / SR; a[i] = Math.tanh(Math.sin(ph) * 2) * Math.exp(-tt * 1.2) * Math.min(tt / 0.005, 1); }
        add(a, t, 0.45);
      }
    } else {
      const step = style === 'energy' ? BEAT / 2 : BEAT;
      for (let t = DROP; t < END - 1e-6; t += step) {
        const root = chordAt(t)[0] - 24 + tr, n = Math.floor(step * SR);
        const s = filt(saw(note(root), n), 'lp', 700), si = sine(note(root), n), a = new Float32Array(n);
        for (let i = 0; i < n; i++) { const tt = i / SR; a[i] = Math.tanh((s[i] + 0.5 * si[i]) * Math.min(tt / 0.005, 1) * Math.exp(-tt * (style === 'energy' ? 5 : 3)) * 2); }
        add(a, t, style === 'energy' ? 0.35 : 0.3);
      }
    }

    // ---------- mélodie (arpège) après le 2e changement de scène ----------
    const arpStart = hits[1] || DROP + BAR;
    let j = 0;
    for (let t = arpStart; t < END - 1e-6; t += BEAT / 2, j++) {
      const ch = chordAt(t)[1], m = ch[[0, 1, 2, 1][j % 4]] + 24 + tr, n = Math.floor(0.6 * SR);
      let s;
      if (style === 'luxe' || style === 'chill') { if (j % 2 && style === 'luxe') continue; s = bell(note(m), n); }
      else { s = filt(saw(note(m), n), 'lp', 3500); for (let i = 0; i < n; i++) s[i] *= Math.exp(-i / SR * 10); }
      add(s, t, style === 'luxe' ? 0.14 : 0.12, j % 2 ? 0.35 : -0.35);
    }

    add(impact(), END, 0.45);

    // ---------- pompage (sidechain), fondu, normalisation ----------
    let peak = 1e-9;
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      let g = 1;
      if (t >= DROP && style !== 'luxe') g = 1 - 0.25 * Math.exp(-(((t - DROP) % BEAT)) * 14);
      g *= Math.min(Math.max((DUR - t) / 0.6, 0), 1);
      if (t < 0.05) g *= t / 0.05;
      L[i] *= g; Rr[i] *= g;
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(Rr[i]));
    }
    const norm = 1 / peak, sat = Math.tanh(1.4);
    for (let i = 0; i < N; i++) {
      L[i] = Math.tanh(L[i] * norm * 1.4) / sat * 0.89;
      Rr[i] = Math.tanh(Rr[i] * norm * 1.4) / sat * 0.89;
    }
    return { sampleRate: SR, left: L, right: Rr };
  }

  window.makeMusic = makeMusic;
})();
