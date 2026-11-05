"use strict";
/* Kalorie — standalone calorie tracker. All data stays on this device (IndexedDB). */

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const r0=n=>Math.round(+n||0), r1=n=>Math.round((+n||0)*10)/10;
const num=v=>{const n=parseFloat(String(v==null?"":v).replace(",","."));return isFinite(n)?n:0};
const clone=o=>JSON.parse(JSON.stringify(o));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const MEALS=[["breakfast","Breakfast"],["brunch","2nd breakfast"],["lunch","Lunch"],["snack","Snack"],["dinner","Dinner"]];
const MEAL_STYLE={breakfast:["🌅","#4fae9b"],brunch:["🥪","#3a9a72"],lunch:["🍲","#1f8a5b"],snack:["🍎","#1f8f80"],dinner:["🌙","#2d6a4f"]};
const mealName=k=>(MEALS.find(m=>m[0]===k)||[k,k])[1];
function fmtDate(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function addDays(s,n){const[y,m,d]=s.split("-").map(Number);return fmtDate(new Date(y,m-1,d+n))}
const today=()=>fmtDate(new Date());
function dayLabel(s){const t=today();if(s===t)return"Today";if(s===addDays(t,-1))return"Yesterday";if(s===addDays(t,1))return"Tomorrow";
  const[y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d).toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})}
function defaultMeal(){const h=new Date().getHours();return h<10?"breakfast":h<12?"brunch":h<15?"lunch":h<18?"snack":"dinner"}
let toastT;function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("on");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("on"),2800)}
function normCode(c){c=String(c||"").replace(/\D/g,"");if(c.length===12)c="0"+c;return c}
function macrosFor(p,amt){const k=amt/100;return{kcal:r0(p.kcal*k),p:r1(p.p*k),f:r1(p.f*k),c:r1(p.c*k)}}
const IOS=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/ł/g,"l");

/* ---------- storage: IndexedDB key-value, localStorage fallback ---------- */
const kv=(()=>{
  let dbp=null;
  function open(){if(!dbp)dbp=new Promise((res,rej)=>{try{const r=indexedDB.open("kalorie",1);r.onupgradeneeded=()=>r.result.createObjectStore("kv");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}catch(e){rej(e)}});return dbp}
  function tx(mode,fn){return open().then(db=>new Promise((res,rej)=>{const t=db.transaction("kv",mode),req=fn(t.objectStore("kv"));t.oncomplete=()=>res(req&&req.result);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)}))}
  const ls={get:async k=>{const v=localStorage.getItem("kal:"+k);return v?JSON.parse(v):undefined},set:async(k,v)=>localStorage.setItem("kal:"+k,JSON.stringify(v)),
    del:async k=>localStorage.removeItem("kal:"+k),keys:async()=>Object.keys(localStorage).filter(k=>k.startsWith("kal:")).map(k=>k.slice(4))};
  let useLS=false;
  const wrap=name=>async(...a)=>{if(!useLS){try{return await ({get:k=>tx("readonly",s=>s.get(k)),set:(k,v)=>tx("readwrite",s=>s.put(v,k)),del:k=>tx("readwrite",s=>s.delete(k)),keys:()=>tx("readonly",s=>s.getAllKeys())})[name](...a)}catch(e){console.warn("IndexedDB failed, using localStorage",e);useLS=true}}return ls[name](...a)};
  return{get:wrap("get"),set:wrap("set"),del:wrap("del"),keys:wrap("keys")};
})();
const qs={};
function queued(key,fn){const p=(qs[key]||Promise.resolve()).then(fn).catch(e=>{console.error(e);toast("Couldn't save on this device")});qs[key]=p;return p}
const store={
  profile:async()=>(await kv.get("profile"))||null,
  saveProfile:p=>queued("profile",()=>kv.set("profile",clone(p))),
  products:async()=>(await kv.get("products"))||{},
  saveProducts:()=>{const v=clone(S.products);return queued("products",()=>kv.set("products",v))},
  day:async d=>(await kv.get("day:"+d))||{date:d,entries:[]},
  saveDay:(d,v)=>{v=clone(v);return queued("day:"+d,()=>kv.set("day:"+d,v))},
  async days(from,to){const keys=(await kv.keys()).filter(k=>k.startsWith("day:")&&k.slice(4)>=from&&k.slice(4)<=to);const o={};for(const k of keys)o[k.slice(4)]=await kv.get(k);return o},
  weights:async()=>(await kv.get("weights"))||{list:[]},
  saveWeights:w=>{w=clone(w);return queued("weights",()=>kv.set("weights",w))},
  settings:async()=>(await kv.get("settings"))||{},
  saveSettings:s=>{s=clone(s);return queued("settings",()=>kv.set("settings",s))}
};

/* ---------- state ---------- */
const S={date:today(),day:{date:today(),entries:[]},products:{},profile:null,weights:{list:[]},settings:{}};
const DEF_PROFILE={goal:2000,pp:25,pf:30,pc:45};
const prof=()=>Object.assign({},DEF_PROFILE,S.profile||{});
const aiOn=()=>!!(S.settings.relayUrl||"").trim();   // AI runs on your Cloudflare relay
function macroGoals(){const p=prof();return{p:r0(p.goal*p.pp/400),f:r0(p.goal*p.pf/900),c:r0(p.goal*p.pc/400)}}
function saveProduct(p){S.products[p.id]=p;store.saveProducts()}

/* basic foods → product objects (not stored unless used) */
const BASICS=(window.BASIC_FOODS||[]).map((b,i)=>({id:"b-"+i,name:b[0],kcal:b[1],p:b[2],f:b[3],c:b[4],unit:/per 100 ml/.test(b[0])?"ml":"g",source:"basic"}));
const getProduct=id=>S.products[id]||BASICS.find(b=>b.id===id);

/* ---------- diary ---------- */
function totals(entries){return entries.reduce((a,e)=>({kcal:a.kcal+(+e.kcal||0),p:a.p+(+e.p||0),f:a.f+(+e.f||0),c:a.c+(+e.c||0)}),{kcal:0,p:0,f:0,c:0})}
function renderDiary(){
  $("#sync").textContent=S.profile?"Saved on this phone":"Set your goal in Goals";
  $("#dayLbl").textContent=dayLabel(S.date);
  const t=totals(S.day.entries),g=prof().goal,mg=macroGoals(),left=g-t.kcal;
  $("#kLeft").textContent=Math.abs(r0(left)).toLocaleString("en-GB");
  $("#kLeftLbl").textContent=left>=0?"kcal left":"kcal over";
  $("#kLeft").style.color=left<0?"var(--warn)":"";
  $("#kEaten").textContent=r0(t.kcal).toLocaleString("en-GB");
  $("#kGoal").textContent=r0(g).toLocaleString("en-GB");
  const C=2*Math.PI*54,frac=Math.min(1,t.kcal/(g||1)),arc=$("#ringArc");
  arc.setAttribute("stroke-dasharray",(C*frac)+" "+C);arc.style.opacity=frac>0?1:0;arc.setAttribute("stroke",left<0?"var(--warn)":"var(--acc)");
  $("#macroStats").innerHTML=[["Protein","p","--p"],["Fat","f","--f"],["Carbs","c","--c"]].map(([n,k,col])=>
    `<div class="stat"><div class="row"><span>${n}</span><span><b>${r0(t[k])}</b> / ${mg[k]} g</span></div><div class="bar"><i style="width:${Math.min(100,t[k]/(mg[k]||1)*100)}%;background:var(${col})"></i></div></div>`).join("");
  $("#meals").innerHTML=MEALS.map(([k,n])=>{
    const es=S.day.entries.filter(e=>e.meal===k),mk=totals(es).kcal,[ic,col]=MEAL_STYLE[k]||["🍽️","#1f8a5b"];
    return `<div class="card meal${es.length?"":" empty"}" style="--mc:${col}"><div class="mh"><div class="mt"><span class="mi">${ic}</span><h3>${n}</h3></div>
      <div class="mr">${mk?`<span class="mk">${r0(mk)} kcal</span>`:""}<button class="plus" data-add="${k}" aria-label="Add to ${n}">+</button></div></div>
      ${es.length?`<div class="mbody">${es.map(e=>`<button class="entry" data-entry="${e.id}"><div style="min-width:0"><div class="n">${esc(e.name)}${e.est?'<span class="est">estimate</span>':""}</div>
      <div class="s">${e.amount?r0(e.amount)+" "+(e.unit||"g")+" · ":""}P ${r0(e.p)} · F ${r0(e.f)} · C ${r0(e.c)}</div></div><div class="kc">${r0(e.kcal)} kcal</div></button>`).join("")}</div>`:""}</div>`}).join("");
}
async function loadDay(d){S.date=d;S.day={date:d,entries:[]};renderDiary();try{const v=await store.day(d);if(S.date===d){S.day=Object.assign({date:d,entries:[]},v);renderDiary()}}catch(e){toast("Couldn't load this day")}}
const saveDay=()=>store.saveDay(S.date,Object.assign({},S.day,{date:S.date}));
$("#prevDay").onclick=()=>loadDay(addDays(S.date,-1));
$("#nextDay").onclick=()=>loadDay(addDays(S.date,1));
$("#meals").addEventListener("click",e=>{const a=e.target.closest("[data-add]");if(a)return openAddSheet(a.dataset.add);const en=e.target.closest("[data-entry]");if(en)openEntrySheet(en.dataset.entry)});

/* ---------- sheet ---------- */
let onSheetClose=null;
function openSheet(html){stopMic();$("#sheet").classList.remove("full");if(onSheetClose){const f=onSheetClose;onSheetClose=null;f()}$("#sheetBody").innerHTML=html;$("#sheet").classList.add("on");$("#scrim").classList.add("on");$("#sheet").scrollTop=0}
function closeSheet(){stopMic();$("#sheet").classList.remove("full");if(aiCtl)aiCtl.abort();if(onSheetClose){const f=onSheetClose;onSheetClose=null;f()}$("#sheet").classList.remove("on");$("#scrim").classList.remove("on")}
$("#scrim").onclick=closeSheet;$("#sheetX").onclick=closeSheet;
window.addEventListener("popstate",()=>{if($("#sheet").classList.contains("on"))closeSheet()});
const loadingHTML=(m,sub)=>`<h3>${esc(m)}</h3><div class="spin"></div>${sub?`<div class="small muted" style="text-align:center">${esc(sub)}</div>`:""}`;

/* ---------- product rows / search ---------- */
function productsSorted(){return Object.values(S.products).sort((a,b)=>(b.lastUsed||0)-(a.lastUsed||0))}
const SRC_LABEL={off:"Open Food Facts",basic:"typical values",web:"web lookup",estimate:"estimate","label-ai":"from label",manual:"",catalog:""};
function prodRow(p){const s=SRC_LABEL[p.source]||"";return `<button class="it" data-pid="${esc(p.id)}"><div style="min-width:0"><div>${esc(p.name)}</div><div class="small muted">${esc(p.brand||"")}${p.brand?" · ":""}${r0(p.kcal)} kcal / 100 ${p.unit||"g"}${s?` <span class="est">${s}</span>`:""}</div></div><div class="muted">›</div></button>`}
function localSearch(q){
  const words=norm(q).split(/\s+/).filter(Boolean);
  const hit=p=>{const h=norm(p.name+" "+(p.brand||"")+" "+(p.barcode||""));return words.every(w=>h.includes(w))};
  const mine=productsSorted().filter(hit);
  const basics=BASICS.filter(b=>!S.products[b.id]&&hit(b));
  return{mine,basics};
}

/* ---------- add food sheet ---------- */
function openAddSheet(meal){
  openSheet(`<h3>Add to ${esc(mealName(meal))}</h3>
    <div class="searchbar"><input type="search" id="addSearch" placeholder="Search foods — skyr, banan, Fat Peppa…" autocomplete="off"><button class="btn ghost hidden" id="addDone" style="margin-top:0;flex:0 0 auto;padding:11px 14px">Done</button></div>
    <div id="addActions">
      <div class="row2">
        <button class="btn" id="addScan" style="margin-top:8px">Scan barcode</button>
        <button class="btn sec" id="addQuick" style="margin-top:8px">🎤 Say / describe</button>
      </div>
      <div class="row2">
        <button class="btn ghost" id="addPhoto" style="margin-top:8px">📷 Photo estimate</button>
        <button class="btn ghost" id="addMan" style="margin-top:8px">Enter kcal</button>
      </div>
    </div>
    <div id="addList"></div>`);
  $("#addScan").onclick=()=>openScanner(meal);
  $("#addQuick").onclick=()=>{openQuickSheet(meal,"text");const b=$("#sheetBody [data-mic=qTxt]");if(b&&aiOn())b.click()};
  $("#addPhoto").onclick=()=>openQuickSheet(meal,"photo");
  $("#addMan").onclick=()=>openQuickSheet(meal,"man");
  const s=$("#addSearch"),list=$("#addList"),sheet=$("#sheet");
  // while searching: hide the big buttons and give the sheet the whole screen, so results sit right under the box
  const setSearching=on=>{sheet.classList.toggle("full",on);$("#addActions").classList.toggle("hidden",on);$("#addDone").classList.toggle("hidden",!on);if(on)sheet.scrollTop=0};
  s.addEventListener("focus",()=>setSearching(true));
  s.addEventListener("blur",()=>setTimeout(()=>{if(!s.value.trim()&&document.activeElement!==s)setSearching(false)},150));
  $("#addDone").onclick=()=>{s.value="";s.blur();setSearching(false);draw()};
  const draw=()=>{
    const q=s.value.trim();
    if(!q){const rec=productsSorted().slice(0,25);list.innerHTML=rec.length?`<div class="secthead">Recent</div><div class="list">${rec.map(prodRow).join("")}</div>`:`<div class="note">Scan a barcode or search to add your first food. Everything you add is saved to My foods for next time.</div>`;return}
    const{mine,basics}=localSearch(q);
    list.innerHTML=(mine.length?`<div class="secthead">My foods</div><div class="list">${mine.slice(0,20).map(prodRow).join("")}</div>`:"")+
      (basics.length?`<div class="secthead">Basic foods</div><div class="list">${basics.slice(0,15).map(prodRow).join("")}</div>`:"")+
      `<div class="secthead">Not here?</div>
       <button class="btn ghost" id="offSearch">Search Open Food Facts for “${esc(q)}”</button>
       <button class="btn ghost" id="gSearch">${relayOn()?"🔎 Search the web":"Search Google &amp; paste the values"}</button>
       ${aiOn()?`<button class="btn ghost" id="webSearch">Look it up online with AI</button>`:""}
       <div id="onlineOut"></div>`;
    $("#offSearch").onclick=()=>offSearchUI(q,meal);
    $("#gSearch").onclick=()=>relayOn()?relayUI(q,meal):webSearchUI(q,meal);
    const w=$("#webSearch");if(w)w.onclick=()=>webLookupUI(q,meal);
  };
  s.oninput=draw;draw();
  list.onclick=e=>{const b=e.target.closest("[data-pid]");if(b&&b.dataset.pid){const p=getProduct(b.dataset.pid);if(p)openAmountSheet(p,meal)}};
}

/* ---------- amount sheet ---------- */
function openAmountSheet(p,meal,entry){
  const unit=p.unit||"g";
  const amt=entry?entry.amount:(p.lastAmount||(p.serving&&p.serving.size)||100);
  const m=entry?entry.meal:(meal||defaultMeal());
  const chips=[...(p.serving&&p.serving.size?[[p.serving.size,(p.serving.label||"1 serving")+" ("+r0(p.serving.size)+unit+")"]]:[]),[50,"50"+unit],[100,"100"+unit],[150,"150"+unit],[200,"200"+unit]];
  const s=SRC_LABEL[p.source];
  openSheet(`<h3>${esc(p.name)}</h3><div class="small muted">${esc(p.brand||"")}${p.barcode?" · "+esc(p.barcode):""}</div>
    <div class="small muted" style="margin-top:4px">Per 100 ${unit}: ${r0(p.kcal)} kcal · P ${r1(p.p)} · F ${r1(p.f)} · C ${r1(p.c)}${s?` <span class="est">${s}</span>`:""}</div>
    ${p.source==="off"&&!p.checked?`<div class="note small">From the Open Food Facts community database. Glance at the package once to confirm, then tap “Edit product values” → Save to mark it checked.</div>`:""}
    <label class="f">Amount (${unit}) — weigh it for exact numbers</label>
    <input type="number" id="amt" inputmode="decimal" value="${r1(amt)}">
    <div class="chips">${chips.map(([v,l])=>`<button class="chip" data-v="${v}">${esc(l)}</button>`).join("")}</div>
    <label class="f">Meal</label>
    <select id="amtMeal">${MEALS.map(([k,n])=>`<option value="${k}"${k===m?" selected":""}>${n}</option>`).join("")}</select>
    <div class="preview" id="amtPrev"></div>
    <button class="btn" id="amtOk">${entry?"Save":"Add to diary"}</button>
    ${entry?`<button class="btn danger" id="amtDel">Remove from diary</button>`:""}
    <button class="btn ghost" id="amtEdit">Edit product values</button>`);
  const upd=()=>{const v=macrosFor(p,num($("#amt").value));$("#amtPrev").innerHTML=`<div><b>${v.kcal}</b><span>kcal</span></div><div><b>${r0(v.p)}</b><span>protein g</span></div><div><b>${r0(v.f)}</b><span>fat g</span></div><div><b>${r0(v.c)}</b><span>carbs g</span></div>`};
  upd();$("#amt").oninput=upd;
  $("#sheetBody .chips").onclick=e=>{const c=e.target.closest(".chip");if(c){$("#amt").value=c.dataset.v;upd()}};
  $("#amtOk").onclick=()=>{
    const a=num($("#amt").value);if(a<=0)return toast("Enter an amount");
    const v=macrosFor(p,a),mm=$("#amtMeal").value;
    const rec={id:entry?entry.id:uid(),meal:mm,pid:p.id,name:p.name,amount:a,unit,...v,est:p.source==="estimate"};
    if(entry){const i=S.day.entries.findIndex(x=>x.id===entry.id);if(i>=0)S.day.entries[i]=rec}else S.day.entries.push(rec);
    renderDiary();closeSheet();saveDay();toast(entry?"Saved":"Added "+v.kcal+" kcal");
    const np=Object.assign({},p,{lastUsed:Date.now(),lastAmount:a});saveProduct(np);
  };
  if(entry)$("#amtDel").onclick=()=>removeEntry(entry.id);
  $("#amtEdit").onclick=()=>openProductForm(p,m);
}
function removeEntry(id){S.day.entries=S.day.entries.filter(x=>x.id!==id);renderDiary();closeSheet();saveDay();toast("Removed")}
function openEntrySheet(id){
  const e=S.day.entries.find(x=>x.id===id);if(!e)return;
  const p=e.pid&&getProduct(e.pid);
  if(p&&e.amount)return openAmountSheet(p,e.meal,e);
  openSheet(`<h3>${esc(e.name)}</h3><div class="small muted">${esc(mealName(e.meal))}${e.est?" · estimate":""}</div>
    <div class="grid4" style="margin-top:6px">
      <div><label class="f">kcal</label><input type="number" id="eK" value="${r0(e.kcal)}"></div>
      <div><label class="f">Protein</label><input type="number" id="eP" value="${r1(e.p)}"></div>
      <div><label class="f">Fat</label><input type="number" id="eF" value="${r1(e.f)}"></div>
      <div><label class="f">Carbs</label><input type="number" id="eC" value="${r1(e.c)}"></div>
    </div>
    <button class="btn" id="eSave">Save</button><button class="btn danger" id="eDel">Remove from diary</button>`);
  $("#eSave").onclick=()=>{Object.assign(e,{kcal:num($("#eK").value),p:num($("#eP").value),f:num($("#eF").value),c:num($("#eC").value)});renderDiary();closeSheet();saveDay()};
  $("#eDel").onclick=()=>removeEntry(e.id);
}

/* ---------- product form ---------- */
function openProductForm(p,meal){
  const isNew=!p||!S.products[p.id];p=p||{};
  const off=p.barcode?`https://world.openfoodfacts.org/product/${encodeURIComponent(p.barcode)}`:"";
  openSheet(`<h3>${isNew?"New product":"Edit product"}</h3>
    ${p.barcode?`<div class="small muted">Barcode ${esc(p.barcode)}${isNew&&!p.name&&!p._parsed?" — not found in Open Food Facts":""}</div>`:""}
    ${aiOn()?`<label class="btn sec filebtn">📷 Read values from a label photo<input type="file" accept="image/*" capture="environment" id="lblFile"></label>
      <div class="small muted" style="margin-top:6px">The AI reads the per-100 g column and fills the form. Check before saving.</div>`:
      `<div class="note small">Type the values from the nutrition table (per 100 g).${isNew?" Set up the AI helper in Goals to read labels from a photo.":""}</div>`}
    <div id="lblStatus"></div>
    <label class="f">Name</label><input type="text" id="pN" value="${esc(p.name||"")}" placeholder="e.g. Skyr natural">
    <div class="grid2">
      <div><label class="f">Brand</label><input type="text" id="pB" value="${esc(p.brand||"")}"></div>
      <div><label class="f">Unit</label><select id="pU"><option value="g">per 100 g</option><option value="ml"${p.unit==="ml"?" selected":""}>per 100 ml</option></select></div>
    </div>
    <div class="grid4">
      <div><label class="f">kcal</label><input type="number" id="pK" inputmode="decimal" value="${p.kcal!=null?r1(p.kcal):""}"></div>
      <div><label class="f">Protein</label><input type="number" id="pP" inputmode="decimal" value="${p.p!=null?r1(p.p):""}"></div>
      <div><label class="f">Fat</label><input type="number" id="pF" inputmode="decimal" value="${p.f!=null?r1(p.f):""}"></div>
      <div><label class="f">Carbs</label><input type="number" id="pC" inputmode="decimal" value="${p.c!=null?r1(p.c):""}"></div>
    </div>
    <div class="grid2">
      <div><label class="f">Serving size (optional)</label><input type="number" id="pS" inputmode="decimal" value="${p.serving&&p.serving.size?r1(p.serving.size):""}"></div>
      <div><label class="f">Serving name</label><input type="text" id="pSL" value="${esc(p.serving&&p.serving.label||"")}" placeholder="1 bar"></div>
    </div>
    <button class="btn" id="pSave">Save product</button>
    ${!isNew?`<button class="btn danger" id="pDel">Delete product</button>`:""}
    ${off?`<div class="small" style="margin-top:12px;text-align:center"><a href="${off}" target="_blank" rel="noopener">Open on Open Food Facts ↗</a></div>`:""}`);
  const lf=$("#lblFile");if(lf)lf.onchange=ev=>{const f=ev.target.files[0];ev.target.value="";if(f)readLabel(f,p)};
  $("#pSave").onclick=()=>{
    const name=$("#pN").value.trim();if(!name)return toast("Give it a name");
    if($("#pK").value==="")return toast("Enter kcal per 100");
    const ss=num($("#pS").value);
    const keepSrc=p.source&&p.source!=="basic"?p.source:"manual";
    const np=Object.assign({},p,{id:p.id||(p.barcode||"c-"+uid()),barcode:p.barcode||null,name,brand:$("#pB").value.trim(),unit:$("#pU").value,
      kcal:num($("#pK").value),p:num($("#pP").value),f:num($("#pF").value),c:num($("#pC").value),
      serving:ss>0?{size:ss,label:$("#pSL").value.trim()}:null,source:p._ai?"label-ai":keepSrc,checked:true,updated:Date.now()});
    delete np._ai;delete np._parsed;delete np.needsLoad;
    saveProduct(np);renderFoods();toast("Product saved");
    if(meal!==false)openAmountSheet(np,meal);else closeSheet();
  };
  const del=$("#pDel");if(del)del.onclick=()=>{
    if(del.dataset.sure!=="1"){del.dataset.sure="1";del.textContent="Tap again to delete";return}
    delete S.products[p.id];store.saveProducts();renderFoods();closeSheet();toast("Deleted");
  };
}

/* ---------- images ---------- */
function loadImage(file){return new Promise((res,rej)=>{const u=URL.createObjectURL(file);const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=u})}
function drawScaled(img,max,rot){
  const iw=img.naturalWidth||img.videoWidth||img.width,ih=img.naturalHeight||img.videoHeight||img.height;
  const s=Math.min(1,max/Math.max(iw,ih)),w=Math.round(iw*s),h=Math.round(ih*s);
  const c=document.createElement("canvas"),sw=rot%180?h:w,sh=rot%180?w:h;c.width=sw;c.height=sh;
  const x=c.getContext("2d",{willReadFrequently:true});x.translate(sw/2,sh/2);x.rotate(rot*Math.PI/180);x.drawImage(img,-w/2,-h/2,w,h);return c;
}
function toJpeg(img,max){return new Promise(r=>drawScaled(img,max,0).toBlob(b=>r(b),"image/jpeg",0.85))}
function blobToB64(b){return new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(String(fr.result).split(",")[1]);fr.onerror=rej;fr.readAsDataURL(b)})}

/* ---------- barcode: live camera ---------- */
const FORMATS=["ean_13","ean_8","upc_a","upc_e"];
/* barcode reading: Chrome's built-in BarcodeDetector first, then the bundled reader (ean.js) */
async function decodeImage(img){
  if("BarcodeDetector" in window){try{const bd=new BarcodeDetector({formats:FORMATS});for(const max of [1600,900]){const r=await bd.detect(drawScaled(img,max,0));if(r&&r.length)return normCode(r[0].rawValue)}}catch(e){}}
  if(!window.EAN)return null;
  for(const max of [1400,900,600])for(const rot of [0,90,12,-12,78,102]){const c=EAN.decodeCanvas(drawScaled(img,max,rot),32);if(c)return normCode(c)}
  return null;
}
async function openScanner(meal){
  meal=meal||defaultMeal();
  openSheet(`<h3>Scan barcode</h3>
    <div class="scanwrap"><video id="scanVid" playsinline muted autoplay></video><div class="frame"></div><div class="hint" id="scanHint">Starting camera…</div></div>
    <div class="row2"><button class="btn ghost hidden" id="torch">🔦 Light</button><label class="btn ghost filebtn">Use a photo<input type="file" accept="image/*" capture="environment" id="scanFile"></label></div>
    <div class="row2"><input type="text" id="scanCode" inputmode="numeric" placeholder="…or type the digits" style="margin-top:10px"><button class="btn" id="scanGo" style="flex:0 0 70px;margin-top:10px">Go</button></div>`);
  let stream=null,stop=false,timer=null;
  onSheetClose=()=>{stop=true;clearTimeout(timer);if(stream)stream.getTracks().forEach(t=>t.stop())};
  const done=code=>{if(stop)return;if(navigator.vibrate)navigator.vibrate(60);onSheetClose&&onSheetClose();onSheetClose=null;handleBarcode(code,meal)};
  $("#scanFile").onchange=async ev=>{const f=ev.target.files[0];ev.target.value="";if(!f)return;$("#scanHint").textContent="Reading photo…";
    try{const c=await decodeImage(await loadImage(f));if(c)return done(c)}catch(e){}$("#scanHint").textContent="No barcode found in that photo";};
  $("#scanGo").onclick=()=>{const c=normCode($("#scanCode").value);if(c.length>=8)done(c);else toast("Enter at least 8 digits")};
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}},audio:false});
  }catch(e){$("#scanHint").textContent="Camera not available — allow camera access, or use a photo";return}
  if(stop){stream.getTracks().forEach(t=>t.stop());return}
  const v=$("#scanVid");v.srcObject=stream;try{await v.play()}catch(e){}
  const track=stream.getVideoTracks()[0];
  try{const caps=track.getCapabilities&&track.getCapabilities();
    if(caps&&caps.torch){const tb=$("#torch");tb.classList.remove("hidden");let on=false;tb.onclick=()=>{on=!on;track.applyConstraints({advanced:[{torch:on}]}).catch(()=>{})}}
    if(caps&&caps.focusMode&&caps.focusMode.includes("continuous"))track.applyConstraints({advanced:[{focusMode:"continuous"}]}).catch(()=>{});
  }catch(e){}
  $("#scanHint").textContent="Point at the barcode";
  let detect,bd=null,frame=0;
  if("BarcodeDetector" in window){try{bd=new BarcodeDetector({formats:FORMATS})}catch(e){}}
  detect=async()=>{
    if(bd){try{const r=await bd.detect(v);if(r&&r.length)return normCode(r[0].rawValue)}catch(e){}}
    if(!window.EAN)return null;
    frame++;const c=EAN.decodeCanvas(drawScaled(v,900,frame%2?90:0),20);return c?normCode(c):null;
  };
  let last=null,hits=0;
  const loop=async()=>{if(stop)return;
    try{if(v.readyState>=2){const c=await detect();if(c&&c.length>=8){if(c===last)hits++;else{last=c;hits=1}if(hits>=2)return done(c)}}}catch(e){}
    timer=setTimeout(loop,120)};
  loop();
}

/* ---------- Open Food Facts ---------- */
const OFF_FIELDS="code,product_name,product_name_pl,product_name_en,brands,nutriments,serving_quantity,serving_size,quantity";
function offToProduct(x){
  const n=x.nutriments||{};
  let kcal=n["energy-kcal_100g"];if(kcal==null&&n["energy_100g"]!=null)kcal=n["energy_100g"]/4.184;if(kcal==null&&n["energy-kj_100g"]!=null)kcal=n["energy-kj_100g"]/4.184;
  if(kcal==null)return null;
  const name=x.product_name_pl||x.product_name||x.product_name_en;if(!name)return null;
  const ml=/ml|l\b/i.test(x.quantity||"")&&!/g\b/i.test(x.quantity||"");
  const sq=num(x.serving_quantity);
  const code=normCode(x.code);
  return{id:code||("off-"+uid()),barcode:code||null,name:String(name).trim(),brand:String(x.brands||"").split(",")[0].trim(),unit:ml?"ml":"g",
    kcal:r1(kcal),p:r1(n.proteins_100g),f:r1(n.fat_100g),c:r1(n.carbohydrates_100g),serving:sq>0?{size:sq,label:x.serving_size||""}:null,source:"off",updated:Date.now()};
}
async function offByCode(code){
  const r=await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if(r.status===404)return null;if(!r.ok)throw new Error("OFF "+r.status);
  const j=await r.json();if(!j||j.status!==1||!j.product)return null;
  const p=offToProduct(Object.assign({code},j.product));if(p){p.id=code;p.barcode=code}return p;
}
/* Name search. The old world.openfoodfacts.org search now refuses anonymous apps (HTTP 503),
   so use Search-a-licious: the staging index (newer data, allows GitHub Pages), then production, then the legacy endpoint. */
const SAL_FIELDS="code,product_name,product_name_pl,product_name_en,brands,nutriments,serving_quantity,serving_size,quantity";
function salName(v){if(!v)return"";if(typeof v==="string")return v;return v.pl||v.en||v.main||Object.values(v)[0]||""}
function salToProduct(h){
  const x=Object.assign({},h,{product_name:salName(h.product_name_pl)||salName(h.product_name)||salName(h.product_name_en),
    brands:Array.isArray(h.brands)?h.brands.join(", "):h.brands});
  const p=offToProduct(x);if(p)return p;
  const code=normCode(h.code),name=x.product_name;if(!code||!name)return null;
  return{id:code,barcode:code,name:String(name).trim(),brand:String(x.brands||"").split(",")[0].trim(),unit:"g",kcal:null,source:"off",needsLoad:true};
}
async function offSearch(q){
  const errors=[];
  for(const host of ["https://search.openfoodfacts.net","https://search.openfoodfacts.org"]){
    try{
      const r=await fetch(`${host}/search?q=${encodeURIComponent(q)}&page_size=30&langs=pl,en&fields=${SAL_FIELDS}`);
      if(!r.ok){errors.push(host+" "+r.status);continue}
      const j=await r.json();const list=(j.hits||j.products||[]).map(salToProduct).filter(Boolean);
      if(list.length)return list;
    }catch(e){errors.push(host+" "+(e.message||e))}
  }
  try{
    const r=await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&fields=${OFF_FIELDS}`);
    if(r.ok){const j=await r.json();return(j.products||[]).map(offToProduct).filter(Boolean)}
    errors.push("legacy "+r.status);
  }catch(e){errors.push("legacy "+(e.message||e))}
  if(errors.length>=3)throw new Error(errors.join("; "));
  return[];
}
async function handleBarcode(code,meal){
  const p=S.products[code];
  if(p){toast("Found: "+p.name);return openAmountSheet(p,meal)}
  openSheet(loadingHTML("Looking up "+code+"…","Open Food Facts"));
  let found=null,failed=false;
  try{found=await offByCode(code)}catch(e){failed=true}
  if(found){saveProduct(found);renderFoods();toast("Found: "+found.name);return openAmountSheet(found,meal)}
  if(failed)toast(navigator.onLine?"Couldn't reach Open Food Facts":"You're offline — enter the values from the label");
  openProductForm({barcode:code},meal);
}
async function offSearchUI(q,meal){
  const out=$("#onlineOut");if(!out)return;out.innerHTML='<div class="spin"></div><div class="small muted" style="text-align:center">Searching Open Food Facts…</div>';
  try{
    const res=await offSearch(q);
    if(!res.length){out.innerHTML=`<div class="note small">Nothing found on Open Food Facts for “${esc(q)}”. Try fewer words (e.g. just the brand and product), scan the barcode, or search the web below.</div>`;return}
    out.innerHTML=`<div class="list">${res.map((p,i)=>`<button class="it" data-off="${i}"><div style="min-width:0"><div>${esc(p.name)}</div><div class="small muted">${esc(p.brand)}${p.kcal!=null?` · ${r0(p.kcal)} kcal / 100 ${p.unit}`:" · tap to load values"}</div></div><div class="muted">›</div></button>`).join("")}</div>`;
    out.onclick=async e=>{const b=e.target.closest("[data-off]");if(!b)return;let p=res[+b.dataset.off];
      if(p.needsLoad||p.kcal==null){b.querySelector(".muted").textContent="Loading…";
        try{const full=await offByCode(p.barcode);if(full&&full.kcal!=null)p=full;else{toast("No nutrition values for this one — opening the form");return openProductForm({barcode:p.barcode,name:p.name,brand:p.brand},meal)}}
        catch(err){toast("Couldn't load it — try again");return}}
      saveProduct(p);renderFoods();openAmountSheet(p,meal)};
  }catch(e){console.warn(e);out.innerHTML=`<div class="note warn small">${navigator.onLine?"Open Food Facts search isn't answering right now. Barcode scanning still works, or search the web below.":"You're offline."}</div>`}
}

/* ---------- web search → paste/share back (no AI needed) ---------- */
const PL_WORD="a-ząćęłńóśźż";
function grabNum(text,labels){
  for(const lab of labels){
    const re=new RegExp("(?:^|[^"+PL_WORD+"])(?:"+lab+")(?!["+PL_WORD+"])[^0-9]{0,25}?(\\d+(?:[.,]\\d+)?)","iu");
    const m=re.exec(text);if(m)return parseFloat(m[1].replace(",","."));
  }
  return null;
}
function parseNutrition(text){
  const t=String(text||"").replace(/ /g," ");
  let kcal=null;
  const m=/(\d+(?:[.,]\d+)?)\s*kcal/i.exec(t);if(m)kcal=parseFloat(m[1].replace(",","."));
  if(kcal==null){const kj=/(\d+(?:[.,]\d+)?)\s*kj/i.exec(t);if(kj)kcal=r0(parseFloat(kj[1].replace(",","."))/4.184)}
  if(kcal==null){const k2=/(\d+(?:[.,]\d+)?)\s*(?:kalori\w*|calories|cal\b)/i.exec(t);if(k2)kcal=parseFloat(k2[1].replace(",","."))}
  if(kcal==null)kcal=grabNum(t,["kalorie","kalorii","kal","calories","energy","energia","wartość energetyczna"]);
  const fat=grabNum(t,["tłuszcz","tłuszcze","tłusz","fat","total fat","fett"]);
  const carbs=grabNum(t,["węglowodany","węglowodanów","węglo","carbohydrates?","carbs","total carbohydrate"]);
  const protein=grabNum(t,["białko","białka","białk","proteins?","eiweiß"]);
  const found=[kcal,fat,carbs,protein].filter(v=>v!=null).length;
  return{kcal,f:fat,c:carbs,p:protein,found};
}
function webSearchUI(q,meal){
  const out=$("#onlineOut");if(!out)return;
  const url="https://www.google.com/search?q="+encodeURIComponent(q+" kalorie wartości odżywcze 100 g");
  out.innerHTML=`<div class="card" style="margin-top:10px">
      <div class="small"><b>1.</b> <a href="${url}" target="_blank" rel="noopener">Open Google for “${esc(q)}” ↗</a></div>
      <div class="small" style="margin-top:6px"><b>2.</b> Find the nutrition table (per 100 g), select the text and ${IOS?"<b>Copy</b> it":"<b>Share → Kalorie</b>, or <b>Copy</b> it"}.</div>
      <div class="small" style="margin-top:6px"><b>3.</b> If you copied it, come back and paste:</div>
      <textarea id="wsTxt" rows="3" placeholder="e.g. Wartość energetyczna 1381 kJ / 333 kcal, Tłuszcz 27 g, Węglowodany 1,5 g, Białko 21 g"></textarea>
      <div class="row2"><button class="btn ghost" id="wsClip">Paste from clipboard</button><button class="btn" id="wsGo">Use these values</button></div>
      <div class="small muted" style="margin-top:8px">Want this to happen automatically inside the app? Set up the free web-search relay in Goals → Web search.</div></div>`;
  $("#wsClip").onclick=async()=>{try{$("#wsTxt").value=await navigator.clipboard.readText()}catch(e){toast("Long-press the box and choose Paste")}};
  $("#wsGo").onclick=()=>openParsedForm($("#wsTxt").value,q,meal);
}
function openParsedForm(text,name,meal){
  const v=parseNutrition(text);
  if(!v.found)return toast("Couldn't find any numbers — copy the part with kcal, fat, carbs and protein");
  openProductForm({name:(name||"").trim(),kcal:v.kcal,p:v.p,f:v.f,c:v.c,source:"web",_parsed:true},meal);
  const st=$("#lblStatus");if(st)st.innerHTML=`<div class="note small">Filled ${v.found} of 4 values from the text — check them against the source, fill any gaps, then save.</div>`;
}

/* ---------- web search through your own relay (Cloudflare Worker, see relay/worker.js) ---------- */
const relayOn=()=>!!(S.settings.relayUrl||"").trim();
let relayCtl=null;
async function relaySearch(q,signal){
  const base=S.settings.relayUrl.trim().replace(/\/+$/,"");
  const u=base+"/?q="+encodeURIComponent(q)+(S.settings.relayToken?"&t="+encodeURIComponent(S.settings.relayToken):"");
  const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),30000);
  if(signal)signal.addEventListener("abort",()=>ctl.abort(),{once:true});
  let r;try{r=await fetch(u,{signal:ctl.signal})}catch(e){throw new Error(signal&&signal.aborted?"cancelled":ctl.signal.aborted?"The search took too long":"Couldn't reach your search relay")}finally{clearTimeout(t)}
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error==="wrong token"?"The relay password doesn't match (Goals → Web search)":j.error||("Relay error "+r.status));
  return j.results||[];
}
function cleanTitle(t,q){
  t=String(t||"").replace(/\s*[|–—]\s*.*$/,"").replace(/\s+-\s+(kalorie|kcal|wartości|ile kalorii|fatsecret|sklep|cena).*/i,"")
    .replace(/^(ile kalorii (ma|w)|kalorie|wartości odżywcze)\s*/i,"").trim();
  return t.length>=3?t.slice(0,70):q;
}
async function relayUI(q,meal){
  const out=$("#onlineOut");if(!out)return;
  if(relayCtl)relayCtl.abort();relayCtl=new AbortController();const ctl=relayCtl;
  out.innerHTML=`<div class="spin"></div><div class="small muted" style="text-align:center" id="rlStat">Searching the web for “${esc(q)}”…</div><button class="btn ghost" id="rlCancel" style="margin-top:8px">Cancel</button>`;
  const t0=Date.now(),tick=setInterval(()=>{const el=$("#rlStat");if(!el)return clearInterval(tick);el.textContent=`Searching the web for “${q}”… ${Math.round((Date.now()-t0)/1000)} s`},1000);
  $("#rlCancel").onclick=()=>ctl.abort();
  try{
    const res=await relaySearch(q,ctl.signal);
    const cands=res.map(r=>{
      const a=parseNutrition(r.text||""),b=parseNutrition(r.snippet||"");
      const v={kcal:a.kcal??b.kcal,p:a.p??b.p,f:a.f??b.f,c:a.c??b.c};
      v.found=[v.kcal,v.p,v.f,v.c].filter(x=>x!=null).length;
      return Object.assign(v,{title:cleanTitle(r.title,q),host:r.host,url:r.url});
    }).filter(v=>v.kcal!=null&&v.kcal>0&&v.kcal<950).sort((x,y)=>y.found-x.found);
    if(!cands.length){
      out.innerHTML=`<div class="note small">Found pages, but none had a clear nutrition table. Try a shorter name (brand + product), scan the barcode, or open one yourself:</div>
        <div class="src">${res.slice(0,4).map(r=>`<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.host||r.url)} — ${esc(r.title)}</a>`).join("")}</div>`;
      return;
    }
    out.innerHTML=`<div class="secthead">From the web — per 100 g, tap to check &amp; save</div><div class="list">${cands.map((c,i)=>`<button class="it" data-rl="${i}"><div style="min-width:0"><div>${esc(c.title)}</div>
      <div class="small muted"><b>${r0(c.kcal)} kcal</b>${c.p!=null?" · P "+r1(c.p):""}${c.f!=null?" · F "+r1(c.f):""}${c.c!=null?" · C "+r1(c.c):""} · ${esc(c.host)}${c.found<4?' <span class="est">incomplete</span>':""}</div></div><div class="muted">›</div></button>`).join("")}</div>
      <div class="small muted" style="margin-top:6px">Values are read automatically from the pages — compare with the package when you can.</div>`;
    out.onclick=e=>{const b=e.target.closest("[data-rl]");if(!b)return;const c=cands[+b.dataset.rl];
      openProductForm({name:c.title,kcal:c.kcal,p:c.p,f:c.f,c:c.c,source:"web",_parsed:true,webUrl:c.url},meal);
      const st=$("#lblStatus");if(st)st.innerHTML=`<div class="note small">From <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.host)}</a>. Check the values${c.found<4?" and fill in the missing ones":""}, then save — next time it's in My foods.</div>`};
  }catch(e){
    if(e.message==="cancelled"){out.innerHTML="";return}
    out.innerHTML=`<div class="note warn small">${esc(e.message)}</div>`;
  }finally{clearInterval(tick)}
}

/* ---------- AI helpers ---------- */
function parseJSON(t){t=String(t||"").replace(/```(?:json)?/g,"");const a=t.indexOf("{"),b=t.lastIndexOf("}");if(a<0||b<a)throw{code:"parse"};return JSON.parse(t.slice(a,b+1))}
/* one AbortController per AI action, so the user can cancel */
let aiCtl=null;
const sleep=(ms,sig)=>new Promise((res,rej)=>{const t=setTimeout(res,ms);if(sig)sig.addEventListener("abort",()=>{clearTimeout(t);rej({code:"cancelled"})},{once:true})});

/* ---------- AI via your Cloudflare relay (Workers AI) ---------- */
async function relayAiOnce(prompt,{images,searchQuery}={}){
  const base=(S.settings.relayUrl||"").trim().replace(/\/+$/,"");if(!base)throw{code:"no_key"};
  const signal=aiCtl&&aiCtl.signal;
  const body={prompt};
  if(images&&images.length)body.image=await blobToB64(images[0]);
  if(searchQuery)body.search=searchQuery;
  const ctl=new AbortController(),onAbort=()=>ctl.abort();if(signal)signal.addEventListener("abort",onAbort,{once:true});
  const timer=setTimeout(()=>ctl.abort(),70000);
  let r;
  try{r=await fetch(base+"/ai"+(S.settings.relayToken?"?t="+encodeURIComponent(S.settings.relayToken):""),{method:"POST",signal:ctl.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})}
  catch(e){throw signal&&signal.aborted?{code:"cancelled"}:ctl.signal.aborted?{code:"timeout"}:{code:"network"}}
  finally{clearTimeout(timer);if(signal)signal.removeEventListener("abort",onAbort)}
  const j=await r.json().catch(()=>({}));
  if(r.status===501||j.error==="no_ai_binding")throw{code:"no_binding"};
  if(r.status===403)throw{code:"api",message:j.error==="wrong token"?"the relay password doesn't match (Goals → Web search)":"the relay refused the request"};
  if(!r.ok||!j.text)throw{code:"busy",message:(j.details||[]).join("; ")||j.error||("relay error "+r.status)};
  return{data:parseJSON(j.text),sources:j.sources||[],searched:!!j.searched,searchError:searchQuery&&!j.searched?(j.searchError||"no web results"):null};
}
/* if both AI models were busy, wait a moment and try once more */
async function relayAi(prompt,opts={}){
  try{return await relayAiOnce(prompt,opts)}
  catch(e){if(e.code!=="busy")throw e;setAiStatus("The AI is busy — trying again…");await sleep(2500,aiCtl&&aiCtl.signal);return relayAiOnce(prompt,opts)}
}
/* one entry point for every AI feature */
function ai(prompt,{images,search,searchQuery}={}){return relayAi(prompt,{images,searchQuery:search?searchQuery:null})}
function aiErr(e){
  if(!e)return"Something went wrong.";
  if(e.code==="cancelled")return"Cancelled.";
  if(e.code==="no_key")return"Add your relay address in Goals → Relay.";
  if(e.code==="no_binding")return"Your relay has no AI yet: in Cloudflare open the worker → Settings → Bindings → Add → Workers AI, name it AI, then Deploy.";
  if(e.code==="network")return navigator.onLine?"Couldn't reach your relay.":"You're offline.";
  if(e.code==="busy"||e.code==="timeout")return"The AI didn't answer"+(e.message?" ("+String(e.message).slice(0,120)+")":"")+". Try again in a minute — or use the search or barcode instead.";
  if(e.code==="rate")return"The AI's free limit was reached — wait a minute (or until tomorrow) and try again.";
  if(e.code==="parse"||e.code==="empty")return"The AI's answer couldn't be read. Try again or rephrase.";
  return"AI error: "+(e.message||e.code);
}
/* progress UI shared by all AI actions */
let aiTick=null;
function setAiStatus(t){const el=document.getElementById("aiStat");if(el)el.dataset.msg=t}
function aiBusyHTML(msg){return`<div class="spin"></div><div class="small muted" style="text-align:center" id="aiStat" data-msg="${esc(msg)}">${esc(msg)}</div><button class="btn ghost" id="aiCancel" style="margin-top:8px">Cancel</button>`}
function startAi(container,msg){
  if(aiCtl)aiCtl.abort();aiCtl=new AbortController();
  container.innerHTML=aiBusyHTML(msg);const t0=Date.now();
  clearInterval(aiTick);aiTick=setInterval(()=>{const el=document.getElementById("aiStat");if(!el){clearInterval(aiTick);return}el.textContent=el.dataset.msg+" "+Math.round((Date.now()-t0)/1000)+" s"},1000);
  const c=document.getElementById("aiCancel");if(c)c.onclick=()=>{if(aiCtl)aiCtl.abort()};
  return aiCtl;
}
function endAi(){clearInterval(aiTick);aiCtl=null}
const srcList=(srcs)=>srcs&&srcs.length?`<div class="src muted">Sources:${srcs.slice(0,4).map(s=>`<a href="${esc(s.uri)}" target="_blank" rel="noopener">${esc(s.title||s.uri)}</a>`).join("")}</div>`:"";

async function readLabel(file,p){
  const st=$("#lblStatus");startAi(st,"Reading the label…");
  try{
    const img=await toJpeg(await loadImage(file),1800);
    const{data:j}=await ai(`You are reading a photo of a food package nutrition table (often Polish: "Wartość energetyczna", "Tłuszcz", "Węglowodany", "w tym cukry", "Błonnik", "Białko", "Sól"; or English/German).
Return ONLY JSON: {"name":"short product name or null","brand":"brand or null","unit":"g" or "ml","kcal":number,"protein":number,"fat":number,"carbs":number,"serving_size":number or null,"serving_label":"e.g. 1 bar, or null","readable":true/false,"note":"short note or empty"}
Rules: values PER 100 g (or 100 ml), exactly as printed in the per-100 column. "carbs" = total carbohydrates (Węglowodany), not sugars. If only kJ is shown, kcal = kJ / 4.184. If only per-serving values are printed, convert to per 100 using the serving size. If unreadable, set "readable": false.`,{images:[img]});
    if(j.readable===false||j.kcal==null){st.innerHTML=`<div class="note warn">Couldn't read the label clearly. Try a sharper photo, or type the values.</div>`;return}
    const set=(id,v)=>{if(v!=null&&v!=="")$(id).value=typeof v==="number"?r1(v):v};
    if(!$("#pN").value)set("#pN",j.name);if(!$("#pB").value)set("#pB",j.brand);if(j.unit==="ml")$("#pU").value="ml";
    set("#pK",num(j.kcal));set("#pP",num(j.protein));set("#pF",num(j.fat));set("#pC",num(j.carbs));
    if(j.serving_size)set("#pS",num(j.serving_size));if(j.serving_label)set("#pSL",j.serving_label);
    p._ai=true;
    st.innerHTML=`<div class="note">Values filled from the label — compare with the package, then save.${j.note?"<br><span class='muted'>"+esc(j.note)+"</span>":""}</div>`;
  }catch(e){st.innerHTML=`<div class="note warn">${esc(aiErr(e))}</div>`}
  endAi();
}

/* web lookup of one named product → confirm → save */
async function webLookupUI(q,meal){
  const out=$("#onlineOut");if(!out)return;startAi(out,"Searching the web…");
  try{
    const r=await ai(`Find the official nutrition facts for this food product, as printed on its packaging or published by the restaurant/manufacturer. Product: """${q}"""
LANGUAGE: the text may be Polish or English and may come from speech-to-text, so expect phonetic spellings of brand names (e.g. "Xiążulo"/"Ksiązulo" = "Książulo", "fat pepa" = "Fat Peppa"), Polish number words ("sto osiemdziesiąt gram" = 180 g) and Polish units ("deko"/"dag" = 10 g, "łyżka" ≈ 15 g, "łyżeczka" ≈ 5 g, "szklanka" ≈ 250 ml, "kromka" = slice, "kawałek" = piece, "porcja" = portion, "pół" = half). When searching the web, search in Polish as well as English (Polish shops, Żabka, Biedronka, Lidl, manufacturer sites). Write item names in the language the user used.
Search the web, prefer the manufacturer, retailer product pages, or articles quoting the label.
Reply with ONLY JSON: {"found":true/false,"name":"product name","brand":"brand","unit":"g" or "ml","kcal":number,"protein":number,"fat":number,"carbs":number,"serving_size":number or null,"serving_label":"e.g. whole pizza, or null","confidence":"high|medium|low","note":"where the values come from, short"}
Values must be PER 100 g/ml. If the source gives only per-portion values, convert using the portion weight. If you cannot find reliable values, set "found": false.`,{search:true,searchQuery:q});
    const j=r.data;
    if(!j.found||j.kcal==null){out.innerHTML=`<div class="note small">Couldn't find reliable values online${r.searched?"":" (the web lookup found nothing usable, so this used the AI's own knowledge)"}. Use a label photo or enter the values.</div>${srcList(r.sources)}`;return}
    const p={id:"w-"+uid(),name:j.name||q,brand:j.brand||"",unit:j.unit==="ml"?"ml":"g",kcal:r1(num(j.kcal)),p:r1(num(j.protein)),f:r1(num(j.fat)),c:r1(num(j.carbs)),
      serving:num(j.serving_size)>0?{size:num(j.serving_size),label:j.serving_label||""}:null,source:r.searched?"web":"estimate",updated:Date.now()};
    out.innerHTML=`<div class="card" style="margin-top:10px"><b>${esc(p.name)}</b><div class="small muted">${esc(p.brand)}</div>
      <div class="small" style="margin-top:4px">Per 100 ${p.unit}: <b>${r0(p.kcal)} kcal</b> · P ${p.p} · F ${p.f} · C ${p.c}</div>
      <div class="small muted" style="margin-top:4px">${esc(j.note||"")}${j.confidence?" · confidence: "+esc(j.confidence):""}</div>
      ${r.searched?"":`<div class="note warn small">Web search wasn't available${r.searchError?" ("+esc(r.searchError).slice(0,120)+")":""}, so these values are from the AI's own knowledge — treat as an estimate.</div>`}
      ${srcList(r.sources)}
      <button class="btn" id="wUse">Save to My foods &amp; add</button><button class="btn ghost" id="wEdit">Edit values first</button></div>`;
    $("#wUse").onclick=()=>{saveProduct(p);renderFoods();openAmountSheet(p,meal)};
    $("#wEdit").onclick=()=>openProductForm(p,meal);
  }catch(e){out.innerHTML=`<div class="note warn small">${esc(aiErr(e))}</div>`}
  endAi();
}

/* ---------- voice input (Chrome speech recognition, Polish or English) ---------- */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
let rec=null,micBroken=false;
const voiceLang=()=>S.settings.voiceLang||"pl-PL";
function micRow(targetId){
  if(!SR||micBroken)return`<div class="small muted">Tip: tap the 🎤 on your keyboard to dictate${IOS?" (for Polish, add a Polish keyboard in Settings → General → Keyboard)":" (add Polish in Gboard's languages for Polish)"}.</div>`;
  const pl=voiceLang()==="pl-PL";
  return`<div class="row2" style="margin-top:8px;align-items:center"><button type="button" class="btn sec mic" data-mic="${targetId}" style="margin-top:0">🎤 ${pl?"Mów":"Speak"}</button>
    <button type="button" class="chip langchip" style="flex:0 0 auto;padding:10px 14px">${pl?"🇵🇱 PL":"🇬🇧 EN"}</button></div>`;
}
function attachMics(root){
  root.querySelectorAll("[data-mic]").forEach(b=>b.onclick=()=>toggleMic(b,document.getElementById(b.dataset.mic)));
  root.querySelectorAll(".langchip").forEach(c=>c.onclick=()=>{stopMic();S.settings.voiceLang=voiceLang()==="pl-PL"?"en-US":"pl-PL";store.saveSettings(S.settings);
    const pl=voiceLang()==="pl-PL";root.querySelectorAll(".langchip").forEach(x=>x.textContent=pl?"🇵🇱 PL":"🇬🇧 EN");root.querySelectorAll("[data-mic]").forEach(x=>x.textContent="🎤 "+(pl?"Mów":"Speak"))});
}
function stopMic(){if(rec){try{rec.stop()}catch(e){}}}
function toggleMic(btn,ta){
  if(rec){stopMic();return}
  if(!ta)return;
  const r=new SR();r.lang=voiceLang();r.interimResults=true;r.continuous=false;r.maxAlternatives=1;
  const base=ta.value.trim()?ta.value.trim()+" ":"";let fin="";
  const label=btn.textContent;
  r.onresult=e=>{let interim="";for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)fin+=t+" ";else interim+=t}ta.value=(base+fin+interim).replace(/\s+/g," ").trim()};
  r.onerror=e=>{
    if(IOS&&e.error==="service-not-allowed"){micBroken=true;btn.disabled=true;toast("Voice input isn't available in iPhone home-screen apps — use the 🎤 on the keyboard instead");return}
    toast(e.error==="not-allowed"||e.error==="service-not-allowed"?"Allow microphone access to dictate":e.error==="no-speech"?"Didn't hear anything — try again":e.error==="network"?"Voice input needs internet":"Voice input error: "+e.error)};
  r.onend=()=>{rec=null;btn.classList.remove("on");btn.textContent=label};
  try{r.start();rec=r;btn.classList.add("on");btn.textContent="⏹ "+(voiceLang()==="pl-PL"?"Słucham…":"Listening…");if(navigator.vibrate)navigator.vibrate(30)}catch(e){rec=null}
}

/* ---------- quick add: photo / describe / manual ---------- */
const shareFoods=()=>S.settings.shareFoods===true;
function productDigest(){if(!shareFoods())return"";return productsSorted().slice(0,200).map(p=>`${p.id} | ${p.name}${p.brand?" ("+p.brand+")":""} | per 100 ${p.unit||"g"}: ${r0(p.kcal)} kcal, P ${r1(p.p)}, F ${r1(p.f)}, C ${r1(p.c)}`).join("\n")}
async function estimateFood(text,img){
  return ai(`You help log food in a calorie tracker. The user ${img?"attached a photo of what they are eating and ":""}wrote: """${text||"(no text — use the photo)"}"""

SAVED PRODUCTS (the user's own database, exact label values):
${productDigest()||"(not shared — set product_id to null)"}

LANGUAGE: the text may be Polish or English and may come from speech-to-text, so expect phonetic spellings of brand names (e.g. "Xiążulo"/"Ksiązulo" = "Książulo", "fat pepa" = "Fat Peppa"), Polish number words ("sto osiemdziesiąt gram" = 180 g) and Polish units ("deko"/"dag" = 10 g, "łyżka" ≈ 15 g, "łyżeczka" ≈ 5 g, "szklanka" ≈ 250 ml, "kromka" = slice, "kawałek" = piece, "porcja" = portion, "pół" = half). When searching the web, search in Polish as well as English (Polish shops, Żabka, Biedronka, Lidl, manufacturer sites). Write item names in the language the user used.
Split the food into separate items. For each item:
1. If it matches a SAVED PRODUCT (fuzzy: typos, Polish/English), set "product_id" to that id and "source":"saved".
2. Else if it is a branded product or chain-restaurant item, search the web for its official nutrition values (manufacturer, restaurant, retailer page, or articles quoting the label): "source":"brand", and fill "per100".
3. Else estimate from typical recipes and Polish/European food values: "source":"estimate". Never present a guess as official values.
If grams are stated, use them exactly; otherwise assume one typical portion. Weights are as eaten.
Reply with ONLY JSON:
{"items":[{"name":"short name","brand":"brand or empty","grams":number,"product_id":"id or null","source":"saved|brand|estimate","kcal":number,"protein":number,"fat":number,"carbs":number,"per100":{"kcal":n,"protein":n,"fat":n,"carbs":n} or null}],"note":"one short sentence on what is uncertain, or empty"}`,{images:img?[img]:null,search:!!text,searchQuery:text});
}
const SRC_BADGE={saved:"your food",brand:"brand data",estimate:"estimate"};
/* match a food name against saved products on the phone (used when the list isn't shared with the AI) */
function localMatch(name){
  const toks=x=>norm(x).replace(/\(.*?\)/g," ").split(/[^a-z0-9]+/).filter(t=>t.length>=3);
  const q=toks(name);if(!q.length)return null;
  let best=null,bs=0;
  for(const p of Object.values(S.products)){const nt=toks(p.name);if(!nt.length)continue;
    const sc=nt.filter(t=>q.some(w=>w.slice(0,4)===t.slice(0,4))).length/nt.length;
    if(sc>bs||(sc===bs&&best&&(p.lastUsed||0)>(best.lastUsed||0))){bs=sc;best=p}}
  return bs>=0.75?best:null;
}
function renderEstimate(out,res,meal){
  const j=res.data;
  const items=(j.items||[]).filter(i=>i&&i.name).map(i=>{
    const p=(i.product_id&&getProduct(String(i.product_id)))||(!shareFoods()?localMatch((i.brand?i.brand+" ":"")+i.name):null);
    let src=p?"saved":(i.source==="brand"?"brand":"estimate");
    if(src==="brand"&&!res.searched)src="estimate";
    const g=num(i.grams)||100;
    const per=p?{kcal:p.kcal,p:p.p,f:p.f,c:p.c}:(i.per100&&num(i.per100.kcal)?{kcal:num(i.per100.kcal),p:num(i.per100.protein),f:num(i.per100.fat),c:num(i.per100.carbs)}:null);
    return{name:p?p.name:i.name,brand:p?p.brand:(i.brand||""),prod:p||null,source:src,grams:g,base:{g,kcal:num(i.kcal),p:num(i.protein),f:num(i.fat),c:num(i.carbs)},per,on:true,save:src==="brand"&&!!per};
  });
  if(!items.length)throw{code:"empty"};
  const calc=it=>{if(it.per)return macrosFor(it.per,it.grams);const k=it.grams/(it.base.g||1);return{kcal:r0(it.base.kcal*k),p:r1(it.base.p*k),f:r1(it.base.f*k),c:r1(it.base.c*k)}};
  const draw=()=>{
    const tot=items.filter(i=>i.on).reduce((a,i)=>{const v=calc(i);return{kcal:a.kcal+v.kcal,p:a.p+v.p,f:a.f+v.f,c:a.c+v.c}},{kcal:0,p:0,f:0,c:0});
    out.innerHTML=`<div class="list" style="margin-top:10px">${items.map((it,n)=>{const v=calc(it);return `<div class="it" style="align-items:flex-start">
      <label style="display:flex;gap:8px;min-width:0;flex:1"><input type="checkbox" data-on="${n}"${it.on?" checked":""}>
      <span style="min-width:0"><span>${esc(it.name)}</span> <span class="est" style="${it.source==="saved"?"background:var(--acc2);color:var(--acc)":""}">${SRC_BADGE[it.source]}</span>
      <div class="small muted">P ${r0(v.p)} · F ${r0(v.f)} · C ${r0(v.c)}${it.per&&!it.prod?" · "+r0(it.per.kcal)+" kcal/100 g":""}</div>
      ${it.source==="brand"&&it.per?`<label class="small muted" style="display:flex;gap:6px;align-items:center;margin-top:2px"><input type="checkbox" data-save="${n}"${it.save?" checked":""}> save to My foods</label>`:""}</span></label>
      <div style="text-align:right;flex:none"><input type="number" data-g="${n}" value="${r0(it.grams)}" inputmode="decimal" style="width:76px;padding:6px 8px;text-align:right"> <span class="small muted">g</span><div><b>${v.kcal} kcal</b></div></div></div>`}).join("")}</div>
      ${j.note?`<div class="small muted" style="margin-top:6px">${esc(j.note)}</div>`:""}
      ${res.searchError?`<div class="note warn small">The web lookup didn't find usable pages this time, so branded items are estimates.</div>`:""}
      ${srcList(res.sources)}
      <div class="preview"><div><b>${r0(tot.kcal)}</b><span>kcal</span></div><div><b>${r0(tot.p)}</b><span>protein g</span></div><div><b>${r0(tot.f)}</b><span>fat g</span></div><div><b>${r0(tot.c)}</b><span>carbs g</span></div></div>
      <button class="btn" id="qAdd">Add to ${esc(mealName(meal))}</button>`;
    out.querySelectorAll("[data-on]").forEach(c=>c.onchange=()=>{items[+c.dataset.on].on=c.checked;draw()});
    out.querySelectorAll("[data-save]").forEach(c=>c.onchange=()=>{items[+c.dataset.save].save=c.checked});
    out.querySelectorAll("[data-g]").forEach(c=>c.onchange=()=>{items[+c.dataset.g].grams=Math.max(0,num(c.value));draw()});
    $("#qAdd").onclick=()=>{
      const sel=items.filter(i=>i.on&&i.grams>0);if(!sel.length)return toast("Nothing selected");
      let changed=false;
      sel.forEach(it=>{
        if(!it.prod&&it.save&&it.per){it.prod={id:"w-"+uid(),name:it.name,brand:it.brand,unit:"g",kcal:r1(it.per.kcal),p:r1(it.per.p),f:r1(it.per.f),c:r1(it.per.c),source:"web",updated:Date.now()};S.products[it.prod.id]=it.prod;changed=true}
        const v=calc(it);
        S.day.entries.push({id:uid(),meal,pid:it.prod?it.prod.id:null,name:it.name,amount:it.grams,unit:it.prod?(it.prod.unit||"g"):"g",...v,est:it.source==="estimate"});
        if(it.prod){S.products[it.prod.id]=Object.assign({},it.prod,{lastUsed:Date.now(),lastAmount:it.grams});changed=true}
      });
      if(changed){store.saveProducts();renderFoods()}
      renderDiary();closeSheet();saveDay();toast("Added "+r0(sel.reduce((a,i)=>a+calc(i).kcal,0))+" kcal");
    };
  };
  draw();
}
function openQuickSheet(meal,mode){
  mode=mode||"text";
  openSheet(`<h3>Quick add · ${esc(mealName(meal))}</h3>
    <div class="seg"><button data-q="photo">📷 Photo</button><button data-q="text">💬 Describe</button><button data-q="man">Enter kcal</button></div>
    ${aiOn()?"":`<div class="note small" data-needkey>Photo and Describe need the AI helper — set it up in Goals → AI helper.</div>`}
    <div data-pane="photo" class="hidden">
      <label class="btn sec filebtn" style="margin-top:8px">Take or choose a photo of your food<input type="file" accept="image/*" capture="environment" id="qImg"></label>
      <img id="qThumb" class="hidden" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px;margin-top:10px" alt="">
      <textarea id="qPhotoTxt" rows="2" placeholder="Optional: what the photo doesn't show — np. &quot;około 180 g&quot;, &quot;smażone na maśle&quot;"></textarea>
      ${micRow("qPhotoTxt")}
      <button class="btn" id="qPhotoGo" disabled>Estimate from photo</button>
    </div>
    <div data-pane="text" class="hidden">
      ${micRow("qTxt")}
      <textarea id="qTxt" rows="3" placeholder="np. &quot;180 gram pizzy Fat Peppa od Książula&quot;, &quot;Big Mac i średnie frytki&quot;, &quot;2 jajka sadzone i kromka chleba żytniego&quot;"></textarea>
      <div class="small muted">Say or type it in Polish or English — you can fix the text before sending. Branded and fast-food items are looked up on the web.</div>
      <button class="btn" id="qGo">Break it down</button>
    </div>
    <div data-pane="man" class="hidden">
      <label class="f">Name</label><input type="text" id="mN" placeholder="e.g. Pizza slice">
      <div class="grid4"><div><label class="f">kcal</label><input type="number" id="mK" inputmode="decimal"></div><div><label class="f">Protein</label><input type="number" id="mP" inputmode="decimal"></div><div><label class="f">Fat</label><input type="number" id="mF" inputmode="decimal"></div><div><label class="f">Carbs</label><input type="number" id="mC" inputmode="decimal"></div></div>
      <button class="btn" id="mGo">Add</button>
    </div>
    <div id="qOut"></div>`);
  attachMics($("#sheetBody"));
  const seg=$("#sheetBody .seg");
  const show=m=>{stopMic();seg.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x.dataset.q===m));document.querySelectorAll("#sheetBody [data-pane]").forEach(p=>p.classList.toggle("hidden",p.dataset.pane!==m));$("#qOut").innerHTML="";const nk=$("#sheetBody [data-needkey]");if(nk)nk.classList.toggle("hidden",m==="man")};
  seg.onclick=e=>{const b=e.target.closest("[data-q]");if(b)show(b.dataset.q)};
  show(mode);
  const run=async(btn,text,img)=>{
    const out=$("#qOut");startAi(out,text?"Looking it up…":"Looking at the photo…");btn.disabled=true;
    try{renderEstimate(out,await estimateFood(text,img),meal)}
    catch(e){
      const q=(text||"").replace(/\d+([.,]\d+)?\s*(g|gram\w*|ml|kg|szt\w*|plast\w*|kawał\w*|łyż\w*|porcj\w*)?\b/gi," ").replace(/\s+/g," ").trim();
      out.innerHTML=`<div class="note warn">${esc(aiErr(e))}</div>`+(e.code!=="cancelled"&&q?`<button class="btn ghost" id="qOff">Search Open Food Facts for “${esc(q)}”</button><button class="btn ghost" id="qG">${relayOn()?"🔎 Search the web":"Search Google &amp; paste the values"}</button><div id="onlineOut"></div>`:"");
      const o=$("#qOff");if(o)o.onclick=()=>offSearchUI(q,meal);
      const g=$("#qG");if(g)g.onclick=()=>relayOn()?relayUI(q,meal):webSearchUI(q,meal);
    }
    endAi();btn.disabled=false;
  };
  let img=null;
  $("#qImg").onchange=async ev=>{const f=ev.target.files[0];ev.target.value="";if(!f)return;
    try{img=await toJpeg(await loadImage(f),1400);const t=$("#qThumb");t.src=URL.createObjectURL(img);t.classList.remove("hidden");$("#qPhotoGo").disabled=false}catch(e){toast("Couldn't open that photo")}};
  $("#qPhotoGo").onclick=()=>{if(img)run($("#qPhotoGo"),$("#qPhotoTxt").value.trim(),img)};
  $("#qGo").onclick=()=>{const t=$("#qTxt").value.trim();if(!t)return toast("Describe what you're eating");run($("#qGo"),t,null)};
  $("#mGo").onclick=()=>{const k=num($("#mK").value);if(!k)return toast("Enter kcal");
    S.day.entries.push({id:uid(),meal,name:$("#mN").value.trim()||"Quick add",kcal:k,p:num($("#mP").value),f:num($("#mF").value),c:num($("#mC").value)});renderDiary();closeSheet();saveDay();toast("Added "+r0(k)+" kcal")};
}

/* ---------- foods tab ---------- */
function renderFoods(){
  const q=($("#foodSearch").value||"").trim();
  const list=q?localSearch(q).mine:Object.values(S.products).sort((a,b)=>a.name.localeCompare(b.name));
  $("#foodList").innerHTML=list.length?list.map(prodRow).join(""):`<div class="muted small" style="padding:6px 2px">${Object.keys(S.products).length?"No matches.":"No saved products yet. Scan a barcode or add one manually."}</div>`;
}
$("#foodSearch").oninput=renderFoods;
$("#foodList").onclick=e=>{const b=e.target.closest("[data-pid]");if(b){const p=getProduct(b.dataset.pid);if(p)openAmountSheet(p)}};
$("#newFoodBtn").onclick=()=>openProductForm(null,false);

/* ---------- progress ---------- */
function lineChart(pts){
  if(pts.length<2)return'<div class="small muted">Log your weight on at least two days to see a trend.</div>';
  const W=520,H=170,pl=34,pr=10,pt=10,pb=24;
  const ys=pts.map(p=>p.v),mn=Math.min(...ys)-0.5,mx=Math.max(...ys)+0.5;
  const t0=+new Date(pts[0].d),t1=+new Date(pts[pts.length-1].d);
  const X=d=>pl+(W-pl-pr)*((+new Date(d)-t0)/((t1-t0)||1)),Y=v=>pt+(H-pt-pb)*(1-(v-mn)/((mx-mn)||1));
  const ticks=[mn+0.5,(mn+mx)/2,mx-0.5];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${ticks.map(v=>`<line x1="${pl}" x2="${W-pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${pl-6}" y="${Y(v)+4}" font-size="11" text-anchor="end" fill="var(--mute)">${r1(v)}</text>`).join("")}
    <polyline fill="none" stroke="var(--acc)" stroke-width="2.5" stroke-linejoin="round" points="${pts.map(p=>X(p.d)+","+Y(p.v)).join(" ")}"/>
    ${pts.map(p=>`<circle cx="${X(p.d)}" cy="${Y(p.v)}" r="3.5" fill="var(--acc)"/>`).join("")}
    <text x="${pl}" y="${H-6}" font-size="11" fill="var(--mute)">${esc(dayLabel(pts[0].d))}</text><text x="${W-pr}" y="${H-6}" font-size="11" text-anchor="end" fill="var(--mute)">${esc(dayLabel(pts[pts.length-1].d))}</text></svg>`;
}
async function renderProgress(){
  const wl=(S.weights.list||[]).slice().sort((a,b)=>a.d<b.d?-1:1);
  $("#wChart").innerHTML=lineChart(wl.slice(-90).map(x=>({d:x.d,v:x.kg})));
  if(wl.length>1){const f=wl[0],l=wl[wl.length-1],diff=r1(l.kg-f.kg);$("#wSummary").textContent=`Latest ${r1(l.kg)} kg · ${diff<=0?"down":"up"} ${Math.abs(diff)} kg since ${dayLabel(f.d)}`}
  else $("#wSummary").textContent=wl.length?`Latest ${r1(wl[0].kg)} kg`:"";
  const to=today(),from=addDays(to,-13);let days={};
  try{days=await store.days(from,to)}catch(e){}
  if(S.date>=from&&S.date<=to)days[S.date]=S.day;
  const g=prof().goal,W=520,H=170,pl=34,pb=24,pt=10,n=14,bw=(W-pl-10)/n;
  const vals=[];for(let i=0;i<n;i++){const d=addDays(from,i);vals.push({d,v:totals((days[d]&&days[d].entries)||[]).kcal})}
  const mx=Math.max(g*1.25,...vals.map(v=>v.v)),Y=v=>pt+(H-pt-pb)*(1-v/mx);
  $("#kChart").innerHTML=`<svg class="chart" viewBox="0 0 ${W} ${H}">
    ${vals.map((x,i)=>{const y=Y(x.v);return `<rect x="${pl+i*bw+bw*0.18}" y="${y}" width="${bw*0.64}" height="${Math.max(0,H-pb-y)}" rx="3" fill="${x.v>g?"var(--warn)":"var(--acc)"}" opacity="${x.v?1:0}"/>
      <text x="${pl+i*bw+bw/2}" y="${H-8}" font-size="10" text-anchor="middle" fill="var(--mute)">${+x.d.slice(8)}</text>`}).join("")}
    <line x1="${pl}" x2="${W-10}" y1="${Y(g)}" y2="${Y(g)}" stroke="var(--ink)" stroke-dasharray="4 4" opacity=".55"/>
    <text x="${pl-6}" y="${Y(g)+4}" font-size="11" text-anchor="end" fill="var(--mute)">${r0(g)}</text></svg>`;
  const logged=vals.filter(v=>v.v>0);
  $("#kSummary").textContent=logged.length?`Average ${r0(logged.reduce((a,v)=>a+v.v,0)/logged.length)} kcal on ${logged.length} logged day${logged.length>1?"s":""} · dashed line = goal`:"No days logged yet.";
}
$("#wAdd").onclick=()=>{
  const kg=num($("#wInput").value);if(kg<25||kg>350)return toast("Enter weight in kg");
  const d=today();S.weights.list=(S.weights.list||[]).filter(x=>x.d!==d);S.weights.list.push({d,kg});
  $("#wInput").value="";renderProgress();store.saveWeights(S.weights);toast("Weight logged");
  if(!$("#cW").value)$("#cW").value=kg;
};

/* ---------- settings ---------- */
function renderSettings(){
  const p=prof();$("#sGoal").value=r0(p.goal);$("#sP").value=p.pp;$("#sF").value=p.pf;$("#sC").value=p.pc;macroInfo();
  if(p.calc){$("#cSex").value=p.calc.sex;$("#cAge").value=p.calc.age;$("#cH").value=p.calc.h;$("#cW").value=p.calc.w;$("#cAct").value=p.calc.act;$("#cPace").value=p.calc.pace}
  else{const wl=S.weights.list||[];if(wl.length)$("#cW").value=wl[wl.length-1].kg;$("#calcBox").open=true}
  calc();
  $("#rlUrl").value=S.settings.relayUrl||"";$("#rlTok").value=S.settings.relayToken||"";$("#aiShare").checked=shareFoods();
  updateDataInfo();
}
async function updateDataInfo(){
  let txt=`${Object.keys(S.products).length} saved products. Data is stored only on this phone.`;
  try{if(navigator.storage&&navigator.storage.persisted){const ok=await navigator.storage.persisted();txt+=ok?" Protected from automatic clearing.":" Install the app to your home screen to protect it from automatic clearing."}}catch(e){}
  if(S.settings.lastBackup)txt+=` Last backup: ${dayLabel(S.settings.lastBackup)}.`;else txt+=" Export a backup now and then (e.g. to Google Drive).";
  $("#dataInfo").textContent=txt;
}
function macroInfo(){
  const g=num($("#sGoal").value),a=num($("#sP").value),b=num($("#sF").value),c=num($("#sC").value),s=a+b+c;
  $("#sMacroInfo").innerHTML=s!==100?`<span style="color:var(--warn)">Adds up to ${s}% — should be 100%</span>`:`= ${r0(g*a/400)} g protein · ${r0(g*b/900)} g fat · ${r0(g*c/400)} g carbs`;
}
["#sGoal","#sP","#sF","#sC"].forEach(id=>$(id).oninput=macroInfo);
$("#sSave").onclick=()=>{
  const a=num($("#sP").value),b=num($("#sF").value),c=num($("#sC").value);
  if(a+b+c!==100)return toast("Macros must add up to 100%");
  const g=num($("#sGoal").value);if(g<800||g>6000)return toast("Enter a goal between 800 and 6000");
  S.profile=Object.assign(prof(),{goal:g,pp:a,pf:b,pc:c});store.saveProfile(S.profile);renderDiary();toast("Goals saved");
};
function calc(){
  const sex=$("#cSex").value,age=num($("#cAge").value),h=num($("#cH").value),w=num($("#cW").value),act=num($("#cAct").value),pace=num($("#cPace").value);
  const out=$("#cOut");
  if(!age||!h||!w){out.innerHTML='<div class="small muted" style="margin-top:10px">Fill in age, height and weight.</div>';return}
  const bmr=10*w+6.25*h-5*age+(sex==="m"?5:-161),tdee=bmr*act,floor=sex==="m"?1500:1200;
  let target=Math.round((tdee-pace)/10)*10;const low=target<floor;if(low)target=floor;
  out.innerHTML=`<div class="preview" style="grid-template-columns:repeat(3,1fr)"><div><b>${r0(bmr)}</b><span>at rest (BMR)</span></div><div><b>${r0(tdee)}</b><span>maintenance</span></div><div><b style="color:var(--acc)">${target}</b><span>your target</span></div></div>
    ${low?`<div class="note warn">That pace would put you below ${floor} kcal/day, so the target is held at ${floor}. A slower pace is easier to sustain.</div>`:""}
    <div class="small muted" style="margin-top:8px">Mifflin-St Jeor estimate. Real needs vary by ±10%; check your weight trend after 2–3 weeks and adjust by 100–200 kcal.</div>
    <button class="btn" id="cUse">Use ${target} kcal as my goal</button>`;
  $("#cUse").onclick=()=>{S.profile=Object.assign(prof(),{goal:target,calc:{sex,age,h,w,act,pace}});store.saveProfile(S.profile);renderSettings();renderDiary();toast("Goal set to "+target+" kcal")};
}
["#cSex","#cAge","#cH","#cW","#cAct","#cPace"].forEach(id=>$(id).addEventListener("input",calc));
$("#aiSave").onclick=()=>{S.settings=Object.assign({},S.settings,{shareFoods:$("#aiShare").checked});store.saveSettings(S.settings);toast("Saved")};
$("#aiTest").onclick=async()=>{
  const st=$("#aiStatus");
  if(!relayOn()){st.innerHTML=`<span style="color:var(--warn)">Add your relay address above first.</span>`;return}
  st.textContent="Testing…";
  try{await relayAiOnce('Reply with only this JSON: {"ok":true}');st.innerHTML='<span style="color:var(--acc)">✓ AI works.</span> Photo estimates, label reading and describe are on.'}
  catch(e){st.innerHTML=`<span style="color:var(--warn)">${esc(aiErr(e))}</span>`}
};

$("#rlSave").onclick=()=>{let u=$("#rlUrl").value.trim();if(u&&!/^https:\/\//.test(u))u="https://"+u;
  S.settings=Object.assign({},S.settings,{relayUrl:u,relayToken:$("#rlTok").value.trim()});store.saveSettings(S.settings);$("#rlUrl").value=u;toast("Relay settings saved")};
$("#rlTest").onclick=async()=>{$("#rlSave").onclick();const st=$("#rlStatus");if(!relayOn()){st.textContent="Paste your relay address first.";return}
  st.textContent="Testing…";
  try{const res=await relaySearch("skyr naturalny");const n=res.filter(r=>parseNutrition((r.text||"")+"\n"+(r.snippet||"")).kcal!=null).length;
    st.innerHTML=`<span style="color:var(--acc)">✓ Relay works</span> — ${res.length} pages found, ${n} with nutrition values.`}
  catch(e){st.innerHTML=`<span style="color:var(--warn)">${esc(e.message)}</span>`}};

/* backup */
async function exportData(){
  const all=await store.days("0000","9999");
  return{app:"kalorie",version:1,exported:new Date().toISOString(),profile:S.profile,products:S.products,weights:S.weights,days:all};
}
$("#exportBtn").onclick=async()=>{
  const data=await exportData();
  const blob=new Blob([JSON.stringify(data)],{type:"application/json"});
  const name=`kalorie-backup-${today()}.json`;
  try{const file=new File([blob],name,{type:"application/json"});
    if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:"Kalorie backup"})}
    else{const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove()}
    S.settings.lastBackup=today();store.saveSettings(S.settings);updateDataInfo();
  }catch(e){if(e&&e.name!=="AbortError")toast("Couldn't export")}
};
async function importData(j){
  if(!j||typeof j!=="object")throw new Error("bad");
  if(j.profile)S.profile=Object.assign(prof(),j.profile);
  if(j.products&&typeof j.products==="object"){for(const[k,v]of Object.entries(j.products)){if(v&&v.name)S.products[k]=Object.assign({},v,{id:k,source:v.source==="catalog"?"web":v.source})}}
  if(j.weights&&Array.isArray(j.weights.list)){const m={};for(const w of(S.weights.list||[]).concat(j.weights.list))if(w&&w.d)m[w.d]=w;S.weights={list:Object.values(m)}}
  let nd=0;
  if(j.days&&typeof j.days==="object"){for(const[d,v]of Object.entries(j.days)){if(!/^\d{4}-\d\d-\d\d$/.test(d)||!v||!Array.isArray(v.entries))continue;
    const cur=await store.day(d);const ids=new Set(cur.entries.map(e=>e.id));const merged=cur.entries.concat(v.entries.filter(e=>!ids.has(e.id)));
    await store.saveDay(d,{date:d,entries:merged});nd++}}
  if(S.profile)await store.saveProfile(S.profile);await store.saveProducts();await store.saveWeights(S.weights);
  await loadDay(S.date);renderSettings();renderFoods();
  toast(`Imported ${Object.keys(j.products||{}).length} products and ${nd} days`);
}
$("#importFile").onchange=async ev=>{const f=ev.target.files[0];ev.target.value="";if(!f)return;try{await importData(JSON.parse(await f.text()))}catch(e){toast("That file isn't a Kalorie backup")}};
$("#importPaste").onclick=async()=>{try{await importData(JSON.parse($("#importTxt").value));$("#importTxt").value=""}catch(e){toast("That text isn't valid backup data")}};

/* ---------- tabs ---------- */
document.querySelectorAll("nav.tabs button").forEach(b=>b.onclick=()=>{
  document.querySelectorAll("nav.tabs button").forEach(x=>x.classList.toggle("on",x===b));
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("on",v.id==="v-"+b.dataset.v));
  $("#fab").classList.toggle("hidden",b.dataset.v!=="diary");
  if(b.dataset.v==="foods")renderFoods();if(b.dataset.v==="progress")renderProgress();if(b.dataset.v==="settings")renderSettings();
  window.scrollTo(0,0);
});
$("#fab").onclick=()=>openScanner(defaultMeal());

/* ---------- text shared to Kalorie from another app (Android share sheet) ---------- */
function handleShare(){
  const u=new URL(location.href);if(!u.searchParams.has("text")&&!u.searchParams.has("title"))return;
  const text=[u.searchParams.get("text"),u.searchParams.get("title")].filter(Boolean).join("\n");
  history.replaceState(null,"",location.pathname);
  const v=parseNutrition(text);
  const title=(u.searchParams.get("title")||"").replace(/\s*[-|–].*$/,"").slice(0,80);
  if(!v.found){toast("No nutrition numbers in the shared text — select the part with kcal, fat, carbs and protein");return}
  openParsedForm(text,title,defaultMeal());
}

/* ---------- boot ---------- */
(async function boot(){
  renderDiary();
  try{
    const[pr,ps,ws,st]=await Promise.all([store.profile(),store.products(),store.weights(),store.settings()]);
    S.profile=pr;S.products=ps||{};S.weights=ws||{list:[]};S.settings=st||{};
    if("apiKey" in S.settings||"aiProvider" in S.settings){["apiKey","model","search","searchOffUntil","aiProvider"].forEach(k=>delete S.settings[k]);store.saveSettings(S.settings)}
  }catch(e){toast("Couldn't open saved data")}
  await loadDay(today());
  handleShare();
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
  if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
  let bootDay=today();
  document.addEventListener("visibilitychange",()=>{if(document.hidden)return;const t=today();if(t!==bootDay){if(S.date===bootDay)loadDay(t);bootDay=t}});
})();
