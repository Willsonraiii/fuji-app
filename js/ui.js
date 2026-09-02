/* =====================================================================
   F-UJI ui.js — toolbar, sheets, controls, presets, recipes,
   before/after, export.
   Depends on a global `App` populated by main.js:
     App.state, App.render, App.renderOrig, App.source (canvas),
     App.stage, App.origCanvas, App.showSpinner/hideSpinner, App.toast.
   ===================================================================== */
(function (global) {
  "use strict";
  const App = global.App = global.App || {};
  const $$ = sel => document.querySelector(sel);

  /* ---------- SVG icon catalog (simple line icons) ---------- */
  const ICONS = {
    film:'<path d="M3 6h6v12H3z M9 9h12 M9 15h12"/><path d="M17 6h4v6h-4z"/>',
    adjust:'<circle cx="12" cy="12" r="3"/><path d="M12 2v4 M12 18v4 M2 12h4 M18 12h4"/>',
    color:'<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z"/>',
    detail:'<path d="M12 3v6 M12 15v6 M3 12h6 M15 12h6"/><circle cx="12" cy="12" r="2.5"/>',
    crop:'<path d="M6 2v16h16 M2 6h16"/><path d="M18 8v14"/>',
    recipes:'<path d="M12 4a5 5 0 0 1 5 5c0 2-1 3.5-2 5h-6c-1-1.5-2-3-2-5a5 5 0 0 1 5-5z"/><path d="M9 16h6 M10 20h4"/>',
    undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    close:'<path d="M6 6l12 12 M18 6 6 18"/>',
    check:'<path d="M4 12l5 5L20 6"/>',
    save:'<path d="M4 20V4h9l3.5 3.5V20"/><path d="M9 20v-6h6v6"/>',
    duplicate:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    trash:'<path d="M5 7h14 M9 7V4h6v3 M7 7l1 13h8l1-13"/>',
    heart:'<path d="M12 20s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z"/>',
    share:'<path d="M12 3v12 M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/>',
    export:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    compare:'<path d="M3 6h18v12H3z M12 6v12"/>'
  };
  function icon(name, cls){ return `<svg class="${cls||''}" viewBox="0 0 24 24">${ICONS[name]||''}</svg>`; }

  /* ================= TOOLBAR ================= */
  const TOOLS = [
    { id:'film', label:'Film', icon:'film' },
    { id:'adjust', label:'Adjust', icon:'adjust' },
    { id:'color', label:'Color', icon:'color' },
    { id:'detail', label:'Detail', icon:'detail' },
    { id:'crop', label:'Crop', icon:'crop' },
    { id:'recipes', label:'Recipes', icon:'recipes' }
  ];

  App.ui = App.ui || {};

  App.ui.buildToolbar = function(){
    const strip = $$('#tool-strip');
    strip.innerHTML = '';
    TOOLS.forEach(t=>{
      const b=document.createElement('button');
      b.className='tool'; b.dataset.tool=t.id;
      b.innerHTML = icon(t.icon)+`<span>${t.label}</span><span class="tool-active-dot"></span>`;
      b.addEventListener('click', ()=> App.ui.openTool(t.id, b));
      strip.appendChild(b);
    });
  };

  App.ui.activeTool = null;
  App.ui.openTool = function(id, btn){
    if(App.exitWBPick) App.exitWBPick();
    document.querySelectorAll('#bottom-bar .tool').forEach(x=>x.classList.remove('active'));
    if(btn) btn.classList.add('active');
    App.ui.activeTool=id;
    const body = $$('#sheet-body');
    const layer = $$('#sheet-layer');
    const sheet = $$('#sheet');
    if(id==='recipes'){ App.ui.openRecipeSheet(); return; }
    // build content
    const title = TOOLS.find(t=>t.id===id);
    let content;
    if(id==='film') content = App.ui.filmContent();
    else if(id==='adjust') content = App.ui.adjustContent();
    else if(id==='color') content = App.ui.colorContent();
    else if(id==='detail') content = App.ui.detailContent();
    else if(id==='crop') content = App.ui.cropContent();
    const resetBtn=document.createElement('button'); resetBtn.className='st-reset'; resetBtn.id='sheet-reset'; resetBtn.textContent='Reset';
    const titleEl=document.createElement('div'); titleEl.className='sheet-title';
    const label=document.createElement('span'); label.className='st-label'; label.textContent=title.label;
    titleEl.appendChild(label); titleEl.appendChild(resetBtn);
    body.innerHTML='';
    body.appendChild(titleEl);
    if(content) body.appendChild(content);
    resetBtn.addEventListener('click', ()=>App.resetTools&&App.resetTools());
    App.ui.bindSheetContent(id, body);
    body.scrollTop=0;
    App.ui.showSheet(layer, sheet);
  };
  App.ui.bindSheetContent = function(){ /* sliders self-wire via liveSlider/sliderCommit */ };

  App.ui.showSheet = function(layer, sheet){
    layer.classList.remove('hidden','closing');
    App._sheetEl=sheet;
    document.querySelectorAll('.sheet-layer').forEach(l=>{ if(l!==layer) l.classList.add('hidden'); });
    const backdrop=layer.querySelector('.sheet-backdrop');
    if(backdrop && !layer.dataset.bm){
      backdrop.addEventListener('click', ()=>App.ui.closeLayer(layer));
      layer.dataset.bm='1';
    }
  };
  App.ui.closeLayer = function(layer){
    layer.classList.add('closing');
    App.ui.activeTool=null;
    document.querySelectorAll('#bottom-bar .tool').forEach(x=>x.classList.remove('active'));
    setTimeout(()=>{ layer.classList.add('hidden'); layer.classList.remove('closing'); },320);
  };
  App.ui.closeSheet = function(done){
    const layer = $$('#sheet-layer');
    layer.classList.add('closing');
    setTimeout(()=>{ layer.classList.add('hidden'); layer.classList.remove('closing'); if(done)done(); },320);
  };

  /* ---------- Sheet builder utilities ---------- */
  function sliderRow(opts){
    const row=document.createElement('div');
    row.className='slider-row';
    row.innerHTML = `<div class="s-icon">${opts.icon||''}</div>
      <div class="s-main">
        <div class="s-label"><span>${opts.label}</span><span class="s-val">${fmtVal(opts.value, opts.fmt)}</span></div>
        <input type="range" class="f-range" min="${opts.min}" max="${opts.max}" step="${opts.step}" value="${opts.value}" />
      </div>`;
    const input=row.querySelector('input');
    const val=row.querySelector('.s-val');
    const fill=()=>{ const p=(input.value-opts.min)/(opts.max-opts.min)*100; input.style.setProperty('--fill',p+'%'); };
    fill();
    input.addEventListener('input', ()=>{ val.textContent=fmtVal(parseFloat(input.value),opts.fmt); App.ui.liveSlider(opts, parseFloat(input.value)); });
    input.addEventListener('pointerup', ()=> App.ui.sliderCommit(opts, parseFloat(input.value)));
    input.addEventListener('keyup', ()=>{ if(opts.nullZero && input.value=='0'){} });
    return row;
  }
  function fmtVal(v, f){
    if(f==='pct') return Math.round(v*100)+'%';
    if(f===undefined) return v;
    return Math.round(v*100)/100;
  }
  /* overridden by main to call state+bake */
  App.ui.liveSlider=function(opts,v){ if(App.onSliderLive) App.onSliderLive(opts,v); };
  App.ui.sliderCommit=function(opts,v){ if(App.onSliderCommit) App.onSliderCommit(opts,v); };

  function group(label){ const d=document.createElement('div'); d.className='group-label'; d.textContent=label; return d; }
  function divider(){ const d=document.createElement('div'); d.className='section-divider'; return d; }

  /* ================= FILM SHEET ================= */
  App.ui.filmContent = function(){
    const el=document.createElement('div');
    const prof=App.sourceProfileId||App.state.cur.profileId;
    el.appendChild(presetCarousel(prof?prof:'off'));
    el.appendChild(group('Film intensity'));
    el.appendChild(sliderRow({label:'Intensity',min:0,max:1,step:0.01,value:App.state.cur.film.intensity,fmt:'pct',path:'film.intensity',icon:'◐'}));
    el.appendChild(divider());
    el.appendChild(group('Grain & Glow'));
    el.appendChild(sliderRow({label:'Grain',min:0,max:1,step:0.01,value:App.state.cur.film.grain,fmt:'pct',path:'film.grain',icon:'⁙'}));
    el.appendChild(sliderRow({label:'Grain size',min:0,max:1,step:0.01,value:App.state.cur.film.grainSize,path:'film.grainSize',icon:'⬛'}));
    el.appendChild(sliderRow({label:'Grain strength',min:0,max:1,step:0.01,value:App.state.cur.film.grainStrength,path:'film.grainStrength',icon:'⬜'}));
    el.appendChild(sliderRow({label:'Halation',min:0,max:1,step:0.01,value:App.state.cur.film.halation,fmt:'pct',path:'film.halation',icon:'☀'}));
    el.appendChild(sliderRow({label:'Bloom',min:0,max:1,step:0.01,value:App.state.cur.film.bloom,fmt:'pct',path:'film.bloom',icon:'✦'}));
    el.appendChild(sliderRow({label:'Vignette',min:-1,max:1,step:0.01,value:App.state.cur.vignette,path:'vignette',icon:'◍'}));
    return el;
  };
  function presetCarousel(selId){
    const wrap=document.createElement('div'); wrap.className='preset-carousel';
    const profs=global.FUJI.profiles;
    ( [{id:'off',name:'Original',type:'None',bw:false,swatch:'#333',off:true}].concat(profs) ).forEach(p=>{
      const item=document.createElement('div'); item.className='preset-item'+(p.id===selId?' active':'');
      item.dataset.id=p.id;
      const badge = p.bw ? '<span class="grayscale-badge">BW</span>' : '';
      item.innerHTML=`<div class="preset-thumb" style="background:${p.swatch}">${badge}</div>
        <div class="preset-name">${p.name}</div>`;
      item.addEventListener('click', ()=>{
        document.querySelectorAll('.preset-item').forEach(x=>x.classList.remove('active'));
        item.classList.add('active');
        if(App.onPresetPick) App.onPresetPick(p.id);
      });
      wrap.appendChild(item);
    });
    return wrap;
  }

  /* ================= ADJUST SHEET ================= */
  const LIGHT_DEFS = [
    ['exposure','Exposure',-2,2,0.01],
    ['contrast','Contrast',-1,1,0.01],
    ['highlights','Highlights',-1,1,0.01],
    ['shadows','Shadows',-1,1,0.01],
    ['whites','Whites',-1,1,0.01],
    ['blacks','Blacks',-1,1,0.01]
  ];
  App.ui.adjustContent = function(){
    const el=document.createElement('div');
    el.appendChild(group('Light'));
    const s=App.state.cur.light;
    LIGHT_DEFS.forEach(([k,label,min,max,step])=>{
      el.appendChild(sliderRow({label,min,max,step,value:s[k],path:'light.'+k}));
    });
    // Auto button (uses App.context)
    const auto = document.createElement('div'); auto.className='confirm-bar';
    auto.innerHTML = `<button class="btn-ghost" id="auto-context">Auto from context</button>`;
    auto.querySelector('#auto-context').addEventListener('click', ()=>{
      if(!App.context || !App.context.auto || !Object.keys(App.context.auto.tweaks||{}).length){
        App.toast('No context available'); return;
      }
      const t = App.context.auto.tweaks;
      const pathMap = {
        exposure:'light.exposure', contrast:'light.contrast', highlights:'light.highlights',
        shadows:'light.shadows', whites:'light.whites', blacks:'light.blacks',
        temperature:'color.temperature', tint:'color.tint',
        vibrance:'color.vibrance', saturation:'color.saturation',
        clarity:'detail.clarity', sharp:'detail.sharp', noise:'detail.noise', dehaze:'detail.dehaze'
      };
      const prev = FUJI.deepClone(App.state.cur);
      for(const k in t){ if(pathMap[k]) App.state.cur[pathMap[k].split('.')[0]][pathMap[k].split('.')[1]] = t[k]; }
      App.state.commit(prev);
      App.renderFull(); App.updateHistoryFlags();
      App.toast('Applied auto from context');
    });
    el.appendChild(auto);
    App.ui.sheetReset = ()=>{ App.resetTools(); };
    return el;
  };

  /* ================= COLOR SHEET ================= */
  App.ui.colorContent = function(){
    const el=document.createElement('div');
    const c=App.state.cur.color;
    el.appendChild(group('White balance'));
    el.appendChild(sliderRow({label:'Temperature',min:-1,max:1,step:0.01,value:c.temperature,path:'color.temperature',icon:'☀'}));
    el.appendChild(sliderRow({label:'Tint',min:-1,max:1,step:0.01,value:c.tint,path:'color.tint',icon:'♣'}));
    const wbBar=document.createElement('div'); wbBar.className='confirm-bar wb-bar';
    wbBar.innerHTML=`<button class="btn-ghost" id="wb-auto">✨ Auto WB</button>
      <button class="btn-ghost" id="wb-pick">⌖ Pick from photo</button>`;
    wbBar.querySelector('#wb-auto').addEventListener('click', ()=>{ if(App.onAutoWB)App.onAutoWB(); });
    wbBar.querySelector('#wb-pick').addEventListener('click', ()=>{ if(App.onWBPick)App.onWBPick(); });
    el.appendChild(wbBar);
    el.appendChild(divider());
    el.appendChild(group('Color'));
    el.appendChild(sliderRow({label:'Vibrance',min:-1,max:1,step:0.01,value:c.vibrance,path:'color.vibrance',icon:'◒'}));
    el.appendChild(sliderRow({label:'Saturation',min:-1,max:1,step:0.01,value:c.saturation,path:'color.saturation',icon:'◐'}));
    el.appendChild(divider());
    el.appendChild(group('HSL — 8-band (R O Y G C B M Purple)'));
    el.appendChild(App.ui.hslSegment());
    el.appendChild(divider());
    el.appendChild(group('Color grade'));
    const g=App.state.cur.grade;
    el.appendChild(sliderRow({label:'Shadow hue',min:0,max:1,step:0.01,value:g.shadowHue,path:'grade.shadowHue'}));
    el.appendChild(sliderRow({label:'Shadow sat',min:0,max:1,step:0.01,value:g.shadowSat,path:'grade.shadowSat'}));
    el.appendChild(sliderRow({label:'Highlight hue',min:0,max:1,step:0.01,value:g.highlightHue,path:'grade.highlightHue'}));
    el.appendChild(sliderRow({label:'Highlight sat',min:0,max:1,step:0.01,value:g.highlightSat,path:'grade.highlightSat'}));
    el.appendChild(sliderRow({label:'Balance',min:0,max:1,step:0.01,value:g.balance,path:'grade.balance'}));
    return el;
  };
  App.ui.hslSegment = function(){
    const wrap=document.createElement('div');
    const seg=document.createElement('div'); seg.className='segment';
    const chans = (global.FUJI.hsl?.keys || ['r','o','y','g','c','b','m','p'])
      .map(k => [k, k.toUpperCase()]);
    let active='r';
    chans.forEach(([k,l])=>{
      const d=document.createElement('div'); d.className='seg'+(active===k?' active':''); d.dataset.ch=k; d.textContent=l;
      d.addEventListener('click',()=>{
        seg.querySelectorAll('.seg').forEach(x=>x.classList.remove('active')); d.classList.add('active');
        App.ui.hslSliders(k, wrap);
      });
      seg.appendChild(d);
    });
    wrap.appendChild(seg);
    App.ui.hslSliders(active, wrap);
    return wrap;
  };
  App.ui.hslSliders = function(ch, wrap){
    const holder=document.createElement('div'); holder.id='hsl-sliders';
    const hsl=App.state.cur.color.hsl;
    holder.appendChild(sliderRow({label:'Hue',min:-1,max:1,step:0.01,value:hsl.hue[ch],path:'color.hsl.hue.'+ch}));
    holder.appendChild(sliderRow({label:'Saturation',min:-1,max:1,step:0.01,value:hsl.sat[ch],path:'color.hsl.sat.'+ch}));
    holder.appendChild(sliderRow({label:'Luma',min:-1,max:1,step:0.01,value:hsl.luma[ch],path:'color.hsl.luma.'+ch}));
    const old=wrap.querySelector('#hsl-sliders'); if(old) old.replaceWith(holder);
    wrap.appendChild(holder);
  };

  /* ================= DETAIL SHEET ================= */
  const DETAIL_DEFS = [
    ['texture','Texture',-1,1,0.01],
    ['clarity','Clarity',-1,1,0.01],
    ['sharp','Sharpening',0,1,0.01],
    ['noise','Noise reduction',0,1,0.01],
    ['dehaze','Dehaze',-1,1,0.01]
  ];
  App.ui.detailContent = function(){
    const el=document.createElement('div');
    const d=App.state.cur.detail;
    el.appendChild(group('Detail'));
    DETAIL_DEFS.forEach(([k,label,min,max,step])=>{
      el.appendChild(sliderRow({label,min,max,step,value:d[k],path:'detail.'+k}));
    });
    return el;
  };

  /* ================= CROP SHEET ================= */
  App.ui.cropContent = function(){
    const el=document.createElement('div');
    el.appendChild(group('Crop & Rotate'));
    el.appendChild(App.ui.ratioSelector());
    const btns=document.createElement('div'); btns.className='confirm-bar';
    btns.innerHTML = `<button class="btn-primary" id="crop-apply">Apply crop</button>
      <button class="btn-ghost danger" id="crop-reset">Reset</button>`;
    btns.querySelector('#crop-apply').addEventListener('click', ()=>App.onCropApply&&App.onCropApply());
    btns.querySelector('#crop-reset').addEventListener('click', ()=>App.onCropReset&&App.onCropReset());
    el.appendChild(btns);
    return el;
  };
  App.ui.ratioSelector = function(){
    const seg=document.createElement('div'); seg.className='segment';
    const ratios=[['free','Free'],['1:1','1:1'],['4:5','4:5'],['3:2','3:2'],['16:9','16:9'],['9:16','9:16']];
    App.cropRatio='free';
    ratios.forEach(([v,l])=>{
      const d=document.createElement('div'); d.className='seg'+(v==='free'?' active':''); d.dataset.ratio=v; d.textContent=l;
      d.addEventListener('click',()=>{ seg.querySelectorAll('.seg').forEach(x=>x.classList.remove('active')); d.classList.add('active'); if(App.onCropRatio) App.onCropRatio(v); });
      seg.appendChild(d);
    });
    return seg;
  };

  /* ================= RECIPE SHEET ================= */
  App.ui._recipeFilter = { category: 'all', q: '', sort: 'default' };
  App.ui.openRecipeSheet = function(){
    const layer=$$('#recipe-layer');
    const body=$$('#recipe-body');
    body.innerHTML='';
    const header=document.createElement('div'); header.className='recipe-header';
    header.innerHTML=`<div class="sheet-title"><span class="st-label">Recipes</span></div>`;
    body.appendChild(header);
    // search
    const search=document.createElement('div'); search.className='recipe-search';
    search.innerHTML=`<input id="r-search" type="search" placeholder="Search Fuji recipes…  e.g. Kodachrome, Portra, Bleach Bypass" autocomplete="off"/>
      <button class="icon-btn" id="r-clear" aria-label="Clear">${icon('close')}</button>`;
    search.querySelector('#r-search').addEventListener('input', e=>{
      App.ui._recipeFilter.q = e.target.value;
      App.ui.renderRecipeList();
    });
    search.querySelector('#r-clear').addEventListener('click', ()=>{
      search.querySelector('#r-search').value='';
      App.ui._recipeFilter.q='';
      App.ui.renderRecipeList();
    });
    body.appendChild(search);
    // category chips
    const chips=document.createElement('div'); chips.className='recipe-chips';
    const cats = ['all','favorites'].concat(
      global.FUJI.fujiRecipes.categories().filter(c=>c!=='all')
    );
    cats.forEach(c=>{
      const b=document.createElement('button');
      b.className='recipe-chip'+(App.ui._recipeFilter.category===c?' active':'');
      b.dataset.cat=c; b.textContent = c.charAt(0).toUpperCase()+c.slice(1);
      b.addEventListener('click',()=>{
        App.ui._recipeFilter.category=c;
        chips.querySelectorAll('.recipe-chip').forEach(x=>x.classList.toggle('active', x.dataset.cat===c));
        App.ui.renderRecipeList();
      });
      chips.appendChild(b);
    });
    body.appendChild(chips);
    // scene suggestion banner (if any scene tags detected on photo)
    if(App.context && App.context.scene && App.context.scene.length){
      const sug = global.FUJI.fujiRecipes.suggestFor(App.context.scene).slice(0,3);
      if(sug.length){
        const banner=document.createElement('div'); banner.className='recipe-suggest';
        const tags=App.context.scene.map(s=>`<span class="ctx-tag">${escapeHtml(s)}</span>`).join(' ');
        banner.innerHTML = `<div class="rs-head">Context: ${tags}</div>
          <div class="rs-sub">Recipes that match your scene</div>
          <div class="rs-row"></div>`;
        const row=banner.querySelector('.rs-row');
        sug.forEach(r=>{
          const c=document.createElement('button'); c.className='rs-pill';
          c.innerHTML=`<span class="rs-dot" style="background:${global.FUJI.getProfile(r.state.profileId).swatch}"></span><span>${escapeHtml(r.name)}</span>`;
          c.addEventListener('click',()=>{ App.onRecipeApply&&App.onRecipeApply(r.id); });
          row.appendChild(c);
        });
        body.appendChild(banner);
      }
    }
    // actions
    const acts=document.createElement('div'); acts.className='recipe-actions';
    acts.innerHTML=`
      <button class="recipe-action-btn" id="r-save" data-a="save">${icon('save')}<span>Save current</span></button>
      <button class="recipe-action-btn" id="r-export" data-a="export">${icon('share')}<span>Export</span></button>
      <button class="recipe-action-btn" id="r-import" data-a="import">${icon('check')}<span>Import</span></button>
      <button class="recipe-action-btn" id="r-url" data-a="url">${icon('share')}<span>From URL</span></button>`;
    acts.querySelector('#r-save').addEventListener('click', ()=>App.onRecipeSave&&App.onRecipeSave());
    acts.querySelector('#r-export').addEventListener('click', ()=>App.onRecipeExport&&App.onRecipeExport());
    acts.querySelector('#r-import').addEventListener('click', ()=>App.onRecipeImport&&App.onRecipeImport());
    acts.querySelector('#r-url').addEventListener('click', ()=>App.ui.importFromURL&&App.ui.importFromURL());
    body.appendChild(acts);
    body.appendChild(App.ui.recipeListEl());
    App.ui.showSheet($$('#recipe-layer'), $$('#recipe-sheet'));
  };
  App.ui.recipeListEl = function(){
    const list=document.createElement('div'); list.className='recipe-list';
    const f = App.ui._recipeFilter;
    let recs = global.FUJI.recipes.allRecipes();
    // apply filters
    recs = recs.filter(r => {
      if(f.category === 'favorites' && !(r.builtin ? global.FUJI.recipes.isFav(r.id) : !!r.favorite)) return false;
      if(r.builtin){
        if(f.category !== 'all' && f.category !== 'favorites' && (r.fuji?.category||'general') !== f.category) return false;
        if(f.q){
          const q=f.q.toLowerCase();
          const blob = [
            r.name, r.fuji?.source, r.fuji?.author, r.fuji?.tagline,
            r.fuji?.filmSim, r.fuji?.camera, r.fuji?.category,
            (r.fuji?.scene||[]).join(' ')
          ].join(' ').toLowerCase();
          if(blob.indexOf(q)<0) return false;
        }
      }
      return true;
    });
    if(!recs.length){
      const e=document.createElement('div'); e.className='group-label'; e.style.padding='24px 0'; e.style.textAlign='center';
      e.textContent='No recipes match.';
      list.appendChild(e); return list;
    }
    recs.forEach(r=>{
      const card=document.createElement('div'); card.className='recipe-card'+(r.builtin?' builtin':'');
      const prof=global.FUJI.getProfile(r.preset.profileId);
      const cat = r.builtin ? (r.fuji?.category||'general') : null;
      const sub = r.builtin
        ? `<span class="fuji-tag">FUJI</span> ${r.fuji?r.fuji.filmSim:'Recipe'}${r.fuji&&r.fuji.source?' · '+escapeHtml(r.fuji.source):''}${cat?' · '+cat:''}`
        : (prof?prof.name:'Custom')+' · '+Math.round(r.intensity*100)+'%';
      const isFav = r.builtin ? global.FUJI.recipes.isFav(r.id) : !!r.favorite;
      card.innerHTML=`
        <div class="rc-thumb" style="background:${prof?prof.swatch:'#333'}"></div>
        <div class="rc-info"><div class="rc-name">${escapeHtml(r.name)}</div>
          <div class="rc-sub">${sub}</div></div>
        <button class="rc-fav ${isFav?'active':''}" title="Favorite">${isFav?'♥':'♡'}</button>
        <button class="rc-apply" title="Apply">${icon('check')}</button>`;
      card.querySelector('.rc-fav').addEventListener('click', (e)=>{
        e.stopPropagation();
        if(r.builtin) global.FUJI.recipes.toggleFav(r.id);
        else global.FUJI.recipes.toggleFavorite(r.id);
        App.state&&App.state.emitRecipes(); if(App.ui.renderRecipeList)App.ui.renderRecipeList();
      });
      card.querySelector('.rc-apply').addEventListener('click', (e)=>{ e.stopPropagation(); App.onRecipeApply&&App.onRecipeApply(r.id); });
      card.addEventListener('click', ()=> App.ui.showRecipeDetail && App.ui.showRecipeDetail(r));
      card.addEventListener('contextmenu',(e)=>{ e.preventDefault(); App.ui.recipeMenu(r.id); });
      card.addEventListener('touchstart',()=>{ App._longPress=setTimeout(()=>{ App.ui.recipeMenu(r.id); App._longPress=null; }, 500); });
      card.addEventListener('touchend',()=>{ if(App._longPress){clearTimeout(App._longPress); App._longPress=null;} });
      list.appendChild(card);
    });
    return list;
  };
  App.ui.renderRecipeList = function(){
    if(!$$('#recipe-body') || !$$('#recipe-body .recipe-list')) return;
    const old=$$('#recipe-body .recipe-list');
    if(old) old.replaceWith(App.ui.recipeListEl());
  };

  /* ---------- Recipe detail sheet (FUJI recipes only) ---------- */
  App.ui.showRecipeDetail = function(r){
    const layer=$$('#recipe-detail-layer');
    if(!layer) return;
    const body=$$('#recipe-detail-body');
    body.innerHTML='';
    const prof=global.FUJI.getProfile(r.preset.profileId);
    const close=document.createElement('div'); close.className='sheet-title';
    close.innerHTML=`<span class="st-label">${escapeHtml(r.name)}</span><button class="icon-btn" id="rd-close">${icon('close')}</button>`;
    close.querySelector('#rd-close').addEventListener('click', ()=>{ layer.classList.add('closing'); setTimeout(()=>{ layer.classList.add('hidden'); layer.classList.remove('closing'); },280); });
    body.appendChild(close);
    // swatch + meta
    const head=document.createElement('div'); head.className='rd-head';
    head.innerHTML=`<div class="rd-swatch" style="background:${prof?prof.swatch:'#333'}"></div>
      <div class="rd-meta">
        <div class="rd-tagline">${escapeHtml(r.tagline||r.fuji?.tagline||'')}</div>
        <div class="rd-sub">${escapeHtml(r.fuji?.source||'')}${r.fuji?.author?' · '+escapeHtml(r.fuji.author):''}</div>
        <div class="rd-sub">${escapeHtml(r.fuji?.filmSim||'')} · ${escapeHtml(r.fuji?.camera||'')}</div>
      </div>`;
    body.appendChild(head);
    // detail rows (mapped from the actual app state)
    const s = r.state || (r.preset);
    const rows=[];
    rows.push(['Profile', (prof?prof.name:r.preset.profileId)]);
    rows.push(['Film sim', (r.fuji?.simulation||'')]);
    if(s.light){
      const L=s.light;
      if(L.exposure) rows.push(['Exposure', fmtVal(L.exposure,'pct')]);
      if(L.highlights) rows.push(['Highlights', fmtVal(L.highlights,'pct')]);
      if(L.shadows) rows.push(['Shadows', fmtVal(L.shadows,'pct')]);
      if(L.contrast) rows.push(['Contrast', fmtVal(L.contrast,'pct')]);
    }
    if(s.color){
      const C=s.color;
      if(C.temperature) rows.push(['Temperature', fmtVal(C.temperature,'pct')]);
      if(C.tint) rows.push(['Tint', fmtVal(C.tint,'pct')]);
      if(C.vibrance) rows.push(['Vibrance', fmtVal(C.vibrance,'pct')]);
      if(C.saturation) rows.push(['Saturation', fmtVal(C.saturation,'pct')]);
    }
    if(s.detail){
      const D=s.detail;
      if(D.clarity) rows.push(['Clarity', fmtVal(D.clarity,'pct')]);
      if(D.sharp) rows.push(['Sharpening', fmtVal(D.sharp,'pct')]);
    }
    if(s.film){
      const F=s.film;
      if(F.grain) rows.push(['Grain', fmtVal(F.grain,'pct')]);
      if(F.halation) rows.push(['Halation', fmtVal(F.halation,'pct')]);
      if(F.bloom) rows.push(['Bloom', fmtVal(F.bloom,'pct')]);
    }
    if(s.vignette) rows.push(['Vignette', fmtVal(s.vignette,'pct')]);
    if(r.fuji?.scene && r.fuji.scene.length) rows.push(['Scene', r.fuji.scene.map(escapeHtml).join(', ')]);
    const tab=document.createElement('div'); tab.className='rd-table';
    rows.forEach(([k,v])=>{
      const r1=document.createElement('div'); r1.className='rd-row';
      r1.innerHTML=`<span class="rd-k">${escapeHtml(k)}</span><span class="rd-v">${escapeHtml(String(v))}</span>`;
      tab.appendChild(r1);
    });
    body.appendChild(tab);
    // actions
    const bar=document.createElement('div'); bar.className='confirm-bar';
    bar.innerHTML=`<button class="btn-primary" id="rd-apply">Apply</button>
      <button class="btn-ghost" id="rd-share">${icon('share')}<span>Share link</span></button>
      <button class="btn-ghost" id="rd-export">${icon('check')}<span>Export</span></button>`;
    bar.querySelector('#rd-apply').addEventListener('click', ()=>{ App.onRecipeApply&&App.onRecipeApply(r.id); layer.classList.add('closing'); setTimeout(()=>{ layer.classList.add('hidden'); layer.classList.remove('closing'); },280); });
    bar.querySelector('#rd-export').addEventListener('click', ()=>{
      const data = r.builtin && r.fuji ? r.fuji : r.preset;
      App.downloadJSON(JSON.stringify(data,null,2), r.name.replace(/\W+/g,'_')+'.fuji.json');
    });
    bar.querySelector('#rd-share').addEventListener('click', async ()=>{
      try{
        const payload = r.builtin && r.fuji ? r.fuji : r.preset;
        const url = '#recipe=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
        const link = location.origin + location.pathname + url;
        if(navigator.share){ await navigator.share({ title:r.name, text:'F-UJI Recipe', url:link }); }
        else { await navigator.clipboard.writeText(link); App.toast('Link copied'); }
      }catch(e){ App.toast('Share failed'); }
    });
    body.appendChild(bar);
    layer.classList.remove('hidden');
    layer.querySelector('.sheet-backdrop') && layer.querySelector('.sheet-backdrop').addEventListener('click', ()=>{ layer.classList.add('closing'); setTimeout(()=>{ layer.classList.add('hidden'); layer.classList.remove('closing'); },280); }, { once:true });
  };

  /* ---------- Import from URL (share link) ---------- */
  App.ui.importFromURL = function(){
    const v = prompt('Paste a F-UJI recipe link or JSON:', location.hash.startsWith('#recipe=') ? decodeURIComponent(location.hash.slice(8)) : '');
    if(!v) return;
    let txt = v;
    if(v.startsWith('http') || v.startsWith('#recipe=')){
      const hash = v.indexOf('#recipe=');
      const enc = hash>=0 ? v.slice(hash+8) : v.split('#recipe=').pop();
      try{ txt = decodeURIComponent(escape(atob(enc))); }
      catch(e){ App.toast('Could not decode link'); return; }
    }
    try{
      const n = FUJI.recipes.importJSON(txt);
      App.ui.renderRecipeList(); App.toast('Imported ' + n);
    }catch(e){ App.toast('Invalid recipe'); }
  };
  App.ui.recipeMenu = function(id){
    const r=global.FUJI.recipes.allRecipes().find(x=>x.id===id);
    if(!r) return;
    if(r.builtin){
      const action = prompt("Recipe: "+r.name+(r.fuji&&r.fuji.source?"  ("+r.fuji.source+")":"")+"\n\nBuilt-in Fujifilm Recipe\n\nOptions:\n1 = Apply\n6 = Export JSON");
      const a=parseInt(action,10);
      if(a===6){ if(r.fuji) App.downloadJSON(JSON.stringify(r.fuji,null,2), r.name.replace(/\W+/g,'_')+'.fuji.json'); }
      else if(a===1||action===null||action===''){ App.onRecipeApply&&App.onRecipeApply(id); }
      return;
    }
    const action = prompt("Recipe: "+r.name+"\n\nOptions:\n1 = Apply\n2 = Duplicate\n3 = Rename\n4 = Delete\n5 = Favorite\n6 = Export JSON");
    const a=parseInt(action,10);
    if(a===2) global.FUJI.recipes.duplicateRecipe(id);
    else if(a===3){ const n=prompt("New name",r.name); if(n) global.FUJI.recipes.renameRecipe(id,n); }
    else if(a===4){ if(confirm("Delete recipe "+r.name+"?")) global.FUJI.recipes.deleteRecipe(id); }
    else if(a===5) global.FUJI.recipes.toggleFavorite(id);
    else if(a===6){ App.downloadJSON(global.FUJI.recipes.exportJSON([id]), r.name.replace(/\W+/g,'_')+'.fuji.json'); }
    else if(a===1||action===null||action===''){ App.onRecipeApply&&App.onRecipeApply(id); }
    global.FUJI.recipes.save();
    if(App.state) App.state.emitRecipes();
    App.ui.renderRecipeList();
  };

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  /* ================= BEFORE / AFTER ================= */
  App.ui.baMode = 'off';
  App.ui.buildCompareBar = function(){
    const bar=$$('#ba-mode');
    bar.innerHTML='';
    const oc=$$('#orig-canvas');
    if(oc) oc.style.opacity='0';
    const modes=[['off','Edit'],['split','Split'],['swipe','Swipe']];
    modes.forEach(([m,l])=>{
      const b=document.createElement('button'); b.className='ba-btn'+(m==='off'?' active':''); b.dataset.mode=m; b.textContent=l;
      b.addEventListener('click',()=>{ App.ui.setCompareMode(m); });
      bar.appendChild(b);
    });
    bar.classList.remove('hidden');
  };
  App.ui.setCompareMode = function(m){
    App.ui.baMode=m;
    document.querySelectorAll('#ba-mode .ba-btn').forEach(x=>x.classList.toggle('active', x.dataset.mode===m));
    const handle=$$('#split-handle');
    const oc=$$('#orig-canvas');
    const sc=$$('#view-canvas');
    if(m==='off'){ handle.classList.add('hidden'); oc.style.opacity='0'; oc.style.clipPath='none'; sc.style.opacity='1'; }
    else if(m==='split'){ handle.classList.remove('hidden'); oc.style.opacity='1'; oc.style.clipPath=`inset(0 0 0 ${App.ui.splitX}%)`; }
    else if(m==='swipe'){ handle.classList.remove('hidden'); oc.style.opacity='1'; oc.style.clipPath=`inset(0 ${100-App.ui.splitX}% 0 0)`; }
  };
  App.ui.updateSplit = function(x){
    x=Math.max(0,Math.min(100,x));
    App.ui.splitX=x;
    const handle=$$('#split-handle');
    handle.style.left=x+'%';
    if(App.ui.baMode==='split') $$('#orig-canvas').style.clipPath=`inset(0 0 0 ${x}%)`;
    else if(App.ui.baMode==='swipe') $$('#orig-canvas').style.clipPath=`inset(0 ${100-x}% 0 0)`;
  };

  /* ================= EXPORT SHEET ================= */
  App.ui.openExport = function(){
    const layer=$$('#export-layer'); const body=$$('#export-body');
    body.innerHTML='';
    const h=document.createElement('div'); h.className='sheet-title';
    h.innerHTML='<span class="st-label">Export</span><button class="icon-btn" id="ex-close"></button>';
    h.querySelector('#ex-close').innerHTML=icon('close');
    h.querySelector('#ex-close').addEventListener('click',()=>{ layer.classList.add('closing'); setTimeout(()=>{layer.classList.add('hidden');layer.classList.remove('closing');},320); });
    body.appendChild(h);
    // preview
    App.exportPreview=document.createElement('div'); App.exportPreview.className='export-preview hidden';
    body.appendChild(App.exportPreview);
    // format
    body.appendChild(App.ui.exportOptions());
    const bar=document.createElement('div'); bar.className='confirm-bar';
    bar.innerHTML='<button class="btn-primary" id="ex-go">Save & Share</button>';
    bar.querySelector('#ex-go').addEventListener('click',()=>App.onExportGo&&App.onExportGo());
    body.appendChild(bar);
    App.ui.showSheet($$('#export-layer'), $$('#export-sheet'));
    if(App.onExportOpen) App.onExportOpen();
  };
  App.ui.exportOptions = function(){
    const el=document.createElement('div');
    el.innerHTML=`
      <div class="export-opt"><span class="eo-label">Format</span></div>
      <div class="grid-2">
        <div class="chip-btn active" data-fmt="jpeg">JPEG</div>
        <div class="chip-btn" data-fmt="png">PNG</div>
      </div>
      <div class="export-opt"><span class="eo-label">Quality</span></div>
      <div class="grid-2" id="q-grid">
        <div class="chip-btn" data-q="0.7">Standard</div>
        <div class="chip-btn active" data-q="0.9">High</div>
        <div class="chip-btn" data-q="1">Max</div>
      </div>`;
    App.exportFmt='jpeg'; App.exportQuality=0.9;
    el.querySelectorAll('[data-fmt]').forEach(c=>c.addEventListener('click',()=>{
      el.querySelectorAll('[data-fmt]').forEach(x=>x.classList.remove('active')); c.classList.add('active');
      App.exportFmt=c.dataset.fmt; if(App.onExportOpen)App.onExportOpen();
    }));
    el.querySelectorAll('[data-q]').forEach(c=>c.addEventListener('click',()=>{
      el.querySelectorAll('#q-grid .chip-btn').forEach(x=>x.classList.remove('active')); c.classList.add('active');
      App.exportQuality=parseFloat(c.dataset.q);
    }));
    return el;
  };

  /* ================= TOAST ================= */
  App.toast = function(msg){
    const t=$$('#toast'); t.textContent=msg; t.classList.add('show');
    clearTimeout(App._toastT); App._toastT=setTimeout(()=>t.classList.remove('show'),2200);
  };

  /* ================= SPINNER ================= */
  App.showSpinner=function(){ $$('#spinner').classList.remove('hidden'); };
  App.hideSpinner=function(){ $$('#spinner').classList.add('hidden'); };

  global.FUJI.ui=App.ui;
  global.App=App;
})(typeof window!=="undefined"?window:globalThis);
