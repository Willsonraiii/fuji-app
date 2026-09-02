/* =====================================================================
   F-UJI Film Color Engine — processing.js
   GPU (WebGL2) film color pipeline with CPU (Canvas2D) fallback.
   Both share the same math in `math` so results match.
   ===================================================================== */
(function (global) {
  "use strict";

  /* ---------------- Shared math ---------------- */
  const LUMA = [0.2126, 0.7152, 0.0722];
  function clamp01(v){ return Math.max(0, Math.min(1, v)); }
  function clamp(v,lo,hi){ return Math.max(lo, Math.min(hi, v)); }
  function smoothstep(e0,e1,x){ const t=Math.max(0,Math.min(1,(x-e0)/((e1-e0)||1e-6))); return t*t*(3-2*t); }
  function matIdentity(){ return [1,0,0,0,1,0,0,0,1]; }
  function matMultiply(a,b){
    const o=new Array(9);
    for(let r=0;r<3;r++)for(let c=0;c<3;c++)o[r*3+c]=a[r*3+0]*b[0*3+c]+a[r*3+1]*b[1*3+c]+a[r*3+2]*b[2*3+c];
    return o;
  }
  function satMatrix(s){ const i=1-s,[r,g,b]=LUMA; return [i*r+s,i*r,i*r, i*g,i*g+s,i*g, i*b,i*b,i*b+s]; }

  /* ---- Curves ---- */
  function neutralCurve(){ return [{x:0,y:0},{x:0.25,y:0.25},{x:0.5,y:0.5},{x:0.75,y:0.75},{x:1,y:1}]; }
  function sampleCurve(pts,t){
    if(!pts||!pts.length)return t;
    if(pts.length===1)return pts[0].y;
    let i=0;
    while(i<pts.length-2 && t>pts[i+1].x) i++;
    const p1=pts[i], p2=pts[Math.min(i+1,pts.length-1)];
    const span=(p2.x-p1.x)||1e-6;
    const u=Math.max(0,Math.min(1,(t-p1.x)/span));
    return p1.y+(p2.y-p1.y)*u;
  }
  function curveToArray(xs,pts){ return xs.map(x=>sampleCurve(pts,x)); }
  function blendCurves(base, extras, weight){
    if(!extras.length||weight<=0) return base;
    const xs=base.map(p=>p.x), out=base.map(p=>({x:p.x,y:p.y}));
    for(const s of extras){ const ys=curveToArray(xs,s); for(let k=0;k<out.length;k++) out[k].y+=(ys[k]-out[k].y)*weight; }
    return out;
  }

  /* apply user tone adjustments (highlights/shadows/whites/blacks/contrast) to base pts */
  function applyToneCurve(base, light, contrastAmt){
    let pts=base.map(p=>({x:p.x,y:p.y}));
    if(contrastAmt){
      const s=Math.tanh(contrastAmt*1.35);
      pts=pts.map(p=>({x:p.x,y:clamp01((p.y-0.5)*(1+s)+0.5)}));
    }
    const hi=light.highlights||0, sh=light.shadows||0, wh=light.whites||0, bl=light.blacks||0;
    if(hi||sh||wh||bl){
      pts=pts.map(p=>{
        let y=p.y;
        if(hi) y+=hi*smoothstep(0.55,0.95,p.x)*0.9*0.22;
        if(sh) y+=sh*(1-smoothstep(0.05,0.5,p.x))*0.9*0.22;
        if(wh) y+=wh*Math.pow(p.x,6)*0.35;
        if(bl) y+=bl*Math.pow(1-p.x,6)*0.35;
        return {x:p.x,y:clamp01(y)};
      });
    }
    return pts;
  }

  /* ---- Fuji camera-style settings → engine contribution ----
     These are per-image "recipes within a recipe": dynamic range,
     highlight/shadow tone, color, sharpness, NR, grain, Color Chrome
     effects, clarity and WB preset. Raw values are applied on top of
     the chosen film simulation so every photo can be customized. */
  function fujiDefaults(){
    return {
      dr:'auto', highlightTone:0, shadowTone:0, color:0, sharpness:0, hNR:0,
      grainEffect:'off', grainSize:'small', chromeFx:'off', chromeFxBlue:'off',
      clarity:0, wbMode:'auto'
    };
  }
  const WB_MODE_TEMP = { auto:0, daylight:0, cloudy:0.06, shade:0.12, tungsten:-0.18, fluorescent:-0.08, flash:0.02 };
  function hueEmpty(){
    const k=['r','o','y','g','c','b','m','p'], o={};
    for(const c of k) o[c]=0;
    return o;
  }
  function applyFuji(fj, light, color, film, det){
    const wLight=Object.assign({}, light);
    const wDet=Object.assign({}, det);
    const wFilm=Object.assign({}, film);
    const wColor=Object.assign({}, color);
    wColor.hsl = wColor.hsl ? JSON.parse(JSON.stringify(wColor.hsl)) : { hue:hueEmpty(), sat:hueEmpty(), luma:hueEmpty() };
    const NO=()=>({ hue:hueEmpty(), sat:hueEmpty(), luma:hueEmpty() });
    for(const k of ['hue','sat','luma']){
      if(!wColor.hsl[k]) wColor.hsl[k]=NO()[k];
      for(const c of ['r','o','y','g','c','b','m','p']) if(wColor.hsl[k][c]==null) wColor.hsl[k][c]=0;
    }
    fj = fj || {};

    // dynamic range — protects highlights; DR400 lifts the floor a touch
    if(fj.dr===200){ wLight.highlights=(wLight.highlights||0)-0.08; wLight.shadows=(wLight.shadows||0)+0.04; }
    else if(fj.dr===400){ wLight.highlights=(wLight.highlights||0)-0.16; wLight.shadows=(wLight.shadows||0)+0.08; wLight.exposure=(wLight.exposure||0)+0.04; }

    // tone (-2..+4)
    wLight.highlights=(wLight.highlights||0)+clamp(fj.highlightTone||0,-2,4)*0.14;
    wLight.shadows=(wLight.shadows||0)+clamp(fj.shadowTone||0,-2,4)*0.16;

    // color (-4..+4)
    wColor.saturation=(wColor.saturation||0)+clamp(fj.color||0,-4,4)*0.085;
    wColor.vibrance=(wColor.vibrance||0)+clamp(fj.color||0,-4,4)*0.02;

    // clarity (-5..+5), sharpness (-4..+4), high ISO NR (-4..+4)
    wDet.clarity=(wDet.clarity||0)+clamp(fj.clarity||0,-5,5)*0.11;
    wDet.sharp=Math.max(0,Math.min(1,(wDet.sharp||0)+(clamp(fj.sharpness||0,-4,4)+4)*0.075));
    wDet.noise=Math.max(0,Math.min(0.9,(wDet.noise||0)+(clamp(fj.hNR||0,-4,4)+4)*0.06));

    // grain effect + size (size only pins when the effect is on)
    if(fj.grainEffect==='weak'){ wFilm.grain=Math.max(wFilm.grain||0,0.32); wFilm.grainStrength=0.45; }
    else if(fj.grainEffect==='strong'){ wFilm.grain=Math.max(wFilm.grain||0,0.7); wFilm.grainStrength=0.7; }
    if(fj.grainEffect!=='off'){
      if(fj.grainSize==='large') wFilm.grainSize=0.75;
      else if(fj.grainSize==='small') wFilm.grainSize=0.35;
    }

    // Color Chrome Effect — boosts midrange saturation with slight contrast
    const chrome = fj.chromeFx==='strong' ? 1 : fj.chromeFx==='weak' ? 0.5 : 0;
    wColor.vibrance=(wColor.vibrance||0)+chrome*0.10;
    wColor.saturation=(wColor.saturation||0)+chrome*0.06;
    wLight.contrast=(wLight.contrast||0)+chrome*0.10;

    // Color Chrome FX Blue — deepens blues/cyans
    const cb = fj.chromeFxBlue==='strong' ? 1 : fj.chromeFxBlue==='weak' ? 0.5 : 0;
    if(cb){
      wColor.hsl.sat.b=(wColor.hsl.sat.b||0)+cb*0.35;
      wColor.hsl.sat.c=(wColor.hsl.sat.c||0)+cb*0.15;
      wColor.hsl.hue.b=(wColor.hsl.hue.b||0)-cb*0.06;
    }

    // WB preset adds base temperature/tint on top of the manual shift
    wColor.temperature=(wColor.temperature||0)+(WB_MODE_TEMP[fj.wbMode]||0);
    if(fj.wbMode==='fluorescent') wColor.tint=(wColor.tint||0)+0.04;

    return { light:wLight, color:wColor, film:wFilm, det:wDet };
  }

  /* Bake final shader-ready params from app state (profile + manual + Fuji) */
  function bakeParams(state){
    const pid = state.profileId || 'off';
    const profile = (global.FUJI.getProfile && global.FUJI.getProfile(pid)) || null;
    const prof = profile ? profile.engine : null;
    const fi = clamp01(state.film.intensity);
    const fj = Object.assign(fujiDefaults(), state.fuji||{});
    const base = applyFuji(fj, state.light||{}, state.color||{}, state.film||{}, state.detail||{});
    const light = base.light, color = base.color, film = base.film, det = base.det;
    const grade = state.grade||{};

    // --- combined color matrix
    let M = matIdentity();
    if(prof && prof.matrix && fi>0){
      const b=prof.matrix;
      M = b.map((v,i)=> v*fi + M[i]*(1-fi));
    }
    let sat = 1 + ((color.saturation||0)*0.9);
    if(prof && prof.saturation!=null && fi>0) sat *= (1+(prof.saturation-1)*fi);
    M = matMultiply(satMatrix(sat), M);
    // HSL-driven channel targets -> small matrix (approx) — refined in shader optional
    const hsl=buildHSLMatrix(color.hsl);
    M = matMultiply(hsl, M);

    // --- WB multipliers
    const wb = buildWB(color);

    // --- curves
    const xs=[0,0.15,0.3,0.5,0.7,0.85,1];
    let Lc=neutralCurve();
    if(prof && prof.lumaCurve && fi>0) Lc=blendCurves(Lc,[prof.lumaCurve],fi);
    Lc=applyToneCurve(Lc, light, light.contrast||0);
    const L=curveToArray(xs,Lc);
    function ch(idx){
      const cc=prof&&prof.channelCurves?prof.channelCurves[idx]:null;
      return curveToArray(xs, cc&&fi>0?blendCurves(neutralCurve(),[cc],fi):neutralCurve());
    }
    const R=ch(0), G=ch(1), B=ch(2);

    // --- scalar params
    let exposure=(light.exposure||0)+(prof&&prof.exposure!=null?prof.exposure*fi:0);
    let vibrance=(color.vibrance||0)+(prof&&prof.vibrance!=null?prof.vibrance*fi:0);
    let vignette=(state.vignette||0)+(prof&&prof.vignette!=null?prof.vignette*fi:0);
    let grainAmt=(film.grain||0)+(prof&&prof.grainAmt!=null?prof.grainAmt*fi:0);
    let grainSize=(film.grainSize==null?0.5:film.grainSize);
    if(prof&&prof.grainSize!=null) grainSize=grainSize*(1-fi)+prof.grainSize*fi;
    // Fuji grain effect overrides the size when active (sim's own size applies otherwise)
    if((fj.grainEffect||'off')!=='off' && film.grainSize!=null &&
       (film.grainSize===0.75 || film.grainSize===0.35)) grainSize=film.grainSize;
    let grainStr=(film.grainStrength==null?0.5:film.grainStrength);
    let halation=(film.halation||0)+(prof&&prof.halation!=null?prof.halation*fi:0);
    let bloom=(film.bloom||0)+(prof&&prof.bloom!=null?prof.bloom*fi:0);
    let clarity=(det.clarity||0), texture=(det.texture||0), sharp=(det.sharp==null?0:det.sharp),
        noise=(det.noise||0), dehaze=(det.dehaze||0);

    // --- split tone
    const st={ sh:0,ss:0,hh:0,hs:0,bal:0 };
    st.sh=(grade.shadowHue||0); st.ss=(grade.shadowSat||0);
    st.hh=(grade.highlightHue||0); st.hs=(grade.highlightSat||0);
    st.bal=(grade.balance||0);
    if(prof&&prof.split&&fi>0){
      const ps=prof.split;
      st.sh+=ps.sh*fi; st.ss+=ps.ss*fi; st.hh+=ps.hh*fi; st.hs+=ps.hs*fi;
    }

    return { matrix:M, wb, curves:{L,R,G,B}, exposure, vibrance, vignette,
      grainAmt, grainSize, grainStr, halation, bloom, clarity, texture, sharp, noise,
      dehaze, st, saturate: sat, hsl: color.hsl, hslHasAdjust: hslHas(color.hsl) };
  }
  function hslHas(hsl){
    if(!hsl) return false;
    for(const k of ['hue','sat','luma']) for(const c in (hsl[k]||{})) if((hsl[k][c]||0)!==0) return true;
    return false;
  }

  /* HSL panel — 8 bands (R O Y G C B M + Purple) with hue/sat/luma shifts.
     CPU path uses applyHSL() per pixel. GPU path encodes "color chrome" style
     adjustment via 3x3 matrix approximation (good enough for the preview;
     full fidelity comes from the CPU engine / re-baked matrix pass). */

  const HSL_BANDS = [
    { key:'r', center:  0,  width: 30 },
    { key:'o', center: 30,  width: 28 },  // skin / orange
    { key:'y', center: 60,  width: 30 },
    { key:'g', center:120,  width: 40 },
    { key:'c', center:180,  width: 35 },
    { key:'b', center:240,  width: 35 },
    { key:'m', center:300,  width: 30 },
    { key:'p', center:330,  width: 30 }
  ];
  const HSL_KEYS = HSL_BANDS.map(b=>b.key);

  function rgbToHslPixel(r,g,b){
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
    const l=(mx+mn)*0.5;
    let h=0, s=0;
    const d=mx-mn;
    if(d>1e-6){
      s = l>0.5 ? d/(2-mx-mn) : d/(mx+mn);
      if(mx===r) h = ((g-b)/d) % 6;
      else if(mx===g) h = (b-r)/d + 2;
      else h = (r-g)/d + 4;
      h *= 60; if(h<0) h+=360;
    }
    return [h, s, l];
  }
  function hueResponsibility(hue, center, width){
    let d = Math.abs(hue-center);
    if(d>180) d = 360-d;
    const x = d/(width*0.5);
    return Math.max(0, Math.exp(-x*x*1.4));
  }
  function bandWeights(r,g,b){
    const [h,s,l] = rgbToHslPixel(r,g,b);
    const w = new Array(HSL_BANDS.length);
    let sum=0;
    for(let i=0;i<HSL_BANDS.length;i++){
      w[i] = hueResponsibility(h, HSL_BANDS[i].center, HSL_BANDS[i].width);
      sum += w[i];
    }
    if(sum>0){ for(let i=0;i<w.length;i++) w[i]/=sum; }
    if(s<0.08){
      const f = 1.0 - s/0.08;
      for(let i=0;i<w.length;i++) w[i] = w[i]*s/0.08 + (1.0/HSL_BANDS.length)*f;
    }
    return w;
  }
  function applyHSL(r,g,b,hsl){
    if(!hsl) return [r,g,b];
    const [hue, sat] = rgbToHslPixel(r,g,b);
    const w = bandWeights(r,g,b);
    let dh=0, ds=0, dl=0;
    for(let i=0;i<HSL_BANDS.length;i++){
      const k = HSL_BANDS[i].key;
      dh += w[i]*(hsl.hue[k]||0);
      ds += w[i]*(hsl.sat[k]||0);
      dl += w[i]*(hsl.luma[k]||0);
    }
    if(Math.abs(dh)>1e-4){
      let nh = (hue + dh*30) % 360; if(nh<0) nh+=360;
      const lm = (Math.max(r,g,b)+Math.min(r,g,b))*0.5;
      const c = (1 - Math.abs(2*lm - 1)) * sat;
      const xx = c * (1 - Math.abs(((nh/60)%2) - 1));
      const m = lm - c*0.5;
      let rr,gg,bb;
      if(nh<60){[rr,gg,bb]=[c,xx,0];}
      else if(nh<120){[rr,gg,bb]=[xx,c,0];}
      else if(nh<180){[rr,gg,bb]=[0,c,xx];}
      else if(nh<240){[rr,gg,bb]=[0,xx,c];}
      else if(nh<300){[rr,gg,bb]=[xx,0,c];}
      else {[rr,gg,bb]=[c,0,xx];}
      r = Math.max(0, rr+m); g = Math.max(0, gg+m); b = Math.max(0, bb+m);
    }
    if(Math.abs(ds)>1e-4){
      const l = (Math.max(r,g,b)+Math.min(r,g,b))*0.5;
      const mul = 1 + ds;
      r = l + (r-l)*mul; g = l + (g-l)*mul; b = l + (b-l)*mul;
    }
    if(Math.abs(dl)>1e-4){
      r += dl*0.25; g += dl*0.25; b += dl*0.25;
    }
    return [r,g,b];
  }
  function buildHSLMatrix(hsl){
    /* CPU does per-pixel applyHSL. The GPU pass gets a small diatonic-style
       boost encoded as a 3x3 matrix sampled on the primary axes (R: 0deg,
       G: 120deg, B: 240deg). Good enough for live preview. */
    if(!hsl) return matIdentity();
    let any=false;
    for(const k of ['hue','sat','luma']) for(const c of HSL_KEYS)
      if(hsl[k]&&hsl[k][c]&&hsl[k][c]!==0) any=true;
    if(!any) return matIdentity();
    // sample R (1,0,0), G (0,1,0), B (0,0,1) and fit a matrix
    const outR = applyHSL(1,0,0,hsl);
    const outG = applyHSL(0,1,0,hsl);
    const outB = applyHSL(0,0,1,hsl);
    return [outR[0],outG[0],outB[0], outR[1],outG[1],outB[1], outR[2],outG[2],outB[2]];
  }

  function buildWB(color){
    const temp=color.temperature||0, tint=color.tint||0;
    let r=1,g=1,b=1;
    r*=Math.pow(1.18,temp); b*=Math.pow(1/1.18,temp);
    r*=Math.pow(1.05,tint); b*=Math.pow(1.05,tint); g*=Math.pow(1/1.09,tint);
    return [r,g,b];
  }

  function hashNoise(x,y){
    let n = (x*374761393 + y*668265263) | 0;
    n = ((n ^ (n>>>13)) * 1274126177) | 0;
    return ((n ^ (n>>>16)) & 0x7fffffff) / 0x7fffffff;
  }

  global.FUJI = global.FUJI || {};
  global.FUJI.math = { LUMA, clamp01, clamp, smoothstep, matIdentity, matMultiply, satMatrix,
    neutralCurve, sampleCurve, curveToArray, blendCurves, applyToneCurve,
    bakeParams, buildWB, buildHSLMatrix };
  global.FUJI.v3 = global.FUJI.v3 || {};
  global.FUJI.v3.applyFuji = applyFuji;
  global.FUJI.v3.fujiDefaults = fujiDefaults;
  global.FUJI.v3.WB_MODE_TEMP = WB_MODE_TEMP;
  global.FUJI.hsl = {
    bands: HSL_BANDS,
    keys: HSL_KEYS,
    bandWeights: bandWeights,
    rgbToHsl: rgbToHslPixel,
    apply: applyHSL
  };

  /* =====================================================================
     WebGL2 Engine — multi-pass film pipeline.
     Pass 1 : grade (exposure/WB/matrix/curves/sat/split-tone)   -> baseTex
     Pass 2 : unsharp low pass (H)                               -> lowTex1
     Pass 3 : unsharp low pass (V)                               -> lowTex2
     Pass 4 : bloom extract (quarter downsample + threshold)     -> bloomTex1
     Pass 5 : bloom blur (H)                                     -> bloomTex2
     Pass 6 : bloom blur (V)                                     -> bloomTex3
     Pass 7 : composite (detail/dehaze/grain/vignette + sRGB)    -> screen
     ===================================================================== */
  const VS = `#version 300 es
    in vec2 aPos;
    out vec2 vUV;
    void main(){ vUV = vec2(aPos.x*0.5+0.5, aPos.y*0.5+0.5); gl_Position = vec4(aPos,0.0,1.0); }
  `;

  /* Curve sampler per channel. GLSL ES 3.00 forbids array-typed parameters and
     array assignment, so each function reads its own uniform array directly. */
  const SAMPLE_FNS = ['L','R','G','B'].map(ch=>`
    float curve_${ch}(float t){
      float a=${'uS_'+ch}[0], b=${'uS_'+ch}[1], c=${'uS_'+ch}[2], d=${'uS_'+ch}[3],
            e=${'uS_'+ch}[4], f=${'uS_'+ch}[5], g=${'uS_'+ch}[6];
      if(t<=0.0) return a;
      if(t>=1.0) return g;
      if(t<0.3){ t=(t-0.0)/0.3; return t<0.5? mix(a,b,t*2.0) : mix(b,c,(t-0.5)*2.0); }
      if(t<0.5){ float u=(t-0.3)/0.2; return mix(c,d,u); }
      if(t<0.7){ float u=(t-0.5)/0.2; return mix(d,e,u); }
      float u=(t-0.7)/0.3; return u<0.5? mix(e,f,u*2.0) : mix(f,g,(u-0.5)*2.0);
    }`).join('\n');
  /* Piecewise-linear between curve waypoints at 0,.15,.3,.5,.7,.85,1 */
  const FS_MAIN = `#version 300 es
    precision highp float;
    in vec2 vUV;
    out vec4 fragColor;
    uniform sampler2D uTex;
    uniform mat3 uMatrix;
    uniform vec3 uWB;
    uniform float uExposure;
    uniform float uS_L[7]; uniform float uS_R[7]; uniform float uS_G[7]; uniform float uS_B[7];
    uniform float uVibrance;
    uniform float uShadowHue; uniform float uShadowSat;
    uniform float uHighHue;   uniform float uHighSat;
    uniform float uBalance;

    const float PI=3.14159265359;
    const vec3 lum = vec3(0.2126,0.7152,0.0722);
${SAMPLE_FNS}

    void main(){
      vec3 lin = pow(max(texture(uTex, vUV).rgb, vec3(0.0)), vec3(2.4));
      lin *= exp2(uExposure);
      lin *= uWB;
      lin = clamp(uMatrix * lin, 0.0, 2.0);

      // per-channel film response + luma tone shaping
      vec3 lc = vec3(curve_R(lin.r), curve_G(lin.g), curve_B(lin.b));
      float l = dot(lin, lum);
      float lo = curve_L(l);
      vec3 outC = clamp(lc + (lo - l) * lum, 0.0, 2.0);
      l = dot(outC, lum);

      // vibrance (protect skin / keep organic)
      // NOTE: avoid nested max(max(a,b),max(c,d)) — a SwiftShader/ANGLE bug;
      // use the max(max(a,b),c) form which compiles everywhere.
      float vSat = max(max(outC.r,outC.g),outC.b) - min(min(outC.r,outC.g),outC.b);
      float boost = 1.0 + uVibrance * (1.0 - vSat);
      outC = mix(vec3(l), outC, clamp(boost, 0.15, 2.2));

      // split tone (subtle, luminance-gated)
      float tmix = clamp((dot(outC,lum) - uBalance)*0.5 + 0.5, 0.0, 1.0);
      vec3 shCol = vec3(0.5)+vec3(cos(uShadowHue*PI),cos(uShadowHue*PI+2.09439),cos(uShadowHue*PI-2.09439))*0.5;
      vec3 hiCol = vec3(0.5)+vec3(cos(uHighHue*PI),cos(uHighHue*PI+2.09439),cos(uHighHue*PI-2.09439))*0.5;
      vec3 graded = outC;
      graded = mix(graded, clamp(graded * (1.0 + (shCol-vec3(0.5))*0.9*uShadowSat), 0.0, 2.0), (1.0-tmix)*uShadowSat);
      graded = mix(graded, clamp(graded * (1.0 + (hiCol-vec3(0.5))*0.9*uHighSat), 0.0, 2.0), tmix*uHighSat);
      outC = graded;

      fragColor = vec4(clamp(outC, 0.0, 2.0), 1.0);
    }
  `;

  /* Gaussian blur (5-tap separable, sigma 1.75) */
  const FS_BLUR = `#version 300 es
    precision highp float;
    in vec2 vUV;
    out vec4 fragColor;
    uniform sampler2D uTex;
    uniform vec2 uDir;
    uniform vec2 uRes;
    void main(){
      vec2 texel = vec2(1.0,1.0) / uRes;
      vec2 off1 = vec2(1.3846153846) * texel * uDir;
      vec2 off2 = vec2(3.2307692308) * texel * uDir;
      vec3 sum = texture(uTex, vUV).rgb * 0.2270270270
               + (texture(uTex, vUV+off1).rgb + texture(uTex, vUV-off1).rgb) * 0.3162162162
               + (texture(uTex, vUV+off2).rgb + texture(uTex, vUV-off2).rgb) * 0.0702702703;
      fragColor = vec4(sum, 1.0);
    }
  `;

  /* Bloom extract: quarter-res downsample + highlight threshold */
  const FS_EXTRACT = `#version 300 es
    precision highp float;
    in vec2 vUV;
    out vec4 fragColor;
    uniform sampler2D uTex;
    uniform vec2 uRes;
    uniform float uThreshold;
    void main(){
      vec2 px = vec2(2.0,2.0)/uRes;
      vec3 c = ( texture(uTex, vUV).rgb
               + texture(uTex, vUV+vec2(px.x,0.0)).rgb
               + texture(uTex, vUV+vec2(0.0,px.y)).rgb
               + texture(uTex, vUV+px).rgb ) * 0.25;
      float l = max(max(c.r,c.g), c.b);
      float mask = smoothstep(uThreshold, uThreshold+0.12, l);
      fragColor = vec4(c * mask, 1.0);
    }
  `;

  /* Composite: detail (unsharp) / dehaze / denoise / glow / grain / vignette + sRGB encode */
  const FS_COMP = `#version 300 es
    precision highp float;
    in vec2 vUV;
    out vec4 fragColor;
    uniform sampler2D uBase;
    uniform sampler2D uLow;
    uniform sampler2D uBloom;
    uniform float uClarity;  uniform float uTexture;
    uniform float uSharp;    uniform float uNoise;
    uniform float uDehaze;
    uniform float uHalation; uniform float uBloomAmt;
    uniform float uVignette; uniform float uAspect;
    uniform float uGrain;    uniform float uGrainSize; uniform float uGrainStr;
    uniform vec2 uRes;

    const vec3 lum = vec3(0.2126,0.7152,0.0722);

    float hash2(vec2 p){
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main(){
      vec3 base = texture(uBase, vUV).rgb;
      vec3 low  = texture(uLow,  vUV).rgb;

      // --- detail / texture / clarity (unsharp mask on luma)
      float l = dot(base, lum);
      float ll = dot(low, lum);
      float diff = l - ll;
      float texAmt = uClarity*0.55 + uTexture*0.35 + uSharp*0.25;
      vec3 col = base + diff * texAmt;

      // --- noise reduction: denoise pulls toward local mean
      col = mix(col, low + (col-low)*0.5, uNoise*0.7);

      // --- dehaze: reduce veiling haze (flatten toward local low)
      col = col * (1.0 + uDehaze*0.18) - (low * uDehaze*0.18);
      col = clamp(col, 0.0, 2.0);

      // --- glow (halation + bloom), warm halation color
      vec3 bloom = texture(uBloom, vUV).rgb;
      float glowAmt = uHalation*0.65 + uBloomAmt*0.9;
      if(glowAmt > 0.0){
        vec3 warm = vec3(1.08, 1.02, 0.94);
        col += bloom * glowAmt * warm;
      }

      // --- vignette (signed: negative lightens edges)
      vec2 uv = vUV;
      uv.x *= uAspect;
      float dist = length(uv - vec2(uAspect*0.5, 0.5));
      float vigF = smoothstep(0.30, 0.99, dist);
      float vig = 1.0 - vigF * abs(uVignette);
      col *= clamp(vig, 0.35, 1.0);

      // --- film grain (screen-space, shadows/mids weighted)
      if(uGrain > 0.001){
        float gscale = 1.0/(uGrainSize*3.0 + 0.5);
        float g = (hash2(vUV*uRes*gscale + 7.13) - 0.5)*2.0;
        float amp = uGrain * (0.05 + uGrainStr*0.09) * (0.5 + (1.0-clamp(l,0.0,1.0))*0.5);
        col = col * (1.0 + g*amp);
      }

      // --- encode to sRGB
      col = clamp(col, 0.0, 1.0);
      col = pow(col, vec3(1.0/2.4));
      fragColor = vec4(col, 1.0);
    }
  `;

  function createProgram(gl, vsSrc, fsSrc){
    function sh(type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){ console.error('shader('+(type===gl.VERTEX_SHADER?'VS':'FS')+'):\n'+gl.getShaderInfoLog(s)); return null;} return s; }
    const p=gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER,vsSrc)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER,fsSrc));
    gl.bindAttribLocation(p,0,'aPos');
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){ console.error('program:',gl.getProgramInfoLog(p)); return null;}
    return p;
  }

  function uniformCache(gl, prog, names){
    const o={};
    for(const n of names) o[n]=gl.getUniformLocation(prog,n);
    return o;
  }

  function makeFBO(gl,w,h){
    const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    const fbo=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return { tex, fbo, w, h };
  }

  class WebGLEngine {
    constructor(canvas){
      this.canvas=canvas;
      this.gl=canvas.getContext('webgl2',{ premultipliedAlpha:false, antialias:false, alpha:false, preserveDrawingBuffer:false });
      if(!this.gl) return;
      const gl=this.gl;
      this.progMain = createProgram(gl,VS,FS_MAIN);
      this.progBlur = createProgram(gl,VS,FS_BLUR);
      this.progExtract = createProgram(gl,VS,FS_EXTRACT);
      this.progComp = createProgram(gl,VS,FS_COMP);
      if(!this.progMain||!this.progBlur||!this.progExtract||!this.progComp){ this.gl=null; return; }
      this.arrayBuf=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,this.arrayBuf);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1, 1,-1, -1,1, 1,1]),gl.STATIC_DRAW);
      // aPos is always location 0
      this.lMain = uniformCache(gl,this.progMain,['uTex','uMatrix','uWB','uExposure','uVibrance',
        'uShadowHue','uShadowSat','uHighHue','uHighSat','uBalance','uS_L','uS_R','uS_G','uS_B']);
      this.lExtract = uniformCache(gl,this.progExtract,['uTex','uRes','uThreshold']);
      this.lBlur = uniformCache(gl,this.progBlur,['uTex','uDir','uRes']);
      this.lComp = uniformCache(gl,this.progComp,['uBase','uLow','uBloom','uClarity','uTexture','uSharp',
        'uNoise','uDehaze','uHalation','uBloomAmt','uVignette','uAspect','uGrain','uGrainSize','uGrainStr','uRes']);
      this._fbo = {}; // cache keyed "w:h"
    }
    isGPU(){ return !!this.gl; }
    _getFBO(w,h){
      const key=w+'x'+h;
      let f=this._fbo[key];
      if(!f){
        // allocate a small pool of (usually 4-6) distinct FBOs per unique size so
        // simultaneous read/write targets never alias the same framebuffer
        f=[];
        for(let i=0;i<6;i++) f.push(makeFBO(this.gl,w,h));
        this._fbo[key]=f;
      }
      return f;
    }
    _bindQuad(){
      const gl=this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER,this.arrayBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    }
    _sourceTex(source, srcW, srcH){
      const gl=this.gl;
      const t=gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D,t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
      return t;
    }
    _drawInto(fbo, prog, loc, bindFn){
      const gl=this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0,0, (fbo&&fbo.w)||this.canvas.width, (fbo&&fbo.h)||this.canvas.height);
      gl.useProgram(prog);
      this._bindQuad();
      bindFn();
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
    render(source, destW, destH, params){
      const gl=this.gl;
      if(!gl) return false;
      const srcW=source.width||source.videoWidth||0, srcH=source.height||source.videoHeight||0;
      if(!srcW||!srcH) return false;

      const texSrc=this._sourceTex(source,srcW,srcH);

      const baseFBO = this._getFBO(destW,destH)[0];
      const lowA = this._getFBO(destW,destH)[1];
      const lowB = this._getFBO(destW,destH)[2];
      const hw=Math.max(2,Math.round(destW/4)), hh=Math.max(2,Math.round(destH/4));
      const bloomA = this._getFBO(hw,hh)[3];
      const bloomB = this._getFBO(hw,hh)[4];
      const bloomC = this._getFBO(hw,hh)[5];

      const L=this.lMain;
      this._drawInto(baseFBO.fbo, this.progMain, null, ()=>{
        gl.uniform1i(L.uTex,0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texSrc);
        gl.uniformMatrix3fv(L.uMatrix,false,new Float32Array(params.matrix));
        gl.uniform3fv(L.uWB,new Float32Array(params.wb));
        gl.uniform1f(L.uExposure,params.exposure);
        gl.uniform1f(L.uVibrance,params.vibrance);
        gl.uniform1f(L.uShadowHue,params.st.sh);
        gl.uniform1f(L.uShadowSat,params.st.ss);
        gl.uniform1f(L.uHighHue,params.st.hh);
        gl.uniform1f(L.uHighSat,params.st.hs);
        gl.uniform1f(L.uBalance,params.st.bal);
        gl.uniform1fv(L.uS_L,new Float32Array(params.curves.L));
        gl.uniform1fv(L.uS_R,new Float32Array(params.curves.R));
        gl.uniform1fv(L.uS_G,new Float32Array(params.curves.G));
        gl.uniform1fv(L.uS_B,new Float32Array(params.curves.B));
      });

      // unsharp low passes (full res)
      const BL=this.lBlur;
      const t0=baseFBO.tex;
      const blurPass=(srcTex,targetFBO,dir)=>{
        this._drawInto(targetFBO.fbo, this.progBlur, null, ()=>{
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,srcTex);
          gl.uniform1i(BL.uTex,0);
          gl.uniform2f(BL.uRes,destW,destH);
          gl.uniform2f(BL.uDir,dir[0],dir[1]);
        });
      };
      blurPass(t0, lowA, [1,0]);
      blurPass(lowA.tex, lowB, [0,1]);

      // bloom extract + blur
      const EX=this.lExtract;
      this._drawInto(bloomA.fbo, this.progExtract, null, ()=>{
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,t0);
        gl.uniform1i(EX.uTex,0);
        gl.uniform2f(EX.uRes,destW,destH);
        gl.uniform1f(EX.uThreshold,0.82);
      });
      const bumper=(srcTex,targetFBO,dir)=>{
        this._drawInto(targetFBO.fbo, this.progBlur, null, ()=>{
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,srcTex);
          gl.uniform1i(BL.uTex,0);
          gl.uniform2f(BL.uRes,hw,hh);
          gl.uniform2f(BL.uDir,dir[0],dir[1]);
        });
      };
      bumper(bloomA.tex, bloomB, [1,0]);
      bumper(bloomB.tex, bloomC, [0,1]);

      // composite to screen
      const C=this.lComp;
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.viewport(0,0,destW,destH);
      gl.useProgram(this.progComp);
      this._bindQuad();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,baseFBO.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,lowB.tex);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,bloomC.tex);
      gl.uniform1i(C.uBase,0);
      gl.uniform1i(C.uLow,1);
      gl.uniform1i(C.uBloom,2);
      gl.uniform1f(C.uClarity,params.clarity||0);
      gl.uniform1f(C.uTexture,params.texture||0);
      gl.uniform1f(C.uSharp,params.sharp||0);
      gl.uniform1f(C.uNoise,params.noise||0);
      gl.uniform1f(C.uDehaze,params.dehaze||0);
      gl.uniform1f(C.uHalation,clamp01(params.halation||0));
      gl.uniform1f(C.uBloomAmt,clamp01(params.bloom||0));
      gl.uniform1f(C.uVignette,clamp(params.vignette||0,-1,1));
      const aspect=(destH>0)?destW/destH:1;
      gl.uniform1f(C.uAspect,aspect);
      gl.uniform1f(C.uGrain,clamp01(params.grainAmt||0));
      gl.uniform1f(C.uGrainSize,clamp01(params.grainSize||0.5));
      gl.uniform1f(C.uGrainStr,clamp01(params.grainStr||0.5));
      gl.uniform2f(C.uRes,destW,destH);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

      gl.deleteTexture(texSrc);
      return true;
    }
  }

  global.FUJI.WebGLEngine = WebGLEngine;

  /* =====================================================================
     CPU Canvas2D fallback engine (same math, per-pixel)
     ===================================================================== */
  class CPUEngine {
    constructor(canvas){ this.canvas=canvas||document.createElement('canvas'); }
    isGPU(){ return false; }
    render(source, destW, destH, params, opts){
      const srcW=source.width||source.videoWidth, srcH=source.height||source.videoHeight;
      if(!srcW||!srcH) return false;
      // draw+downsample into ImageData
      const tmp=document.createElement('canvas'); tmp.width=destW; tmp.height=destH;
      const ctx=tmp.getContext('2d',{ willReadFrequently:true });
      ctx.drawImage(source,0,0,destW,destH);
      const id=ctx.getImageData(0,0,destW,destH);
      const d=id.data;
      const xs=[0,0.15,0.3,0.5,0.7,0.85,1];
      const curveL=xs.map((x,i)=>params.curves.L[i]);
      const curveR=xs.map((x,i)=>params.curves.R[i]);
      const curveG=xs.map((x,i)=>params.curves.G[i]);
      const curveB=xs.map((x,i)=>params.curves.B[i]);
      const lum=global.FUJI.math.LUMA;
      const {clamp01:cl} = global.FUJI.math;
      // helper: sample the 7-point piecewise
      function spl(v, arr){ const xs2=[0,0.15,0.3,0.5,0.7,0.85,1];
        if(v<=0)return arr[0]; if(v>=1)return arr[6];
        for(let i=0;i<6;i++){ if(v<=xs2[i+1]){ const u=(v-xs2[i])/(xs2[i+1]-xs2[i]); return arr[i]+(arr[i+1]-arr[i])*u; } } return arr[6]; }
      const M=params.matrix, wb=params.wb, st=params.st;
      const stateColor = params.hslHasAdjust ? { hsl: params.hsl, hslHasAdjust: true } : null;
      const exp=Math.pow(2,params.exposure);
      const M00=M[0],M01=M[1],M02=M[2],M10=M[3],M11=M[4],M12=M[5],M20=M[6],M21=M[7],M22=M[8];
      const shCol=[0.5+Math.cos(st.sh*Math.PI)*0.5, 0.5+Math.cos(st.sh*Math.PI+2.09439)*0.5, 0.5+Math.cos(st.sh*Math.PI-2.09439)*0.5];
      const hiCol=[0.5+Math.cos(st.hh*Math.PI)*0.5, 0.5+Math.cos(st.hh*Math.PI+2.09439)*0.5, 0.5+Math.cos(st.hh*Math.PI-2.09439)*0.5];
      const vigAmt=cl(Math.max(0,params.vignette));
      const aspect=destW/destH;
      let seed=12345;
      function rnd(){ seed=(seed*1103515245+12345)>>>0; return seed/4294967296; }
      const grainAmt=cl(Math.max(0,params.grainAmt));
      for(let y=0;y<destH;y++){
        // vignette radius for this row
        const yy=(y+0.5)/destH;
        for(let x=0;x<destW;x++){
          const idx=(y*destW+x)*4;
          let r=d[idx]/255, g=d[idx+1]/255, b=d[idx+2]/255;
          // linearize
          r=Math.pow(r,2.4); g=Math.pow(g,2.4); b=Math.pow(b,2.4);
          r*=exp; g*=exp; b*=exp;
          r*=wb[0]; g*=wb[1]; b*=wb[2];
          // HSL (per-pixel, accurate) — do this BEFORE the matrix so hue shifts
          // land on the actual hue range, then the matrix rebalances channels.
          if(stateColor && (stateColor.hslHasAdjust)) {
            const hr = global.FUJI.hsl.apply(r,g,b,stateColor.hsl);
            r=hr[0]; g=hr[1]; b=hr[2];
          }
          // matrix
          const nr=M00*r+M01*g+M02*b, ng=M10*r+M11*g+M12*b, nb=M20*r+M21*g+M22*b;
          r=Math.max(0,Math.min(1.6,nr)); g=Math.max(0,Math.min(1.6,ng)); b=Math.max(0,Math.min(1.6,nb));
          // per-channel curves
          const cr=spl(r,curveR), cg=spl(g,curveG), cb=spl(b,curveB);
          let l=r*lum[0]+g*lum[1]+b*lum[2];
          const lo=spl(l,curveL);
          r=cr+(lo-l)*lum[0]; g=cg+(lo-l)*lum[1]; b=cb+(lo-l)*lum[2];
          r=Math.max(0,Math.min(1.6,r)); g=Math.max(0,Math.min(1.6,g)); b=Math.max(0,Math.min(1.6,b));
          l=r*lum[0]+g*lum[1]+b*lum[2];
          // vibrance
          const vSat=Math.max(r,g,b)-Math.min(r,g,b);
          const boost=1+params.vibrance*(1-vSat);
          l=r*lum[0]+g*lum[1]+b*lum[2];
          r=l+(r-l)*cl(boost); g=l+(g-l)*cl(boost); b=l+(b-l)*cl(boost);
          // split tone (luminance-based)
          const newL=r*lum[0]+g*lum[1]+b*lum[2];
          const tmix=cl((newL-st.bal)*0.5+0.5);
          const shw=1-tmix, hw=tmix;
          // shadow tint
          const shAmt=st.ss*shw, hiAmt=st.hs*hw;
          if(shAmt>0){ const f=shAmt*2; r=r*(1+(shCol[0]-0.5)*2*f); g=g*(1+(shCol[1]-0.5)*2*f); b=b*(1+(shCol[2]-0.5)*2*f); }
          if(hiAmt>0){ const f=hiAmt*2; r=r*(1+(hiCol[0]-0.5)*2*f); g=g*(1+(hiCol[1]-0.5)*2*f); b=b*(1+(hiCol[2]-0.5)*2*f); }
          // vignette
          if(vigAmt>0){
            const xx=(x+0.5)/destW;
            const dx=xx-aspect*0.5, dy=yy-0.5;
            const dist=Math.sqrt(dx*dx+dy*dy);
            const vf=1-vigAmt*global.FUJI.math.smoothstep(0.35,0.95,dist);
            r*=vf; g*=vf; b*=vf;
          }
          // encode
          r=Math.pow(Math.max(0,r),1/2.4); g=Math.pow(Math.max(0,g),1/2.4); b=Math.pow(Math.max(0,b),1/2.4);
          // grain
          if(grainAmt>0){
            const gs=global.FUJI.math.clamp01((params.grainSize*0.7+0.5));
            const n=(rnd()-0.5)*2*grainAmt*0.14;
            r+=n; g+=n; b+=n;
          }
          d[idx]=Math.round(cl(r)*255); d[idx+1]=Math.round(cl(g)*255); d[idx+2]=Math.round(cl(b)*255); d[idx+3]=255;
        }
      }
      ctx.putImageData(id,0,0);
      const outCanvas = opts&&opts.into ? opts.into : this.canvas;
      outCanvas.width=destW; outCanvas.height=destH;
      outCanvas.getContext('2d').drawImage(tmp,0,0);
      return true;
    }
  }

  global.FUJI.CPUEngine = CPUEngine;
  global.FUJI.createEngine = function(canvas){
    const g=new WebGLEngine(canvas);
    if(g.isGPU()) return g;
    return new CPUEngine(canvas);
  };
  /* Convenience: render source->destCanvas with baked params using a target-scoped engine */
  global.FUJI.renderToCanvas = function(source, destCanvas, params){
    const eng = new WebGLEngine(destCanvas);
    if(eng.isGPU()) eng.render(source, destCanvas.width, destCanvas.height, params);
    else {
      const cpu=new CPUEngine(destCanvas);
      cpu.render(source, destCanvas.width, destCanvas.height, params, {into:destCanvas});
    }
    return destCanvas;
  };
})(typeof window!=="undefined"?window:globalThis);
