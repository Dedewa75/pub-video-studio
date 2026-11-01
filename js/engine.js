// Moteur vidéo : dessine chaque image de la pub sur un canvas 1080x1920 et exporte en MP4.
(function () {
  const W = 1080, H = 1920, FPS = 30, BPM = 120, BEAT = 60 / BPM;
  const FONT = "Montserrat, Inter, 'Segoe UI', Arial, sans-serif";
  const DARK = '#0E1015', WHITE = '#F6F6F6';

  // ---------- outils ----------
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const prog = (t, t0, d) => clamp((t - t0) / d);
  const eOut = (x) => 1 - Math.pow(1 - x, 3);
  const eIn = (x) => x * x * x;
  const eBack = (x, s = 1.7) => { x -= 1; return 1 + x * x * ((s + 1) * x + s); };
  const lerp = (a, b, x) => a + (b - a) * x;
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  function hexRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const rgba = (hex, a) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; };
  function lum(hex) { const [r, g, b] = hexRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
  function rng(seed) { let s = (seed * 9301 + 49297) % 233280; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

  // ---------- 3D ----------
  const FOCAL = 1500;
  function rotMat(rx, ry, rz) {
    const [a, b, c] = [rx, ry, rz].map((d) => d * Math.PI / 180);
    const Rx = [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
    const Ry = [[Math.cos(b), 0, Math.sin(b)], [0, 1, 0], [-Math.sin(b), 0, Math.cos(b)]];
    const Rz = [[Math.cos(c), -Math.sin(c), 0], [Math.sin(c), Math.cos(c), 0], [0, 0, 1]];
    const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
    return mul(Rz, mul(Ry, Rx));
  }
  function project(w, h, cx, cy, rx, ry, rz, z) {
    const R = rotMat(rx, ry, rz);
    const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => {
      const X = R[0][0] * x + R[0][1] * y, Y = R[1][0] * x + R[1][1] * y, Z = R[2][0] * x + R[2][1] * y + z;
      const s = FOCAL / Math.max(FOCAL + Z, 60);
      return [cx + X * s, cy + Y * s];
    });
    return { pts, R };
  }
  // homographie carré unité -> quadrilatère
  function homography(q) {
    const [p0, p1, p2, p3] = q;
    const sx = p0[0] - p1[0] + p2[0] - p3[0], sy = p0[1] - p1[1] + p2[1] - p3[1];
    let a, b, c, d, e, f, g, h;
    if (Math.abs(sx) < 1e-6 && Math.abs(sy) < 1e-6) {
      a = p1[0] - p0[0]; b = p3[0] - p0[0]; c = p0[0]; d = p1[1] - p0[1]; e = p3[1] - p0[1]; f = p0[1]; g = 0; h = 0;
    } else {
      const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1];
      const det = dx1 * dy2 - dx2 * dy1;
      g = (sx * dy2 - dx2 * sy) / det; h = (dx1 * sy - sx * dy1) / det;
      a = p1[0] - p0[0] + g * p1[0]; b = p3[0] - p0[0] + h * p3[0]; c = p0[0];
      d = p1[1] - p0[1] + g * p1[1]; e = p3[1] - p0[1] + h * p3[1]; f = p0[1];
    }
    return (u, v) => { const k = g * u + h * v + 1; return [(a * u + b * v + c) / k, (d * u + e * v + f) / k]; };
  }
  function drawTri(ctx, img, s, d) {
    const [[u0, v0], [u1, v1], [u2, v2]] = s, [[x0, y0], [x1, y1], [x2, y2]] = d;
    const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(den) < 1e-9) return;
    const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / den;
    const c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / den;
    const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / den;
    const dd = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / den;
    const e = x0 - a * u0 - c * v0, f = y0 - b * u0 - dd * v0;
    // clip légèrement agrandi pour éviter les fines lignes entre triangles
    const mx = (x0 + x1 + x2) / 3, my = (y0 + y1 + y2) / 3, grow = (x, y) => { const l = Math.hypot(x - mx, y - my) || 1; return [x + (x - mx) / l * 0.9, y + (y - my) / l * 0.9]; };
    const g0 = grow(x0, y0), g1 = grow(x1, y1), g2 = grow(x2, y2);
    ctx.save();
    ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.lineTo(g2[0], g2[1]); ctx.closePath(); ctx.clip();
    ctx.transform(a, b, c, dd, e, f);
    const sx = Math.max(0, Math.min(u0, u1, u2) - 2), sy = Math.max(0, Math.min(v0, v1, v2) - 2);
    const sw = Math.min(img.width, Math.max(u0, u1, u2) + 2) - sx, sh = Math.min(img.height, Math.max(v0, v1, v2) + 2) - sy;
    if (sw > 0 && sh > 0) ctx.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh);
    ctx.restore();
  }
  function drawQuad(ctx, img, quad, n = 8) {
    const Hm = homography(quad), iw = img.width, ih = img.height;
    const P = []; for (let j = 0; j <= n; j++) { P.push([]); for (let i = 0; i <= n; i++) P[j].push(Hm(i / n, j / n)); }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const s00 = [i / n * iw, j / n * ih], s10 = [(i + 1) / n * iw, j / n * ih], s01 = [i / n * iw, (j + 1) / n * ih], s11 = [(i + 1) / n * iw, (j + 1) / n * ih];
      drawTri(ctx, img, [s00, s10, s01], [P[j][i], P[j][i + 1], P[j + 1][i]]);
      drawTri(ctx, img, [s10, s11, s01], [P[j][i + 1], P[j + 1][i + 1], P[j + 1][i]]);
    }
  }
  const TMP = { c: null };
  function card3d(ctx, card, cx, cy, w, o = {}) {
    const alpha = o.alpha === undefined ? 1 : o.alpha;
    if (alpha <= 0.01) return;
    const h = w * card.height / card.width;
    const { pts, R } = project(w, h, cx, cy, o.rx || 0, o.ry || 0, o.rz || 0, o.z || 0);
    // ombrage selon l'angle + reflet lumineux, dessinés dans une copie de la carte
    const nz = Math.abs(R[2][2]);
    const dark = clamp(1 - nz) * 0.9;
    let src = card;
    if (dark > 0.01 || o.shine !== undefined) {
      if (!TMP.c || TMP.c.width !== card.width || TMP.c.height !== card.height) TMP.c = mkCanvas(card.width, card.height);
      const t = TMP.c.getContext('2d');
      t.globalCompositeOperation = 'copy'; t.drawImage(card, 0, 0);
      t.globalCompositeOperation = 'source-atop';
      if (o.shine !== undefined && o.shine > 0 && o.shine < 1) {
        const p = o.shine * (card.width + card.height) - card.height * 0.5;
        const g = t.createLinearGradient(p, 0, p + 260, card.height * 0.4);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        t.fillStyle = g; t.fillRect(0, 0, card.width, card.height);
      }
      if (dark > 0.01) { t.fillStyle = `rgba(0,0,0,${Math.min(dark, 0.6)})`; t.fillRect(0, 0, card.width, card.height); }
      t.globalCompositeOperation = 'source-over';
      src = TMP.c;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    if (o.shadow !== false) { // ombre portée (quadrilatère rétréci pour rester sous les coins arrondis)
      const mx = pts.reduce((s, p) => s + p[0], 0) / 4, my = pts.reduce((s, p) => s + p[1], 0) / 4;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 60; ctx.shadowOffsetX = 20; ctx.shadowOffsetY = 45;
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.beginPath();
      pts.forEach(([x, y], i) => { const X = mx + (x - mx) * 0.93, Y = my + (y - my) * 0.93; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    drawQuad(ctx, src, pts, o.sub || 8);
    ctx.restore();
  }

  // ---------- texte ----------
  function font(weight, size) { return `${weight} ${Math.round(size)}px ${FONT}`; }
  function fit(ctx, text, weight, size, maxW, spacing = 0) {
    let s = size;
    for (let k = 0; k < 40; k++) {
      ctx.font = font(weight, s); ctx.letterSpacing = (spacing * s / 100) + 'px';
      if (ctx.measureText(text).width <= maxW) break;
      s *= 0.94;
    }
    return s;
  }
  function text(ctx, str, x, y, o = {}) {
    const size = o.size || 60, weight = o.weight || 900;
    ctx.save();
    ctx.globalAlpha *= o.alpha === undefined ? 1 : o.alpha;
    ctx.translate(x, y);
    if (o.scale !== undefined) ctx.scale(o.scale, o.scale);
    if (o.rot) ctx.rotate(o.rot);
    ctx.font = font(weight, size);
    ctx.letterSpacing = ((o.spacing || 0) * size / 100) + 'px';
    ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'middle';
    if (o.shadow !== false) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8; }
    ctx.fillStyle = o.color || WHITE;
    ctx.fillText(str, 0, 0);
    ctx.restore();
  }
  function pop(ctx, str, x, y, t, t0, o = {}) {
    const p = prog(t, t0, o.d || 0.45);
    if (p <= 0) return;
    text(ctx, str, x, y + (1 - eOut(p)) * (o.dy === undefined ? 70 : o.dy), { ...o, scale: lerp(0.6, 1, eBack(p)), alpha: clamp(p * 2.5) * (o.alpha === undefined ? 1 : o.alpha) });
  }
  function highlight(ctx, str, x, y, t, t0, o) {
    const p = eOut(prog(t, t0, 0.35));
    if (p <= 0) return;
    const size = fit(ctx, str, 900, o.size || 110, o.maxW || 900);
    ctx.font = font(900, size); ctx.letterSpacing = '0px';
    const tw = ctx.measureText(str).width, bw = tw + 70, bh = size * 1.18;
    const s = lerp(1.25, 1, eOut(prog(t, t0, 0.3)));
    ctx.save();
    ctx.translate(x, y); ctx.rotate(-0.035); ctx.scale(s, s);
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
    ctx.fillStyle = o.bg;
    roundRect(ctx, -bw / 2, -bh / 2, bw * p, bh, 18); ctx.fill();
    ctx.shadowColor = 'transparent';
    const pt = prog(t, t0 + 0.15, 0.3);
    if (pt > 0) {
      ctx.beginPath(); ctx.rect(-bw / 2, -bh / 2, bw * p, bh); ctx.clip();
      ctx.globalAlpha = clamp(pt * 2);
      ctx.fillStyle = o.fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(str, 0, size * 0.04);
    }
    ctx.restore();
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, h / 2);
    ctx.beginPath();
    if (w < 2 * r) { ctx.rect(x, y, Math.max(w, 0), h); return; }
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function checkIcon(ctx, x, y, r, accent) {
    ctx.save(); ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = DARK; ctx.lineWidth = r * 0.28; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x - r * 0.45, y + r * 0.02); ctx.lineTo(x - r * 0.12, y + r * 0.35); ctx.lineTo(x + r * 0.48, y - r * 0.32); ctx.stroke(); ctx.restore();
  }

  // ---------- préparation des images ----------
  function prepCard(img, width) {
    const ratio = img.height / img.width;
    // carte au format max 4:5, min 16:10
    const r = clamp(ratio, 0.62, 1.2);
    const w = width, h = Math.round(width * r);
    const c = mkCanvas(w, h), x = c.getContext('2d');
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    x.save(); roundRect(x, 0, 0, w, h, 34); x.clip();
    x.filter = 'contrast(1.07) saturate(1.1)';
    x.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    x.filter = 'none'; x.restore();
    x.lineWidth = 8; x.strokeStyle = '#ffffff'; roundRect(x, 4, 4, w - 8, h - 8, 31); x.stroke();
    return c;
  }
  function prepBg(img) {
    const c = mkCanvas(Math.round(W * 0.6), Math.round(H * 0.6)), x = c.getContext('2d');
    const s = Math.max(c.width / img.width, c.height / img.height) * 1.2;
    x.filter = 'blur(18px) brightness(0.5)';
    x.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s);
    return c;
  }
  function prepLogo(img, removeWhite) {
    const max = 700, s = Math.min(max / img.width, max / img.height, 4);
    const c = mkCanvas(Math.round(img.width * s), Math.round(img.height * s)), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, c.width, c.height);
    if (removeWhite) { // retire seulement le blanc relié aux bords (garde le blanc à l'intérieur du logo)
      const w = c.width, h = c.height, d = x.getImageData(0, 0, w, h), p = d.data;
      const seen = new Uint8Array(w * h), stack = [];
      const isBg = (i) => p[i * 4 + 3] > 0 && Math.min(p[i * 4], p[i * 4 + 1], p[i * 4 + 2]) > 225;
      for (let i = 0; i < w; i++) { stack.push(i, (h - 1) * w + i); }
      for (let j = 0; j < h; j++) { stack.push(j * w, j * w + w - 1); }
      while (stack.length) {
        const i = stack.pop();
        if (seen[i] || !isBg(i)) continue;
        seen[i] = 1; p[i * 4 + 3] = 0;
        const xx = i % w, yy = (i / w) | 0;
        if (xx > 0) stack.push(i - 1); if (xx < w - 1) stack.push(i + 1);
        if (yy > 0) stack.push(i - w); if (yy < h - 1) stack.push(i + w);
      }
      // adoucit le contour (pixels clairs voisins du fond retiré)
      for (let i = 0; i < w * h; i++) {
        if (seen[i]) continue;
        const xx = i % w, yy = (i / w) | 0;
        const nb = (xx > 0 && seen[i - 1]) || (xx < w - 1 && seen[i + 1]) || (yy > 0 && seen[i - w]) || (yy < h - 1 && seen[i + w]);
        if (nb) { const m = Math.min(p[i * 4], p[i * 4 + 1], p[i * 4 + 2]); if (m > 170) p[i * 4 + 3] = Math.min(p[i * 4 + 3], (235 - m) / 65 * 255); }
      }
      x.putImageData(d, 0, 0);
    }
    return c;
  }
  function badgeLogo(nom, accent, emoji) {
    const c = mkCanvas(600, 600), x = c.getContext('2d');
    x.fillStyle = accent; x.beginPath(); x.arc(300, 300, 290, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 14; x.beginPath(); x.arc(300, 300, 255, 0, Math.PI * 2); x.stroke();
    const ini = nom.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '★';
    x.fillStyle = lum(accent) > 0.6 ? DARK : WHITE; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = font(900, ini.length > 1 ? 250 : 300); x.fillText(ini, 300, 320);
    return c;
  }
  function vignette() {
    const c = mkCanvas(W, H), x = c.getContext('2d');
    const g = x.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.75)');
    x.fillStyle = g; x.fillRect(0, 0, W, H); return c;
  }
  function darkBg(accent) {
    const c = mkCanvas(W, H), x = c.getContext('2d');
    x.fillStyle = DARK; x.fillRect(0, 0, W, H);
    const g = x.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, 900);
    g.addColorStop(0, rgba(accent, 0.32)); g.addColorStop(1, rgba(accent, 0));
    x.fillStyle = g; x.fillRect(0, 0, W, H); return c;
  }
  function contactCard(D) {
    const rows = [['📞', D.phone], ['✉️', D.email], ['🌐', D.site], ['📍', D.adresse]].filter((r) => r[1] && r[1].trim());
    const cw = 900, head = 125, rowH = 112, ch = head + 40 + Math.max(rows.length, 1) * rowH;
    const c = mkCanvas(cw, ch), x = c.getContext('2d');
    x.fillStyle = 'rgba(24,27,34,0.97)'; roundRect(x, 0, 0, cw, ch, 44); x.fill();
    x.save(); roundRect(x, 0, 0, cw, ch, 44); x.clip(); x.fillStyle = D.accent; x.fillRect(0, 0, cw, head); x.restore();
    x.strokeStyle = D.accent; x.lineWidth = 5; roundRect(x, 2.5, 2.5, cw - 5, ch - 5, 42); x.stroke();
    x.fillStyle = D.accentText; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = font(900, fit(x, 'CONTACTEZ-NOUS', 900, 60, cw - 80)); x.letterSpacing = '0px'; x.fillText('CONTACTEZ-NOUS', cw / 2, head / 2 + 3);
    rows.forEach(([ic, val], i) => {
      const y = head + 40 + rowH * i + rowH / 2 - 15;
      x.fillStyle = 'rgba(255,255,255,0.08)'; x.beginPath(); x.arc(92, y, 42, 0, Math.PI * 2); x.fill();
      x.font = `46px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`; x.textAlign = 'center'; x.fillStyle = '#fff';
      x.fillText(ic, 92, y + 3);
      x.textAlign = 'left'; x.fillStyle = WHITE;
      const size = fit(x, val, i < 3 ? 800 : 600, i === 0 ? 54 : 44, cw - 220);
      x.font = font(i < 3 ? 800 : 600, size); x.fillText(val, 160, y + 2);
      if (i < rows.length - 1) { x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(160, y + 52, cw - 220, 2); }
    });
    return c;
  }

  // particules
  function makeParticles(seed) {
    const r = rng(seed + 11); const a = [];
    for (let i = 0; i < 60; i++) a.push([r() * 1800 - 900, r() * 2600 - 1300, r() * 2500]);
    return a;
  }
  function particles(ctx, P, t, color, alpha = 0.8) {
    ctx.save(); ctx.fillStyle = color;
    for (const [X, Y, Z] of P) {
      const z = ((Z - t * 500) % 2500 + 2500) % 2500 - 300, s = FOCAL / (FOCAL + z);
      const x = W / 2 + (X + Math.sin(t + Y) * 40) * s, y = H / 2 + (Y - t * 60) * s, r = 4 * s;
      ctx.globalAlpha = clamp(1 - z / 2500) * alpha;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  function gridFloor(ctx, t, horizon, accent, alpha) {
    ctx.save(); ctx.strokeStyle = accent; ctx.lineWidth = 2;
    const Yp = 520, off = (t * 600) % 200;
    for (let i = 0; i < 40; i++) {
      const Z = i * 200 - off; if (Z < -FOCAL * 0.7) continue;
      const s = FOCAL / (FOCAL + Z), y = horizon + Yp * s;
      ctx.globalAlpha = clamp(s * 1.2) * 0.45 * alpha;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.globalAlpha = 0.28 * alpha;
    for (let X = -4000; X <= 4000; X += 200) {
      const s0 = FOCAL / (FOCAL - 1000), s1 = FOCAL / (FOCAL + 8000);
      ctx.beginPath(); ctx.moveTo(W / 2 + X * s0, horizon + Yp * s0); ctx.lineTo(W / 2 + X * s1, horizon + Yp * s1); ctx.stroke();
    }
    ctx.restore();
  }
  function rays(ctx, t, accent, alpha) { // variante de fond : rayons qui tournent
    ctx.save(); ctx.translate(W / 2, H * 0.4); ctx.rotate(t * 0.15);
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      const g = ctx.createLinearGradient(0, 0, 0, -1400);
      g.addColorStop(0, rgba(accent, 0.13 * alpha)); g.addColorStop(1, rgba(accent, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-110, -1400); ctx.lineTo(110, -1400); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function parseStat(v) {
    const s = String(v).trim().replace(',', '.');
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    const dec = (s.split('.')[1] || '').replace(/\D.*/, '').length;
    return { n, dec, comma: String(v).includes(',') };
  }

  // =====================================================================
  // build(data, variant) -> projet vidéo prêt à dessiner
  // =====================================================================
  async function build(D0, variant) {
    const D = { ...D0 };
    const v = variant || 0;
    D.accentText = lum(D.accent) > 0.62 ? DARK : '#111';
    if (lum(D.accent) < 0.35) D.accentText = WHITE;
    const R = rng(v * 7 + 3);
    const photos = D.photos.length ? D.photos : [];
    if (!photos.length) throw new Error('Ajoute au moins 1 photo');
    const order = photos.map((_, i) => photos[(i + v) % photos.length]);
    const pick = (i) => order[i % order.length];
    const cards = [], bgs = [];
    for (let i = 0; i < Math.max(3, order.length); i++) { cards.push(prepCard(pick(i), 900)); bgs.push(prepBg(pick(i))); }
    const logo = D.logo ? prepLogo(D.logo, D.logoRemoveWhite) : badgeLogo(D.nom, D.accent, D.emoji);
    const contact = contactCard(D);
    const VIG = vignette(), BG = darkBg(D.accent), P = makeParticles(v);
    const mirror = v % 2 ? -1 : 1;
    const slogan = D.slogans[v % D.slogans.length];
    const bgStyle = v % 2 ? 'rays' : 'grid';
    const words = D.nom.trim().split(/\s+/);
    const nameA = words.length > 1 ? words.slice(0, -1).join(' ') : words[0];
    const nameB = words.length > 1 ? words[words.length - 1] : '';
    const services = D.services.filter((s) => s && s.trim()).slice(0, 5);
    const stats = D.stats.filter((s) => s && String(s[0]).trim()).slice(0, 3);
    const hasGallery = order.length >= 4;

    // ---- timeline (en temps) ----
    const scenes = [];
    let t0 = 0;
    const addScene = (name, beats) => { scenes.push({ name, start: t0, dur: beats * BEAT }); t0 += beats * BEAT; };
    addScene('intro', 6); addScene('hero', 8);
    if (hasGallery) addScene('gallery', 8);
    if (services.length) addScene('services', 8);
    addScene('offre', 8); addScene('cta', 14);
    const duration = t0;
    const hits = scenes.slice(1).map((s) => s.start);

    const beatPulse = (tg, amt) => { if (tg < scenes[0].dur) return 0; return amt * Math.exp(-(((tg - scenes[0].dur) % BEAT)) * 10); };

    function bgPhoto(ctx, i, t, z0, z1) {
      const b = bgs[i % bgs.length], s = lerp(z0, z1, t);
      const cw = b.width / s, ch = b.height / s;
      ctx.drawImage(b, (b.width - cw) / 2, (b.height - ch) / 2, cw, ch, 0, 0, W, H);
    }
    function bgDark(ctx, t, horizon) {
      ctx.drawImage(BG, 0, 0);
      if (bgStyle === 'grid') gridFloor(ctx, t, horizon, D.accent, clamp(t * 2));
      else rays(ctx, t, D.accent, clamp(t * 2));
    }
    function nameBlock(ctx, t, cx, y, size, tStart, alpha = 1) {
      const full = nameB ? nameA + ' ' + nameB : nameA;
      const s = fit(ctx, full, 900, size, 900, 2);
      ctx.font = font(900, s); ctx.letterSpacing = (2 * s / 100) + 'px';
      const wa = ctx.measureText(nameA).width, wb = nameB ? ctx.measureText(nameB).width : 0, gap = nameB ? s * 0.28 : 0;
      const total = wa + gap + wb, xa = cx - total / 2 + wa / 2, xb = cx + total / 2 - wb / 2;
      const pa = prog(t, tStart, 0.5), pb = prog(t, tStart + 0.2, 0.5);
      if (pa > 0) text(ctx, nameA, xa, y - (1 - eBack(pa)) * 120, { size: s, spacing: 2, alpha: clamp(pa * 3) * alpha });
      if (nameB && pb > 0) text(ctx, nameB, xb, y - (1 - eBack(pb)) * 120, { size: s, spacing: 2, color: D.accent, alpha: clamp(pb * 3) * alpha });
      return s;
    }

    // ---------- scènes ----------
    const S = {};
    S.intro = (ctx, t) => {
      bgDark(ctx, t, 1250);
      particles(ctx, P, t, D.accent, 0.7);
      const p = prog(t, 0.1, 0.9), push = eIn(prog(t, 2.55, 0.45));
      if (p > 0) {
        const g = ctx.createRadialGradient(W / 2, 700, 0, W / 2, 700, 420);
        g.addColorStop(0, rgba(D.accent, 0.45 * eOut(p))); g.addColorStop(1, rgba(D.accent, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 200, W, 1000);
        const lw = Math.min(460, 460 * logo.width / logo.height);
        if (v % 2 === 0) card3d(ctx, logo, W / 2, 700, lw * lerp(0.4, 1, eOut(p)), { ry: lerp(-100, 0, eBack(p, 1.3)) + Math.sin(t * 2) * 4 * p, rx: lerp(20, 0, eOut(p)), z: lerp(0, -1100, push), shadow: false });
        else card3d(ctx, logo, W / 2, 700, lw * lerp(2.5, 1, eOut(p)), { rz: lerp(-25, 0, eBack(p)), rx: Math.sin(t * 2) * 5, z: lerp(0, -1100, push), alpha: clamp(p * 3), shadow: false });
      }
      const al = 1 - push;
      nameBlock(ctx, t, W / 2, 1180, 150, 0.7, al * al);
      const pu = eOut(prog(t, 1.25, 0.5));
      if (pu > 0) { ctx.save(); ctx.globalAlpha = al; ctx.fillStyle = D.accent; roundRect(ctx, W / 2 - 280 * pu, 1290, 560 * pu, 10, 5); ctx.fill(); ctx.restore(); }
      const ts = fit(ctx, D.tag.toUpperCase(), 600, 38, 940, 6);
      const pt = prog(t, 1.45, 0.5);
      if (pt > 0) text(ctx, D.tag.toUpperCase(), W / 2, 1365 + (1 - eOut(pt)) * 30, { size: ts, weight: 600, spacing: 6, color: '#ddd', alpha: clamp(pt * 2) * al });
    };
    S.hero = (ctx, t, tg) => {
      bgPhoto(ctx, 0, t / 4, 1.0, 1.1);
      particles(ctx, P, t + 5, D.accent, 0.5);
      const p = prog(t, 0, 0.8), bp = beatPulse(tg, 0.015);
      card3d(ctx, cards[0], W / 2, 1060, 900 * (1 + bp), { rx: lerp(35, 6, eOut(p)) - t, ry: mirror * lerp(-25, 10, eOut(prog(t, 0, 4))), rz: mirror * lerp(-6, 0, eOut(p)), z: lerp(900, -80, eOut(p)) - t * 30, shine: prog(t, 0.6, 1.4) });
      const s1 = fit(ctx, slogan[0], 900, 150, 940);
      pop(ctx, slogan[0], W / 2, 430, t, 0.25, { size: s1 });
      highlight(ctx, slogan[1], W / 2, 590, t, 0.55, { size: 108, bg: D.accent, fg: D.accentText, maxW: 880 });
    };
    S.gallery = (ctx, t, tg) => {
      bgPhoto(ctx, 3, t / 4, 1.08, 1.0);
      particles(ctx, P, t + 7, D.accent, 0.5);
      pop(ctx, 'NOS', W / 2, 300, t, 0.15, { size: 120 });
      highlight(ctx, 'RÉALISATIONS', W / 2, 450, t, 0.35, { size: 104, bg: D.accent, fg: D.accentText });
      const list = cards.slice(0, 4);
      const n = Math.min(list.length, 4), per = 3.4 / n;
      for (let i = n - 1; i >= 0; i--) { // la plus récente au-dessus
        const pi = prog(t, 0.2 + i * per, 0.6);
        if (pi <= 0) continue;
        const later = clamp((t - (0.2 + (i + 1) * per)) / 0.6);
        const depth = i < n - 1 ? eOut(later) : 0;
        card3d(ctx, list[i], W / 2 + mirror * (lerp(900, 0, eOut(pi)) - depth * 120 * (i % 2 ? -1 : 1)), 1080 - depth * 60,
          760 * (1 - depth * 0.12), { ry: mirror * lerp(-80, (i % 2 ? 8 : -8), eBack(pi, 1.2)), rz: (i % 2 ? 4 : -4) * (1 - depth) + depth * (i % 2 ? 8 : -8), z: depth * 200, alpha: 1 - depth * 0.35, shine: prog(t, 0.4 + i * per, 1) });
      }
    };
    S.services = (ctx, t, tg) => {
      bgPhoto(ctx, 1, t / 4, 1.08, 1.0);
      particles(ctx, P, t + 9, D.accent, 0.5);
      const p = prog(t, 0, 0.9), bp = beatPulse(tg, 0.012);
      card3d(ctx, cards[1], W / 2 + mirror * lerp(700, 0, eOut(p)), 860, 780 * (1 + bp), { ry: mirror * (lerp(-70, -12, eBack(p, 1.2)) + Math.sin(t * 1.4) * 4), rx: 6, rz: mirror * lerp(8, 2, eOut(p)), z: lerp(300, 0, eOut(p)), shine: prog(t, 0.8, 1.3) });
      pop(ctx, 'NOS', W / 2, 250, t, 0.2, { size: 120 });
      highlight(ctx, 'SERVICES', W / 2, 395, t, 0.45, { size: 104, bg: D.accent, fg: D.accentText });
      const rowH = services.length > 4 ? 84 : 96, y0 = 1590 - (services.length - 1) * rowH;
      services.forEach((s, i) => {
        const pi = prog(t, 1.1 + i * 0.25, 0.45);
        if (pi <= 0) return;
        const y = y0 + i * rowH - 20, x = W / 2 + lerp(-600, 0, eOut(pi)) * mirror;
        ctx.save(); ctx.globalAlpha = clamp(pi * 2);
        ctx.fillStyle = 'rgba(20,22,28,0.86)'; roundRect(ctx, x - 380, y - rowH * 0.45, 760, rowH * 0.9, rowH * 0.45); ctx.fill();
        ctx.strokeStyle = rgba(D.accent, 0.7); ctx.lineWidth = 2; ctx.stroke();
        checkIcon(ctx, x - 380 + rowH * 0.45, y, rowH * 0.3, D.accent);
        const fs = fit(ctx, s, 800, 42, 620);
        text(ctx, s, x - 380 + rowH * 0.95, y + 1, { size: fs, weight: 800, align: 'left', shadow: false });
        ctx.restore();
      });
    };
    S.offre = (ctx, t, tg) => {
      bgPhoto(ctx, 2, t / 4, 1.0, 1.1);
      particles(ctx, P, t + 13, D.accent, 0.5);
      const p = prog(t, 0, 0.8), bp = beatPulse(tg, 0.012);
      card3d(ctx, cards[2], W / 2, stats.length ? 980 : 1080, 840 * (1 + bp), { rx: lerp(-50, -8, eBack(p, 1.1)) + Math.sin(t * 1.2) * 2, ry: mirror * lerp(15, -6, eOut(prog(t, 0, 4))), z: lerp(600, 0, eOut(p)), shine: prog(t, 0.7, 1.3) });
      const s1 = fit(ctx, D.offre[0], 900, 118, 940);
      pop(ctx, D.offre[0], W / 2, 320, t, 0.2, { size: s1 });
      if (D.offre[1]) highlight(ctx, D.offre[1], W / 2, 470, t, 0.5, { size: 108, bg: D.accent, fg: D.accentText, maxW: 880 });
      const n = stats.length, bw = n === 3 ? 300 : 360, gap = 30;
      stats.forEach(([val, pre, suf, lab], i) => {
        const t1 = 1.0 + i * 0.25, pi = prog(t, t1, 0.45);
        if (pi <= 0) return;
        const x = W / 2 + (i - (n - 1) / 2) * (bw + gap), y = 1500 + (1 - eOut(pi)) * 80, sc = lerp(0.7, 1, eBack(pi));
        ctx.save(); ctx.globalAlpha = clamp(pi * 2.5); ctx.translate(x, y); ctx.scale(sc, sc);
        ctx.fillStyle = 'rgba(16,18,24,0.9)'; roundRect(ctx, -bw / 2, -105, bw, 210, 30); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2; ctx.stroke();
        const ps = parseStat(val), cnt = eOut(prog(t, t1, 1.2));
        let num = String(val);
        if (ps) { const cur = ps.n * cnt; num = cur.toFixed(ps.dec); if (ps.comma) num = num.replace('.', ','); }
        const label = (pre || '') + num + (suf || '');
        const fs = fit(ctx, label, 900, 74, bw - 30);
        text(ctx, label, 0, -20, { size: fs, color: D.accent, shadow: false });
        const ls = fit(ctx, lab, 600, 32, bw - 24);
        text(ctx, lab, 0, 55, { size: ls, weight: 600, color: '#e2e2e2', shadow: false });
        ctx.restore();
      });
    };
    S.cta = (ctx, t, tg) => {
      bgDark(ctx, t + 3, 1300);
      particles(ctx, P, t + 20, D.accent, 0.7);
      const pl = prog(t, 0, 0.7);
      const lh = 190, lw = lh * logo.width / logo.height;
      // logo + nom en haut
      const full = nameB ? nameA + ' ' + nameB : nameA;
      const twoLines = !!nameB;
      const ns = fit(ctx, twoLines ? (nameA.length > nameB.length ? nameA : nameB) : full, 900, 112, 900 - lw - 60, 2);
      ctx.font = font(900, ns); ctx.letterSpacing = (2 * ns / 100) + 'px';
      const tw = Math.max(ctx.measureText(nameA).width, nameB ? ctx.measureText(nameB).width : 0);
      const blockW = lw + 40 + tw, lx = W / 2 - blockW / 2 + lw / 2, tx = W / 2 - blockW / 2 + lw + 40;
      card3d(ctx, logo, lx, 330, lw * (1 + beatPulse(tg, 0.05)), { ry: lerp(-90, 0, eBack(pl)) + Math.sin(t * 2.2) * 12, rx: 5, shadow: false, alpha: clamp(pl * 3) });
      const pa = prog(t, 0.15, 0.45), pb = prog(t, 0.3, 0.45);
      if (twoLines) {
        if (pa > 0) text(ctx, nameA, tx, 280 + (1 - eOut(pa)) * 40, { size: ns, align: 'left', spacing: 2, alpha: clamp(pa * 2.5) });
        if (pb > 0) text(ctx, nameB, tx, 280 + ns * 1.02 + (1 - eOut(pb)) * 40, { size: ns, align: 'left', spacing: 2, color: D.accent, alpha: clamp(pb * 2.5) });
      } else if (pa > 0) text(ctx, full, tx, 330, { size: ns, align: 'left', spacing: 2, alpha: clamp(pa * 2.5) });
      // carte contact
      const pc = prog(t, 0.4, 0.9);
      const cardTop = 560, cardH = contact.height * 900 / contact.width;
      if (pc > 0) card3d(ctx, contact, W / 2, cardTop + cardH / 2 + lerp(500, 0, eOut(pc)), 900, { rx: lerp(60, 0, eBack(pc, 1.2)) + Math.sin(t * 1.3) * 3, ry: Math.sin(t * 0.9) * 6, z: lerp(400, 0, eOut(pc)), alpha: clamp(pc * 2), shine: t < 3.2 ? prog(t, 1.4, 1.6) : prog(t, 4.0, 1.6) });
      // bouton
      const by = Math.min(cardTop + cardH + 130, 1420);
      const pbt = prog(t, 1.3, 0.5);
      if (pbt > 0) {
        const pulse = beatPulse(tg, 0.06), sc = lerp(0.6, 1, eBack(pbt)) + pulse;
        ctx.save(); ctx.globalAlpha = clamp(pbt * 2); ctx.translate(W / 2, by + (1 - eOut(pbt)) * 60); ctx.scale(sc, sc);
        ctx.shadowColor = rgba(D.accent, 0.5 + pulse * 6); ctx.shadowBlur = 50;
        ctx.fillStyle = D.accent; roundRect(ctx, -410, -65, 820, 130, 65); ctx.fill();
        ctx.shadowColor = 'transparent';
        const cs = fit(ctx, D.cta.toUpperCase(), 900, 58, 740);
        text(ctx, D.cta.toUpperCase(), 0, 3, { size: cs, color: D.accentText, shadow: false });
        ctx.restore();
      }
      const pi = prog(t, 1.9, 0.5);
      if (pi > 0 && D.insta && D.insta.trim()) {
        const ig = 'Suivez-nous  ' + D.insta.trim();
        text(ctx, ig, W / 2, by + 150, { size: fit(ctx, ig, 600, 42, 900), weight: 600, color: '#e6e6e6', alpha: clamp(pi * 2) });
      }
    };

    function drawFrame(ctx, tg) {
      let idx = scenes.findIndex((s) => tg < s.start + s.dur);
      if (idx < 0) idx = scenes.length - 1;
      const sc = scenes[idx], t = tg - sc.start;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
      ctx.fillStyle = DARK; ctx.fillRect(0, 0, W, H);
      ctx.save();
      if (idx > 0) { // zoom « punch » à chaque changement de scène
        const z = lerp(1.12, 1, eOut(prog(t, 0, 0.35)));
        ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
      }
      S[sc.name](ctx, t, tg);
      ctx.restore();
      ctx.drawImage(VIG, 0, 0);
      // flash blanc
      if (idx > 0 && t < 0.2) { ctx.fillStyle = `rgba(255,255,255,${Math.pow(1 - t / 0.2, 2) * 0.85})`; ctx.fillRect(0, 0, W, H); }
      // fondu début / fin
      if (tg < 0.25) { ctx.fillStyle = `rgba(0,0,0,${1 - tg / 0.25})`; ctx.fillRect(0, 0, W, H); }
      if (tg > duration - 0.6) { ctx.fillStyle = `rgba(0,0,0,${clamp((tg - (duration - 0.6)) / 0.6)})`; ctx.fillRect(0, 0, W, H); }
    }

    const music = window.makeMusic({ style: D.music, seed: v + 1 + (D.musicSeed || 0), duration, bpm: BPM, dropAt: scenes[0].dur, hits });
    return { W, H, FPS, duration, drawFrame, music, scenes };
  }

  // ---------- export MP4 ----------
  async function pickVideoCodec() {
    for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.420028']) {
      const cfg = { codec, width: W, height: H, bitrate: 10_000_000, framerate: FPS, avc: { format: 'avc' } };
      try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return cfg; } catch (e) { /* suivant */ }
    }
    throw new Error("Ton navigateur ne sait pas encoder en H.264. Utilise Chrome ou Edge à jour.");
  }
  async function pickAudioCodec() {
    if (!window.AudioEncoder) return null;
    const tries = [['mp4a.40.2', 'aac'], ['opus', 'opus']];
    for (const [codec, name] of tries) {
      const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
      try { const r = await AudioEncoder.isConfigSupported(cfg); if (r.supported) return { cfg, name }; } catch (e) { /* suivant */ }
    }
    return null;
  }

  async function renderMp4(project, onProgress) {
    if (!window.VideoEncoder) throw new Error("Export impossible : utilise Chrome ou Edge sur PC (WebCodecs).");
    const vcfg = await pickVideoCodec();
    const acodec = await pickAudioCodec();
    const mux = new window.Mp4Writer({ width: W, height: H, fps: FPS, audio: acodec ? { codec: acodec.name, sampleRate: 48000, channels: 2 } : null });
    let err = null;
    const venc = new VideoEncoder({ output: (c, m) => mux.addVideo(c, m), error: (e) => { err = e; } });
    venc.configure(vcfg);
    const canvas = mkCanvas(W, H), ctx = canvas.getContext('2d', { alpha: false });
    const total = Math.round(project.duration * FPS);
    for (let i = 0; i < total; i++) {
      if (err) throw err;
      project.drawFrame(ctx, i / FPS);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      venc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      if (i % 5 === 0) { onProgress && onProgress(i / total * 0.92); await new Promise((r) => setTimeout(r, 0)); }
    }
    await venc.flush(); venc.close();
    if (err) throw err;
    if (acodec) {
      const aenc = new AudioEncoder({ output: (c, m) => mux.addAudio(c, m), error: (e) => { err = e; } });
      aenc.configure(acodec.cfg);
      const { left, right, sampleRate } = project.music, step = 1024;
      for (let i = 0; i < left.length; i += step) {
        const n = Math.min(step, left.length - i), buf = new Float32Array(n * 2);
        buf.set(left.subarray(i, i + n), 0); buf.set(right.subarray(i, i + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / sampleRate * 1e6), data: buf });
        aenc.encode(ad); ad.close();
      }
      await aenc.flush(); aenc.close();
      if (err) throw err;
    }
    onProgress && onProgress(1);
    return mux.finish();
  }

  // ---------- aperçu en temps réel ----------
  let previewStop = null;
  function preview(canvas, project) {
    if (previewStop) previewStop();
    const ctx = canvas.getContext('2d', { alpha: false });
    canvas.width = W; canvas.height = H;
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ac.createBuffer(2, project.music.left.length, project.music.sampleRate);
    buf.copyToChannel(project.music.left, 0); buf.copyToChannel(project.music.right, 1);
    const src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination);
    const start = ac.currentTime + 0.1; src.start(start);
    let raf, stopped = false;
    const loop = () => {
      if (stopped) return;
      const t = ac.currentTime - start;
      project.drawFrame(ctx, clamp(t, 0, project.duration - 1 / FPS));
      if (t < project.duration) raf = requestAnimationFrame(loop); else stop();
    };
    const stop = () => { stopped = true; cancelAnimationFrame(raf); try { src.stop(); } catch (e) { /* déjà stoppé */ } ac.close(); previewStop = null; };
    previewStop = stop;
    raf = requestAnimationFrame(loop);
    return stop;
  }

  window.VideoEngine = { build, renderMp4, preview, W, H, FPS };
})();
