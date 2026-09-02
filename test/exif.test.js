/* =====================================================================
   test/exif.test.js — the on-device EXIF reader.

   This parser was silently dead: it looked for the "Exif\0\0" marker at the
   wrong offset (off+4 instead of off+2) and compared an ArrayBuffer to a
   string with ===, so parseEXIFBuffer() returned null for every real JPEG.
   Camera/ISO metadata and every ISO-driven auto tweak were therefore no-ops.
   ===================================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, run, ok, eq, near, assert } = require('./harness');
const { ROOT } = require('./app');
const fixture = require('./exif-fixture');

function loadContext(extra = {}) {
  const src = fs.readFileSync(path.join(ROOT, 'js/context.js'), 'utf8');
  const sandbox = Object.assign({ console, Uint8Array, Float32Array, DataView, document: undefined }, extra);
  vm.createContext(sandbox);
  sandbox.window = sandbox;                       // same global the <script> would see
  vm.runInContext(src, sandbox, { filename: 'js/context.js' });
  return sandbox.FUJI.context;
}
const ctx = loadContext();

test('parses a real APP1/Exif JPEG (little-endian)', () => {
  const { jpeg } = fixture.sampleExif();
  const exif = ctx.parseEXIFBuffer(fixture.toArrayBuffer(jpeg));
  assert.ok(exif, 'parseEXIFBuffer returned null — EXIF is not being read at all');
  eq(exif.make, 'Fujifilm');
  eq(exif.model, 'X-T5');
  eq(exif.iso, 1600, 'ISO should come from Exif IFD tag 0x8827');
  eq(exif.lens, 'XF 23mm F2', 'LensModel (0xA434) should be read from the Exif sub-IFD');
  eq(exif.orientation, 6, 'Orientation (0x0112)');
  eq(exif.dateTime, '2026:08:14 09:12:33');
});

test('decodes rationals (f-number, shutter, focal length, bias)', () => {
  const { jpeg } = fixture.sampleExif();
  const exif = ctx.parseEXIFBuffer(fixture.toArrayBuffer(jpeg));
  near(exif.fnumber, 2.8, 1e-9, 'FNumber 28/10');
  near(exif.exposureTime, 1 / 250, 1e-9, 'ExposureTime 1/250');
  near(exif.focalLength, 23, 1e-9, 'FocalLength 23/1');
  eq(exif.focalLength35, 35);
  near(exif.exposureBias, -0.5, 1e-9, 'ExposureBias is SRATIONAL -5/10');
});

test('decodes GPS coordinates with hemisphere signs', () => {
  const { jpeg } = fixture.sampleExif();
  const exif = ctx.parseEXIFBuffer(fixture.toArrayBuffer(jpeg));
  near(exif.gpsLat, 35 + 39 / 60, 1e-9, 'lat 35°39\'N');
  near(exif.gpsLon, -(139 + 44 / 60), 1e-9, 'lon 139°44\'W should be negative');
  near(exif.gpsAlt, 640, 1e-9, 'altitude 6400/10 m');
});

test('big-endian TIFF is parsed too', () => {
  const { jpeg } = fixture.sampleExif({ big: true });
  const exif = ctx.parseEXIFBuffer(fixture.toArrayBuffer(jpeg));
  assert.ok(exif, 'Motorola (MM) byte order must not be ignored');
  eq(exif.model, 'X-T5');
  near(exif.fnumber, 2.8, 1e-9);
});

test('rejects non-JPEG and truncated input instead of throwing', () => {
  const junk = fixture.toArrayBuffer(Uint8Array.from(Array.from({ length: 64 }, (_, i) => i)));
  eq(ctx.parseEXIFBuffer(junk), null, 'random bytes must yield null');
  const { jpeg } = fixture.sampleExif();
  eq(ctx.parseEXIFBuffer(jpeg.subarray(0, 40).buffer.slice(0, 40)), null, 'truncated APP1 must yield null, not throw');
  eq(ctx.parseEXIFBuffer(new ArrayBuffer(0)), null);
});

test('a segment shorter than its declared length cannot read past the buffer', () => {
  // length field claims 4096 bytes but the file ends immediately
  const bad = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE1, 0x10, 0x00, 0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3]);
  eq(ctx.parseEXIFBuffer(fixture.toArrayBuffer(bad)), null);
});

test('exifSummary renders a camera line the UI can show', () => {
  const { jpeg } = fixture.sampleExif();
  const exif = ctx.parseEXIFBuffer(fixture.toArrayBuffer(jpeg));
  const line = ctx.exifSummary(exif);
  ok(/Fujifilm X-T5/.test(line), `camera missing: ${line}`);
  ok(/ISO 1600/.test(line), `ISO missing: ${line}`);
  ok(/23mm/.test(line), `focal length missing: ${line}`);
  ok(/f\/2\.8/.test(line), `aperture missing: ${line}`);
  ok(/1\/250s/.test(line), `shutter missing: ${line}`);
  eq(ctx.exifSummary(null), '', 'null EXIF must degrade to an empty line');
});

test('readEXIF works on a Blob-backed File (the async path main.js uses)', async () => {
  const { jpeg } = fixture.sampleExif();
  class FakeBlob {
    constructor(u8) { this.__u8 = u8; this.size = u8.length; this.type = 'image/jpeg'; }
    slice(a, b) { return new FakeBlob(this.__u8.slice(a, b == null ? this.__u8.length : b)); }
  }
  class FakeFileReader {
    readAsArrayBuffer(blob) {
      Promise.resolve().then(() => {
        const u = blob.__u8;
        this.result = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
        this.onload({ target: this });
      });
    }
  }
  const C = loadContext({ Blob: FakeBlob, FileReader: FakeFileReader });
  const exif = await C.readEXIF(new FakeBlob(jpeg));
  assert.ok(exif, 'readEXIF(File) returned null');
  eq(exif.model, 'X-T5');
  eq(exif.iso, 1600);
  const noBlob = await C.readEXIF(null);
  eq(noBlob, null, 'readEXIF(null) must resolve null, not reject');
});

test('autoAdjust reacts to high ISO only once EXIF actually parses', () => {
  const { jpeg } = fixture.sampleExif({ iso: 6400 });
  const exif = ctx.parseEXIFBuffer(fixture.toArrayBuffer(jpeg));
  const scene = { tags: ['night'], fracs: {}, lum: {} };
  const out = ctx.autoAdjust(exif, scene);
  ok(out.tweaks.noise >= 0.8, `high ISO should raise NR, got ${out.tweaks.noise}`);
  ok('shadows' in out.tweaks && 'exposure' in out.tweaks, 'night scene should lift shadows/exposure');
  const low = ctx.autoAdjust({ ...exif, iso: 160 }, scene);
  ok(!low.tweaks.noise || low.tweaks.noise <= 0.4, 'base ISO should not get heavy NR');
});

test('isFujiX identifies Fuji bodies from Make', () => {
  const { jpeg } = fixture.sampleExif();
  const exif = ctx.parseEXIFBuffer(fixture.toArrayBuffer(jpeg));
  ok(ctx.isFujiX(exif), 'FUJIFILM X-T5 should be recognised as a Fuji body');
  ok(!ctx.isFujiX({ make: 'Apple' }), 'non-Fuji make must be rejected');
  ok(!ctx.isFujiX(null), 'null EXIF must not throw');
});

run();
