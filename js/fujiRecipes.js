/* =====================================================================
   F-UJI fujiRecipes.js — Real Fujifilm camera recipes mapped to app params
   Sources: Fuji X Weekly, Fujifilm official, community recipes
   ===================================================================== */
(function (global) {
  "use strict";

  /* ---- Mapping helpers ---- */
  function wbShiftToTemp(rShift, bShift) {
    // Fujifilm WB Shift: +R = warmer, -B = warmer
    // App temperature: positive = warm, negative = cool
    const warmth = (rShift * 0.08) + (Math.abs(Math.min(0, bShift)) * 0.06);
    return Math.max(-1, Math.min(1, warmth));
  }

  function wbShiftToTint(rShift, bShift) {
    // Minor tint from WB shift
    return Math.max(-1, Math.min(1, rShift * 0.02));
  }

  function drToHighlights(dr) {
    // DR400 preserves highlights more (lower highlights value)
    if (dr === 400) return -0.25;
    if (dr === 200) return -0.1;
    return 0;
  }

  function drToShadows(dr) {
    // DR400 lifts shadows more
    if (dr === 400) return 0.2;
    if (dr === 200) return 0.1;
    return 0;
  }

  function fujiHighlightToApp(v) {
    // Fujifilm: -2 to +4 → App: -0.5 to 1.0
    return Math.max(-0.5, Math.min(1, v * 0.2));
  }

  function fujiShadowToApp(v) {
    // Fujifilm: -2 to +4 → App: -0.5 to 1.0
    return Math.max(-0.5, Math.min(1, v * 0.2));
  }

  function fujiColorToApp(v) {
    // Fujifilm: -4 to +4 → App: -0.5 to 0.5
    return Math.max(-0.5, Math.min(0.5, v * 0.12));
  }

  function fujiSharpToApp(v) {
    // Fujifilm: -4 to +4 → App: 0 to 0.5
    return Math.max(0, Math.min(0.5, (v + 4) * 0.06));
  }

  function fujiClarityToApp(v) {
    // Fujifilm: -4 to +4 → App: -0.5 to 0.5
    return Math.max(-0.5, Math.min(0.5, v * 0.12));
  }

  function fujiNRToApp(v) {
    // Fujifilm: -4 to +4 → App: 0 to 0.5 (noise reduction)
    return Math.max(0, Math.min(0.5, (v + 4) * 0.06));
  }

  function grainToApp(level, size) {
    const map = {
      'off': { grain: 0, grainSize: 0.5, grainStrength: 0.5 },
      'weak-small': { grain: 0.3, grainSize: 0.3, grainStrength: 0.5 },
      'weak-large': { grain: 0.3, grainSize: 0.7, grainStrength: 0.5 },
      'strong-small': { grain: 0.7, grainSize: 0.3, grainStrength: 0.7 },
      'strong-large': { grain: 0.7, grainSize: 0.7, grainStrength: 0.7 }
    };
    const key = (level || 'off') + '-' + (size || 'small');
    return map[key] || map['off'];
  }

  function chromeEffectToVibrance(level) {
    if (level === 'strong') return 0.3;
    if (level === 'weak') return 0.15;
    return 0;
  }

  function chromeFxBlueToSat(level) {
    // Maps to cyan/blue saturation boost
    if (level === 'strong') return 0.4;
    if (level === 'weak') return 0.2;
    return 0;
  }

  /* ---- Film Simulation → Profile ID mapping (real sims) ---- */
  const SIM_MAP = {
    'provia': 'fuji-provia',
    'provia-400x': 'fuji-provia-400x',
    'provia-400x-xpro': 'fuji-provia-400x-xpro',
    'velvia': 'fuji-velvia',
    'velvia-vivid': 'fuji-velvia-vivid',
    'astia': 'fuji-astia',
    'fortia-sp': 'fuji-fortia-sp',
    'neopan-1600': 'fuji-neopan-1600',
    't64': 'fuji-t64',
    'pro-800z': 'fuji-pro-800z',
    'pro-400h': 'fuji-pro-400h',
    'pro-160c': 'fuji-pro-160c',
    'pro-160s': 'fuji-pro-160s',
    'superia-1600': 'fuji-superia-1600',
    'superia-400': 'fuji-superia-400',
    'superia-100': 'fuji-superia-100',
    'classic-chrome': 'fuji-classic-chrome',
    'classic-negative': 'fuji-classic-neg',
    'nostalgic-neg': 'fuji-nostalgic-neg',
    'eterna': 'fuji-eterna',
    'eterna-bleach-bypass': 'fuji-eterna-bb',
    'acros': 'fuji-acros-r',
    'acros-r': 'fuji-acros-r',
    'acros-y': 'fuji-acros-y',
    'acros-g': 'fuji-acros-g',
    'monochrome': 'fuji-mono',
    'reala-ace': 'fuji-reala-ace',
    'pro-neg-hi': 'fuji-pro-neg-hi',
    'pro-neg-std': 'fuji-pro-neg-std',
    'sepia': 'fuji-sepia'
  };

  /* ---- WB preset name → engine mode ---- */
  function wbModeFromString(s){
    const v = String(s||'').toLowerCase();
    if(v.indexOf('cloud') >= 0) return 'cloudy';
    if(v.indexOf('shade') >= 0) return 'shade';
    if(v.indexOf('tungsten') >= 0) return 'tungsten';
    if(v.indexOf('fluoresc') >= 0 || v.indexOf('fluores') >= 0) return 'fluorescent';
    if(v.indexOf('flash') >= 0) return 'flash';
    return 'auto';
  }

  /* ---- Convert a Fujifilm recipe to app state ----
     The recipe's raw camera settings are carried in `state.fuji` (the
     engine's applyFuji computes every tone/color/detail contribution),
     while `profileId` selects the real film simulation. WB shift feeds
     the manual temp/tint sliders; preset feeds state.fuji.wbMode. */
  function convertRecipe(fuji) {
    const profileId = SIM_MAP[fuji.simulation] || 'fuji-provia';
    const temp = wbShiftToTemp(fuji.wbShiftR || 0, fuji.wbShiftB || 0);
    const tint = wbShiftToTint(fuji.wbShiftR || 0, fuji.wbShiftB || 0);

    return {
      profileId: profileId,
      film: {
        intensity: 1.0,
        grain: 0,
        grainSize: 0.5,
        grainStrength: 0.5,
        halation: 0.05,
        bloom: 0.02
      },
      vignette: 0.10,
      light: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
      color: {
        temperature: temp,
        tint: tint,
        vibrance: 0,
        saturation: 0,
        hsl: { hue:{r:0,o:0,y:0,g:0,c:0,b:0,m:0,p:0},
               sat:{r:0,o:0,y:0,g:0,c:0,b:0,m:0,p:0},
               luma:{r:0,o:0,y:0,g:0,c:0,b:0,m:0,p:0} }
      },
      grade: { shadowHue: 0.5, shadowSat: 0, highlightHue: 0.5, highlightSat: 0, balance: 0.5 },
      detail: { texture: 0, clarity: 0, sharp: 0, noise: 0, dehaze: 0 },
      fuji: {
        dr: fuji.dynamicRange || 'auto',
        highlightTone: fuji.highlight != null ? fuji.highlight : 0,
        shadowTone: fuji.shadow != null ? fuji.shadow : 0,
        color: fuji.color != null ? fuji.color : 0,
        sharpness: fuji.sharpness != null ? fuji.sharpness : 0,
        hNR: fuji.highISONR != null ? fuji.highISONR : 0,
        grainEffect: fuji.grainEffect || 'off',
        grainSize: fuji.grainSize || 'small',
        chromeFx: fuji.colorChromeEffect || 'off',
        chromeFxBlue: fuji.colorChromeFxBlue || 'off',
        clarity: fuji.clarity != null ? fuji.clarity : 0,
        wbMode: wbModeFromString(fuji.whiteBalance)
      }
    };
  }

  /* ================= REAL FUJIFILM RECIPES ================= */
  const FUJI_RECIPES = [

    /* --- Kodachrome 64 (Classic Chrome) --- Source: Fuji X Weekly */
    {
      id: 'kodachrome64',
      name: 'Kodachrome 64',
      source: 'Fuji X Weekly',
      author: 'Ritchie Roesch',
      tagline: 'Classic Kodachrome slide film look',
      filmSim: 'Classic Chrome',
      camera: 'X-T5 / X-Trans V',
      fuji: {
        simulation: 'classic-chrome',
        dynamicRange: 200,
        whiteBalance: 'Daylight',
        wbShiftR: 2, wbShiftB: -5,
        highlight: 0,
        shadow: 0.5,
        color: 2,
        sharpness: 1,
        highISONR: -4,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'strong',
        colorChromeFxBlue: 'off',
        clarity: 3
      }
    },

    /* --- Provia Positive --- Source: Fuji X Weekly */
    {
      id: 'proviaPositive',
      name: 'Provia Positive',
      source: 'Fuji X Weekly',
      author: 'Ritchie Roesch / Dan Allen',
      tagline: 'Versatile natural color with character',
      filmSim: 'Provia',
      camera: 'X-T5 / X-Trans V',
      fuji: {
        simulation: 'provia',
        dynamicRange: 400,
        whiteBalance: 'Auto White Priority',
        wbShiftR: 2, wbShiftB: -3,
        highlight: -1,
        shadow: 1,
        color: 4,
        sharpness: -1,
        highISONR: -4,
        grainEffect: 'strong', grainSize: 'small',
        colorChromeEffect: 'strong',
        colorChromeFxBlue: 'strong',
        clarity: 2
      }
    },

    /* --- Vivid Chrome (Velvia) --- Source: Fuji X Weekly */
    {
      id: 'vividChrome',
      name: 'Vivid Chrome',
      source: 'Fuji X Weekly',
      author: 'Ritchie Roesch',
      tagline: 'Punchy vibrant colors for landscapes',
      filmSim: 'Velvia',
      camera: 'X-T5 / X-Trans V',
      fuji: {
        simulation: 'velvia',
        dynamicRange: 400,
        whiteBalance: 'Daylight',
        wbShiftR: 2, wbShiftB: -2,
        highlight: -1,
        shadow: -0.5,
        color: 2,
        sharpness: -2,
        highISONR: -4,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'strong',
        colorChromeFxBlue: 'off',
        clarity: 3
      }
    },

    /* --- Nostalgic Air (Nostalgic Neg) --- Source: Fuji X Weekly */
    {
      id: 'nostalgicAir',
      name: 'Nostalgic Air',
      source: 'Fuji X Weekly',
      author: 'Hayden / Ritchie Roesch',
      tagline: 'Soft airy peachy tones',
      filmSim: 'Nostalgic Neg.',
      camera: 'X-T5 / X-Trans V',
      fuji: {
        simulation: 'nostalgic-neg',
        dynamicRange: 100,
        whiteBalance: 'Auto',
        wbShiftR: 5, wbShiftB: -1,
        highlight: -1,
        shadow: 0,
        color: 4,
        sharpness: -2,
        highISONR: -4,
        grainEffect: 'strong', grainSize: 'small',
        colorChromeEffect: 'off',
        colorChromeFxBlue: 'off',
        clarity: -3
      }
    },

    /* --- Velvia Landscape (Keigo Suzuki) --- Source: Fujifilm Official */
    {
      id: 'velviaLandscape',
      name: 'Velvia Landscape',
      source: 'Fujifilm Official',
      author: 'Keigo Suzuki',
      tagline: 'Versatile Mt. Fuji landscape recipe',
      filmSim: 'Velvia',
      camera: 'X-Series',
      fuji: {
        simulation: 'velvia',
        dynamicRange: 100,
        whiteBalance: 'Daylight',
        wbShiftR: 0, wbShiftB: 0,
        highlight: -1,
        shadow: -2,
        color: 1,
        sharpness: 1,
        highISONR: 0,
        grainEffect: 'off',
        colorChromeEffect: 'weak',
        colorChromeFxBlue: 'weak',
        clarity: -1
      }
    },

    /* --- Classic Negative Nostalgia --- Source: Photography Talk */
    {
      id: 'classicNegNostalgia',
      name: 'Classic Negative Nostalgia',
      source: 'Photography Talk',
      author: 'Amy Porter',
      tagline: 'Retro color negative feel',
      filmSim: 'Classic Negative',
      camera: 'X-Trans IV/V',
      fuji: {
        simulation: 'classic-negative',
        dynamicRange: 400,
        whiteBalance: 'Auto',
        wbShiftR: 3, wbShiftB: -5,
        highlight: -1,
        shadow: 2,
        color: 1,
        sharpness: -1,
        highISONR: -3,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'off',
        colorChromeFxBlue: 'weak',
        clarity: 0
      }
    },

    /* --- Everyday Classic Chrome --- Source: Photography Talk */
    {
      id: 'everydayChrome',
      name: 'Everyday Classic Chrome',
      source: 'Photography Talk',
      author: 'Amy Porter',
      tagline: 'Muted all-purpose documentary look',
      filmSim: 'Classic Chrome',
      camera: 'X-Trans IV/V',
      fuji: {
        simulation: 'classic-chrome',
        dynamicRange: 400,
        whiteBalance: 'Auto',
        wbShiftR: 2, wbShiftB: -2,
        highlight: -1,
        shadow: 1,
        color: 2,
        sharpness: 0,
        highISONR: -2,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'weak',
        colorChromeFxBlue: 'off',
        clarity: 0
      }
    },

    /* --- Velvia Landscape Punch --- Source: Photography Talk */
    {
      id: 'velviaPunch',
      name: 'Velvia Landscape Punch',
      source: 'Photography Talk',
      author: 'Amy Porter',
      tagline: 'Bold saturated skies and foliage',
      filmSim: 'Velvia',
      camera: 'X-Trans IV/V',
      fuji: {
        simulation: 'velvia',
        dynamicRange: 200,
        whiteBalance: 'Daylight',
        wbShiftR: 0, wbShiftB: 0,
        highlight: -1,
        shadow: 1,
        color: 2,
        sharpness: 1,
        highISONR: 0,
        grainEffect: 'off',
        colorChromeEffect: 'strong',
        colorChromeFxBlue: 'weak',
        clarity: 0
      }
    },

    /* --- Salty Skipper (Classic Chrome) --- Source: Fujifilm UK */
    {
      id: 'saltySkipper',
      name: 'Salty Skipper',
      source: 'Fujifilm UK',
      author: 'Thomas B. Jones',
      tagline: 'Maritime documentary reportage',
      filmSim: 'Classic Chrome',
      camera: 'X-Series',
      fuji: {
        simulation: 'classic-chrome',
        dynamicRange: 200,
        whiteBalance: 'Auto',
        wbShiftR: 0, wbShiftB: -3,
        highlight: -1,
        shadow: 2,
        color: 4,
        sharpness: 1,
        highISONR: 0,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'off',
        colorChromeFxBlue: 'strong',
        clarity: 0
      }
    },

    /* --- Acros B&W --- Source: Photography Talk */
    {
      id: 'acrosBW',
      name: 'Acros Black & White',
      source: 'Photography Talk',
      author: 'Amy Porter',
      tagline: 'Fine-grain high-contrast mono',
      filmSim: 'Acros',
      camera: 'X-Trans IV/V',
      fuji: {
        simulation: 'acros',
        dynamicRange: 200,
        whiteBalance: 'Auto',
        wbShiftR: 0, wbShiftB: 0,
        highlight: 1,
        shadow: 2,
        color: 0,
        sharpness: 1,
        highISONR: -2,
        grainEffect: 'strong', grainSize: 'large',
        colorChromeEffect: 'off',
        colorChromeFxBlue: 'off',
        clarity: 0
      }
    },

    /* --- Velvia Dramatic (Keigo Suzuki Pattern 3) --- Source: Fujifilm Official */
    {
      id: 'velviaDramatic',
      name: 'Velvia Dramatic',
      source: 'Fujifilm Official',
      author: 'Keigo Suzuki',
      tagline: 'Dramatic clouds and dimension',
      filmSim: 'Velvia',
      camera: 'X-Series',
      fuji: {
        simulation: 'velvia',
        dynamicRange: 100,
        whiteBalance: 'Daylight',
        wbShiftR: 0, wbShiftB: 0,
        highlight: 2,
        shadow: 4,
        color: -1,
        sharpness: -1,
        highISONR: 0,
        grainEffect: 'off',
        colorChromeEffect: 'strong',
        colorChromeFxBlue: 'weak',
        clarity: -1
      }
    },

    /* --- Eterna Cinema --- Source: Fujifilm */
    {
      id: 'eternaCinema',
      name: 'Eterna Cinema',
      source: 'Fujifilm',
      author: 'Fujifilm',
      tagline: 'Flat cinematic film look',
      filmSim: 'Eterna',
      camera: 'X-Trans IV/V',
      fuji: {
        simulation: 'eterna',
        dynamicRange: 400,
        whiteBalance: 'Auto',
        wbShiftR: 0, wbShiftB: 0,
        highlight: 0, shadow: 0, color: 0, sharpness: 0, highISONR: 0,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'off', colorChromeFxBlue: 'off', clarity: 0
      }
    },

    /* ============== NEW (Slice 1) ============== */

    /* --- Portra 400 Warm --- Source: Fuji X Weekly — Kodak Portra simulation */
    {
      id: 'portra400warm', name: 'Portra 400 Warm', source: 'Fuji X Weekly', author: 'Ritchie Roesch',
      tagline: 'Warm Kodak Portra 400 negative look', filmSim: 'Classic Neg.', camera: 'X-Trans IV/V',
      category: 'portrait', scene: ['portrait','indoor','golden'],
      fuji: {
        simulation: 'classic-negative', dynamicRange: 400,
        whiteBalance: 'Auto', wbShiftR: 4, wbShiftB: -6,
        highlight: -1, shadow: 2, color: 1, sharpness: -2, highISONR: -4,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'weak', colorChromeFxBlue: 'off', clarity: -2
      }
    },
    /* --- Portra 800 Push --- Source: Fuji X Weekly */
    {
      id: 'portra800', name: 'Portra 800 Push', source: 'Fuji X Weekly', author: 'Ritchie Roesch',
      tagline: 'Pushed Portra 800 with rich shadows', filmSim: 'Classic Neg.', camera: 'X-Trans V',
      category: 'portrait', scene: ['portrait','night','indoor'],
      fuji: {
        simulation: 'classic-negative', dynamicRange: 200,
        whiteBalance: 'Auto', wbShiftR: 3, wbShiftB: -5,
        highlight: -1, shadow: 3, color: 2, sharpness: -1, highISONR: -4,
        grainEffect: 'strong', grainSize: 'small',
        colorChromeEffect: 'off', colorChromeFxBlue: 'weak', clarity: -1
      }
    },
    /* --- Kodak Gold 200 --- Source: Fuji X Weekly */
    {
      id: 'kodakgold200', name: 'Kodak Gold 200', source: 'Fuji X Weekly', author: 'Ritchie Roesch',
      tagline: 'Warm 90s Gold 200 nostalgia', filmSim: 'Classic Chrome', camera: 'X-Trans IV/V',
      category: 'street', scene: ['street','daylight','urban'],
      fuji: {
        simulation: 'classic-chrome', dynamicRange: 200,
        whiteBalance: 'Daylight', wbShiftR: 3, wbShiftB: -7,
        highlight: -1, shadow: 1, color: 2, sharpness: 0, highISONR: -4,
        grainEffect: 'strong', grainSize: 'small',
        colorChromeEffect: 'weak', colorChromeFxBlue: 'off', clarity: 0
      }
    },
    /* --- Ektar 100 --- Source: Fuji X Weekly */
    {
      id: 'ektar100', name: 'Ektar 100', source: 'Fuji X Weekly', author: 'Ritchie Roesch',
      tagline: 'Saturated vivid chrome', filmSim: 'Velvia', camera: 'X-Trans IV/V',
      category: 'landscape', scene: ['landscape','daylight','travel'],
      fuji: {
        simulation: 'velvia', dynamicRange: 100,
        whiteBalance: 'Daylight', wbShiftR: 1, wbShiftB: -3,
        highlight: -2, shadow: 1, color: 4, sharpness: 1, highISONR: -4,
        grainEffect: 'off', grainSize: 'small',
        colorChromeEffect: 'strong', colorChromeFxBlue: 'weak', clarity: 2
      }
    },
    /* --- Tri-X 400 --- Source: Fuji X Weekly */
    {
      id: 'trix400', name: 'Tri-X 400', source: 'Fuji X Weekly', author: 'Ritchie Roesch',
      tagline: 'Classic Kodak Tri-X push-processed', filmSim: 'Acros', camera: 'X-Trans IV/V',
      category: 'street', scene: ['street','documentary','night'],
      fuji: {
        simulation: 'acros', dynamicRange: 200,
        whiteBalance: 'Auto', wbShiftR: 0, wbShiftB: 0,
        highlight: 2, shadow: 3, color: 0, sharpness: 2, highISONR: -4,
        grainEffect: 'strong', grainSize: 'large',
        colorChromeEffect: 'off', colorChromeFxBlue: 'off', clarity: 2
      }
    },
    /* --- Ilford HP5+ --- Source: Fuji X Weekly */
    {
      id: 'hp5plus', name: 'Ilford HP5+', source: 'Fuji X Weekly', author: 'Ritchie Roesch',
      tagline: 'Creamy Ilford HP5+ monochrome', filmSim: 'Acros', camera: 'X-Trans IV/V',
      category: 'street', scene: ['portrait','documentary'],
      fuji: {
        simulation: 'acros', dynamicRange: 200,
        whiteBalance: 'Auto', wbShiftR: 0, wbShiftB: 0,
        highlight: 1, shadow: 2, color: 0, sharpness: 1, highISONR: -2,
        grainEffect: 'strong', grainSize: 'large',
        colorChromeEffect: 'off', colorChromeFxBlue: 'off', clarity: 0
      }
    },
    /* --- Cinematic Bleach Bypass --- Source: Fuji X Weekly */
    {
      id: 'bleachbypass', name: 'Cinematic Bleach Bypass', source: 'Fuji X Weekly', author: 'Ritchie Roesch',
      tagline: 'High-contrast cinematic bleach bypass', filmSim: 'Eterna', camera: 'X-Trans IV/V',
      category: 'cinematic', scene: ['portrait','night','urban'],
      fuji: {
        simulation: 'eterna', dynamicRange: 200,
        whiteBalance: 'Auto', wbShiftR: 0, wbShiftB: -2,
        highlight: 2, shadow: 3, color: -2, sharpness: 1, highISONR: -4,
        grainEffect: 'strong', grainSize: 'small',
        colorChromeEffect: 'off', colorChromeFxBlue: 'strong', clarity: 3
      }
    },
    /* --- Pacific Blues --- Source: Fuji X Weekly */
    {
      id: 'pacificblues', name: 'Pacific Blues', source: 'Fuji X Weekly', author: 'Ritchie Roesch',
      tagline: 'Cool blue coastal travel look', filmSim: 'Classic Chrome', camera: 'X-Trans IV/V',
      category: 'travel', scene: ['landscape','travel','daylight'],
      fuji: {
        simulation: 'classic-chrome', dynamicRange: 400,
        whiteBalance: 'Auto', wbShiftR: -2, wbShiftB: 4,
        highlight: -1, shadow: 2, color: 2, sharpness: 0, highISONR: -4,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'weak', colorChromeFxBlue: 'strong', clarity: 1
      }
    },
    /* --- Moody Autumn --- Source: Fuji X Weekly */
    {
      id: 'moodyautumn', name: 'Moody Autumn', source: 'Fuji X Weekly', author: 'Ritchie Roesch',
      tagline: 'Desaturated autumn warmth', filmSim: 'Nostalgic Neg.', camera: 'X-Trans IV/V',
      category: 'landscape', scene: ['landscape','golden'],
      fuji: {
        simulation: 'nostalgic-neg', dynamicRange: 200,
        whiteBalance: 'Auto', wbShiftR: 4, wbShiftB: -3,
        highlight: -1, shadow: 2, color: -1, sharpness: 0, highISONR: -4,
        grainEffect: 'strong', grainSize: 'small',
        colorChromeEffect: 'weak', colorChromeFxBlue: 'off', clarity: 0
      }
    },
    /* --- Moody Forest --- Source: Fuji X Weekly */
    {
      id: 'moodyforest', name: 'Moody Forest', source: 'Fuji X Weekly', author: 'Ritchie Roesch',
      tagline: 'Deep greens, low-key shadow look', filmSim: 'Classic Neg.', camera: 'X-Trans IV/V',
      category: 'landscape', scene: ['landscape','nature'],
      fuji: {
        simulation: 'classic-negative', dynamicRange: 200,
        whiteBalance: 'Daylight', wbShiftR: -1, wbShiftB: 1,
        highlight: 0, shadow: 3, color: 0, sharpness: 0, highISONR: -4,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'weak', colorChromeFxBlue: 'weak', clarity: 1
      }
    },
    /* --- Vintage Wedding --- Source: Photography Talk */
    {
      id: 'vintagewedding', name: 'Vintage Wedding', source: 'Photography Talk', author: 'Amy Porter',
      tagline: 'Soft warm wedding portrait', filmSim: 'Astia', camera: 'X-Trans IV/V',
      category: 'portrait', scene: ['portrait','wedding','indoor'],
      fuji: {
        simulation: 'astia', dynamicRange: 400,
        whiteBalance: 'Auto', wbShiftR: 3, wbShiftB: -4,
        highlight: -2, shadow: 2, color: 1, sharpness: -2, highISONR: -4,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'off', colorChromeFxBlue: 'off', clarity: -2
      }
    },
    /* --- Street Documentary --- Source: Fujifilm UK */
    {
      id: 'streetdoc', name: 'Street Documentary', source: 'Fujifilm UK', author: 'Thomas B. Jones',
      tagline: 'Candid street reportage', filmSim: 'Classic Chrome', camera: 'X-Series',
      category: 'street', scene: ['street','documentary','urban'],
      fuji: {
        simulation: 'classic-chrome', dynamicRange: 400,
        whiteBalance: 'Auto', wbShiftR: 0, wbShiftB: -2,
        highlight: 0, shadow: 2, color: 2, sharpness: 1, highISONR: 0,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'off', colorChromeFxBlue: 'off', clarity: 1
      }
    },
    /* --- F1 Nostalgia --- Source: Fuji X Weekly */
    {
      id: 'f1nostalgia', name: 'F1 Nostalgia', source: 'Fuji X Weekly', author: 'Ritchie Roesch',
      tagline: 'Editorial sports 70s magazine look', filmSim: 'Classic Chrome', camera: 'X-Trans IV/V',
      category: 'editorial', scene: ['editorial','urban','travel'],
      fuji: {
        simulation: 'classic-chrome', dynamicRange: 400,
        whiteBalance: 'Auto', wbShiftR: 2, wbShiftB: -3,
        highlight: 0, shadow: 1, color: 3, sharpness: 1, highISONR: -2,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'strong', colorChromeFxBlue: 'off', clarity: 1
      }
    },
    /* --- Darkroom Push 1600 --- Source: Fuji X Weekly */
    {
      id: 'darkroom1600', name: 'Darkroom Push 1600', source: 'Fuji X Weekly', author: 'Ritchie Roesch',
      tagline: 'High-grain B1W 1600 push', filmSim: 'Acros', camera: 'X-Trans IV/V',
      category: 'street', scene: ['street','night','documentary'],
      fuji: {
        simulation: 'acros', dynamicRange: 100,
        whiteBalance: 'Auto', wbShiftR: 0, wbShiftB: 0,
        highlight: 3, shadow: 4, color: 0, sharpness: 2, highISONR: -4,
        grainEffect: 'strong', grainSize: 'large',
        colorChromeEffect: 'off', colorChromeFxBlue: 'off', clarity: 3
      }
    },
    /* --- Food Magazine --- Source: Photography Talk */
    {
      id: 'foodmagazine', name: 'Food Magazine', source: 'Photography Talk', author: 'Amy Porter',
      tagline: 'Warm appetizing editorial food', filmSim: 'Astia', camera: 'X-Trans IV/V',
      category: 'food', scene: ['food','indoor'],
      fuji: {
        simulation: 'astia', dynamicRange: 200,
        whiteBalance: 'Auto', wbShiftR: 4, wbShiftB: -5,
        highlight: -1, shadow: 2, color: 2, sharpness: 1, highISONR: -4,
        grainEffect: 'off', grainSize: 'small',
        colorChromeEffect: 'strong', colorChromeFxBlue: 'off', clarity: 1
      }
    },
    /* --- Architectural Mono --- Source: Photography Talk */
    {
      id: 'archmono', name: 'Architectural Mono', source: 'Photography Talk', author: 'Amy Porter',
      tagline: 'High contrast urban monochrome', filmSim: 'Acros +R', camera: 'X-Trans IV/V',
      category: 'architecture', scene: ['architecture','urban'],
      fuji: {
        simulation: 'acros', dynamicRange: 100,
        whiteBalance: 'Auto', wbShiftR: 0, wbShiftB: 0,
        highlight: 2, shadow: 2, color: 0, sharpness: 2, highISONR: -3,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'off', colorChromeFxBlue: 'off', clarity: 2
      }
    },

    /* ============== CLASSIC FUJI FILM PRESET LINE ==============
       Full looks inspired by iconic Fujifilm film stocks (source:
       VSCO's Fujifilm preset collection — film characteristics).
       Each preset = film simulation + camera-style settings. */

    /* --- FA1 — Fuji Astia 100F --- */
    {
      id: 'astia100f', name: 'Astia 100F', source: 'Film Preset Line', author: 'F-UJI',
      tagline: 'Gentle true-to-life colors, superb skin tones', filmSim: 'Astia 100F', camera: 'Any',
      category: 'film', scene: ['portrait','wedding','indoor'],
      fuji: {
        simulation: 'astia', dynamicRange: 100,
        whiteBalance: 'Daylight', wbShiftR: 0, wbShiftB: 0,
        highlight: -1, shadow: 1, color: 1, sharpness: -1, highISONR: -2,
        grainEffect: 'off', grainSize: 'small',
        colorChromeEffect: 'off', colorChromeFxBlue: 'off', clarity: -1
      }
    },

    /* --- FF5 — Fuji Fortia SP --- */
    {
      id: 'fortiaSP', name: 'Fortia SP', source: 'Film Preset Line', author: 'F-UJI',
      tagline: 'Ultra-vivid saturation, bold greens, strong contrast', filmSim: 'Fortia SP', camera: 'Any',
      category: 'film', scene: ['landscape','nature','travel'],
      fuji: {
        simulation: 'fortia-sp', dynamicRange: 100,
        whiteBalance: 'Daylight', wbShiftR: 1, wbShiftB: -2,
        highlight: -1, shadow: -1, color: 3, sharpness: 0, highISONR: -2,
        grainEffect: 'off', grainSize: 'small',
        colorChromeEffect: 'strong', colorChromeFxBlue: 'off', clarity: 2
      }
    },

    /* --- FN16 — Fuji Neopan 1600 --- */
    {
      id: 'neopan1600', name: 'Neopan 1600', source: 'Film Preset Line', author: 'F-UJI',
      tagline: 'Bold high-contrast gritty monochrome', filmSim: 'Neopan 1600', camera: 'Any',
      category: 'film', scene: ['street','night','documentary'],
      fuji: {
        simulation: 'neopan-1600', dynamicRange: 200,
        whiteBalance: 'Auto', wbShiftR: 0, wbShiftB: 0,
        highlight: 2, shadow: 3, color: 0, sharpness: 2, highISONR: -4,
        grainEffect: 'strong', grainSize: 'large',
        colorChromeEffect: 'off', colorChromeFxBlue: 'off', clarity: 2
      }
    },

    /* --- FV5 — Fuji Velvia 50 --- */
    {
      id: 'velvia50', name: 'Velvia 50', source: 'Film Preset Line', author: 'F-UJI',
      tagline: 'Ultra-high saturation, magenta cast, warm tones', filmSim: 'Velvia 50', camera: 'Any',
      category: 'film', scene: ['landscape','nature','travel'],
      fuji: {
        simulation: 'velvia', dynamicRange: 100,
        whiteBalance: 'Daylight', wbShiftR: 2, wbShiftB: -2,
        highlight: -1, shadow: -2, color: 2, sharpness: -1, highISONR: -2,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'strong', colorChromeFxBlue: 'off', clarity: 3
      }
    },

    /* --- FT6 — Fuji T64 --- */
    {
      id: 't64', name: 'T64', source: 'Film Preset Line', author: 'F-UJI',
      tagline: 'Cool tungsten-balanced chrome, blue auras', filmSim: 'T64', camera: 'Any',
      category: 'film', scene: ['night','architecture','indoor'],
      fuji: {
        simulation: 't64', dynamicRange: 100,
        whiteBalance: 'Tungsten', wbShiftR: -1, wbShiftB: 3,
        highlight: 0, shadow: 1, color: 1, sharpness: 0, highISONR: -2,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'off', colorChromeFxBlue: 'off', clarity: 0
      }
    },

    /* --- FP8 — Fuji Pro 800Z --- */
    {
      id: 'pro800z', name: 'Pro 800Z', source: 'Film Preset Line', author: 'F-UJI',
      tagline: 'Rich saturation and contrast for dim light, reds pop', filmSim: 'Pro 800Z', camera: 'Any',
      category: 'film', scene: ['night','indoor','street'],
      fuji: {
        simulation: 'pro-800z', dynamicRange: 200,
        whiteBalance: 'Auto', wbShiftR: 3, wbShiftB: -2,
        highlight: -1, shadow: 1, color: 2, sharpness: 0, highISONR: -2,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'weak', colorChromeFxBlue: 'off', clarity: 1
      }
    },

    /* --- FP4 — Fuji Pro 400H --- */
    {
      id: 'pro400h', name: 'Pro 400H', source: 'Film Preset Line', author: 'F-UJI',
      tagline: 'Fresh look, slight green cast, wide latitude', filmSim: 'Pro 400H', camera: 'Any',
      category: 'film', scene: ['portrait','indoor','landscape'],
      fuji: {
        simulation: 'pro-400h', dynamicRange: 400,
        whiteBalance: 'Auto', wbShiftR: -2, wbShiftB: 1,
        highlight: 0, shadow: 1, color: 2, sharpness: -1, highISONR: -2,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'off', colorChromeFxBlue: 'weak', clarity: 0
      }
    },

    /* --- FP2 — Fuji Pro 160C --- */
    {
      id: 'pro160c', name: 'Pro 160C', source: 'Film Preset Line', author: 'F-UJI',
      tagline: 'Rich colors, crisp contrast, deeper saturation', filmSim: 'Pro 160C', camera: 'Any',
      category: 'film', scene: ['portrait','fashion','landscape'],
      fuji: {
        simulation: 'pro-160c', dynamicRange: 200,
        whiteBalance: 'Auto', wbShiftR: 2, wbShiftB: -2,
        highlight: -1, shadow: 1, color: 2, sharpness: 1, highISONR: -2,
        grainEffect: 'off', grainSize: 'small',
        colorChromeEffect: 'weak', colorChromeFxBlue: 'off', clarity: 1
      }
    },

    /* --- FP1 — Fuji Pro 160S --- */
    {
      id: 'pro160s', name: 'Pro 160S', source: 'Film Preset Line', author: 'F-UJI',
      tagline: 'Soft natural color, low contrast, elegant', filmSim: 'Pro 160S', camera: 'Any',
      category: 'film', scene: ['portrait','wedding','fashion'],
      fuji: {
        simulation: 'pro-160s', dynamicRange: 400,
        whiteBalance: 'Auto', wbShiftR: 1, wbShiftB: -1,
        highlight: -2, shadow: 2, color: 1, sharpness: -1, highISONR: -2,
        grainEffect: 'off', grainSize: 'small',
        colorChromeEffect: 'off', colorChromeFxBlue: 'off', clarity: -1
      }
    },

    /* --- FR4 — Fuji Provia 400X --- */
    {
      id: 'provia400x', name: 'Provia 400X', source: 'Film Preset Line', author: 'F-UJI',
      tagline: 'Deep natural colors with moderate contrast', filmSim: 'Provia 400X', camera: 'Any',
      category: 'film', scene: ['landscape','travel','editorial'],
      fuji: {
        simulation: 'provia-400x', dynamicRange: 200,
        whiteBalance: 'Daylight', wbShiftR: 0, wbShiftB: 0,
        highlight: 0, shadow: 0, color: 2, sharpness: 0, highISONR: -2,
        grainEffect: 'off', grainSize: 'small',
        colorChromeEffect: 'weak', colorChromeFxBlue: 'off', clarity: 1
      }
    },

    /* --- FR4X — Fuji Provia 400X Cross Processed --- */
    {
      id: 'provia400x_xpro', name: 'Provia 400X X-Pro', source: 'Film Preset Line', author: 'F-UJI',
      tagline: 'Cross-processed: bold contrast, yellow hues, vintage', filmSim: 'Provia 400X X-Pro', camera: 'Any',
      category: 'film', scene: ['golden','street','travel'],
      fuji: {
        simulation: 'provia-400x-xpro', dynamicRange: 100,
        whiteBalance: 'Auto', wbShiftR: 2, wbShiftB: -4,
        highlight: 2, shadow: -1, color: 4, sharpness: 1, highISONR: -2,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'strong', colorChromeFxBlue: 'off', clarity: 2
      }
    },

    /* --- FS16 — Fuji Superia 1600 --- */
    {
      id: 'superia1600', name: 'Superia 1600', source: 'Film Preset Line', author: 'F-UJI',
      tagline: 'Low contrast natural colors with a greenish fade', filmSim: 'Superia 1600', camera: 'Any',
      category: 'film', scene: ['street','travel','indoor'],
      fuji: {
        simulation: 'superia-1600', dynamicRange: 200,
        whiteBalance: 'Auto', wbShiftR: 1, wbShiftB: -1,
        highlight: -1, shadow: 2, color: 1, sharpness: -1, highISONR: -4,
        grainEffect: 'strong', grainSize: 'large',
        colorChromeEffect: 'off', colorChromeFxBlue: 'off', clarity: 0
      }
    },

    /* --- FS4 — Fuji Superia 400 --- */
    {
      id: 'superia400', name: 'Superia 400', source: 'Film Preset Line', author: 'F-UJI',
      tagline: 'All-purpose natural color with green and pink cast', filmSim: 'Superia 400', camera: 'Any',
      category: 'film', scene: ['travel','street','daylight'],
      fuji: {
        simulation: 'superia-400', dynamicRange: 200,
        whiteBalance: 'Auto', wbShiftR: 1, wbShiftB: -1,
        highlight: -1, shadow: 1, color: 1, sharpness: 0, highISONR: -2,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'off', colorChromeFxBlue: 'off', clarity: 0
      }
    },

    /* --- FS1 — Fuji Superia 100 --- */
    {
      id: 'superia100', name: 'Superia 100', source: 'Film Preset Line', author: 'F-UJI',
      tagline: 'Daylight balanced: cool shadows, warm highlights', filmSim: 'Superia 100', camera: 'Any',
      category: 'film', scene: ['portrait','landscape','daylight'],
      fuji: {
        simulation: 'superia-100', dynamicRange: 100,
        whiteBalance: 'Daylight', wbShiftR: 0, wbShiftB: -1,
        highlight: -1, shadow: 0, color: 1, sharpness: 0, highISONR: -2,
        grainEffect: 'off', grainSize: 'small',
        colorChromeEffect: 'weak', colorChromeFxBlue: 'off', clarity: 0
      }
    }
  ];

  /* ---- Convert all recipes to app state format ----
     `fujiSettings` carries the raw camera recipe (DR, WB shift, tone,
     Color Chrome FX, grain, clarity …) for display/export. */
  const convertedRecipes = FUJI_RECIPES.map(r => ({
    id: r.id,
    name: r.name,
    source: r.source,
    author: r.author,
    tagline: r.tagline,
    filmSim: r.filmSim,
    camera: r.camera,
    category: r.category || 'general',
    scene: r.scene || [],
    fujiSettings: r.fuji,
    state: convertRecipe(r.fuji)
  }));

  /* ---- Categorisation helpers (for UI + scene-aware suggestions) ---- */
  function byCategory(cat){
    if(!cat || cat==='all') return convertedRecipes.slice();
    return convertedRecipes.filter(r => (r.category||'general') === cat);
  }
  function search(q){
    q = (q||'').toLowerCase().trim();
    if(!q) return convertedRecipes.slice();
    return convertedRecipes.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.source||'').toLowerCase().includes(q) ||
      (r.author||'').toLowerCase().includes(q) ||
      (r.tagline||'').toLowerCase().includes(q) ||
      (r.filmSim||'').toLowerCase().includes(q) ||
      (r.camera||'').toLowerCase().includes(q) ||
      (r.scene||[]).some(s => s.toLowerCase().includes(q))
    );
  }
  function suggestFor(sceneTags){
    if(!sceneTags || !sceneTags.length) return convertedRecipes.slice();
    const scores = convertedRecipes.map(r => {
      let s = 0;
      for(const t of sceneTags){
        if((r.scene||[]).indexOf(t) >= 0) s += 3;
        if((r.tagline||'').toLowerCase().indexOf(t) >= 0) s += 1;
      }
      return { r, s };
    });
    return scores.filter(x => x.s > 0).sort((a,b)=>b.s-a.s).map(x => x.r);
  }
  function categories(){
    const set = new Set();
    convertedRecipes.forEach(r => set.add(r.category||'general'));
    return ['all', ...Array.from(set)];
  }

  /* ---- Public API ---- */
  function getFujiRecipes() { return convertedRecipes; }
  function getFujiRecipe(id) { return convertedRecipes.find(r => r.id === id); }

  function applyFujiRecipe(recipe, State) {
    const prev = State.cur;
    const s = recipe.state;
    State.cur.profileId = s.profileId;
    State.cur.film.intensity = 1.0;
    State.cur.film.grain = s.film.grain;
    State.cur.film.grainSize = s.film.grainSize;
    State.cur.film.grainStrength = s.film.grainStrength;
    State.cur.film.halation = s.film.halation;
    State.cur.film.bloom = s.film.bloom;
    State.cur.vignette = s.vignette;
    State.cur.light = JSON.parse(JSON.stringify(s.light));
    State.cur.color = JSON.parse(JSON.stringify(s.color));
    State.cur.grade = JSON.parse(JSON.stringify(s.grade));
    State.cur.detail = JSON.parse(JSON.stringify(s.detail));
    State.cur.fuji = JSON.parse(JSON.stringify(s.fuji || {}));
    State.commit(prev);
  }

  global.FUJI = global.FUJI || {};
  global.FUJI.fujiRecipes = {
    getRecipes: getFujiRecipes,
    getRecipe: getFujiRecipe,
    applyRecipe: applyFujiRecipe,
    convertRecipe: convertRecipe,
    byCategory: byCategory,
    search: search,
    suggestFor: suggestFor,
    categories: categories,
    SIM_MAP: SIM_MAP
  };

})(typeof window !== "undefined" ? window : globalThis);
