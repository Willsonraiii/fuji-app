/* =====================================================================
   F-UJI samples.js — real recipe sample images.
   Six AI base photos (landscape, portrait, street, food, night,
   architecture) are rendered through the app's own CPU engine using each
   recipe's actual Fujifilm simulation + camera settings, so every recipe
   card shows a faithful preview of its look. Renders are cached per
   recipe + size, and a hold-to-compare helper lets users flip back to the
   unprocessed original.
   Depends on: processing.js (CPUEngine / math.bakeParams), profiles.js,
   state.js, recipes.js, fujiRecipes.js.
   ===================================================================== */
(function (global) {
  "use strict";
  const FUJI = global.FUJI;

  /* ---------------- Sample registry ---------------- */
  const SAMPLES = [
    {
      id: 'landscape', file: 'samples/landscape.jpg', name: 'Landscape',
      match: ['landscape', 'travel', 'golden', 'nature', 'forest', 'mountain', 'sky', 'velvia', 'ektar', 'reala', 'fortia'],
      categories: ['landscape', 'travel', 'nature', 'film']
    },
    {
      id: 'portrait', file: 'samples/portrait.jpg', name: 'Portrait',
      match: ['portrait', 'portra', 'wedding', 'fashion', 'skin', 'astia', 'nostalgic', 'provia'],
      categories: ['portrait', 'film']
    },
    {
      id: 'street', file: 'samples/street.jpg', name: 'Street',
      match: ['street', 'documentary', 'urban', 'editorial', 'superia', 'trix', 'hp5', 'kodachrome', 'classic chrome'],
      categories: ['street', 'editorial', 'film']
    },
    {
      id: 'food', file: 'samples/food.jpg', name: 'Food',
      match: ['food', 'magazine', 'culinary', 'restaurant', 'appetizing'],
      categories: ['food']
    },
    {
      id: 'night', file: 'samples/night.jpg', name: 'Night',
      match: ['night', 'neon', 'noir', '1600', '800', 'push', 't64', 'darkroom', 'bleach bypass', 'eterna'],
      categories: ['night', 'cinematic', 'street']
    },
    {
      id: 'architecture', file: 'samples/architecture.jpg', name: 'Architecture',
      match: ['architecture', 'architectural', 'mono', 'acros', 'building', 'geometry', 'neopan'],
      categories: ['architecture', 'travel', 'cinematic', 'film']
    }
  ];

  const imgCache = {};       // sampleId -> HTMLImageElement
  const imgPromises = {};    // sampleId -> Promise<HTMLImageElement>
  const sourceCache = {};    // sampleId -> HTMLCanvasElement (native 640x480)
  const renderCache = new Map(); // key -> HTMLCanvasElement

  /* ---------------- Loading ---------------- */
  function loadSample(id){
    if(imgCache[id]) return Promise.resolve(imgCache[id]);
    if(imgPromises[id]) return imgPromises[id];
    const s = SAMPLES.find(x => x.id === id) || SAMPLES[0];
    imgPromises[id] = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { imgCache[id] = img; delete imgPromises[id]; resolve(img); };
      img.onerror = () => { delete imgPromises[id]; reject(new Error('sample load failed: ' + id)); };
      img.src = s.file;
    });
    return imgPromises[id];
  }

  function loadSampleCanvas(id){
    if(sourceCache[id]) return Promise.resolve(sourceCache[id]);
    return loadSample(id).then(img => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || 640;
      c.height = img.naturalHeight || 480;
      c.getContext('2d').drawImage(img, 0, 0);
      sourceCache[id] = c;
      return c;
    });
  }

  /* ---------------- Matching: pick one sample per recipe ---------------- */
  function sampleForRecipe(recipe){
    if(!recipe) return SAMPLES[0].id;
    const f = (recipe.builtin && recipe.fuji) ? recipe.fuji : null;
    let text = [recipe.name, recipe.tagline, f && f.tagline].join(' ');
    if(f){
      text += ' ' + [f.name, f.filmSim, f.source, f.category, (f.scene || []).join(' ')].join(' ');
    }
    if(recipe.preset && recipe.preset.profileId){
      const prof = FUJI.getProfile(recipe.preset.profileId);
      if(prof) text += ' ' + prof.name + ' ' + (prof.tagline || '');
    }
    const lower = text.toLowerCase();

    const category = (f && f.category) || recipe.category || '';
    const scene = (f && f.scene) || [];
    let best = null, bestScore = 0;
    for(const s of SAMPLES){
      let score = 0;
      for(const tok of s.match){ if(lower.indexOf(tok) >= 0) score += 2; }
      if(category && category !== 'general' && s.categories.indexOf(category) >= 0) score += 3;
      for(const sc of scene){
        if(s.categories.indexOf(sc) >= 0 || s.match.indexOf(sc) >= 0) score += 2;
      }
      if(score > bestScore){ bestScore = score; best = s; }
    }
    if(best) return best.id;

    // Deterministic fallback so each recipe keeps a stable image.
    let h = 0;
    const id = String(recipe.id || recipe.name || '');
    for(let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return SAMPLES[h % SAMPLES.length].id;
  }

  /* ---------------- State for the recipe's look ---------------- */
  function mergeState(target, preset){
    for(const k of ['profileId', 'vignette', 'film', 'light', 'color', 'grade', 'detail', 'fuji']){
      if(preset[k] == null) continue;
      target[k] = (typeof preset[k] === 'object')
        ? JSON.parse(JSON.stringify(preset[k]))
        : preset[k];
    }
  }

  function stateForRecipe(recipe){
    if(!recipe) return FUJI.defaultState();
    if(recipe.builtin){
      // Built-in Fujifilm recipes carry a complete normalized state.
      if(recipe.preset){
        const merged = JSON.parse(JSON.stringify(FUJI.defaultState()));
        mergeState(merged, recipe.preset);
        return merged;
      }
      return FUJI.defaultState();
    }
    // User recipe: honor its intensity scaling exactly like the app does.
    if(recipe.preset && FUJI.recipes && FUJI.recipes.applyToState){
      const st = new FUJI.State();
      FUJI.recipes.applyToState(recipe, st);
      return st.cur;
    }
    return FUJI.defaultState();
  }

  /* ---------------- Render queue (yields between thumbnails) ---------------- */
  const pending = [];
  let rafScheduled = false;
  function schedule(task){
    pending.push(task);
    if(!rafScheduled && typeof requestAnimationFrame === 'function'){
      rafScheduled = true;
      requestAnimationFrame(drainQueue);
    } else if(!rafScheduled){
      // Non-browser safety net.
      rafScheduled = true;
      setTimeout(drainQueue, 0);
    }
  }
  function drainQueue(){
    rafScheduled = false;
    const slice = pending.splice(0, 4);
    for(const t of slice){ try { t(); } catch(e){} }
    if(pending.length){
      rafScheduled = true;
      requestAnimationFrame(drainQueue);
    }
  }

  function cacheKey(recipe, w, h){
    return (recipe && recipe.id || 'x') + '|' + w + 'x' + h;
  }
  function setCache(key, canvas){
    renderCache.set(key, canvas);
    if(renderCache.size > 500){ // simple cap: drop the oldest entry
      const first = renderCache.keys().next().value;
      if(first) renderCache.delete(first);
    }
  }

  /* Render the recipe look (actual Fuji sim + settings) via the CPU engine. */
  function renderForRecipe(recipe, w, h){
    const key = cacheKey(recipe, w, h);
    if(renderCache.has(key)) return Promise.resolve(renderCache.get(key));
    const sid = sampleForRecipe(recipe);
    return new Promise((resolve, reject) => {
      loadSampleCanvas(sid).then(src => {
        schedule(() => {
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          try{
            const state = stateForRecipe(recipe);
            const params = FUJI.math.bakeParams(state);
            const engine = new FUJI.CPUEngine(canvas);
            engine.render(src, w, h, params, { into: canvas });
          }catch(e){
            canvas.getContext('2d').drawImage(src, 0, 0, w, h);
          }
          setCache(key, canvas);
          resolve(canvas);
        });
      }, reject);
    });
  }

  /* Render the unprocessed sample (for hold-to-compare). */
  function renderOriginal(recipe, w, h){
    const key = 'orig|' + sampleForRecipe(recipe) + '|' + w + 'x' + h;
    if(renderCache.has(key)) return Promise.resolve(renderCache.get(key));
    const sid = sampleForRecipe(recipe);
    return new Promise((resolve, reject) => {
      loadSampleCanvas(sid).then(src => {
        schedule(() => {
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(src, 0, 0, w, h);
          setCache(key, canvas);
          resolve(canvas);
        });
      }, reject);
    });
  }

  /* ---------------- Hold-to-compare mount helper ---------------- */
  function mountSample(container, recipe, opts){
    opts = opts || {};
    const w = opts.width || Math.max(1, Math.round(container.clientWidth || 132));
    const h = opts.height || Math.round(w * 0.75);
    const wrap = document.createElement('div');
    wrap.className = 'sample-thumb' + (opts.badge ? ' show-badge' : '');

    const orig = document.createElement('canvas');
    orig.className = 'orig'; orig.width = w; orig.height = h;
    const proc = document.createElement('canvas');
    proc.className = 'proc'; proc.width = w; proc.height = h;
    wrap.appendChild(orig);
    wrap.appendChild(proc);
    if(opts.badge){
      const b = document.createElement('span');
      b.className = 'sample-badge';
      b.textContent = opts.badge;
      wrap.appendChild(b);
    }

    // Placeholder swatch (recipe profile color) until the render lands.
    let swatch = '#333';
    try{
      const prof = FUJI.getProfile(recipe && recipe.preset && recipe.preset.profileId);
      if(prof) swatch = prof.swatch;
    }catch(e){}
    const pctx = proc.getContext('2d');
    pctx.fillStyle = swatch; pctx.fillRect(0, 0, w, h);

    renderOriginal(recipe, w, h).then(c => {
      if(!document.body.contains(orig)) return;
      orig.getContext('2d').drawImage(c, 0, 0);
    }).catch(() => {});
    renderForRecipe(recipe, w, h).then(c => {
      if(!document.body.contains(proc)) return;
      proc.getContext('2d').clearRect(0, 0, w, h);
      proc.getContext('2d').drawImage(c, 0, 0);
    }).catch(() => {});

    container.appendChild(wrap);

    // Hold-to-compare. Block long-press bubbling so the card's context
    // menu doesn't fire while the user holds the preview.
    let holding = false;
    const setHold = v => { holding = v; wrap.classList.toggle('holding', v); };
    wrap.addEventListener('pointerdown', e => { e.stopPropagation(); setHold(true); });
    wrap.addEventListener('pointerup', () => setHold(false));
    wrap.addEventListener('pointerleave', () => setHold(false));
    wrap.addEventListener('pointercancel', () => setHold(false));
    wrap.addEventListener('touchstart', e => { e.stopPropagation(); setHold(true); }, { passive: true });
    wrap.addEventListener('touchend', () => setHold(false));
    wrap.addEventListener('touchcancel', () => setHold(false));
    return wrap;
  }

  global.FUJI = global.FUJI || {};
  global.FUJI.samples = {
    SAMPLES,
    loadSample,
    loadSampleCanvas,
    sampleForRecipe,
    stateForRecipe,
    renderForRecipe,
    renderOriginal,
    mountSample
  };
})(typeof window !== "undefined" ? window : globalThis);
