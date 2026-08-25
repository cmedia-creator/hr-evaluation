const SUPABASE_URL="https://dkzumydszfgpdxatyrys.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_igHy73rTVLP5ziIJxgSC_Q_-Lt5B5oL";
const client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);

const SECTION_ORDER=["company_results","common_behavior","department_results","department_behavior"];
const SECTION_META={
  company_results:["① 全社共通の成果評価","項目は共通ですが、社員ごとの実績に基づき役員が評価します。"],
  common_behavior:["② 共通の行動評価","本人・一次評価者・面談後評価の推移を確認します。"],
  department_results:["③ 部署固有の成果評価","部署ごとの成果指標を管理職が評価します。"],
  department_behavior:["④ 部署固有の能力・行動評価","職種固有の知識・スキル・行動を評価します。"]
};
const STATUS_LABELS={
  self_draft:"自己評価 下書き",self_submitted:"自己評価 提出済み",
  primary_draft:"一次評価",primary_submitted:"一次評価 提出済み",
  interview_draft:"面談後評価",interview_submitted:"面談後評価 提出済み",
  growth_meeting:"成長会議",finalized:"最終確定"
};
const CYCLE_TYPE_LABELS={salary_raise:"昇給",summer_bonus:"夏季賞与",winter_bonus:"冬季賞与"};
const STAGE_META={
  self:{title:"自己評価",field:"self_scores",comment:"self_comment",can:"self_can_score"},
  primary:{title:"一次評価",field:"primary_scores",comment:"primary_comment",can:"primary_can_score"},
  interview:{title:"面談後評価",field:"interview_scores",comment:"interview_comment",can:"interview_can_score"},
  executive:{title:"役員評価・最終調整",field:"executive_scores",comment:"executive_comment",can:"executive_can_score"}
};

let profile=null,cycles=[],selectedCycle=null,allRecords=[],records=[];
let employeeMap=new Map(),templateCache=new Map(),itemCache=new Map();
let activeRecord=null,activeItems=[],activeStage=null,previousRecord=null,previousItems=[],draftCopied=false;

const $=id=>document.getElementById(id);
const views=["dashboardView","listView","evaluationView","executiveView"];
function esc(v=""){return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function itemKey(id){return`item_${id}`}
function setMsg(el,text="",type=""){el.textContent=text;el.className="message"+(type?` ${type}`:"")}
function internalEmail(id){return`${id.trim().toLowerCase()}@internal.local`}
function showView(id){
  views.forEach(v=>$(v).classList.add("hidden"));$(id).classList.remove("hidden");
  $("homeButton").classList.toggle("hidden",id==="dashboardView");
  document.querySelectorAll(".side-nav").forEach(n=>n.classList.remove("active"));
}
function setPage(title,subtitle,breadcrumb=title){
  $("pageTitle").textContent=title;$("pageSubtitle").textContent=subtitle;$("breadcrumbCurrent").textContent=breadcrumb;
}
function statusClass(status){return status==="finalized"?"done":(["growth_meeting","interview_submitted"].includes(status)?"warn":"")}
function scoreCriteria(item,stage){
  const c=item.criteria||{};
  if(stage==="self"&&c.self)return c.self;
  if(["primary","interview","executive"].includes(stage)&&c.manager)return c.manager;
  return c.shared||c.manager||c.self||{};
}
function weighted(items,scores){return items.reduce((sum,i)=>sum+(Number(scores?.[itemKey(i.id)]||0)*Number(i.weight||0)),0)}
function scoreByCode(record,items,targetItem,field){
  const same=items.find(i=>i.item_code===targetItem.item_code);
  return same?Number(record?.[field]?.[itemKey(same.id)]||0)||null:null;
}
function employeeInitial(name){return(name||"?").trim().slice(0,1)}

async function getTemplate(id){
  if(templateCache.has(id))return templateCache.get(id);
  const{data,error}=await client.from("evaluation_templates").select("*").eq("id",id).single();
  if(error)throw error;templateCache.set(id,data);return data;
}
async function getItems(templateId){
  if(itemCache.has(templateId))return itemCache.get(templateId);
  const{data,error}=await client.from("evaluation_items")
    .select("id,template_id,item_code,section,category,category_description,item_text,weight,item_type,criteria,note,sort_order,self_can_score,primary_can_score,interview_can_score,executive_can_score")
    .eq("template_id",templateId).order("sort_order");
  if(error)throw error;itemCache.set(templateId,data||[]);return data||[];
}

async function loadBase(){
  const{data:{user}}=await client.auth.getUser();if(!user)return false;
  const{data:p,error:pe}=await client.from("profiles").select("*").eq("id",user.id).single();
  if(pe)throw pe;profile=p;

  const{data:c,error:ce}=await client.from("evaluation_cycles").select("*").order("year",{ascending:false}).order("id",{ascending:true});
  if(ce)throw ce;cycles=c||[];
  selectedCycle=cycles.find(x=>x.status==="open")||cycles[0];

  const{data:r,error:re}=await client.from("evaluation_records").select("*").order("cycle_id").order("employee_id");
  if(re)throw re;allRecords=r||[];

  const ids=[...new Set(allRecords.map(r=>r.employee_id))];
  if(ids.length){
    const{data:e,error:ee}=await client.from("employees").select("id,employee_code,name,department,job_level").in("id",ids);
    if(ee)throw ee;(e||[]).forEach(x=>employeeMap.set(x.id,x));
  }
  records=allRecords.filter(r=>r.cycle_id===selectedCycle?.id);

  $("accountBadge").innerHTML=`<span>${esc(profile.display_name)}</span><small>${esc(profile.login_id)}</small>`;
  $("cycleSelector").innerHTML=cycles.map(c=>`<option value="${c.id}" ${c.id===selectedCycle?.id?"selected":""}>${esc(c.name)}</option>`).join("");
  $("cycleSelector").onchange=()=>{
    selectedCycle=cycles.find(c=>c.id===Number($("cycleSelector").value));
    records=allRecords.filter(r=>r.cycle_id===selectedCycle.id);
    renderDashboard();
  };
  configureNav();
  return true;
}
function configureNav(){
  $("selfNav").classList.toggle("hidden",!profile.can_self);
  $("primaryNav").classList.toggle("hidden",!profile.can_manage);
  $("interviewNav").classList.toggle("hidden",!profile.can_manage);
  $("executiveNav").classList.toggle("hidden",!profile.can_executive);
  document.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>navigate(b.dataset.nav));
}
function navigate(type){
  if(type==="dashboard")return renderDashboard();
  if(type==="self"){
    const own=records.find(r=>r.employee_id===profile.employee_id);
    if(own)return openEvaluation(own.id,"self");
  }
  if(type==="primary"||type==="interview")return renderEmployeeList(type);
  if(type==="executive")return renderExecutive();
}

function renderDashboard(){
  showView("dashboardView");setPage("ダッシュボード","評価業務の進捗と、対応が必要な項目を確認できます。");
  document.querySelector('[data-nav="dashboard"]').classList.add("active");
  $("currentCycleName").textContent=selectedCycle?.name||"-";
  $("currentCycleMeta").textContent=`${CYCLE_TYPE_LABELS[selectedCycle?.cycle_type]||""} / ${selectedCycle?.year||""}年度`;
  $("sidebarCycleName").textContent=selectedCycle?.name||"-";
  $("sidebarCycleStatus").textContent=selectedCycle?.status==="open"?"受付中":selectedCycle?.status==="closed"?"終了":"準備中";

  const own=records.find(r=>r.employee_id===profile.employee_id);
  $("selfProgressKpi").textContent=own?STATUS_LABELS[own.workflow_status]||"-":"対象なし";
  const managed=records.filter(r=>r.primary_evaluator_user_id===profile.id&&r.employee_id!==profile.employee_id);
  $("primaryCountKpi").textContent=`${managed.length}名`;
  $("executiveCountKpi").textContent=profile.can_executive?`${records.length}名`:"-";

  const cards=[];
  if(profile.can_self)cards.push({type:"self",icon:"◎",title:"自己評価",desc:"自分自身の行動・能力を評価します。",count:own?1:0});
  if(profile.can_manage){
    cards.push({type:"primary",icon:"▣",title:"一次評価",desc:"自己評価と前回評価を確認しながら部下を評価します。",count:managed.length});
    cards.push({type:"interview",icon:"◇",title:"面談後評価",desc:"自己評価と一次評価を比較し、面談後の点数を決定します。",count:managed.length});
  }
  if(profile.can_executive)cards.push({type:"executive",icon:"★",title:"成長会議・最終評価",desc:"全社員を横断確認し、成果評価と最終調整を行います。",count:records.length});
  $("permissionCards").innerHTML=cards.map(c=>`<button class="function-card" data-func="${c.type}">
    <div class="function-card-top"><span class="function-icon">${c.icon}</span><span class="function-count">${c.count}</span></div>
    <h3>${c.title}</h3><p>${c.desc}</p></button>`).join("");
  document.querySelectorAll("[data-func]").forEach(b=>b.onclick=()=>navigate(b.dataset.func));

  const tasks=[];
  if(own)tasks.push(taskRow(own,"self","自分の自己評価"));
  managed.forEach(r=>tasks.push(taskRow(r,"primary",`${employeeMap.get(r.employee_id)?.name||"-"} の一次評価`)));
  $("taskList").innerHTML=tasks.length?tasks.join(""):`<div class="task-row"><div></div><div><div class="row-title">現在の対応タスクはありません。</div></div><div></div><div></div></div>`;
  $("taskCountBadge").textContent=`${tasks.length}件`;
  document.querySelectorAll("[data-open-stage]").forEach(b=>b.onclick=()=>openEvaluation(Number(b.dataset.record),b.dataset.openStage));
}
function taskRow(r,stage,label){
  const e=employeeMap.get(r.employee_id);
  return`<div class="task-row">
    <div class="row-avatar">${esc(employeeInitial(e?.name))}</div>
    <div><div class="row-title">${esc(label)}</div><div class="row-meta">${esc(e?.employee_code||"")} / ${esc(e?.department||"")} / ${esc(e?.job_level||"")}</div></div>
    <span class="status-chip ${statusClass(r.workflow_status)}">${esc(STATUS_LABELS[r.workflow_status]||r.workflow_status)}</span>
    <button class="btn btn-secondary" data-record="${r.id}" data-open-stage="${stage}">開く</button>
  </div>`;
}

function renderEmployeeList(stage){
  activeStage=stage;showView("listView");
  const isPrimary=stage==="primary";
  setPage(isPrimary?"一次評価":"面談後評価",isPrimary?"本人の自己評価と前回評価を参考に、一次評価を入力します。":"本人と上司の評価を比較し、面談後の点数を決定します。");
  document.querySelector(`[data-nav="${stage}"]`)?.classList.add("active");
  $("listTitle").textContent=isPrimary?"一次評価対象者一覧":"面談後評価対象者一覧";
  $("listDescription").textContent=isPrimary?"担当する被評価者を選択してください。":"面談を実施する社員を選択してください。";
  $("employeeSearch").value="";
  renderEmployeeRows(stage,"");
  $("employeeSearch").oninput=()=>renderEmployeeRows(stage,$("employeeSearch").value.trim().toLowerCase());
}
function renderEmployeeRows(stage,q){
  const targets=records.filter(r=>r.primary_evaluator_user_id===profile.id&&r.employee_id!==profile.employee_id).filter(r=>{
    const e=employeeMap.get(r.employee_id);const hay=`${e?.name} ${e?.employee_code}`.toLowerCase();return!q||hay.includes(q);
  });
  $("employeeListCount").textContent=`${targets.length}名`;
  $("employeeList").innerHTML=targets.map(r=>{
    const e=employeeMap.get(r.employee_id);
    return`<div class="employee-row">
      <div class="row-avatar">${esc(employeeInitial(e?.name))}</div>
      <div><div class="row-title">${esc(e?.name||"-")}</div><div class="row-meta">${esc(e?.employee_code||"")} / ${esc(e?.department||"")} / ${esc(e?.job_level||"")}</div></div>
      <span class="status-chip ${statusClass(r.workflow_status)}">${esc(STATUS_LABELS[r.workflow_status]||r.workflow_status)}</span>
      <button class="btn btn-secondary" data-record="${r.id}" data-stage="${stage}">評価する</button>
    </div>`;
  }).join("");
  document.querySelectorAll("[data-stage]").forEach(b=>b.onclick=()=>openEvaluation(Number(b.dataset.record),b.dataset.stage));
}

async function findPrevious(record){
  const currentCycle=cycles.find(c=>c.id===record.cycle_id);
  const candidates=allRecords.filter(r=>r.employee_id===record.employee_id&&r.id!==record.id).map(r=>({r,cycle:cycles.find(c=>c.id===r.cycle_id)}))
    .filter(x=>x.cycle&&x.cycle.year<=currentCycle.year&&x.cycle.id<currentCycle.id)
    .sort((a,b)=>b.cycle.id-a.cycle.id);
  return candidates[0]||null;
}

async function openEvaluation(recordId,stage){
  activeStage=stage;activeRecord=allRecords.find(r=>r.id===recordId);draftCopied=false;
  if(!activeRecord)return;
  const emp=employeeMap.get(activeRecord.employee_id),tpl=await getTemplate(activeRecord.template_id);
  activeItems=await getItems(activeRecord.template_id);
  const prev=await findPrevious(activeRecord);
  previousRecord=prev?.r||null;previousItems=previousRecord?await getItems(previousRecord.template_id):[];

  showView("evaluationView");setPage(STAGE_META[stage].title,`${emp.name}さんの${STAGE_META[stage].title}を入力します。`);
  document.querySelector(`[data-nav="${stage==="executive"?"executive":stage}"]`)?.classList.add("active");
  $("employeeAvatar").textContent=employeeInitial(emp.name);
  $("stageEyebrow").textContent=stage==="executive"?"EXECUTIVE REVIEW":stage.toUpperCase()+" EVALUATION";
  $("targetName").textContent=emp.name;
  $("targetMeta").textContent=`${emp.employee_code} / ${emp.department} / ${emp.job_level} / ${tpl.name} / ${selectedCycle?.name||""}`;
  $("commentTitle").textContent=`${STAGE_META[stage].title}コメント`;
  $("stageComment").value=activeRecord[STAGE_META[stage].comment]||"";

  const notices={
    self:"自己評価では②共通行動と④部署固有能力・行動を入力します。①と③は評価担当者が異なるため入力対象外です。",
    primary:"一次評価では自己評価と前回評価を確認できます。①全社共通成果は役員のみ入力、③部署固有成果は管理職が入力します。",
    interview:"面談後評価では自己評価・一次評価を比較し、面談後に決定した点数を入力します。①全社共通成果は役員のみ入力します。",
    executive:"役員専用画面です。①全社共通成果を社員ごとに入力し、成長会議ではこれまでの評価経緯と前回差分を確認しながら最終評価を調整します。"
  };
  $("stageNotice").textContent=notices[stage];$("stageNotice").classList.toggle("executive",stage==="executive");

  setupPreviousPanel();
  renderSections();
  updateEvalSummary();
}

function setupPreviousPanel(){
  if(!previousRecord){$("previousPanel").classList.add("hidden");return}
  $("previousPanel").classList.remove("hidden");$("previousTools").classList.add("hidden");
  const cycle=cycles.find(c=>c.id===previousRecord.cycle_id);
  $("previousSummary").textContent=`${cycle?.name||"前回評価"}を参考にできます。`;
  const totals={
    self:weighted(previousItems,previousRecord.self_scores),
    primary:weighted(previousItems,previousRecord.primary_scores),
    interview:weighted(previousItems,previousRecord.interview_scores),
    final:weighted(previousItems,previousRecord.final_scores)
  };
  $("prevSelfTotal").textContent=totals.self?totals.self.toFixed(1):"-";
  $("prevPrimaryTotal").textContent=totals.primary?totals.primary.toFixed(1):"-";
  $("prevInterviewTotal").textContent=totals.interview?totals.interview.toFixed(1):"-";
  $("prevFinalTotal").textContent=totals.final?totals.final.toFixed(1):"-";
  $("previousOverview").innerHTML=`<div class="workflow-notice">前回最終評価：<strong>${totals.final?totals.final.toFixed(1):"-"}</strong> 点。項目ごとの前回値は各評価項目に表示されます。</div>`;
  $("togglePreviousButton").onclick=()=>{
    $("previousTools").classList.toggle("hidden");
    $("togglePreviousButton").textContent=$("previousTools").classList.contains("hidden")?"前回評価を表示":"前回評価を閉じる";
  };
  $("copyAllButton").onclick=()=>copyPrevious();
  document.querySelectorAll(".section-copy").forEach(b=>b.onclick=()=>copyPrevious(b.dataset.section));
}
function previousScoreFor(item,field){
  if(!previousRecord)return null;
  const pi=previousItems.find(i=>i.item_code===item.item_code);
  return pi?Number(previousRecord[field]?.[itemKey(pi.id)]||0)||null:null;
}
function sourceFieldForStage(){
  if(activeStage==="self")return"self_scores";
  if(activeStage==="primary")return"primary_scores";
  if(activeStage==="interview")return"interview_scores";
  if(activeStage==="executive")return"final_scores";
  return"primary_scores";
}
function copyPrevious(section=null){
  if(!previousRecord)return;
  const sourceField=sourceFieldForStage();
  activeItems.forEach(item=>{
    if(section&&item.section!==section)return;
    const sel=document.querySelector(`[data-item="${item.id}"]`);
    if(!sel)return;
    const val=previousScoreFor(item,sourceField);
    if(val){sel.value=String(val);sel.dispatchEvent(new Event("change"))}
  });
  draftCopied=true;
  setMsg($("saveMessage"),section?`${SECTION_META[section][0]}を前回評価から反映しました。まだ保存されていません。`:"前回評価を入力欄へ反映しました。まだ保存されていません。","success");
}

function renderSections(){
  const scores=activeRecord[STAGE_META[activeStage].field]||{};
  $("evaluationSections").innerHTML="";
  SECTION_ORDER.forEach(section=>{
    const items=activeItems.filter(i=>i.section===section);if(!items.length)return;
    const [title,desc]=SECTION_META[section];
    const d=document.createElement("details");d.className="eval-section";d.open=true;
    d.innerHTML=`<summary><div><span class="panel-kicker">SECTION</span><h2>${esc(title)}</h2><p>${esc(desc)}</p></div><span class="section-pill">${items.length}項目</span></summary><div class="section-content"></div>`;
    const content=d.querySelector(".section-content");
    [...new Set(items.map(i=>i.category||""))].forEach(cat=>{
      const group=items.filter(i=>(i.category||"")===cat);
      const wrap=document.createElement("div");wrap.className="category";
      wrap.innerHTML=`<div class="category-header"><h3>${esc(cat.replaceAll("\\n","\n"))}</h3>${group[0].category_description?`<p>${esc(group[0].category_description)}</p>`:""}</div>`;
      group.forEach(i=>wrap.appendChild(renderItem(i,scores)));
      content.appendChild(wrap);
    });
    $("evaluationSections").appendChild(d);
  });
}
function mini(label,val,active=false){
  return`<div class="score-mini ${active?"active":""}"><span>${label}</span><strong>${val||"-"}</strong></div>`;
}
function renderItem(item,scores){
  const el=document.createElement("div");el.className="eval-item";
  const self=Number(activeRecord.self_scores?.[itemKey(item.id)]||0)||null;
  const primary=Number(activeRecord.primary_scores?.[itemKey(item.id)]||0)||null;
  const interview=Number(activeRecord.interview_scores?.[itemKey(item.id)]||0)||null;
  const executive=Number(activeRecord.executive_scores?.[itemKey(item.id)]||0)||null;
  const final=Number(activeRecord.final_scores?.[itemKey(item.id)]||0)||null;
  const prev=previousScoreFor(item,sourceFieldForStage());
  const canField=STAGE_META[activeStage].can;
  const canInput=activeStage==="executive" ? true : !!item[canField];
  const current=Number(scores[itemKey(item.id)]||0)||null;
  const criteria=scoreCriteria(item,activeStage);

  let comp="";
  if(activeStage==="self")comp=mini("前回",prev)+mini("今回",current,true);
  if(activeStage==="primary")comp=mini("自己",self)+mini("前回一次",prev)+mini("今回一次",current,true);
  if(activeStage==="interview")comp=mini("自己",self)+mini("一次",primary)+mini("前回面談後",prev)+mini("今回面談後",current,true);
  if(activeStage==="executive")comp=mini("一次",primary)+mini("面談後",interview)+mini("前回最終",prev)+mini("最終",final||current,true);

  const options=[5,4,3,2,1].map(n=>`<option value="${n}" ${current===n?"selected":""}>${n}</option>`).join("");
  const selectedText=current&&criteria[String(current)]?criteria[String(current)]:"点数を選択すると評価基準を表示します。";
  const criteriaRows=[5,4,3,2,1].filter(n=>criteria[String(n)]).map(n=>`<div class="criteria-row"><strong>${n}</strong><span>${esc(criteria[String(n)])}</span></div>`).join("");

  let side="";
  if(canInput){
    side=`<div class="input-box"><label>${activeStage==="executive"&&item.section!=="company_results"?"最終評価（変更時のみ）":STAGE_META[activeStage].title}
      <select data-item="${item.id}"><option value="">未入力</option>${options}</select></label>
      <div class="criteria-box" data-criteria="${item.id}">${esc(selectedText)}</div></div>`;
  }else{
    side=`<div class="readonly-note">${item.section==="company_results"?"この項目は役員のみ入力できます。":"この評価段階では入力対象外です。"}</div>`;
  }
  el.innerHTML=`<div class="item-main">
    <h3 class="item-title">${esc(item.item_text)}</h3>
    <div class="item-meta-row"><span class="meta-chip">ウェイト ${Number(item.weight).toFixed(2)}</span><span class="meta-chip">${item.item_type==="metric"?"成果":"行動・能力"}</span>${prev?`<span class="meta-chip">前回 ${prev}</span>`:""}</div>
    ${comp?`<div class="comparison">${comp}</div>`:""}
    ${criteriaRows?`<details class="criteria-details"><summary>1〜5点の評価基準を確認</summary>${criteriaRows}</details>`:""}
    ${item.note?`<p class="item-note">${esc(item.note)}</p>`:""}
  </div><div class="item-side">${side}</div>`;
  const sel=el.querySelector("[data-item]");
  if(sel)sel.onchange=()=>{
    const box=el.querySelector("[data-criteria]"),v=sel.value;
    box.textContent=v&&criteria[v]?criteria[v]:"点数を選択すると評価基準を表示します。";
    updateEvalSummary();
  };
  return el;
}

function collectCurrent(){
  const out={};document.querySelectorAll("[data-item]").forEach(s=>{if(s.value)out[itemKey(s.dataset.item)]=Number(s.value)});return out;
}
function updateEvalSummary(){
  const scores=collectCurrent();
  const canField=STAGE_META[activeStage].can;
  let eligible=activeStage==="executive"?activeItems:activeItems.filter(i=>i[canField]);
  $("inputProgress").textContent=`${Object.keys(scores).length} / ${eligible.length}`;
  $("inputProgressFill").style.width=`${eligible.length?Math.min(100,Object.keys(scores).length/eligible.length*100):0}%`;
  let value=0;
  if(activeStage==="executive"){
    const merged={...activeRecord.final_scores,...scores};
    value=weighted(activeItems,merged);
  }else value=weighted(eligible,scores);
  $("currentScore").textContent=value.toFixed(1);
  $("scoreMeterFill").style.width=`${Math.min(100,Math.max(0,value))}%`;
}

async function saveStage(submit=false){
  setMsg($("saveMessage"));
  const scores=collectCurrent(),stage=STAGE_META[activeStage],patch={updated_at:new Date().toISOString()};
  if(activeStage!=="executive"){patch[stage.field]=scores;patch[stage.comment]=$("stageComment").value.trim()||null}
  if(activeStage==="self"&&submit){patch.workflow_status="self_submitted";patch.self_submitted_at=new Date().toISOString()}
  if(activeStage==="primary"&&submit){patch.workflow_status="primary_submitted";patch.primary_submitted_at=new Date().toISOString()}
  if(activeStage==="interview"&&submit){patch.workflow_status="interview_submitted";patch.interview_submitted_at=new Date().toISOString()}
  if(activeStage==="executive"){
    const exec={...activeRecord.executive_scores},final={...activeRecord.final_scores};
    activeItems.forEach(i=>{
      const v=scores[itemKey(i.id)];if(!v)return;
      if(i.section==="company_results")exec[itemKey(i.id)]=v;
      final[itemKey(i.id)]=v;
    });
    patch.executive_scores=exec;patch.final_scores=final;patch.executive_comment=$("stageComment").value.trim()||null;patch.executive_saved_at=new Date().toISOString();
    if(submit){patch.workflow_status="finalized";patch.finalized_at=new Date().toISOString()}
  }
  if(draftCopied&&previousRecord){patch.copied_from_record_id=previousRecord.id;patch.copied_at=new Date().toISOString()}
  const{data,error}=await client.from("evaluation_records").update(patch).eq("id",activeRecord.id).select("*").single();
  if(error){setMsg($("saveMessage"),error.message,"error");return}
  activeRecord=data;const idx=allRecords.findIndex(r=>r.id===data.id);if(idx>=0)allRecords[idx]=data;
  records=allRecords.filter(r=>r.cycle_id===selectedCycle.id);draftCopied=false;
  setMsg($("saveMessage"),submit?"提出・確定しました。":"一時保存しました。","success");
  if(submit)setTimeout(()=>activeStage==="executive"?renderExecutive():renderDashboard(),450);
}

async function renderExecutive(){
  showView("executiveView");setPage("成長会議・最終評価","全社員を横断して評価推移と差異を確認し、最終評価を決定します。");
  document.querySelector('[data-nav="executive"]')?.classList.add("active");
  $("executiveCycleLabel").textContent=`${selectedCycle?.name||""} の評価一覧`;
  const deps=[...new Set([...employeeMap.values()].map(e=>e.department).filter(Boolean))];
  $("departmentFilter").innerHTML=`<option value="">全部署</option>`+deps.map(d=>`<option>${esc(d)}</option>`).join("");
  $("departmentFilter").onchange=renderExecutiveRows;$("statusFilter").onchange=renderExecutiveRows;$("diffFilter").onchange=renderExecutiveRows;
  await renderExecutiveRows();
}
async function renderExecutiveRows(){
  const rows=[];
  for(const r of records){
    const e=employeeMap.get(r.employee_id);if(!e)continue;
    const items=await getItems(r.template_id);
    const interview=weighted(items,{...r.interview_scores,...r.executive_scores});
    const final=weighted(items,{...r.final_scores,...r.interview_scores,...r.executive_scores});
    const diffs=items.reduce((n,i)=>{
      const a=Number(r.self_scores?.[itemKey(i.id)]||0),b=Number(r.primary_scores?.[itemKey(i.id)]||0);
      return n+(a&&b&&Math.abs(a-b)>=2?1:0);
    },0);
    const prev=await findPrevious(r);
    let prevFinal=null;
    if(prev){
      const pi=await getItems(prev.r.template_id);prevFinal=weighted(pi,prev.r.final_scores);
    }
    rows.push({r,e,interview,final,diffs,prevFinal});
  }
  const dep=$("departmentFilter").value,st=$("statusFilter").value,df=$("diffFilter").value;
  const filtered=rows.filter(x=>(!dep||x.e.department===dep)&&(!st||x.r.workflow_status===st)&&(!df||x.diffs>0));
  $("execTotalPeople").textContent=filtered.length;
  $("execFinalizedPeople").textContent=filtered.filter(x=>x.r.workflow_status==="finalized").length;
  $("execDiffPeople").textContent=filtered.filter(x=>x.diffs>0).length;
  $("executiveTable").innerHTML=`<div class="table-wrap"><table class="exec-table"><thead><tr>
    <th>社員</th><th>部署</th><th>階層</th><th>前回最終</th><th>今回面談後</th><th>現在の最終</th><th>前回差</th><th>自己/一次差異</th><th>状態</th><th>操作</th>
  </tr></thead><tbody>${filtered.map(x=>{
    const delta=x.prevFinal!=null?(x.final-x.prevFinal):null;
    return`<tr><td><strong>${esc(x.e.name)}</strong><br><span class="row-meta">${esc(x.e.employee_code)}</span></td>
      <td>${esc(x.e.department)}</td><td>${esc(x.e.job_level)}</td>
      <td class="score">${x.prevFinal!=null?x.prevFinal.toFixed(1):"-"}</td>
      <td class="score">${x.interview.toFixed(1)}</td><td class="score">${x.final.toFixed(1)}</td>
      <td>${delta!=null?(delta>0?"+":"")+delta.toFixed(1):"-"}</td>
      <td>${x.diffs?`<span class="diff-badge">${x.diffs}項目</span>`:"-"}</td>
      <td><span class="status-chip ${statusClass(x.r.workflow_status)}">${esc(STATUS_LABELS[x.r.workflow_status]||x.r.workflow_status)}</span></td>
      <td><button class="btn btn-secondary" data-exec="${x.r.id}">確認・調整</button></td></tr>`;
  }).join("")}</tbody></table></div>`;
  document.querySelectorAll("[data-exec]").forEach(b=>b.onclick=()=>openEvaluation(Number(b.dataset.exec),"executive"));
}

$("loginForm").onsubmit=async e=>{
  e.preventDefault();setMsg($("loginMessage"));
  const{error}=await client.auth.signInWithPassword({email:internalEmail($("loginId").value),password:$("password").value});
  if(error){setMsg($("loginMessage"),"IDまたはパスワードが違います。","error");return}
  try{await boot()}catch(err){console.error(err);setMsg($("loginMessage"),err.message||"初期化に失敗しました。","error")}
};
$("logoutButton").onclick=async()=>{await client.auth.signOut();location.reload()};
$("homeButton").onclick=renderDashboard;
$("saveButton").onclick=()=>saveStage(false);$("saveTopButton").onclick=()=>saveStage(false);
$("evaluationForm").onsubmit=async e=>{e.preventDefault();if(confirm("この内容で提出・確定しますか？"))await saveStage(true)};
$("submitTopButton").onclick=async()=>{if(confirm("この内容で提出・確定しますか？"))await saveStage(true)};

async function boot(){
  await loadBase();
  $("loginView").classList.add("hidden");$("appView").classList.remove("hidden");
  renderDashboard();
}
(async()=>{const{data:{session}}=await client.auth.getSession();if(session){try{await boot()}catch(e){console.error(e);await client.auth.signOut()}}})();
