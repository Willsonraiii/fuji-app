/* =====================================================================
   test/exif-fixture.js — builds a real, spec-shaped JPEG with an
   APP1/Exif TIFF block in memory (little- or big-endian, optional GPS).

   The parser under test must agree with the byte layout cameras actually
   write, so this builds from tag specs instead of mirroring the parser.
   ===================================================================== */
'use strict';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/* entry shapes:
   { tag, short }                 → one uint16 written inline in the value field
   { tag, long }                  → one uint32 written inline
   { tag, str }                   → ASCII (NUL-terminated, out of line)
   { tag, rationals: [[n,d],…] }  → RATIONAL (type 5) out of line (or signed: SRATIONAL type 10)
   { tag, sshort }                → int16 inline
   { tag, gpsPtr: true } / { tag, exifPtr: true } → filled by the builder
*/
function build(entries, { little = true } = {}) {
  const out = [];
  const u16 = (v) => out.push(little ? v & 255 : (v >> 8) & 255, little ? (v >> 8) & 255 : v & 255);
  const u32 = (v) => {
    v >>>= 0;
    if (little) out.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
    else out.push((v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
  };
  const s16 = (v) => u16(v < 0 ? 0x10000 + v : v);
  const s32 = (v) => u32(v < 0 ? 0x100000000 + v : v);


  const size = (e) => {
    if (e.rationals) return e.rationals.length * 8;
    if (e.srationals) return e.srationals.length * 8;
    if (e.str != null) return e.str.length + 1;
    if (e.bytes != null) return e.bytes.length;
    return 0;                                   // inline value
  };
  const valueBytes = (e) => {
    const b = [];
    const push16 = (v) => b.push(little ? v & 255 : (v >> 8) & 255, little ? (v >> 8) & 255 : v & 255);
    const push32 = (v) => {
      v >>>= 0;
      if (little) b.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
      else b.push((v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
    };
    const pushRats = (list, signed) => { for (const [n, d] of list) { push32(n); push32(d); } void signed; };
    if (e.rationals) pushRats(e.rationals, false);
    else if (e.srationals) pushRats(e.srationals, true);
    else if (e.str != null) { for (const ch of e.str) b.push(ch.charCodeAt(0)); b.push(0); while (b.length < size(e)) b.push(0); }
    else if (e.bytes != null) { b.push(...e.bytes); while (b.length < size(e)) b.push(0); }
    return b;
  };

  const ifd0 = entries.filter(e => (e.scope || 'main') === 'main');
  const exif = entries.filter(e => e.scope === 'exif');
  const gps = entries.filter(e => e.scope === 'gps');

  const ifdBytes = (n) => 2 + n * 12 + 4;
  const HDR = 8;
  const ifd0Off = HDR;
  const exifOff = ifd0Off + ifdBytes(ifd0.length);
  const gpsOff = exifOff + ifdBytes(exif.length);
  let dataStart = gpsOff + ifdBytes(gps.length);

  // assign out-of-line offsets (2-byte aligned, as readers expect)
  const place = (list) => {
    for (const e of list) {
      const n = size(e);
      // TIFF rule real writers follow: a value that fits in 4 bytes lives
      // inline in the entry, anything bigger is a pointer to out-of-line data
      if (!n || n <= 4) {
        e.__off = null;
        e.__inline = n ? valueBytes(e) : null;
        continue;
      }
      e.__off = dataStart;
      dataStart += n + (n % 2);
    }
  };
  // sub-IFD pointers are known only now that the layout is computed
  for (const e of ifd0) {
    if (e.__exifPtr) e.long = exifOff;
    if (e.__gpsPtr) e.long = gpsOff;
  }
  place(ifd0); place(exif); place(gps);

  const emitIFD = (list) => {
    u16(list.length);
    for (const e of list) {
      const type = e.type != null ? e.type : (e.str != null ? 2 : e.rationals ? 5 : e.srationals ? 10 : e.short != null ? 3 : 4);
      const count = e.count != null ? e.count : (e.str != null ? e.str.length + 1 : (e.rationals || e.srationals || e.bytes)?.length || 1);
      u16(e.tag); u16(type); u32(count);
      if (e.__off == null) {                       // fits in the 4-byte value field
        if (e.__inline) { const b = e.__inline; for (let i = 0; i < 4; i++) out.push(b[i] || 0); }
        else if (e.short != null) { s16(e.short); u16(0); }
        else s32(e.long);
      } else u32(e.__off);                        // offsets are TIFF-relative
    }
    u32(0);                                        // no next IFD
  };

  // ---- header ----
  if (little) out.push(0x49, 0x49); else out.push(0x4D, 0x4D);
  u16(0x2A);
  u32(ifd0Off);
  emitIFD(ifd0);
  if (exif.length) emitIFD(exif);
  if (gps.length) emitIFD(gps);
  // payload area: reserve the remaining bytes, then stamp each value at the
  // exact offset the IFD entry points to
  const payloads = [...ifd0, ...exif, ...gps].filter(e => e.__off != null && e.__inline == null).sort((a, b) => a.__off - b.__off);
  for (let i = out.length; i < dataStart; i++) out.push(0);
  for (const e of payloads) {
    const b = valueBytes(e);
    for (let i = 0; i < b.length; i++) out[e.__off + i] = b[i];
  }
  if (out.length !== dataStart) throw new Error(`fixture layout error: wrote ${out.length} bytes, expected ${dataStart}`);
  return Uint8Array.from(out);
}

function wrapJpeg(tiff) {
  /* APP1 segment = length(2) + "Exif\0\0"(6) + tiff; the 16-bit length
     field counts itself, so it is 8 + tiff. */
  const payload = tiff.length + 8;
  const out = [0xFF, 0xD8, 0xFF, 0xE1, (payload >> 8) & 255, payload & 255,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff, 0xFF, 0xD9];
  return Uint8Array.from(out);
}

function toArrayBuffer(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

/* A typical iPhone/Fuji capture, with GPS. */
function sampleExif({ big = false, gps = true, iso = 1600, orientation = 6, flash = 0 } = {}) {
  const entries = [
    { tag: 0x010F, str: 'Fujifilm' },
    { tag: 0x0110, str: 'X-T5' },
    { tag: 0x0112, short: orientation },
    { tag: 0x0132, str: '2026:08:14 09:12:33' },
    { tag: 0x8769, long: 0, __exifPtr: true },
    gps ? { tag: 0x8825, long: 0, __gpsPtr: true } : null,
    // Exif sub-IFD
    { tag: 0x8827, short: iso, scope: 'exif' },
    { tag: 0x829D, rationals: [[28, 10]], scope: 'exif' },
    { tag: 0x829A, rationals: [[1, 250]], scope: 'exif' },
    { tag: 0x920A, rationals: [[23, 1]], scope: 'exif' },
    { tag: 0xA405, short: 35, scope: 'exif' },
    { tag: 0x9204, srationals: [[-5, 10]], scope: 'exif' },
    { tag: 0x9209, short: flash, scope: 'exif' },
    { tag: 0xA434, str: 'XF 23mm F2', scope: 'exif' },
    // GPS
    { tag: 0x0001, bytes: [0x4E, 0x00], count: 2, type: 2, scope: 'gps' },
    { tag: 0x0002, rationals: [[35, 1], [39, 1], [0, 1]], scope: 'gps' },
    { tag: 0x0003, bytes: [0x57, 0x00], count: 2, type: 2, scope: 'gps' },
    { tag: 0x0004, rationals: [[139, 1], [44, 1], [0, 1]], scope: 'gps' },
    { tag: 0x0006, rationals: [[6400, 10]], scope: 'gps' }
  ].filter(Boolean);
  const tiff = build(entries, { little: !big });
  return { jpeg: wrapJpeg(tiff), entries };
}

module.exports = { build, wrapJpeg, toArrayBuffer, sampleExif };
