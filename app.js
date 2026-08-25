const SUPABASE_URL = "https://dkzumydszfgpdxatyrys.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_igHy73rTVLP5ziIJxgSC_Q_-Lt5B5oL";
const PERIOD = "2026_test";
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const SECTION_META = {
  company_results: ["① 全社共通の成果評価", "評価項目は共通ですが、点数は社員ごとの実績をもとに役員が入力します。"],
  common_behavior: ["② 共通の行動評価", "本人の自己評価、管理職の一次評価、面談後評価を比較します。"],
  department_results: ["③ 部署固有の成果評価", "部署ごとの成果について管理職が評価します。"],
  department_behavior: ["④ 部署固有の能力・行動評価", "職種固有の知識・スキル・行動を評価します。"]
};
const SECTION_ORDER = ["company_results","common_behavior","department_results","department_behavior"];
const STATUS_LABELS = {
  self_draft:"自己評価 下書き", self_submitted:"自己評価 提出済み",
  primary_draft:"一次評価", primary_submitted:"一次評価 提出済み",
  interview_draft:"面談後評価", interview_submitted:"面談後評価 提出済み",
  growth_meeting:"成長会議", finalized:"最終確定"
};
const STAGE_META = {
  self: {title:"自己評価", field:"self_scores", comment:"self_comment", can:"self_can_score"},
  primary:{title:"一次評価", field:"primary_scores", comment:"primary_comment", can:"primary_can_score"},
  interview:{title:"面談後評価", field:"interview_scores", comment:"interview_comment", can:"interview_can_score"},
  executive:{title:"役員評価・最終調整", field:"executive_scores", comment:"executive_comment", can:"executive_can_score"}
};

let profile=null, records=[], employeeMap=new Map(), templateCache=new Map(), itemCache=new Map();
let activeStage=null, activeRecord=null, activeItems=[];

const $ = (id)=>document.getElementById(id);
const loginView=$("loginView"), appView=$("appView"), dashboardView=$("dashboardView"),
      listView=$("listView"), evaluationView=$("evaluationView"), executiveView=$("executiveView");

function esc(v=""){return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function key(id){return `item_${id}`}
function msg(el,text="",type=""){el.textContent=text;el.className="message"+(type?` ${type}`:"")}
function internalEmail(id){return `${id.trim().toLowerCase()}@internal.local`}
function showOnly(view){
  [dashboardView,listView,evaluationView,executiveView].forEach(v=>v.classList.add("hidden"));
  view.classList.remove("hidden");
  $("homeButton").classList.toggle("hidden", view===dashboardView);
}
function criteriaFor(item,stage){
  const c=item.criteria||{};
  if(stage==="self" && c.self) return c.self;
  if(["primary","interview","executive"].includes(stage) && c.manager) return c.manager;
  return c.shared||c.manager||c.self||{};
}
function stageScore(record,stage,itemId){
  return Number((record[STAGE_META[stage]?.field]||{})[key(itemId)]||0)||null;
}
function effectiveInterviewScore(record,item){
  if(item.section==="company_results") return Number((record.executive_scores||{})[key(item.id)]||0)||null;
  return Number((record.interview_scores||{})[key(item.id)]||0)||Number((record.primary_scores||{})[key(item.id)]||0)||null;
}
function effectiveFinalScore(record,item){
  return Number((record.final_scores||{})[key(item.id)]||0)||effectiveInterviewScore(record,item);
}
function weighted(items, scoreFn){
  return items.reduce((sum,i)=>{const s=scoreFn(i); return sum+(s?Number(i.weight)*s:0)},0);
}
function filledCount(items, scores, canField){
  return items.filter(i=>i[canField]).filter(i=>scores[key(i.id)]).length;
}

async function loadBase(){
  const {data:{user}}=await client.auth.getUser();
  if(!user) return false;

  const {data:p,error:pe}=await client.from("profiles")
    .select("id,login_id,display_name,role,is_active,employee_id,can_self,can_manage,can_executive,can_hr")
    .eq("id",user.id).single();
  if(pe||!p) throw pe||new Error("プロフィールを取得できません");
  profile=p;

  const {data:r,error:re}=await client.from("evaluation_records")
    .select("*").eq("evaluation_period",PERIOD).order("employee_id");
  if(re) throw re;
  records=r||[];

  const empIds=[...new Set(records.map(x=>x.employee_id))];
  if(empIds.length){
    const {data:e,error:ee}=await client.from("employees")
      .select("id,employee_code,name,department,job_level").in("id",empIds);
    if(ee) throw ee;
    (e||[]).forEach(x=>employeeMap.set(x.id,x));
  }

  $("accountBadge").textContent=`${profile.display_name} (${profile.login_id})`;
  return true;
}

async function getTemplate(id){
  if(templateCache.has(id)) return templateCache.get(id);
  const {data,error}=await client.from("evaluation_templates")
    .select("id,department,job_level,name,version").eq("id",id).single();
  if(error) throw error;
  templateCache.set(id,data); return data;
}
async function getItems(templateId){
  if(itemCache.has(templateId)) return itemCache.get(templateId);
  const {data,error}=await client.from("evaluation_items")
    .select("id,template_id,section,category,category_description,item_text,weight,item_type,criteria,note,sort_order,self_can_score,primary_can_score,interview_can_score,executive_can_score")
    .eq("template_id",templateId).order("sort_order");
  if(error) throw error;
  itemCache.set(templateId,data||[]); return data||[];
}

function renderDashboard(){
  $("pageTitle").textContent="ダッシュボード";
  showOnly(dashboardView);
  const own=records.find(r=>r.employee_id===profile.employee_id);
  $("welcomePanel").innerHTML=`
    <span class="eyebrow">WELCOME</span>
    <h2>${esc(profile.display_name)} さん</h2>
    <p>権限に応じて利用できる評価メニューを表示しています。デモ版では1アカウントに複数権限を持たせています。</p>`;

  const cards=[];
  if(profile.can_self) cards.push({type:"self",icon:"◎",title:"自己評価",desc:"自分自身の評価を入力します。",count:own?1:0});
  if(profile.can_manage){
    const count=records.filter(r=>r.primary_evaluator_user_id===profile.id && r.employee_id!==profile.employee_id).length;
    cards.push({type:"primary",icon:"▣",title:"一次評価",desc:"部下の自己評価を確認しながら管理職評価を入力します。",count});
    cards.push({type:"interview",icon:"◇",title:"面談後評価",desc:"自己評価と一次評価を比較し、面談後の点数を決めます。",count});
  }
  if(profile.can_executive){
    cards.push({type:"executive",icon:"★",title:"役員・成長会議",desc:"全社員一覧、全社成果評価、最終調整を行います。",count:records.length});
  }

  $("permissionCards").innerHTML=cards.map(c=>`
    <button class="permission-card" data-menu="${c.type}">
      <span class="count">${c.count}</span>
      <div class="icon">${c.icon}</div>
      <h3>${c.title}</h3>
      <p>${c.desc}</p>
    </button>`).join("");

  document.querySelectorAll("[data-menu]").forEach(b=>b.onclick=()=>openMenu(b.dataset.menu));

  const tasks=[];
  if(own) tasks.push(taskHtml(own,"self","自分の自己評価"));
  records.filter(r=>r.primary_evaluator_user_id===profile.id && r.employee_id!==profile.employee_id)
    .forEach(r=>tasks.push(taskHtml(r,"primary",`${employeeMap.get(r.employee_id)?.name||"-"} の一次評価`)));
  $("taskList").innerHTML=tasks.length?tasks.join(""):`<p>現在のタスクはありません。</p>`;
  document.querySelectorAll("[data-open-stage]").forEach(b=>b.onclick=()=>openEvaluation(Number(b.dataset.record),b.dataset.openStage));
}

function taskHtml(r,stage,label){
  const e=employeeMap.get(r.employee_id);
  return `<div class="task-row">
    <div><div class="row-title">${esc(label)}</div><div class="row-meta">${esc(e?.department||"")} / ${esc(e?.job_level||"")} · ${esc(STATUS_LABELS[r.workflow_status]||r.workflow_status)}</div></div>
    <button class="secondary" data-record="${r.id}" data-open-stage="${stage}">開く</button>
  </div>`;
}

function openMenu(type){
  if(type==="self"){
    const own=records.find(r=>r.employee_id===profile.employee_id);
    if(own) openEvaluation(own.id,"self"); return;
  }
  if(type==="executive"){renderExecutive();return}
  renderEmployeeList(type);
}

function renderEmployeeList(stage){
  activeStage=stage;
  $("pageTitle").textContent=STAGE_META[stage].title;
  $("listTitle").textContent=stage==="primary"?"一次評価対象者":"面談後評価対象者";
  $("listDescription").textContent=stage==="primary"
    ?"本人の自己評価と比較しながら一次評価を行います。"
    :"自己評価と一次評価を比較しながら、面談で合意した点数を入力します。";
  const targets=records.filter(r=>r.primary_evaluator_user_id===profile.id && r.employee_id!==profile.employee_id);
  $("employeeList").innerHTML=targets.map(r=>{
    const e=employeeMap.get(r.employee_id);
    return `<div class="employee-row">
      <div><div class="row-title">${esc(e.name)}</div><div class="row-meta">${esc(e.employee_code)} / ${esc(e.department)} / ${esc(e.job_level)} · <span class="status-chip">${esc(STATUS_LABELS[r.workflow_status]||r.workflow_status)}</span></div></div>
      <button class="secondary" data-record="${r.id}" data-stage="${stage}">評価する</button>
    </div>`;
  }).join("");
  document.querySelectorAll("[data-stage]").forEach(b=>b.onclick=()=>openEvaluation(Number(b.dataset.record),b.dataset.stage));
  showOnly(listView);
}

async function openEvaluation(recordId,stage){
  activeStage=stage;
  activeRecord=records.find(r=>r.id===recordId);
  if(!activeRecord) return;
  const emp=employeeMap.get(activeRecord.employee_id);
  const tpl=await getTemplate(activeRecord.template_id);
  activeItems=await getItems(activeRecord.template_id);

  $("pageTitle").textContent=STAGE_META[stage].title;
  $("stageEyebrow").textContent=stage==="executive"?"EXECUTIVE REVIEW":stage.toUpperCase()+" EVALUATION";
  $("targetName").textContent=emp.name;
  $("targetMeta").textContent=`${emp.employee_code} / ${emp.department} / ${emp.job_level} / ${tpl.name}`;
  $("commentTitle").textContent=`${STAGE_META[stage].title}コメント`;
  $("stageComment").value=activeRecord[STAGE_META[stage].comment]||"";
  $("scoreLabel").textContent=stage==="executive"?"現在の最終評価":"入力加重点数";

  const notices={
    self:"②共通行動と④部署固有能力・行動を本人が自己評価します。①と③は入力対象外です。",
    primary:"自己評価を確認しながら評価します。①全社共通成果は役員のみ、③部署固有成果は管理職が入力します。",
    interview:"自己評価と一次評価を比較し、面談後に合意した点数を入力します。①全社共通成果は役員のみです。",
    executive:"役員専用画面です。①全社共通成果を社員ごとに入力し、成長会議では他セクションの経緯を確認して最終評価を調整できます。"
  };
  $("stageNotice").textContent=notices[stage];
  $("stageNotice").classList.toggle("executive",stage==="executive");

  renderSections();
  updateEvalSummary();
  showOnly(evaluationView);
}

function renderSections(){
  const scores=activeRecord[STAGE_META[activeStage].field]||{};
  $("evaluationSections").innerHTML="";
  for(const section of SECTION_ORDER){
    const items=activeItems.filter(i=>i.section===section);
    if(!items.length) continue;
    const [title,desc]=SECTION_META[section];
    const d=document.createElement("details"); d.className="eval-section card"; d.open=true;
    d.innerHTML=`<summary><div><span class="eyebrow">SECTION</span><h2>${esc(title)}</h2><p>${esc(desc)}</p></div><span class="section-pill">${items.length}項目</span></summary><div class="section-content"></div>`;
    const content=d.querySelector(".section-content");
    const cats=[...new Set(items.map(i=>i.category||""))];
    cats.forEach(cat=>{
      const group=items.filter(i=>(i.category||"")===cat);
      const wrap=document.createElement("div");wrap.className="category";
      wrap.innerHTML=`<div class="category-header"><h3>${esc(cat.replaceAll("\\n","\n"))}</h3>${group[0].category_description?`<p>${esc(group[0].category_description)}</p>`:""}</div>`;
      group.forEach(i=>wrap.appendChild(renderItem(i,scores)));
      content.appendChild(wrap);
    });
    $("evaluationSections").appendChild(d);
  }
}

function mini(label,val,active=false){
  return `<div class="score-mini ${active?"active":""}"><span>${label}</span><strong>${val||"-"}</strong></div>`;
}

function renderItem(item,scores){
  const el=document.createElement("div");el.className="eval-item";
  const self=Number((activeRecord.self_scores||{})[key(item.id)]||0)||null;
  const primary=Number((activeRecord.primary_scores||{})[key(item.id)]||0)||null;
  const interview=Number((activeRecord.interview_scores||{})[key(item.id)]||0)||null;
  const executive=Number((activeRecord.executive_scores||{})[key(item.id)]||0)||null;
  const final=Number((activeRecord.final_scores||{})[key(item.id)]||0)||null;
  const canField=STAGE_META[activeStage].can;
  const canInput=!!item[canField] || activeStage==="executive";
  const current=Number(scores[key(item.id)]||0)||null;
  const criteria=criteriaFor(item,activeStage);

  let comparison="";
  if(activeStage==="primary") comparison=mini("自己",self)+mini("一次",current,true);
  else if(activeStage==="interview") comparison=mini("自己",self)+mini("一次",primary)+mini("面談後",current,true);
  else if(activeStage==="executive") comparison=mini("自己",self)+mini("一次",primary)+mini("面談後",interview)+mini("最終",final||effectiveFinalScore(activeRecord,item),true);

  const options=[5,4,3,2,1].map(n=>`<option value="${n}" ${current===n?"selected":""}>${n}</option>`).join("");
  const selectedText=current&&criteria[String(current)]?criteria[String(current)]:"点数を選択すると評価基準を表示します。";
  const criteriaRows=[5,4,3,2,1].filter(n=>criteria[String(n)]).map(n=>`<div class="criteria-row"><strong>${n}</strong><span>${esc(criteria[String(n)])}</span></div>`).join("");

  let inputHtml="";
  if(canInput){
    inputHtml=`<div class="input-box">
      <label>${activeStage==="executive" && item.section!=="company_results"?"最終評価（変更時のみ）":STAGE_META[activeStage].title}
        <select data-item="${item.id}">
          <option value="">未入力</option>${options}
        </select>
      </label>
      <div class="criteria-box" data-criteria="${item.id}">${esc(selectedText)}</div>
    </div>`;
  }else{
    const ro = item.section==="company_results" ? executive : (activeStage==="self"?null:current);
    inputHtml=`<div class="readonly-note">${item.section==="company_results"?"この項目は役員が入力します。": "この段階では入力対象外です。"}${ro?` 現在値：${ro}`:""}</div>`;
  }

  el.innerHTML=`<div class="item-grid">
    <div>
      <h3 class="item-title">${esc(item.item_text)}</h3>
      ${comparison?`<div class="comparison">${comparison}</div>`:""}
      ${criteriaRows?`<details class="criteria-details"><summary>評価基準を見る</summary>${criteriaRows}</details>`:""}
      ${item.note?`<p class="item-note">${esc(item.note)}</p>`:""}
    </div>
    ${inputHtml}
  </div>`;

  const sel=el.querySelector("[data-item]");
  if(sel){
    sel.onchange=()=>{
      const n=sel.value;
      const box=el.querySelector("[data-criteria]");
      box.textContent=n&&criteria[n]?criteria[n]:"点数を選択すると評価基準を表示します。";
      updateEvalSummary();
    };
  }
  return el;
}

function collectCurrent(){
  const out={};
  document.querySelectorAll("[data-item]").forEach(s=>{if(s.value)out[key(s.dataset.item)]=Number(s.value)});
  return out;
}
function updateEvalSummary(){
  const scores=collectCurrent();
  const canField=STAGE_META[activeStage].can;
  let eligible=activeItems.filter(i=>i[canField]);
  if(activeStage==="executive") eligible=activeItems;
  $("inputProgress").textContent=`${Object.keys(scores).length} / ${eligible.length}`;

  let value=0;
  if(activeStage==="executive"){
    const temp={...activeRecord,executive_scores:{...activeRecord.executive_scores,...scores},final_scores:{...activeRecord.final_scores,...scores}};
    value=weighted(activeItems,i=>effectiveFinalScore(temp,i));
  }else{
    value=weighted(activeItems.filter(i=>i[canField]),i=>scores[key(i.id)]||null);
  }
  $("currentScore").textContent=value.toFixed(1);
}

async function saveStage(submit=false){
  msg($("saveMessage"));
  const scores=collectCurrent();
  const stage=STAGE_META[activeStage];
  const patch={updated_at:new Date().toISOString()};
  patch[stage.field]=scores;
  patch[stage.comment]=$("stageComment").value.trim()||null;

  if(activeStage==="self" && submit){patch.workflow_status="self_submitted";patch.self_submitted_at=new Date().toISOString()}
  if(activeStage==="primary" && submit){patch.workflow_status="primary_submitted";patch.primary_submitted_at=new Date().toISOString()}
  if(activeStage==="interview" && submit){patch.workflow_status="interview_submitted";patch.interview_submitted_at=new Date().toISOString()}
  if(activeStage==="executive"){
    const exec={},final={...activeRecord.final_scores};
    activeItems.forEach(i=>{
      const v=scores[key(i.id)];
      if(!v)return;
      if(i.section==="company_results") exec[key(i.id)]=v;
      else final[key(i.id)]=v;
    });
    patch.executive_scores={...activeRecord.executive_scores,...exec};
    patch.final_scores=final;
    patch.executive_saved_at=new Date().toISOString();
    if(submit){patch.workflow_status="finalized";patch.finalized_at=new Date().toISOString()}
    delete patch.executive_scores;
    delete patch.final_scores;
    patch.executive_scores={...activeRecord.executive_scores,...exec};
    patch.final_scores=final;
  }

  const {data,error}=await client.from("evaluation_records").update(patch).eq("id",activeRecord.id).select("*").single();
  if(error){msg($("saveMessage"),error.message,"error");return}
  activeRecord=data;
  const idx=records.findIndex(r=>r.id===data.id); if(idx>=0)records[idx]=data;
  msg($("saveMessage"),submit?"提出・確定しました。":"一時保存しました。","success");
  if(submit && activeStage!=="executive") setTimeout(()=>renderDashboard(),500);
  if(submit && activeStage==="executive") setTimeout(()=>renderExecutive(),500);
}

async function renderExecutive(){
  $("pageTitle").textContent="役員・成長会議";
  const depts=[...new Set([...employeeMap.values()].map(e=>e.department).filter(Boolean))];
  $("departmentFilter").innerHTML=`<option value="">全部署</option>`+depts.map(d=>`<option>${esc(d)}</option>`).join("");
  $("departmentFilter").onchange=renderExecutiveRows;
  $("statusFilter").onchange=renderExecutiveRows;
  await renderExecutiveRows();
  showOnly(executiveView);
}

async function renderExecutiveRows(){
  const rows=[];
  for(const r of records){
    const e=employeeMap.get(r.employee_id); if(!e)continue;
    const items=await getItems(r.template_id);
    const interviewTotal=weighted(items,i=>effectiveInterviewScore(r,i));
    const finalTotal=weighted(items,i=>effectiveFinalScore(r,i));
    const diffs=items.reduce((n,i)=>{
      const a=Number((r.self_scores||{})[key(i.id)]||0), b=Number((r.primary_scores||{})[key(i.id)]||0);
      return n+(a&&b&&Math.abs(a-b)>=2?1:0);
    },0);
    rows.push({r,e,interviewTotal,finalTotal,diffs});
  }
  const dep=$("departmentFilter").value, st=$("statusFilter").value;
  const filtered=rows.filter(x=>(!dep||x.e.department===dep)&&(!st||x.r.workflow_status===st));
  $("executiveTable").innerHTML=`<div class="table-wrap"><table class="exec-table">
    <thead><tr><th>社員</th><th>部署・階層</th><th>面談後</th><th>現在の最終</th><th>自己/一次差異</th><th>状態</th><th></th></tr></thead>
    <tbody>${filtered.map(x=>`<tr>
      <td><strong>${esc(x.e.name)}</strong><br><span class="row-meta">${esc(x.e.employee_code)}</span></td>
      <td>${esc(x.e.department)}<br><span class="row-meta">${esc(x.e.job_level)}</span></td>
      <td class="score">${x.interviewTotal.toFixed(1)}</td>
      <td class="score">${x.finalTotal.toFixed(1)}</td>
      <td>${x.diffs?`<span class="diff-badge">${x.diffs}項目</span>`:"-"}</td>
      <td><span class="status-chip ${x.r.workflow_status==="finalized"?"done":""}">${esc(STATUS_LABELS[x.r.workflow_status]||x.r.workflow_status)}</span></td>
      <td><button class="secondary" data-exec="${x.r.id}">確認・調整</button></td>
    </tr>`).join("")}</tbody>
  </table></div>`;
  document.querySelectorAll("[data-exec]").forEach(b=>b.onclick=()=>openEvaluation(Number(b.dataset.exec),"executive"));
}

$("loginForm").onsubmit=async(e)=>{
  e.preventDefault();msg($("loginMessage"));
  const {error}=await client.auth.signInWithPassword({email:internalEmail($("loginId").value),password:$("password").value});
  if(error){msg($("loginMessage"),"IDまたはパスワードが違います。","error");return}
  try{await boot()}catch(err){console.error(err);msg($("loginMessage"),err.message||"初期化に失敗しました。","error")}
};
$("logoutButton").onclick=async()=>{await client.auth.signOut();location.reload()};
$("homeButton").onclick=renderDashboard;
$("saveButton").onclick=()=>saveStage(false);
$("saveTopButton").onclick=()=>saveStage(false);
$("evaluationForm").onsubmit=async(e)=>{e.preventDefault();if(confirm("この内容で提出・確定しますか？"))await saveStage(true)};
$("submitTopButton").onclick=async()=>{if(confirm("この内容で提出・確定しますか？"))await saveStage(true)};

async function boot(){
  await loadBase();
  loginView.classList.add("hidden");appView.classList.remove("hidden");
  renderDashboard();
}
(async()=>{
  const {data:{session}}=await client.auth.getSession();
  if(session){try{await boot()}catch(e){console.error(e);await client.auth.signOut()}}
})();
