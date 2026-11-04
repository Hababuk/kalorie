/* Self-contained EAN-13 / EAN-8 / UPC-A barcode reader (no external code).
   Scans horizontal lines of a canvas, converts them to bar/space widths and
   decodes them with the standard EAN tables; the check digit filters misreads. */
(function(){
  const L=["3211","2221","2122","1411","1132","1231","1114","1312","1213","3112"].map(s=>s.split("").map(Number));
  const G=L.map(p=>p.slice().reverse());
  const PARITY=["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLG","LGLGLG","LGLGGL","LGGLGL"];

  function matchDigit(w,tables){
    const T=w[0]+w[1]+w[2]+w[3];if(!T)return null;
    const n=w.map(x=>x*7/T);let best=null,bestErr=9,second=9;
    for(const[name,tab]of tables)for(let d=0;d<10;d++){const p=tab[d];
      const e=Math.abs(n[0]-p[0])+Math.abs(n[1]-p[1])+Math.abs(n[2]-p[2])+Math.abs(n[3]-p[3]);
      if(e<bestErr){second=bestErr;bestErr=e;best={d,t:name}}else if(e<second)second=e}
    return bestErr<1.6?best:null;
  }
  const guardOk=(r,i,k,mod)=>{for(let j=0;j<k;j++){const x=r[i+j]/mod;if(x<0.45||x>2.0)return false}return true};
  function checksum(digits){let s=0;const n=digits.length;for(let i=0;i<n-1;i++)s+=digits[i]*(((n-1-i)%2)?3:1);return(10-s%10)%10===digits[n-1]}

  function tryEAN13(r,i){
    if(i+59>r.length)return null;
    let tot=0;for(let j=0;j<59;j++)tot+=r[i+j];const mod=tot/95;
    if(!guardOk(r,i,3,mod)||!guardOk(r,i+27,5,mod)||!guardOk(r,i+56,3,mod))return null;
    if(i>0&&r[i-1]<mod*3)return null;            // quiet zone before
    if(i+59<r.length&&r[i+59]<mod*3)return null;  // quiet zone after
    const left=[],par=[];
    for(let k=0;k<6;k++){const m=matchDigit(r.slice(i+3+k*4,i+7+k*4),[["L",L],["G",G]]);if(!m)return null;left.push(m.d);par.push(m.t)}
    const first=PARITY.indexOf(par.join(""));if(first<0)return null;
    const right=[];
    for(let k=0;k<6;k++){const m=matchDigit(r.slice(i+32+k*4,i+36+k*4),[["R",L]]);if(!m)return null;right.push(m.d)}
    const all=[first,...left,...right];return checksum(all)?all.join(""):null;
  }
  function tryEAN8(r,i){
    if(i+43>r.length)return null;
    let tot=0;for(let j=0;j<43;j++)tot+=r[i+j];const mod=tot/67;
    if(!guardOk(r,i,3,mod)||!guardOk(r,i+19,5,mod)||!guardOk(r,i+40,3,mod))return null;
    if(i>0&&r[i-1]<mod*5)return null;
    if(i+43<r.length&&r[i+43]<mod*5)return null;
    const all=[];
    for(let k=0;k<4;k++){const m=matchDigit(r.slice(i+3+k*4,i+7+k*4),[["L",L]]);if(!m)return null;all.push(m.d)}
    for(let k=0;k<4;k++){const m=matchDigit(r.slice(i+24+k*4,i+28+k*4),[["R",L]]);if(!m)return null;all.push(m.d)}
    return checksum(all)?all.join(""):null;
  }
  /* runs: widths starting with a dark run at even indexes when firstDark */
  function decodeRuns(runs){
    for(let i=0;i<runs.length-42;i+=2){const a=tryEAN13(runs,i);if(a)return a;}
    for(let i=0;i<runs.length-42;i+=2){const a=tryEAN8(runs,i);if(a)return a;}
    return null;
  }
  function thresholds(row,w,win,mode,mn,mx){
    const thr=new Float32Array(w);
    if(mode===1){thr.fill((mn+mx)/2);return thr}
    const pre=new Float64Array(w+1);for(let x=0;x<w;x++)pre[x+1]=pre[x]+row[x];
    const h=win>>1;for(let x=0;x<w;x++){const a=Math.max(0,x-h),b=Math.min(w,x+h+1);thr[x]=(pre[b]-pre[a])/(b-a)}
    return thr;
  }
  /* kind 0: whole-pixel runs; kind 1: sub-pixel edges on a lightly smoothed line */
  function rowRuns(lum,w,y,win,mode,kind){
    const off=y*w;let row=lum.subarray(off,off+w);
    if(kind===1){const sm=new Float32Array(w);for(let x=0;x<w;x++)sm[x]=(row[Math.max(0,x-1)]+2*row[x]+row[Math.min(w-1,x+1)])/4;row=sm}
    let mn=255,mx=0;for(let x=0;x<w;x++){const v=row[x];if(v<mn)mn=v;if(v>mx)mx=v}
    if(mx-mn<40)return null;
    const thr=thresholds(row,w,win,mode,mn,mx);
    if(kind===0){
      let x=0;while(x<w&&row[x]>=thr[x])x++;if(x>=w)return null;
      const runs=[x];let cur=1,len=0;
      for(;x<w;x++){const bit=row[x]<thr[x]?1:0;if(bit===cur)len++;else{runs.push(len);cur=bit;len=1}}
      runs.push(len);return runs;
    }
    const edges=[];let dark=row[0]<thr[0];if(dark)return null;
    for(let x=0;x<w-1;x++){const d0=row[x]-thr[x],d1=row[x+1]-thr[x+1],nd=d1<0;if(nd!==dark){edges.push(x+(d0/(d0-d1||1)));dark=nd}}
    if(edges.length<20)return null;
    const runs=[edges[0]];for(let i=1;i<edges.length;i++)runs.push(edges[i]-edges[i-1]);
    runs.push(w-1-edges[edges.length-1]);return runs;
  }
  function grayscale(ctx,w,h){
    const d=ctx.getImageData(0,0,w,h).data,lum=new Uint8ClampedArray(w*h);
    for(let i=0,j=0;i<d.length;i+=4,j++)lum[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
    return lum;
  }
  /* decode a canvas; rows = how many scan lines */
  function decodeCanvas(c,rows){
    rows=rows||32;const w=c.width,h=c.height;if(w<60||h<10)return null;
    const lum=grayscale(c.getContext("2d",{willReadFrequently:true}),w,h);
    const votes={};
    const win=Math.max(16,Math.round(w/12));
    for(let k=0;k<rows;k++){
      // spread lines across the middle 80% of the height, centre first
      const t=k===0?0.5:0.5+((k%2?1:-1)*Math.ceil(k/2))/(rows+1)*0.8;
      const y=Math.min(h-1,Math.max(0,Math.round(h*t)));
      let code=null;
      const small=Math.max(8,Math.round(w/40));
      for(const[kind,mode,wn]of [[0,0,win],[2,0,win],[1,0,win],[0,1,win],[2,1,win],[1,1,win],[0,0,small]]){
        const r=rowRuns(lum,w,y,wn,mode,kind);if(!r)continue;
        const fwd=r.slice(1);                         // starts with dark
        code=decodeRuns(fwd);
        if(!code){const rev=r.slice(1).reverse();if(rev.length%2===0)rev.shift();code=decodeRuns(rev)} // upside down
        if(code)break;
      }
      if(code){votes[code]=(votes[code]||0)+1;if(votes[code]>=2)return code}
    }
    return null; // need two agreeing scan lines
  }
  window.EAN={decodeCanvas};
})();
