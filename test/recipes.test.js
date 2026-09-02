/* =====================================================================
   test/recipes.test.js — user recipes + the bundled Fujifilm catalog.

   Recipes are the one thing in this app that is persisted forever on the
   device, so storage shape, migration tolerance and the apply math are all
   pinned here.
   ===================================================================== */
'use strict';

const { test, run, ok, eq, near, assert } = require('./harness');
const { loadApp } = require('./app');

function freshApp() {
  const { win } = loadApp();
  win.localStorage.clear();
  win.FUJI.recipes.load();
  return win;
}

test('no recipes on a clean device', () => {
  const win = freshApp();
  eq(win.FUJI.recipes.getRecipes().length, 0, 'a fresh install must start empty');
  ok(win.FUJI.recipes.allRecipes().length > 0, 'the built-in Fuji catalog must still be browsable');
});

test('createRecipe persists to localStorage under the versioned key', () => {
  const win = freshApp();
  const { FUJI, App } = win;
  App.state.setPartial('light.exposure', 1);
  const r = FUJI.recipes.createRecipe('My Look', App.state.cur);
  ok(r.id, 'recipe must get an id');
  eq(r.name, 'My Look');
  eq(r.intensity, 1);
  const raw = JSON.parse(win.localStorage.getItem('fuji.recipes.v1'));
  eq(raw.length, 1, 'recipe was not written to storage');
  eq(raw[0].preset.light.exposure, 1, 'the saved preset must capture the edit');
  eq('fuji' in raw[0].preset, true, 'the saved preset must include the Fuji camera settings');
});

test('recipes survive a reload (same key, same values)', () => {
  const win = freshApp();
  win.App.state.setPartial('color.temperature', 0.6);
  win.FUJI.recipes.createRecipe('Kept', win.App.state.cur);
  const second = freshApp();                      // new context, same storage is empty
  eq(second.FUJI.recipes.getRecipes().length, 0, 'sanity: storage is per-context');
  second.localStorage.setItem('fuji.recipes.v1', win.localStorage.getItem('fuji.recipes.v1'));
  second.FUJI.recipes.load();
  const [back] = second.FUJI.recipes.getRecipes();
  eq(back.name, 'Kept');
  near(back.preset.color.temperature, 0.6, 1e-9, 'value lost across reload');
});

test('corrupt storage does not wedge the app', () => {
  const { win } = loadApp();
  win.localStorage.setItem('fuji.recipes.v1', '{not json');
  win.localStorage.setItem('fuji.favorites.v1', '"nope"');
  const r = win.FUJI.recipes.load();
  ok(Array.isArray(r), 'load() must fall back to an empty list');
  eq(win.FUJI.recipes.loadFavs().length, 0, 'favorites must fall back to []');
});

test('duplicate / rename / delete / intensity all persist', () => {
  const win = freshApp();
  const { FUJI } = win;
  const a = FUJI.recipes.createRecipe('A', FUJI.defaultState());
  const b = FUJI.recipes.duplicateRecipe(a.id);
  eq(b.name, 'A Copy');
  assert.notStrictEqual(a.id, b.id, 'copies need their own id');
  FUJI.recipes.renameRecipe(b.id, 'B');
  FUJI.recipes.setIntensity(b.id, 0.4);
  eq(FUJI.recipes.getRecipe(b.id).intensity, 0.4);
  FUJI.recipes.deleteRecipe(a.id);
  eq(FUJI.recipes.getRecipes().map(r => r.name).join(','), 'B');
  eq(FUJI.recipes.duplicateRecipe('missing'), null, 'duplicating an unknown id must not throw');
  const stored = JSON.parse(win.localStorage.getItem('fuji.recipes.v1'));
  eq(stored.length, 1, 'delete was not persisted');
});

test('favorites are stored separately and toggle', () => {
  const win = freshApp();
  const { FUJI } = win;
  const r = FUJI.recipes.createRecipe('Fav', FUJI.defaultState());
  eq(FUJI.recipes.isFav(r.id), false);
  eq(FUJI.recipes.toggleFav(r.id), true, 'toggleFav must report the new state');
  eq(FUJI.recipes.isFav(r.id), true);
  eq(win.localStorage.getItem('fuji.favorites.v1'), JSON.stringify([r.id]));
  eq(FUJI.recipes.toggleFav(r.id), false, 'toggling again must un-favourite');
  eq(FUJI.recipes.isFav(r.id), false);
  FUJI.recipes.toggleFav(r.id);
  FUJI.recipes.toggleFavorite(r.id);              // the recipe's own flag
  eq(FUJI.recipes.getRecipe(r.id).favorite, true);
});

test('applyToState scales by intensity and keeps enums at full strength', () => {
  const win = freshApp();
  const { FUJI, App } = win;
  const base = FUJI.defaultState();
  base.light.exposure = 2;
  base.color.vibrance = 1;
  base.film.grain = 0.8;
  base.fuji.dr = '400';
  base.fuji.grainEffect = 'strong';
  base.fuji.highlightTone = 4;
  const r = FUJI.recipes.createRecipe('Half', base);
  FUJI.recipes.setIntensity(r.id, 0.5);
  App.state.reset();
  FUJI.recipes.applyToState(FUJI.recipes.getRecipe(r.id), App.state);
  near(App.state.cur.light.exposure, 1, 1e-9, 'numeric adjustments must scale with intensity');
  near(App.state.cur.color.vibrance, 0.5, 1e-9);
  near(App.state.cur.film.grain, 0.4, 1e-9, 'grain must scale too');
  near(App.state.cur.fuji.highlightTone, 2, 1e-9, 'Fuji tone numbers scale');
  eq(App.state.cur.fuji.dr, '400', 'Fuji enums pass through at full strength');
  eq(App.state.cur.fuji.grainEffect, 'strong');
  ok(App.state.canUndo(), 'applying a recipe must be undoable');
  App.state.undo();
  eq(App.state.cur.fuji.dr, 'auto', 'undo must restore the previous camera settings');
});

test('applyToState with intensity 0 leaves the image untouched but switches the look', () => {
  const win = freshApp();
  const { FUJI, App } = win;
  const base = FUJI.defaultState();
  base.light.shadows = 1.5;
  const r = FUJI.recipes.createRecipe('Zero', base);
  FUJI.recipes.setIntensity(r.id, 0);
  App.state.reset();
  App.state.setPartial('light.shadows', 0.9);
  FUJI.recipes.applyToState(FUJI.recipes.getRecipe(r.id), App.state);
  eq(App.state.cur.light.shadows, 0, 'intensity 0 must zero the recipe adjustments');
});

test('applying a built-in Fuji recipe is undoable', () => {
  const win = freshApp();
  const { FUJI, App } = win;
  App.state.reset();
  App.state.setPartial('light.contrast', 0.7);
  const before = App.state.cur.light.contrast;
  const rec = FUJI.fujiRecipes.getRecipes()[0];
  FUJI.fujiRecipes.applyRecipe(rec, App.state);
  assert.notEqual(App.state.cur.light.contrast, undefined, 'recipe should have written the light block');
  ok(App.state.canUndo(), 'applying a built-in must push one undo step');
  App.state.undo();
  eq(App.state.cur.light.contrast, before, 'undo must bring back the edit that was there before the recipe');
});

test('history snapshots never alias the live state', () => {
  const win = freshApp();
  const { App } = win;
  App.state.reset();
  const cur = App.state.cur;
  App.state.commit(cur);                       // a caller passing the live object must not corrupt history
  ok(App.state.undoStack[0] !== cur, 'undo stack must not hold the live state object');
  cur.vignette = 0.5;
  App.state.undo();
  eq(App.state.cur.vignette, 0, 'a mutation after commit must not leak into the snapshot');
});

test('exportJSON / importJSON round-trips and mints new ids', () => {
  const win = freshApp();
  const { FUJI } = win;
  FUJI.recipes.createRecipe('One', FUJI.defaultState());
  FUJI.recipes.createRecipe('Two', FUJI.defaultState());
  const json = FUJI.recipes.exportJSON();
  const exported = JSON.parse(json);
  eq(exported.length, 2);
  const before = FUJI.recipes.getRecipes().length;
  const n = FUJI.recipes.importJSON(json);
  ok(n >= 2, 'importJSON must report how many records it saw');
  eq(FUJI.recipes.getRecipes().length, before + 2, 'import must append, not replace');
  const ids = FUJI.recipes.getRecipes().map(r => r.id);
  eq(new Set(ids).size, ids.length, 'imported recipes must not collide with existing ids');
  assert.throws(() => FUJI.recipes.importJSON('nonsense{'), /Invalid JSON/);
  eq(FUJI.recipes.importJSON(JSON.stringify({ nope: true })), 1, 'records without a preset are skipped');
  eq(FUJI.recipes.getRecipes().filter(r => r.preset).length, before + 2, 'the skipped record must not be stored');
});

test('export of a single recipe is supported', () => {
  const win = freshApp();
  const { FUJI } = win;
  const a = FUJI.recipes.createRecipe('A', FUJI.defaultState());
  FUJI.recipes.createRecipe('B', FUJI.defaultState());
  const only = JSON.parse(FUJI.recipes.exportJSON([a.id]));
  eq(only.length, 1);
  eq(only[0].name, 'A');
});

test('built-in Fuji recipes are namespaced, normalized and undeletable by id collision', () => {
  const win = freshApp();
  const { FUJI } = win;
  const built = FUJI.recipes.builtinRecipes();
  ok(built.length >= 20, `expected a substantial bundled catalog, got ${built.length}`);
  ok(built.every(r => r.builtin === true), 'built-ins must be flagged');
  ok(built.every(r => r.preset && r.preset.fuji), 'built-ins must normalize into the same preset shape as user recipes');
  const all = FUJI.recipes.allRecipes();
  eq(new Set(all.map(r => r.id)).size, all.length, 'duplicate ids would break apply/favourite lookups');
  // a user recipe that happens to reuse a built-in id must shadow it, not duplicate it
  const stolen = built[0].id;
  FUJI.recipes.createRecipe('Mine', FUJI.defaultState());
  const list = FUJI.recipes.getRecipes();
  list[list.length - 1].id = stolen;
  FUJI.recipes.save();
  eq(FUJI.recipes.allRecipes().filter(r => r.id === stolen).length, 1, 'a built-in must never appear twice');
});

test('recipe listeners re-render the list when recipes change', () => {
  const win = loadApp({ runBoot: true }).win;
  let fired = 0;
  win.FUJI.recipes.load();
  win.App.state.onRecipes(() => { fired++; });
  win.App.state.emitRecipes();                    // what recipes.js calls after a mutation
  eq(fired, 1, 'App.state.onRecipes must notify the recipe browser');
});

run();
