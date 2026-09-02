/* =====================================================================
   F-UJI context.js — on-device image-adaptive context.
   - Parses EXIF (camera, lens, ISO, focal, GPS, datetime) from JPEG/TIFF
   - Pixel scene analysis: sky / skin / foliage / night / underexposed
   - On-device only — never uploads. Exposes a scene-tags + EXIF blob
     on App.context so the recipe browser can suggest matches.
   ===================================================================== */
(function (global) {
  "use strict";

  /* -------- EXIF parser (JPEG / TIFF, segment walker) -------- */
  /* JPEG APP1 layout, relative to `off` (the position of the 2-byte segment length):
       off+0  length (includes these 2 bytes)
       off+2  "Exif\0\0"
       off+8  TIFF block (header, IFDs, value data)                       */
  function readEXIF(file){
    return new Promise((resolve) => {
      if(!file || !(file instanceof Blob)) return resolve(null);
      const slice = file.slice ? file.slice(0, 512*1024) : file;
      const r = new FileReader();
      r.onload = () => {
        try { resolve(parseEXIFBuffer(r.result)); }
        catch(e){ resolve(null); }
      };
      r.onerror = () => resolve(null);
      r.readAsArrayBuffer(slice);
    });
  }

  function parseEXIFBuffer(buf){
    if(!buf || buf.byteLength < 4) return null;
    const v = new DataView(buf);
    if(v.getUint16(0) !== 0xFFD8) return null;   // JPEG SOI
    let off = 2;
    while(off + 4 <= buf.byteLength){
      if(v.getUint8(off) !== 0xFF) return null;  // markers are 0xFF-prefixed
      const marker = v.getUint8(off+1);
      off += 2;
      // Standalone markers (no length field): TEM, RSTn, SOI/EOI
      if(marker === 0x01 || marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) continue;
      const size = v.getUint16(off);
      const end = off + size;                    // length counts itself, so this is the next marker
      if(size < 2 || end > buf.byteLength) return null;
      if(marker === 0xE1){                        // APP1 — may carry "Exif\0\0" + TIFF
        const isExif = v.getUint8(off+2)===0x45 && v.getUint8(off+3)===0x78 &&
                       v.getUint8(off+4)===0x69 && v.getUint8(off+5)===0x66;   // 'E','x','i','f'
        if(isExif){
          const parsed = parseTIFF(buf.slice(off+8, end));
          if(parsed) return parsed;               // keep walking if this APP1 wasn't usable
        }
      }
      else if(marker === 0xDA || marker === 0xD9) return null;  // SOS/EOI: EXIF lives before this
      off = end;
    }
    return null;
  }

  /* TIFF value decoding. Sizes per field type; rationals are 2x uint32. */
  const TIFF_TYPE_SIZE = { 1:1, 2:1, 3:2, 4:4, 5:8, 6:1, 7:1, 8:2, 9:4, 10:8, 11:4, 12:8 };

  function readValues(v, little, type, count, valField, byteLength){
    const size = TIFF_TYPE_SIZE[type] || 1;
    const total = size * count;
    if(!(count > 0) || total <= 0) return null;
    const base = total > 4 ? v.getUint32(valField, little) : valField;
    if(!isFinite(base) || base < 0 || base + total > byteLength) return null;   // never read past the block
    const out = new Array(count);
    for(let i=0;i<count;i++){
      const p = base + i*size;
      switch(type){
        case 2: case 1: case 6: case 7: out[i] = v.getUint8(p); break;              // ASCII / BYTE / UNDEFINED / SBYTE
        case 3: out[i] = v.getUint16(p, little); break;                             // SHORT
        case 8: out[i] = v.getInt16(p, little); break;                              // SSHORT
        case 4: out[i] = v.getUint32(p, little); break;                             // LONG
        case 9: out[i] = v.getInt32(p, little); break;                              // SLONG
        case 5: { const d = v.getUint32(p+4, little); out[i] = d ? v.getUint32(p, little)/d : 0; break; }   // RATIONAL
        case 10:{ const d = v.getInt32(p+4, little);  out[i] = d ? v.getInt32(p, little)/d : 0; break; }   // SRATIONAL
        case 11: out[i] = v.getFloat(p, little); break;                             // FLOAT
        case 12: out[i] = v.getDouble(p, little); break;                            // DOUBLE
        default: out[i] = v.getUint8(p);
      }
    }
    return out;
  }

  function asString(vals){
    if(!vals) return '';
    let s = '';
    for(let i=0;i<vals.length;i++){ const c = vals[i]; if(c === 0) break; s += String.fromCharCode(c); }
    return s.replace(/\0+$/,'').trim();
  }
  function asNumber(vals){ return vals && vals.length ? Number(vals[0]) || 0 : 0; }

  function parseTIFF(tiff){
    try{
      if(!tiff || tiff.byteLength < 8) return null;
      const v = new DataView(tiff);
      const little = v.getUint16(0) === 0x4949;
      if(!(little || v.getUint16(0) === 0x4D4D)) return null;
      if(v.getUint16(2, little) !== 0x002A) return null;            // TIFF magic
      const exif = { make:'', model:'', lens:'', iso:0, fnumber:0, exposureTime:0, focalLength:0,
                     focalLength35:0, exposureBias:0, flash:false, dateTime:'', orientation:1,
                     gpsLat:null, gpsLon:null, gpsAlt:null };
      const ifd0 = v.getUint32(4, little);
      const ptrs = {};
      parseIFD(v, tiff.byteLength, little, ifd0, exif, 'main', ptrs);
      if(ptrs.exifIFD != null) parseIFD(v, tiff.byteLength, little, ptrs.exifIFD, exif, 'exif', ptrs);
      if(ptrs.gpsIFD  != null) parseGPS(v, tiff.byteLength, little, ptrs.gpsIFD, exif);
      return exif;
    }catch(e){ return null; }
  }

  function parseIFD(v, byteLength, little, off, exif, scope, ptrs){
    if(off < 2 || off + 2 > byteLength) return;
    const n = v.getUint16(off, little);
    const rd = (type, count, valField) => readValues(v, little, type, count, valField, byteLength);
    for(let i=0;i<n;i++){
      const e = off + 2 + i*12;
      if(e + 12 > byteLength) return;
      const tag  = v.getUint16(e, little);
      const type = v.getUint16(e+2, little);
      const cnt  = v.getUint32(e+4, little);
      const val  = e + 8;
      if(tag === 0x010F && scope==='main') exif.make = asString(rd(type, cnt, val));
      else if(tag === 0x0110 && scope==='main') exif.model = asString(rd(type, cnt, val));
      else if(tag === 0x0112 && scope==='main') exif.orientation = asNumber(rd(type, cnt, val)) || 1;
      else if(tag === 0x8769 && scope==='main') ptrs.exifIFD = v.getUint32(val, little);
      else if(tag === 0x8825 && scope==='main') ptrs.gpsIFD  = v.getUint32(val, little);
      else if(tag === 0x8827) exif.iso = asNumber(rd(type, cnt, val));
      else if(tag === 0x829D) exif.fnumber = asNumber(rd(type, cnt, val));
      else if(tag === 0x829A) exif.exposureTime = asNumber(rd(type, cnt, val));
      else if(tag === 0x920A) exif.focalLength = asNumber(rd(type, cnt, val));
      else if(tag === 0xA405) exif.focalLength35 = asNumber(rd(type, cnt, val));
      else if(tag === 0x9204) exif.exposureBias = asNumber(rd(type, cnt, val));
      else if(tag === 0x9209) exif.flash = (asNumber(rd(type, cnt, val)) & 1) === 1;
      else if(tag === 0xA434) exif.lens = asString(rd(type, cnt, val));
      else if(tag === 0x9003 || tag === 0x0132) exif.dateTime = asString(rd(type, cnt, val));
    }
  }

  function dmsToDeg(v){ return (v[0] || 0) + (v[1] || 0)/60 + (v[2] || 0)/3600; }

  function parseGPS(v, byteLength, little, off, exif){
    if(off < 2 || off + 2 > byteLength) return;
    const n = v.getUint16(off, little);
    const rd = (type, count, valField) => readValues(v, little, type, count, valField, byteLength);
    let lat=null, lon=null, latRef='N', lonRef='E', alt=null, altRef=0;
    for(let i=0;i<n;i++){
      const e = off + 2 + i*12;
      if(e + 12 > byteLength) return;
      const tag  = v.getUint16(e, little);
      const type = v.getUint16(e+2, little);
      const cnt  = v.getUint32(e+4, little);
      const val  = e + 8;
      if(tag === 0x0001) latRef = (asString(rd(type, cnt, val)) || 'N').charAt(0).toUpperCase();
      else if(tag === 0x0002){ const a = rd(type, cnt, val); if(a && a.length>=1) lat = dmsToDeg(a); }
      else if(tag === 0x0003) lonRef = (asString(rd(type, cnt, val)) || 'E').charAt(0).toUpperCase();
      else if(tag === 0x0004){ const a = rd(type, cnt, val); if(a && a.length>=1) lon = dmsToDeg(a); }
      else if(tag === 0x0005) altRef = asNumber(rd(type, cnt, val));
      else if(tag === 0x0006) alt = asNumber(rd(type, cnt, val));
    }
    if(lat != null) exif.gpsLat = (latRef === 'S' ? -1 : 1) * lat;
    if(lon != null) exif.gpsLon = (lonRef === 'W' ? -1 : 1) * lon;
    if(alt != null) exif.gpsAlt = (altRef === 1 ? -1 : 1) * alt;
  }

  /* Human-readable camera / capture line, e.g. "FUJIFILM X-T5 · ISO 1600 · 23mm". */
  function exifSummary(exif){
    if(!exif) return '';
    const parts = [];
    const cam = [exif.make, exif.model].filter(Boolean).join(' ').trim();
    if(cam) parts.push(cam);
    if(exif.iso) parts.push('ISO ' + exif.iso);
    if(exif.focalLength) parts.push(Math.round(exif.focalLength*10)/10 + 'mm');
    if(exif.fnumber) parts.push('f/' + (Math.round(exif.fnumber*10)/10));
    if(exif.exposureTime > 0 && exif.exposureTime < 1) parts.push('1/' + Math.round(1/exif.exposureTime) + 's');
    else if(exif.exposureTime >= 1) parts.push(Math.round(exif.exposureTime*100)/100 + 's');
    return parts.join(' · ');
  }

  /* -------- Pixel scene analysis (cheap, downsampled) -------- */
  function analyzeScene(canvas){
    const w = canvas.width, h = canvas.height;
    const target = 96;
    const scale = Math.min(1, target/Math.max(w,h));
    const sw = Math.max(2, Math.round(w*scale));
    const sh = Math.max(2, Math.round(h*scale));
    const tmp = document.createElement('canvas'); tmp.width=sw; tmp.height=sh;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(canvas, 0,0, sw, sh);
    const id = ctx.getImageData(0,0, sw, sh).data;
    let rSum=0,gSum=0,bSum=0,n=0;
    let skyPixels=0, skinPixels=0, folPixels=0, bluePixels=0;
    let lowLight = 0, highLight = 0;
    const sx = Math.max(1, Math.floor(sw/8));
    const sy = Math.max(1, Math.floor(sh/8));
    for(let y=0; y<sh; y++){
      for(let x=0; x<sw; x++){
        const i = (y*sw+x)*4;
        const r = id[i]/255, g = id[i+1]/255, b = id[i+2]/255;
        const lum = 0.2126*r + 0.7152*g + 0.0722*b;
        rSum+=r; gSum+=g; bSum+=b; n++;
        // sky: top half, blue dominant
        if(y<sh*0.45 && b>r*0.95 && b>g*0.92 && lum>0.4) skyPixels++;
        // skin: r>g>b, narrow hue range, mid luminance
        if(r>g && g>=b && r-b>0.05 && r-b<0.30 && lum>0.25 && lum<0.85){
          if(x>=sx && y>=sy && x<sw-sx && y<sh-sy) skinPixels++;
        }
        // foliage: green dominant
        if(g>r*1.05 && g>b*1.05 && lum>0.10 && lum<0.85) folPixels++;
        // blue (water/sky)
        if(b>r && b>g*0.92 && lum>0.2) bluePixels++;
        if(lum<0.18) lowLight++;
        if(lum>0.85) highLight++;
      }
    }
    const rAvg=rSum/n, gAvg=gSum/n, bAvg=bSum/n;
    const tags = [];
    const skyFrac = skyPixels/n, skinFrac = skinPixels/n, folFrac = folPixels/n, blueFrac = bluePixels/n;
    if(skyFrac > 0.18) tags.push('landscape');
    if(skinFrac > 0.06) tags.push('portrait');
    if(folFrac > 0.25) tags.push('nature');
    if(blueFrac > 0.25 && skyFrac > 0.10) tags.push('travel');
    if(lowLight/n > 0.45) tags.push('night');
    if(highLight/n > 0.30) tags.push('high-key');
    if(skinFrac < 0.03 && skyFrac < 0.10 && (folFrac>0.15 || (bAvg<rAvg && bAvg<gAvg))) tags.push('forest');
    if(rAvg > bAvg*1.10 && rAvg > gAvg) tags.push('golden');
    return {
      tags,
      avg: { r:rAvg, g:gAvg, b:bAvg },
      fracs: { sky:skyFrac, skin:skinFrac, foliage:folFrac, blue:blueFrac },
      lum: { low: lowLight/n, high: highLight/n }
    };
  }

  /* -------- Auto-suggest adjustments based on EXIF + scene -------- */
  function autoAdjust(exif, scene){
    const out = { scene: scene?.tags || [], tweaks: {} };
    if(!scene) return out;
    // High-key scene → lower highlights a touch, keep shadows natural
    if(scene.tags.includes('high-key')) out.tweaks.highlights = -0.15;
    if(scene.tags.includes('night')){ out.tweaks.shadows = 0.3; out.tweaks.noise = 0.4; out.tweaks.exposure = 0.25; }
    if(scene.tags.includes('portrait')){ out.tweaks.clarity = -0.2; out.tweaks.saturation = 0.05; }
    if(scene.tags.includes('landscape')){ out.tweaks.clarity = 0.25; out.tweaks.vibrance = 0.15; out.tweaks.saturation = 0.10; }
    if(scene.tags.includes('forest')){ out.tweaks.shadows = 0.2; out.tweaks.saturation = 0.0; }
    if(scene.tags.includes('golden')){ out.tweaks.temperature = 0.10; }
    if(exif && exif.iso && exif.iso >= 1600) out.tweaks.noise = 0.6;
    if(exif && exif.iso && exif.iso >= 3200) out.tweaks.noise = 0.8;
    return out;
  }

  global.FUJI = global.FUJI || {};
  global.FUJI.context = {
    readEXIF,
    parseEXIFBuffer,
    parseTIFF,
    exifSummary,
    analyzeScene,
    autoAdjust,
    /* matches a camera body to known Fuji X series */
    isFujiX(exif){
      if(!exif) return false;
      const m = (exif.make||'').toLowerCase();
      return m.indexOf('fujifilm') >= 0 || m.indexOf('fuji') >= 0;
    },
    xTransSeries(exif){
      if(!exif) return null;
      const m = (exif.model||'').toUpperCase();
      if(m.match(/X-H2|X-T5|X-T4|X-T3|X-H1|X-T50|X-S20|X100V|X100VI|X-PRO3|X-E4|X-E5/)) return 'X-Trans V/IV';
      return null;
    }
  };
})(typeof window!=="undefined"?window:globalThis);