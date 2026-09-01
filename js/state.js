/* =====================================================================
   F-UJI state.js — canonical adjustment model + undo/redo + events
   ===================================================================== */
(function (global) {
  "use strict";

  function hslDefault(){ return { hue:{r:0,g:0,b:0,m:0,y:0,c:0}, sat:{r:0,g:0,b:0,m:0,y:0,c:0}, luma:{r:0,g:0,b:0,m:0,y:0,c:0} }; }

  function defaultState(){
    return {
      profileId: "proviasoft",
      film: { intensity: 1.0, grain: 0, grainSize: 0.5, grainStrength: 0.5, halation: 0, bloom: 0 },
      vignette: 0,
      light: { exposure:0, contrast:0, highlights:0, shadows:0, whites:0, blacks:0 },
      color: { temperature:0, tint:0, vibrance:0, saturation:0, hsl: hslDefault() },
      grade: { shadowHue:0.5, shadowSat:0, highlightHue:0.5, highlightSat:0, balance:0.5 },
      detail: { texture:0, clarity:0, sharp:0, noise:0, dehaze:0 }
    };
  }

  function deepClone(o){ return o ? JSON.parse(JSON.stringify(o)) : o; }

  class State {
    constructor(){
      this.cur = defaultState();
      this.undoStack = [];
      this.redoStack = [];
      this.maxHistory = 60;
      this.listeners = [];
      this.recipeListeners = [];
    }
    onChange(fn){ this.listeners.push(fn); }
    onRecipes(fn){ this.recipeListeners.push(fn); }
    emit(){ this.listeners.forEach(fn=>fn(this.cur)); }
    emitRecipes(){ this.recipeListeners.forEach(fn=>fn()); }
    set(fn){
      // fn may mutate cur; capture snapshot BEFORE for history
      const prev = deepClone(this.cur);
      fn(this.cur);
      this.commit(prev);
    }
    /* update a path (dot-notation) with value, no history push (live) */
    liveUpdate(path, value){
      const parts=path.split('.');
      let o=this.cur;
      for(let i=0;i<parts.length-1;i++) o=o[parts[i]];
      o[parts[parts.length-1]]=value;
      this.emit();
    }
    /* Same as liveUpdate but snapshot-able for a discrete operation */
    setPartial(path, value){
      const prev=deepClone(this.cur);
      const parts=path.split('.'); let o=this.cur;
      for(let i=0;i<parts.length-1;i++) o=o[parts[i]];
      o[parts[parts.length-1]]=value;
      this.commit(prev);
    }
    commit(prev){
      this.undoStack.push(prev);
      if(this.undoStack.length>this.maxHistory) this.undoStack.shift();
      this.redoStack.length=0;
      this.emit();
    }
    undo(){
      if(!this.undoStack.length) return;
      this.redoStack.push(deepClone(this.cur));
      this.cur=this.undoStack.pop();
      this.emit();
    }
    redo(){
      if(!this.redoStack.length) return;
      this.undoStack.push(deepClone(this.cur));
      this.cur=this.redoStack.pop();
      this.emit();
    }
    canUndo(){ return this.undoStack.length>0; }
    canRedo(){ return this.redoStack.length>0; }
    reset(){
      this.cur=defaultState();
      this.undoStack.length=0; this.redoStack.length=0;
      this.emit();
    }
    /* apply a profile */
    applyProfile(id){
      const prev=deepClone(this.cur);
      this.cur.profileId=id;
      this.cur.film.intensity=1;
      this.commit(prev);
    }
  }

  global.FUJI = global.FUJI || {};
  global.FUJI.defaultState = defaultState;
  global.FUJI.deepClone = deepClone;
  global.FUJI.State = State;
})(typeof window!=="undefined"?window:globalThis);
