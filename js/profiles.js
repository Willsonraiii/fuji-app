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

  /* ================= PROFILES ================= */

  /* 1. Evergreen 400 — rich negative :: Classic Negative style */
  def({
    id:"evergreen400", name:"Evergreen 400", type:"Color Negative", tagline:"Classic rich negative",
    swatch:"#6a8f5c",
    engine:{
      matrix: mul( S(0.82), mul( hueRot(-4), DIAG(1.03, 1.06, 0.97) ) ),
      channelCurves: [ crv(P(0,0.02),P(0.3,0.32),P(0.5,0.5),P(0.7,0.71),P(1,0.99)),
                       crv(P(0,0.03),P(0.3,0.34),P(0.5,0.52),P(0.7,0.72),P(1,0.98)),
                       crv(P(0,0.01),P(0.3,0.30),P(0.5,0.48),P(0.7,0.68),P(1,0.97)) ],
      lumaCurve: LIFTED, saturation:0.82, exposure:0.03,
      grainAmt:0.5, grainSize:0.55, halation:0.10, bloom:0.0, vignette:0.18,
      split:{ sh:0.60, ss:0.18, hh:0.08, hs:0.10 },
      vibrance:0.08
    }
  });

  /* 2. Chrome Classic — faded flat :: Classic Chrome style */
  def({
    id:"chromedust", name:"Chrome Dust", type:"Chrome", tagline:"Faded flat chrome",
    swatch:"#c9b08a",
    engine:{
      matrix: mul( S(0.70), mul( hueRot(2), DIAG(1.05,0.99,0.95) ) ),
      channelCurves: [ crv(P(0,0.05),P(0.3,0.33),P(0.5,0.5),P(0.7,0.66),P(1,0.92)),
                       crv(P(0,0.04),P(0.3,0.32),P(0.5,0.5),P(0.7,0.67),P(1,0.94)),
                       crv(P(0,0.02),P(0.3,0.30),P(0.5,0.49),P(0.7,0.67),P(1,0.95)) ],
      lumaCurve: FLAT, saturation:0.70, exposure:0.05,
      grainAmt:0.55, grainSize:0.5, halation:0.12, bloom:0.06, vignette:0.10,
      split:{ sh:0.10, ss:0.10, hh:1.55, hs:0.12 },
      vibrance:-0.10
    }
  });

  /* 3. Monochrome MK II — clean mono :: Acros style */
  def({
    id:"monomodern", name:"Monochrome Modern", type:"B&W", tagline:"Clean fine mono",
    bw:true, swatch:"#8a8a8e",
    engine:{
      matrix: S(0.0),
      channelCurves: [ PURE, PURE, PURE ],
      lumaCurve: SOFT_S, saturation:0.0, exposure:0.02,
      grainAmt:0.9, grainSize:0.5, halation:0.0, bloom:0.0, vignette:0.15,
      split:{ sh:0.8, ss:0.06, hh:0.05, hs:0.05 }, vibrance:0
    }
  });

  /* 4. Neo Stage — cinematic flat :: Eterna style */
  def({
    id:"neostage", name:"Neo Stage", type:"Cinematic", tagline:"Flat cinematic neutral",
    swatch:"#7d9294",
    engine:{
      matrix: mul( S(0.68), mul( hueRot(3), DIAG(0.99,1.02,1.0) ) ),
      channelCurves: [ FLAT, FLAT, FLAT ],
      lumaCurve: FLAT, saturation:0.68, exposure:0.06,
      grainAmt:0.7, grainSize:0.5, halation:0.02, bloom:0.02, vignette:0.12,
      split:{ sh:1.0, ss:0.16, hh:0.5, hs:0.05 }, vibrance:-0.05
    }
  });

  /* 5. Velvet 50 — vivid saturated :: Velvia style */
  def({
    id:"velvet50", name:"Velvet 50", type:"Chrome", tagline:"Vivid saturated chrome",
    swatch:"#c4453a",
    engine:{
      matrix: mul( S(1.28), mul( hueRot(-6), DIAG(1.03,1.02,1.05) ) ),
      channelCurves: [ STRONG_S, STRONG_S, STRONG_S ],
      lumaCurve: STRONG_S, saturation:1.28, exposure:-0.02,
      grainAmt:0.5, grainSize:0.55, halation:0.04, bloom:0.01, vignette:0.22,
      split:{ sh:0.55, ss:0.12, hh:0.1, hs:0.08 }, vibrance:0.2
    }
  });

  /* 6. Provia Soft — accurate natural :: Provia style */
  def({
    id:"proviasoft", name:"Provia Soft", type:"Slide", tagline:"Accurate natural color",
    swatch:"#4a8f7a",
    engine:{
      matrix: mul( S(1.06), mul( hueRot(-1), DIAG(1.0,1.0,1.0) ) ),
      channelCurves: [ SOFT_S, SOFT_S, SOFT_S ],
      lumaCurve: SOFT_S, saturation:1.06, exposure:0.01,
      grainAmt:0.35, grainSize:0.5, halation:0.04, bloom:0.0, vignette:0.12,
      split:{ sh:0.5, ss:0.05, hh:0.5, hs:0.04 }, vibrance:0.05
    }
  });

  /* 7. Astia Gentle — soft portrait :: Astia style */
  def({
    id:"astiagentle", name:"Astia Gentle", type:"Portrait", tagline:"Soft pastel portrait",
    swatch:"#d99a7a",
    engine:{
      matrix: mul( S(0.92), mul( hueRot(1), DIAG(1.05,1.0,0.99) ) ),
      channelCurves: [ crv(P(0,0.04),P(0.3,0.34),P(0.5,0.51),P(0.7,0.69),P(1,0.96)),
                       crv(P(0,0.03),P(0.3,0.32),P(0.5,0.5),P(0.7,0.69),P(1,0.98)),
                       crv(P(0,0.02),P(0.3,0.31),P(0.5,0.49),P(0.7,0.67),P(1,0.98)) ],
      lumaCurve: FLAT, saturation:0.92, exposure:0.04,
      grainAmt:0.3, grainSize:0.5, halation:0.08, bloom:0.03, vignette:0.14,
      split:{ sh:0.15, ss:0.08, hh:0.4, hs:0.09 }, vibrance:0.12
    }
  });

  /* 8. Nostalgia — warm faded :: Nostalgic Negative style */
  def({
    id:"nostalgia", name:"Nostalgia", type:"Color Negative", tagline:"Warm amber fade",
    swatch:"#c9934f",
    engine:{
      matrix: mul( S(0.78), mul( hueRot(3), DIAG(1.09,1.02,0.90) ) ),
      channelCurves: [ crv(P(0,0.06),P(0.3,0.34),P(0.5,0.51),P(0.7,0.68),P(1,0.9)),
                       crv(P(0,0.05),P(0.3,0.33),P(0.5,0.5),P(0.7,0.68),P(1,0.93)),
                       crv(P(0,0.02),P(0.3,0.29),P(0.5,0.47),P(0.7,0.66),P(1,0.94)) ],
      lumaCurve: VINTAGE, saturation:0.78, exposure:0.07,
      grainAmt:0.6, grainSize:0.6, halation:0.3, bloom:0.08, vignette:0.2,
      split:{ sh:0.55, ss:0.22, hh:0.05, hs:0.10 }, vibrance:-0.05
    }
  });

  /* 9. Reala Auto — muted accurate :: Reala style */
  def({
    id:"realaauto", name:"Reala Auto", type:"Color Negative", tagline:"Fine muted negative",
    swatch:"#8f9a6c",
    engine:{
      matrix: mul( S(0.9), mul( hueRot(-2), DIAG(1.02,1.04,0.98) ) ),
      channelCurves: [ SOFT_S, SOFT_S, SOFT_S ],
      lumaCurve: SOFT_S, saturation:0.9, exposure:0.02,
      grainAmt:0.35, grainSize:0.5, halation:0.05, bloom:0.0, vignette:0.12,
      split:{ sh:0.6, ss:0.06, hh:0.4, hs:0.04 }, vibrance:0.06
    }
  });

  /* 10. Pro Neg Warm — soft skin :: Pro Neg style */
  def({
    id:"proneg", name:"Pro Neg Warm", type:"Portrait", tagline:"Soft warm portrait",
    swatch:"#d7924f",
    engine:{
      matrix: mul( S(0.98), mul( hueRot(0), DIAG(1.06,1.0,0.97) ) ),
      channelCurves: [ crv(P(0,0.03),P(0.3,0.33),P(0.5,0.51),P(0.7,0.7),P(1,0.97)),
                       crv(P(0,0.02),P(0.3,0.31),P(0.5,0.5),P(0.7,0.7),P(1,0.99)),
                       crv(P(0,0.02),P(0.3,0.31),P(0.5,0.5),P(0.7,0.69),P(1,0.99)) ],
      lumaCurve: FLAT, saturation:0.98, exposure:0.05,
      grainAmt:0.3, grainSize:0.5, halation:0.10, bloom:0.03, vignette:0.14,
      split:{ sh:0.1, ss:0.10, hh:0.05, hs:0.08 }, vibrance:0.14
    }
  });

  /* 11. Analogue Gold — rich golden negative :: Kodak-inspired */
  def({
    id:"analoguegold", name:"Analogue Gold", type:"Color Negative", tagline:"Rich golden negative",
    swatch:"#c9a03a",
    engine:{
      matrix: mul( S(1.1), mul( hueRot(-5), DIAG(1.10,1.02,0.86) ) ),
      channelCurves: [ STRONG_S, SOFT_S, crv(P(0,0.02),P(0.3,0.3),P(0.5,0.48),P(0.7,0.67),P(1,0.95)) ],
      lumaCurve: SOFT_S, saturation:1.1, exposure:0.02,
      grainAmt:0.55, grainSize:0.6, halation:0.12, bloom:0.02, vignette:0.16,
      split:{ sh:0.12, ss:0.16, hh:0.07, hs:0.12 }, vibrance:0.05
    }
  });

  /* 12. Portrait Soft — creamy :: Portra-inspired */
  def({
    id:"portraitsoft", name:"Portrait Soft", type:"Portrait", tagline:"Creamy warm skin",
    swatch:"#e0aa70",
    engine:{
      matrix: mul( S(0.95), mul( hueRot(1), DIAG(1.07,1.02,0.95) ) ),
      channelCurves: [ crv(P(0,0.04),P(0.3,0.34),P(0.5,0.52),P(0.7,0.70),P(1,0.95)),
                       crv(P(0,0.03),P(0.3,0.32),P(0.5,0.5),P(0.7,0.70),P(1,0.98)),
                       crv(P(0,0.02),P(0.3,0.31),P(0.5,0.49),P(0.7,0.68),P(1,0.98)) ],
      lumaCurve: FLAT, saturation:0.95, exposure:0.04,
      grainAmt:0.3, grainSize:0.5, halation:0.12, bloom:0.04, vignette:0.13,
      split:{ sh:0.2, ss:0.08, hh:0.0, hs:0.06 }, vibrance:0.15
    }
  });

  /* 13. Chrome Vivid — punchy :: Ektar-inspired */
  def({
    id:"chromesnap", name:"Chrome Snap", type:"Chrome", tagline:"Punchy vivid chrome",
    swatch:"#c22f2f",
    engine:{
      matrix: mul( S(1.2), mul( hueRot(-3), DIAG(1.05,1.0,1.03) ) ),
      channelCurves: [ STRONG_S, STRONG_S, STRONG_S ],
      lumaCurve: STRONG_S, saturation:1.2, exposure:-0.01,
      grainAmt:0.4, grainSize:0.5, halation:0.02, bloom:0.0, vignette:0.2,
      split:{ sh:0.5, ss:0.1, hh:0.2, hs:0.08 }, vibrance:0.15
    }
  });

  /* 14. Cinematic 35 — teal-orange :: Original cinematic */
  def({
    id:"cinematic35", name:"Cinematic 35", type:"Cinematic", tagline:"Teal-orange cinema",
    swatch:"#3a7d8a",
    engine:{
      matrix: mul( S(0.85), mul( hueRot(2), DIAG(1.06,1.0,0.98) ) ),
      channelCurves: [ SOFT_S, SOFT_S, SOFT_S ],
      lumaCurve: SOFT_S, saturation:0.85, exposure:0.03,
      grainAmt:0.7, grainSize:0.6, halation:0.25, bloom:0.05, vignette:0.25,
      split:{ sh:0.72, ss:0.30, hh:0.03, hs:0.18 }, vibrance:-0.02
    }
  });

  /* 15. Vintage 35 — aged :: Original vintage */
  def({
    id:"vintage35", name:"Vintage 35", type:"Color Negative", tagline:"Aged faded film",
    swatch:"#b08a58",
    engine:{
      matrix: mul( S(0.72), mul( hueRot(3), DIAG(1.08,1.0,0.94) ) ),
      channelCurves: [ VINTAGE, VINTAGE, VINTAGE ],
      lumaCurve: VINTAGE, saturation:0.72, exposure:0.06,
      grainAmt:0.8, grainSize:0.6, halation:0.2, bloom:0.05, vignette:0.22,
      split:{ sh:0.1, ss:0.12, hh:0.15, hs:0.10 }, vibrance:-0.05
    }
  });

  /* 16. Pure Mono — high contrast B&W :: B&W film */
  def({
    id:"puremono", name:"Pure Mono", type:"B&W", tagline:"High-contrast monochrome",
    bw:true, swatch:"#9a9a9a",
    engine:{
      matrix: S(0.0),
      channelCurves: [ HARD_NIC, HARD_NIC, HARD_NIC ],
      lumaCurve: HARD_NIC, saturation:0.0, exposure:0.0,
      grainAmt:0.6, grainSize:0.5, halation:0.0, bloom:0.0, vignette:0.15,
      split:{ sh:0.5, ss:0.0, hh:0.5, hs:0.0 }, vibrance:0
    }
  });

  /* 17. Pro Neg Hi — punchier portrait :: Fuji Pro Neg Hi */
  def({
    id:"proneghi", name:"Pro Neg Hi", type:"Portrait", tagline:"Punchy portrait skin",
    swatch:"#d49a6e",
    engine:{
      matrix: mul( S(1.04), mul( hueRot(-2), DIAG(1.08,1.01,0.95) ) ),
      channelCurves: [ SOFT_S, SOFT_S, SOFT_S ],
      lumaCurve: SOFT_S, saturation:1.04, exposure:0.04,
      grainAmt:0.30, grainSize:0.5, halation:0.10, bloom:0.02, vignette:0.13,
      split:{ sh:0.18, ss:0.10, hh:0.04, hs:0.06 }, vibrance:0.10
    }
  });

  /* 18. Pro Neg Std — softer neutral portrait :: Fuji Pro Neg Std */
  def({
    id:"pronegstd", name:"Pro Neg Std", type:"Portrait", tagline:"Soft neutral portrait",
    swatch:"#caa78a",
    engine:{
      matrix: mul( S(0.95), mul( hueRot(0), DIAG(1.04,1.0,0.97) ) ),
      channelCurves: [ crv(P(0,0.03),P(0.3,0.33),P(0.5,0.51),P(0.7,0.69),P(1,0.96)),
                       crv(P(0,0.02),P(0.3,0.31),P(0.5,0.5),P(0.7,0.7),P(1,0.99)),
                       crv(P(0,0.02),P(0.3,0.31),P(0.5,0.49),P(0.7,0.68),P(1,0.99)) ],
      lumaCurve: FLAT, saturation:0.95, exposure:0.05,
      grainAmt:0.25, grainSize:0.5, halation:0.08, bloom:0.02, vignette:0.12,
      split:{ sh:0.08, ss:0.06, hh:0.05, hs:0.05 }, vibrance:0.08
    }
  });

  /* 19. Eterna Bleach Bypass — desaturated cinematic */
  def({
    id:"eternableach", name:"Eterna Bleach Bypass", type:"Cinematic", tagline:"High-contrast cinematic",
    swatch:"#a4a59e",
    engine:{
      matrix: mul( S(0.55), mul( hueRot(-2), DIAG(1.02,1.0,0.96) ) ),
      channelCurves: [ HARD_NIC, HARD_NIC, HARD_NIC ],
      lumaCurve: HARD_NIC, saturation:0.55, exposure:0.04,
      grainAmt:0.85, grainSize:0.6, halation:0.05, bloom:0.02, vignette:0.22,
      split:{ sh:0.7, ss:0.16, hh:0.04, hs:0.12 }, vibrance:-0.10
    }
  });

  /* 20. Acros Standard R/Y/G filter — pure mono with warm tint */
  def({
    id:"acros_r", name:"Acros +R Filter", type:"B&W", tagline:"Acros with red filter",
    bw:true, swatch:"#7a4040",
    engine:{
      matrix: S(0.0),
      channelCurves: [
        /* R-filter: emphasize blue contrast, darken reds slightly */
        crv(P(0,0.02),P(0.3,0.20),P(0.5,0.42),P(0.7,0.70),P(1,0.99)),
        crv(P(0,0.04),P(0.3,0.30),P(0.5,0.50),P(0.7,0.70),P(1,0.99)),
        crv(P(0,0.06),P(0.3,0.40),P(0.5,0.58),P(0.7,0.74),P(1,1.0))
      ],
      lumaCurve: SOFT_S, saturation:0.0, exposure:0.02,
      grainAmt:0.85, grainSize:0.5, halation:0.0, bloom:0.0, vignette:0.18,
      split:{ sh:0.7, ss:0.04, hh:0.05, hs:0.02 }, vibrance:0
    }
  });
  def({
    id:"acros_y", name:"Acros +Y Filter", type:"B&W", tagline:"Acros with yellow filter",
    bw:true, swatch:"#9a8a55",
    engine:{
      matrix: S(0.0),
      channelCurves: [
        crv(P(0,0.02),P(0.3,0.26),P(0.5,0.46),P(0.7,0.72),P(1,0.99)),
        crv(P(0,0.03),P(0.3,0.32),P(0.5,0.50),P(0.7,0.72),P(1,0.99)),
        crv(P(0,0.04),P(0.3,0.36),P(0.5,0.54),P(0.7,0.72),P(1,1.0))
      ],
      lumaCurve: SOFT_S, saturation:0.0, exposure:0.02,
      grainAmt:0.85, grainSize:0.5, halation:0.0, bloom:0.0, vignette:0.15,
      split:{ sh:0.5, ss:0.04, hh:0.05, hs:0.02 }, vibrance:0
    }
  });
  def({
    id:"acros_g", name:"Acros +G Filter", type:"B&W", tagline:"Acros with green filter",
    bw:true, swatch:"#5d8060",
    engine:{
      matrix: S(0.0),
      channelCurves: [
        crv(P(0,0.02),P(0.3,0.28),P(0.5,0.46),P(0.7,0.70),P(1,0.99)),
        crv(P(0,0.04),P(0.3,0.36),P(0.5,0.56),P(0.7,0.76),P(1,1.0)),
        crv(P(0,0.03),P(0.3,0.30),P(0.5,0.48),P(0.7,0.70),P(1,0.99))
      ],
      lumaCurve: SOFT_S, saturation:0.0, exposure:0.02,
      grainAmt:0.85, grainSize:0.5, halation:0.0, bloom:0.0, vignette:0.15,
      split:{ sh:0.3, ss:0.06, hh:0.55, hs:0.02 }, vibrance:0
    }
  });

  /* 21. Sepia Warm — vintage tinted mono */
  def({
    id:"sepiawarm", name:"Sepia Warm", type:"Vintage", tagline:"Warm sepia tint",
    swatch:"#a6824a",
    engine:{
      matrix: mul( S(0.0), mul( hueRot(-8), DIAG(1.18,1.06,0.86) ) ),
      channelCurves: [ VINTAGE, VINTAGE, VINTAGE ],
      lumaCurve: VINTAGE, saturation:0.55, exposure:0.04,
      grainAmt:0.7, grainSize:0.6, halation:0.12, bloom:0.04, vignette:0.20,
      split:{ sh:0.12, ss:0.16, hh:0.10, hs:0.08 }, vibrance:0
    }
  });

  /* importable into global namespace */
  global.FUJI.profiles = PROFILES;
  global.FUJI.getProfile = function(id){ return PROFILES.find(p=>p.id===id)||PROFILES[0]; };

})(typeof window!=="undefined"?window:globalThis);
