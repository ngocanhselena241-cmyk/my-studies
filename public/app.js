/* ==========================================================================
   Study Tracker — một file duy nhất, không cần build, không cần server.
   Dữ liệu lưu trong localStorage của trình duyệt.
   ========================================================================== */

/* ---------- 1. LƯU TRỮ ---------------------------------------------------
   Hai chế độ:
   - "cloud": đã đăng nhập, dữ liệu nằm trong D1 trên Cloudflare
   - "local": dùng thử, dữ liệu chỉ nằm trong trình duyệt này
   ------------------------------------------------------------------------ */
var KEY  = "study-tracker-v1";
var MODE = null;      // "cloud" | "local" | null (chưa đăng nhập)
var USER = null;      // {username}
var mem  = {};
var canLS = (function(){
  try{ localStorage.setItem("__t","1"); localStorage.removeItem("__t"); return true; }
  catch(e){ return false; }
})();

function lsGet(){
  try{ var r = canLS ? localStorage.getItem(KEY) : mem[KEY]; return r ? JSON.parse(r) : null; }
  catch(e){ return null; }
}
function lsSet(obj){
  try{
    var str = JSON.stringify(obj);
    if(canLS) localStorage.setItem(KEY,str); else mem[KEY]=str;
  }catch(e){ toast("Không lưu được — bộ nhớ trình duyệt đã đầy"); }
}

/* gọi API, luôn kèm cookie phiên đăng nhập */
function api(path, opts){
  opts = opts||{};
  opts.credentials = "same-origin";
  opts.headers = Object.assign({"Content-Type":"application/json"}, opts.headers||{});
  return fetch(path, opts).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(body){
      if(!r.ok){ var e = new Error(body.error||("Lỗi "+r.status)); e.status = r.status; throw e; }
      return body;
    });
  });
}

/* đồng bộ lên server, gộp nhiều thay đổi liên tiếp thành một lần ghi */
var syncTimer=null;
var syncState = {txt:"Đã lưu", cls:"done"};
function setSync(txt,cls){
  syncState = {txt:txt, cls:cls||""};
  var e=document.getElementById("syncbadge");
  if(e){ e.textContent=txt; e.className="pill "+syncState.cls; }
}
function scheduleSync(){
  clearTimeout(syncTimer);
  setSync("Đang lưu…","");
  syncTimer = setTimeout(function(){
    api("/api/data",{method:"PUT",body:JSON.stringify({state:S})})
      .then(function(){ setSync("Đã lưu","done"); })
      .catch(function(err){
        setSync("Chưa lưu được","warnp");
        if(err.status===401){ toast("Phiên đăng nhập đã hết hạn — đăng nhập lại nhé"); MODE=null; USER=null; render(); }
      });
  }, 800);
}

function save(){
  if(MODE==="local") lsSet(S);
  else if(MODE==="cloud") scheduleSync();
}

/* đảm bảo dữ liệu tải về luôn đủ các trường app cần */
function normalize(d){
  return migrate(d && typeof d === "object" ? d : blankState());
}

/* ---------- 1b. KHO ẢNH --------------------------------------------------
   Ảnh đính kèm ghi chú không nằm trong JSON học kỳ (JSON bị giới hạn 2MB),
   mà để riêng:
   - cloud: bảng images trong D1, đọc qua /api/img/<id>
   - local: IndexedDB của trình duyệt (nếu bị chặn thì giữ tạm trong RAM)
   Ghi chú chỉ giữ phần mô tả nhẹ: {id, name, mime, w, h, size}.
   ------------------------------------------------------------------------ */
var IMG_MAX_BYTES = 1500000;    // mỗi ảnh sau khi nén
var IMG_MAX_DIM   = 1600;       // cạnh dài nhất, px
var IMG_PER_NOTE  = 12;

var imgCache = {};              // id -> URL dùng được cho <img src>
var idbDB = null, idbBroken = false, imgRAM = {};

function idbOpen(){
  if(idbBroken || !window.indexedDB) return Promise.reject(new Error("no idb"));
  if(idbDB) return Promise.resolve(idbDB);
  return new Promise(function(res,rej){
    var rq;
    try{ rq = indexedDB.open("study-tracker-img",1); }
    catch(e){ idbBroken=true; rej(e); return; }
    rq.onupgradeneeded = function(){ rq.result.createObjectStore("img",{keyPath:"id"}); };
    rq.onsuccess = function(){ idbDB = rq.result; res(idbDB); };
    rq.onerror   = function(){ idbBroken=true; rej(rq.error); };
  });
}
function idbRun(mode, fn){
  return idbOpen().then(function(db){
    return new Promise(function(res,rej){
      var rq = fn(db.transaction("img",mode).objectStore("img"));
      rq.onsuccess = function(){ res(rq.result); };
      rq.onerror   = function(){ rej(rq.error); };
    });
  });
}
function localImgPut(rec){
  return idbRun("readwrite",function(st){ return st.put(rec); })
    .catch(function(){ imgRAM[rec.id]=rec; });          // riêng tư / hết chỗ: giữ tạm trong RAM
}
function localImgGet(id){
  return idbRun("readonly",function(st){ return st.get(id); })
    .catch(function(){ return null; })
    .then(function(r){ return r || imgRAM[id] || null; });
}
function localImgDel(id){
  delete imgRAM[id];
  return idbRun("readwrite",function(st){ return st.delete(id); }).catch(function(){});
}

/* nén ảnh ngay trên máy trước khi lưu — ảnh chụp màn hình thường 3–8MB */
function canvasBlob(cv,mime,q){
  return new Promise(function(res){
    try{ cv.toBlob(function(b){ res(b); }, mime, q); }
    catch(e){ res(null); }
  });
}
function loadBitmap(file){
  return new Promise(function(res,rej){
    var url = URL.createObjectURL(file), im = new Image();
    im.onload  = function(){ res({img:im,url:url}); };
    im.onerror = function(){ URL.revokeObjectURL(url); rej(new Error("Không đọc được file ảnh này")); };
    im.src = url;
  });
}
function encodeFit(cv, mime, quals, i){
  return canvasBlob(cv,mime,quals[i]).then(function(b){
    if(!b) return null;
    if(b.size<=IMG_MAX_BYTES || i>=quals.length-1) return b;
    return encodeFit(cv,mime,quals,i+1);
  });
}
function shrinkImage(file){
  /* GIF giữ nguyên, vẽ lại canvas là mất ảnh động */
  if(file.type==="image/gif"){
    return file.size<=IMG_MAX_BYTES
      ? Promise.resolve({blob:file,mime:file.type,w:0,h:0})
      : Promise.reject(new Error("Ảnh GIF quá lớn (tối đa 1.5MB)"));
  }
  return loadBitmap(file).then(function(r){
    var w = r.img.naturalWidth||r.img.width, h = r.img.naturalHeight||r.img.height;
    var fits = Math.max(w,h) <= IMG_MAX_DIM;
    /* ảnh vốn đã nhỏ và nhẹ thì giữ nguyên bản gốc cho nét */
    if(fits && file.size<=300000 && /^image\/(png|jpeg|webp)$/.test(file.type)){
      URL.revokeObjectURL(r.url);
      return {blob:file,mime:file.type,w:w,h:h};
    }
    var sc = fits ? 1 : IMG_MAX_DIM/Math.max(w,h);
    var step = function(scale){
      var cw = Math.max(1,Math.round(w*scale)), ch = Math.max(1,Math.round(h*scale));
      var cv = document.createElement("canvas");
      cv.width=cw; cv.height=ch;
      cv.getContext("2d").drawImage(r.img,0,0,cw,ch);
      return encodeFit(cv,"image/webp",[0.85,0.7,0.55],0).then(function(b){
        var mime = "image/webp";
        if(!b || b.type!=="image/webp"){                 // trình duyệt cũ không xuất được webp
          mime = "image/jpeg";
          return encodeFit(cv,"image/jpeg",[0.85,0.7,0.55],0).then(function(b2){ return {b:b2,mime:mime}; });
        }
        return {b:b,mime:mime};
      }).then(function(out){
        if(!out.b) throw new Error("Trình duyệt không nén được ảnh này");
        if(out.b.size>IMG_MAX_BYTES && scale>0.35) return step(scale*0.75);
        return {blob:out.b,mime:out.mime,w:cw,h:ch};
      });
    };
    return step(sc).then(function(out){ URL.revokeObjectURL(r.url); return out; },
                         function(err){ URL.revokeObjectURL(r.url); throw err; });
  });
}

/* thêm một ảnh vào kho, trả về phần mô tả để gắn vào ghi chú */
function imgAdd(file){
  if(!file || String(file.type).indexOf("image/")!==0)
    return Promise.reject(new Error("“"+(file&&file.name||"File")+"” không phải ảnh"));
  return shrinkImage(file).then(function(r){
    if(r.blob.size>IMG_MAX_BYTES) throw new Error("Ảnh vẫn quá lớn sau khi nén");
    return imgStore(r.blob,r.mime).then(function(id){
      imgCache[id] = URL.createObjectURL(r.blob);        // hiện ngay, khỏi tải lại từ server
      return {id:id, name:(file.name||"").slice(0,80), mime:r.mime,
              w:r.w||0, h:r.h||0, size:r.blob.size};
    });
  });
}
/* đưa bytes vào kho, trả về id */
function imgStore(blob, mime){
  if(MODE==="cloud"){
    return fetch("/api/img",{method:"POST",credentials:"same-origin",
                             headers:{"Content-Type":mime},body:blob})
      .then(function(res){
        return res.json().catch(function(){ return {}; }).then(function(b){
          if(!res.ok) throw new Error(b.error||("Không tải được ảnh lên (lỗi "+res.status+")"));
          return b.id;
        });
      });
  }
  var id = "l"+uid()+uid();
  return localImgPut({id:id,mime:mime,blob:blob,created:Date.now()}).then(function(){ return id; });
}
function imgSrc(id){
  if(imgCache[id]) return Promise.resolve(imgCache[id]);
  if(MODE==="cloud"){
    imgCache[id] = "/api/img/"+encodeURIComponent(id);
    return Promise.resolve(imgCache[id]);
  }
  return localImgGet(id).then(function(rec){
    if(!rec || !rec.blob) return null;
    imgCache[id] = URL.createObjectURL(rec.blob);
    return imgCache[id];
  }).catch(function(){ return null; });
}
/* lấy bytes để xuất file sao lưu */
function imgBlob(id){
  if(MODE==="cloud"){
    return fetch("/api/img/"+encodeURIComponent(id),{credentials:"same-origin"})
      .then(function(r){ return r.ok ? r.blob() : null; })
      .catch(function(){ return null; });
  }
  return localImgGet(id).then(function(rec){ return rec ? rec.blob : null; })
                        .catch(function(){ return null; });
}
function imgDel(id){
  if(imgCache[id] && imgCache[id].indexOf("blob:")===0) URL.revokeObjectURL(imgCache[id]);
  delete imgCache[id];
  if(MODE==="cloud") return api("/api/img/"+encodeURIComponent(id),{method:"DELETE"}).catch(function(){});
  return localImgDel(id);
}

/* HTML render ra <img data-img="id">, xong mới gắn src thật vào */
function hydrateImages(root){
  var els = (root||document).querySelectorAll("img[data-img]:not([data-img-on])");
  for(var i=0;i<els.length;i++)(function(el){
    el.setAttribute("data-img-on","1");
    var miss = function(){
      var ph = document.createElement("span");
      ph.className = "img-missing";
      ph.textContent = "Ảnh không còn trong kho";
      if(el.parentNode) el.parentNode.replaceChild(ph,el);
    };
    el.onerror = miss;
    imgSrc(el.getAttribute("data-img")).then(function(url){
      if(url) el.src = url; else miss();
    });
  })(els[i]);
}

/* mọi id ảnh đang được ghi chú dùng tới */
function allImageIds(state){
  var ids = [], i, j;
  for(i=0;i<(state.subjects||[]).length;i++){
    var ns = state.subjects[i].notes || [];
    for(j=0;j<ns.length;j++){
      var ims = ns[j].images || [];
      for(var k=0;k<ims.length;k++) if(ims[k] && ims[k].id) ids.push(ims[k].id);
    }
  }
  return ids;
}

/* gói ảnh vào file sao lưu, và bung ra khi nạp lại */
function blobToDataURL(blob){
  return new Promise(function(res){
    var fr = new FileReader();
    fr.onload  = function(){ res(String(fr.result)); };
    fr.onerror = function(){ res(null); };
    fr.readAsDataURL(blob);
  });
}
function dataURLToBlob(url){
  var m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(String(url||""));
  if(!m) return null;
  var mime = m[1], body = m[3];
  var bin = m[2] ? atob(body) : decodeURIComponent(body);
  var arr = new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr],{type:mime});
}
function collectImages(ids){
  var bundle = {};
  return ids.reduce(function(chain,id){
    return chain.then(function(){
      return imgBlob(id).then(function(b){
        if(!b) return;
        return blobToDataURL(b).then(function(u){ if(u) bundle[id] = u; });
      });
    });
  }, Promise.resolve()).then(function(){ return bundle; });
}
/* kho mới cấp id mới, nên phải viết lại id ở cả mô tả lẫn markdown trong nội dung */
function remapImageIds(state, map, dropUnmapped){
  for(var i=0;i<(state.subjects||[]).length;i++){
    var ns = state.subjects[i].notes || [];
    for(var j=0;j<ns.length;j++){
      var n = ns[j];
      var keep = [];
      for(var k=0;k<(n.images||[]).length;k++){
        var im = n.images[k];
        if(!im || !im.id) continue;
        if(map[im.id]){ im.id = map[im.id]; keep.push(im); }
        else if(!dropUnmapped) keep.push(im);      // ảnh không đổi kho thì giữ nguyên id
      }
      n.images = keep;
      if(n.body) n.body = String(n.body).replace(/\(img:([A-Za-z0-9_-]{1,64})\)/g, function(all,id){
        return map[id] ? "(img:"+map[id]+")" : all;
      });
    }
  }
}

/* nạp ảnh từ file sao lưu */
function restoreImages(state, bundle){
  var ids = Object.keys(bundle||{}), map = {};
  return ids.reduce(function(chain,old){
    return chain.then(function(){
      var b = dataURLToBlob(bundle[old]);
      if(!b) return;
      return imgStore(b, b.type||"image/webp").then(function(nid){
        map[old] = nid;
        imgCache[nid] = URL.createObjectURL(b);
      }).catch(function(){});
    });
  }, Promise.resolve()).then(function(){ remapImageIds(state, map, true); });
}

/* dữ liệu dùng thử chuyển lên tài khoản: ảnh phải rời IndexedDB để lên D1 */
function migrateLocalImages(state){
  var ids = allImageIds(state).filter(function(id){ return String(id).charAt(0)==="l"; });
  if(!ids.length || MODE!=="cloud") return Promise.resolve();
  var map = {};
  return ids.reduce(function(chain,old){
    return chain.then(function(){
      return localImgGet(old).then(function(rec){
        if(!rec || !rec.blob) return;
        return imgStore(rec.blob, rec.mime || rec.blob.type || "image/webp").then(function(nid){
          map[old] = nid;
          delete imgCache[old];
          return localImgDel(old);
        });
      }).catch(function(){});
    });
  }, Promise.resolve()).then(function(){ remapImageIds(state, map); });
}

/* ---------- 2. TIỆN ÍCH --------------------------------------------------- */
function uid(){ return Math.random().toString(36).slice(2,9); }
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s==null?"":s).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function pct(a,b){ return b>0 ? Math.round(a/b*100) : 0; }

var DAY = 86400000;
function today(){ var d=new Date(); d.setHours(0,0,0,0); return d; }
function iso(d){
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function parseD(s){
  if(!s) return null;
  var p = String(s).split("-");
  if(p.length<3) return null;
  var d = new Date(+p[0], +p[1]-1, +p[2]);
  return isNaN(d) ? null : d;
}
function addDays(d,n){ var x=new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }
var MONTHS = ["Tháng 1","Tháng 2","Tháng 3","Tháng 4","Tháng 5","Tháng 6","Tháng 7","Tháng 8","Tháng 9","Tháng 10","Tháng 11","Tháng 12"];
var MON_SHORT = ["Th1","Th2","Th3","Th4","Th5","Th6","Th7","Th8","Th9","Th10","Th11","Th12"];
var DOW = ["Thứ 2","Thứ 3","Thứ 4","Thứ 5","Thứ 6","Thứ 7","Chủ nhật"];
var DOW_SHORT = ["T2","T3","T4","T5","T6","T7","CN"];
function fmtDate(d){ return d ? d.getDate()+" "+MON_SHORT[d.getMonth()] : "—"; }
function daysLeft(dateStr){
  var d = parseD(dateStr); if(!d) return null;
  return Math.round((d.getTime()-today().getTime())/DAY);
}
function countdown(dateStr){
  var n = daysLeft(dateStr);
  if(n===null) return {txt:"—",cls:"g"};
  if(n<0)  return {txt:"Quá hạn "+(-n)+"n", cls:"x"};
  if(n===0) return {txt:"Hôm nay", cls:"x"};
  if(n===1) return {txt:"Ngày mai", cls:"r"};
  if(n<=3) return {txt:"Còn "+n+" ngày", cls:"r"};
  if(n<=7) return {txt:"Còn "+n+" ngày", cls:"y"};
  if(n<=14) return {txt:"Còn "+n+" ngày", cls:"y"};
  return {txt:"Còn "+n+" ngày", cls:"g"};
}
function fmtMins(m){
  m = Math.round(m);
  var h = Math.floor(m/60), r = m%60;
  return h>0 ? h+"h "+String(r).padStart(2,"0")+"m" : r+"m";
}
function toast(msg){
  var r = $("toast-root");
  r.innerHTML = '<div class="toast">'+esc(msg)+'</div>';
  clearTimeout(toast._t);
  toast._t = setTimeout(function(){ r.innerHTML=""; }, 2600);
}

/* ---------- 3. THANG ĐIỂM (chuẩn đại học Úc) ------------------------------ */
var BANDS = [
  {min:85,name:"High Distinction",short:"HD",v:"--hd"},
  {min:75,name:"Distinction",short:"D",v:"--d"},
  {min:65,name:"Credit",short:"CR",v:"--cr"},
  {min:50,name:"Pass",short:"P",v:"--p"},
  {min:0, name:"Fail",short:"F",v:"--f"}
];
function band(mark){
  if(mark==null||isNaN(mark)) return null;
  for(var i=0;i<BANDS.length;i++) if(mark>=BANDS[i].min) return BANDS[i];
  return BANDS[BANDS.length-1];
}
var PALETTE = ["#0e6e63","#4a4794","#a56600","#ab332a","#2c7a4d","#1f5f8b","#8a3b6b","#5c6b1e"];

var ASSESS_TYPES = ["Assignment","Quiz","Presentation","Mid-sem","Final exam","Participation","Báo cáo","Khác"];
var STATUSES = ["Chưa bắt đầu","Đang lên kế hoạch","Đang làm","Đang rà soát","Đã nộp","Đã có điểm"];
var CLASS_TYPES = ["Lecture","Tutorial","Seminar","Lab","Workshop"];

/* ---------- 4. STATE ------------------------------------------------------ */
var DEFAULT_TEMPLATE = [
  "Xem lecture",
  "Đọc lecture slides",
  "Chuẩn bị tutorial",
  "Dự tutorial",
  "Đọc tài liệu bắt buộc",
  "Ôn lại nội dung tuần"
];
function blankState(){
  return {
    semester: { name:"Semester 2 2026", weeks:13, start:"" },
    template: DEFAULT_TEMPLATE.slice(),
    subjects: [],
    sessions: [],          // {id, subjectId, date, minutes, note}
    view: {tab:"dash", subjectId:null, subTab:"overview", calMonth:null, openWeeks:{}}
  };
}
var S = blankState();
S.view.calMonth = iso(new Date(today().getFullYear(), today().getMonth(), 1));

/* vá dữ liệu cũ / thiếu field để app không bao giờ trắng màn hình */
function migrate(d){
  var b = blankState(), i;
  if(!d.semester) d.semester = b.semester;
  if(!d.template || !d.template.length) d.template = b.template;
  if(!d.subjects) d.subjects = [];
  if(!d.sessions) d.sessions = [];
  if(!d.view) d.view = b.view;
  if(!d.view.openWeeks) d.view.openWeeks = {};
  if(!d.view.subTab) d.view.subTab = "overview";
  if(!d.view.tab) d.view.tab = "dash";
  if(typeof migrateExtra === "function") migrateExtra(d);
  for(i=0;i<d.subjects.length;i++){
    var s = d.subjects[i];
    if(!s.weeks || !s.weeks.length) s.weeks = makeWeeks(d.semester.weeks||13);
    if(!s.assessments) s.assessments = [];
    if(!s.classes) s.classes = [];
    if(!s.color) s.color = PALETTE[i % PALETTE.length];
  }
  return d;
}

/* ---------- 5. TÍNH TOÁN -------------------------------------------------- */
function subj(id){ for(var i=0;i<S.subjects.length;i++) if(S.subjects[i].id===id) return S.subjects[i]; return null; }

function semStart(){ return parseD(S.semester.start); }
function weekStart(n){ var s=semStart(); return s ? addDays(s,(n-1)*7) : null; }
function currentWeek(){
  var s = semStart(); if(!s) return null;
  var n = Math.floor((today().getTime()-s.getTime())/(7*DAY))+1;
  return clamp(n,1,S.semester.weeks);
}
function weekOfDate(d){
  var s = semStart(); if(!s||!d) return null;
  var n = Math.floor((d.getTime()-s.getTime())/(7*DAY))+1;
  return (n>=1 && n<=S.semester.weeks) ? n : null;
}

/* tiến độ công việc của 1 tuần */
function weekProg(w){
  var done=0, tot=(w.tasks||[]).length;
  for(var i=0;i<tot;i++) if(w.tasks[i].done) done++;
  return {done:done, total:tot, pct:pct(done,tot)};
}
/* tiến độ 1 assessment dựa trên subtasks */
function assProg(a){
  var st = a.subtasks||[];
  if(!st.length) return {done:0,total:0,pct:(a.status==="Đã nộp"||a.status==="Đã có điểm")?100:0};
  var d=0; for(var i=0;i<st.length;i++) if(st[i].done) d++;
  return {done:d,total:st.length,pct:pct(d,st.length)};
}
/* tiến độ tổng của 1 môn = tất cả task tuần + tất cả subtask assessment */
function subjProg(s){
  var done=0, tot=0, i, j;
  for(i=0;i<s.weeks.length;i++){
    var t = s.weeks[i].tasks||[];
    for(j=0;j<t.length;j++){ tot++; if(t[j].done) done++; }
  }
  for(i=0;i<s.assessments.length;i++){
    var st = s.assessments[i].subtasks||[];
    if(st.length){ for(j=0;j<st.length;j++){ tot++; if(st[j].done) done++; } }
    else { tot++; if(s.assessments[i].status==="Đã nộp"||s.assessments[i].status==="Đã có điểm") done++; }
  }
  return {done:done,total:tot,pct:pct(done,tot)};
}
function overallProg(){
  var d=0,t=0;
  for(var i=0;i<S.subjects.length;i++){ var p=subjProg(S.subjects[i]); d+=p.done; t+=p.total; }
  return pct(d,t);
}
/* điểm hiện tại: có trọng số, chỉ tính phần đã có điểm */
function gradeInfo(s){
  var earned=0, gradedW=0, totalW=0;
  for(var i=0;i<s.assessments.length;i++){
    var a = s.assessments[i], w = +a.weight||0;
    totalW += w;
    if(a.grade!=null && a.grade!=="" && !isNaN(+a.grade)){
      earned += w*(+a.grade)/100;
      gradedW += w;
    }
  }
  return {
    earned: earned,                                  // điểm đã chắc chắn có, trên thang 100 của cả môn
    gradedWeight: gradedW,
    totalWeight: totalW,
    remainingWeight: Math.max(0, totalW-gradedW),
    current: gradedW>0 ? earned/gradedW*100 : null    // % trung bình có trọng số hiện tại
  };
}
/* cần bao nhiêu % ở phần còn lại để đạt target */
function needFor(s,target){
  var g = gradeInfo(s);
  if(g.remainingWeight<=0) return null;
  return (target-g.earned)/g.remainingWeight*100;
}
function nextAssessment(s){
  var best=null, t=today().getTime();
  for(var i=0;i<s.assessments.length;i++){
    var a=s.assessments[i];
    if(a.status==="Đã có điểm") continue;
    var d=parseD(a.due); if(!d) continue;
    if(d.getTime()>=t-DAY && (!best || d < parseD(best.due))) best=a;
  }
  return best;
}
/* tất cả deadline sắp tới, đã sắp xếp */
function allDeadlines(){
  var out=[];
  for(var i=0;i<S.subjects.length;i++){
    var s=S.subjects[i];
    for(var j=0;j<s.assessments.length;j++){
      var a=s.assessments[j];
      if(a.status==="Đã có điểm") continue;
      if(!a.due) continue;
      out.push({s:s,a:a,d:parseD(a.due)});
    }
  }
  out.sort(function(x,y){ return x.d-y.d; });
  return out;
}
/* điểm ưu tiên = độ gấp × trọng số × phần việc còn lại */
function priorities(){
  var out=[];
  for(var i=0;i<S.subjects.length;i++){
    var s=S.subjects[i];
    for(var j=0;j<s.assessments.length;j++){
      var a=s.assessments[j];
      if(a.status==="Đã có điểm"||a.status==="Đã nộp") continue;
      var n = daysLeft(a.due);
      if(n===null) continue;
      var p = assProg(a);
      var remaining = 1-(p.pct/100);
      if(remaining<=0) continue;
      var urgency = 14/Math.max(n+1,0.5);
      out.push({
        s:s, a:a, days:n,
        score: urgency*Math.max(+a.weight||1,1)*remaining,
        why: (n<0? "Quá hạn "+(-n)+" ngày" : n===0? "Đến hạn hôm nay" : "Còn "+n+" ngày")
             +" · "+(+a.weight||0)+"% · mới xong "+p.pct+"%"
      });
    }
  }
  // task của tuần hiện tại
  var cw = currentWeek();
  if(cw){
    for(var k=0;k<S.subjects.length;k++){
      var su=S.subjects[k];
      for(var m=0;m<su.weeks.length;m++){
        var w=su.weeks[m];
        if(w.n!==cw) continue;
        var wp=weekProg(w);
        if(wp.total && wp.done<wp.total){
          out.push({
            s:su, w:w, days:0,
            score: 12*(1-wp.pct/100),
            why:"Tuần "+cw+" · còn "+(wp.total-wp.done)+" việc chưa xong"
          });
        }
      }
    }
  }
  out.sort(function(a,b){ return b.score-a.score; });
  return out.slice(0,4);
}
/* thời gian học */
function studyMinutes(filter){
  var t=0;
  for(var i=0;i<S.sessions.length;i++){
    var s=S.sessions[i];
    if(filter && !filter(s)) continue;
    t+=s.minutes;
  }
  return t;
}
function mondayOf(d){
  var x=new Date(d.getTime()); var w=(x.getDay()+6)%7; return addDays(x,-w);
}

/* ---------- 6. KHUNG GIAO DIỆN -------------------------------------------- */
var TICK = '<svg viewBox="0 0 12 12"><polyline points="2,6.5 4.8,9 10,3"/></svg>';

function render(){
  if(!MODE){ renderAuth(); return; }
  var v = S.view;
  var body =
      v.tab==="dash"      ? viewDash()
    : v.tab==="subject"   ? viewSubject()
    : v.tab==="calendar"  ? viewCalendar()
    : v.tab==="exam"      ? viewExam()
    : v.tab==="assist"    ? viewAssist()
    : v.tab==="analytics" ? viewAnalytics()
    : viewSettings();
  $("root").innerHTML = '<div class="app">'+topbar()+body+'</div>';
  hydrateImages($("root"));
  wireAddRow();
}

function topbar(){
  var v=S.view, i;
  var nav = '<button data-act="go" data-tab="dash" class="'+(v.tab==="dash"?"on":"")+'">Tổng quan</button>';
  for(i=0;i<S.subjects.length;i++){
    var s=S.subjects[i];
    nav += '<button data-act="go" data-tab="subject" data-sid="'+s.id+'" class="code '+
           (v.tab==="subject"&&v.subjectId===s.id?"on":"")+'">'+esc(s.code)+'</button>';
  }
  nav += '<button data-act="go" data-tab="calendar" class="'+(v.tab==="calendar"?"on":"")+'">Lịch</button>'
       + '<button data-act="go" data-tab="exam" class="'+(v.tab==="exam"?"on":"")+'">Ôn thi</button>'
       + '<button data-act="go" data-tab="assist" class="'+(v.tab==="assist"?"on":"")+'">Trợ lý</button>'
       + '<button data-act="go" data-tab="analytics" class="'+(v.tab==="analytics"?"on":"")+'">Phân tích</button>'
       + '<button data-act="go" data-tab="settings" class="'+(v.tab==="settings"?"on":"")+'">Cài đặt</button>';

  return '<div class="topbar">'
    + '<div class="brandline">'
      + '<div class="brand">'
        + '<span class="brand-mark">Study Tracker</span>'
        + '<span class="brand-sem"><button data-act="editSem" title="Sửa học kỳ">'+esc(S.semester.name)+'</button></span>'
      + '</div>'
      + '<div class="row" style="gap:14px">'
        + accountWidget()
        + timerWidget()
        + '<div class="overall"><span class="overall-num">'+overallProg()+'%</span>'
        + '<span class="overall-lab">hoàn thành</span></div>'
      + '</div>'
    + '</div>'
    + '<div class="nav">'+nav+'</div>'
  + '</div>';
}

/* thanh xương sống của học kỳ — tuần 1 → tuần cuối, có mốc assessment */
/* only: chỉ chấm deadline của một môn. Bỏ trống thì chấm của cả học kỳ. */
function spine(only){
  if(!semStart()) return '';
  var subs = only ? [only] : S.subjects;
  var cw = currentWeek(), out='', n, i, j;
  for(n=1;n<=S.semester.weeks;n++){
    var cls = n<cw ? "past" : (n===cw ? "now" : "");
    var dots='';
    for(i=0;i<subs.length;i++){
      for(j=0;j<subs[i].assessments.length;j++){
        var a=subs[i].assessments[j];
        if(weekOfDate(parseD(a.due))===n){
          dots += '<i class="spine-dot'+((+a.weight||0)>=30?' big':'')+'" style="background:'+
                  ((+a.weight||0)>=30?'var(--urgent)':subs[i].color)+'"></i>';
        }
      }
    }
    out += '<button class="spine-wk '+cls+'" data-act="peekWeek" data-wk="'+n+'" title="Tuần '+n+'">'
         + '<div class="spine-bar"></div>'
         + '<div class="spine-dots">'+dots+'</div>'
         + '<span class="spine-n">'+n+'</span>'
         + '</button>';
  }
  return '<div class="spine"><div class="spine-track">'+out+'</div></div>';
}

function timerWidget(){
  if(S.pomo) return pomoWidget();
  if(!S.timer){
    return '<button class="btn sm" data-act="pickTimer">▶ Bắt đầu học</button>';
  }
  var s = subj(S.timer.subjectId);
  var mins = (Date.now()-S.timer.startedAt)/60000;
  return '<div class="timerbox">'
    + '<span class="timer-t timer-run">'+fmtMins(mins)+'</span>'
    + '<span class="pill acc">'+esc(s?s.code:"—")+'</span>'
    + '<button class="btn sm" data-act="stopTimer">Dừng &amp; lưu</button>'
  + '</div>';
}

/* ---------- 7. TỔNG QUAN -------------------------------------------------- */
function viewDash(){
  if(!S.subjects.length) return emptyStart();

  var out = '<div class="stack">';

  /* --- Cần làm: ưu tiên bây giờ + phần deadline còn lại, gộp một khối ---
     Trước đây tách thành "Nên làm gì bây giờ" và "Deadline sắp tới", nhưng
     cùng là một danh sách assessment nên assessment gấp nhất bị kể hai lần. */
  var pr = priorities(), used = {}, i;
  var items='';
  for(i=0;i<pr.length;i++){
    var p=pr[i];
    if(p.a) used[p.a.id]=1;
    var title = p.a ? p.a.name : ("Việc tuần "+p.w.n+" — "+(p.w.topic||"chưa đặt tên"));
    items += '<button class="focus-item" style="width:100%;text-align:left;background:none;border:0;border-bottom:1px solid rgba(255,255,255,.1);cursor:pointer" '
           + 'data-act="go" data-tab="subject" data-sid="'+p.s.id+'" data-sub="'+(p.a?"assess":"weekly")+'">'
           + '<span class="focus-rank">'+(i+1)+'</span>'
           + '<span><span class="focus-title" style="color:#fff">'+esc(title)+'</span>'
           + '<span class="focus-why">'+esc(p.s.code)+' · '+esc(p.why)+'</span></span>'
           + '</button>';
  }

  var range = S.view.dlRange||30;
  var dl = allDeadlines(), rows='';
  for(var m=0;m<dl.length;m++){
    if(used[dl[m].a.id]) continue;                 /* đã nằm trong phần ưu tiên rồi */
    var n = daysLeft(dl[m].a.due);
    if(n>range) continue;
    var c = countdown(dl[m].a.due);
    var ap = assProg(dl[m].a);
    rows += '<button class="dl" data-act="openAssess" data-sid="'+dl[m].s.id+'" data-aid="'+dl[m].a.id+'">'
      + '<span class="dl-date"><b>'+dl[m].d.getDate()+'</b>'+MON_SHORT[dl[m].d.getMonth()]+'</span>'
      + '<span class="dl-body"><span class="dl-title">'+esc(dl[m].a.name)+'</span>'
      + '<span class="dl-meta">'+esc(dl[m].s.code)+' · '+(+dl[m].a.weight||0)+'% · xong '+ap.pct+'%</span></span>'
      + '<span class="cd '+c.cls+'">'+c.txt+'</span>'
      + '</button>';
  }
  var rangeBtns='';
  [7,14,30].forEach(function(r){
    rangeBtns += '<button class="btn sm '+(range===r?"pri":"")+'" data-act="dlRange" data-n="'+r+'">'+r+' ngày</button>';
  });

  out += '<div class="card todo">'
    + (items ? '<div class="focus"><div class="eyebrow" style="margin-bottom:6px">Ưu tiên bây giờ</div>'+items+'</div>' : '')
    + '<div class="card-head"><h3>'+(items?"Deadline còn lại":"Deadline sắp tới")+'</h3>'
    + '<div class="row" style="gap:5px">'+rangeBtns+'</div></div>'
    + (rows || '<div class="card-pad muted" style="font-size:14px">'
        + (items?'Không còn deadline nào khác trong ':'Không có deadline nào trong ')+range+' ngày tới.</div>')
    + '</div>';

  /* --- Các môn đang học --- */
  out += '<div class="grid g2">';
  for(var k=0;k<S.subjects.length;k++) out += subjectCard(S.subjects[k]);
  out += '</div>';
  /* nút thêm môn để riêng một dòng mỏng — trước đây là ô to bằng thẻ môn học,
     lẻ ra hàng cuối và để trống gần một phần tư màn hình */
  out += '<button class="addrow" data-act="newSubject">+ Thêm môn học</button>';

  /* --- Tuần này + chủ đề cần ôn: hai danh sách hẹp, để cạnh nhau --- */
  var wkCard = thisWeekCard(), tpCard = dashExtras();
  if(wkCard && tpCard) out += '<div class="grid g2 top">'+wkCard+tpCard+'</div>';
  else out += wkCard + tpCard;

  out += '</div>';
  return out;
}

function subjectCard(s){
  var p = subjProg(s), g = gradeInfo(s), na = nextAssessment(s);
  var cur = g.current==null ? "—" : Math.round(g.current)+"%";
  var b = band(g.current);
  var nextTxt = na
    ? esc(na.name)+' · '+fmtDate(parseD(na.due))+' · '+(+na.weight||0)+'%'
    : 'Không còn assessment nào sắp tới';
  return '<button class="subj-card" style="--sc:'+s.color+'" data-act="go" data-tab="subject" data-sid="'+s.id+'">'
    + '<div class="spread"><div><div class="subj-code">'+esc(s.code)+'</div>'
    + '<div class="subj-name">'+esc(s.name||"")+'</div></div>'
    + (b ? '<span class="band" style="color:var('+b.v+')">'+b.short+'</span>' : '')
    + '</div>'
    + '<div class="subj-stats">'
      + '<div><div class="stat-n">'+p.pct+'%</div><div class="stat-l">Tiến độ</div></div>'
      + '<div><div class="stat-n">'+cur+'</div><div class="stat-l">Điểm hiện tại</div></div>'
      + '<div><div class="stat-n">'+p.done+'<span class="muted" style="font-size:13px">/'+p.total+'</span></div><div class="stat-l">Việc xong</div></div>'
    + '</div>'
    + '<div class="bar" style="margin-top:13px"><i style="width:'+p.pct+'%"></i></div>'
    + cardMarks(s)
    + '<div class="dl-meta" style="margin-top:10px">'+nextTxt+'</div>'
  + '</button>';
}

function thisWeekCard(){
  var cw = currentWeek();
  if(!cw) return '';
  var out='', any=false;
  for(var i=0;i<S.subjects.length;i++){
    var s=S.subjects[i], w=null;
    for(var j=0;j<s.weeks.length;j++) if(s.weeks[j].n===cw) w=s.weeks[j];
    if(!w||!(w.tasks||[]).length) continue;
    var wp=weekProg(w), items='', left=0;
    /* chỉ hiện việc chưa xong — việc đã tick nằm ở tab Theo tuần */
    for(var t=0;t<w.tasks.length;t++){
      var tk=w.tasks[t];
      if(tk.done) continue;
      left++;
      items += '<button class="check" data-act="toggleTask" data-sid="'+s.id+'" data-wk="'+cw+'" data-ti="'+t+'">'
             + '<span class="box">'+TICK+'</span><span class="check-lab">'+esc(tk.label)+'</span></button>';
    }
    if(!left) continue;
    any=true;
    out += '<div style="padding:14px 18px;border-bottom:1px solid var(--line2)">'
         + '<div class="spread" style="margin-bottom:4px"><div class="row" style="gap:8px">'
         + '<span class="pill" style="background:'+s.color+'22;color:'+s.color+';border-color:transparent">'+esc(s.code)+'</span>'
         + '<span style="font-size:13.5px;font-weight:500">'+esc(w.topic||"")+'</span></div>'
         + '<span class="mono" style="font-size:12px;color:var(--ink3)">còn '+left+'/'+wp.total+'</span></div>'
         + items + '</div>';
  }
  if(!any) return '';
  return '<div class="card"><div class="card-head"><h3>Tuần '+cw+' — còn phải làm</h3>'
       + '<button class="btn sm ghost" data-act="peekWeek" data-wk="'+cw+'">Xem cả tuần</button></div>'
       + out + '</div>';
}

/* ---------- 8. TRANG MÔN HỌC ---------------------------------------------- */
function viewSubject(){
  var s = subj(S.view.subjectId);
  if(!s){ S.view.tab="dash"; return viewDash(); }
  var st = S.view.subTab||"overview";
  var tabs = [["overview","Tổng quan"],["weekly","Theo tuần"],["assess","Assessment"],["grades","Điểm"],
              ["topics","Chủ đề"],["notes","Ghi chú"],["library","Thư viện"]];
  var nav='';
  for(var i=0;i<tabs.length;i++){
    nav += '<button data-act="subTab" data-sub="'+tabs[i][0]+'" class="'+(st===tabs[i][0]?"on":"")+'">'+tabs[i][1]+'</button>';
  }
  var body = st==="weekly" ? subWeekly(s) : st==="assess" ? subAssess(s) : st==="grades" ? subGrades(s)
           : st==="topics" ? subTopics(s) : st==="notes" ? subNotes(s)
           : st==="library" ? subLibrary(s) : subOverview(s);
  return '<div class="stack">'
    + '<div class="spread wrap" style="gap:10px">'
      + '<div><div class="row" style="gap:10px"><span style="width:9px;height:9px;border-radius:2px;background:'+s.color+';display:inline-block"></span>'
      + '<h2 style="font-size:21px;font-family:var(--mono);letter-spacing:-.02em">'+esc(s.code)+'</h2></div>'
      + '<div class="muted" style="font-size:14px;margin-top:2px">'+esc(s.name||"")+'</div></div>'
      + '<div class="row" style="gap:8px">'
        + '<button class="btn sm" data-act="startTimer" data-sid="'+s.id+'">▶ Học môn này</button>'
        + '<button class="btn sm" data-act="editSubject" data-sid="'+s.id+'">Sửa môn</button>'
      + '</div>'
    + '</div>'
    + '<div class="nav" style="border-bottom:1px solid var(--line);margin-top:-4px">'+nav+'</div>'
    + body + '</div>';
}

function subOverview(s){
  var p=subjProg(s), g=gradeInfo(s), na=nextAssessment(s), cw=currentWeek();
  var b=band(g.current);
  var classes='';
  for(var c=0;c<(s.classes||[]).length;c++){
    var cl=s.classes[c];
    classes += '<div class="spread" style="padding:8px 0;border-bottom:1px solid var(--line2)">'
      + '<span class="row" style="gap:9px"><span class="pill">'+esc(cl.type)+'</span>'
      + '<span style="font-size:13.5px">'+esc(DOW[cl.day]||"")+'</span></span>'
      + '<span class="mono" style="font-size:12.5px;color:var(--ink2)">'+esc(cl.start||"")+(cl.end?"–"+esc(cl.end):"")
      + (cl.room?' · '+esc(cl.room):'')+'</span></div>';
  }

  var stat = function(n,l,color){
    return '<div class="card card-pad"><div class="bignum"'+(color?' style="color:'+color+'"':'')+'>'+n+'</div>'
         + '<div class="stat-l" style="margin-top:6px">'+l+'</div></div>';
  };

  var mins = studyMinutes(function(x){ return x.subjectId===s.id; });

  return '<div class="stack">'
  /* Chỉ giữ ba con số dẫn tới hành động. Tuần hoàn tất trùng ý với tiến độ môn;
     điểm danh xem ở tab Theo tuần, chủ đề nắm vững xem ở tab Chủ đề. */
  + '<div class="grid g3">'
    + stat((g.current==null?"—":Math.round(g.current)+'<small>%</small>'),"Điểm hiện tại", b?'var('+b.v+')':null)
    + stat(p.pct+'<small>%</small>',"Tiến độ môn")
    + stat(fmtMins(mins).replace(/([a-z])/g,'<small>$1</small>'),"Thời gian học")
  + '</div>'
  + '<div class="grid g2">'
    + '<div class="card"><div class="card-head"><h3>Assessment tiếp theo</h3></div><div class="card-pad">'
      + (na
        ? '<div style="font-size:17px;font-weight:600">'+esc(na.name)+'</div>'
          + '<div class="row wrap" style="gap:7px;margin-top:9px">'
          + '<span class="pill vio">'+(+na.weight||0)+'%</span>'
          + '<span class="pill">'+esc(na.type||"")+'</span>'
          + '<span class="cd '+countdown(na.due).cls+'">'+countdown(na.due).txt+'</span></div>'
          + '<div class="dl-meta" style="margin-top:9px">Hạn nộp '+fmtDate(parseD(na.due))+' · '+esc(na.status)+'</div>'
          + '<div class="bar thin" style="margin-top:12px"><i style="width:'+assProg(na).pct+'%"></i></div>'
          + '<button class="btn sm" style="margin-top:13px" data-act="openAssess" data-sid="'+s.id+'" data-aid="'+na.id+'">Mở chi tiết</button>'
        : '<div class="muted" style="font-size:14px">Không còn assessment nào chưa tới hạn.</div>')
    + '</div></div>'
    + '<div class="card"><div class="card-head"><h3>Lịch học &amp; giảng viên</h3>'
      + '<button class="btn sm ghost" data-act="editSubject" data-sid="'+s.id+'">Sửa</button></div><div class="card-pad">'
      + (classes || '<div class="muted" style="font-size:14px">Chưa có lịch lecture/tutorial.</div>')
      + '<div class="dl-meta" style="margin-top:12px">'
      + (s.lecturer?'Lecturer: '+esc(s.lecturer):'')+(s.lecturer&&s.tutor?' · ':'')+(s.tutor?'Tutor: '+esc(s.tutor):'')
      + '</div></div></div>'
  + '</div>'
  + (cw ? '<div class="card"><div class="card-head"><h3>Đang ở tuần '+cw+'</h3>'
      + '<button class="btn sm" data-act="subTab" data-sub="weekly">Mở checklist tuần</button></div></div>' : '')
  + '</div>';
}

function subWeekly(s){
  var cw = currentWeek(), out='', n;
  var head = spine(s);
  if(head) head = '<div class="card card-pad" style="padding-top:2px;padding-bottom:8px">'+head+'</div>';
  for(n=0;n<s.weeks.length;n++){
    var w=s.weeks[n], wp=weekProg(w), open=!!S.view.openWeeks[s.id+"-"+w.n];
    var items='';
    for(var t=0;t<(w.tasks||[]).length;t++){
      var tk=w.tasks[t];
      items += '<div class="row" style="gap:6px">'
        + '<button class="check '+(tk.done?"on":"")+'" style="flex:1" data-act="toggleTask" data-sid="'+s.id+'" data-wk="'+w.n+'" data-ti="'+t+'">'
        + '<span class="box">'+TICK+'</span><span class="check-lab">'+esc(tk.label)+'</span></button>'
        + '<button class="btn ghost sm" data-act="delTask" data-sid="'+s.id+'" data-wk="'+w.n+'" data-ti="'+t+'" title="Xoá">×</button></div>';
    }
    out += '<div class="wk '+(w.n===cw?"cur":"")+'">'
      + '<button class="wk-head" data-act="toggleWeek" data-sid="'+s.id+'" data-wk="'+w.n+'">'
        + '<span class="wk-n">TUẦN '+w.n+'</span>'
        + '<span class="wk-topic" data-dbl="topic" data-sid="'+s.id+'" data-wk="'+w.n+'" '
        + 'title="Nhấn đúp để đổi chủ đề">'
        + (w.topic ? esc(w.topic) : '<span class="muted">Chưa đặt chủ đề</span>')+'</span>'
        + '<span class="bar wk-bar" style="--sc:'+s.color+'"><i style="width:'+wp.pct+'%"></i></span>'
        + '<span class="wk-pct">'+wp.pct+'%</span>'
      + '</button>'
      + (open ? '<div class="wk-body">'+attendRow(s,w)+items+addRow("task", s.id, w.n)
          + '<div class="row wrap" style="gap:7px;margin-top:12px">'
          + '<button class="btn sm" data-act="addTask" data-sid="'+s.id+'" data-wk="'+w.n+'">+ Thêm việc</button>'
          + '<button class="btn sm ghost" data-act="editTopic" data-sid="'+s.id+'" data-wk="'+w.n+'">Đổi chủ đề</button>'
          + '<button class="btn sm ghost" data-act="applyTpl" data-sid="'+s.id+'" data-wk="'+w.n+'">Nạp lại checklist mẫu</button>'
          + '</div></div>' : '')
    + '</div>';
  }
  return '<div>' + head
    + '<div class="spread" style="margin-bottom:12px">'
    + '<span class="eyebrow">'+s.weeks.length+' tuần · nhấn vào tuần để mở checklist</span>'
    + '<button class="btn sm ghost" data-act="go" data-tab="settings">Sửa checklist mẫu</button></div>'
    + out + '</div>';
}

function subAssess(s){
  var out='';
  for(var i=0;i<s.assessments.length;i++){
    var a=s.assessments[i], p=assProg(a), c=countdown(a.due);
    var subs='';
    for(var j=0;j<(a.subtasks||[]).length;j++){
      var t=a.subtasks[j];
      subs += '<div class="row" style="gap:6px">'
        + '<button class="check '+(t.done?"on":"")+'" style="flex:1" data-act="toggleSub" data-sid="'+s.id+'" data-aid="'+a.id+'" data-ti="'+j+'">'
        + '<span class="box">'+TICK+'</span><span class="check-lab">'+esc(t.label)+'</span></button>'
        + '<button class="btn ghost sm" data-act="delSub" data-sid="'+s.id+'" data-aid="'+a.id+'" data-ti="'+j+'">×</button></div>';
    }
    var statusOpts='';
    for(var k=0;k<STATUSES.length;k++)
      statusOpts += '<option'+(a.status===STATUSES[k]?' selected':'')+'>'+STATUSES[k]+'</option>';

    out += '<div class="card" style="margin-bottom:14px">'
      + '<div class="card-head"><div><h3>'+esc(a.name)+'</h3>'
        + '<div class="row wrap" style="gap:6px;margin-top:6px">'
        + '<span class="pill vio">'+(+a.weight||0)+'%</span>'
        + '<span class="pill">'+esc(a.type||"")+'</span>'
        + (a.due?'<span class="cd '+c.cls+'">'+c.txt+'</span>':'')
        + (a.grade!=null&&a.grade!==""?'<span class="pill done">Điểm '+a.grade+'</span>':'')
        + '</div></div>'
        + '<button class="btn sm ghost" data-act="openAssess" data-sid="'+s.id+'" data-aid="'+a.id+'">Sửa</button></div>'
      + '<div class="card-pad">'
        + '<div class="spread" style="margin-bottom:9px"><span class="eyebrow">Tiến độ '+p.done+'/'+p.total+'</span>'
        + '<span class="mono" style="font-size:12.5px">'+p.pct+'%</span></div>'
        + '<div class="bar" style="--sc:'+s.color+';margin-bottom:12px"><i style="width:'+p.pct+'%"></i></div>'
        + subs
        + addRow("sub", s.id, a.id)
        + '<div class="row wrap" style="gap:8px;margin-top:12px">'
          + '<button class="btn sm" data-act="addSub" data-sid="'+s.id+'" data-aid="'+a.id+'">+ Thêm bước</button>'
          + '<select class="btn sm" style="padding-right:8px" data-act="setStatus" data-sid="'+s.id+'" data-aid="'+a.id+'">'+statusOpts+'</select>'
        + '</div>'
      + '</div></div>';
  }
  return '<div>'+(out||'<div class="center-empty">Chưa có assessment nào. Thêm ở nút bên dưới.</div>')
    + '<button class="btn acc" style="margin-top:14px" data-act="newAssess" data-sid="'+s.id+'">+ Thêm assessment</button></div>';
}

function subGrades(s){
  var g=gradeInfo(s), rows='', i;
  for(i=0;i<s.assessments.length;i++){
    var a=s.assessments[i], w=+a.weight||0;
    var has = a.grade!=null && a.grade!=="" && !isNaN(+a.grade);
    rows += '<tr>'
      + '<td>'+esc(a.name)+'<div class="dl-meta">'+esc(a.type||"")+(a.due?' · '+fmtDate(parseD(a.due)):'')+'</div></td>'
      + '<td class="num">'+w+'%</td>'
      + '<td class="num"><input type="number" min="0" max="100" step="0.5" value="'+(has?+a.grade:"")+'" '
        + 'placeholder="—" style="width:76px;text-align:right;padding:5px 8px" data-act="setGrade" data-sid="'+s.id+'" data-aid="'+a.id+'"></td>'
      + '<td class="num">'+(has?(w*(+a.grade)/100).toFixed(1):'—')+'</td>'
      + '</tr>';
  }
  var b = band(g.current);
  var target = s.target||75;
  var need = needFor(s,target);
  var needTxt = need===null
    ? 'Tất cả assessment đã có điểm — không còn gì để tính.'
    : need<=0 ? 'Bạn đã chắc chắn đạt mức này rồi.'
    : need>100 ? 'Không còn đạt được mức này về mặt toán học (cần '+need.toFixed(1)+'%).'
    : 'Cần trung bình <b class="mono">'+need.toFixed(1)+'%</b> trên '+g.remainingWeight+'% còn lại.';

  /* what-if */
  var wi='', wiEarned=g.earned, wiTot=g.gradedWeight;
  for(i=0;i<s.assessments.length;i++){
    var aa=s.assessments[i];
    if(aa.grade!=null && aa.grade!=="" && !isNaN(+aa.grade)) continue;
    var pv = aa.predict==null?"":aa.predict;
    if(pv!==""&&!isNaN(+pv)){ wiEarned += (+aa.weight||0)*(+pv)/100; wiTot += (+aa.weight||0); }
    wi += '<div class="spread" style="padding:6px 0"><span style="font-size:13.5px">'+esc(aa.name)
       + ' <span class="muted mono" style="font-size:11.5px">'+(+aa.weight||0)+'%</span></span>'
       + '<input type="number" min="0" max="100" value="'+pv+'" placeholder="dự đoán" style="width:92px;text-align:right;padding:5px 8px" '
       + 'data-act="setPredict" data-sid="'+s.id+'" data-aid="'+aa.id+'"></div>';
  }
  var wiFinal = wiTot>0 ? wiEarned/wiTot*100 : null;
  var wb = band(wiFinal);

  return '<div class="stack">'
  + '<div class="grid g2">'
    + '<div class="card"><div class="card-head"><h3>Điểm hiện tại</h3></div><div class="card-pad">'
      + '<div class="row" style="align-items:baseline;gap:12px">'
      + '<span class="bignum"'+(b?' style="color:var('+b.v+')"':'')+'>'+(g.current==null?"—":g.current.toFixed(1)+'<small>%</small>')+'</span>'
      + (b?'<span class="band" style="color:var('+b.v+')">'+esc(b.name)+'</span>':'')+'</div>'
      + '<div class="dl-meta" style="margin-top:10px">Đã chấm '+g.gradedWeight+'% / tổng '+g.totalWeight+'% · '
      + 'đã chắc chắn có <b class="mono">'+g.earned.toFixed(1)+'</b> điểm trên thang 100 của môn</div>'
      + (g.totalWeight!==100 ? '<div class="pill warnp" style="margin-top:10px;display:inline-block">Tổng trọng số = '+g.totalWeight+'%, không phải 100%</div>':'')
    + '</div></div>'
    + '<div class="card"><div class="card-head"><h3>Cần bao nhiêu để đạt mục tiêu</h3></div><div class="card-pad">'
      + '<div class="spread"><span class="eyebrow">Mục tiêu cả môn</span>'
      + '<span class="mono" style="font-size:19px;font-weight:600">'+target+'</span></div>'
      + '<input type="range" min="50" max="95" step="1" value="'+target+'" data-act="setTarget" data-sid="'+s.id+'" style="margin:10px 0 4px">'
      + '<div class="spread mono" style="font-size:10px;color:var(--ink3);letter-spacing:.08em"><span>50 P</span><span>65 CR</span><span>75 D</span><span>85 HD</span></div>'
      + '<div style="margin-top:14px;font-size:14px;line-height:1.6">'+needTxt+'</div>'
    + '</div></div>'
  + '</div>'
  + '<div class="card"><div class="card-head"><h3>Bảng điểm</h3></div>'
    + '<table><thead><tr><th>Assessment</th><th class="num">Trọng số</th><th class="num">Điểm</th><th class="num">Đóng góp</th></tr></thead>'
    + '<tbody>'+(rows||'<tr><td colspan="4" class="muted">Chưa có assessment nào.</td></tr>')+'</tbody></table></div>'
  + '<div class="card"><div class="card-head"><h3>Thử kịch bản</h3>'
    + '<span class="eyebrow">nhập điểm dự đoán</span></div><div class="card-pad">'
    + (wi || '<div class="muted" style="font-size:14px">Tất cả assessment đã có điểm thật.</div>')
    + (wi ? '<div class="spread" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">'
      + '<span class="eyebrow">Điểm cuối kỳ dự kiến</span>'
      + '<span class="row" style="gap:10px"><span class="bignum" style="font-size:26px'+(wb?';color:var('+wb.v+')':'')+'">'
      + (wiFinal==null?"—":wiFinal.toFixed(1))+'</span>'
      + (wb?'<span class="band" style="color:var('+wb.v+')">'+wb.short+'</span>':'')+'</span></div>' : '')
  + '</div></div></div>';
}

/* Lịch và Phân tích được định nghĩa trong features.js */

/* ---------- 11. CÀI ĐẶT --------------------------------------------------- */
function viewSettings(){
  var tpl='', i;
  for(i=0;i<S.template.length;i++){
    tpl += '<div class="row" style="gap:6px;padding:4px 0">'
      + '<input type="text" value="'+esc(S.template[i])+'" data-act="setTpl" data-i="'+i+'">'
      + '<button class="btn ghost sm" data-act="delTpl" data-i="'+i+'">×</button></div>';
  }
  var subs='';
  for(i=0;i<S.subjects.length;i++){
    var s=S.subjects[i];
    subs += '<div class="spread" style="padding:10px 0;border-bottom:1px solid var(--line2)">'
      + '<span class="row" style="gap:9px"><span style="width:9px;height:9px;border-radius:2px;background:'+s.color+'"></span>'
      + '<span class="mono" style="font-size:13.5px;font-weight:500">'+esc(s.code)+'</span>'
      + '<span class="muted" style="font-size:13px">'+esc(s.name||"")+'</span></span>'
      + '<span class="row" style="gap:6px">'
      + '<button class="btn sm ghost" data-act="editSubject" data-sid="'+s.id+'">Sửa</button>'
      + '<button class="btn sm danger" data-act="delSubject" data-sid="'+s.id+'">Xoá</button></span></div>';
  }
  var acct = MODE==="cloud"
    ? '<div class="card"><div class="card-head"><h3>Tài khoản</h3></div><div class="card-pad">'
      + '<div class="spread" style="padding:6px 0"><span class="muted">Đang đăng nhập</span>'
      + '<span class="mono">'+esc(USER?USER.username:"")+'</span></div>'
      + '<div class="spread" style="padding:6px 0"><span class="muted">Dữ liệu lưu ở</span>'
      + '<span class="mono">Cloudflare D1</span></div>'
      + '<p class="muted" style="font-size:13.5px;margin:10px 0 12px">Mọi thay đổi tự lưu lên server sau chưa đầy một giây. '
      + 'Đăng nhập ở máy khác hay điện thoại đều thấy đúng dữ liệu này.</p>'
      + '<div class="row wrap" style="gap:8px">'
      + '<button class="btn" data-act="uploadLocal">Chuyển dữ liệu dùng thử lên tài khoản</button>'
      + '<button class="btn" data-act="doLogout">Đăng xuất</button></div></div></div>'
    : '<div class="card"><div class="card-head"><h3>Tài khoản</h3></div><div class="card-pad">'
      + '<p class="muted" style="font-size:13.5px;margin:0 0 12px">Bạn đang ở chế độ dùng thử — dữ liệu chỉ nằm trong trình duyệt này '
      + 'và sẽ mất nếu xoá lịch sử duyệt web. Tạo tài khoản để lưu lên server và dùng được trên nhiều thiết bị.</p>'
      + '<button class="btn acc" data-act="toAuth">Đăng nhập / tạo tài khoản</button></div></div>';

  return '<div class="stack">'
  + acct
  + settingsExtras()
  + '<div class="card"><div class="card-head"><h3>Học kỳ</h3>'
    + '<button class="btn sm" data-act="editSem">Sửa</button></div><div class="card-pad">'
    + '<div class="spread" style="padding:6px 0"><span class="muted">Tên</span><span class="mono">'+esc(S.semester.name)+'</span></div>'
    + '<div class="spread" style="padding:6px 0"><span class="muted">Số tuần</span><span class="mono">'+S.semester.weeks+'</span></div>'
    + '<div class="spread" style="padding:6px 0"><span class="muted">Thứ 2 của tuần 1</span><span class="mono">'
    + (semStart()?esc(S.semester.start):'<span style="color:var(--warn)">chưa đặt</span>')+'</span></div>'
    + '</div></div>'
  + '<div class="card"><div class="card-head"><h3>Môn học</h3>'
    + '<button class="btn sm acc" data-act="newSubject">+ Thêm môn</button></div><div class="card-pad">'
    + (subs||'<span class="muted">Chưa có môn nào.</span>')+'</div></div>'
  + '<div class="card"><div class="card-head"><h3>Checklist mẫu cho mỗi tuần</h3></div><div class="card-pad">'
    + '<p class="muted" style="font-size:13.5px;margin:0 0 10px">Mỗi tuần mới sẽ tự sinh ra các việc này.</p>'
    + tpl
    + '<button class="btn sm" style="margin-top:8px" data-act="addTpl">+ Thêm dòng</button></div></div>'
  + '<div class="card"><div class="card-head"><h3>Sao lưu dữ liệu</h3></div><div class="card-pad">'
    + '<p class="muted" style="font-size:13.5px;margin:0 0 12px">'
    + (MODE==="cloud"
       ? 'Dữ liệu đã nằm trên server, nhưng tải một file sao lưu mỗi kỳ vẫn là thói quen tốt.'
       : 'Dữ liệu chỉ nằm trong trình duyệt này. Xoá lịch sử duyệt web hoặc đổi máy là mất. Nên tải file sao lưu mỗi vài tuần.')
    + '</p>'
    + '<div class="row wrap" style="gap:8px">'
    + '<button class="btn" data-act="export">Tải file sao lưu</button>'
    + '<button class="btn" data-act="import">Nạp file sao lưu</button>'
    + '<button class="btn danger" data-act="reset">Xoá toàn bộ dữ liệu</button></div>'
    + (canLS||MODE==="cloud"?'':'<div class="pill warnp" style="margin-top:12px;display:inline-block">Trình duyệt đang chặn bộ nhớ — dữ liệu sẽ mất khi đóng tab</div>')
    + '</div></div>'
  + '</div>';
}

/* ---------- 12. HỘP THOẠI ------------------------------------------------- */
function openModal(title, body, foot){
  $("modal-root").innerHTML =
    '<div class="scrim" data-act="scrim"><div class="modal">'
    + '<div class="modal-head"><h3 style="font-size:17px">'+esc(title)+'</h3>'
    + '<button class="btn ghost sm" data-act="closeModal">✕</button></div>'
    + '<div class="modal-body">'+body+'</div>'
    + '<div class="modal-foot">'+(foot||'<button class="btn" data-act="closeModal">Đóng</button>')+'</div>'
    + '</div></div>';
  hydrateImages($("modal-root"));
}
function closeModal(){
  /* đóng hộp thoại mà chưa Lưu thì bỏ luôn ảnh vừa tải lên, tránh rác trong kho */
  if(typeof discardNoteDraft === "function") discardNoteDraft();
  $("modal-root").innerHTML = "";
}
function fld(id,label,type,val,extra){
  return '<label class="fl"><span>'+label+'</span><input id="'+id+'" type="'+type+'" value="'+esc(val==null?"":val)+'" '+(extra||"")+'></label>';
}
function sel(id,label,opts,val){
  var o='';
  for(var i=0;i<opts.length;i++) o+='<option'+(opts[i]===val?' selected':'')+'>'+esc(opts[i])+'</option>';
  return '<label class="fl"><span>'+label+'</span><select id="'+id+'">'+o+'</select></label>';
}
function val(id){ var e=$(id); return e?e.value.trim():""; }

function modalSemester(){
  openModal("Học kỳ",
    fld("f_sem","Tên học kỳ","text",S.semester.name)
    + '<div class="grid g2" style="gap:0 14px">'
    + fld("f_wks","Số tuần","number",S.semester.weeks,'min="1" max="30"')
    + fld("f_start","Thứ 2 của tuần 1","date",S.semester.start)
    + '</div>'
    + '<p class="muted" style="font-size:13px;margin:0">Ngày bắt đầu dùng để tính bạn đang ở tuần mấy và để vẽ lịch lecture/tutorial.</p>',
    '<button class="btn" data-act="closeModal">Huỷ</button><button class="btn acc" data-act="saveSem">Lưu</button>');
}

function modalSubject(id){
  var s = id ? subj(id) : null;
  var cls = (s&&s.classes)||[];
  var rows='';
  for(var i=0;i<3;i++){
    var c=cls[i]||{};
    var to='',dops='';
    for(var t=0;t<CLASS_TYPES.length;t++) to+='<option'+(c.type===CLASS_TYPES[t]?' selected':'')+'>'+CLASS_TYPES[t]+'</option>';
    for(var d=0;d<7;d++) dops+='<option value="'+d+'"'+(+c.day===d?' selected':'')+'>'+DOW[d]+'</option>';
    rows += '<div class="row" style="gap:6px;margin-bottom:7px">'
      + '<select id="c'+i+'_t" style="flex:1.1"><option value=""></option>'+to+'</select>'
      + '<select id="c'+i+'_d" style="flex:1.1">'+dops+'</select>'
      + '<input id="c'+i+'_s" type="time" value="'+esc(c.start||"")+'" style="flex:.9">'
      + '<input id="c'+i+'_r" type="text" value="'+esc(c.room||"")+'" placeholder="Phòng" style="flex:.9"></div>';
  }
  openModal(s?"Sửa môn học":"Thêm môn học",
    '<div class="grid g2" style="gap:0 14px">'
    + fld("f_code","Mã môn","text",s?s.code:"",'placeholder="CLAW2214"')
    + fld("f_name","Tên môn","text",s?s.name:"",'placeholder="Business Law"')
    + fld("f_lec","Lecturer","text",s?s.lecturer:"")
    + fld("f_tut","Tutor","text",s?s.tutor:"")
    + '</div>'
    + '<label class="fl"><span>Lịch lecture / tutorial</span></label>'+rows
    + (s?'':'<p class="muted" style="font-size:13px;margin:6px 0 0">App sẽ tự tạo tuần 1 → '+S.semester.weeks
       +' kèm checklist mẫu. Assessment thêm sau ở tab Assessment.</p>'),
    '<button class="btn" data-act="closeModal">Huỷ</button>'
    +'<button class="btn acc" data-act="saveSubject" data-sid="'+(id||"")+'">Lưu</button>');
}

function modalAssess(sid,aid){
  var s=subj(sid), a=null;
  if(aid) for(var i=0;i<s.assessments.length;i++) if(s.assessments[i].id===aid) a=s.assessments[i];
  openModal(a?"Sửa assessment":"Thêm assessment",
    fld("f_an","Tên","text",a?a.name:"",'placeholder="Group Presentation"')
    + '<div class="grid g2" style="gap:0 14px">'
    + sel("f_at","Loại",ASSESS_TYPES,a?a.type:"Assignment")
    + fld("f_aw","Trọng số (%)","number",a?a.weight:"",'min="0" max="100" step="0.5"')
    + fld("f_ad","Hạn nộp","date",a?a.due:"")
    + fld("f_ag","Điểm nhận được (nếu có)","number",a?a.grade:"",'min="0" max="100" step="0.5" placeholder="để trống nếu chưa chấm"')
    + '</div>'
    + sel("f_as","Trạng thái",STATUSES,a?a.status:STATUSES[0])
    + '<label class="fl"><span>Ghi chú</span><textarea id="f_anote" style="min-height:80px">'+esc(a?a.notes:"")+'</textarea></label>',
    (a?'<button class="btn danger" data-act="delAssess" data-sid="'+sid+'" data-aid="'+aid+'">Xoá</button>':'')
    + '<button class="btn" data-act="closeModal">Huỷ</button>'
    + '<button class="btn acc" data-act="saveAssess" data-sid="'+sid+'" data-aid="'+(aid||"")+'">Lưu</button>');
}

function modalPeekWeek(n){
  var body='', ws=weekStart(n);
  for(var i=0;i<S.subjects.length;i++){
    var s=S.subjects[i], w=null;
    for(var j=0;j<s.weeks.length;j++) if(s.weeks[j].n===n) w=s.weeks[j];
    if(!w) continue;
    var p=weekProg(w);
    body += '<button class="spread" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line2);padding:11px 0;text-align:left" '
      + 'data-act="jumpWeek" data-sid="'+s.id+'" data-wk="'+n+'">'
      + '<span><span class="mono" style="font-size:13px;font-weight:600;color:'+s.color+'">'+esc(s.code)+'</span>'
      + '<span style="display:block;font-size:13.5px;margin-top:2px">'+esc(w.topic||"Chưa đặt chủ đề")+'</span></span>'
      + '<span class="row" style="gap:10px"><span class="bar" style="width:70px;--sc:'+s.color+'"><i style="width:'+p.pct+'%"></i></span>'
      + '<span class="mono" style="font-size:12.5px;min-width:32px;text-align:right">'+p.pct+'%</span></span></button>';
  }
  openModal("Tuần "+n+(ws?" — "+fmtDate(ws):""),
    body||'<div class="muted">Chưa có môn nào.</div>');
}

function modalPickTimer(){
  var rows='';
  for(var i=0;i<S.subjects.length;i++){
    var s=S.subjects[i];
    rows += '<div class="spread pickrow">'
      + '<span class="row" style="gap:9px"><span class="dot" style="background:'+s.color+'"></span>'
      + '<span><span class="mono" style="font-weight:600">'+esc(s.code)+'</span>'
      + '<span class="dl-meta">'+esc(s.name||"")+'</span></span></span>'
      + '<span class="row" style="gap:6px">'
      + '<button class="btn sm" data-act="startTimer" data-sid="'+s.id+'">Bấm giờ tự do</button>'
      + '<button class="btn sm acc" data-act="pomoStart" data-sid="'+s.id+'">Pomodoro '+S.settings.focusMin+'′</button>'
      + '</span></div>';
  }
  openModal("Học môn nào?",
    (rows||'<div class="muted">Thêm môn học trước đã.</div>')
    + '<p class="muted" style="font-size:12.5px;margin:14px 0 0">Bấm giờ tự do chạy tới khi bạn dừng. '
    + 'Pomodoro chạy '+S.settings.focusMin+' phút tập trung rồi tự chuyển sang '+S.settings.breakMin+' phút nghỉ.</p>');
}

/* ---------- 13. THAO TÁC -------------------------------------------------- */
function makeWeeks(n){
  var w=[];
  for(var i=1;i<=n;i++) w.push({n:i,topic:"",tasks:tplTasks()});
  return w;
}
function tplTasks(){
  var t=[];
  for(var i=0;i<S.template.length;i++) if(S.template[i]) t.push({label:S.template[i],done:false});
  return t;
}
function syncWeeks(s){
  while(s.weeks.length < S.semester.weeks) s.weeks.push({n:s.weeks.length+1,topic:"",tasks:tplTasks()});
  if(s.weeks.length > S.semester.weeks) s.weeks = s.weeks.slice(0,S.semester.weeks);
}

var ACT = {
  go:function(el){
    S.view.tab = el.dataset.tab;
    if(el.dataset.sid) S.view.subjectId = el.dataset.sid;
    if(el.dataset.sub) S.view.subTab = el.dataset.sub;
    else if(el.dataset.tab==="subject" && !el.dataset.sub) S.view.subTab="overview";
    window.scrollTo(0,0);
  },
  subTab:function(el){ S.view.subTab = el.dataset.sub; },
  peekWeek:function(el){ modalPeekWeek(+el.dataset.wk); },
  jumpWeek:function(el){
    closeModal();
    S.view.tab="subject"; S.view.subjectId=el.dataset.sid; S.view.subTab="weekly";
    S.view.openWeeks[el.dataset.sid+"-"+el.dataset.wk]=true;
  },
  toggleWeek:function(el){
    var k=el.dataset.sid+"-"+el.dataset.wk;
    S.view.openWeeks[k] = !S.view.openWeeks[k];
  },
  toggleTask:function(el){
    var s=subj(el.dataset.sid);
    for(var i=0;i<s.weeks.length;i++) if(s.weeks[i].n===+el.dataset.wk){
      var t=s.weeks[i].tasks[+el.dataset.ti]; t.done=!t.done;
      if(t.done) awardXP(10,true);
    }
  },
  delTask:function(el){
    var s=subj(el.dataset.sid);
    for(var i=0;i<s.weeks.length;i++) if(s.weeks[i].n===+el.dataset.wk) s.weeks[i].tasks.splice(+el.dataset.ti,1);
  },
  addTask:function(el){
    adding = {kind:"task", sid:el.dataset.sid, wk:+el.dataset.wk};
    return "justRender";
  },
  editTopic:function(el){
    /* cùng một cách sửa với nhấn đúp lên tên tuần */
    var span = document.querySelector('.wk-topic[data-sid="'+el.dataset.sid+'"][data-wk="'+el.dataset.wk+'"]');
    if(span) startInlineTopic(span);
    return "skip";
  },
  applyTpl:function(el){
    var s=subj(el.dataset.sid);
    for(var i=0;i<s.weeks.length;i++) if(s.weeks[i].n===+el.dataset.wk){
      var have={}; for(var j=0;j<s.weeks[i].tasks.length;j++) have[s.weeks[i].tasks[j].label]=1;
      for(var k=0;k<S.template.length;k++) if(S.template[k] && !have[S.template[k]]) s.weeks[i].tasks.push({label:S.template[k],done:false});
    }
    toast("Đã nạp checklist mẫu");
  },
  toggleSub:function(el){
    var s=subj(el.dataset.sid);
    for(var i=0;i<s.assessments.length;i++) if(s.assessments[i].id===el.dataset.aid){
      var t=s.assessments[i].subtasks[+el.dataset.ti]; t.done=!t.done;
      if(t.done) awardXP(15,true);
    }
  },
  delSub:function(el){
    var s=subj(el.dataset.sid);
    for(var i=0;i<s.assessments.length;i++) if(s.assessments[i].id===el.dataset.aid)
      s.assessments[i].subtasks.splice(+el.dataset.ti,1);
  },
  addSub:function(el){
    adding = {kind:"sub", sid:el.dataset.sid, aid:el.dataset.aid};
    return "justRender";
  },
  newSubject:function(){ modalSubject(null); },
  editSubject:function(el){ modalSubject(el.dataset.sid); },
  delSubject:function(el){
    var s=subj(el.dataset.sid);
    if(!confirm("Xoá "+s.code+" cùng toàn bộ tuần, assessment và điểm?")) return;
    S.subjects = S.subjects.filter(function(x){ return x.id!==el.dataset.sid; });
    if(S.view.subjectId===el.dataset.sid){ S.view.tab="dash"; S.view.subjectId=null; }
    toast("Đã xoá môn");
  },
  saveSubject:function(el){
    var id=el.dataset.sid, s=id?subj(id):null;
    var code=val("f_code");
    if(!code){ toast("Nhập mã môn đã"); return "skip"; }
    var classes=[];
    for(var i=0;i<3;i++){
      var t=val("c"+i+"_t");
      if(t) classes.push({type:t,day:+val("c"+i+"_d")||0,start:val("c"+i+"_s"),room:val("c"+i+"_r")});
    }
    if(s){
      s.code=code; s.name=val("f_name"); s.lecturer=val("f_lec"); s.tutor=val("f_tut"); s.classes=classes;
    }else{
      S.subjects.push({
        id:uid(), code:code, name:val("f_name"), lecturer:val("f_lec"), tutor:val("f_tut"),
        color:PALETTE[S.subjects.length%PALETTE.length], classes:classes,
        weeks:makeWeeks(S.semester.weeks), assessments:[], target:75,
        topics:[], notes:[], library:[], resources:[], examList:null
      });
      toast("Đã thêm "+code);
    }
    closeModal();
  },
  editSem:function(){ modalSemester(); },
  saveSem:function(){
    S.semester.name = val("f_sem")||S.semester.name;
    S.semester.weeks = clamp(+val("f_wks")||13,1,30);
    S.semester.start = val("f_start");
    for(var i=0;i<S.subjects.length;i++) syncWeeks(S.subjects[i]);
    closeModal();
  },
  newAssess:function(el){ modalAssess(el.dataset.sid,null); },
  openAssess:function(el){ modalAssess(el.dataset.sid,el.dataset.aid); },
  saveAssess:function(el){
    var s=subj(el.dataset.sid), aid=el.dataset.aid, a=null;
    if(!val("f_an")){ toast("Nhập tên assessment đã"); return "skip"; }
    if(aid) for(var i=0;i<s.assessments.length;i++) if(s.assessments[i].id===aid) a=s.assessments[i];
    if(!a){ a={id:uid(),subtasks:[]}; s.assessments.push(a); }
    a.name=val("f_an"); a.type=val("f_at"); a.weight=+val("f_aw")||0;
    a.due=val("f_ad"); a.status=val("f_as"); a.notes=val("f_anote");
    var g=val("f_ag");
    a.grade = (g===""?null:+g);
    if(a.grade!=null && a.status!=="Đã có điểm") a.status="Đã có điểm";
    closeModal();
  },
  delAssess:function(el){
    var s=subj(el.dataset.sid);
    if(!confirm("Xoá assessment này?")) return "skip";
    s.assessments = s.assessments.filter(function(x){ return x.id!==el.dataset.aid; });
    closeModal();
  },
  calMove:function(el){
    var n=+el.dataset.n;
    if(n===0){ S.view.calMonth = iso(new Date(today().getFullYear(),today().getMonth(),1)); }
    else{ var m=parseD(S.view.calMonth); S.view.calMonth = iso(new Date(m.getFullYear(),m.getMonth()+n,1)); }
  },
  addTpl:function(){ S.template.push("Việc mới"); },
  delTpl:function(el){ S.template.splice(+el.dataset.i,1); },
  pickTimer:function(){ modalPickTimer(); },
  startTimer:function(el){
    if(S.timer && !confirm("Đang tính giờ môn khác. Dừng phiên đó và bắt đầu phiên mới?")) return "skip";
    if(S.timer) ACT.stopTimer();
    S.timer={subjectId:el.dataset.sid, startedAt:Date.now()};
    closeModal(); toast("Bắt đầu tính giờ");
  },
  stopTimer:function(){
    if(!S.timer) return;
    var mins=(Date.now()-S.timer.startedAt)/60000;
    if(mins>=0.5){
      S.sessions.push({id:uid(),subjectId:S.timer.subjectId,date:iso(today()),minutes:mins});
      logMinutes(mins); awardXP(Math.max(5,Math.round(mins/10)*5));
    }
    S.timer=null;
    toast("Đã lưu "+fmtMins(mins));
  },
  seed:function(){ seedDemo(); toast("Đã nạp dữ liệu mẫu"); },
  export:function(){
    var ids = allImageIds(S);
    if(ids.length) toast("Đang gói "+ids.length+" ảnh vào file sao lưu…");
    collectImages(ids).then(function(bundle){
      var out = JSON.parse(JSON.stringify(S));
      if(Object.keys(bundle).length) out._images = bundle;
      var blob=new Blob([JSON.stringify(out,null,2)],{type:"application/json"});
      var a=document.createElement("a");
      a.href=URL.createObjectURL(blob);
      a.download="study-tracker-"+iso(today())+".json";
      a.click();
      toast("Đã tải file sao lưu");
    });
    return "skip";
  },
  import:function(){
    var inp=document.createElement("input");
    inp.type="file"; inp.accept="application/json,.json";
    inp.onchange=function(){
      var f=inp.files[0]; if(!f) return;
      var r=new FileReader();
      r.onload=function(){
        var d;
        try{
          d=JSON.parse(r.result);
          if(!d.subjects) throw 0;
        }catch(e){ toast("File không đúng định dạng"); return; }
        var bundle = d._images || {};
        delete d._images;
        var n = Object.keys(bundle).length;
        if(n) toast("Đang khôi phục "+n+" ảnh…");
        restoreImages(d, bundle).then(function(){
          S=migrate(d);
          save(); render(); toast("Đã nạp dữ liệu");
        });
      };
      r.readAsText(f);
    };
    inp.click();
    return "skip";
  },
  reset:function(){
    if(!confirm("Xoá sạch mọi thứ và bắt đầu lại? Không khôi phục được.")) return "skip";
    allImageIds(S).forEach(imgDel);
    S=blankState();
    if(typeof migrateExtra==="function") migrateExtra(S);
    S.view.calMonth=iso(new Date(today().getFullYear(),today().getMonth(),1));
    toast("Đã xoá sạch");
  },
  closeModal:function(){ closeModal(); return "skip"; },
  scrim:function(el,ev){ if(ev.target===el){ closeModal(); } return "skip"; }
};

/* thay đổi giá trị input */
var CHG = {
  setGrade:function(el){
    var s=subj(el.dataset.sid);
    for(var i=0;i<s.assessments.length;i++) if(s.assessments[i].id===el.dataset.aid){
      var v=el.value.trim();
      s.assessments[i].grade = v===""?null:clamp(+v,0,100);
      if(v!=="") s.assessments[i].status="Đã có điểm";
    }
  },
  setPredict:function(el){
    var s=subj(el.dataset.sid);
    for(var i=0;i<s.assessments.length;i++) if(s.assessments[i].id===el.dataset.aid){
      var v=el.value.trim();
      s.assessments[i].predict = v===""?null:clamp(+v,0,100);
    }
  },
  setTarget:function(el){ subj(el.dataset.sid).target = +el.value; },
  setStatus:function(el){
    var s=subj(el.dataset.sid);
    for(var i=0;i<s.assessments.length;i++) if(s.assessments[i].id===el.dataset.aid) s.assessments[i].status=el.value;
  },
  setTpl:function(el){ S.template[+el.dataset.i] = el.value; return "noRender"; }
};

/* ---------- 13a. THÊM DÒNG NGAY TẠI CHỖ ----------------------------------
   Thay cho hộp prompt của trình duyệt: bấm "+ Thêm …" thì hiện luôn một dòng
   trống có sẵn con trỏ. Enter lưu rồi mở tiếp dòng mới, nên nhập một lúc
   nhiều mục không phải bấm đi bấm lại. Esc hoặc bỏ trống là xong.
   ------------------------------------------------------------------------ */
var adding = null;      // {kind:"sub"|"task"|"exam", sid, aid, wk}

var ADD_HINT = {
  sub:  "Bước cần làm…",
  task: "Việc cần làm…",
  exam: "Việc cần làm trước kỳ thi…"
};

/* dòng nhập, chèn vào đúng danh sách đang thêm */
function addRow(kind, sid, extra){
  if(!adding || adding.kind!==kind || adding.sid!==sid) return '';
  if(kind==="sub"  && adding.aid!==extra) return '';
  if(kind==="task" && adding.wk !==extra) return '';
  return '<div class="addline">'
    + '<span class="box ghost"></span>'
    + '<input id="add_in" type="text" autocomplete="off" placeholder="'+esc(ADD_HINT[kind])+'">'
    + '<span class="addhint mono">Enter để thêm tiếp · Esc để xong</span>'
    + '</div>';
}

function pushAddItem(label){
  if(!adding) return false;
  var s = subj(adding.sid), i;
  if(!s) return false;
  if(adding.kind==="sub"){
    for(i=0;i<s.assessments.length;i++) if(s.assessments[i].id===adding.aid){
      s.assessments[i].subtasks = s.assessments[i].subtasks||[];
      s.assessments[i].subtasks.push({label:label,done:false});
    }
  } else if(adding.kind==="task"){
    for(i=0;i<s.weeks.length;i++) if(s.weeks[i].n===adding.wk) s.weeks[i].tasks.push({label:label,done:false});
  } else if(adding.kind==="exam"){
    examChecklist(s).push({label:label,done:false});
  }
  return true;
}

/* gắn lại sau mỗi lần vẽ, vì render() dựng lại toàn bộ DOM */
function wireAddRow(){
  var inp = $("add_in");
  if(!inp || !adding) return;
  inp.focus();
  var handled = false;
  var commit = function(){
    var v = inp.value.trim();
    return v ? pushAddItem(v) : false;
  };
  inp.addEventListener("keydown", function(ev){
    ev.stopPropagation();
    if(ev.key==="Enter"){
      ev.preventDefault();
      handled = true;
      if(commit()){ save(); render(); }      /* adding còn mở → dòng trống mới */
      else { adding = null; render(); }
    } else if(ev.key==="Escape"){
      ev.preventDefault();
      handled = true;
      adding = null;
      render();
    }
  });
  inp.addEventListener("blur", function(){
    if(handled) return;                       /* Enter/Esc đã xử lý rồi */
    handled = true;
    var ok = commit();
    adding = null;
    if(ok) save();
    setTimeout(render, 0);                    /* tránh render lồng trong render */
  });
}

/* ---------- 13b. SỬA TÊN TUẦN NGAY TẠI CHỖ ------------------------------- */
var inlineEditing = false;

function startInlineTopic(span){
  if(!span || inlineEditing) return;
  var s = subj(span.dataset.sid), wk = +span.dataset.wk, w = null;
  if(!s) return;
  for(var i=0;i<s.weeks.length;i++) if(s.weeks[i].n===wk) w = s.weeks[i];
  if(!w) return;
  inlineEditing = true;

  var inp = document.createElement("input");
  inp.type = "text";
  inp.className = "wk-topic-in";
  inp.value = w.topic || "";
  inp.placeholder = "Chủ đề của tuần "+wk;
  span.innerHTML = "";
  span.appendChild(inp);
  inp.focus();
  inp.select();

  var finish = function(keep){
    if(!inlineEditing) return;
    inlineEditing = false;
    if(keep) w.topic = inp.value.trim();
    save();
    /* blur có thể nổ ngay giữa lúc render() đang thay DOM (ví dụ đang gõ dở
       mà bấm sang tab khác). Hoãn một nhịp để không gọi render lồng render. */
    setTimeout(render, 0);
  };
  inp.addEventListener("keydown", function(ev){
    ev.stopPropagation();                       /* Esc ở đây không đóng hộp thoại khác */
    if(ev.key==="Enter"){ ev.preventDefault(); finish(true); }
    else if(ev.key==="Escape"){ ev.preventDefault(); finish(false); }
  });
  inp.addEventListener("blur", function(){ finish(true); });
  /* ô nhập nằm trong nút mở/đóng tuần — chặn để bấm vào không làm gập tuần lại */
  inp.addEventListener("click", function(ev){ ev.stopPropagation(); });
}

document.addEventListener("dblclick", function(ev){
  var el = ev.target.closest ? ev.target.closest("[data-dbl]") : null;
  if(!el) return;
  ev.preventDefault();
  if(el.dataset.dbl==="topic") startInlineTopic(el);
});

document.addEventListener("click",function(ev){
  /* chỗ nào sửa được bằng nhấn đúp thì bấm một lần không làm gì,
     nếu không cú bấm đầu sẽ render lại và cú thứ hai mất chỗ bám */
  if(ev.target.closest && ev.target.closest("[data-dbl]")) return;
  var el = ev.target.closest("[data-act]");
  if(!el) return;
  if(el.tagName==="SELECT"||el.tagName==="INPUT"||el.tagName==="TEXTAREA") return;
  var fn = ACT[el.dataset.act];
  if(!fn) return;
  ev.preventDefault();
  var r = fn(el,ev);
  if(r==="justRender"){ render(); return; }   /* chỉ đổi giao diện, chưa có gì để lưu */
  if(r!=="skip"){ save(); render(); }
});
document.addEventListener("change",function(ev){
  var el = ev.target.closest("[data-act]");
  if(!el) return;
  var fn = CHG[el.dataset.act];
  if(!fn) return;
  var r = fn(el);
  save();
  if(r!=="noRender") render();
});
document.addEventListener("keydown",function(ev){ if(ev.key==="Escape") closeModal(); });

/* đồng hồ chạy trên thanh trên cùng */
setInterval(function(){
  if(!S.timer) return;
  var e=document.querySelector(".timer-t");
  if(e) e.textContent = fmtMins((Date.now()-S.timer.startedAt)/60000);
},20000);

/* ---------- 14. DỮ LIỆU MẪU ---------------------------------------------- */
function seedDemo(){
  var mon = mondayOf(today());
  var start = addDays(mon,-3*7);              // giả sử đang ở tuần 4
  S.semester = {name:"Semester 2 2026", weeks:13, start:iso(start)};
  var defs = [
    {code:"CLAW2214",name:"Business Law",topics:["Legal System","Constitution","Precedent","Statutory Interpretation","Contract Formation","Contract Terms","Negligence"],
     cls:[{type:"Lecture",day:1,start:"10:00",room:"ABS 1010"},{type:"Tutorial",day:3,start:"14:00",room:"ABS 2050"}],
     ass:[{name:"Tutorial participation",type:"Participation",w:10,due:14,g:82},
          {name:"Quiz 1",type:"Quiz",w:15,due:-4,g:85},
          {name:"Group Presentation",type:"Presentation",w:25,due:18,subs:["Chọn đề tài","Nghiên cứu án lệ","Chia việc nhóm","Làm slides","Viết speaking notes","Tập thuyết trình"]},
          {name:"Final exam",type:"Final exam",w:50,due:80}]},
    {code:"ACCT2011",name:"Financial Reporting",topics:["Conceptual Framework","Revenue","Leases","Consolidation I","Consolidation II","Intangibles","Impairment"],
     cls:[{type:"Lecture",day:0,start:"09:00",room:"CB 4030"},{type:"Tutorial",day:4,start:"11:00",room:"CB 2110"}],
     ass:[{name:"Online quizzes",type:"Quiz",w:10,due:10,g:90},
          {name:"Assignment 1",type:"Assignment",w:20,due:3,subs:["Đọc đề","Thu thập số liệu","Lập bút toán","Viết thuyết minh","Kiểm tra lại","Nộp bài"]},
          {name:"Mid-semester exam",type:"Mid-sem",w:20,due:24},
          {name:"Final exam",type:"Final exam",w:50,due:78}]},
    {code:"FINC2011",name:"Corporate Finance I",topics:["Time Value of Money","Bond Valuation","Equity Valuation","CAPM","Capital Budgeting","WACC","Capital Structure"],
     cls:[{type:"Lecture",day:2,start:"13:00",room:"EB 1040"},{type:"Tutorial",day:4,start:"15:00",room:"EB 3020"}],
     ass:[{name:"Quiz 2",type:"Quiz",w:5,due:8},
          {name:"Group report",type:"Báo cáo",w:25,due:33,subs:["Chọn công ty","Thu thập báo cáo tài chính","Tính WACC","Định giá","Viết báo cáo","Rà soát"]},
          {name:"Final exam",type:"Final exam",w:70,due:82}]}
  ];
  S.subjects = defs.map(function(d,i){
    var weeks = makeWeeks(13);
    for(var w=0;w<weeks.length;w++){
      weeks[w].topic = d.topics[w] || "";
      if(w<3) for(var t=0;t<weeks[w].tasks.length;t++) weeks[w].tasks[t].done=true;
      if(w===3) for(var t2=0;t2<Math.min(4,weeks[w].tasks.length);t2++) weeks[w].tasks[t2].done=true;
    }
    return {
      id:uid(), code:d.code, name:d.name, color:PALETTE[i%PALETTE.length],
      lecturer:"", tutor:"", classes:d.cls, target:75, weeks:weeks,
      assessments: d.ass.map(function(a){
        var subs=(a.subs||[]).map(function(l,ix){ return {label:l,done:ix< Math.floor((a.subs.length)*0.45)}; });
        return {id:uid(),name:a.name,type:a.type,weight:a.w,due:iso(addDays(today(),a.due)),
                status:a.g!=null?"Đã có điểm":(subs.length?"Đang làm":"Chưa bắt đầu"),
                grade:a.g!=null?a.g:null, subtasks:subs, notes:""};
      })
    };
  });
  /* chủ đề, ghi chú, thư viện, tài liệu cho bản demo */
  migrateExtra(S);
  var LIB = {
    "CLAW2214":[["Case","Donoghue v Stevenson","**Vấn đề:** duty of care\n\n**Nguyên tắc:** neighbour principle — phải cẩn trọng với người mà mình có thể lường trước là sẽ bị ảnh hưởng."],
                ["Case","Carlill v Carbolic Smoke Ball","Quảng cáo có thể là unilateral offer nếu đủ cụ thể và thể hiện ý định ràng buộc."],
                ["Khái niệm","Ratio decidendi","Phần lập luận pháp lý làm nên phán quyết — chỉ phần này mới có tính ràng buộc, phần obiter dicta thì không."]],
    "ACCT2011":[["Standard","AASB 10 — Consolidated Financial Statements","Xác định control: quyền lực, biến động lợi ích, khả năng dùng quyền lực tác động lợi ích."],
                ["Standard","AASB 9 — Financial Instruments","Phân loại: amortised cost, FVOCI, FVTPL."],
                ["Khái niệm","Non-controlling interest","Phần vốn chủ sở hữu của công ty con không thuộc về công ty mẹ."]],
    "FINC2011":[["Công thức","CAPM","E(Ri) = Rf + β(Rm − Rf)"],
                ["Công thức","NPV","NPV = Σ CFt / (1+r)^t − C0"],
                ["Công thức","WACC","WACC = (E/V)·Re + (D/V)·Rd·(1−Tc)"]]
  };
  var RES = [["Slides","Lecture Slides tuần này",4],["Worksheet","Tutorial Worksheet",4],
             ["Recording","Lecture Recording",4],["Link","Canvas",null],["Past exam","Đề thi năm ngoái",null]];

  S.subjects.forEach(function(s2){
    var conf=[5,4,4,3,2,0,0];
    s2.topics = [];
    for(var w=0;w<7;w++){
      var t = newTopic(s2.weeks[w].topic, w+1);
      if(w<4){
        t.learned=true; t.tutorial=true;
        t.confidence=conf[w];
        t.level = w<2?2:1;
        t.learnedAt = iso(addDays(today(), -(21-w*5)));
        t.nextReview = iso(addDays(today(), w<2? 3-w : -1));
        t.revised = w<3;
      }
      s2.topics.push(t);
    }
    (LIB[s2.code]||[]).forEach(function(L){
      s2.library.push({id:uid(), type:L[0], title:L[1], body:L[2], week:null});
    });
    RES.forEach(function(R){
      s2.resources.push({id:uid(), kind:R[0], label:R[1], url:"https://canvas.sydney.edu.au/", week:R[2]});
    });
    s2.notes.push({id:uid(), title:"Tóm tắt "+(s2.weeks[3].topic||"tuần 4"), kind:"Lecture", week:4,
      body:"## "+(s2.weeks[3].topic||"Tuần 4")+"\n\n**Ý chính**\n\n- Điểm thứ nhất cần nhớ\n- Điểm thứ hai\n\n> Ghi chú của tutor: phần này hay ra thi.\n\nCòn thắc mắc: `xem lại ví dụ cuối slide`", updated:iso(today())});
    for(var wk=0;wk<4;wk++)
      for(var c=0;c<s2.classes.length;c++)
        if(!(wk===3 && c===1)) s2.weeks[wk].attend[c]=true;
  });

  S.xp=0; S.activity={};
  for(var g=13;g>=0;g--){
    if(g===5||g===9) continue;
    S.activity[iso(addDays(today(),-g))] = {xp:20+Math.round(Math.random()*60), tasks:1+Math.round(Math.random()*3), mins:60+Math.round(Math.random()*90)};
  }
  for(var kx in S.activity) S.xp += S.activity[kx].xp;

  S.sessions=[];
  for(var d2=0;d2<26;d2++){
    for(var k=0;k<S.subjects.length;k++){
      if(Math.random()<0.45) S.sessions.push({id:uid(),subjectId:S.subjects[k].id,date:iso(addDays(today(),-d2)),minutes:30+Math.round(Math.random()*90)});
    }
  }
}

function emptyStart(){
  return '<div class="card card-pad" style="text-align:center;padding:56px 24px">'
    + '<div class="eyebrow">Bắt đầu</div>'
    + '<h2 style="font-size:24px;margin:10px 0 8px">Chưa có môn nào trong học kỳ này</h2>'
    + '<p class="muted" style="max-width:430px;margin:0 auto 22px;font-size:14px">'
    + 'Thêm môn đầu tiên — nhập mã môn, các assessment và trọng số, app sẽ tự tạo checklist cho từng tuần.</p>'
    + '<div class="row" style="justify-content:center;gap:9px;flex-wrap:wrap">'
    + '<button class="btn acc" data-act="newSubject">Thêm môn học</button>'
    + '<button class="btn" data-act="seed">Xem thử với dữ liệu mẫu</button>'
    + '</div></div>';
}


/* ---------- 15. ĐĂNG NHẬP ------------------------------------------------- */
var authTab = "login";   // "login" | "register"
var authBusy = false;
var authMsg  = "";

function renderAuth(){
  var isReg = authTab==="register";
  document.getElementById("root").innerHTML =
    '<div class="authwrap"><div class="authcard">'
    + '<div class="authbrand">'
      + '<span class="brand-mark">Study Tracker</span>'
      + '<h1 class="authtitle">Theo dõi cả học kỳ ở một chỗ</h1>'
      + '<p class="authsub">Tiến độ từng tuần, deadline, điểm số và giờ học — tự tính, tự nhắc.</p>'
    + '</div>'
    + '<div class="authtabs">'
      + '<button data-act="authTab" data-t="login" class="'+(!isReg?"on":"")+'">Đăng nhập</button>'
      + '<button data-act="authTab" data-t="register" class="'+(isReg?"on":"")+'">Tạo tài khoản</button>'
    + '</div>'
    + '<div class="authbody">'
      + '<label class="fl"><span>Tên đăng nhập</span>'
        + '<input id="au" type="text" autocomplete="username" placeholder="'+(isReg?"3–24 ký tự, chữ thường và số":"tên bạn đã đăng ký")+'"></label>'
      + '<label class="fl"><span>Mật khẩu</span>'
        + '<input id="ap" type="password" autocomplete="'+(isReg?"new-password":"current-password")+'" placeholder="'+(isReg?"ít nhất 8 ký tự":"")+'"></label>'
      + (isReg?'<label class="fl"><span>Nhập lại mật khẩu</span><input id="ap2" type="password" autocomplete="new-password"></label>':'')
      + (authMsg?'<div class="authmsg">'+esc(authMsg)+'</div>':'')
      + '<button class="btn acc" style="width:100%;padding:11px" data-act="'+(isReg?"doRegister":"doLogin")+'"'+(authBusy?' disabled':'')+'>'
      + (authBusy?"Đang xử lý…":(isReg?"Tạo tài khoản":"Đăng nhập"))+'</button>'
      + (isReg?'<p class="authnote">Đây là project cá nhân, không phải dịch vụ ngân hàng — đừng dùng lại mật khẩu quan trọng của bạn.</p>':'')
    + '</div>'
    + '<div class="authfoot">'
      + '<button class="btn ghost sm" data-act="useLocal">Dùng thử không cần tài khoản</button>'
      + '<span class="authfoot-note">dữ liệu chỉ nằm trên máy này</span>'
    + '</div>'
  + '</div></div>';
  var f = document.getElementById("au"); if(f && !authBusy) f.focus();
}

function accountWidget(){
  if(MODE==="local"){
    return '<div class="row" style="gap:7px">'
      + '<span class="pill warnp">Chế độ dùng thử</span>'
      + '<button class="btn sm" data-act="toAuth">Đăng nhập để lưu</button></div>';
  }
  return '<div class="row" style="gap:8px">'
    + '<span id="syncbadge" class="pill '+syncState.cls+'">'+esc(syncState.txt)+'</span>'
    + '<button class="btn sm ghost" data-act="doLogout" title="Đăng xuất">'+esc(USER?USER.username:"")+' ↩</button></div>';
}

function authField(id){ var e=document.getElementById(id); return e?e.value.trim():""; }

ACT.authTab = function(el){ authTab = el.dataset.t; authMsg=""; renderAuth(); return "skip"; };
ACT.toAuth  = function(){ MODE=null; authMsg=""; renderAuth(); return "skip"; };

ACT.useLocal = function(){
  MODE = "local";
  S = normalize(lsGet() || blankState());
  S.view.calMonth = S.view.calMonth || iso(new Date(today().getFullYear(), today().getMonth(), 1));
  render();
  return "skip";
};

ACT.doLogin = function(){
  var u = authField("au"), p = authField("ap");
  if(!u || !p){ authMsg = "Nhập cả tên đăng nhập và mật khẩu."; renderAuth(); return "skip"; }
  authBusy = true; authMsg=""; renderAuth();
  api("/api/login",{method:"POST",body:JSON.stringify({username:u,password:p})})
    .then(function(){ return afterAuth(); })
    .catch(function(err){
      authBusy=false;
      authMsg = err.status===401 ? "Sai tên đăng nhập hoặc mật khẩu."
              : err.status===undefined ? "Không kết nối được server. Nếu bạn đang mở file trực tiếp trên máy, hãy dùng nút “Dùng thử không cần tài khoản”."
              : err.message;
      renderAuth();
    });
  return "skip";
};

ACT.doRegister = function(){
  var u = authField("au"), p = authField("ap"), p2 = authField("ap2");
  if(p !== p2){ authMsg = "Hai ô mật khẩu chưa khớp."; renderAuth(); return "skip"; }
  if(p.length < 8){ authMsg = "Mật khẩu cần ít nhất 8 ký tự."; renderAuth(); return "skip"; }
  if(!/^[a-z0-9_.]{3,24}$/.test(u)){ authMsg = "Tên đăng nhập chỉ gồm chữ thường, số, dấu _ hoặc . và dài 3–24 ký tự."; renderAuth(); return "skip"; }
  authBusy = true; authMsg=""; renderAuth();
  api("/api/register",{method:"POST",body:JSON.stringify({username:u,password:p})})
    .then(function(){ return afterAuth(true); })
    .catch(function(err){
      authBusy=false;
      authMsg = err.status===409 ? "Tên đăng nhập này đã có người dùng."
              : err.status===undefined ? "Không kết nối được server. Nếu bạn đang mở file trực tiếp trên máy, hãy dùng nút “Dùng thử không cần tài khoản”."
              : err.message;
      renderAuth();
    });
  return "skip";
};

/* sau khi đăng nhập/đăng ký thành công: tải dữ liệu về */
function afterAuth(isNew){
  return api("/api/me").then(function(me){
    USER = me.user; MODE = "cloud"; authBusy = false;
    return api("/api/data");
  }).then(function(d){
    var local = lsGet();
    var empty = !d.state || !d.state.subjects || !d.state.subjects.length;
    if(isNew && empty && local && local.subjects && local.subjects.length
       && confirm("Tìm thấy dữ liệu bạn đã nhập ở chế độ dùng thử. Chuyển lên tài khoản này?")){
      S = normalize(local);
      migrateLocalImages(S).then(function(){ save(); render(); });
      save();
    } else {
      S = normalize(d.state);
    }
    S.view.calMonth = S.view.calMonth || iso(new Date(today().getFullYear(), today().getMonth(), 1));
    render();
  }).catch(function(){
    authBusy=false; authMsg="Đăng nhập được nhưng không tải được dữ liệu. Thử lại nhé.";
    MODE=null; renderAuth();
  });
}

ACT.doLogout = function(){
  if(syncTimer){ clearTimeout(syncTimer); }
  var done = function(){ MODE=null; USER=null; S=blankState(); authTab="login"; authMsg=""; renderAuth(); };
  api("/api/data",{method:"PUT",body:JSON.stringify({state:S})})
    .catch(function(){})
    .then(function(){ return api("/api/logout",{method:"POST"}).catch(function(){}); })
    .then(done);
  return "skip";
};

ACT.uploadLocal = function(){
  var local = lsGet();
  if(!local || !local.subjects || !local.subjects.length){ toast("Máy này không có dữ liệu dùng thử nào"); return "skip"; }
  if(!confirm("Ghi đè dữ liệu tài khoản bằng dữ liệu dùng thử trên máy này?")) return "skip";
  S = normalize(local);
  save(); render();
  migrateLocalImages(S).then(function(){ save(); render(); });
  toast("Đã chuyển lên tài khoản");
  return "skip";
};

/* ---------- 16. KHỞI ĐỘNG ------------------------------------------------- */
function boot(){
  document.getElementById("root").innerHTML =
    '<div class="authwrap"><div class="muted" style="font-family:var(--mono);font-size:13px">Đang tải…</div></div>';
  api("/api/me")
    .then(function(me){
      if(!me || !me.user) throw new Error("chưa đăng nhập");
      USER = me.user; MODE = "cloud";
      return api("/api/data").then(function(d){
        S = normalize(d.state);
        S.view.calMonth = S.view.calMonth || iso(new Date(today().getFullYear(), today().getMonth(), 1));
        render();
      });
    })
    .catch(function(){ renderAuth(); });
}

/* Enter để gửi form đăng nhập */
document.addEventListener("keydown", function(ev){
  if(ev.key!=="Enter" || MODE) return;
  var t = ev.target;
  if(t && (t.id==="au"||t.id==="ap"||t.id==="ap2")){
    ev.preventDefault();
    (authTab==="register" ? ACT.doRegister : ACT.doLogin)();
  }
});

