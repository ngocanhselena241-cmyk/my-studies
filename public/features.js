/* ============================================================================
   features.js — phần mở rộng của Study Tracker
   Nạp SAU app.js. Chứa: chủ đề & ôn tập, spaced repetition, ghi chú,
   thư viện, tài liệu, chế độ ôn thi, pomodoro, streak, trợ lý học tập,
   lịch nhiều kiểu xem và các biểu đồ phân tích bổ sung.
   ========================================================================== */

/* ---------- A. MỞ RỘNG DỮ LIỆU ------------------------------------------- */
var SRS_STEPS = [1, 2, 4, 7, 14, 30, 60];   // số ngày giữa các lần ôn
var NOTE_KINDS = ["Lecture", "Tutorial", "Case", "Câu hỏi", "Khác"];
var LIB_TYPES  = ["Case", "Công thức", "Khái niệm", "Standard"];
var RES_KINDS  = ["Slides", "Worksheet", "Recording", "Link", "Textbook", "Past exam"];
var RES_ICON   = {"Slides":"📄","Worksheet":"📝","Recording":"🎥","Link":"🔗","Textbook":"📚","Past exam":"📋"};

var EXAM_CHECKLIST = [
  "Xem lại toàn bộ lecture",
  "Làm lại tutorial questions",
  "Viết summary sheet",
  "Làm past exam 1",
  "Làm past exam 2",
  "Thi thử tính giờ",
  "Xem lại lỗi sai"
];

function migrateExtra(d){
  d.xp       = d.xp || 0;
  d.activity = d.activity || {};      // {"2026-08-20": {xp:40, tasks:3, mins:95}}
  d.pomo     = d.pomo || null;
  d.settings = d.settings || {};
  if(d.settings.gamify     === undefined) d.settings.gamify = true;
  if(d.settings.weeklyGoal === undefined) d.settings.weeklyGoal = 900;  // phút/tuần
  if(d.settings.focusMin   === undefined) d.settings.focusMin = 25;
  if(d.settings.breakMin   === undefined) d.settings.breakMin = 5;

  d.view.calView   = d.view.calView   || "month";
  d.view.calDate   = d.view.calDate   || iso(today());
  d.view.calFilter = d.view.calFilter || "";
  d.view.examSid   = d.view.examSid   || null;
  d.view.libQuery  = d.view.libQuery  || "";
  if(d.view.subTab === "resources") d.view.subTab = "library";   // hai tab đã gộp làm một
  d.view.noteId    = d.view.noteId    || null;

  for(var i=0;i<d.subjects.length;i++){
    var s = d.subjects[i];
    s.topics    = s.topics    || [];
    s.notes     = s.notes     || [];
    for(var n=0;n<s.notes.length;n++) s.notes[n].images = s.notes[n].images || [];
    s.library   = s.library   || [];
    s.resources = s.resources || [];
    s.examList  = s.examList  || null;
    for(var w=0;w<s.weeks.length;w++) s.weeks[w].attend = s.weeks[w].attend || {};
    for(var a=0;a<s.assessments.length;a++)
      if(s.assessments[a].workload == null) s.assessments[a].workload = 0;
  }
  return d;
}

/* ---------- B. CHỦ ĐỀ, ĐỘ NẮM VỮNG, SPACED REPETITION --------------------- */
function topicById(s,id){ for(var i=0;i<s.topics.length;i++) if(s.topics[i].id===id) return s.topics[i]; return null; }

function newTopic(name,week){
  return { id:uid(), name:name, week:week||null, learned:false, tutorial:false,
           revised:false, confidence:0, level:0, learnedAt:null, nextReview:null, lapses:0 };
}
/* 🔴 yếu · 🟡 tạm · 🟢 vững — dựa trên mức tự đánh giá 1–5 */
function topicLevel(t){
  if(!t.confidence) return {key:"none", label:"Chưa đánh giá", color:"var(--ink3)"};
  if(t.confidence<=2) return {key:"weak", label:"Yếu",  color:"var(--urgent)"};
  if(t.confidence===3) return {key:"ok",  label:"Tạm",  color:"var(--warn)"};
  return {key:"strong", label:"Vững", color:"var(--ok)"};
}
function topicStats(s){
  s.topics = s.topics||[];
  var n=s.topics.length, strong=0, weak=0, learned=0;
  for(var i=0;i<n;i++){
    var t=s.topics[i], L=topicLevel(t);
    if(L.key==="strong") strong++;
    if(L.key==="weak") weak++;
    if(t.learned) learned++;
  }
  return {total:n, strong:strong, weak:weak, learned:learned, mastery:pct(strong,n)};
}
/* đặt lịch ôn kế tiếp theo mức hiện tại */
function scheduleReview(t, remembered){
  if(remembered){
    t.level = Math.min(t.level+1, SRS_STEPS.length-1);
  }else{
    t.level = 0; t.lapses = (t.lapses||0)+1;
  }
  t.nextReview = iso(addDays(today(), SRS_STEPS[t.level]));
  t.revised = true;
  if(!t.learnedAt) t.learnedAt = iso(today());
}
/* mọi chủ đề tới hạn ôn hôm nay, xếp yếu trước */
function dueReviews(){
  var out=[], t0=today().getTime();
  for(var i=0;i<S.subjects.length;i++){
    var s=S.subjects[i];
    var tp = s.topics||[];
    for(var j=0;j<tp.length;j++){
      var t=tp[j];
      if(!t.nextReview || !t.learned) continue;
      var d=parseD(t.nextReview);
      if(d && d.getTime()<=t0) out.push({s:s,t:t,over:Math.round((t0-d.getTime())/DAY)});
    }
  }
  out.sort(function(a,b){ return (a.t.confidence||0)-(b.t.confidence||0) || b.over-a.over; });
  return out;
}
function weakTopics(limit){
  var out=[];
  for(var i=0;i<S.subjects.length;i++){
    var s=S.subjects[i];
    var tp2 = s.topics||[];
    for(var j=0;j<tp2.length;j++){
      var L=topicLevel(tp2[j]);
      if(L.key==="weak"||L.key==="ok") out.push({s:s,t:tp2[j],L:L});
    }
  }
  out.sort(function(a,b){ return (a.t.confidence||0)-(b.t.confidence||0); });
  return limit ? out.slice(0,limit) : out;
}
/* tạo chủ đề từ tên các tuần đã nhập, bỏ qua tuần chưa đặt tên */
function seedTopicsFromWeeks(s){
  s.topics = s.topics||[];
  var added=0;
  for(var i=0;i<s.weeks.length;i++){
    var w=s.weeks[i];
    if(!w.topic) continue;
    var dup=false;
    for(var j=0;j<s.topics.length;j++) if(s.topics[j].name===w.topic) dup=true;
    if(!dup){ s.topics.push(newTopic(w.topic, w.n)); added++; }
  }
  return added;
}

/* ---------- C. ĐIỂM DANH -------------------------------------------------- */
function attendance(s){
  var cw = currentWeek(), nCls = (s.classes||[]).length;
  if(!cw || !nCls) return null;
  var went=0, total=0;
  for(var i=0;i<s.weeks.length;i++){
    var w=s.weeks[i];
    if(w.n>cw) continue;
    for(var c=0;c<nCls;c++){ total++; if(w.attend && w.attend[c]) went++; }
  }
  return {went:went, total:total, pct:pct(went,total)};
}

/* ---------- D. XP, STREAK, CẤP ĐỘ ---------------------------------------- */
function todayLog(){
  var k = iso(today());
  if(!S.activity[k]) S.activity[k] = {xp:0, tasks:0, mins:0};
  return S.activity[k];
}
function awardXP(n, taskDone){
  if(!S.settings.gamify) return;
  var l = todayLog();
  l.xp += n; S.xp = (S.xp||0) + n;
  if(taskDone) l.tasks += 1;
}
function logMinutes(mins){
  var l = todayLog(); l.mins += mins;
}
function streak(){
  var n=0, d=today();
  var k=iso(d);
  /* nếu hôm nay chưa học thì tính chuỗi tính tới hôm qua */
  if(!S.activity[k] || !S.activity[k].xp) d = addDays(d,-1);
  while(true){
    var key=iso(d), a=S.activity[key];
    if(a && a.xp>0){ n++; d=addDays(d,-1); } else break;
    if(n>400) break;
  }
  return n;
}
function levelInfo(){
  var xp = S.xp||0, per = 300;
  return { level: Math.floor(xp/per)+1, into: xp%per, per: per, xp: xp };
}
function weekDaysActive(){
  var m = mondayOf(today()), out=[];
  for(var i=0;i<7;i++){
    var k = iso(addDays(m,i));
    out.push(!!(S.activity[k] && S.activity[k].xp>0));
  }
  return out;
}

/* ---------- E. POMODORO --------------------------------------------------- */
var pomoTick = null;
function pomoStart(sid, label){
  S.pomo = { phase:"focus", subjectId:sid, label:label||"",
             endsAt: Date.now() + S.settings.focusMin*60000, round:1 };
  pomoLoop();
}
function pomoLoop(){
  clearInterval(pomoTick);
  pomoTick = setInterval(function(){
    if(!S.pomo){ clearInterval(pomoTick); return; }
    var left = S.pomo.endsAt - Date.now();
    var e = document.getElementById("pomo-t");
    if(e) e.textContent = pomoClock(left);
    if(left <= 0) pomoAdvance();
  }, 1000);
}
function pomoClock(ms){
  if(ms<0) ms=0;
  var s = Math.round(ms/1000);
  return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
}
function pomoAdvance(){
  var p = S.pomo; if(!p) return;
  if(p.phase==="focus"){
    /* ghi nhận thời gian học vừa xong */
    S.sessions.push({id:uid(), subjectId:p.subjectId, date:iso(today()),
                     minutes:S.settings.focusMin,
                     note: p.label ? "Pomodoro · "+p.label : "Pomodoro"});
    logMinutes(S.settings.focusMin);
    awardXP(15);
    beep();
    toast("Hết "+S.settings.focusMin+" phút tập trung — nghỉ "+S.settings.breakMin+" phút");
    S.pomo = { phase:"break", subjectId:p.subjectId, label:p.label,
               endsAt: Date.now() + S.settings.breakMin*60000, round:p.round };
  }else{
    beep();
    toast("Hết giờ nghỉ — vào hiệp "+(p.round+1));
    S.pomo = { phase:"focus", subjectId:p.subjectId, label:p.label,
               endsAt: Date.now() + S.settings.focusMin*60000, round:p.round+1 };
  }
  save(); render();
}
function pomoStop(){
  clearInterval(pomoTick); pomoTick=null;
  var p = S.pomo;
  if(p && p.phase==="focus"){
    var done = S.settings.focusMin - Math.max(0,(p.endsAt-Date.now())/60000);
    if(done >= 1){
      S.sessions.push({id:uid(), subjectId:p.subjectId, date:iso(today()),
                       minutes:done,
                       note:(p.label?"Pomodoro · "+p.label:"Pomodoro")+" (dừng sớm)"});
      logMinutes(done);
      toast("Đã lưu "+fmtMins(done));
    }
  }
  S.pomo = null;
}
/* tiếng báo ngắn, không cần file âm thanh */
function beep(){
  try{
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if(!Ctx) return;
    var ctx = new Ctx(), o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 660; o.type = "sine";
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.45);
    o.start(); o.stop(ctx.currentTime+0.5);
    setTimeout(function(){ try{ ctx.close(); }catch(e){} }, 900);
  }catch(e){}
}

/* ---------- F. MARKDOWN (rút gọn, đủ dùng cho ghi chú) -------------------- */
function md(src){
  if(!src) return '<p class="muted">Chưa có nội dung.</p>';
  var lines = esc(src).replace(/\r/g,"").split("\n");
  var out=[], inList=null, inCode=false, para=[];

  function flushPara(){
    if(para.length){ out.push("<p>"+inline(para.join(" "))+"</p>"); para=[]; }
  }
  function closeList(){ if(inList){ out.push("</"+inList+">"); inList=null; } }
  function inline(t){
    return t
      /* ảnh phải xử lý trước link, nếu không luật link sẽ ăn mất phần [alt](...) */
      .replace(/!\[([^\]]*)\]\(img:([A-Za-z0-9_-]{1,64})\)/g,
               '<img class="md-img" data-img="$2" alt="$1" title="$1" data-act="lightbox">')
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g,
               '<img class="md-img" src="$2" alt="$1" title="$1" loading="lazy">')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  for(var i=0;i<lines.length;i++){
    var L = lines[i];
    if(/^```/.test(L)){
      flushPara(); closeList();
      if(inCode){ out.push("</pre>"); inCode=false; } else { out.push("<pre>"); inCode=true; }
      continue;
    }
    if(inCode){ out.push(L+"\n"); continue; }

    var h = L.match(/^(#{1,4})\s+(.*)$/);
    if(h){ flushPara(); closeList(); out.push("<h"+(h[1].length+2)+">"+inline(h[2])+"</h"+(h[1].length+2)+">"); continue; }
    if(/^\s*[-*]\s+/.test(L)){
      flushPara();
      if(inList!=="ul"){ closeList(); out.push("<ul>"); inList="ul"; }
      out.push("<li>"+inline(L.replace(/^\s*[-*]\s+/,""))+"</li>"); continue;
    }
    if(/^\s*\d+\.\s+/.test(L)){
      flushPara();
      if(inList!=="ol"){ closeList(); out.push("<ol>"); inList="ol"; }
      out.push("<li>"+inline(L.replace(/^\s*\d+\.\s+/,""))+"</li>"); continue;
    }
    if(/^&gt;\s?/.test(L)){ flushPara(); closeList(); out.push("<blockquote>"+inline(L.replace(/^&gt;\s?/,""))+"</blockquote>"); continue; }
    if(/^\s*(-{3,}|\*{3,})\s*$/.test(L)){ flushPara(); closeList(); out.push("<hr>"); continue; }
    if(/^\s*$/.test(L)){ flushPara(); closeList(); continue; }
    para.push(L);
  }
  flushPara(); closeList();
  if(inCode) out.push("</pre>");
  return out.join("\n");
}

/* ---------- G. KỲ THI ----------------------------------------------------- */
function examOf(s){
  var best=null;
  for(var i=0;i<s.assessments.length;i++){
    var a=s.assessments[i];
    if(!/exam/i.test(a.type||"") ) continue;
    if(a.status==="Đã có điểm") continue;
    if(!a.due) continue;
    if(!best || parseD(a.due) < parseD(best.due)) best=a;
  }
  return best;
}
function examChecklist(s){
  if(!s.examList){
    s.examList = EXAM_CHECKLIST.map(function(l){ return {label:l, done:false}; });
  }
  return s.examList;
}
function subjectsWithExam(){
  var out=[];
  for(var i=0;i<S.subjects.length;i++){
    var e = examOf(S.subjects[i]);
    if(e) out.push({s:S.subjects[i], a:e, days:daysLeft(e.due)});
  }
  out.sort(function(a,b){ return a.days-b.days; });
  return out;
}

/* ---------- H. TRỢ LÝ HỌC TẬP -------------------------------------------- */
/* Xếp lịch cho quỹ thời gian hôm nay dựa trên deadline, trọng số,
   phần việc còn lại, chủ đề tới hạn ôn và ngày thi. Chạy hoàn toàn
   trên máy, không gọi API bên ngoài. */
function studyPlan(totalMins){
  var items = [], i, j;

  /* 1. assessment chưa xong */
  for(i=0;i<S.subjects.length;i++){
    var s=S.subjects[i];
    for(j=0;j<s.assessments.length;j++){
      var a=s.assessments[j];
      if(a.status==="Đã nộp"||a.status==="Đã có điểm") continue;
      var n=daysLeft(a.due); if(n===null) continue;
      var p=assProg(a), remain=1-p.pct/100;
      if(remain<=0) continue;
      var urg = 14/Math.max(n+1,0.5);
      items.push({
        kind:"assessment", s:s, ref:a,
        score: urg*Math.max(+a.weight||1,1)*remain,
        title: a.name,
        why: (n<0?"quá hạn "+(-n)+" ngày":n===0?"đến hạn hôm nay":"còn "+n+" ngày")
             +" · chiếm "+(+a.weight||0)+"% · mới xong "+p.pct+"%",
        min: 30, max: 120
      });
    }
  }
  /* 2. chủ đề tới hạn ôn */
  var due = dueReviews();
  for(i=0;i<due.length && i<5;i++){
    items.push({
      kind:"review", s:due[i].s, ref:due[i].t,
      score: 26 + due[i].over*2 + (5-(due[i].t.confidence||3))*4,
      title: "Ôn: "+due[i].t.name,
      why: due[i].over>0 ? "trễ lịch ôn "+due[i].over+" ngày" : "tới lịch ôn hôm nay",
      min: 15, max: 30
    });
  }
  /* 3. chủ đề yếu khi kỳ thi tới gần */
  var exams = subjectsWithExam();
  for(i=0;i<exams.length;i++){
    if(exams[i].days>21 || exams[i].days<0) continue;
    var wk = [];
    var etp = exams[i].s.topics||[];
    for(j=0;j<etp.length;j++)
      if(topicLevel(etp[j]).key==="weak") wk.push(etp[j]);
    for(j=0;j<wk.length && j<3;j++){
      items.push({
        kind:"weak", s:exams[i].s, ref:wk[j],
        score: 40 - exams[i].days,
        title: "Củng cố: "+wk[j].name,
        why: exams[i].s.code+" thi trong "+exams[i].days+" ngày · đang đánh dấu yếu",
        min: 25, max: 45
      });
    }
  }
  /* 4. việc của tuần hiện tại */
  var cw = currentWeek();
  if(cw){
    for(i=0;i<S.subjects.length;i++){
      var su=S.subjects[i];
      for(j=0;j<su.weeks.length;j++){
        var w=su.weeks[j];
        if(w.n!==cw) continue;
        var wp=weekProg(w);
        if(wp.total && wp.done<wp.total){
          items.push({
            kind:"week", s:su, ref:w,
            score: 14*(1-wp.pct/100),
            title: "Việc tuần "+cw+(w.topic?" — "+w.topic:""),
            why: "còn "+(wp.total-wp.done)+" việc chưa xong",
            min: 20, max: 60
          });
        }
      }
    }
  }

  items.sort(function(a,b){ return b.score-a.score; });

  /* chia quỹ thời gian: ưu tiên cao được nhiều phút hơn, làm tròn 15 phút */
  var plan=[], left=totalMins;
  for(i=0;i<items.length && left>=15;i++){
    var it=items[i];
    var give = Math.min(it.max, Math.max(it.min, Math.round(left*0.45/15)*15));
    if(give>left) give=Math.floor(left/15)*15;
    if(give<15) break;
    plan.push({item:it, mins:give});
    left-=give;
  }
  return {plan:plan, leftover:left};
}

/* ---------- I. POMODORO & THẺ PHỤ TRÊN DASHBOARD -------------------------- */
function pomoWidget(){
  var p = S.pomo, s = subj(p.subjectId);
  pomoLoop();
  var isFocus = p.phase==="focus";
  return '<div class="timerbox">'
    + '<span class="pill '+(isFocus?"acc":"warnp")+'">'+(isFocus?"Tập trung":"Nghỉ")+' · hiệp '+p.round+'</span>'
    + '<span id="pomo-t" class="timer-t '+(isFocus?"timer-run":"")+'">'+pomoClock(p.endsAt-Date.now())+'</span>'
    + '<span class="pill">'+esc(s?s.code:"—")+'</span>'
    + '<button class="btn sm" data-act="pomoSkip">Bỏ qua</button>'
    + '<button class="btn sm" data-act="pomoStop">Dừng</button>'
  + '</div>';
}

/* điểm từng assignment ngay trên thẻ môn ở dashboard */
function cardMarks(s){
  var out='', any=false;
  for(var i=0;i<s.assessments.length;i++){
    var a=s.assessments[i];
    if(a.grade==null||a.grade==="") continue;
    any=true;
    var b=band(+a.grade), w=+a.weight||0;
    out += '<div class="markrow"><span class="markname">'+esc(a.name)+'</span>'
        + '<span class="mono markval" style="color:var('+b.v+')">'+(+a.grade)+'</span>'
        + '<span class="mono markw">'+(w*(+a.grade)/100).toFixed(1)+'/'+w+'</span></div>';
  }
  return any ? '<div class="marks">'+out+'</div>' : '';
}

function dashExtras(){
  /* Chủ đề cần ôn — gộp "cần ôn hôm nay" (tới hạn spaced repetition) và
     "chủ đề cần củng cố" (đang yếu) vào một khối, vì cả hai đều trả lời
     cùng một câu hỏi: hôm nay nên ôn lại cái gì. */
  var due = dueReviews(), i, seen = {}, rows='';
  for(i=0;i<due.length && i<6;i++){
    seen[due[i].t.id] = 1;
    rows += '<div class="spread" style="padding:9px 18px;border-bottom:1px solid var(--line2)">'
      + '<span><span class="mono" style="font-size:12px;color:'+due[i].s.color+'">'+esc(due[i].s.code)+'</span>'
      + '<span style="display:block;font-size:14px">'+esc(due[i].t.name)+'</span></span>'
      + '<span class="row" style="gap:7px">'
      + (due[i].over>0?'<span class="cd r">trễ '+due[i].over+'n</span>':'<span class="cd y">hôm nay</span>')
      + '<button class="btn sm" data-act="review" data-sid="'+due[i].s.id+'" data-tid="'+due[i].t.id+'" data-ok="1">Nhớ</button>'
      + '<button class="btn sm danger" data-act="review" data-sid="'+due[i].s.id+'" data-tid="'+due[i].t.id+'" data-ok="0">Quên</button>'
      + '</span></div>';
  }

  /* chủ đề đang yếu nhưng chưa tới lịch ôn — xếp bên dưới, gọn hơn */
  var wk = weakTopics(5), weakHtml='', weakN=0;
  for(i=0;i<wk.length;i++){
    if(seen[wk[i].t.id]) continue;
    weakN++;
    weakHtml += '<button class="spread weakrow" data-act="go" data-tab="subject" data-sid="'+wk[i].s.id+'" data-sub="topics">'
      + '<span class="row" style="gap:8px"><span class="dot" style="background:'+wk[i].L.color+'"></span>'
      + '<span style="font-size:13.5px">'+esc(wk[i].t.name)+'</span></span>'
      + '<span class="mono" style="font-size:11px;color:var(--ink3)">'+esc(wk[i].s.code)+'</span></button>';
  }

  if(!rows && !weakN) return '';
  return '<div class="card"><div class="card-head"><h3>Chủ đề cần ôn</h3>'
    + '<span class="eyebrow">'+(due.length?due.length+' tới hạn':'')
    + (due.length&&weakN?' · ':'')+(weakN?weakN+' đang yếu':'')+'</span></div>'
    + rows
    + (weakN?'<div class="card-pad">'
        + (rows?'<div class="eyebrow" style="margin-bottom:4px">Đang yếu, chưa tới lịch ôn</div>':'')
        + weakHtml+'</div>':'')
    + '</div>';
}

/* chuỗi ngày học + XP — trước ở dashboard, giờ nằm trong tab Phân tích */
function streakCard(){
  if(!S.settings.gamify) return '';
  var st=streak(), lv=levelInfo(), days=weekDaysActive(), dots='';
  for(var k=0;k<7;k++) dots += '<span class="daydot '+(days[k]?"on":"")+'">'+DOW_SHORT[k]+'</span>';
  return '<div class="card"><div class="card-head"><h3>Chuỗi ngày học</h3>'
    + '<span class="pill acc">Cấp '+lv.level+'</span></div><div class="card-pad">'
    + '<div class="row" style="align-items:baseline;gap:10px">'
    + '<span class="bignum">'+st+'</span><span class="muted" style="font-size:14px">ngày liên tiếp</span></div>'
    + '<div class="daydots">'+dots+'</div>'
    + '<div class="spread" style="margin-top:14px"><span class="eyebrow">'+lv.xp+' XP</span>'
    + '<span class="mono" style="font-size:11px;color:var(--ink3)">còn '+(lv.per-lv.into)+' XP lên cấp '+(lv.level+1)+'</span></div>'
    + '<div class="bar thin" style="margin-top:6px"><i style="width:'+pct(lv.into,lv.per)+'%"></i></div>'
    + '</div></div>';
}

/* hàng điểm danh trong mỗi tuần */
function attendRow(s,w){
  w.attend = w.attend||{};
  if(!(s.classes||[]).length) return '';
  var chips='';
  for(var c=0;c<s.classes.length;c++){
    var on = w.attend && w.attend[c];
    chips += '<button class="chip '+(on?"on":"")+'" data-act="attend" data-sid="'+s.id+'" data-wk="'+w.n+'" data-c="'+c+'">'
           + (on?"✓ ":"")+'Có mặt '+esc(s.classes[c].type)+'</button>';
  }
  return '<div class="row wrap" style="gap:6px;padding:8px 0 4px">'+chips+'</div>';
}

/* ---------- J. TAB CHỦ ĐỀ (revision + weak topic + spaced repetition) ----- */
function subTopics(s){
  s.topics = s.topics||[];
  var rows='', i;
  for(i=0;i<s.topics.length;i++){
    var t=s.topics[i], L=topicLevel(t);
    var stars='';
    for(var c=1;c<=5;c++){
      stars += '<button class="star '+((t.confidence||0)>=c?"on":"")+'" data-act="setConf" '
             + 'data-sid="'+s.id+'" data-tid="'+t.id+'" data-c="'+c+'" title="Mức '+c+'">★</button>';
    }
    var nr = t.nextReview ? parseD(t.nextReview) : null;
    var nrTxt = !t.learned ? "chưa học"
      : !nr ? "chưa đặt lịch ôn"
      : (daysLeft(t.nextReview)<=0 ? "cần ôn ngay" : "ôn lại "+fmtDate(nr));

    rows += '<div class="topicrow">'
      + '<div class="spread" style="gap:10px">'
        + '<div class="row" style="gap:9px;min-width:0">'
          + '<span class="dot" style="background:'+L.color+'"></span>'
          + '<div style="min-width:0"><div class="topicname">'+esc(t.name)+'</div>'
          + '<div class="dl-meta">'+(t.week?"Tuần "+t.week+" · ":"")+nrTxt+(t.lapses?" · quên "+t.lapses+" lần":"")+'</div></div>'
        + '</div>'
        + '<div class="row" style="gap:4px">'+stars
          + '<button class="btn ghost sm" data-act="delTopic" data-sid="'+s.id+'" data-tid="'+t.id+'">×</button></div>'
      + '</div>'
      + '<div class="row wrap" style="gap:6px;margin-top:9px">'
        + flag(s.id,t,"learned","Đã học")
        + flag(s.id,t,"tutorial","Đã làm tutorial")
        + flag(s.id,t,"revised","Đã ôn")
        + (t.learned
            ? '<span style="flex:1"></span>'
              + '<button class="btn sm" data-act="review" data-sid="'+s.id+'" data-tid="'+t.id+'" data-ok="1">Nhớ rõ</button>'
              + '<button class="btn sm danger" data-act="review" data-sid="'+s.id+'" data-tid="'+t.id+'" data-ok="0">Chưa nhớ</button>'
            : '')
      + '</div></div>';
  }
  var st = topicStats(s);
  return '<div class="stack">'
    + '<div class="grid g4">'
      + statCard(st.total,"Tổng chủ đề")
      + statCard(st.learned+'<small>/'+st.total+'</small>',"Đã học")
      + statCard(st.mastery+'<small>%</small>',"Nắm vững")
      + statCard(st.weak,"Đang yếu")
    + '</div>'
    + '<div class="card"><div class="card-head"><h3>Chủ đề</h3>'
      + '<div class="row" style="gap:7px">'
      + '<button class="btn sm" data-act="seedTopics" data-sid="'+s.id+'">Tạo từ tên tuần</button>'
      + '<button class="btn sm acc" data-act="newTopic" data-sid="'+s.id+'">+ Thêm</button></div></div>'
      + (rows ? '<div class="card-pad">'+rows+'</div>'
              : '<div class="card-pad muted" style="font-size:14px">Chưa có chủ đề nào. '
                +'Nếu bạn đã đặt tên cho các tuần ở tab Theo tuần, bấm “Tạo từ tên tuần” là xong.</div>')
    + '</div>'
    + '<div class="card card-pad"><div class="eyebrow">Cách chấm mức nhớ</div>'
    + '<p class="muted" style="font-size:13px;line-height:1.6;margin:8px 0 0">'
    + '1–2 sao là chưa hiểu, 3 sao là hiểu nhưng chưa chắc, 4–5 sao là giải thích được mà không cần nhìn tài liệu. '
    + 'Bấm “Nhớ rõ” thì lần ôn kế tiếp giãn ra xa hơn ('+SRS_STEPS.join(", ")+' ngày). Bấm “Chưa nhớ” thì kéo về ôn lại sau 1 ngày.</p></div>'
    + '</div>';
}
function flag(sid,t,key,label){
  return '<button class="chip '+(t[key]?"on":"")+'" data-act="topicFlag" data-sid="'+sid+'" data-tid="'+t.id+'" data-k="'+key+'">'
       + (t[key]?"✓ ":"")+label+'</button>';
}
function statCard(n,l){
  return '<div class="card card-pad"><div class="bignum">'+n+'</div><div class="stat-l" style="margin-top:6px">'+l+'</div></div>';
}

/* ---------- K. TAB GHI CHÚ ------------------------------------------------ */
function subNotes(s){
  s.notes = s.notes||[];
  var list='', i;
  var sorted = s.notes.slice().sort(function(a,b){ return (b.week||0)-(a.week||0); });
  for(i=0;i<sorted.length;i++){
    var n=sorted[i];
    list += '<button class="notecard '+(S.view.noteId===n.id?"on":"")+'" data-act="openNote" data-nid="'+n.id+'">'
      + '<span class="row" style="gap:7px;margin-bottom:3px"><span class="pill">'+esc(n.kind||"Khác")+'</span>'
      + (n.week?'<span class="mono" style="font-size:10.5px;color:var(--ink3)">Tuần '+n.week+'</span>':'')
      + ((n.images&&n.images.length)?'<span class="mono" style="font-size:10.5px;color:var(--ink3)">'+n.images.length+' ảnh</span>':'')
      + '</span>'
      + '<span class="notetitle">'+esc(n.title||"Không tên")+'</span></button>';
  }
  var cur = null;
  for(i=0;i<s.notes.length;i++) if(s.notes[i].id===S.view.noteId) cur=s.notes[i];

  var pane = cur
    ? '<div class="card"><div class="card-head"><div><h3>'+esc(cur.title||"Không tên")+'</h3>'
      + '<div class="dl-meta">'+esc(cur.kind||"")+(cur.week?" · Tuần "+cur.week:"")+'</div></div>'
      + '<div class="row" style="gap:6px">'
      + '<button class="btn sm" data-act="editNote" data-sid="'+s.id+'" data-nid="'+cur.id+'">Sửa</button>'
      + '<button class="btn sm danger" data-act="delNote" data-sid="'+s.id+'" data-nid="'+cur.id+'">Xoá</button></div></div>'
      + '<div class="card-pad md">'+md(cur.body)+noteGallery(cur)+'</div></div>'
    : '<div class="center-empty">Chọn một ghi chú bên trái, hoặc tạo ghi chú mới.</div>';

  return '<div class="split">'
    + '<div class="split-side">'
      + '<button class="btn acc" style="width:100%;margin-bottom:10px" data-act="newNote" data-sid="'+s.id+'">+ Ghi chú mới</button>'
      + (list || '<div class="muted" style="font-size:13px;padding:6px 2px">Chưa có ghi chú nào.</div>')
    + '</div>'
    + '<div class="split-main">'+pane+'</div>'
  + '</div>';
}

/* ---------- L. TAB THƯ VIỆN (case / công thức / khái niệm) ---------------- */
function subLibrary(s){
  s.library = s.library||[];
  var q = (S.view.libQuery||"").toLowerCase();
  var groups = {}, i;
  for(i=0;i<s.library.length;i++){
    var it=s.library[i];
    if(q && (it.title+" "+(it.body||"")).toLowerCase().indexOf(q)<0) continue;
    (groups[it.type] = groups[it.type] || []).push(it);
  }
  var out='';
  for(i=0;i<LIB_TYPES.length;i++){
    var type=LIB_TYPES[i], items=groups[type];
    if(!items || !items.length) continue;
    var rows='';
    for(var j=0;j<items.length;j++){
      var it2=items[j];
      var isFormula = type==="Công thức";
      rows += '<div class="libitem">'
        + '<div class="spread"><div class="libtitle">'+esc(it2.title)+'</div>'
        + '<div class="row" style="gap:5px">'
        + (it2.week?'<span class="pill">Tuần '+it2.week+'</span>':'')
        + '<button class="btn ghost sm" data-act="editLib" data-sid="'+s.id+'" data-lid="'+it2.id+'">Sửa</button>'
        + '<button class="btn ghost sm" data-act="delLib" data-sid="'+s.id+'" data-lid="'+it2.id+'">×</button></div></div>'
        + (it2.body ? '<div class="'+(isFormula?"formula":"libbody md")+'">'
            +(isFormula?esc(it2.body):md(it2.body))+'</div>' : '')
        + '</div>';
    }
    out += '<div class="card" style="margin-bottom:14px"><div class="card-head"><h3>'+esc(type)+'</h3>'
        + '<span class="eyebrow">'+items.length+'</span></div><div class="card-pad">'+rows+'</div></div>';
  }
  /* Tài liệu (link Canvas, slides, recording…) trước đây là một tab riêng.
     Cùng là kho tra cứu của môn nên gộp xuống dưới thư viện. */
  return '<div>'
    + '<div class="spread wrap" style="margin-bottom:14px;gap:9px">'
      + '<input type="text" placeholder="Tìm trong thư viện…" value="'+esc(S.view.libQuery||"")+'" '
      + 'data-act="libSearch" style="max-width:300px">'
      + '<button class="btn acc" data-act="newLib" data-sid="'+s.id+'">+ Thêm mục</button>'
    + '</div>'
    + (out || '<div class="center-empty">'+(q?"Không tìm thấy mục nào.":"Chưa có mục nào. Lưu case, công thức, khái niệm hay standard vào đây để tra nhanh trước kỳ thi.")+'</div>')
    + '<div class="spread wrap" style="margin:26px 0 14px;gap:9px;border-top:1px solid var(--line);padding-top:20px">'
      + '<span class="eyebrow">Tài liệu &amp; link · '+(s.resources||[]).length+'</span>'
      + '<button class="btn" data-act="newRes" data-sid="'+s.id+'">+ Thêm tài liệu</button></div>'
    + subResources(s)
  + '</div>';
}

/* ---------- M. TAB TÀI LIỆU ---------------------------------------------- */
function subResources(s){
  s.resources = s.resources||[];
  var byWeek = {}, none=[], i;
  for(i=0;i<s.resources.length;i++){
    var r=s.resources[i];
    if(r.week) (byWeek[r.week]=byWeek[r.week]||[]).push(r); else none.push(r);
  }
  function row(r){
    var open = r.url ? '<a class="resopen" href="'+esc(r.url)+'" target="_blank" rel="noopener">Mở ↗</a>' : '';
    return '<div class="spread resrow">'
      + '<span class="row" style="gap:9px;min-width:0"><span class="resicon">'+(RES_ICON[r.kind]||"📄")+'</span>'
      + '<span style="min-width:0"><span class="resname">'+esc(r.label)+'</span>'
      + '<span class="dl-meta">'+esc(r.kind||"")+'</span></span></span>'
      + '<span class="row" style="gap:6px">'+open
      + '<button class="btn ghost sm" data-act="editRes" data-sid="'+s.id+'" data-rid="'+r.id+'">Sửa</button>'
      + '<button class="btn ghost sm" data-act="delRes" data-sid="'+s.id+'" data-rid="'+r.id+'">×</button></span></div>';
  }
  var out='', keys=Object.keys(byWeek).sort(function(a,b){ return a-b; });
  for(i=0;i<keys.length;i++){
    var rows='';
    for(var j=0;j<byWeek[keys[i]].length;j++) rows += row(byWeek[keys[i]][j]);
    out += '<div class="card" style="margin-bottom:12px"><div class="card-head"><h3>Tuần '+keys[i]+'</h3></div>'
        + '<div class="card-pad">'+rows+'</div></div>';
  }
  if(none.length){
    var rows2='';
    for(i=0;i<none.length;i++) rows2 += row(none[i]);
    out += '<div class="card" style="margin-bottom:12px"><div class="card-head"><h3>Chung cả môn</h3></div>'
        + '<div class="card-pad">'+rows2+'</div></div>';
  }
  return out || '<div class="center-empty">Chưa có tài liệu nào. '
    + 'Lưu link Canvas, slides, worksheet, recording hay past exam vào đây.</div>';
}

/* ---------- N. LỊCH (tháng / tuần / ngày, lọc theo môn) ------------------- */
function calEvents(){
  var ev={}, i, j, n, filter=S.view.calFilter;
  function push(dstr,o){ (ev[dstr]=ev[dstr]||[]).push(o); }

  for(i=0;i<S.subjects.length;i++){
    var s=S.subjects[i];
    if(filter && s.id!==filter) continue;

    for(j=0;j<s.assessments.length;j++){
      var a=s.assessments[j];
      if(!a.due) continue;
      push(a.due,{cls:/exam/i.test(a.type||"")?"exam":"due", time:"",
                  txt:s.code+" · "+a.name, sid:s.id, aid:a.id, color:s.color, sort:0});
    }
    if(semStart()){
      for(n=1;n<=S.semester.weeks;n++){
        var ws=weekStart(n);
        for(var c=0;c<(s.classes||[]).length;c++){
          var cl=s.classes[c];
          push(iso(addDays(ws,+cl.day||0)),{cls:"", time:cl.start||"",
               txt:s.code+" "+cl.type+(cl.room?" · "+cl.room:""), sid:s.id, color:s.color,
               sort: cl.start?+cl.start.replace(":",""):2400});
        }
      }
    }
    var tps = s.topics||[];
    for(j=0;j<tps.length;j++){
      var t=tps[j];
      if(t.nextReview && t.learned)
        push(t.nextReview,{cls:"review", time:"", txt:"Ôn: "+t.name, sid:s.id, color:s.color, sort:1});
    }
  }
  for(i=0;i<S.sessions.length;i++){
    var ss=S.sessions[i];
    if(filter && ss.subjectId!==filter) continue;
    var su=subj(ss.subjectId); if(!su) continue;
    var k=ss.date;
    if(!ev[k]) ev[k]=[];
    var found=null;
    for(j=0;j<ev[k].length;j++) if(ev[k][j].cls==="study" && ev[k][j].sid===ss.subjectId) found=ev[k][j];
    if(found){ found.mins+=ss.minutes; found.txt=su.code+" · học "+fmtMins(found.mins); }
    else ev[k].push({cls:"study", time:"", mins:ss.minutes,
                     txt:su.code+" · học "+fmtMins(ss.minutes), sid:ss.subjectId, color:su.color, sort:2500});
  }
  for(var key in ev) ev[key].sort(function(x,y){ return (x.sort||0)-(y.sort||0); });
  return ev;
}

function evHTML(e, full){
  var attr = e.aid
    ? 'data-act="openAssess" data-sid="'+e.sid+'" data-aid="'+e.aid+'"'
    : 'data-act="go" data-tab="subject" data-sid="'+e.sid+'"';
  return '<button class="ev '+e.cls+(full?" evfull":"")+'" style="--ec:'+e.color+'" '+attr+'>'
       + (e.time?'<b class="mono">'+esc(e.time)+'</b> ':'')+esc(e.txt)+'</button>';
}

function viewCalendar(){
  var ev = calEvents(), view = S.view.calView, cur = parseD(S.view.calDate)||today();
  var head = view==="month" ? MONTHS[cur.getMonth()]+" "+cur.getFullYear()
           : view==="week"  ? "Tuần "+fmtDate(mondayOf(cur))+" – "+fmtDate(addDays(mondayOf(cur),6))
           : DOW[(cur.getDay()+6)%7]+", "+cur.getDate()+" "+MONTHS[cur.getMonth()];
  var wk = weekOfDate(cur);

  var body = view==="month" ? calMonth(ev,cur) : view==="week" ? calWeek(ev,cur) : calDay(ev,cur);

  var filt = '<button class="btn sm '+(!S.view.calFilter?"pri":"")+'" data-act="calFilter" data-sid="">Tất cả</button>';
  for(var i=0;i<S.subjects.length;i++){
    filt += '<button class="btn sm '+(S.view.calFilter===S.subjects[i].id?"pri":"")+'" '
          + 'data-act="calFilter" data-sid="'+S.subjects[i].id+'">'+esc(S.subjects[i].code)+'</button>';
  }
  var modes='';
  [["day","Ngày"],["week","Tuần"],["month","Tháng"]].forEach(function(m){
    modes += '<button class="btn sm '+(view===m[0]?"pri":"")+'" data-act="calView" data-v="'+m[0]+'">'+m[1]+'</button>';
  });

  return '<div class="stack">'
   + '<div class="spread wrap" style="gap:10px">'
     + '<div><h2 style="font-size:19px">'+head+'</h2>'
     + (wk?'<div class="dl-meta">Tuần '+wk+' của học kỳ</div>':'')+'</div>'
     + '<div class="row wrap" style="gap:7px">'+modes
       + '<span style="width:8px"></span>'
       + '<button class="btn sm" data-act="calMove" data-n="-1">←</button>'
       + '<button class="btn sm" data-act="calMove" data-n="0">Hôm nay</button>'
       + '<button class="btn sm" data-act="calMove" data-n="1">→</button>'
     + '</div></div>'
   + '<div class="row wrap" style="gap:5px">'+filt+'</div>'
   + body
   + '<div class="row wrap" style="gap:12px"><span class="eyebrow">Chú thích</span>'
     + '<span class="pill vio">Hạn nộp</span>'
     + '<span class="pill" style="background:#f7e3e1;color:var(--urgent);border-color:transparent">Exam</span>'
     + '<span class="pill" style="background:var(--accent-soft);color:var(--accent-deep);border-color:transparent">Ôn tập</span>'
     + '<span class="pill">Lecture / Tutorial</span>'
     + '<span class="pill" style="background:#eceef0;color:var(--ink2);border-color:transparent">Đã học</span></div>'
   + (semStart()?'':'<div class="center-empty">Chưa đặt ngày bắt đầu học kỳ nên lịch lecture/tutorial chưa hiện. Vào Cài đặt để nhập.</div>')
   + '</div>';
}

var MONTH_MAX = 4;        // số việc hiện trong một ô ngày, còn lại gộp vào "+N nữa"

function calMonth(ev,m){
  var first=new Date(m.getFullYear(),m.getMonth(),1), start=mondayOf(first);
  var cells='', t=iso(today()), i, k;
  for(i=0;i<7;i++) cells += '<div class="cal-dow">'+DOW_SHORT[i]+'</div>';
  for(k=0;k<42;k++){
    var d=addDays(start,k), ds=iso(d), out=d.getMonth()!==m.getMonth();
    var list=ev[ds]||[], html='';
    /* evHTML(…, true) — xếp chồng và xuống dòng đầy đủ, giống hệt lịch tuần */
    for(i=0;i<list.length && i<MONTH_MAX;i++) html += evHTML(list[i], true);
    if(list.length>MONTH_MAX)
      html += '<button class="cal-more" data-act="calPick" data-d="'+ds+'">+'
            + (list.length-MONTH_MAX)+' việc nữa</button>';
    /* Ô ngày phải là div: bên trong có các nút sự kiện, mà HTML không cho nút
       lồng trong nút — trình duyệt sẽ tách chúng ra thành ô riêng và làm lệch
       cả lưới. Vẫn bấm được vì bộ xử lý click chạy theo data-act. */
    cells += '<div class="cal-day '+(out?"out":"")+' '+(ds===t?"today":"")+'" '
           + 'data-act="calPick" data-d="'+ds+'">'
           + '<span class="cal-num">'+d.getDate()+'</span>'+html+'</div>';
  }
  return '<div class="cal">'+cells+'</div>';
}

function calWeek(ev,cur){
  var mon=mondayOf(cur), cells='', t=iso(today()), i, k;
  for(i=0;i<7;i++){
    var d=addDays(mon,i);
    cells += '<div class="cal-dow">'+DOW_SHORT[i]+' <span class="mono">'+d.getDate()+'</span></div>';
  }
  for(k=0;k<7;k++){
    var d2=addDays(mon,k), ds=iso(d2), list=ev[ds]||[], html='';
    for(i=0;i<list.length;i++) html += evHTML(list[i], true);
    cells += '<div class="cal-day tall '+(ds===t?"today":"")+'">'
           + (html || '<span class="muted" style="font-size:11px">—</span>')+'</div>';
  }
  return '<div class="cal">'+cells+'</div>';
}

function calDay(ev,cur){
  var ds=iso(cur), list=ev[ds]||[], html='', i;
  for(i=0;i<list.length;i++){
    var e=list[i];
    html += '<div class="dayrow">'
      + '<span class="daytime mono">'+(e.time||"—")+'</span>'
      + '<span class="daybar" style="background:'+e.color+'"></span>'
      + evHTML(e, true)+'</div>';
  }
  /* việc cần làm của tuần chứa ngày này */
  var wk = weekOfDate(cur), tasks='';
  if(wk){
    for(i=0;i<S.subjects.length;i++){
      var s=S.subjects[i];
      if(S.view.calFilter && s.id!==S.view.calFilter) continue;
      for(var j=0;j<s.weeks.length;j++){
        var w=s.weeks[j]; if(w.n!==wk) continue;
        for(var q=0;q<(w.tasks||[]).length;q++){
          if(w.tasks[q].done) continue;
          tasks += '<button class="check" data-act="toggleTask" data-sid="'+s.id+'" data-wk="'+wk+'" data-ti="'+q+'">'
                 + '<span class="box"></span><span class="check-lab">'
                 + '<span class="mono" style="font-size:11px;color:'+s.color+'">'+esc(s.code)+'</span> '
                 + esc(w.tasks[q].label)+'</span></button>';
        }
      }
    }
  }
  return '<div class="card"><div class="card-head"><h3>Lịch trong ngày</h3></div>'
    + '<div class="card-pad">'+(html||'<div class="muted" style="font-size:14px">Không có gì trong ngày này.</div>')+'</div></div>'
    + (tasks ? '<div class="card" style="margin-top:14px"><div class="card-head"><h3>Việc tuần '+wk+' chưa xong</h3></div>'
        + '<div class="card-pad">'+tasks+'</div></div>' : '');
}

/* ---------- O. PHÂN TÍCH -------------------------------------------------- */
function viewAnalytics(){
  if(!S.subjects.length) return '<div class="center-empty">Chưa có dữ liệu để phân tích.</div>';
  var i, j, done=0, tot=0, overdue=0;
  for(i=0;i<S.subjects.length;i++){ var p=subjProg(S.subjects[i]); done+=p.done; tot+=p.total; }
  var dl=allDeadlines();
  for(i=0;i<dl.length;i++) if(daysLeft(dl[i].a.due)<0) overdue++;

  var wkStart=mondayOf(today());
  var weekMins=studyMinutes(function(x){ var d=parseD(x.date); return d && d>=wkStart; });
  var daysIn = ((today()-wkStart)/DAY)+1;

  /* thời gian học theo môn */
  var bySub='', maxM=1;
  for(i=0;i<S.subjects.length;i++){
    var mm=studyMinutes((function(id){return function(x){return x.subjectId===id;};})(S.subjects[i].id));
    if(mm>maxM) maxM=mm;
  }
  for(i=0;i<S.subjects.length;i++){
    var s=S.subjects[i];
    var m2=studyMinutes((function(id){return function(x){return x.subjectId===id;};})(s.id));
    bySub += hbar(s.code, m2/maxM*100, fmtMins(m2), s.color);
  }
  /* tiến độ theo môn */
  var progBars='';
  for(i=0;i<S.subjects.length;i++){
    var s3=S.subjects[i], p3=subjProg(s3);
    progBars += hbar(s3.code, p3.pct, p3.pct+'%', s3.color);
  }
  /* điểm theo assessment */
  var gradeBars='', anyGrade=false;
  for(i=0;i<S.subjects.length;i++){
    var s4=S.subjects[i], inner='';
    for(j=0;j<s4.assessments.length;j++){
      var a=s4.assessments[j];
      if(a.grade==null||a.grade==="") continue;
      anyGrade=true;
      var b=band(+a.grade);
      inner += hbar(a.name, +a.grade, (+a.grade)+' · '+(+a.weight||0)+'%', 'var('+b.v+')');
    }
    if(inner) gradeBars += '<div class="eyebrow" style="margin:12px 0 2px">'+esc(s4.code)+'</div>'+inner;
  }
  /* kế hoạch vs thực tế, 8 tuần */
  var goal = S.settings.weeklyGoal||900, cols='', maxW=goal;
  var arr=[];
  for(i=7;i>=0;i--){
    var ws=addDays(wkStart,-7*i), we=addDays(ws,7);
    var mv=studyMinutes((function(a2,b2){return function(x){var d=parseD(x.date); return d&&d>=a2&&d<b2;};})(ws,we));
    arr.push({m:mv,label:fmtDate(ws)});
    if(mv>maxW) maxW=mv;
  }
  for(i=0;i<arr.length;i++){
    var h=arr[i].m/maxW*100;
    cols += '<div class="col" title="'+fmtMins(arr[i].m)+'"><i style="height:'+h+'%;background:'
         + (arr[i].m>=goal?'var(--ok)':'var(--accent)')+'"></i><span>'+arr[i].label.split(" ")[0]+'</span></div>';
  }
  var goalLine = '<div class="goalline" style="bottom:'+(goal/maxW*100)+'%"><span class="mono">mục tiêu '+fmtMins(goal)+'</span></div>';

  /* mạnh nhất / yếu nhất */
  var best=null, worst=null;
  for(i=0;i<S.subjects.length;i++){
    var g=gradeInfo(S.subjects[i]);
    if(g.current==null) continue;
    if(!best || g.current>best.g) best={s:S.subjects[i], g:g.current};
    if(!worst || g.current<worst.g) worst={s:S.subjects[i], g:g.current};
  }
  var leastTime=null;
  for(i=0;i<S.subjects.length;i++){
    var mt=studyMinutes((function(id){return function(x){return x.subjectId===id;};})(S.subjects[i].id));
    if(!leastTime || mt<leastTime.m) leastTime={s:S.subjects[i], m:mt};
  }

  var insight='';
  if(best && worst && best.s!==worst.s){
    insight += '<div class="insight"><span class="ipill" style="background:#e5f1ea;color:var(--ok)">Mạnh nhất</span>'
      + '<b class="mono">'+esc(best.s.code)+'</b> — '+best.g.toFixed(1)+'%</div>';
    insight += '<div class="insight"><span class="ipill" style="background:#f7e3e1;color:var(--urgent)">Cần chú ý</span>'
      + '<b class="mono">'+esc(worst.s.code)+'</b> — '+worst.g.toFixed(1)+'%</div>';
  }
  if(leastTime){
    insight += '<div class="insight"><span class="ipill" style="background:#f6ecd8;color:var(--warn)">Ít giờ nhất</span>'
      + '<b class="mono">'+esc(leastTime.s.code)+'</b> — '+fmtMins(leastTime.m)+'</div>';
  }
  var wkAll = weakTopics();
  if(wkAll.length){
    insight += '<div class="insight"><span class="ipill" style="background:#f7e3e1;color:var(--urgent)">Chủ đề yếu</span>'
      + wkAll.length+' chủ đề đang dưới mức vững</div>';
  }

  return '<div class="stack">'
  + '<div class="grid g4">'
    + statCard(pct(done,tot)+'<small>%</small>',"Hoàn thành cả kỳ")
    + statCard(done+'<small>/'+tot+'</small>',"Việc đã xong")
    + statCard(String(overdue),"Deadline quá hạn")
    + statCard(fmtMins(weekMins/daysIn).replace(/([a-z])/g,'<small>$1</small>'),"Trung bình mỗi ngày")
  + '</div>'
  + '<div class="grid g2">'
    + (insight?'<div class="card card-pad"><div class="eyebrow" style="margin-bottom:10px">Nhận xét nhanh</div>'+insight+'</div>':'')
    + streakCard()
  + '</div>'
  + '<div class="grid g2">'
    + '<div class="card"><div class="card-head"><h3>Thời gian học theo môn</h3></div><div class="card-pad">'
      + (bySub||'<span class="muted">Chưa có phiên học nào.</span>')+'</div></div>'
    + '<div class="card"><div class="card-head"><h3>Tiến độ theo môn</h3></div><div class="card-pad">'+progBars+'</div></div>'
  + '</div>'
  + '<div class="card"><div class="card-head"><h3>Kế hoạch so với thực tế</h3>'
    + '<span class="eyebrow">mục tiêu '+fmtMins(goal)+'/tuần</span></div>'
    + '<div class="card-pad"><div class="cols withgoal">'+cols+goalLine+'</div></div></div>'
  + '<div class="card"><div class="card-head"><h3>Điểm theo assessment</h3></div><div class="card-pad">'
    + (anyGrade?gradeBars:'<span class="muted">Chưa có assessment nào được chấm.</span>')+'</div></div>'
  + '</div>';
}
function hbar(label, widthPct, value, color){
  return '<div class="hbar"><span class="hbar-l">'+esc(label)+'</span>'
    + '<span class="hbar-t" style="--hc:'+(color||'var(--accent)')+'"><i style="width:'+clamp(widthPct,0,100)+'%"></i></span>'
    + '<span class="hbar-v">'+esc(value)+'</span></div>';
}

/* ---------- P. CHẾ ĐỘ ÔN THI --------------------------------------------- */
function viewExam(){
  var list = subjectsWithExam();
  if(!list.length){
    return '<div class="center-empty">Chưa có kỳ thi nào. Vào tab Assessment của từng môn, '
         + 'thêm một mục loại “Final exam” hoặc “Mid-sem” kèm ngày thi.</div>';
  }
  var sid = S.view.examSid;
  var picked = null;
  for(var i=0;i<list.length;i++) if(list[i].s.id===sid) picked=list[i];
  if(!picked) picked = list[0];

  var tabs='';
  for(i=0;i<list.length;i++){
    tabs += '<button class="btn sm '+(list[i].s.id===picked.s.id?"pri":"")+'" '
      + 'data-act="examPick" data-sid="'+list[i].s.id+'">'+esc(list[i].s.code)
      + ' <span class="mono" style="opacity:.7">'+(list[i].days<0?"đã qua":list[i].days+"n")+'</span></button>';
  }
  return '<div class="stack">'
    + '<div class="row wrap" style="gap:6px">'+tabs+'</div>'
    + examPanel(picked.s, picked.a, picked.days)
  + '</div>';
}

function examPanel(s, a, days){
  s.topics = s.topics||[];
  var st = topicStats(s), i;
  var weak='', okish='', strong='';
  for(i=0;i<s.topics.length;i++){
    var t=s.topics[i], L=topicLevel(t);
    var row = '<button class="spread topicmini" data-act="go" data-tab="subject" data-sid="'+s.id+'" data-sub="topics">'
      + '<span class="row" style="gap:8px"><span class="dot" style="background:'+L.color+'"></span>'
      + '<span style="font-size:13.5px">'+esc(t.name)+'</span></span>'
      + '<span class="mono" style="font-size:11px;color:var(--ink3)">'+(t.confidence?t.confidence+"/5":"—")+'</span></button>';
    if(L.key==="weak"||L.key==="none") weak+=row;
    else if(L.key==="ok") okish+=row;
    else strong+=row;
  }
  var cl = examChecklist(s), items='', cdone=0;
  for(i=0;i<cl.length;i++){
    if(cl[i].done) cdone++;
    items += '<div class="row" style="gap:6px">'
      + '<button class="check '+(cl[i].done?"on":"")+'" style="flex:1" data-act="examCheck" data-sid="'+s.id+'" data-i="'+i+'">'
      + '<span class="box"></span><span class="check-lab">'+esc(cl[i].label)+'</span></button>'
      + '<button class="btn ghost sm" data-act="delExamItem" data-sid="'+s.id+'" data-i="'+i+'">×</button></div>';
  }

  var urgency = days<0 ? "x" : days<=3 ? "r" : days<=7 ? "y" : days<=14 ? "y" : "g";

  return '<div class="examhero" style="--sc:'+s.color+'">'
      + '<div class="spread wrap" style="gap:12px;align-items:flex-start">'
        + '<div><div class="eyebrow" style="color:#8f9dab">'+esc(s.code)+' · '+esc(a.type||"Exam")+'</div>'
        + '<h2 style="font-size:24px;color:#fff;margin-top:6px">'+esc(a.name)+'</h2>'
        + '<div class="mono" style="color:#9dabb8;font-size:12.5px;margin-top:6px">'
        + (a.due?fmtDate(parseD(a.due)):"chưa đặt ngày")+' · chiếm '+(+a.weight||0)+'% điểm môn</div></div>'
        + '<div style="text-align:right"><div class="bignum" style="color:#fff">'
        + (days<0?"—":days)+'</div><div class="stat-l" style="color:#8f9dab">'
        + (days<0?"đã thi xong":"ngày nữa")+'</div></div>'
      + '</div>'
      + '<div style="margin-top:18px"><div class="spread" style="margin-bottom:6px">'
      + '<span class="eyebrow" style="color:#8f9dab">Chủ đề đã nắm vững</span>'
      + '<span class="mono" style="color:#fff;font-size:13px">'+st.mastery+'%</span></div>'
      + '<div class="bar" style="background:rgba(255,255,255,.15)"><i style="width:'+st.mastery+'%;background:#fff"></i></div></div>'
    + '</div>'
  + '<div class="grid g2" style="margin-top:14px">'
    + '<div class="card"><div class="card-head"><h3>Cần ôn gấp</h3>'
      + '<span class="cd '+urgency+'">'+(days<0?"đã qua":days+" ngày")+'</span></div><div class="card-pad">'
      + (weak || '<span class="muted" style="font-size:14px">Không còn chủ đề nào ở mức yếu.</span>')
      + (okish?'<div class="eyebrow" style="margin:14px 0 6px">Chưa chắc chắn</div>'+okish:'')
      + '</div></div>'
    + '<div class="card"><div class="card-head"><h3>Checklist ôn thi</h3>'
      + '<span class="mono" style="font-size:12px">'+cdone+'/'+cl.length+'</span></div><div class="card-pad">'
      + items
      + addRow("exam", s.id)
      + '<div class="bar thin" style="margin:12px 0"><i style="width:'+pct(cdone,cl.length)+'%"></i></div>'
      + '<button class="btn sm" data-act="addExamItem" data-sid="'+s.id+'">+ Thêm việc</button>'
      + '</div></div>'
  + '</div>'
  + (strong?'<div class="card" style="margin-top:14px"><div class="card-head"><h3>Đã vững</h3>'
      + '<span class="eyebrow">'+st.strong+' chủ đề</span></div><div class="card-pad">'+strong+'</div></div>':'')
  + '<div class="card" style="margin-top:14px"><div class="card-head"><h3>Lên kế hoạch ôn</h3></div>'
    + '<div class="card-pad"><p class="muted" style="font-size:13.5px;margin:0 0 12px">'
    + 'Chia đều các chủ đề còn yếu vào số ngày còn lại, chủ đề yếu nhất được ôn trước và ôn lại nhiều lần hơn.</p>'
    + '<button class="btn acc" data-act="examPlan" data-sid="'+s.id+'">Tạo kế hoạch ôn</button></div></div>';
}

/* ---------- Q. TRỢ LÝ HỌC TẬP -------------------------------------------- */
function viewAssist(){
  if(!S.subjects.length) return '<div class="center-empty">Thêm môn học trước đã.</div>';
  var hours = S.view.assistHours || 3;
  var r = studyPlan(hours*60);
  var rows='', i;
  for(i=0;i<r.plan.length;i++){
    var it=r.plan[i].item;
    var badge = it.kind==="assessment" ? "vio" : it.kind==="review" ? "acc" : it.kind==="weak" ? "warnp" : "";
    var kindTxt = it.kind==="assessment"?"Assessment":it.kind==="review"?"Ôn tập":it.kind==="weak"?"Củng cố":"Việc tuần";
    var target = it.kind==="assessment"
      ? 'data-act="openAssess" data-sid="'+it.s.id+'" data-aid="'+it.ref.id+'"'
      : 'data-act="go" data-tab="subject" data-sid="'+it.s.id+'" data-sub="'
        +(it.kind==="week"?"weekly":"topics")+'"';
    rows += '<div class="planrow">'
      + '<span class="planmin mono">'+fmtMins(r.plan[i].mins)+'</span>'
      + '<span class="planbar" style="background:'+it.s.color+'"></span>'
      + '<button class="planbody" '+target+'>'
        + '<span class="row" style="gap:7px;margin-bottom:3px">'
        + '<span class="pill '+badge+'">'+kindTxt+'</span>'
        + '<span class="mono" style="font-size:11px;color:'+it.s.color+'">'+esc(it.s.code)+'</span></span>'
        + '<span class="plantitle">'+esc(it.title)+'</span>'
        + '<span class="dl-meta">'+esc(it.why)+'</span>'
      + '</button>'
      + '<button class="btn sm" data-act="pomoFrom" data-sid="'+it.s.id+'" data-label="'+esc(it.title)+'">▶</button>'
    + '</div>';
  }
  var hrBtns='';
  [1,2,3,4,6].forEach(function(h){
    hrBtns += '<button class="btn sm '+(hours===h?"pri":"")+'" data-act="assistHours" data-h="'+h+'">'+h+'h</button>';
  });

  var st = streak();
  var greet = st>0 ? "Chuỗi "+st+" ngày đang chạy — giữ tiếp nhé." : "Bắt đầu lại chuỗi ngày học hôm nay.";

  return '<div class="stack">'
   + '<div class="card card-pad">'
     + '<div class="spread wrap" style="gap:12px">'
       + '<div><h2 style="font-size:19px">Hôm nay bạn có bao nhiêu thời gian?</h2>'
       + '<div class="dl-meta" style="margin-top:4px">'+esc(greet)+'</div></div>'
       + '<div class="row" style="gap:5px">'+hrBtns+'</div>'
     + '</div></div>'
   + '<div class="card"><div class="card-head"><h3>Gợi ý cho '+hours+' tiếng tới</h3>'
     + (r.leftover>=15?'<span class="eyebrow">còn dư '+fmtMins(r.leftover)+'</span>':'')+'</div>'
     + (rows ? '<div class="card-pad">'+rows+'</div>'
             : '<div class="card-pad muted" style="font-size:14px">Không còn việc nào đang chờ. '
               +'Thêm assessment hoặc đánh dấu chủ đề đã học để trợ lý có dữ liệu xếp lịch.</div>')
   + '</div>'
   + '<div class="card card-pad"><div class="eyebrow">Dựa trên</div>'
     + '<p class="muted" style="font-size:13.5px;line-height:1.65;margin:8px 0 0">'
     + 'Thứ tự ưu tiên tính từ số ngày còn lại tới deadline, trọng số của assessment, phần việc chưa xong, '
     + 'chủ đề tới hạn ôn theo lịch spaced repetition, và các chủ đề bạn tự chấm là yếu khi kỳ thi đang tới gần. '
     + 'Toàn bộ chạy ngay trong trình duyệt, không gửi dữ liệu của bạn đi đâu cả.</p></div>'
   + '</div>';
}

/* ---------- R. CÀI ĐẶT BỔ SUNG ------------------------------------------- */
function settingsExtras(){
  var g = S.settings;
  return '<div class="card"><div class="card-head"><h3>Học tập &amp; nhắc nhở</h3></div><div class="card-pad">'
    + '<label class="fl"><span>Mục tiêu giờ học mỗi tuần (phút)</span>'
    + '<input type="number" min="0" step="30" value="'+(g.weeklyGoal||0)+'" data-act="setGoal"></label>'
    + '<div class="grid g2" style="gap:0 14px">'
      + '<label class="fl"><span>Pomodoro — phút tập trung</span>'
      + '<input type="number" min="5" max="120" value="'+g.focusMin+'" data-act="setFocus"></label>'
      + '<label class="fl"><span>Pomodoro — phút nghỉ</span>'
      + '<input type="number" min="1" max="60" value="'+g.breakMin+'" data-act="setBreak"></label>'
    + '</div>'
    + '<label class="row" style="gap:9px;cursor:pointer;margin-top:4px">'
      + '<input type="checkbox" '+(g.gamify?"checked":"")+' data-act="setGamify" style="width:auto">'
      + '<span style="font-size:14px">Hiện chuỗi ngày học, XP và cấp độ</span></label>'
    + '<p class="muted" style="font-size:13px;margin:10px 0 0">Tắt đi nếu bạn thấy phần điểm thưởng làm phân tâm — '
    + 'mọi tính năng khác vẫn chạy bình thường.</p>'
  + '</div></div>';
}

/* ---------- S. HỘP THOẠI MỚI ---------------------------------------------- */
function modalTopic(sid,tid){
  var s=subj(sid), t=tid?topicById(s,tid):null;
  var weekOpts='<option value="">— không gắn tuần —</option>';
  for(var i=1;i<=S.semester.weeks;i++)
    weekOpts += '<option value="'+i+'"'+(t&&+t.week===i?' selected':'')+'>Tuần '+i+'</option>';
  openModal(t?"Sửa chủ đề":"Thêm chủ đề",
    fld("f_tn","Tên chủ đề","text",t?t.name:"",'placeholder="Statutory Interpretation"')
    + '<label class="fl"><span>Thuộc tuần</span><select id="f_tw">'+weekOpts+'</select></label>',
    '<button class="btn" data-act="closeModal">Huỷ</button>'
    + '<button class="btn acc" data-act="saveTopic" data-sid="'+sid+'" data-tid="'+(tid||"")+'">Lưu</button>');
}

function modalNote(sid,nid){
  var s=subj(sid), n=null;
  for(var i=0;i<s.notes.length;i++) if(s.notes[i].id===nid) n=s.notes[i];
  var weekOpts='<option value="">— chung —</option>';
  for(i=1;i<=S.semester.weeks;i++)
    weekOpts += '<option value="'+i+'"'+(n&&+n.week===i?' selected':'')+'>Tuần '+i+'</option>';
  openModal(n?"Sửa ghi chú":"Ghi chú mới",
    fld("f_nt","Tiêu đề","text",n?n.title:"",'placeholder="Donoghue v Stevenson"')
    + '<div class="grid g2" style="gap:0 14px">'
    + sel("f_nk","Loại",NOTE_KINDS,n?n.kind:"Lecture")
    + '<label class="fl"><span>Tuần</span><select id="f_nw">'+weekOpts+'</select></label>'
    + '</div>'
    + '<label class="fl"><span>Nội dung (dùng được Markdown)</span>'
    + '<textarea id="f_nb" style="min-height:220px">'+esc(n?n.body:"")+'</textarea></label>'
    + '<p class="muted" style="font-size:12px;margin:0 0 14px">## tiêu đề · **đậm** · *nghiêng* · `mã` · - gạch đầu dòng · &gt; trích dẫn</p>'
    + '<div class="attach" id="f_attach">'
      + '<div class="attach-head"><span class="eyebrow">Hình ảnh</span>'
        + '<button class="btn sm" data-act="pickNoteImg">+ Chọn ảnh</button></div>'
      + '<div class="attach-grid" id="f_nimgs"></div>'
      + '<p class="attach-hint">Thả ảnh vào <b>ô nội dung</b> để chèn đúng chỗ đang viết. '
      + 'Thả vào <b>khung này</b> thì chỉ đính kèm, ảnh sẽ hiện thành thư viện ở cuối ghi chú. '
      + 'Dán ảnh (Ctrl/⌘+V) khi đang gõ cũng chèn vào chỗ con trỏ.</p>'
    + '</div>',
    '<button class="btn" data-act="closeModal">Huỷ</button>'
    + '<button class="btn acc" data-act="saveNote" data-sid="'+sid+'" data-nid="'+(nid||"")+'">Lưu</button>');

  /* bản nháp ảnh của lần mở hộp thoại này */
  noteDraft = {
    images: (n && n.images ? n.images.slice() : []),
    orig:   (n && n.images ? n.images.map(function(x){ return x.id; }) : []),
    added:  [],
    saved:  false,
    busy:   0
  };
  paintNoteImgs();
}

/* ---------- K2. ẢNH ĐÍNH KÈM TRONG GHI CHÚ ------------------------------- */
var noteDraft = null;

/* huỷ hộp thoại: ảnh vừa tải lên mà chưa Lưu thì xoá khỏi kho */
function discardNoteDraft(){
  if(!noteDraft) return;
  var d = noteDraft;
  noteDraft = null;
  if(!d.saved) for(var i=0;i<d.added.length;i++) imgDel(d.added[i]);
}

function paintNoteImgs(){
  var box = $("f_nimgs");
  if(!box || !noteDraft) return;
  var out = "", i;
  for(i=0;i<noteDraft.images.length;i++){
    var im = noteDraft.images[i];
    out += '<div class="thumb">'
      + '<img data-img="'+esc(im.id)+'" alt="'+esc(im.name||"")+'">'
      + '<div class="thumb-bar">'
        + '<button class="btn ghost sm" data-act="insertNoteImg" data-iid="'+esc(im.id)+'" title="Chèn vào chỗ con trỏ">⤵ Chèn</button>'
        + '<button class="btn ghost sm danger" data-act="rmNoteImg" data-iid="'+esc(im.id)+'" title="Bỏ ảnh">✕</button>'
      + '</div></div>';
  }
  if(noteDraft.busy) out += '<div class="thumb thumb-load"><span class="mono">đang xử lý…</span></div>';
  box.innerHTML = out || '<div class="attach-empty">Chưa có ảnh nào.</div>';
  hydrateImages(box);
}

/* Ảnh là một khối riêng, chèn thẳng vào giữa câu sẽ cắt đôi câu văn.
   Nên bám vào đầu hoặc cuối dòng đang thả, tuỳ bên nào gần hơn. */
function snapToLine(text, pos){
  var start = text.lastIndexOf("\n", pos-1) + 1;
  var end   = text.indexOf("\n", pos);
  if(end < 0) end = text.length;
  return (pos - start) <= (end - pos) ? start : end;
}

/* thả ảnh vào giữa bài thì phải biết đang thả vào chỗ nào trong đoạn văn */
function caretPosFromPoint(ta, x, y){
  var p, r;
  if(document.caretPositionFromPoint){
    p = document.caretPositionFromPoint(x, y);
    if(p && (p.offsetNode===ta || ta.contains(p.offsetNode))) return p.offset;
  }
  if(document.caretRangeFromPoint){
    r = document.caretRangeFromPoint(x, y);
    if(r && (r.startContainer===ta || ta.contains(r.startContainer))) return r.startOffset;
  }
  return null;
}

function insertAtCursor(ta, text){
  if(!ta) return;
  var a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
  var before = v.slice(0,a), after = v.slice(b);
  if(before && !/\n$/.test(before)) text = "\n" + text;
  if(after  && !/^\n/.test(after))  text = text + "\n";
  ta.value = before + text + after;
  var pos = before.length + text.length;
  ta.focus();
  try{ ta.setSelectionRange(pos,pos); }catch(e){}
}
function insertNoteImgMd(im){
  insertAtCursor($("f_nb"), "!["+String(im.name||"").replace(/[\[\]()]/g,"")+"](img:"+im.id+")");
}

/* nhận file từ nút chọn, kéo thả hoặc dán */
function addNoteFiles(files, inline){
  if(!noteDraft) return;
  var list = [], i;
  for(i=0;i<files.length;i++) if(files[i] && /^image\//.test(files[i].type)) list.push(files[i]);
  if(!list.length){ toast("Không thấy file ảnh nào"); return; }
  if(noteDraft.images.length + list.length > IMG_PER_NOTE){
    toast("Mỗi ghi chú tối đa "+IMG_PER_NOTE+" ảnh");
    return;
  }
  noteDraft.busy += list.length;
  paintNoteImgs();

  var ok = 0;
  list.reduce(function(chain,f){
    return chain.then(function(){
      return imgAdd(f).then(function(im){
        if(!noteDraft) return imgDel(im.id);          // hộp thoại đã đóng giữa chừng
        noteDraft.images.push(im);
        noteDraft.added.push(im.id);
        if(inline) insertNoteImgMd(im);
        ok++;
      }).catch(function(err){
        toast(err && err.message ? err.message : "Không thêm được ảnh");
      }).then(function(){
        if(noteDraft){ noteDraft.busy--; paintNoteImgs(); }
      });
    });
  }, Promise.resolve()).then(function(){
    if(ok) toast(ok>1 ? "Đã thêm "+ok+" ảnh" : "Đã thêm ảnh");
  });
}

/* các ảnh đã đính kèm nhưng chưa chèn vào nội dung */
function looseImages(n){
  var body = String(n.body||""), out = [], ims = n.images || [];
  for(var i=0;i<ims.length;i++)
    if(body.indexOf("(img:"+ims[i].id+")") < 0) out.push(ims[i]);
  return out;
}
function noteGallery(n){
  var rest = looseImages(n), out = "", i;
  if(!rest.length) return "";
  for(i=0;i<rest.length;i++)
    out += '<button class="gal-item" data-act="lightbox" data-iid="'+esc(rest[i].id)+'">'
         + '<img data-img="'+esc(rest[i].id)+'" alt="'+esc(rest[i].name||"")+'"></button>';
  return '<div class="gal-wrap"><div class="eyebrow" style="margin-bottom:8px">Hình ảnh · '+rest.length+'</div>'
       + '<div class="gal">'+out+'</div></div>';
}

function openLightbox(id){
  $("modal-root").innerHTML =
    '<div class="scrim lightbox" data-act="closeLight">'
    + '<img data-img="'+esc(id)+'" data-act="noop" alt="">'
    + '<button class="btn sm lb-close" data-act="closeLight">✕ Đóng</button></div>';
  hydrateImages($("modal-root"));
}

function modalLib(sid,lid){
  var s=subj(sid), it=null;
  for(var i=0;i<s.library.length;i++) if(s.library[i].id===lid) it=s.library[i];
  var weekOpts='<option value="">— không gắn tuần —</option>';
  for(i=1;i<=S.semester.weeks;i++)
    weekOpts += '<option value="'+i+'"'+(it&&+it.week===i?' selected':'')+'>Tuần '+i+'</option>';
  openModal(it?"Sửa mục":"Thêm vào thư viện",
    '<div class="grid g2" style="gap:0 14px">'
    + sel("f_lt","Loại",LIB_TYPES,it?it.type:"Case")
    + '<label class="fl"><span>Tuần</span><select id="f_lw">'+weekOpts+'</select></label></div>'
    + fld("f_ltl","Tên","text",it?it.title:"",'placeholder="Donoghue v Stevenson / CAPM / AASB 10"')
    + '<label class="fl"><span>Nội dung</span>'
    + '<textarea id="f_lb" style="min-height:150px" placeholder="Với công thức thì viết thẳng, ví dụ:&#10;E(Ri) = Rf + β(Rm − Rf)">'
    + esc(it?it.body:"")+'</textarea></label>',
    '<button class="btn" data-act="closeModal">Huỷ</button>'
    + '<button class="btn acc" data-act="saveLib" data-sid="'+sid+'" data-lid="'+(lid||"")+'">Lưu</button>');
}

function modalRes(sid,rid){
  var s=subj(sid), r=null;
  for(var i=0;i<s.resources.length;i++) if(s.resources[i].id===rid) r=s.resources[i];
  var weekOpts='<option value="">— chung cả môn —</option>';
  for(i=1;i<=S.semester.weeks;i++)
    weekOpts += '<option value="'+i+'"'+(r&&+r.week===i?' selected':'')+'>Tuần '+i+'</option>';
  openModal(r?"Sửa tài liệu":"Thêm tài liệu",
    fld("f_rl","Tên","text",r?r.label:"",'placeholder="Week 4 Lecture Slides"')
    + '<div class="grid g2" style="gap:0 14px">'
    + sel("f_rk","Loại",RES_KINDS,r?r.kind:"Slides")
    + '<label class="fl"><span>Tuần</span><select id="f_rw">'+weekOpts+'</select></label></div>'
    + fld("f_ru","Đường dẫn","text",r?r.url:"",'placeholder="https://canvas.sydney.edu.au/..."')
    + '<p class="muted" style="font-size:12.5px;margin:0">File trên máy không tải lên được — lưu link Canvas, '
    + 'Google Drive hoặc OneDrive thì mở được ở mọi thiết bị.</p>',
    '<button class="btn" data-act="closeModal">Huỷ</button>'
    + '<button class="btn acc" data-act="saveRes" data-sid="'+sid+'" data-rid="'+(rid||"")+'">Lưu</button>');
}

/* kế hoạch ôn thi rải theo ngày */
function modalExamPlan(sid){
  var s=subj(sid), a=examOf(s);
  if(!a){ toast("Môn này chưa có kỳ thi"); return; }
  var days = daysLeft(a.due);
  if(days===null || days<1){ toast("Kỳ thi đã tới hoặc chưa đặt ngày"); return; }
  var pool=[], i;
  for(i=0;i<s.topics.length;i++){
    var L=topicLevel(s.topics[i]);
    var reps = L.key==="weak"||L.key==="none" ? 3 : L.key==="ok" ? 2 : 1;
    for(var r=0;r<reps;r++) pool.push({t:s.topics[i], L:L});
  }
  if(!pool.length){ toast("Chưa có chủ đề nào để xếp lịch"); return; }
  pool.sort(function(x,y){ return (x.t.confidence||0)-(y.t.confidence||0); });

  var studyDays = Math.min(days, 21);
  var perDay = Math.ceil(pool.length/studyDays);
  var html='', k=0;
  for(i=0;i<studyDays && k<pool.length;i++){
    var d = addDays(today(), i), items='';
    for(var j=0;j<perDay && k<pool.length;j++,k++){
      items += '<div class="row" style="gap:8px;padding:3px 0">'
        + '<span class="dot" style="background:'+pool[k].L.color+'"></span>'
        + '<span style="font-size:13.5px">'+esc(pool[k].t.name)+'</span></div>';
    }
    html += '<div class="planday"><div class="spread"><b class="mono">'+DOW_SHORT[(d.getDay()+6)%7]+' '+fmtDate(d)+'</b>'
      + '<span class="mono" style="font-size:11px;color:var(--ink3)">'+(i===0?"hôm nay":"còn "+(days-i)+" ngày tới thi")+'</span></div>'
      + '<div style="margin-top:5px">'+items+'</div></div>';
  }
  openModal("Kế hoạch ôn "+s.code,
    '<p class="muted" style="font-size:13.5px;margin:0 0 12px">'+pool.length+' lượt ôn chia vào '+studyDays
    + ' ngày. Chủ đề yếu lặp lại 3 lần, tạm 2 lần, vững 1 lần.</p>'
    + '<div class="planlist">'+html+'</div>');
}

/* ---------- T. THAO TÁC MỚI ---------------------------------------------- */
ACT.calView   = function(el){ S.view.calView = el.dataset.v; };
ACT.calFilter = function(el){ S.view.calFilter = el.dataset.sid||""; };
ACT.calPick   = function(el){ S.view.calDate = el.dataset.d; S.view.calView = "day"; };
ACT.calMove   = function(el){
  var n=+el.dataset.n, v=S.view.calView, d=parseD(S.view.calDate)||today();
  if(n===0){ S.view.calDate = iso(today()); return; }
  if(v==="month") S.view.calDate = iso(new Date(d.getFullYear(), d.getMonth()+n, 1));
  else if(v==="week") S.view.calDate = iso(addDays(d, 7*n));
  else S.view.calDate = iso(addDays(d, n));
};
ACT.examPick    = function(el){ S.view.examSid = el.dataset.sid; };
ACT.assistHours = function(el){ S.view.assistHours = +el.dataset.h; };
ACT.examPlan    = function(el){ modalExamPlan(el.dataset.sid); return "skip"; };

ACT.newTopic  = function(el){ modalTopic(el.dataset.sid,null); return "skip"; };
ACT.saveTopic = function(el){
  var s=subj(el.dataset.sid), name=val("f_tn");
  if(!name){ toast("Nhập tên chủ đề đã"); return "skip"; }
  var t = el.dataset.tid ? topicById(s,el.dataset.tid) : null;
  if(!t){ t = newTopic(name, null); s.topics.push(t); }
  t.name = name;
  t.week = val("f_tw") ? +val("f_tw") : null;
  closeModal();
};
ACT.delTopic = function(el){
  var s=subj(el.dataset.sid);
  s.topics = s.topics.filter(function(x){ return x.id!==el.dataset.tid; });
};
ACT.seedTopics = function(el){
  var s=subj(el.dataset.sid), n=seedTopicsFromWeeks(s);
  toast(n ? "Đã tạo "+n+" chủ đề" : "Chưa có tuần nào được đặt tên chủ đề");
};
ACT.topicFlag = function(el){
  var s=subj(el.dataset.sid), t=topicById(s,el.dataset.tid), k=el.dataset.k;
  t[k] = !t[k];
  if(k==="learned" && t.learned){
    if(!t.learnedAt) t.learnedAt = iso(today());
    if(!t.nextReview) t.nextReview = iso(addDays(today(), SRS_STEPS[0]));
    awardXP(10);
  }
};
ACT.setConf = function(el){
  var s=subj(el.dataset.sid), t=topicById(s,el.dataset.tid), c=+el.dataset.c;
  t.confidence = (t.confidence===c) ? 0 : c;
};
ACT.review = function(el){
  var s=subj(el.dataset.sid), t=topicById(s,el.dataset.tid), okd = el.dataset.ok==="1";
  scheduleReview(t, okd);
  if(okd){
    t.confidence = Math.min(5,(t.confidence||2)+1);
    awardXP(10);
    toast("Tốt — ôn lại sau "+SRS_STEPS[t.level]+" ngày");
  }else{
    t.confidence = Math.max(1,(t.confidence||3)-1);
    awardXP(5);
    toast("Sẽ nhắc lại sau "+SRS_STEPS[t.level]+" ngày");
  }
};

ACT.newNote  = function(el){ modalNote(el.dataset.sid,null); return "skip"; };
ACT.editNote = function(el){ modalNote(el.dataset.sid,el.dataset.nid); return "skip"; };
ACT.openNote = function(el){ S.view.noteId = el.dataset.nid; };
ACT.saveNote = function(el){
  var s=subj(el.dataset.sid), n=null;
  if(!val("f_nt")){ toast("Nhập tiêu đề đã"); return "skip"; }
  for(var i=0;i<s.notes.length;i++) if(s.notes[i].id===el.dataset.nid) n=s.notes[i];
  if(!n){ n={id:uid()}; s.notes.push(n); awardXP(5); }
  n.title=val("f_nt"); n.kind=val("f_nk");
  n.week = val("f_nw") ? +val("f_nw") : null;
  n.body = $("f_nb") ? $("f_nb").value : "";
  n.updated = iso(today());

  if(noteDraft){
    if(noteDraft.busy){ toast("Đợi ảnh xử lý xong đã"); return "skip"; }
    n.images = noteDraft.images.slice();
    /* ảnh đã gỡ khỏi ghi chú thì xoá luôn khỏi kho */
    var keep = {};
    for(i=0;i<n.images.length;i++) keep[n.images[i].id] = 1;
    noteDraft.orig.concat(noteDraft.added).forEach(function(id){ if(!keep[id]) imgDel(id); });
    noteDraft.saved = true;
  }

  S.view.noteId = n.id;
  closeModal();
};
ACT.delNote = function(el){
  if(!confirm("Xoá ghi chú này?")) return "skip";
  var s=subj(el.dataset.sid);
  for(var i=0;i<s.notes.length;i++)
    if(s.notes[i].id===el.dataset.nid) (s.notes[i].images||[]).forEach(function(im){ imgDel(im.id); });
  s.notes = s.notes.filter(function(x){ return x.id!==el.dataset.nid; });
  S.view.noteId = null;
};

/* --- ảnh trong ghi chú --- */
ACT.pickNoteImg = function(){
  var inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/png,image/jpeg,image/webp,image/gif";
  inp.multiple = true;
  inp.onchange = function(){ if(inp.files && inp.files.length) addNoteFiles(inp.files, false); };
  inp.click();
  return "skip";
};
ACT.insertNoteImg = function(el){
  if(!noteDraft) return "skip";
  for(var i=0;i<noteDraft.images.length;i++)
    if(noteDraft.images[i].id===el.dataset.iid) insertNoteImgMd(noteDraft.images[i]);
  toast("Đã chèn vào nội dung");
  return "skip";
};
ACT.rmNoteImg = function(el){
  if(!noteDraft) return "skip";
  var id = el.dataset.iid;
  noteDraft.images = noteDraft.images.filter(function(x){ return x.id!==id; });
  /* gỡ luôn đoạn markdown đang trỏ tới ảnh này */
  var ta = $("f_nb");
  if(ta) ta.value = ta.value.replace(new RegExp("!\\[[^\\]]*\\]\\(img:"+id+"\\)\\n?","g"), "");
  paintNoteImgs();
  return "skip";
};
ACT.lightbox   = function(el){ openLightbox(el.dataset.iid || el.getAttribute("data-img")); return "skip"; };
ACT.closeLight = function(){ $("modal-root").innerHTML = ""; return "skip"; };
ACT.noop       = function(){ return "skip"; };

ACT.newLib  = function(el){ modalLib(el.dataset.sid,null); return "skip"; };
ACT.editLib = function(el){ modalLib(el.dataset.sid,el.dataset.lid); return "skip"; };
ACT.saveLib = function(el){
  var s=subj(el.dataset.sid), it=null;
  if(!val("f_ltl")){ toast("Nhập tên đã"); return "skip"; }
  for(var i=0;i<s.library.length;i++) if(s.library[i].id===el.dataset.lid) it=s.library[i];
  if(!it){ it={id:uid()}; s.library.push(it); }
  it.type=val("f_lt"); it.title=val("f_ltl");
  it.week = val("f_lw") ? +val("f_lw") : null;
  it.body = $("f_lb") ? $("f_lb").value : "";
  closeModal();
};
ACT.delLib = function(el){
  var s=subj(el.dataset.sid);
  s.library = s.library.filter(function(x){ return x.id!==el.dataset.lid; });
};

ACT.newRes  = function(el){ modalRes(el.dataset.sid,null); return "skip"; };
ACT.editRes = function(el){ modalRes(el.dataset.sid,el.dataset.rid); return "skip"; };
ACT.saveRes = function(el){
  var s=subj(el.dataset.sid), r=null;
  if(!val("f_rl")){ toast("Nhập tên tài liệu đã"); return "skip"; }
  for(var i=0;i<s.resources.length;i++) if(s.resources[i].id===el.dataset.rid) r=s.resources[i];
  if(!r){ r={id:uid()}; s.resources.push(r); }
  r.label=val("f_rl"); r.kind=val("f_rk"); r.url=val("f_ru");
  r.week = val("f_rw") ? +val("f_rw") : null;
  closeModal();
};
ACT.delRes = function(el){
  var s=subj(el.dataset.sid);
  s.resources = s.resources.filter(function(x){ return x.id!==el.dataset.rid; });
};

ACT.examCheck = function(el){
  var s=subj(el.dataset.sid), cl=examChecklist(s), i=+el.dataset.i;
  cl[i].done = !cl[i].done;
  if(cl[i].done) awardXP(20,true);
};
ACT.addExamItem = function(el){
  examChecklist(subj(el.dataset.sid));            /* dựng sẵn checklist nếu môn chưa có */
  adding = {kind:"exam", sid:el.dataset.sid, value:""};
  return "justRender";
};
ACT.delExamItem = function(el){
  examChecklist(subj(el.dataset.sid)).splice(+el.dataset.i,1);
};

ACT.attend = function(el){
  var s=subj(el.dataset.sid), n=+el.dataset.wk, c=el.dataset.c;
  for(var i=0;i<s.weeks.length;i++) if(s.weeks[i].n===n){
    s.weeks[i].attend[c] = !s.weeks[i].attend[c];
    if(s.weeks[i].attend[c]) awardXP(5);
  }
};

ACT.pomoStart = function(el){
  if(S.timer) ACT.stopTimer();
  pomoStart(el.dataset.sid, el.dataset.label||"");
  closeModal();
  toast("Bắt đầu "+S.settings.focusMin+" phút tập trung");
};
ACT.pomoFrom = function(el){
  if(S.pomo){ toast("Đang có phiên pomodoro chạy rồi"); return "skip"; }
  if(S.timer) ACT.stopTimer();
  pomoStart(el.dataset.sid, el.dataset.label||"");
  toast("Bắt đầu "+S.settings.focusMin+" phút tập trung");
};
ACT.pomoStop = function(){ pomoStop(); };
ACT.pomoSkip = function(){ pomoAdvance(); return "skip"; };

/* CHG — các ô nhập trong Cài đặt và ô tìm kiếm thư viện */
CHG.setGoal   = function(el){ S.settings.weeklyGoal = Math.max(0,+el.value||0); };
CHG.setFocus  = function(el){ S.settings.focusMin  = clamp(+el.value||25,5,120); };
CHG.setBreak  = function(el){ S.settings.breakMin  = clamp(+el.value||5,1,60); };
CHG.setGamify = function(el){ S.settings.gamify    = el.checked; };
CHG.libSearch = function(el){ S.view.libQuery = el.value; };

/* gõ tới đâu lọc tới đó, không đợi rời ô */
document.addEventListener("input", function(ev){
  var el = ev.target.closest ? ev.target.closest('[data-act="libSearch"]') : null;
  if(!el) return;
  S.view.libQuery = el.value;
  var pos = el.selectionStart;
  save(); render();
  var again = document.querySelector('[data-act="libSearch"]');
  if(again){ again.focus(); try{ again.setSelectionRange(pos,pos); }catch(e){} }
});

/* dán ảnh (Ctrl/⌘+V) khi đang mở hộp thoại ghi chú */
document.addEventListener("paste", function(ev){
  if(!noteDraft || !ev.clipboardData) return;
  var t = ev.target;
  if(!(t && t.closest && t.closest("#modal-root"))) return;
  var items = ev.clipboardData.items || [], files = [], i;
  for(i=0;i<items.length;i++)
    if(items[i].kind==="file" && /^image\//.test(items[i].type)){
      var f = items[i].getAsFile();
      if(f) files.push(f);
    }
  if(!files.length) return;          // dán chữ thì cứ để trình duyệt làm việc của nó
  ev.preventDefault();
  addNoteFiles(files, t.id==="f_nb");
});

/* kéo thả ảnh vào hộp thoại ghi chú */
function inNoteModal(ev){
  var t = ev.target;
  return !!(noteDraft && t && t.closest && t.closest("#modal-root .modal"));
}
function overNoteBody(ev){
  return !!(ev.target && ev.target.closest && ev.target.closest("#f_nb"));
}
function clearDragMark(){
  var z = $("f_attach"); if(z) z.classList.remove("dragging");
  var ta = $("f_nb");    if(ta) ta.classList.remove("dropping");
}
document.addEventListener("dragover", function(ev){
  if(!inNoteModal(ev)) return;
  ev.preventDefault();
  if(ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
  /* thả lên vùng soạn thảo thì chèn vào đúng chỗ đó, thả chỗ khác thì chỉ đính kèm */
  var onBody = overNoteBody(ev);
  var ta = $("f_nb"), z = $("f_attach");
  if(ta) ta.classList.toggle("dropping", onBody);
  if(z)  z.classList.toggle("dragging", !onBody);
});
document.addEventListener("dragleave", function(ev){
  if(!noteDraft) return;
  var to = ev.relatedTarget;
  if(to && to.closest && to.closest("#modal-root .modal")) return;   // vẫn còn trong hộp thoại
  clearDragMark();
});
document.addEventListener("drop", function(ev){
  if(!inNoteModal(ev)) return;
  ev.preventDefault();
  clearDragMark();
  var files = ev.dataTransfer && ev.dataTransfer.files;
  if(!files || !files.length) return;

  var ta = $("f_nb");
  if(ta && overNoteBody(ev)){
    /* đặt con trỏ đúng vào chỗ vừa thả, rồi mới chèn ảnh vào đó */
    var pos = caretPosFromPoint(ta, ev.clientX, ev.clientY);
    if(pos===null) pos = ta.selectionStart;
    pos = snapToLine(ta.value, pos);
    ta.focus();
    try{ ta.setSelectionRange(pos, pos); }catch(e){}
    addNoteFiles(files, true);
  } else {
    addNoteFiles(files, false);
  }
});
/* thả ảnh ra ngoài hộp thoại thì đừng để trình duyệt mở file, mất hết dữ liệu đang gõ */
document.addEventListener("dragover", function(ev){
  if(ev.dataTransfer && ev.dataTransfer.types && ev.dataTransfer.types.indexOf("Files")>=0) ev.preventDefault();
});
document.addEventListener("drop", function(ev){
  if(ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) ev.preventDefault();
});

boot();
