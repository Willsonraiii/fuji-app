/* =====================================================================
   F-UJI — Original film profile library.
   Legally distinct, inspired by photographic characteristics of classic
   films. No Fuji/Kodak/etc proprietary LUTs or algorithms are used here —
   every profile is hand-crafted from first principles (tone curves,
   color matrices, grain, halation).
   ===================================================================== */
(function (global) {
  "use strict";
  const M = global.FUJI.math;

  /* ---------- helpers ---------- */
  function S(s){ return M.satMatrix(s); }
  function DIAG(r,g,b){ return [r,0,0, 0,g,0, 0,0,b]; }
  function mul(a,b){ return M.matMultiply(a,b); }
  function hueRot(deg){
    const H=deg*Math.PI/180, u=Math.cos(H), v=Math.sin(H);
    return [
      0.299+0.701*u+0.168*v, 0.587-0.587*u+0.330*v, 0.114-0.114*u-0.497*v,
      0.299-0.299*u-0.328*v, 0.587+0.413*u+0.035*v, 0.114-0.114*u+0.292*v,
      0.299-0.300*u+1.250*v, 0.587-0.588*u-1.050*v, 0.114+0.886*u-0.203*v
    ];
  }
  function P(x,y){ return {x,y}; }
  function crv(){ return Array.prototype.slice.call(arguments); }

  const PROFILES = [];
  function def(o){ PROFILES.push(o); }

  /* Short curve shapes reused across profiles */
  const SOFT_S = crv(P(0,0.02),P(0.15,0.16),P(0.3,0.31),P(0.5,0.5),P(0.7,0.7),P(0.85,0.84),P(1,0.99));
  const STRONG_S= crv(P(0,0.0),P(0.15,0.2),P(0.3,0.36),P(0.5,0.5),P(0.7,0.66),P(0.85,0.82),P(1,1.0));
  const LIFTED  = crv(P(0,0.04),P(0.15,0.18),P(0.3,0.32),P(0.5,0.5),P(0.7,0.69),P(0.85,0.84),P(1,0.97));
  const FLAT    = crv(P(0,0.03),P(0.15,0.18),P(0.3,0.33),P(0.5,0.5),P(0.7,0.67),P(0.85,0.82),P(1,0.97));
  const HARD_NIC= crv(P(0,0.0),P(0.15,0.22),P(0.3,0.37),P(0.5,0.5),P(0.7,0.63),P(0.85,0.78),P(1,1.0));
  const VINTAGE = crv(P(0,0.05),P(0.15,0.2),P(0.3,0.33),P(0.5,0.5),P(0.7,0.65),P(0.85,0.8),P(1,0.93));
  const PURE    = crv(P(0,0),P(0.15,0.2),P(0.3,0.36),P(0.5,0.5),P(0.7,0.64),P(0.85,0.8),P(1,1));

  /* ================= REAL FUJIFILM FILM SIMULATIONS =================
     Hand-tuned recreations of Fujifilm's classic film simulation
     characteristics (tone, color response, grain, halation). No
     proprietary LUTs — first-principles curve/matrix recipes only. */

  /* Provia — accurate, slightly saturated standard slide */
  def({
    id:"fuji-provia", name:"Provia", sim:true, fujiSim:"provia",
    type:"Simulation", tagline:"Standard balanced transparency",
    swatch:"#4a8f7a",
    engine:{
      matrix: mul( S(1.06), mul( hueRot(-1), DIAG(1.0,1.0,1.0) ) ),
      channelCurves: [ SOFT_S, SOFT_S, SOFT_S ],
      lumaCurve: SOFT_S, saturation:1.06, exposure:0.01,
      grainAmt:0.35, grainSize:0.5, halation:0.04, bloom:0.0, vignette:0.10,
      split:{ sh:0.5, ss:0.05, hh:0.5, hs:0.04 }, vibrance:0.05
    }
  });

  /* Velvia 50 — vivid saturated landscape chrome (magenta cast, warm) */
  def({
    id:"fuji-velvia", name:"Velvia 50", sim:true, fujiSim:"velvia",
    type:"Simulation", tagline:"Vivid magenta-rich landscape chrome",
    swatch:"#c4453a",
    engine:{
      matrix: mul( S(1.42), mul( hueRot(4), DIAG(1.06,1.0,1.04) ) ),
      channelCurves: [ STRONG_S, STRONG_S, STRONG_S ],
      lumaCurve: STRONG_S, saturation:1.42, exposure:-0.02,
      grainAmt:0.45, grainSize:0.55, halation:0.04, bloom:0.01, vignette:0.20,
      split:{ sh:0.6, ss:0.14, hh:0.06, hs:0.14 }, vibrance:0.28
    }
  });

  /* Velvia Vivid — Fujifilm's punchier Vivid variant */
  def({
    id:"fuji-velvia-vivid", name:"Velvia Vivid", sim:true, fujiSim:"velvia-vivid",
    type:"Simulation", tagline:"Extra punchy vivid chrome",
    swatch:"#b23333",
    engine:{
      matrix: mul( S(1.36), mul( hueRot(-7), DIAG(1.04,1.02,1.06) ) ),
      channelCurves: [ STRONG_S, STRONG_S, STRONG_S ],
      lumaCurve: STRONG_S, saturation:1.36, exposure:-0.03,
      grainAmt:0.4, grainSize:0.5, halation:0.03, bloom:0.01, vignette:0.20,
      split:{ sh:0.55, ss:0.10, hh:0.08, hs:0.10 }, vibrance:0.25
    }
  });

  /* Fortia SP — rare ultra-saturated look, bold greens, strong contrast */
  def({
    id:"fuji-fortia-sp", name:"Fortia SP", sim:true, fujiSim:"fortia-sp",
    type:"Simulation", tagline:"Ultra-vivid greens, strong contrast",
    swatch:"#4f9e4f",
    engine:{
      matrix: mul( S(1.5), mul( hueRot(2), DIAG(1.02,1.07,0.97) ) ),
      channelCurves: [ STRONG_S, STRONG_S, STRONG_S ],
      lumaCurve: STRONG_S, saturation:1.5, exposure:-0.02,
      grainAmt:0.4, grainSize:0.5, halation:0.03, bloom:0.01, vignette:0.22,
      split:{ sh:0.55, ss:0.14, hh:0.08, hs:0.12 }, vibrance:0.30
    }
  });

  /* Neopan 1600 — gritty high-contrast black & white */
  def({
    id:"fuji-neopan-1600", name:"Neopan 1600", sim:true, fujiSim:"neopan-1600", bw:true,
    type:"Simulation", tagline:"Gritty high-contrast monochrome",
    swatch:"#6b6b6b",
    engine:{
      matrix: S(0.0),
      channelCurves: [ HARD_NIC, HARD_NIC, HARD_NIC ],
      lumaCurve: HARD_NIC, saturation:0.0, exposure:0.0,
      grainAmt:1.0, grainSize:0.7, halation:0.0, bloom:0.0, vignette:0.22,
      split:{ sh:0.5, ss:0.03, hh:0.5, hs:0.02 }, vibrance:0
    }
  });

  /* T64 — tungsten-balanced chrome, cool blue cast */
  def({
    id:"fuji-t64", name:"T64", sim:true, fujiSim:"t64",
    type:"Simulation", tagline:"Tungsten-balanced cool chrome",
    swatch:"#4a7b9e",
    engine:{
      matrix: mul( S(0.95), mul( hueRot(-4), DIAG(0.97,1.0,1.09) ) ),
      channelCurves: [ FLAT, FLAT, FLAT ],
      lumaCurve: FLAT, saturation:0.95, exposure:0.02,
      grainAmt:0.5, grainSize:0.5, halation:0.06, bloom:0.02, vignette:0.14,
      split:{ sh:0.12, ss:0.16, hh:0.06, hs:0.10 }, vibrance:-0.05
    }
  });

  /* Pro 800Z — fast, dim-light negative, rich reds */
  def({
    id:"fuji-pro-800z", name:"Pro 800Z", sim:true, fujiSim:"pro-800z",
    type:"Simulation", tagline:"Rich saturated fast negative",
    swatch:"#c94f3d",
    engine:{
      matrix: mul( S(1.25), mul( hueRot(-2), DIAG(1.09,1.0,0.94) ) ),
      channelCurves: [ STRONG_S, STRONG_S, STRONG_S ],
      lumaCurve: STRONG_S, saturation:1.25, exposure:-0.01,
      grainAmt:0.55, grainSize:0.55, halation:0.10, bloom:0.03, vignette:0.18,
      split:{ sh:0.32, ss:0.12, hh:0.05, hs:0.12 }, vibrance:0.20
    }
  });

  /* Pro 400H — green-cast, soft wide-latitude negative */
  def({
    id:"fuji-pro-400h", name:"Pro 400H", sim:true, fujiSim:"pro-400h",
    type:"Simulation", tagline:"Fresh green-cast soft negative",
    swatch:"#7da67e",
    engine:{
      matrix: mul( S(0.95), mul( hueRot(2), DIAG(1.0,1.07,0.97) ) ),
      channelCurves: [ FLAT, FLAT, FLAT ],
      lumaCurve: FLAT, saturation:0.95, exposure:0.05,
      grainAmt:0.45, grainSize:0.5, halation:0.08, bloom:0.03, vignette:0.12,
      split:{ sh:0.5, ss:0.05, hh:0.06, hs:0.04 }, vibrance:0.04
    }
  });

  /* Pro 160C — rich colors, stronger contrast */
  def({
    id:"fuji-pro-160c", name:"Pro 160C", sim:true, fujiSim:"pro-160c",
    type:"Simulation", tagline:"Rich crisp professional negative",
    swatch:"#c78a5a",
    engine:{
      matrix: mul( S(1.15), mul( hueRot(-1), DIAG(1.06,1.02,0.96) ) ),
      channelCurves: [ STRONG_S, SOFT_S, SOFT_S ],
      lumaCurve: STRONG_S, saturation:1.15, exposure:0.01,
      grainAmt:0.35, grainSize:0.5, halation:0.08, bloom:0.02, vignette:0.14,
      split:{ sh:0.4, ss:0.10, hh:0.06, hs:0.08 }, vibrance:0.12
    }
  });

  /* Pro 160S — soft natural, low contrast, wedding/portrait */
  def({
    id:"fuji-pro-160s", name:"Pro 160S", sim:true, fujiSim:"pro-160s",
    type:"Simulation", tagline:"Soft natural low-contrast portrait",
    swatch:"#d3b094",
    engine:{
      matrix: mul( S(0.9), mul( hueRot(0), DIAG(1.03,1.0,0.99) ) ),
      channelCurves: [ FLAT, FLAT, FLAT ],
      lumaCurve: FLAT, saturation:0.9, exposure:0.05,
      grainAmt:0.3, grainSize:0.5, halation:0.06, bloom:0.03, vignette:0.12,
      split:{ sh:0.1, ss:0.05, hh:0.5, hs:0.04 }, vibrance:0.08
    }
  });

  /* Provia 400X — deep natural colors, moderate contrast */
  def({
    id:"fuji-provia-400x", name:"Provia 400X", sim:true, fujiSim:"provia-400x",
    type:"Simulation", tagline:"Deep natural moderate-contrast slide",
    swatch:"#5a9a83",
    engine:{
      matrix: mul( S(1.12), mul( hueRot(0), DIAG(1.01,1.0,1.0) ) ),
      channelCurves: [ SOFT_S, SOFT_S, SOFT_S ],
      lumaCurve: SOFT_S, saturation:1.12, exposure:0.0,
      grainAmt:0.5, grainSize:0.5, halation:0.05, bloom:0.01, vignette:0.12,
      split:{ sh:0.5, ss:0.06, hh:0.45, hs:0.05 }, vibrance:0.08
    }
  });

  /* Provia 400X X-Pro — cross-processed: bold contrast, yellow hues */
  def({
    id:"fuji-provia-400x-xpro", name:"Provia 400X X-Pro", sim:true, fujiSim:"provia-400x-xpro",
    type:"Simulation", tagline:"Cross-processed bold yellow cast",
    swatch:"#c9b04a",
    engine:{
      matrix: mul( S(1.3), mul( hueRot(6), DIAG(1.07,1.03,0.89) ) ),
      channelCurves: [ STRONG_S, STRONG_S, STRONG_S ],
      lumaCurve: STRONG_S, saturation:1.3, exposure:0.02,
      grainAmt:0.6, grainSize:0.55, halation:0.06, bloom:0.02, vignette:0.18,
      split:{ sh:0.15, ss:0.20, hh:0.05, hs:0.16 }, vibrance:0.20
    }
  });

  /* Superia 1600 — low contrast, natural colors, greenish fade */
  def({
    id:"fuji-superia-1600", name:"Superia 1600", sim:true, fujiSim:"superia-1600",
    type:"Simulation", tagline:"Soft greenish-fade high-speed negative",
    swatch:"#9aa86a",
    engine:{
      matrix: mul( S(0.88), mul( hueRot(2), DIAG(1.0,1.05,0.96) ) ),
      channelCurves: [ LIFTED, LIFTED, LIFTED ],
      lumaCurve: LIFTED, saturation:0.88, exposure:0.06,
      grainAmt:0.85, grainSize:0.65, halation:0.08, bloom:0.03, vignette:0.14,
      split:{ sh:0.5, ss:0.10, hh:0.05, hs:0.05 }, vibrance:-0.03
    }
  });

  /* Superia 400 — natural color, medium contrast, green + pink cast */
  def({
    id:"fuji-superia-400", name:"Superia 400", sim:true, fujiSim:"superia-400",
    type:"Simulation", tagline:"All-purpose green-pink consumer negative",
    swatch:"#b58a8a",
    engine:{
      matrix: mul( S(1.02), mul( hueRot(3), DIAG(1.07,1.03,0.96) ) ),
      channelCurves: [ SOFT_S, SOFT_S, SOFT_S ],
      lumaCurve: SOFT_S, saturation:1.02, exposure:0.02,
      grainAmt:0.5, grainSize:0.5, halation:0.07, bloom:0.02, vignette:0.14,
      split:{ sh:0.4, ss:0.08, hh:0.06, hs:0.08 }, vibrance:0.06
    }
  });

  /* Superia 100 — daylight balanced, cool shadows, warm highlights */
  def({
    id:"fuji-superia-100", name:"Superia 100", sim:true, fujiSim:"superia-100",
    type:"Simulation", tagline:"Daylight vibrant, cool shadows warm highlights",
    swatch:"#a8b57f",
    engine:{
      matrix: mul( S(1.1), mul( hueRot(0), DIAG(1.03,1.0,1.01) ) ),
      channelCurves: [ SOFT_S, SOFT_S, SOFT_S ],
      lumaCurve: SOFT_S, saturation:1.1, exposure:0.03,
      grainAmt:0.4, grainSize:0.5, halation:0.05, bloom:0.02, vignette:0.13,
      split:{ sh:0.12, ss:0.10, hh:0.05, hs:0.12 }, vibrance:0.10
    }
  });

  /* Astia 100F — soft pastel portrait slide */
  def({
    id:"fuji-astia", name:"Astia 100F", sim:true, fujiSim:"astia",
    type:"Simulation", tagline:"Gentle pastel portrait transparency",
    swatch:"#d99a7a",
    engine:{
      matrix: mul( S(0.94), mul( hueRot(1), DIAG(1.05,1.0,0.99) ) ),
      channelCurves: [ crv(P(0,0.04),P(0.3,0.34),P(0.5,0.51),P(0.7,0.69),P(1,0.96)),
                       crv(P(0,0.03),P(0.3,0.32),P(0.5,0.5),P(0.7,0.69),P(1,0.98)),
                       crv(P(0,0.02),P(0.3,0.31),P(0.5,0.49),P(0.7,0.67),P(1,0.98)) ],
      lumaCurve: FLAT, saturation:0.94, exposure:0.04,
      grainAmt:0.3, grainSize:0.5, halation:0.08, bloom:0.03, vignette:0.12,
      split:{ sh:0.15, ss:0.08, hh:0.4, hs:0.09 }, vibrance:0.12
    }
  });

  /* Classic Chrome — muted matte documentary */
  def({
    id:"fuji-classic-chrome", name:"Classic Chrome", sim:true, fujiSim:"classic-chrome",
    type:"Simulation", tagline:"Muted matte documentary look",
    swatch:"#c9b08a",
    engine:{
      matrix: mul( S(0.72), mul( hueRot(2), DIAG(1.05,0.99,0.95) ) ),
      channelCurves: [ crv(P(0,0.05),P(0.3,0.33),P(0.5,0.5),P(0.7,0.66),P(1,0.92)),
                       crv(P(0,0.04),P(0.3,0.32),P(0.5,0.5),P(0.7,0.67),P(1,0.94)),
                       crv(P(0,0.02),P(0.3,0.30),P(0.5,0.49),P(0.7,0.67),P(1,0.95)) ],
      lumaCurve: FLAT, saturation:0.72, exposure:0.05,
      grainAmt:0.5, grainSize:0.5, halation:0.12, bloom:0.06, vignette:0.10,
      split:{ sh:0.12, ss:0.12, hh:0.08, hs:0.10 }, vibrance:-0.08
    }
  });

  /* Classic Negative — rich contrast, warm highs, deep cool lows */
  def({
    id:"fuji-classic-neg", name:"Classic Negative", sim:true, fujiSim:"classic-negative",
    type:"Simulation", tagline:"Rich nostalgic negative",
    swatch:"#6a8f5c",
    engine:{
      matrix: mul( S(0.85), mul( hueRot(-3), DIAG(1.04,1.05,0.97) ) ),
      channelCurves: [ crv(P(0,0.02),P(0.3,0.31),P(0.5,0.49),P(0.7,0.68),P(1,0.93)),
                       crv(P(0,0.03),P(0.3,0.33),P(0.5,0.51),P(0.7,0.71),P(1,0.98)),
                       crv(P(0,0.00),P(0.3,0.28),P(0.5,0.46),P(0.7,0.65),P(1,0.94)) ],
      lumaCurve: LIFTED, saturation:0.85, exposure:0.02,
      grainAmt:0.5, grainSize:0.55, halation:0.10, bloom:0.02, vignette:0.16,
      split:{ sh:0.62, ss:0.18, hh:0.05, hs:0.08 }, vibrance:0.06
    }
  });

  /* Eterna — flat cinematic neutral */
  def({
    id:"fuji-eterna", name:"Eterna", sim:true, fujiSim:"eterna",
    type:"Simulation", tagline:"Flat cinematic neutral",
    swatch:"#7d9294",
    engine:{
      matrix: mul( S(0.70), mul( hueRot(3), DIAG(0.99,1.02,1.0) ) ),
      channelCurves: [ FLAT, FLAT, FLAT ],
      lumaCurve: FLAT, saturation:0.70, exposure:0.06,
      grainAmt:0.7, grainSize:0.5, halation:0.02, bloom:0.02, vignette:0.10,
      split:{ sh:0.5, ss:0.10, hh:0.5, hs:0.05 }, vibrance:-0.05
    }
  });

  /* Eterna Bleach Bypass — desaturated high-contrast */
  def({
    id:"fuji-eterna-bb", name:"Eterna Bleach Bypass", sim:true, fujiSim:"eterna-bleach-bypass",
    type:"Simulation", tagline:"High-contrast cinematic",
    swatch:"#a4a59e",
    engine:{
      matrix: mul( S(0.55), mul( hueRot(-2), DIAG(1.02,1.0,0.96) ) ),
      channelCurves: [ HARD_NIC, HARD_NIC, HARD_NIC ],
      lumaCurve: HARD_NIC, saturation:0.55, exposure:0.04,
      grainAmt:0.85, grainSize:0.6, halation:0.05, bloom:0.02, vignette:0.20,
      split:{ sh:0.68, ss:0.16, hh:0.06, hs:0.12 }, vibrance:-0.10
    }
  });

  /* Nostalgic Neg — warm amber faded */
  def({
    id:"fuji-nostalgic-neg", name:"Nostalgic Neg.", sim:true, fujiSim:"nostalgic-neg",
    type:"Simulation", tagline:"Warm amber faded negative",
    swatch:"#c9934f",
    engine:{
      matrix: mul( S(0.80), mul( hueRot(3), DIAG(1.09,1.02,0.90) ) ),
      channelCurves: [ crv(P(0,0.06),P(0.3,0.34),P(0.5,0.51),P(0.7,0.68),P(1,0.90)),
                       crv(P(0,0.05),P(0.3,0.33),P(0.5,0.50),P(0.7,0.68),P(1,0.93)),
                       crv(P(0,0.02),P(0.3,0.29),P(0.5,0.47),P(0.7,0.66),P(1,0.94)) ],
      lumaCurve: VINTAGE, saturation:0.80, exposure:0.07,
      grainAmt:0.6, grainSize:0.6, halation:0.30, bloom:0.08, vignette:0.18,
      split:{ sh:0.55, ss:0.22, hh:0.05, hs:0.10 }, vibrance:-0.05
    }
  });

  /* Reala Ace — accurate, fine, slightly neutralized */
  def({
    id:"fuji-reala-ace", name:"Reala Ace", sim:true, fujiSim:"reala-ace",
    type:"Simulation", tagline:"Accurate fine neutral",
    swatch:"#8f9a6c",
    engine:{
      matrix: mul( S(0.96), mul( hueRot(-2), DIAG(1.02,1.04,0.98) ) ),
      channelCurves: [ SOFT_S, SOFT_S, SOFT_S ],
      lumaCurve: SOFT_S, saturation:0.96, exposure:0.02,
      grainAmt:0.35, grainSize:0.5, halation:0.05, bloom:0.0, vignette:0.10,
      split:{ sh:0.58, ss:0.06, hh:0.45, hs:0.04 }, vibrance:0.06
    }
  });

  /* Pro Neg Hi — punchy portrait */
  def({
    id:"fuji-pro-neg-hi", name:"Pro Neg. Hi", sim:true, fujiSim:"pro-neg-hi",
    type:"Simulation", tagline:"Punchy portrait skin",
    swatch:"#d49a6e",
    engine:{
      matrix: mul( S(1.04), mul( hueRot(-2), DIAG(1.08,1.01,0.95) ) ),
      channelCurves: [ SOFT_S, SOFT_S, SOFT_S ],
      lumaCurve: SOFT_S, saturation:1.04, exposure:0.04,
      grainAmt:0.3, grainSize:0.5, halation:0.10, bloom:0.02, vignette:0.12,
      split:{ sh:0.18, ss:0.10, hh:0.04, hs:0.06 }, vibrance:0.10
    }
  });

  /* Pro Neg Std — soft neutral portrait */
  def({
    id:"fuji-pro-neg-std", name:"Pro Neg. Std", sim:true, fujiSim:"pro-neg-std",
    type:"Simulation", tagline:"Soft neutral portrait",
    swatch:"#caa78a",
    engine:{
      matrix: mul( S(0.94), mul( hueRot(0), DIAG(1.04,1.0,0.97) ) ),
      channelCurves: [ crv(P(0,0.03),P(0.3,0.33),P(0.5,0.51),P(0.7,0.69),P(1,0.96)),
                       crv(P(0,0.02),P(0.3,0.31),P(0.5,0.5),P(0.7,0.7),P(1,0.99)),
                       crv(P(0,0.02),P(0.3,0.31),P(0.5,0.49),P(0.7,0.68),P(1,0.99)) ],
      lumaCurve: FLAT, saturation:0.94, exposure:0.05,
      grainAmt:0.25, grainSize:0.5, halation:0.08, bloom:0.02, vignette:0.11,
      split:{ sh:0.08, ss:0.06, hh:0.05, hs:0.05 }, vibrance:0.08
    }
  });

  /* Monochrome — clean neutral mono */
  def({
    id:"fuji-mono", name:"Monochrome", sim:true, fujiSim:"monochrome", bw:true,
    type:"Simulation", tagline:"Clean neutral monochrome",
    swatch:"#8a8a8e",
    engine:{
      matrix: S(0.0),
      channelCurves: [ PURE, PURE, PURE ],
      lumaCurve: SOFT_S, saturation:0.0, exposure:0.02,
      grainAmt:0.8, grainSize:0.5, halation:0.0, bloom:0.0, vignette:0.14,
      split:{ sh:0.7, ss:0.05, hh:0.05, hs:0.05 }, vibrance:0
    }
  });

  /* Acros +R / +Y / +G — fine-grain mono with filters */
  def({
    id:"fuji-acros-r", name:"Acros +R", sim:true, fujiSim:"acros-r", bw:true,
    type:"Simulation", tagline:"Acros with red filter",
    swatch:"#7a4040",
    engine:{
      matrix: S(0.0),
      channelCurves: [
        crv(P(0,0.02),P(0.3,0.20),P(0.5,0.42),P(0.7,0.70),P(1,0.99)),
        crv(P(0,0.04),P(0.3,0.30),P(0.5,0.50),P(0.7,0.70),P(1,0.99)),
        crv(P(0,0.06),P(0.3,0.40),P(0.5,0.58),P(0.7,0.74),P(1,1.0))
      ],
      lumaCurve: SOFT_S, saturation:0.0, exposure:0.02,
      grainAmt:0.85, grainSize:0.5, halation:0.0, bloom:0.0, vignette:0.16,
      split:{ sh:0.7, ss:0.04, hh:0.05, hs:0.02 }, vibrance:0
    }
  });
  def({
    id:"fuji-acros-y", name:"Acros +Y", sim:true, fujiSim:"acros-y", bw:true,
    type:"Simulation", tagline:"Acros with yellow filter",
    swatch:"#9a8a55",
    engine:{
      matrix: S(0.0),
      channelCurves: [
        crv(P(0,0.02),P(0.3,0.26),P(0.5,0.46),P(0.7,0.72),P(1,0.99)),
        crv(P(0,0.03),P(0.3,0.32),P(0.5,0.50),P(0.7,0.72),P(1,0.99)),
        crv(P(0,0.04),P(0.3,0.36),P(0.5,0.54),P(0.7,0.72),P(1,1.0))
      ],
      lumaCurve: SOFT_S, saturation:0.0, exposure:0.02,
      grainAmt:0.85, grainSize:0.5, halation:0.0, bloom:0.0, vignette:0.14,
      split:{ sh:0.5, ss:0.04, hh:0.05, hs:0.02 }, vibrance:0
    }
  });
  def({
    id:"fuji-acros-g", name:"Acros +G", sim:true, fujiSim:"acros-g", bw:true,
    type:"Simulation", tagline:"Acros with green filter",
    swatch:"#5d8060",
    engine:{
      matrix: S(0.0),
      channelCurves: [
        crv(P(0,0.02),P(0.3,0.28),P(0.5,0.46),P(0.7,0.70),P(1,0.99)),
        crv(P(0,0.04),P(0.3,0.36),P(0.5,0.56),P(0.7,0.76),P(1,1.0)),
        crv(P(0,0.03),P(0.3,0.30),P(0.5,0.48),P(0.7,0.70),P(1,0.99))
      ],
      lumaCurve: SOFT_S, saturation:0.0, exposure:0.02,
      grainAmt:0.85, grainSize:0.5, halation:0.0, bloom:0.0, vignette:0.14,
      split:{ sh:0.3, ss:0.06, hh:0.55, hs:0.02 }, vibrance:0
    }
  });

  /* Sepia — warm tinted mono */
  def({
    id:"fuji-sepia", name:"Sepia", sim:true, fujiSim:"sepia", bw:true,
    type:"Simulation", tagline:"Warm sepia tint",
    swatch:"#a6824a",
    engine:{
      matrix: mul( S(0.0), mul( hueRot(-8), DIAG(1.18,1.06,0.86) ) ),
      channelCurves: [ VINTAGE, VINTAGE, VINTAGE ],
      lumaCurve: VINTAGE, saturation:0.55, exposure:0.04,
      grainAmt:0.7, grainSize:0.6, halation:0.12, bloom:0.04, vignette:0.18,
      split:{ sh:0.12, ss:0.16, hh:0.10, hs:0.08 }, vibrance:0
    }
  });

  /* importable into global namespace */
  global.FUJI.profiles = PROFILES;
  global.FUJI.getProfile = function(id){ return PROFILES.find(p=>p.id===id)||PROFILES[0]; };
  global.FUJI.simProfiles = function(){ return PROFILES.filter(p=>p.sim); };

})(typeof window!=="undefined"?window:globalThis);
