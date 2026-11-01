// Mini « muxer » MP4 : assemble la vidéo H.264 et l'audio AAC/Opus (WebCodecs) en un fichier .mp4.
(function () {
  const enc = new TextEncoder();
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function u16(n) { return [(n >>> 8) & 255, n & 255]; }
  function str(s) { return Array.from(enc.encode(s)); }
  function concat(parts) {
    let len = 0; for (const p of parts) len += p.length;
    const out = new Uint8Array(len); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function box(type, ...content) {
    const parts = content.map((c) => (c instanceof Uint8Array ? c : new Uint8Array(c)));
    const body = concat(parts);
    return concat([new Uint8Array([...u32(body.length + 8), ...str(type)]), body]);
  }
  function fullbox(type, version, flags, ...content) {
    return box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...content);
  }
  const MATRIX = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0];

  function sttsEntries(deltas) {
    const e = [];
    for (const d of deltas) { if (e.length && e[e.length - 1][1] === d) e[e.length - 1][0]++; else e.push([1, d]); }
    return e;
  }
  function stbl(sampleEntry, deltas, sizes, keyIdx, chunkOffset) {
    const st = sttsEntries(deltas);
    const parts = [
      fullbox('stsd', 0, 0, u32(1), sampleEntry),
      fullbox('stts', 0, 0, u32(st.length), ...st.map(([c, d]) => [...u32(c), ...u32(d)])),
    ];
    if (keyIdx) parts.push(fullbox('stss', 0, 0, u32(keyIdx.length), ...keyIdx.map((k) => u32(k + 1))));
    parts.push(fullbox('stsc', 0, 0, u32(1), u32(1), u32(sizes.length), u32(1)));
    parts.push(fullbox('stsz', 0, 0, u32(0), u32(sizes.length), ...sizes.map(u32)));
    parts.push(fullbox('stco', 0, 0, u32(1), u32(chunkOffset)));
    return box('stbl', ...parts);
  }
  function dinf() { return box('dinf', fullbox('dref', 0, 0, u32(1), fullbox('url ', 0, 1))); }

  function descr(tag, bytes) { // descripteur MPEG-4 (taille sur 4 octets)
    const n = bytes.length;
    return [tag, 0x80 | ((n >> 21) & 127), 0x80 | ((n >> 14) & 127), 0x80 | ((n >> 7) & 127), n & 127, ...bytes];
  }

  function toU8(d) { return d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice(); }

  class Mp4Writer {
    constructor({ width, height, fps, audio }) {
      this.w = width; this.h = height; this.fps = fps;
      this.audio = audio; // { codec: 'aac'|'opus', sampleRate, channels } ou null
      this.v = []; this.a = []; this.avcC = null; this.asc = null;
    }
    addVideo(chunk, meta) {
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.avcC) this.avcC = toU8(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      this.v.push({ data, ts: chunk.timestamp, dur: chunk.duration, key: chunk.type === 'key' });
    }
    addAudio(chunk, meta) {
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.asc) this.asc = toU8(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      this.a.push({ data, ts: chunk.timestamp, dur: chunk.duration });
    }
    finish() {
      if (!this.avcC) throw new Error('Configuration H.264 manquante');
      const VTS = 90000;
      this.v.sort((x, y) => x.ts - y.ts);
      const vd = this.v.map((s, i) => {
        const next = this.v[i + 1];
        const us = next ? next.ts - s.ts : (s.dur || 1e6 / this.fps);
        return Math.max(1, Math.round(us * VTS / 1e6));
      });
      const vSizes = this.v.map((s) => s.data.length);
      const keys = []; this.v.forEach((s, i) => { if (s.key) keys.push(i); });
      const vDurTs = vd.reduce((a, b) => a + b, 0);
      const durMs = Math.round(vDurTs / VTS * 1000);

      let aSizes = [], ad = [], ATS = 48000;
      if (this.audio && this.a.length) {
        ATS = this.audio.sampleRate;
        this.a.sort((x, y) => x.ts - y.ts);
        ad = this.a.map((s, i) => {
          const next = this.a[i + 1];
          const us = s.dur || (next ? next.ts - s.ts : 1024 / ATS * 1e6);
          return Math.max(1, Math.round(us * ATS / 1e6));
        });
        aSizes = this.a.map((s) => s.data.length);
      }
      const hasAudio = aSizes.length > 0;

      const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));

      const build = (vOff, aOff) => {
        const avc1 = box('avc1', [0, 0, 0, 0, 0, 0], u16(1), new Array(16).fill(0), u16(this.w), u16(this.h),
          u32(0x00480000), u32(0x00480000), u32(0), u16(1), new Array(32).fill(0), u16(0x18), u16(0xffff),
          box('avcC', this.avcC));
        const vtrak = box('trak',
          fullbox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(durMs), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(this.w << 16), u32(this.h << 16)),
          box('mdia',
            fullbox('mdhd', 0, 0, u32(0), u32(0), u32(VTS), u32(vDurTs), u16(0x55c4), u16(0)),
            fullbox('hdlr', 0, 0, u32(0), str('vide'), u32(0), u32(0), u32(0), str('VideoHandler'), [0]),
            box('minf', fullbox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)), dinf(), stbl(avc1, vd, vSizes, keys, vOff))));
        const traks = [vtrak];
        if (hasAudio) {
          const ch = this.audio.channels, sr = this.audio.sampleRate;
          let entry;
          if (this.audio.codec === 'aac') {
            const asc = this.asc || new Uint8Array([0x11, 0x90]); // AAC-LC 48 kHz stéréo
            const dec = [0x40, 0x15, 0, 0, 0, ...u32(192000), ...u32(192000), ...descr(5, Array.from(asc))];
            const es = [...u16(2), 0, ...descr(4, dec), ...descr(6, [2])];
            entry = box('mp4a', [0, 0, 0, 0, 0, 0], u16(1), u32(0), u32(0), u16(ch), u16(16), u16(0), u16(0), u32(sr << 16),
              fullbox('esds', 0, 0, descr(3, es)));
          } else {
            const dops = box('dOps', [0, ch], u16(312), u32(sr), u16(0), [0]);
            entry = box('Opus', [0, 0, 0, 0, 0, 0], u16(1), u32(0), u32(0), u16(ch), u16(16), u16(0), u16(0), u32(sr << 16), dops);
          }
          const aDurTs = ad.reduce((a, b) => a + b, 0);
          traks.push(box('trak',
            fullbox('tkhd', 0, 3, u32(0), u32(0), u32(2), u32(0), u32(Math.round(aDurTs / sr * 1000)), u32(0), u32(0), u16(0), u16(0), u16(0x0100), u16(0), MATRIX, u32(0), u32(0)),
            box('mdia',
              fullbox('mdhd', 0, 0, u32(0), u32(0), u32(sr), u32(aDurTs), u16(0x55c4), u16(0)),
              fullbox('hdlr', 0, 0, u32(0), str('soun'), u32(0), u32(0), u32(0), str('SoundHandler'), [0]),
              box('minf', fullbox('smhd', 0, 0, u16(0), u16(0)), dinf(), stbl(entry, ad, aSizes, null, aOff)))));
        }
        const mvhd = fullbox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(durMs), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0), MATRIX, new Array(24).fill(0), u32(hasAudio ? 3 : 2));
        return box('moov', mvhd, ...traks);
      };

      // 1er passage pour connaître la taille de moov, puis offsets réels
      const moovSize = build(0, 0).length;
      const mdatHeader = 8;
      const vOff = ftyp.length + moovSize + mdatHeader;
      const vBytes = vSizes.reduce((a, b) => a + b, 0);
      const aOff = vOff + vBytes;
      const moov = build(vOff, aOff);
      const aBytes = aSizes.reduce((a, b) => a + b, 0);
      const mdatHead = new Uint8Array([...u32(mdatHeader + vBytes + aBytes), ...str('mdat')]);
      const parts = [ftyp, moov, mdatHead, ...this.v.map((s) => s.data), ...(hasAudio ? this.a.map((s) => s.data) : [])];
      return new Blob(parts, { type: 'video/mp4' });
    }
  }
  window.Mp4Writer = Mp4Writer;
})();
