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
const FLOW_STAGES=["self","primary","interview","executive"];
const FLOW_LABELS={self:"自己評価",primary:"一次評価",interview:"面談後評価",executive:"成長会議・最終評価"};
const STATUS_RANK={
  self_draft:0,self_submitted:1,primary_draft:1,primary_submitted:2,
  interview_draft:2,interview_submitted:3,growth_meeting:4,finalized:5
};

let profile=null,cycles=[],selectedCycle=null,allRecords=[],records=[];
let employeeMap=new Map(),templateCache=new Map(),itemCache=new Map();
let activeRecord=null,activeItems=[],activeStage=null,previousRecord=null,previousItems=[],draftCopied=false;
let draftInterviewComments={};

const $=id=>document.getElementById(id);
const views=["dashboardView","listView","evaluationView","executiveView"];
function esc(v=""){return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function itemKey(id){return`item_${id}`}
function setMsg(el,text="",type=""){if(!el)return;el.textContent=text;el.className="message"+(type?` ${type}`:"")}
function internalEmail(id){return`${id.trim().toLowerCase()}@internal.local`}
function employeeInitial(name){return(name||"?").trim().slice(0,1)}
function statusClass(status){return status==="finalized"?"done":(["growth_meeting","interview_submitted"].includes(status)?"warn":"")}
function stageRank(status){return STATUS_RANK[status]??0}
function primaryComplete(record){return stageRank(record.workflow_status)>=2}
function interviewComplete(record){return stageRank(record.workflow_status)>=3}
function selfComplete(record){return stageRank(record.workflow_status)>=1}
function showView(id){
  views.forEach(v=>$(v).classList.add("hidden"));
  $(id).classList.remove("hidden");
  $("homeButton").classList.toggle("hidden",id==="dashboardView");
  document.querySelectorAll(".side-nav").forEach(n=>n.classList.remove("active"));
}
function setPage(title,subtitle,breadcrumb=title){
  $("pageTitle").textContent=title;$("pageSubtitle").textContent=subtitle;$("breadcrumbCurrent").textContent=breadcrumb;
}
function scoreCriteria(item,stage){
  const c=item.criteria||{};
  if(stage==="self"&&c.self)return c.self;
  if(["primary","interview","executive"].includes(stage)&&c.manager)return c.manager;
  return c.shared||c.manager||c.self||{};
}
function weighted(items,scores){
  return items.reduce((sum,i)=>sum+(Number(scores?.[itemKey(i.id)]||0)*Number(i.weight||0)),0);
}

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
  refreshCycleRecords();

  $("accountBadge").innerHTML=`<span>${esc(profile.display_name)}</span><small>${esc(profile.login_id)}</small>`;
  $("cycleSelector").innerHTML=cycles.map(c=>`<option value="${c.id}" ${c.id===selectedCycle?.id?"selected":""}>${esc(c.name)}</option>`).join("");
  $("cycleSelector").onchange=()=>{
    selectedCycle=cycles.find(c=>c.id===Number($("cycleSelector").value));
    refreshCycleRecords();renderDashboard();
  };
  configureNav();
  return true;
}
function refreshCycleRecords(){records=allRecords.filter(r=>r.cycle_id===selectedCycle?.id)}
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

function getManagedRecords(){
  return records.filter(r=>r.primary_evaluator_user_id===profile.id&&r.employee_id!==profile.employee_id);
}
function dashboardCard({type,kicker,title,countText,detail,need,done,primaryAction}){
  return `<section class="role-card ${need?"need":""} ${done?"done":""}">
    <div>
      <div class="role-card-kicker">${esc(kicker)}</div>
      <h2>${esc(title)}</h2>
      <p>${esc(detail)}</p>
      ${countText?`<div class="count-line">${countText}</div>`:""}
      ${need?`<div class="action-needed">対応が必要です。</div>`:done?`<div class="action-done">完了</div>`:""}
    </div>
    <div class="role-card-actions">
      <button class="btn btn-primary" data-func="${type}">${esc(primaryAction)}</button>
      <button class="btn btn-secondary flow-open" data-flow="${type}">流れを確認</button>
    </div>
  </section>`;
}
function progressRow(label,status,desc,kind=""){
  return `<div class="progress-overview-row">
    <strong>${esc(label)}</strong>
    <span><span class="status-chip ${kind}">${esc(status)}</span></span>
    <span>${esc(desc)}</span>
  </div>`;
}
function renderDashboard(){
  showView("dashboardView");setPage("ホーム","あなたに必要な評価業務だけ表示しています。","ホーム");
  document.querySelector('[data-nav="dashboard"]').classList.add("active");
  $("currentCycleName").textContent=selectedCycle?.name||"-";
  $("currentCycleMeta").textContent=`${CYCLE_TYPE_LABELS[selectedCycle?.cycle_type]||""} / ${selectedCycle?.year||""}年度`;
  $("sidebarCycleName").textContent=selectedCycle?.name||"-";
  $("sidebarCycleStatus").textContent=selectedCycle?.status==="open"?"受付中":selectedCycle?.status==="closed"?"終了":"準備中";

  const own=records.find(r=>r.employee_id===profile.employee_id);
  const managed=getManagedRecords();
  const primaryIncomplete=managed.filter(r=>!primaryComplete(r)).length;
  const interviewIncomplete=managed.filter(r=>!interviewComplete(r)).length;

  const cards=[];
  if(profile.can_self&&own){
    const done=selfComplete(own);
    cards.push(dashboardCard({
      type:"self",kicker:"自分自身の評価",title:"自己評価",
      detail:done?"自己評価は完了しています。":"自己評価の入力が完了していません。",
      countText:"",need:!done,done,primaryAction:"開く"
    }));
  }
  if(profile.can_manage){
    cards.push(dashboardCard({
      type:"primary",kicker:"担当社員の評価",title:"一次評価",
      detail:"担当社員の評価状況を確認します。",
      countText:`<strong>${primaryIncomplete}名</strong>　一次評価が完了していません。`,
      need:primaryIncomplete>0,done:primaryIncomplete===0,primaryAction:"対象者を確認"
    }));
    cards.push(dashboardCard({
      type:"interview",kicker:"面談後の評価",title:"面談後評価",
      detail:"一次評価提出後に対応します。",
      countText:`<strong>${interviewIncomplete}名</strong>　面談後評価が完了していません。`,
      need:interviewIncomplete>0,done:interviewIncomplete===0,primaryAction:"対象者を確認"
    }));
  }

  if(profile.can_executive){
    cards.push(`<section class="role-card" id="executiveDashboardCard">
      <div>
        <div class="role-card-kicker">成長会議・役員確認</div>
        <h2>成長会議・最終評価</h2>
        <p>成長会議対象となる社員を抽出して確認します。</p>
        <div class="count-line"><strong id="dashboardGrowthTargetCount">-</strong>　対象者</div>
      </div>
      <div class="role-card-actions">
        <button class="btn btn-primary" data-func="executive">対象者を確認</button>
        <button class="btn btn-secondary flow-open" data-flow="executive">流れを確認</button>
      </div>
    </section>`);
  }
  $("permissionCards").innerHTML=cards.join("");
  document.querySelectorAll("[data-func]").forEach(b=>b.onclick=()=>navigate(b.dataset.func));
  document.querySelectorAll(".flow-open").forEach(b=>b.onclick=e=>{e.stopPropagation();openFlow(b.dataset.flow)});

  const progress=[];
  if(profile.can_self&&own)progress.push(progressRow("自己評価",selfComplete(own)?"完了":"未完了","自分自身の評価です。",selfComplete(own)?"done":"warn"));
  if(profile.can_manage){
    progress.push(progressRow("一次評価",`${primaryIncomplete}名 未完了`,primaryIncomplete?"対応が必要です。":"未完了の対象者はいません。",primaryIncomplete?"warn":"done"));
    progress.push(progressRow("面談後評価",`${interviewIncomplete}名 未完了`,"一次評価提出後に対応します。",interviewIncomplete?"warn":"done"));
  }
  if(profile.can_executive)progress.push(progressRow("成長会議・最終評価","対象者を抽出","条件に該当する社員だけを初期表示します。","warn"));
  $("progressOverview").innerHTML=progress.join("");

  const anyNeed=(profile.can_self&&own&&!selfComplete(own))||(profile.can_manage&&(primaryIncomplete>0||interviewIncomplete>0));
  $("homeNotice").classList.toggle("need",!!anyNeed);
  $("homeNotice").innerHTML=anyNeed
    ?`<strong>対応が必要な評価があります</strong><p>未完了の評価から優先して対応してください。</p>`
    :`<strong>現在の評価状況を確認できます</strong><p>必要な評価業務は各カードから開けます。</p>`;

  if(profile.can_executive)updateDashboardGrowthCount();
}
async function updateDashboardGrowthCount(){
  let count=0;
  for(const r of records){
    const items=await getItems(r.template_id);
    if(growthMeetingInfo(r,items).isTarget)count++;
  }
  if($("dashboardGrowthTargetCount"))$("dashboardGrowthTargetCount").textContent=`${count}名`;
  if($("executiveDashboardCard"))$("executiveDashboardCard").classList.toggle("need",count>0);
}

function renderEmployeeList(stage){
  activeStage=stage;showView("listView");
  const isPrimary=stage==="primary";
  setPage(isPrimary?"一次評価":"面談後評価",isPrimary?"担当社員の一次評価を確認します。":"面談後評価を確認・入力します。");
  document.querySelector(`[data-nav="${stage}"]`)?.classList.add("active");
  $("listTitle").textContent=isPrimary?"一次評価対象者一覧":"面談後評価対象者一覧";
  $("listDescription").textContent="未完了の社員を上部に表示しています。";
  $("employeeSearch").value="";
  renderEmployeeRows(stage,"");
  $("employeeSearch").oninput=()=>renderEmployeeRows(stage,$("employeeSearch").value.trim().toLowerCase());
}
function recordCompleteForStage(r,stage){return stage==="primary"?primaryComplete(r):interviewComplete(r)}
function renderEmployeeRows(stage,q){
  let targets=getManagedRecords().filter(r=>{
    const e=employeeMap.get(r.employee_id);const hay=`${e?.name||""} ${e?.employee_code||""}`.toLowerCase();
    return!q||hay.includes(q);
  });
  targets.sort((a,b)=>{
    const ac=recordCompleteForStage(a,stage),bc=recordCompleteForStage(b,stage);
    if(ac!==bc)return ac?1:-1;
    return String(employeeMap.get(a.employee_id)?.employee_code||"").localeCompare(String(employeeMap.get(b.employee_id)?.employee_code||""),"ja");
  });
  const incomplete=targets.filter(r=>!recordCompleteForStage(r,stage)).length;
  $("employeeListCount").textContent=`${targets.length}名`;
  $("listIncompleteNotice").innerHTML=`<strong>${incomplete}名の${stage==="primary"?"一次評価":"面談後評価"}が完了していません。${incomplete?"対応が必要です。":""}</strong><br>未完了の社員は一覧上部に表示しています。`;
  $("employeeList").innerHTML=targets.map(r=>{
    const e=employeeMap.get(r.employee_id);const complete=recordCompleteForStage(r,stage);
    return`<div class="employee-row ${complete?"complete":"need-action"}">
      <div class="row-avatar">${esc(employeeInitial(e?.name))}</div>
      <div><div class="row-title">${esc(e?.name||"-")}</div><div class="row-meta">${esc(e?.employee_code||"")} / ${esc(e?.department||"")} / ${esc(e?.job_level||"")}</div></div>
      <span class="status-chip ${complete?"done":"warn"}">${complete?"完了":"未完了"}</span>
      <button class="btn ${complete?"btn-secondary":"btn-primary"}" data-record="${r.id}" data-stage="${stage}">${complete?"確認・編集":"評価する"}</button>
    </div>`;
  }).join("");
  document.querySelectorAll("[data-stage]").forEach(b=>b.onclick=()=>openEvaluation(Number(b.dataset.record),b.dataset.stage));
}

async function findPrevious(record){
  const currentCycle=cycles.find(c=>c.id===record.cycle_id);
  const candidates=allRecords.filter(r=>r.employee_id===record.employee_id&&r.id!==record.id)
    .map(r=>({r,cycle:cycles.find(c=>c.id===r.cycle_id)}))
    .filter(x=>x.cycle&&currentCycle&&x.cycle.id<currentCycle.id)
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
  draftInterviewComments={...(activeRecord.interview_item_comments||{})};

  showView("evaluationView");setPage(STAGE_META[stage].title,`${emp.name}さんの${STAGE_META[stage].title}を確認・入力します。`);
  document.querySelector(`[data-nav="${stage==="executive"?"executive":stage}"]`)?.classList.add("active");
  $("employeeAvatar").textContent=employeeInitial(emp.name);
  $("stageEyebrow").textContent=stage==="executive"?"EXECUTIVE REVIEW":stage.toUpperCase()+" EVALUATION";
  $("targetName").textContent=emp.name;
  $("targetMeta").textContent=`${emp.employee_code} / ${emp.department} / ${emp.job_level} / ${tpl.name} / ${selectedCycle?.name||""}`;
  $("commentTitle").textContent=`${STAGE_META[stage].title} 全体コメント`;
  $("stageComment").value=activeRecord[STAGE_META[stage].comment]||"";

  const notices={
    self:"自己評価では、本人が入力可能な項目を評価します。",
    primary:"一次評価では、本人評価と前回評価を確認しながら入力します。",
    interview:"面談後評価では、本人評価・一次評価と比較して点数を決定します。差が2点以上、または面談後評価が5・1の項目は理由コメントが必要です。",
    executive:"成長会議・最終評価では、これまでの評価経緯と面談後コメントを確認しながら必要な最終調整を行います。"
  };
  $("stageNotice").textContent=notices[stage];$("stageNotice").classList.toggle("executive",stage==="executive");

  setupPreviousPanel();renderSections();updateEvalSummary();updateRequiredCommentSummary();
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
  $("previousOverview").innerHTML=`<div class="workflow-notice">前回最終評価：<strong>${totals.final?totals.final.toFixed(1):"-"}</strong> 点。項目ごとの前回値は各評価項目にも表示します。</div>`;
  $("togglePreviousButton").onclick=()=>{
    $("previousTools").classList.toggle("hidden");
    $("togglePreviousButton").textContent=$("previousTools").classList.contains("hidden")?"前回評価を表示":"前回評価を閉じる";
  };
  $("copyAllButton").onclick=()=>copyPrevious();
  document.querySelectorAll(".section-copy").forEach(b=>b.onclick=()=>copyPrevious(b.dataset.section));
}
function previousScoreFor(item,field){
  if(!previousRecord)return null;
  const pi=previousItems.find(i=>i.item_code&&i.item_code===item.item_code);
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
    const sel=document.querySelector(`[data-item="${item.id}"]`);if(!sel)return;
    const val=previousScoreFor(item,sourceField);
    if(val){sel.value=String(val);sel.dispatchEvent(new Event("change"))}
  });
  draftCopied=true;
  setMsg($("saveMessage"),section?`${SECTION_META[section][0]}を前回評価から反映しました。まだ保存されていません。`:"前回評価を入力欄へ反映しました。まだ保存されていません。","success");
}

function requiredInterviewReasons(record,item,interviewValue){
  const value=Number(interviewValue)||null;if(!value)return[];
  const k=itemKey(item.id);
  const self=Number(record.self_scores?.[k]||0)||null;
  const primary=Number(record.primary_scores?.[k]||0)||null;
  const reasons=[];
  if(self!==null&&Math.abs(self-value)>=2)reasons.push(`本人評価との差が${Math.abs(self-value)}点`);
  if(primary!==null&&Math.abs(primary-value)>=2)reasons.push(`一次評価との差が${Math.abs(primary-value)}点`);
  if(value===5)reasons.push("面談後評価が最高評価「5」");
  if(value===1)reasons.push("面談後評価が最低評価「1」");
  return reasons;
}
function growthMeetingInfo(record,items){
  const flagged=[];
  items.forEach(item=>{
    const v=Number(record.interview_scores?.[itemKey(item.id)]||0)||null;
    const reasons=requiredInterviewReasons(record,item,v);
    if(reasons.length)flagged.push({item,value:v,reasons,comment:(record.interview_item_comments||{})[itemKey(item.id)]||""});
  });
  return{isTarget:flagged.length>0,count:flagged.length,flagged};
}

function renderSections(){
  const scores=activeRecord[STAGE_META[activeStage].field]||{};
  $("evaluationSections").innerHTML="";
  SECTION_ORDER.forEach(section=>{
    const items=activeItems.filter(i=>i.section===section);if(!items.length)return;
    const[title,desc]=SECTION_META[section];
    const d=document.createElement("details");d.className="eval-section";d.open=true;
    d.innerHTML=`<summary><div><span class="panel-kicker">SECTION</span><h2>${esc(title)}</h2><p>${esc(desc)}</p></div><span class="section-pill">${items.length}項目</span></summary><div class="section-content"></div>`;
    const content=d.querySelector(".section-content");
    [...new Set(items.map(i=>i.category||""))].forEach(cat=>{
      const group=items.filter(i=>(i.category||"")===cat);
      const wrap=document.createElement("div");wrap.className="category";
      wrap.innerHTML=`<div class="category-header"><h3>${esc(cat.replaceAll("\\n","\n"))}</h3>${group[0].category_description?`<p>${esc(group[0].category_description)}</p>`:""}</div>`;
      group.forEach(i=>wrap.appendChild(renderItem(i,scores)));content.appendChild(wrap);
    });
    $("evaluationSections").appendChild(d);
  });
}
function mini(label,val,active=false){return`<div class="score-mini ${active?"active":""}"><span>${label}</span><strong>${val||"-"}</strong></div>`}
function renderItem(item,scores){
  const el=document.createElement("div");el.className="eval-item";el.dataset.itemRow=item.id;
  const k=itemKey(item.id);
  const self=Number(activeRecord.self_scores?.[k]||0)||null;
  const primary=Number(activeRecord.primary_scores?.[k]||0)||null;
  const interview=Number(activeRecord.interview_scores?.[k]||0)||null;
  const final=Number(activeRecord.final_scores?.[k]||0)||null;
  const prev=previousScoreFor(item,sourceFieldForStage());
  const canField=STAGE_META[activeStage].can;
  const canInput=activeStage==="executive"?true:!!item[canField];
  const current=Number(scores[k]||0)||null;
  const criteria=scoreCriteria(item,activeStage);

  let comp="";
  if(activeStage==="self")comp=mini("前回",prev)+mini("今回",current,true);
  if(activeStage==="primary")comp=mini("自己",self)+mini("前回一次",prev)+mini("今回一次",current,true);
  if(activeStage==="interview")comp=mini("自己",self)+mini("一次",primary)+mini("前回面談後",prev)+mini("今回面談後",current,true);
  if(activeStage==="executive")comp=mini("自己",self)+mini("一次",primary)+mini("面談後",interview)+mini("最終",final||current,true);

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

  let itemComment="";
  if(activeStage==="interview"&&canInput){
    const reasons=requiredInterviewReasons(activeRecord,item,current);
    itemComment=`<div class="item-comment-box ${reasons.length?"":"hidden"}" data-comment-wrap="${item.id}">
      <strong>この項目は理由コメントが必要です。</strong>
      <div class="item-comment-reasons" data-comment-reasons="${item.id}">${esc(reasons.join(" / "))}</div>
      <textarea data-item-comment="${item.id}" placeholder="なぜこの評価になったのか、理由を入力してください。">${esc(draftInterviewComments[k]||"")}</textarea>
    </div>`;
    if(reasons.length)el.classList.add("comment-required");
  }
  if(activeStage==="executive"){
    const reasons=requiredInterviewReasons(activeRecord,item,interview);
    if(reasons.length){
      const saved=(activeRecord.interview_item_comments||{})[k]||"";
      itemComment=`<div class="item-comment-readonly">
        <strong>面談後評価コメント / ${esc(reasons.join(" / "))}</strong>
        <p>${saved?esc(saved):"コメント未入力"}</p>
      </div>`;
      el.classList.add("comment-required");
    }
  }

  el.innerHTML=`<div class="item-main">
    <h3 class="item-title">${esc(item.item_text)}</h3>
    <div class="item-meta-row"><span class="meta-chip">ウェイト ${Number(item.weight).toFixed(2)}</span><span class="meta-chip">${item.item_type==="metric"?"成果":"行動・能力"}</span>${prev?`<span class="meta-chip">前回 ${prev}</span>`:""}</div>
    ${comp?`<div class="comparison">${comp}</div>`:""}
    ${criteriaRows?`<details class="criteria-details"><summary>1〜5点の評価基準を確認</summary>${criteriaRows}</details>`:""}
    ${item.note?`<p class="item-note">${esc(item.note)}</p>`:""}
    ${itemComment}
  </div><div class="item-side">${side}</div>`;

  const sel=el.querySelector("[data-item]");
  if(sel)sel.onchange=()=>{
    const box=el.querySelector("[data-criteria]"),v=sel.value;
    box.textContent=v&&criteria[v]?criteria[v]:"点数を選択すると評価基準を表示します。";
    if(activeStage==="interview")refreshItemCommentRequirement(el,item,Number(v)||null);
    updateEvalSummary();updateRequiredCommentSummary();
  };
  const ta=el.querySelector("[data-item-comment]");
  if(ta)ta.oninput=()=>{draftInterviewComments[k]=ta.value;updateRequiredCommentSummary()};
  return el;
}
function refreshItemCommentRequirement(el,item,value){
  const reasons=requiredInterviewReasons(activeRecord,item,value);
  const wrap=el.querySelector(`[data-comment-wrap="${item.id}"]`);
  const reasonEl=el.querySelector(`[data-comment-reasons="${item.id}"]`);
  if(!wrap)return;
  wrap.classList.toggle("hidden",!reasons.length);
  el.classList.toggle("comment-required",!!reasons.length);
  if(reasonEl)reasonEl.textContent=reasons.join(" / ");
}
function collectCurrent(){
  const out={};document.querySelectorAll("[data-item]").forEach(s=>{if(s.value)out[itemKey(s.dataset.item)]=Number(s.value)});return out;
}
function missingRequiredComments(scores){
  if(activeStage!=="interview")return[];
  return activeItems.filter(i=>i.interview_can_score).filter(item=>{
    const v=Number(scores[itemKey(item.id)]||0)||null;
    if(!requiredInterviewReasons(activeRecord,item,v).length)return false;
    return!String(draftInterviewComments[itemKey(item.id)]||"").trim();
  });
}
function requiredCommentItems(scores){
  if(activeStage!=="interview")return[];
  return activeItems.filter(i=>i.interview_can_score).filter(item=>{
    const v=Number(scores[itemKey(item.id)]||0)||null;
    return requiredInterviewReasons(activeRecord,item,v).length>0;
  });
}
function updateRequiredCommentSummary(){
  if(activeStage!=="interview"){$("requiredCommentSummary").classList.add("hidden");return}
  const scores=collectCurrent(),required=requiredCommentItems(scores),missing=missingRequiredComments(scores);
  $("requiredCommentSummary").classList.toggle("hidden",required.length===0);
  $("requiredCommentCount").textContent=`コメントが必要な項目が${required.length}件あります。未入力 ${missing.length}件`;
}
function updateEvalSummary(){
  const scores=collectCurrent(),canField=STAGE_META[activeStage].can;
  const eligible=activeStage==="executive"?activeItems:activeItems.filter(i=>i[canField]);
  $("inputProgress").textContent=`${Object.keys(scores).length} / ${eligible.length}`;
  $("inputProgressFill").style.width=`${eligible.length?Math.min(100,Object.keys(scores).length/eligible.length*100):0}%`;
  let value=0;
  if(activeStage==="executive")value=weighted(activeItems,{...activeRecord.final_scores,...scores});
  else value=weighted(eligible,scores);
  $("currentScore").textContent=value.toFixed(1);
  $("scoreMeterFill").style.width=`${Math.min(100,Math.max(0,value))}%`;
}

async function saveStage(submit=false){
  setMsg($("saveMessage"));
  const scores=collectCurrent(),stage=STAGE_META[activeStage],patch={updated_at:new Date().toISOString()};

  if(activeStage==="interview"){
    const missing=missingRequiredComments(scores);
    if(submit&&missing.length){
      setMsg($("saveMessage"),`コメントが必要な項目が${missing.length}件あります。すべて入力してから提出してください。`,"error");
      const first=document.querySelector(`[data-item-row="${missing[0].id}"]`);
      first?.scrollIntoView({behavior:"smooth",block:"center"});return;
    }
    patch.interview_item_comments={...draftInterviewComments};
  }

  if(activeStage!=="executive"){patch[stage.field]=scores;patch[stage.comment]=$("stageComment").value.trim()||null}
  if(activeStage==="self"&&submit){patch.workflow_status="self_submitted";patch.self_submitted_at=new Date().toISOString()}
  if(activeStage==="primary"&&submit){patch.workflow_status="primary_submitted";patch.primary_submitted_at=new Date().toISOString()}
  if(activeStage==="interview"&&submit){patch.workflow_status="interview_submitted";patch.interview_submitted_at=new Date().toISOString()}
  if(activeStage==="executive"){
    const exec={...(activeRecord.executive_scores||{})},final={...(activeRecord.final_scores||{})};
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
  activeRecord=data;
  const idx=allRecords.findIndex(r=>r.id===data.id);if(idx>=0)allRecords[idx]=data;
  refreshCycleRecords();draftCopied=false;draftInterviewComments={...(data.interview_item_comments||{})};
  setMsg($("saveMessage"),submit?"提出・確定しました。":"一時保存しました。","success");
  if(submit)setTimeout(()=>activeStage==="executive"?renderExecutive():renderDashboard(),450);
}

async function renderExecutive(){
  showView("executiveView");setPage("成長会議・最終評価","成長会議対象者を優先して確認し、必要に応じて最終評価を調整します。");
  document.querySelector('[data-nav="executive"]')?.classList.add("active");
  $("executiveCycleLabel").textContent=`${selectedCycle?.name||""} の評価一覧`;
  const deps=[...new Set([...employeeMap.values()].map(e=>e.department).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ja"));
  $("departmentFilter").innerHTML=`<option value="">全部署</option>`+deps.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join("");
  $("growthTargetFilter").value="target";
  $("statusFilter").value="";
  $("departmentFilter").onchange=renderExecutiveRows;
  $("statusFilter").onchange=renderExecutiveRows;
  $("growthTargetFilter").onchange=renderExecutiveRows;
  await renderExecutiveRows();
}
async function renderExecutiveRows(){
  const rows=[];
  for(const r of records){
    const e=employeeMap.get(r.employee_id);if(!e)continue;
    const items=await getItems(r.template_id);
    const growth=growthMeetingInfo(r,items);
    const interview=weighted(items,r.interview_scores);
    const final=weighted(items,Object.keys(r.final_scores||{}).length?r.final_scores:r.interview_scores);
    const prev=await findPrevious(r);
    let prevFinal=null;
    if(prev){const pi=await getItems(prev.r.template_id);prevFinal=weighted(pi,prev.r.final_scores)}
    rows.push({r,e,items,growth,interview,final,prevFinal});
  }
  const targetMode=$("growthTargetFilter").value,dep=$("departmentFilter").value,st=$("statusFilter").value;
  const filtered=rows.filter(x=>
    (targetMode==="all"||x.growth.isTarget)&&
    (!dep||x.e.department===dep)&&
    (!st||x.r.workflow_status===st)
  ).sort((a,b)=>{
    if(a.growth.isTarget!==b.growth.isTarget)return a.growth.isTarget?-1:1;
    return String(a.e.employee_code||"").localeCompare(String(b.e.employee_code||""),"ja");
  });

  $("execTotalPeople").textContent=filtered.length;
  $("execFinalizedPeople").textContent=filtered.filter(x=>x.r.workflow_status==="finalized").length;
  $("execTargetPeople").textContent=filtered.filter(x=>x.growth.isTarget).length;
  $("executiveTable").innerHTML=`<div class="table-wrap"><table class="exec-table"><thead><tr>
    <th>社員</th><th>部署</th><th>階層</th><th>前回最終</th><th>今回面談後</th><th>現在の最終</th><th>成長会議対象</th><th>状態</th><th>操作</th>
  </tr></thead><tbody>${filtered.map(x=>{
    return`<tr>
      <td><strong>${esc(x.e.name)}</strong><br><span class="row-meta">${esc(x.e.employee_code)}</span></td>
      <td>${esc(x.e.department||"")}</td><td>${esc(x.e.job_level||"")}</td>
      <td class="score">${x.prevFinal!=null?x.prevFinal.toFixed(1):"-"}</td>
      <td class="score">${x.interview.toFixed(1)}</td><td class="score">${x.final.toFixed(1)}</td>
      <td>${x.growth.isTarget?`<span class="growth-target-badge">${x.growth.count}項目</span>`:`<span class="not-target">対象外</span>`}</td>
      <td><span class="status-chip ${statusClass(x.r.workflow_status)}">${esc(STATUS_LABELS[x.r.workflow_status]||x.r.workflow_status)}</span></td>
      <td><button class="btn btn-secondary" data-exec="${x.r.id}">確認・調整</button></td>
    </tr>`;
  }).join("")}</tbody></table></div>`;
  document.querySelectorAll("[data-exec]").forEach(b=>b.onclick=()=>openEvaluation(Number(b.dataset.exec),"executive"));
}

/* B-style flow is hidden until requested */
function flowDescription(stage){
  const managed=getManagedRecords();
  const map={
    self:{title:"自己評価",detail:"自分自身の評価項目を確認し、必要な入力を行います。",target:"自分自身",next:"提出後は上司側の評価工程へ進みます。"},
    primary:{title:"一次評価",detail:"担当社員の評価内容を確認し、一次評価を入力します。",target:`担当社員 ${managed.length}名`,next:"一次評価提出後、面談後評価へ進みます。"},
    interview:{title:"面談後評価",detail:"面談内容を踏まえて評価を決定します。条件に該当する項目は理由コメントが必須です。",target:`担当社員 ${managed.length}名`,next:"完了後は成長会議・最終評価の確認対象になります。"},
    executive:{title:"成長会議・最終評価",detail:"条件に該当する社員を抽出し、評価経緯とコメントを確認して最終調整します。",target:"成長会議対象社員",next:"確認・確定後、その評価回の最終評価となります。"}
  };
  return map[stage];
}
function openFlow(stage){
  const d=flowDescription(stage),active=FLOW_STAGES.indexOf(stage);
  $("flowTitle").textContent=d.title;$("flowDetailTitle").textContent=`${d.title}で行うこと`;
  $("flowDetailText").textContent=d.detail;$("flowTarget").textContent=d.target;$("flowNext").textContent=d.next;
  $("flowTimeline").innerHTML=FLOW_STAGES.map((s,i)=>`<div class="flow-step ${i<active?"done":i===active?"active":""}">
    <span class="flow-dot"></span><strong>${FLOW_LABELS[s]}</strong><small>${i<active?"前の工程":i===active?"現在":"次の工程"}</small>
  </div>`).join("");
  $("flowOverlay").classList.remove("hidden");$("flowOverlay").setAttribute("aria-hidden","false");
}
function closeFlow(){$("flowOverlay").classList.add("hidden");$("flowOverlay").setAttribute("aria-hidden","true")}

$("loginForm").onsubmit=async e=>{
  e.preventDefault();setMsg($("loginMessage"));
  const{error}=await client.auth.signInWithPassword({email:internalEmail($("loginId").value),password:$("password").value});
  if(error){setMsg($("loginMessage"),"IDまたはパスワードが違います。","error");return}
  try{await boot()}catch(err){console.error(err);setMsg($("loginMessage"),err.message||"初期化に失敗しました。","error")}
};
$("logoutButton").onclick=async()=>{await client.auth.signOut();location.reload()};
$("homeButton").onclick=renderDashboard;
$("saveButton").onclick=()=>saveStage(false);
$("saveTopButton").onclick=()=>saveStage(false);
$("evaluationForm").onsubmit=async e=>{e.preventDefault();if(confirm("この内容で提出・確定しますか？"))await saveStage(true)};
$("submitTopButton").onclick=async()=>{if(confirm("この内容で提出・確定しますか？"))await saveStage(true)};
document.querySelectorAll(".flow-close").forEach(b=>b.onclick=closeFlow);
$("flowOverlay").onclick=e=>{if(e.target===$("flowOverlay"))closeFlow()};

async function boot(){
  await loadBase();
  $("loginView").classList.add("hidden");$("appView").classList.remove("hidden");
  renderDashboard();
}
(async()=>{const{data:{session}}=await client.auth.getSession();if(session){try{await boot()}catch(e){console.error(e);await client.auth.signOut()}}})();
