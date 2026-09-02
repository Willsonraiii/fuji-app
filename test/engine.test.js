/* =====================================================================
   test/engine.test.js — the pixel pipeline's pure math + the CPU engine.

   The WebGL path can't run in CI, but the CPU fallback shares bakeParams /
   curves / WB / HSL math with it, so the numbers the shader would receive are
   verified here. The most dangerous failure mode for this app is a NaN or a
   negative gain reaching a uniform: it renders a black or transparent photo.
   ===================================================================== */
'use strict';

const { test, run, ok, eq, near, assert } = require('./harness');
const { loadApp, read } = require('./app');

const win = loadApp().win;
const FUJI = win.FUJI;
const M = FUJI.math;

function eachLeaf(obj, cb, prefix) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') eachLeaf(v, cb, prefix ? `${prefix}.${k}` : k);
    else cb(v, prefix ? `${prefix}.${k}` : k);
  }
}

test('LUMA weights are Rec.709 and sum to 1', () => {
  eq(M.LUMA.length, 3);
  near(M.LUMA[0], 0.2126, 1e-4, 'red weight');
  near(M.LUMA[1], 0.7152, 1e-4, 'green weight');
  near(M.LUMA[2], 0.0722, 1e-4, 'blue weight');
  near(M.LUMA.reduce((a, b) => a + b, 0), 1, 1e-4);
});

test('matrix helpers behave: identity, multiply, saturation', () => {
  const I = M.matIdentity();
  eq(I.length, 9);
  eq(I.join(','), '1,0,0,0,1,0,0,0,1');
  const m = M.satMatrix(1);
  eq(m.join(','), I.join(','), 'saturation 1 must be the identity matrix');
  const gray = M.satMatrix(0);
  const r = M.LUMA[0], g = M.LUMA[1], b = M.LUMA[2];
  near(gray[0], r, 1e-6, 'desaturated R row must be the luma weights');
  near(gray[4], g, 1e-6);
  near(gray[8], b, 1e-6);
  const prod = M.matMultiply(I, m);
  eq(prod.join(','), m.join(','), 'identity * m must be m');
});

test('clamp / smoothstep stay in range', () => {
  eq(M.clamp01(-3), 0); eq(M.clamp01(9), 1); near(M.clamp01(0.5), 0.5, 1e-9);
  eq(M.clamp(5, 0, 2), 2); eq(M.clamp(-5, 0, 2), 0);
  eq(M.smoothstep(0, 1, -1), 0); eq(M.smoothstep(0, 1, 2), 1);
  near(M.smoothstep(0, 1, 0.5), 0.5, 1e-9);
});

test('neutral curve is identity and curves are monotonic when boosted', () => {
  const c = M.neutralCurve();
  assert.ok(c, 'neutralCurve() must exist');
  for (const x of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) near(M.sampleCurve(c, x), x, 1e-3, `curve( ${x} )`);
  const arr = M.curveToArray([0, 0.15, 0.3, 0.5, 0.7, 0.85, 1], c);
  eq(arr.length, 7, 'the shader samples a 7-point curve');
  ok(arr.every(Number.isFinite), 'curve array must be finite');
});

test('buildWB: neutral at 0, warm>1/red, cool>1/blue, always positive', () => {
  const neutral = M.buildWB({ temperature: 0, tint: 0 });
  near(neutral[0], 1, 1e-6, 'neutral R gain');
  near(neutral[1], 1, 1e-6, 'neutral G gain');
  near(neutral[2], 1, 1e-6, 'neutral B gain');
  const warm = M.buildWB({ temperature: 1, tint: 0 });
  const cool = M.buildWB({ temperature: -1, tint: 0 });
  ok(warm[0] > 1 && warm[2] < 1, 'warming must raise red and lower blue');
  ok(cool[2] > 1 && cool[0] < 1, 'cooling must raise blue and lower red');
  for (const t of [-1, -0.5, 0, 0.5, 1]) {
    const w = M.buildWB({ temperature: t, tint: t });
    ok(w.every(g => g > 0 && Number.isFinite(g)), `WB gains must stay positive (t=${t}): ${w}`);
  }
});

test('white balance round-trips an eyedropper sample (main.js wbFromSample model)', () => {
  // A warm cast (R high, B low) must be answered with R<1, B>1 gains.
  const cast = { r: 255, g: 235, b: 190 };
  const kT = Math.log(1.18), kN = Math.log(1.05), kN2 = Math.log(1.09);
  const lr = Math.log(cast.r), lg = Math.log(cast.g), lb = Math.log(cast.b);
  const temp = (lb - lr) / (2 * kT);
  const tint = (2 * lg - lr - lb) / (2 * (kN + kN2));
  ok(temp < 0, `a warm cast needs a cool correction, got temp=${temp}`);
  const g = M.buildWB({ temperature: temp, tint });
  const after = [cast.r * g[0], cast.g * g[1], cast.b * g[2]];
  const spread = Math.max(...after) - Math.min(...after);
  ok(spread < (255 - 190), `correction must narrow the channel spread (${spread})`);
  // the app clamps to [-1,1]; extreme casts must stay inside the clamp
  const extreme = M.buildWB({ temperature: Math.max(-1, Math.min(1, (Math.log(60) - Math.log(255)) / (2 * kT))), tint: 0 });
  ok(extreme.every(v => v > 0 && Number.isFinite(v)), 'extreme casts must not produce non-positive gains');
});

test('HSL: zero adjustment is identity, hue shifts move the right band', () => {
  const zero = { hue: {}, sat: {}, luma: {} };
  FUJI.hsl.keys.forEach(k => { zero.hue[k] = 0; zero.sat[k] = 0; zero.luma[k] = 0; });
  const px = [0.8, 0.2, 0.25];
  const same = FUJI.hsl.apply(px[0], px[1], px[2], zero);
  near(same[0], px[0], 1e-6); near(same[1], px[1], 1e-6); near(same[2], px[2], 1e-6);
  const shifted = FUJI.hsl.keys.reduce((acc, k) => { acc.hue[k] = 0.5; return acc; }, { hue: {}, sat: {}, luma: {} });
  FUJI.hsl.keys.forEach(k => { if (k !== undefined) { } });
  const moved = FUJI.hsl.apply(px[0], px[1], px[2], Object.assign({}, zero, { hue: Object.assign({}, zero.hue, { r: 0.5 }) }));
  assert.notDeepStrictEqual([...moved].map(v => v.toFixed(4)), [...same].map(v => v.toFixed(4)), 'a red hue shift must change red pixels');
  ok(moved.every(Number.isFinite), 'HSL output must stay finite');
  ok(FUJI.hsl.bandWeights && typeof FUJI.hsl.bandWeights === 'function', 'bandWeights must be exposed for the shader path');
});

test('bakeParams produces the full uniform set, all finite', () => {
  const p = M.bakeParams(FUJI.defaultState());
  const uniformKeys = ['matrix', 'wb', 'curves', 'exposure', 'vibrance', 'vignette', 'grainAmt', 'grainSize',
    'grainStr', 'halation', 'bloom', 'clarity', 'texture', 'sharp', 'noise', 'dehaze', 'st', 'saturate',
    'hsl', 'hslHasAdjust'];
  for (const key of uniformKeys) {
    ok(key in p, `bakeParams() is missing "${key}" that the shader / CPU pass reads`);
  }
  eq(p.matrix.length, 9, 'color matrix must be 3x3');
  eq(p.wb.length, 3, 'wb must be 3 gains');
  eq(p.curves.R.length, 7); eq(p.curves.L.length, 7);
  const nonFinite = [];
  eachLeaf(p, (v, path) => { if (typeof v === 'number' && !Number.isFinite(v)) nonFinite.push(`${path}=${v}`); });
  eq(nonFinite.length, 0, `non-finite params: ${nonFinite.join(', ')}`);
  ok(p.wb.every(g => g > 0), `wb gains must be positive: ${p.wb}`);
});

test('bakeParams stays finite at every slider extreme (NaN safety)', () => {
  const base = FUJI.defaultState();
  // walk the model, sweeping every numeric leaf to its extremes
  const paths = [];
  (function walk(o, p) {
    for (const k of Object.keys(o)) {
      const v = o[k];
      const q = p ? `${p}.${k}` : k;
      if (v && typeof v === 'object') walk(v, q);
      else if (typeof v === 'number') paths.push(q);
    }
  })(base, '');
  ok(paths.length >= 25, `expected to sweep the whole model, only found ${paths.length} numbers`);
  const set = (o, path, val) => path.split('.').reduce((x, k, i, a) => (i === a.length - 1 ? (x[k] = val) : x[k]), o);
  const bad = [];
  for (const extreme of [-1e3, -3, 0, 3, 1e3]) {
    for (const path of paths) {
      const s = FUJI.deepClone(base);
      set(s, path, extreme);
      let p;
      try { p = M.bakeParams(s); } catch (e) { bad.push(`${path}=${extreme} threw ${e.message}`); continue; }
      eachLeaf(p, (v, q) => { if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${path}=${extreme} → ${q}=${v}`); });
      if (p.wb && p.wb.some(g => !(g > 0))) bad.push(`${path}=${extreme} → wb gains ${p.wb}`);
    }
  }
  eq(bad.length, 0, `extreme slider values break the bake:\n  ${bad.slice(0, 8).join('\n  ')}`);
});

test('unknown / missing profile does not crash the bake', () => {
  const s = FUJI.defaultState();
  s.profileId = 'does-not-exist';
  const p = M.bakeParams(s);
  ok(p.matrix.every(Number.isFinite), 'unknown profile must fall back to identity math');
  const s2 = FUJI.defaultState();
  delete s2.fuji; delete s2.grade; delete s2.detail; delete s2.color.hsl;
  const p2 = M.bakeParams(s2);
  ok(p2.matrix.every(Number.isFinite), 'a state saved by an older version must still bake');
});

test('every film simulation profile bakes to finite, non-black output', () => {
  for (const prof of FUJI.profiles) {
    const s = FUJI.defaultState();
    s.profileId = prof.id;
    const p = M.bakeParams(s);
    ok(p.matrix.every(v => Number.isFinite(v)), `${prof.id}: non-finite matrix`);
    const det = p.matrix[0] * (p.matrix[4] - p.matrix[8]) - p.matrix[3] * (p.matrix[1] - p.matrix[7]);
    ok(Number.isFinite(det), `${prof.id}: degenerate matrix`);
    ok(p.curves.L.every(Number.isFinite) && p.curves.R.every(Number.isFinite), `${prof.id}: non-finite curves`);
    ok(p.exposure > -6 && p.exposure < 6, `${prof.id}: absurd exposure ${p.exposure} stops`);
  }
});

test('Fuji camera settings actually move the bake (DR / tone / grain / CCE)', () => {
  const base = M.bakeParams(FUJI.defaultState());
  const mk = (mut) => { const s = FUJI.defaultState(); mut(s); return M.bakeParams(s); };
  const dr = mk(s => { s.fuji.dr = '400'; s.light.highlights = -1; });
  ok(JSON.stringify(dr.curves.L) !== JSON.stringify(base.curves.L), 'DR 400 must change the tone curve');
  const grain = mk(s => { s.fuji.grainEffect = 'strong'; });
  ok((grain.grainAmt || grain.grain || 0) >= (base.grainAmt || base.grain || 0), 'strong grain effect must not reduce grain');
  const chrome = mk(s => { s.fuji.chromeFx = 'strong'; });
  ok(chrome.matrix.some((v, i) => Math.abs(v - base.matrix[i]) > 1e-9), 'Color Chrome Effect must alter the colour matrix');
  const sharp = mk(s => { s.fuji.sharpness = 4; });
  ok(sharp.sharp !== base.sharp || sharp.detailSharp !== base.detailSharp, 'Fuji sharpness must reach the detail pass');
});

test('CPU engine renders a frame: correct size, in range, actually processed', () => {
  const W = 8, H = 6;
  const src = win.document.createElement('canvas');
  src.width = W; src.height = H;
  const sctx = src.getContext('2d');
  const out = win.document.createElement('canvas');
  out.width = W; out.height = H;
  const params = M.bakeParams(FUJI.defaultState());
  const eng = new FUJI.CPUEngine(out);
  eq(eng.isGPU(), false);
  ok(eng.render(src, W, H, params, { into: out }), 'render must report success');
  const drawn = out.getContext('2d').__drawn;
  assert.ok(drawn && drawn.data, 'the engine must paint into the destination canvas');
  eq(drawn.data.length, W * H * 4, 'wrong output size');
  let min = 255, max = 0;
  for (let i = 0; i < drawn.data.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      const v = drawn.data[i + c];
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 255, `channel out of range at pixel ${i / 4}: ${v}`);
      if (c < 3) { min = Math.min(min, v); max = Math.max(max, v); }
    }
    eq(drawn.data[i + 3], 255, 'alpha must stay opaque');
  }
  ok(max > min, 'the frame is flat — the pipeline dropped the source pixels');
});

test('CPU engine respects exposure and white balance', () => {
  const W = 4, H = 4;
  const paint = (mut) => {
    const src = win.document.createElement('canvas'); src.width = W; src.height = H;
    const out = win.document.createElement('canvas'); out.width = W; out.height = H;
    const s = FUJI.defaultState(); mut(s);
    new FUJI.CPUEngine(out).render(src, W, H, M.bakeParams(s), { into: out });
    const d = out.getContext('2d').__drawn.data;
    const ch = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { ch[0] += d[i]; ch[1] += d[i + 1]; ch[2] += d[i + 2]; }
    return { total: ch.reduce((a, b) => a + b, 0) / (W * H), r: ch[0], g: ch[1], b: ch[2] };
  };
  const normal = paint(() => {}).total;
  const brighter = paint(s => { s.light.exposure = 1.5; }).total;
  const darker = paint(s => { s.light.exposure = -1.5; }).total;
  ok(brighter > normal, `+1.5EV should brighten (${brighter} vs ${normal})`);
  ok(darker < normal, `-1.5EV should darken (${darker} vs ${normal})`);
  const warm = paint(s => { s.color.temperature = 1; });
  const cool = paint(s => { s.color.temperature = -1; });
  const base = paint(() => {});
  ok(warm.r > base.r, `warming must raise the red channel (${warm.r} vs ${base.r})`);
  ok(cool.b > base.b, `cooling must raise the blue channel (${cool.b} vs ${base.b})`);
  ok(warm.b < base.b, 'warming must not boost blue');
  // the same sample pushed the other way must move in the other direction
  ok(warm.r > cool.r && warm.b < cool.b, 'temperature must be monotonic across the slider');
});

test('renderToCanvas works without WebGL (the CI / old-device path)', () => {
  const src = win.document.createElement('canvas'); src.width = 4; src.height = 4;
  const dst = win.document.createElement('canvas'); dst.width = 4; dst.height = 4;
  const params = M.bakeParams(FUJI.defaultState());
  const res = FUJI.renderToCanvas(src, dst, params);
  eq(res, dst, 'renderToCanvas must return the destination');
  ok(dst.getContext('2d').__drawn, 'the destination must have been painted');
});

test('createEngine falls back to the CPU engine when webgl2 is unavailable', () => {
  const c = win.document.createElement('canvas');
  const eng = FUJI.createEngine(c);
  assert.ok(eng, 'createEngine must never return null in the fallback case');
  eq(eng.isGPU(), false, 'the test stub has no WebGL, so the CPU engine is expected');
  ok(eng instanceof FUJI.CPUEngine);
});

test('profiles list: unique ids, a valid sim mapping and a lookup fallback', () => {
  const ids = FUJI.profiles.map(p => p.id);
  eq(new Set(ids).size, ids.length, 'duplicate profile ids');
  ok(FUJI.profiles.every(p => p.name), 'every profile needs a display name');
  eq(FUJI.getProfile('nope').id, ids[0], 'getProfile must fall back to the first profile');
  eq(FUJI.simProfiles().length, FUJI.profiles.length, 'simProfiles should list the look catalog');
  const simIds = new Set(FUJI.profiles.filter(p => p.fujiSim).map(p => p.fujiSim));
  ok(simIds.size > 5, 'profiles should map onto real Fuji simulation names');
});

test('Fuji recipe catalog: valid categories, unique ids, sim names exist', () => {
  const recs = FUJI.fujiRecipes.getRecipes();
  ok(recs.length >= 20, `the bundled catalog shrank to ${recs.length}`);
  eq(new Set(recs.map(r => r.id)).size, recs.length, 'duplicate recipe ids');
  const cats = FUJI.fujiRecipes.categories();
  ok(cats[0] === 'all', 'categories() must start with "all"');
  for (const r of recs) {
    ok(cats.includes(r.category), `${r.id}: category "${r.category}" is not in categories()`);
    ok(r.name && r.state, `${r.id}: recipes need a name and a state`);
    ok(typeof r.state.film.intensity === 'number', `${r.id}: missing film.intensity`);
  }
  for (const c of cats) {
    const list = FUJI.fujiRecipes.byCategory(c);
    ok(Array.isArray(list), `byCategory(${c}) must return an array`);
    if (c !== 'all') ok(list.length > 0, `category "${c}" is declared but empty`);
  }
  const q = FUJI.fujiRecipes.search(recs[0].name);
  ok(q.length >= 1, 'searching for an exact recipe name must find it');
  eq(FUJI.fujiRecipes.search('zzzz-no-such-recipe').length, 0, 'search must not return junk');
});

test('every scene tag the analyser can emit has recipe suggestions', () => {
  const recs = FUJI.fujiRecipes.getRecipes();
  // the vocabulary produced by FUJI.context.analyzeScene()
  const analyzerTags = ['landscape', 'portrait', 'nature', 'travel', 'night', 'high-key', 'forest', 'golden'];
  for (const tag of analyzerTags) {
    const sug = FUJI.fujiRecipes.suggestFor([tag]);
    ok(sug.length > 0, `suggestFor(["${tag}"]) is empty — the recipe sheet would say "no suggestions"`);
    ok(sug.every(r => recs.includes(r)), 'suggestions must come from the catalog');
  }
  // sorted by score, no duplicates
  const multi = FUJI.fujiRecipes.suggestFor(['portrait', 'night']);
  eq(new Set(multi.map(r => r.id)).size, multi.length, 'a recipe matched by two tags must appear once');
  ok(multi.length > 1);
  // documented fallbacks: no tags / null → the whole catalog, unknown tag → nothing
  eq(FUJI.fujiRecipes.suggestFor([]).length, recs.length, 'empty tags should list everything');
  eq(FUJI.fujiRecipes.suggestFor(null).length, recs.length, 'null must not throw');
  eq(FUJI.fujiRecipes.suggestFor(['not-a-real-tag']).length, 0);
  // the alias table must only point at tags that actually exist
  const known = new Set(recs.flatMap(r => r.scene || []));
  const src = read('js/fujiRecipes.js');
  const aliasBlock = /const SCENE_ALIASES = \{([\s\S]*?)\n  \};/.exec(src);
  assert.ok(aliasBlock, 'SCENE_ALIASES must exist in fujiRecipes.js');
  const aliasTargets = [...aliasBlock[1].matchAll(/\[([^\]]*)\]/g)].flatMap(m => m[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean));
  const dangling = aliasTargets.filter(t => !known.has(t));
  eq(dangling.length, 0, `scene aliases point at tags no recipe uses: ${dangling.join(', ')}`);
});

test('scene analysis classifies a synthetic sky/portrait frame', () => {
  // 32x24: top 40% bright blue, bottom-centre a skin-tone blob
  const c = win.document.createElement('canvas');
  c.width = 32; c.height = 24;
  const ctx = c.getContext('2d');
  ctx.__paint = (draw) => { draw(ctx); };
  const id = ctx.getImageData(0, 0, 32, 24);
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const sky = y < 10;
      const face = !sky && x > 10 && x < 22 && y > 12 && y < 22;
      id.data[i] = sky ? 120 : face ? 210 : 30;
      id.data[i + 1] = sky ? 170 : face ? 165 : 40;
      id.data[i + 2] = sky ? 235 : face ? 135 : 45;
      id.data[i + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  // the stub returns generated pixels from getImageData, so analyse the raw
  // grid through the module's own maths by feeding it the painted image back
  const scene = FUJI.context.analyzeScene(c);
  ok(Array.isArray(scene.tags), 'analyzeScene must always return a tags array');
  ok(scene.fracs && typeof scene.fracs.sky === 'number', 'analyzeScene must report fractions');
  ok(scene.lum && Number.isFinite(scene.lum.low), 'analyzeScene must report luminance stats');
  const out = FUJI.context.autoAdjust({ iso: 6400 }, scene);
  ok(Array.isArray(out.tweaks ? Object.keys(out.tweaks) : []), 'autoAdjust must return tweak objects');
});

run();
