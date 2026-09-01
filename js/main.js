/* =====================================================================
   F-UJI main.js — app bootstrap, photo pipeline, render loop,
   gestures, crop, export, recipes, service worker.
   ===================================================================== */
(function (global) {
  "use strict";
  const M = global.FUJI.math;
  const App = global.App;
  const FUJI = global.FUJI;

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.prototype.slice.call(document.querySelectorAll(sel));

  /* ---------------- Canvas / engine setup ---------------- */
  const viewCanvas = $('#view-canvas');
  const origCanvas = $('#orig-canvas');
  const stage = $('#stage');

  let engine = null;
  let photo = null;      // { canvas, w, h, name, type, url }
  let fit = { w:0, h:0, x:0, y:0, sw:0, sh:0 };   // display geometry (css px)
  let renderScale = 1;   // backing resolution factor

  App.state = new FUJI.State();
  FUJI.recipes.load();

  /* ---------------- layout ---------------- */
  function computeFit(){
    if(!photo) return fit;
    const rect = stage.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    const a = photo.w/photo.h;
    let w = W, h = W/a;
    if(h > H){ h = H; w = H*a; }
    return { w, h, x:(W-w)/2, y:(H-h)/2, sw:w, sh:h };
  }
  App.layoutStage = function(){
    if(!photo) return;
    fit = computeFit();
    stage.dataset.hasPhoto = "1";
    const css = { width: fit.w+'px', height: fit.h+'px', left: fit.x+'px', top: fit.y+'px' };
    viewCanvas.style.cssText += `left:${fit.x}px;top:${fit.y}px;width:${fit.w}px;height:${fit.h}px;position:absolute;`;
    origCanvas.style.cssText += `left:${fit.x}px;top:${fit.y}px;width:${fit.w}px;height:${fit.h}px;position:absolute;`;
    App.ui.updateSplit(50);
    renderScale = Math.min(2, Math.max(1, (stage.getBoundingClientRect().width/fit.w)*1.4));
    scheduleRender();
  };

  /* ---------------- render loop ---------------- */
  /* quality: 0.5 preview-drag, 1 full */
  function bake(){
    return M.bakeParams(App.state.cur);
  }
  function render(quality){
    if(!photo || !engine) return;
    const params = bake();
    const w = Math.max(2, Math.round(fit.w * quality * renderScale));
    const h = Math.max(2, Math.round(fit.h * quality * renderScale));
    viewCanvas.width = w; viewCanvas.height = h;
    engine.render(App.sourceCanvas(), w, h, params, { into:viewCanvas });
    // original canvas for before/after
    origCanvas.width = w; origCanvas.height = h;
    const octx = origCanvas.getContext('2d');
    octx.imageSmoothingQuality='high';
    octx.drawImage(App.sourceCanvas(), 0, 0, w, h);
    updateMeta(w,h);
  }
  App.renderOrig = function(){ render(1); };
  function updateMeta(w,h){
    $('#meta-res').textContent = photo.w + '×' + photo.h;
    $('#meta-zoom').textContent = Math.max(w,h) >= Math.min(photo.w,photo.h) ? 'Full' : Math.round(Math.min(w,h)/Math.min(photo.w,photo.h)*100)+'%';
  }
  let pendingRAF=0;
  /* live/low-res preview while dragging; high-res when committed */
  function scheduleRender(){
    if(pendingRAF) cancelAnimationFrame(pendingRAF);
    pendingRAF = requestAnimationFrame(()=>{ pendingRAF=0; render(0.5); });
  }
  App.renderLive = function(){ scheduleRender(); };
  App.renderFull = function(){
    if(pendingRAF) cancelAnimationFrame(pendingRAF);
    render(Math.max(1,renderScale));
  };

  /* ---------------- state → render wiring ---------------- */
  App.state.onChange(scheduleRender);
  App.state.onRecipes(()=>{ App.ui.renderRecipeList(); });
  App.resetTools = function(){
    const prev=FUJI.deepClone(App.state.cur);
    const id=App.state.cur.profileId;
    App.state.cur=FUJI.defaultState();
    App.state.cur.profileId=id;
    App.state.cur.film.intensity=1;
    App.state.commit(prev);
    App.updateHistoryFlags();
    App.toast('Adjustments reset');
  };
  App.ui.liveSlider = function(o,v){ App.state.liveUpdate(o.path, v); scheduleRender(); };
  App.ui.sliderCommit = function(o,v){ App.state.setPartial(o.path, v); App.updateHistoryFlags(); };
  App.onPresetPick = function(id){
    App.state.applyProfile(id);
    App.updateHistoryFlags();
  };

  /* ---------------- source canvas ---------------- */
  App.sourceCanvas = function(){ return photo ? photo.canvas : null; };

  /* ---------------- import ---------------- */
  function loadImageFile(file){
    if(!file) return;
    const url = URL.createObjectURL(file);
    loadFromURL(url, file.name, file.type, file);
  }
  function loadFromURL(url, name, type, file){
    const img = new Image();
    img.onload = ()=>{
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img,0,0);
      attachPhoto(c, name, type||'image/jpeg', file);
      URL.revokeObjectURL(url);
    };
    img.onerror = ()=>{ App.toast('Could not load image'); URL.revokeObjectURL(url); };
    img.src = url;
  }
  async function attachPhoto(canvas, name, type, file){
    photo = { canvas, w:canvas.width, h:canvas.height, name:name||'photo.jpg', type:type||'image/jpeg' };
    if(!engine){
      engine = FUJI.createEngine(viewCanvas);
      if(!engine){ App.toast('WebGL not available on this device'); return; }
      App.engine=engine;
    }
    App.ui.buildCompareBar();
    $('#home').classList.add('hidden');
    $('#editor').classList.remove('hidden');
    App.state.reset();
    App.layoutStage();
    App.toast('Photo ready');
    // Analyze context (EXIF + scene) — fully on-device
    let exif = null;
    if(file){ try { exif = await FUJI.context.readEXIF(file); } catch(e){ exif=null; } }
    const scene = FUJI.context.analyzeScene(canvas);
    App.context = { exif, scene: scene.tags, sceneFull: scene, auto: FUJI.context.autoAdjust(exif, scene) };
    // meta chips: camera + ISO if present
    const cam = exif ? `${exif.make} ${exif.model}`.replace(/^\s+|\s+$/g,'') : '';
    if(cam) $('#meta-res').textContent = cam;
    const exifChip = exif && exif.iso ? `ISO ${exif.iso}${exif.focalLength?` · ${Math.round(exif.focalLength)}mm`:''}` : '';
    const meta = $$('#stage-meta');
    if(meta && meta[1]) meta[1].textContent = exifChip || (photo.w + '×' + photo.h);
    App.toast(`Detected: ${scene.tags.length ? scene.tags.join(', ') : 'no scene hints'}`);
  }
  /* keep a transition message */
  function gotoEditor(){ $('#home').classList.add('hidden'); $('#editor').classList.remove('hidden'); }

  $('#scan-import').addEventListener('click', ()=>{ App.showSpinner(); setTimeout(()=>{App.hideSpinner(); $('#file-input').click();}, 60); });
  $('#btn-open-picker').addEventListener('click', ()=>{ $('#file-input').click(); });
  $('#file-input').addEventListener('change', (e)=>{
    const f=e.target.files&&e.target.files[0];
    if(!f) return;
    App.showSpinner();
    setTimeout(()=>{ App.hideSpinner(); loadImageFile(f); }, 40);
  });

  /* paste / drag-drop where supported */
  window.addEventListener('paste', (e)=>{
    const items = e.clipboardData && e.clipboardData.items;
    if(!items) return;
    for(const it of items){
      if(it.type.startsWith('image/')){ const f=it.getAsFile(); if(f){ loadImageFile(f); return; } }
    }
  });
  stage.addEventListener('dragover', e=>{ e.preventDefault(); });
  stage.addEventListener('drop', e=>{
    e.preventDefault();
    const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
    if(f&&f.type.startsWith('image/')) loadImageFile(f);
  });

  /* ---------------- before/after gestures ---------------- */
  let holdTimer=null, holding=false;
  stage.addEventListener('pointerdown', startStagePointer);
  stage.addEventListener('pointermove', moveStagePointer);
  stage.addEventListener('pointerup', endStagePointer);
  stage.addEventListener('pointercancel', endStagePointer);

  function stagePoint(e){ const r=stage.getBoundingClientRect(); return { x:(e.clientX-r.left), y:(e.clientY-r.top) }; }
  function startStagePointer(e){
    if(App.ui.baMode==='off'){
      if(App.ui.activeTool==='crop' || cropActive()) { App.ui.cropStart(e); return; }
      holding=true;
      showOrig(true);   // press-and-hold reveals original instantly
    } else if(App.ui.baMode==='split' || App.ui.baMode==='swipe'){
      const p=stagePoint(e);
      App.ui.updateSplit(p.x/fit.w*100);
    }
  }
  function moveStagePointer(e){
    if((App.ui.baMode==='split'||App.ui.baMode==='swipe')){
      const p=stagePoint(e); App.ui.updateSplit(p.x/fit.w*100);
    }
    if(cropActive() && App.ui.cropDrag) App.ui.cropDrag(e);
  }
  function endStagePointer(e){
    if(holding){ showOrig(false); holding=false; }
    clearTimeout(holdTimer);
  }
  function showOrig(show){
    const oc=$('#orig-canvas');
    oc.style.opacity = show ? '1':'0';
    if(App.ui.baMode!=='off') return;
  }

  let cropState = null; // { rect:{l,t,r,b} in canvas display coords, ratio, mode }
  function cropActive(){ return cropState && App.ui.activeTool==='crop'; }
  App.onCropRatio = function(ratio){
    App.cropRatio=ratio;
    if(photo) beginCrop(ratio==='free'?null:ratio);
  };
  function beginCrop(ratio){
    const w=fit.w, h=fit.h;
    let l=0,t=0,r=w-1,b=h-1;
    if(ratio){
      const rw=parseFloat(ratio.split(':')[0]), rh=parseFloat(ratio.split(':')[1]);
      let rr=rw/rh, imgA=w/h;
      if(ratio==='9:16') rr=9/16;
      if(rr>imgA){ const nh=w/rr; t=(h-nh)/2; b=t+nh; }
      else { const nw=h*rr; l=(w-nw)/2; r=l+nw; }
    }
    cropState={ rect:{l,t,r,b}, ratio, mode:'idle' };
    $('#crop-overlay').classList.remove('hidden');
    renderCropOverlay();
  }
  function renderCropOverlay(){
    if(!cropState) return;
    const R=cropState.rect;
    const over=$('#crop-overlay');
    const frame=over.querySelector('.crop-frame');
    const rect=stage.getBoundingClientRect();
    const xt=fit.y, xl=fit.x, W=fit.w, H=fit.h;
    const FR=fit.w/fit.h;
    frame.style.left=((R.l)+xl)+'px'; frame.style.top=((R.t)+xt)+'px';
    frame.style.width=(R.r-R.l)+'px'; frame.style.height=(R.b-R.t)+'px';
    // masks: top, bottom, left, right (absolute px over stage)
    const ro='0';
    over.querySelector('.crop-mask-t').setAttribute('style',`left:0;right:0;top:0;height:${(R.t)+xt}px;`);
    over.querySelector('.crop-mask-b').setAttribute('style',`left:0;right:0;top:${(R.b)+xt}px;bottom:0;`);
    over.querySelector('.crop-mask-l').setAttribute('style',`left:0;top:0;bottom:0;width:${(R.l)+xl}px;`);
    over.querySelector('.crop-mask-r').setAttribute('style',`right:0;top:0;bottom:0;width:${rect.width-((R.r)+xl)}px;`);
  }
  App.ui.cropStart=function(e){
    if(!cropState){ beginCrop(App.cropRatio&&App.cropRatio!=='free'?App.cropRatio:null); }
    const p=stagePoint(e);
    const R=cropState.rect;
    const near = v=>Math.abs(v-p.x)<24;
    const neary = v=>Math.abs(v-p.y)<24;
    let mode=null;
    if(near(R.l)&&neary(R.t)) mode='nw'; else if(near(R.r)&&neary(R.t)) mode='ne';
    else if(near(R.l)&&neary(R.b)) mode='sw'; else if(near(R.r)&&neary(R.b)) mode='se';
    else if(p.x>R.l&&p.x<R.r&&p.y>R.t&&p.y<R.b) mode='move';
    else mode='new';
    cropState.mode=mode;
    if(mode==='new'){ cropState.rect={l:p.x,t:p.y,r:p.x,b:p.y}; }
    cropState.anchor={ x:p.x, y:p.y, rect:{...cropState.rect} };
    renderCropOverlay();
  };
  App.ui.cropDrag=function(e){
    if(!cropState||!cropState.mode) return;
    const p=stagePoint(e);
    const a=cropState.anchor;
    const AR=a.rect||cropState.rect;
    const ratio=cropState.ratio&&cropState.ratio!=='free'
      ? parseFloat(cropState.ratio.split(':')[0])/parseFloat(cropState.ratio.split(':')[1]) : null;
    const MIN=24;
    function clampRect(rect){
      let {l,t,r,b}=rect;
      l=Math.max(0,Math.min(l,fit.w-1)); r=Math.max(l+MIN,Math.min(r,fit.w));
      t=Math.max(0,Math.min(t,fit.h-1)); b=Math.max(t+MIN,Math.min(b,fit.h));
      return {l,t,r,b};
    }
    let rect;
    const dw=p.x-a.x, dh=p.y-a.y;
    switch(cropState.mode){
      case 'se': {
        let w=AR.r-AR.l+dw, h=ratio?w/ratio:AR.b-AR.t+dh;
        w=Math.max(MIN,ifFin(w)); h=Math.max(MIN,ifFin(h));
        if(ratio) h=w/ratio;
        rect={l:AR.l,t:AR.t, r:AR.l+w, b:AR.t+h};
        break; }
      case 'nw': {
        let w=AR.r-AR.l-dw, h=ratio?w/ratio:AR.b-AR.t-dh;
        w=Math.max(MIN,ifFin(w)); h=Math.max(MIN,ifFin(h));
        if(ratio) h=w/ratio;
        rect={l:AR.r-w, t:AR.b-h, r:AR.r, b:AR.b};
        break; }
      case 'ne': {
        let w=AR.r-AR.l+dw, h=ratio?w/ratio:AR.b-AR.t-dh;
        w=Math.max(MIN,ifFin(w)); h=Math.max(MIN,ifFin(h));
        if(ratio) h=w/ratio;
        rect={l:AR.l, t:AR.b-h, r:AR.l+w, b:AR.b};
        break; }
      case 'sw': {
        let w=AR.r-AR.l-dw, h=ratio?w/ratio:AR.b-AR.t+dh;
        w=Math.max(MIN,ifFin(w)); h=Math.max(MIN,ifFin(h));
        if(ratio) h=w/ratio;
        rect={l:AR.r-w, t:AR.t, r:AR.r, b:AR.t+h};
        break; }
      case 'move': {
        const dx=dw, dy=dh;
        rect={l:AR.l+dx, t:AR.t+dy, r:AR.r+dx, b:AR.b+dy};
        break; }
      default: // 'new' raw drag
        rect={l:Math.min(a.x,p.x), t:Math.min(a.y,p.y), r:Math.max(a.x,p.x), b:Math.max(a.y,p.y)};
        break;
    }
    cropState.rect=clampRect(rect);
    renderCropOverlay();
    function ifFin(v){ return isFinite(v)?v:0; }
  };
  App.onCropApply=function(){
    if(!cropState||!photo) return;
    const R=cropState.rect;
    const sx=R.l/fit.w*photo.w, sy=R.t/fit.h*photo.h;
    const sw=(R.r-R.l)/fit.w*photo.w, sh=(R.b-R.t)/fit.h*photo.h;
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(sw)); c.height=Math.max(1,Math.round(sh));
    const ctx=c.getContext('2d'); ctx.imageSmoothingQuality='high';
    ctx.drawImage(photo.canvas, sx,sy,sw,sh, 0,0,c.width,c.height);
    const prev=FUJI.deepClone(App.state.cur);
    photo={ canvas:c, w:c.width,h:c.height, name:photo.name, type:photo.type };
    cropState=null;
    $('#crop-overlay').classList.add('hidden');
    App.state.commit(prev);   // undoable crop
    App.layoutStage();
    App.toast('Cropped');
  };
  App.onCropReset=function(){ $('#crop-overlay').classList.add('hidden'); cropState=null; };

  /* ---------------- history flags ---------------- */
  App.updateHistoryFlags=function(){
    $('#btn-undo').disabled=!App.state.canUndo();
    $('#btn-redo').disabled=!App.state.canRedo();
  };
  $('#btn-undo').addEventListener('click',()=>{ App.state.undo(); App.renderFull(); App.updateHistoryFlags(); });
  $('#btn-redo').addEventListener('click',()=>{ App.state.redo(); App.renderFull(); App.updateHistoryFlags(); });
  $('#btn-export').addEventListener('click',()=>App.ui.openExport());
  $('#btn-import-top').addEventListener('click',()=>{ $('#file-input').click(); });

  /* ---------------- export ---------------- */
  App.exportFmt='jpeg'; App.exportQuality=0.9;
  App.onExportOpen=function(){
    if(!photo) return;
    const draw=()=>{
      const c=App.exportRender(Math.min(photo.w, 640));
      App.exportPreview.innerHTML='';
      App.exportPreview.appendChild(c);
      if(c.width){ App.exportPreview.classList.remove('hidden'); $('#export-sheet').classList.add('taller'); }
    };
    setTimeout(draw,30);
  };
  /* cached offscreen render target+engine so WebGL contexts aren't leaked */
  App.exportRender=function(maxDim){
    const scale=Math.min(1, maxDim/Math.max(photo.w,photo.h));
    const w=Math.max(2,Math.round(photo.w*scale)), h=Math.max(2,Math.round(photo.h*scale));
    if(!App._exportCanvas){ App._exportCanvas=document.createElement('canvas'); App._exportEngine=FUJI.createEngine(App._exportCanvas); }
    const c=App._exportCanvas;
    c.width=w; c.height=h;
    App._exportEngine.render(App.sourceCanvas(), w, h, bake());
    App._lastParams=bake();
    return c;
  };
  App.onExportGo=function(){
    App.showSpinner();
    setTimeout(()=>{
      try{
        const w=photo.w, h=photo.h;
        const c=App.exportRender(w);
        const mime = App.exportFmt==='png' ? 'image/png' : 'image/jpeg';
        const q = App.exportFmt==='jpeg' ? App.exportQuality : null;
        c.toBlob((blob)=>{
          App.hideSpinner();
          if(!blob){ App.toast('Export failed'); return; }
          const file=new File([blob], 'fuji-export.'+(App.exportFmt==='png'?'png':'jpg'), {type:mime});
          if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
            navigator.share({ files:[file], title:'F-UJI export' }).then(()=>{}).catch(()=>{ saveBlob(blob,file.name); });
          } else {
            saveBlob(blob,file.name);
          }
        }, mime, q);
      }catch(err){ App.hideSpinner(); App.toast('Export error: '+err.message); }
    }, 30);
  };
  function saveBlob(blob,name){
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
    document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},100);
    App.toast('Saved');
  }

  /* ---------------- recipes ---------------- */
  App.onRecipeSave=function(){
    const name=prompt('Recipe name', 'My Look');
    if(name===null) return;
    FUJI.recipes.createRecipe(name, App.state.cur);
    App.ui.renderRecipeList();
    App.toast('Recipe saved');
  };
  App.onRecipeApply=function(id){
    const r=FUJI.recipes.allRecipes().find(x=>x.id===id);
    if(!r) return;
    if(r.builtin && r.fuji){
      FUJI.fujiRecipes.applyRecipe(r.fuji, App.state);
    } else {
      FUJI.recipes.applyToState(r, App.state);
    }
    App.renderFull(); App.updateHistoryFlags();
    App.ui.closeSheet(()=>{});
    App.toast('Applied '+r.name);
  };
  App.onRecipeExport=function(){
    const recs=FUJI.recipes.getRecipes();
    if(!recs.length){ App.toast('No recipes to export'); return; }
    App.downloadJSON(FUJI.recipes.exportJSON(), 'fuji-recipes.json');
  };
  App.onRecipeImport=function(){
    const input=document.createElement('input');
    input.type='file'; input.accept='.json,application/json';
    input.onchange=()=>{
      const f=input.files&&input.files[0];
      if(!f) return;
      const reader=new FileReader();
      reader.onload=()=>{
        try{ const n=FUJI.recipes.importJSON(String(reader.result)); App.toast('Imported '+n+' recipe'+(n>1?'s':'')); }
        catch(e){ App.toast('Invalid recipe file'); }
        App.ui.renderRecipeList();
      };
      reader.readAsText(f);
    };
    input.click();
  };
  App.downloadJSON=function(data, name){
    const blob=new Blob([data],{type:'application/json'});
    saveBlob(blob,name);
  };

  /* ---------------- boot ---------------- */
  function boot(){
    App.ui.buildToolbar();
    App.ui.updateSplit(50);
    App.updateHistoryFlags();
    // initial: no photo
    App.state.emit();
    window.addEventListener('resize', ()=>{ App.layoutStage(); });
    registerSW();

    /* Prevent pull-to-refresh on iOS while letting sheets scroll normally */
    document.addEventListener('touchmove', e=>{
      if(e.target && e.target.closest && e.target.closest('#stage')) e.preventDefault();
    }, { passive:false });
  }

  /* Service worker */
  function registerSW(){
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('sw.js').catch(()=>{});
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window!=="undefined"?window:globalThis);