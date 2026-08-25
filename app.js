const SUPABASE_URL = "https://dkzumydszfgpdxatyrys.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_igHy73rTVLP5ziIJxgSC_Q_-Lt5B5oL";

const client = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const EVALUATION_ITEMS = [
  { key: "job_performance", label: "業務遂行力", help: "担当業務を正確かつ安定して遂行できているか" },
  { key: "initiative", label: "主体性", help: "自ら考え、必要な行動を起こせているか" },
  { key: "cooperation", label: "協調性", help: "周囲と連携し、チームとして行動できているか" },
  { key: "communication", label: "コミュニケーション", help: "報告・連絡・相談を適切に行えているか" },
  { key: "goal_achievement", label: "目標達成度", help: "設定された目標に対して成果を上げているか" },
];

const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginForm = document.getElementById("loginForm");
const evaluationForm = document.getElementById("evaluationForm");
const loginMessage = document.getElementById("loginMessage");
const saveMessage = document.getElementById("saveMessage");
const scoreFields = document.getElementById("scoreFields");
const commentField = document.getElementById("comment");
const saveButton = document.getElementById("saveButton");
const submitButton = document.getElementById("submitButton");
const logoutButton = document.getElementById("logoutButton");

let currentEvaluation = null;

function setMessage(element, text = "", type = "") {
  element.textContent = text;
  element.className = "message";
  if (type) element.classList.add(type);
}

function internalEmailFromLoginId(loginId) {
  return `${loginId.trim().toLowerCase()}@internal.local`;
}

function renderScoreFields(scores = {}) {
  scoreFields.innerHTML = "";

  for (const item of EVALUATION_ITEMS) {
    const row = document.createElement("div");
    row.className = "score-row";

    const text = document.createElement("div");
    text.innerHTML = `
      <div class="score-title">${item.label}</div>
      <p class="score-help">${item.help}</p>
    `;

    const select = document.createElement("select");
    select.id = `score-${item.key}`;
    select.dataset.scoreKey = item.key;
    select.innerHTML = `
      <option value="">選択してください</option>
      <option value="1">1 - 要改善</option>
      <option value="2">2 - やや不足</option>
      <option value="3">3 - 標準</option>
      <option value="4">4 - 良好</option>
      <option value="5">5 - 非常に良好</option>
    `;

    if (scores[item.key]) {
      select.value = String(scores[item.key]);
    }

    row.append(text, select);
    scoreFields.appendChild(row);
  }
}

function collectScores({ requireAll = false } = {}) {
  const scores = {};

  for (const item of EVALUATION_ITEMS) {
    const select = document.querySelector(`[data-score-key="${item.key}"]`);
    if (!select.value) {
      if (requireAll) {
        throw new Error(`「${item.label}」を選択してください。`);
      }
      continue;
    }
    scores[item.key] = Number(select.value);
  }

  return scores;
}

function setFormLocked(locked) {
  document.querySelectorAll("[data-score-key]").forEach((el) => {
    el.disabled = locked;
  });
  commentField.disabled = locked;
  saveButton.disabled = locked;
  submitButton.disabled = locked;
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
      evaluation_period,
      scores,
      comment,
      status,
      employees (
        employee_code,
        name,
        department
      )
    `)
    .eq("evaluation_period", "2026_test")
    .limit(1);

  if (evaluationError) throw evaluationError;
  if (!evaluations || evaluations.length === 0) {
    throw new Error("評価対象者が登録されていません。");
  }

  currentEvaluation = evaluations[0];

  document.getElementById("evaluatorName").textContent =
    `${profile.display_name} (${profile.login_id})`;
  document.getElementById("employeeName").textContent =
    currentEvaluation.employees.name;
  document.getElementById("employeeMeta").textContent =
    `${currentEvaluation.employees.employee_code} / ${currentEvaluation.employees.department || "部署未設定"}`;

  renderScoreFields(currentEvaluation.scores || {});
  commentField.value = currentEvaluation.comment || "";

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
      submitted_at: status === "submitted" ? new Date().toISOString() : null,
    };

    const { data, error } = await client
      .from("evaluations")
      .update(payload)
      .eq("id", currentEvaluation.id)
      .select("id, scores, comment, status, submitted_at")
      .single();

    if (error) throw error;

    currentEvaluation = { ...currentEvaluation, ...data };

    if (status === "submitted") {
      document.getElementById("statusBadge").textContent = "確定済み";
      document.getElementById("statusBadge").classList.add("submitted");
      setFormLocked(true);
      setMessage(saveMessage, "評価を確定しました。", "success");
    } else {
      setMessage(saveMessage, "一時保存しました。", "success");
    }
  } catch (error) {
    console.error(error);
    setMessage(saveMessage, error.message || "保存に失敗しました。", "error");
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
      password,
    });

    if (error) {
      throw new Error("IDまたはパスワードが違います。");
    }

    await loadAppData();
  } catch (error) {
    console.error(error);
    setMessage(loginMessage, error.message || "ログインに失敗しました。", "error");
  }
});

saveButton.addEventListener("click", () => saveEvaluation("draft"));

evaluationForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const confirmed = window.confirm(
    "評価を確定します。テスト版では確定後の編集を画面上で停止します。よろしいですか？"
  );

  if (confirmed) {
    await saveEvaluation("submitted");
  }
});

logoutButton.addEventListener("click", async () => {
  await client.auth.signOut();
  currentEvaluation = null;
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
    setMessage(loginMessage, "初期化に失敗しました。再度ログインしてください。", "error");
  }
})();
