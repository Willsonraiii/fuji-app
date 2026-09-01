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
  function readEXIF(file){
    return new Promise((resolve) => {
      if(!file || !(file instanceof Blob)) return resolve(null);
      const slice = file.slice ? file.slice(0, 256*1024) : file;
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
    const v = new DataView(buf);
    if(buf.byteLength < 4) return null;
    // JPEG SOI
    if(v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while(off < buf.byteLength){
      if(v.getUint8(off) !== 0xFF) return null;
      const marker = v.getUint8(off+1);
      off += 2;
      if(marker === 0xE1){  // APP1
          const size = v.getUint16(off);
          if(buf.slice(off+4, off+10) === 'Exif\0\0' || String.fromCharCode(...new Uint8Array(buf, off+4, 4)) === 'Exif'){
            const tiff = buf.slice(off+10, off+size);
            return parseTIFF(tiff);
          }
          off += size;
        }
      else if(marker === 0xDA){ return null; }  // SOS — image data, EXIF was earlier
      else {
        const size = v.getUint16(off);
        off += size;
      }
      if(off > buf.byteLength) return null;
    }
    return null;
  }

  function parseTIFF(tiff){
    const v = new DataView(tiff);
    if(tiff.byteLength < 8) return null;
    const little = v.getUint16(0) === 0x4949;
    const get16 = o => v.getUint16(o, little);
    const get32 = o => v.getUint32(o, little);
    if(get16(2) !== 0x002A) return null;
    const ifd0 = get32(4);
    const exif = { make:'', model:'', lens:'', iso:0, fnumber:0, exposureTime:0,
      focalLength:0, dateTime:'', orientation:1, gpsLat:null, gpsLon:null };
    parseIFD(tiff, v, ifd0, little, exif, 'main');
    if(exif._exifPtr) parseIFD(tiff, v, exif._exifPtr, little, exif, 'exif');
    delete exif._exifPtr;
    return exif;
  }

  function parseIFD(buf, v, off, little, exif, scope){
    if(off >= buf.byteLength) return;
    const get16 = o => v.getUint16(o, little);
    const get32 = o => v.getUint32(o, little);
    const n = get16(off);
    for(let i=0;i<n;i++){
      const e = off + 2 + i*12;
      const tag = get16(e);
      const type = get16(e+2);
      const cnt  = get32(e+4);
      const valOff = e+8;
      function readStr(){
        const o = cnt>4 ? get32(valOff) : valOff;
        let s='';
        for(let j=0;j<cnt;j++){ const c = v.getUint8(o+j); if(c===0) break; s += String.fromCharCode(c); }
        return s;
      }
      function readU16(){ return cnt>1 ? get32(valOff) : v.getUint16(valOff, little); }
      if(tag === 0x010F && scope==='main') exif.make = readStr().trim();
      if(tag === 0x0110 && scope==='main') exif.model = readStr().trim();
      if(tag === 0x8769 && scope==='main') exif._exifPtr = get32(valOff);
      if(tag === 0x8827 && scope==='exif') exif.iso = readU16();
      if(tag === 0x829D && scope==='exif') exif.fnumber = v.getUint16(valOff, little) / (type===5?256:1);
      if(tag === 0x829A && scope==='exif'){
        exif.exposureTime = v.getUint32(valOff, little) / (type===5?65536:1);
        if(exif.exposureTime<=0) exif.exposureTime = 1/Math.max(1, get32(valOff));
      }
      if(tag === 0x920A && scope==='exif') exif.focalLength = v.getUint32(valOff, little) / (type===5?65536:1);
      if(tag === 0x9003 || tag === 0x0132) exif.dateTime = readStr().trim();
      if(tag === 0x0112) exif.orientation = get16(valOff);
      // GPS sub-IFD
      if(tag === 0x8825 && scope==='main'){
        const gpsOff = get32(valOff);
        parseGPS(buf, v, gpsOff, little, exif);
      }
    }
  }
  function parseGPS(buf, v, off, little, exif){
    if(off >= buf.byteLength) return;
    const get16 = o => v.getUint16(o, little);
    const get32 = o => v.getUint32(o, little);
    const n = get16(off);
    let lat=[null,null,null], latRef='', lon=[null,null,null], lonRef='';
    for(let i=0;i<n;i++){
      const e = off + 2 + i*12;
      const tag = get16(e);
      const type = get16(e+2);
      const cnt  = get32(e+4);
      const valOff = e+8;
      function rational(idx){
          const o = cnt*8 > 8 ? get32(valOff) + idx*8 : valOff + idx*8;
          return v.getUint32(o, little) / v.getUint32(o+4, little);
        }
      if(tag === 0x0002){ lat[0]=rational(0); lat[1]=rational(1); lat[2]=rational(2); }
      if(tag === 0x0001) latRef = String.fromCharCode(v.getUint8(valOff));
      if(tag === 0x0004){ lon[0]=rational(0); lon[1]=rational(1); lon[2]=rational(2); }
      if(tag === 0x0003) lonRef = String.fromCharCode(v.getUint8(valOff));
    }
    function dec(a){ return a[0] + a[1]/60 + a[2]/3600; }
    if(lat[0]!=null) exif.gpsLat = (latRef==='S'?-1:1) * dec(lat);
    if(lon[0]!=null) exif.gpsLon = (lonRef==='W'?-1:1) * dec(lon);
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