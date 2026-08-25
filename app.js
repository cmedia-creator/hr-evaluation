const SUPABASE_URL = "https://dkzumydszfgpdxatyrys.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_igHy73rTVLP5ziIJxgSC_Q_-Lt5B5oL";

const client = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const SECTION_LABELS = {
  company_results: {
    title: "① 全社共通の成果評価",
    description: "会社全体の成果指標に対する評価"
  },
  common_behavior: {
    title: "② 共通の行動評価",
    description: "全社員共通の行動・姿勢に関する評価"
  },
  department_results: {
    title: "③ 部署固有の成果評価",
    description: "営業設計として求められる成果に関する評価"
  },
  department_behavior: {
    title: "④ 部署固有の能力・行動評価",
    description: "営業設計として必要な知識・スキル・仕事の進め方に関する評価"
  }
};

const SECTION_ORDER = [
  "company_results",
  "common_behavior",
  "department_results",
  "department_behavior"
];

const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginForm = document.getElementById("loginForm");
const evaluationForm = document.getElementById("evaluationForm");
const loginMessage = document.getElementById("loginMessage");
const saveMessage = document.getElementById("saveMessage");
const sectionsContainer = document.getElementById("sectionsContainer");
const commentField = document.getElementById("comment");
const saveButton = document.getElementById("saveButton");
const submitButton = document.getElementById("submitButton");
const saveButtonTop = document.getElementById("saveButtonTop");
const submitButtonTop = document.getElementById("submitButtonTop");
const logoutButton = document.getElementById("logoutButton");

let currentEvaluation = null;
let currentTemplate = null;
let evaluationItems = [];

function setMessage(element, text = "", type = "") {
  element.textContent = text;
  element.className = "message";
  if (type) element.classList.add(type);
}

function internalEmailFromLoginId(loginId) {
  return `${loginId.trim().toLowerCase()}@internal.local`;
}

function scoreKey(itemId) {
  return `item_${itemId}`;
}

function criteriaForItem(item) {
  const criteria = item.criteria || {};

  if (criteria.manager && Object.keys(criteria.manager).length) {
    return criteria.manager;
  }

  if (criteria.shared && Object.keys(criteria.shared).length) {
    return criteria.shared;
  }

  if (criteria.self && Object.keys(criteria.self).length) {
    return criteria.self;
  }

  return {};
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderCriteriaList(item) {
  const criteria = criteriaForItem(item);
  const keys = ["5", "4", "3", "2", "1"].filter((key) => criteria[key]);

  if (!keys.length) {
    return `
      <details class="criteria-details">
        <summary>評価基準</summary>
        <div class="criteria-list">
          <div class="criteria-row">
            <span class="criteria-score">※</span>
            <span>個別の評価基準は設定されていません。面談等で擦り合わせてください。</span>
          </div>
        </div>
      </details>
    `;
  }

  return `
    <details class="criteria-details">
      <summary>1〜5点の評価基準を見る</summary>
      <div class="criteria-list">
        ${keys.map((key) => `
          <div class="criteria-row">
            <span class="criteria-score">${key}</span>
            <span>${escapeHtml(criteria[key])}</span>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function renderItem(item, savedScores) {
  const key = scoreKey(item.id);
  const savedValue = savedScores?.[key] ?? "";
  const criteria = criteriaForItem(item);
  const initialCriteria = savedValue && criteria[String(savedValue)]
    ? criteria[String(savedValue)]
    : "";

  const itemEl = document.createElement("div");
  itemEl.className = "item-card";
  itemEl.dataset.itemId = String(item.id);

  itemEl.innerHTML = `
    <div class="item-top">
      <div>
        <h3 class="item-title">${escapeHtml(item.item_text)}</h3>
        <div class="item-meta">
          <span class="weight-chip">ウェイト ${Number(item.weight).toFixed(2)}</span>
          <span class="type-chip">${item.item_type === "metric" ? "成果" : "行動・能力"}</span>
        </div>
      </div>

      <label class="score-select-wrap">
        <span>評価点</span>
        <select data-score-item="${item.id}">
          <option value="">未評価</option>
          <option value="5" ${String(savedValue) === "5" ? "selected" : ""}>5</option>
          <option value="4" ${String(savedValue) === "4" ? "selected" : ""}>4</option>
          <option value="3" ${String(savedValue) === "3" ? "selected" : ""}>3</option>
          <option value="2" ${String(savedValue) === "2" ? "selected" : ""}>2</option>
          <option value="1" ${String(savedValue) === "1" ? "selected" : ""}>1</option>
        </select>
      </label>
    </div>

    <p class="criteria-selected ${initialCriteria ? "" : "empty"}" data-selected-criteria="${item.id}">
      ${initialCriteria ? escapeHtml(initialCriteria) : "点数を選ぶと、その点数の評価基準を表示します。"}
    </p>

    ${renderCriteriaList(item)}
    ${item.note ? `<p class="item-note">${escapeHtml(item.note)}</p>` : ""}
  `;

  const select = itemEl.querySelector(`[data-score-item="${item.id}"]`);
  select.addEventListener("change", () => {
    const target = itemEl.querySelector(`[data-selected-criteria="${item.id}"]`);
    const selected = select.value;
    const text = selected && criteria[selected]
      ? criteria[selected]
      : "点数を選ぶと、その点数の評価基準を表示します。";

    target.textContent = text;
    target.classList.toggle("empty", !selected || !criteria[selected]);

    updateSummary();
  });

  return itemEl;
}

function renderEvaluationItems(savedScores = {}) {
  sectionsContainer.innerHTML = "";

  for (const sectionKey of SECTION_ORDER) {
    const items = evaluationItems.filter((item) => item.section === sectionKey);
    if (!items.length) continue;

    const sectionInfo = SECTION_LABELS[sectionKey] || {
      title: sectionKey,
      description: ""
    };

    const details = document.createElement("details");
    details.className = "section-block card";
    details.open = true;

    const summary = document.createElement("summary");
    summary.innerHTML = `
      <div class="section-title-wrap">
        <span class="eyebrow">SECTION</span>
        <h2>${escapeHtml(sectionInfo.title)}</h2>
        <p>${escapeHtml(sectionInfo.description)}</p>
      </div>
      <span class="section-count">${items.length}項目</span>
    `;

    const content = document.createElement("div");
    content.className = "section-content";

    const categories = [];
    for (const item of items) {
      if (!categories.includes(item.category)) {
        categories.push(item.category);
      }
    }

    for (const category of categories) {
      const categoryItems = items.filter((item) => item.category === category);
      const categoryBlock = document.createElement("div");
      categoryBlock.className = "category-block";

      const first = categoryItems[0];
      categoryBlock.innerHTML = `
        <div class="category-header">
          <span class="eyebrow">CATEGORY</span>
          <h3>${escapeHtml(String(category || "").replaceAll("\\n", "\n"))}</h3>
          ${first.category_description
            ? `<p>${escapeHtml(first.category_description)}</p>`
            : ""}
        </div>
      `;

      for (const item of categoryItems) {
        categoryBlock.appendChild(renderItem(item, savedScores));
      }

      content.appendChild(categoryBlock);
    }

    details.append(summary, content);
    sectionsContainer.appendChild(details);
  }

  updateSummary();
}

function collectScores({ requireAll = false } = {}) {
  const scores = {};

  for (const item of evaluationItems) {
    const select = document.querySelector(`[data-score-item="${item.id}"]`);
    if (!select) continue;

    if (!select.value) {
      if (requireAll) {
        throw new Error(`未評価の項目があります：「${item.item_text}」`);
      }
      continue;
    }

    scores[scoreKey(item.id)] = Number(select.value);
  }

  return scores;
}

function calculateWeightedScore(scores) {
  let total = 0;

  for (const item of evaluationItems) {
    const value = Number(scores[scoreKey(item.id)] || 0);
    total += value * Number(item.weight || 0);
  }

  return total;
}

function updateSummary() {
  let scores = {};
  try {
    scores = collectScores({ requireAll: false });
  } catch (_) {}

  const filled = Object.keys(scores).length;
  const totalItems = evaluationItems.length;
  const weightedScore = calculateWeightedScore(scores);

  document.getElementById("progressText").textContent =
    `${filled} / ${totalItems} 項目`;
  document.getElementById("weightedScore").textContent =
    weightedScore.toFixed(1);
  document.getElementById("scoreBar").style.width =
    `${Math.min(100, Math.max(0, weightedScore))}%`;
}

function setFormLocked(locked) {
  document.querySelectorAll("[data-score-item]").forEach((el) => {
    el.disabled = locked;
  });

  commentField.disabled = locked;
  saveButton.disabled = locked;
  submitButton.disabled = locked;
  saveButtonTop.disabled = locked;
  submitButtonTop.disabled = locked;
}

async function getTemplateForEvaluation(evaluation) {
  if (evaluation.template_id) {
    const { data, error } = await client
      .from("evaluation_templates")
      .select("id, department, job_level, name, version, is_active")
      .eq("id", evaluation.template_id)
      .single();

    if (!error && data) return data;
  }

  const employee = evaluation.employees;

  const { data, error } = await client
    .from("evaluation_templates")
    .select("id, department, job_level, name, version, is_active")
    .eq("department", employee.department)
    .eq("job_level", employee.job_level)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (error) throw error;
  return data;
}

async function loadAppData() {
  const { data: { user } } = await client.auth.getUser();

  if (!user) {
    showLogin();
    return;
  }

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("login_id, display_name, role, is_active")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || !profile.is_active) {
    throw new Error("評価者情報を取得できませんでした。");
  }

  const { data: evaluations, error: evaluationError } = await client
    .from("evaluations")
    .select(`
      id,
      template_id,
      evaluation_period,
      scores,
      comment,
      status,
      employees (
        employee_code,
        name,
        department,
        job_level
      )
    `)
    .eq("evaluation_period", "2026_test")
    .limit(1);

  if (evaluationError) throw evaluationError;
  if (!evaluations || evaluations.length === 0) {
    throw new Error("評価対象者が登録されていません。");
  }

  currentEvaluation = evaluations[0];
  currentTemplate = await getTemplateForEvaluation(currentEvaluation);

  const { data: items, error: itemsError } = await client
    .from("evaluation_items")
    .select(`
      id,
      template_id,
      section,
      category,
      category_description,
      item_text,
      weight,
      item_type,
      criteria,
      note,
      sort_order
    `)
    .eq("template_id", currentTemplate.id)
    .order("sort_order", { ascending: true });

  if (itemsError) throw itemsError;
  if (!items || items.length === 0) {
    throw new Error("評価項目が登録されていません。");
  }

  evaluationItems = items;

  document.getElementById("evaluatorName").textContent =
    `${profile.display_name} (${profile.login_id})`;

  document.getElementById("employeeName").textContent =
    currentEvaluation.employees.name;

  document.getElementById("employeeMeta").textContent =
    [
      currentEvaluation.employees.employee_code,
      currentEvaluation.employees.department || "部署未設定",
      currentEvaluation.employees.job_level || "階層未設定"
    ].join(" / ");

  document.getElementById("templateName").textContent =
    currentTemplate.name;

  document.getElementById("templateMeta").textContent =
    `${evaluationItems.length}項目 / Version ${currentTemplate.version} / 評価期間 ${currentEvaluation.evaluation_period}`;

  commentField.value = currentEvaluation.comment || "";
  renderEvaluationItems(currentEvaluation.scores || {});

  const submitted = currentEvaluation.status === "submitted";
  const statusBadge = document.getElementById("statusBadge");

  statusBadge.textContent = submitted ? "確定済み" : "下書き";
  statusBadge.classList.toggle("submitted", submitted);

  setFormLocked(submitted);
  showApp();
}

async function saveEvaluation(status) {
  if (!currentEvaluation) return;

  setMessage(saveMessage);

  try {
    const scores = collectScores({ requireAll: status === "submitted" });

    const payload = {
      scores,
      comment: commentField.value.trim() || null,
      status,
      updated_at: new Date().toISOString(),
      submitted_at: status === "submitted" ? new Date().toISOString() : null
    };

    const { data, error } = await client
      .from("evaluations")
      .update(payload)
      .eq("id", currentEvaluation.id)
      .select("id, scores, comment, status, submitted_at")
      .single();

    if (error) throw error;

    currentEvaluation = {
      ...currentEvaluation,
      ...data
    };

    updateSummary();

    if (status === "submitted") {
      document.getElementById("statusBadge").textContent = "確定済み";
      document.getElementById("statusBadge").classList.add("submitted");
      setFormLocked(true);
      setMessage(saveMessage, "評価を確定しました。", "success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      setMessage(saveMessage, "一時保存しました。", "success");
    }
  } catch (error) {
    console.error(error);
    setMessage(
      saveMessage,
      error.message || "保存に失敗しました。",
      "error"
    );
  }
}

function showLogin() {
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
}

function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
}

async function submitWithConfirm() {
  const currentScores = collectScores({ requireAll: false });

  if (Object.keys(currentScores).length !== evaluationItems.length) {
    setMessage(
      saveMessage,
      `未評価の項目があります。${Object.keys(currentScores).length}/${evaluationItems.length}項目入力済みです。`,
      "error"
    );
    return;
  }

  const weighted = calculateWeightedScore(currentScores).toFixed(1);

  const confirmed = window.confirm(
    `評価を確定します。\n加重点数：${weighted} / 100\n\n確定後はこの画面から編集できません。よろしいですか？`
  );

  if (confirmed) {
    await saveEvaluation("submitted");
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(loginMessage);

  const loginId = document.getElementById("loginId").value.trim();
  const password = document.getElementById("password").value;

  if (!loginId || !password) {
    setMessage(loginMessage, "IDとパスワードを入力してください。", "error");
    return;
  }

  try {
    const { error } = await client.auth.signInWithPassword({
      email: internalEmailFromLoginId(loginId),
      password
    });

    if (error) {
      throw new Error("IDまたはパスワードが違います。");
    }

    await loadAppData();
  } catch (error) {
    console.error(error);
    setMessage(
      loginMessage,
      error.message || "ログインに失敗しました。",
      "error"
    );
  }
});

saveButton.addEventListener("click", () => saveEvaluation("draft"));
saveButtonTop.addEventListener("click", () => saveEvaluation("draft"));

evaluationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitWithConfirm();
});

submitButtonTop.addEventListener("click", async () => {
  await submitWithConfirm();
});

logoutButton.addEventListener("click", async () => {
  await client.auth.signOut();
  currentEvaluation = null;
  currentTemplate = null;
  evaluationItems = [];
  loginForm.reset();
  setMessage(loginMessage);
  showLogin();
});

(async function init() {
  try {
    const { data: { session } } = await client.auth.getSession();

    if (session) {
      await loadAppData();
    } else {
      showLogin();
    }
  } catch (error) {
    console.error(error);
    await client.auth.signOut();
    showLogin();
    setMessage(
      loginMessage,
      "初期化に失敗しました。再度ログインしてください。",
      "error"
    );
  }
})();
