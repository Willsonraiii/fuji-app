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

  /* ---- Film Simulation → Profile ID mapping ---- */
  const SIM_MAP = {
    'provia': 'proviasoft',
    'velvia': 'velvet50',
    'astia': 'astiagentle',
    'classic-chrome': 'chromedust',
    'classic-negative': 'nostalgia',
    'nostalgic-neg': 'nostalgia',
    'eterna': 'neostage',
    'acros': 'monomodern',
    'monochrome': 'monomodern',
    'reala-ace': 'realaauto',
    'pro-neg-hi': 'proneg',
    'pro-neg-std': 'proneg',
    'sepia': 'nostalgia'
  };

  /* ---- Convert a Fujifilm recipe to app state ---- */
  function convertRecipe(fuji) {
    const profileId = SIM_MAP[fuji.simulation] || 'proviasoft';
    const grain = grainToApp(fuji.grainEffect, fuji.grainSize);
    const temp = wbShiftToTemp(fuji.wbShiftR || 0, fuji.wbShiftB || 0);
    const tint = wbShiftToTint(fuji.wbShiftR || 0, fuji.wbShiftB || 0);

    return {
      profileId: profileId,
      film: {
        intensity: 1.0,
        grain: grain.grain,
        grainSize: grain.grainSize,
        grainStrength: grain.grainStrength,
        halation: 0.05,
        bloom: 0.02
      },
      vignette: 0.12,
      light: {
        exposure: 0,
        contrast: 0,
        highlights: drToHighlights(fuji.dynamicRange || 100) + fujiHighlightToApp(fuji.highlight || 0),
        shadows: drToShadows(fuji.dynamicRange || 100) + fujiShadowToApp(fuji.shadow || 0),
        whites: 0,
        blacks: 0
      },
      color: {
        temperature: temp,
        tint: tint,
        vibrance: chromeEffectToVibrance(fuji.colorChromeEffect) + (fuji.vibranceBoost || 0),
        saturation: fujiColorToApp(fuji.color || 0),
        hsl: {
          hue: { r:0, g:0, b:0, m:0, y:0, c:0 },
          sat: { r:0, g:0, b:0, m:0, y:0, c: chromeFxBlueToSat(fuji.colorChromeFxBlue) },
          luma: { r:0, g:0, b:0, m:0, y:0, c:0 }
        }
      },
      grade: {
        shadowHue: 0.5,
        shadowSat: 0,
        highlightHue: 0.5,
        highlightSat: 0,
        balance: 0.5
      },
      detail: {
        texture: 0,
        clarity: fujiClarityToApp(fuji.clarity || 0),
        sharp: fujiSharpToApp(fuji.sharpness || 0),
        noise: fujiNRToApp(fuji.highISONR || 0),
        dehaze: 0
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
        highlight: 0,
        shadow: 0,
        color: 0,
        sharpness: 0,
        highISONR: 0,
        grainEffect: 'weak', grainSize: 'small',
        colorChromeEffect: 'off',
        colorChromeFxBlue: 'off',
        clarity: 0
      }
    }
  ];

  /* ---- Convert all recipes to app state format ---- */
  const convertedRecipes = FUJI_RECIPES.map(r => ({
    id: r.id,
    name: r.name,
    source: r.source,
    author: r.author,
    tagline: r.tagline,
    filmSim: r.filmSim,
    camera: r.camera,
    state: convertRecipe(r.fuji)
  }));

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
    State.cur.light.exposure = s.light.exposure;
    State.cur.light.contrast = s.light.contrast;
    State.cur.light.highlights = s.light.highlights;
    State.cur.light.shadows = s.light.shadows;
    State.cur.light.whites = s.light.whites;
    State.cur.light.blacks = s.light.blacks;
    State.cur.color.temperature = s.color.temperature;
    State.cur.color.tint = s.color.tint;
    State.cur.color.vibrance = s.color.vibrance;
    State.cur.color.saturation = s.color.saturation;
    State.cur.color.hsl = JSON.parse(JSON.stringify(s.color.hsl));
    State.cur.grade = JSON.parse(JSON.stringify(s.grade));
    State.cur.detail.texture = s.detail.texture;
    State.cur.detail.clarity = s.detail.clarity;
    State.cur.detail.sharp = s.detail.sharp;
    State.cur.detail.noise = s.detail.noise;
    State.cur.detail.dehaze = s.detail.dehaze;
    State.commit(prev);
  }

  global.FUJI = global.FUJI || {};
  global.FUJI.fujiRecipes = {
    getRecipes: getFujiRecipes,
    getRecipe: getFujiRecipe,
    applyRecipe: applyFujiRecipe,
    convertRecipe: convertRecipe,
    SIM_MAP: SIM_MAP
  };

})(typeof window !== "undefined" ? window : globalThis);
