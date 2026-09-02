/* =====================================================================
   F-UJI recipes.js — save/load recipes as JSON
   ===================================================================== */
(function (global) {
  "use strict";
  const { deepClone } = global.FUJI;

  const STORE_KEY = "fuji.recipes.v1";
  const FAV_KEY = "fuji.favorites.v1";
  let recipes = [];
  let favs = [];

  function loadFavs(){
    try{
      const raw = localStorage.getItem(FAV_KEY);
      favs = raw ? JSON.parse(raw) : [];
      if(!Array.isArray(favs)) favs = [];
    }catch(e){ favs=[]; }
    return favs;
  }
  function saveFavs(){
    try{ localStorage.setItem(FAV_KEY, JSON.stringify(favs)); }catch(e){}
  }
  function isFav(id){ return favs.indexOf(id) >= 0; }
  function toggleFav(id){
    const i = favs.indexOf(id);
    if(i >= 0) favs.splice(i, 1);
    else favs.push(id);
    saveFavs();
    return i < 0;
  }

  function load(){
    try{
      const raw = localStorage.getItem(STORE_KEY);
      recipes = raw ? JSON.parse(raw) : [];
    }catch(e){ recipes=[]; }
    loadFavs();
    return recipes;
  }
  function save(){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(recipes)); }
    catch(e){}
  }
  function uid(){ return "rc_" + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

  function normalize(state){
    // to store only meaningful stored profile reference is enough — we keep the full
    // adjustment state (excluding recipe-specific intensity).
    const s = {
      profileId: state.profileId,
      film: deepClone(state.film),
      vignette: state.vignette,
      light: deepClone(state.light),
      color: deepClone(state.color),
      grade: deepClone(state.grade),
      detail: deepClone(state.detail)
    };
    return s;
  }

  function getRecipes(){ return recipes; }

  function createRecipe(name, state){
    const now = Date.now();
    const r = {
      id: uid(),
      name: name || "Untitled Recipe",
      favorite: false,
      createdAt: now,
      updatedAt: now,
      intensity: 1,
      preset: normalize(state)
    };
    recipes.push(r);
    save();
    return r;
  }
  function duplicateRecipe(id){
    const src = recipes.find(r=>r.id===id);
    if(!src) return null;
    const copy = deepClone(src);
    copy.id = uid();
    copy.name = src.name + " Copy";
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    recipes.push(copy);
    save();
    return copy;
  }
  function deleteRecipe(id){
    recipes = recipes.filter(r=>r.id!==id);
    save();
  }
  function toggleFavorite(id){
    const r = recipes.find(r=>r.id===id);
    if(r){ r.favorite=!r.favorite; r.updatedAt=Date.now(); save(); }
  }
  function renameRecipe(id, name){
    const r = recipes.find(r=>r.id===id);
    if(r){ r.name=name; r.updatedAt=Date.now(); save(); }
  }
  function setIntensity(id, v){
    const r = recipes.find(r=>r.id===id);
    if(r){ r.intensity=v; r.updatedAt=Date.now(); save(); }
  }
  function getRecipe(id){ return recipes.find(r=>r.id===id); }

  /* Apply a recipe to the app state. intensity scales the amount of the
     recipe's adjustments on top of the current photo. */
  function applyToState(recipe, State){
    const p = recipe.preset;
    const t = recipe.intensity;
    State.cur.profileId = p.profileId;
    State.cur.film.intensity = p.film.intensity * t;
    // scale manual adjustments by t
    State.cur.vignette = p.vignette * t;
    for(const g of ["light","color","grade","detail"]){
      const src=p[g]||{};
      for(const k in src){
        if(src[k] && typeof src[k]==="object"){
          if(!State.cur[g][k]) State.cur[g][k]={};
          for(const kk in src[k]) State.cur[g][k][kk]=src[k][kk]*t;
        } else if(typeof src[k]==="number"){
          State.cur[g][k]=src[k]*t;
        }
      }
    }
    State.cur.film.grain = (p.film?.grain||0)*t;
    State.cur.film.halation = (p.film?.halation||0)*t;
    State.cur.film.bloom = (p.film?.bloom||0)*t;
    State.cur.film.grainSize = p.film?.grainSize??0.5;
    State.cur.film.grainStrength = p.film?.grainStrength??0.5;
    State.commit(deepClone(State.cur));
  }

  /* Export all recipes (or a single one) as JSON */
  function exportJSON(ids){
    const data = ids && ids.length>=0 && ids.length===1
      ? recipes.filter(r=>ids.indexOf(r.id)>=0)
      : recipes;
    return JSON.stringify(data, null, 2);
  }
  function importJSON(text){
    let data;
    try{ data = JSON.parse(text); }catch(e){ throw new Error("Invalid JSON"); }
    const arr = Array.isArray(data) ? data : [data];
    for(const item of arr){
      if(!item || !item.preset) continue;
      const r = {
        id: uid(), name: item.name||"Imported Recipe",
        favorite: false, createdAt: Date.now(), updatedAt: Date.now(),
        intensity: typeof item.intensity==="number" ? item.intensity : 1,
        preset: item.preset
      };
      recipes.push(r);
    }
    save();
    return arr.length;
  }

  /* ---- Bundled real Fujifilm recipes (from fujiRecipes.js) ----
     These live alongside the user's saved recipes in the UI but are
     marked as built-in so they aren't saved/deleted accidentally. */
  function builtinRecipes(){
    if(!global.FUJI.fujiRecipes) return [];
    return global.FUJI.fujiRecipes.getRecipes().map(r=>({
      id: r.id,
      name: r.name,
      favorite: false,
      builtin: true,
      fuji: r,
      preset: normalize(r.state)
    }));
  }

  /* All recipes incl. builtin Fuji ones */
  function allRecipes(){
    const user = recipes.slice();
    const built = builtinRecipes();
    const ids = new Set(user.map(r=>r.id));
    for(const b of built) if(!ids.has(b.id)) user.push(b);
    return user;
  }

  global.FUJI.recipes = {
    load, getRecipes, createRecipe, duplicateRecipe, deleteRecipe,
    toggleFavorite, renameRecipe, setIntensity, getRecipe, applyToState,
    exportJSON, importJSON, save,
    builtinRecipes, allRecipes,
    loadFavs, saveFavs, isFav, toggleFav
  };
})(typeof window!=="undefined"?window:globalThis);
