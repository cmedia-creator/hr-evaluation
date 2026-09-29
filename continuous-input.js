// 人事評価システム 連続入力モード v1.3
// 一次評価・面談後評価で、1項目ごとに担当社員を横断して入力する。

(() => {
  const CI_ELIGIBLE_STAGES = new Set(["primary", "interview"]);
  const CI_SECTION_ORDER = ["company_results", "common_behavior", "department_results", "department_behavior"];
  const CI_SECTION_LABELS = {
    company_results: "① 全社共通の成果評価",
    common_behavior: "② 共通の行動評価",
    department_results: "③ 部署固有の成果評価",
    department_behavior: "④ 部署固有の能力・行動評価"
  };

  const ciState = {
    mode: "individual",
    stage: null,
    catalog: [],
    itemIndex: 0,
    draftScores: new Map(),
    draftComments: new Map(),
    dirtyRecords: new Set(),
    activeRowIndex: 0,
    returnRecordId: null,
    saving: false
  };

  const ciBaseOpenEvaluation = openEvaluation;

  function ciStageField(stage) {
    return stage === "primary" ? "primary_scores" : "interview_scores";
  }

  function ciCanField(stage) {
    return stage === "primary" ? "primary_can_score" : "interview_can_score";
  }

  function ciNormalizeKeyText(value) {
    return String(value || "")
      .replaceAll("\\n", "\n")
      .replace(/\s+/g, " ")
      .trim();
  }

  function ciGroupKey(item) {
    // item_code はテンプレートごとに別IDになっているため、
    // 連続入力では同じ質問でも社員ごとに別グループへ分断されてしまう。
    // セクション・カテゴリ・質問文で同一質問をまとめる。
    return `semantic:${item.section}|${ciNormalizeKeyText(item.category)}|${ciNormalizeKeyText(item.item_text)}`;
  }

  function ciScore(record, item, stage) {
    const draft = ciState.draftScores.get(record.id);
    const source = draft || record[ciStageField(stage)] || {};
    return Number(source[itemKey(item.id)] || 0) || null;
  }

  function ciCommentField(stage) {
    return stage === "primary"
      ? "primary_item_comments"
      : "interview_item_comments";
  }

  function ciComments(record) {
    const field = ciCommentField(ciState.stage);
    return ciState.draftComments.get(record.id) || record[field] || {};
  }

  function ciEnsureDraft(record, stage) {
    if (!ciState.draftScores.has(record.id)) {
      ciState.draftScores.set(record.id, { ...(record[ciStageField(stage)] || {}) });
    }
    if (!ciState.draftComments.has(record.id)) {
      const field = ciCommentField(stage);
      ciState.draftComments.set(record.id, { ...(record[field] || {}) });
    }
  }

  async function ciBuildCatalog(stage) {
    const groups = new Map();
    const canField = ciCanField(stage);
    const targets = getManagedRecords().slice();

    for (const record of targets) {
      ciEnsureDraft(record, stage);
      const items = await getItems(record.template_id);
      for (const item of items.filter(i => !!i[canField])) {
        const key = ciGroupKey(item);
        if (!groups.has(key)) {
          groups.set(key, {
            key,
            section: item.section,
            category: item.category || "",
            itemText: item.item_text || "",
            sortOrder: Number(item.sort_order || 0),
            rows: []
          });
        }
        groups.get(key).rows.push({ record, item });
      }
    }

    return [...groups.values()].sort((a, b) => {
      const sa = CI_SECTION_ORDER.indexOf(a.section);
      const sb = CI_SECTION_ORDER.indexOf(b.section);
      if (sa !== sb) return sa - sb;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return `${a.category}${a.itemText}`.localeCompare(`${b.category}${b.itemText}`, "ja");
    });
  }

  function ciEnsureModeSwitcher() {
    let box = document.getElementById("inputModeSwitcher");
    if (!CI_ELIGIBLE_STAGES.has(activeStage)) {
      box?.remove();
      return null;
    }

    if (!box) {
      box = document.createElement("div");
      box.id = "inputModeSwitcher";
      box.className = "input-mode-switcher";
      const anchor = document.querySelector("#evaluationView .employee-info-panel");
      anchor?.parentNode?.insertBefore(box, anchor);
    }

    box.innerHTML = `
      <div class="input-mode-copy">
        <strong>入力方法</strong>
        <span>社員ごとに入力するか、同じ評価項目を担当社員へ連続入力するかを切り替えられます。</span>
      </div>
      <div class="input-mode-buttons" role="group" aria-label="入力方法">
        <button type="button" class="btn mode-button ${ciState.mode === "individual" ? "active" : ""}" data-input-mode="individual">個人入力</button>
        <button type="button" class="btn mode-button ${ciState.mode === "continuous" ? "active" : ""}" data-input-mode="continuous">連続入力</button>
      </div>
    `;

    box.querySelector('[data-input-mode="individual"]')?.addEventListener("click", () => ciSwitchToIndividual());
    box.querySelector('[data-input-mode="continuous"]')?.addEventListener("click", () => ciSwitchToContinuous());
    return box;
  }

  function ciIndividualElements() {
    return [
      document.getElementById("employeeSwitcher"),
      document.querySelector("#evaluationView .employee-info-panel"),
      document.getElementById("previousPanel"),
      document.getElementById("stageNotice"),
      document.getElementById("requiredCommentSummary"),
      document.querySelector("#evaluationView .evaluation-toolbar"),
      document.getElementById("evaluationForm")
    ].filter(Boolean);
  }

  function ciHideIndividual() {
    ciIndividualElements().forEach(el => el.classList.add("continuous-hidden"));
  }

  function ciShowIndividual() {
    ciIndividualElements().forEach(el => el.classList.remove("continuous-hidden"));
  }

  function ciRemovePanel() {
    document.getElementById("continuousInputPanel")?.remove();
  }

  async function ciSwitchToContinuous() {
    if (!CI_ELIGIBLE_STAGES.has(activeStage)) return;
    ciState.mode = "continuous";
    ciState.stage = activeStage;
    ciState.returnRecordId = activeRecord?.id || ciState.returnRecordId;
    ciState.itemIndex = 0;
    ciState.activeRowIndex = 0;
    ciState.catalog = await ciBuildCatalog(activeStage);
    ciHideIndividual();
    ciEnsureModeSwitcher();
    ciRenderPanel();
  }

  async function ciSwitchToIndividual() {
    if (ciState.mode !== "continuous") return;
    if (ciState.dirtyRecords.size) {
      const ok = confirm("未保存の連続入力があります。一時保存して個人入力へ戻りますか？");
      if (!ok) return;
      const saved = await ciSaveDrafts();
      if (!saved) return;
    }

    const recordId = ciState.returnRecordId || activeRecord?.id;
    const stage = ciState.stage || activeStage;
    ciState.mode = "individual";
    ciState.stage = null;
    ciState.catalog = [];
    ciState.itemIndex = 0;
    ciState.activeRowIndex = 0;
    ciShowIndividual();
    ciRemovePanel();

    if (recordId && stage) {
      await ciBaseOpenEvaluation(recordId, stage);
    }
    ciEnsureModeSwitcher();
  }

  function ciCurrentGroup() {
    return ciState.catalog[ciState.itemIndex] || null;
  }

  function ciCriteriaInfo(group) {
    if (!group?.rows?.length) return { same: true, criteria: {} };
    const all = group.rows.map(({ item }) => scoreCriteria(item, ciState.stage) || {});
    const first = JSON.stringify(all[0] || {});
    return {
      same: all.every(c => JSON.stringify(c || {}) === first),
      criteria: all[0] || {}
    };
  }

  function ciCriteriaMarkup(criteria) {
    const rows = [5, 4, 3, 2, 1]
      .filter(n => criteria[String(n)])
      .map(n => `<div class="continuous-criteria-row"><strong>${n}</strong><span>${esc(criteria[String(n)])}</span></div>`)
      .join("");
    return rows || `<p class="continuous-muted">この項目には共通の評価基準表示がありません。</p>`;
  }

  function ciRowMarkup(row, rowIndex) {
    const { record, item } = row;
    const emp = employeeMap.get(record.employee_id);
    const current = ciScore(record, item, ciState.stage);
    const self = Number(record.self_scores?.[itemKey(item.id)] || 0) || null;
    const primary = Number(record.primary_scores?.[itemKey(item.id)] || 0) || null;
    const reasons = ciState.stage === "interview"
      ? requiredInterviewReasons(record, item, current)
      : [];
    const comment = String(ciComments(record)[itemKey(item.id)] || "");
    const commentOpen = !!reasons.length || !!comment.trim();
    const rowCriteria = scoreCriteria(item, ciState.stage) || {};

    return `
      <div class="continuous-employee-row ${rowIndex === ciState.activeRowIndex ? "active-row" : ""}" data-ci-row="${rowIndex}" data-record-id="${record.id}" data-item-id="${item.id}" tabindex="0">
        <div class="continuous-person">
          <strong>${esc(emp?.name || "-")}</strong>
          <span>${esc(emp?.employee_code || "")} / ${esc(emp?.department || "")} / ${esc(emp?.job_level || "")}</span>
        </div>
        <div class="continuous-reference">
          <div><span>自己</span><strong>${self || "-"}</strong></div>
          ${ciState.stage === "interview" ? `<div><span>一次</span><strong>${primary || "-"}</strong></div>` : ""}
        </div>
        <div class="continuous-score-cell">
          <div class="continuous-score-buttons" aria-label="${esc(emp?.name || "")}の評価">
            ${[1,2,3,4,5].map(n => `<button type="button" class="continuous-score-button ${current === n ? "selected" : ""}" data-ci-score="${n}">${n}</button>`).join("")}
            <button type="button" class="continuous-clear-button" data-ci-clear title="未入力に戻す">×</button>
          </div>
          <div class="continuous-comment-toggle-row ${reasons.length ? "hidden" : ""}" data-ci-comment-toggle-row>
            <button type="button" class="btn btn-secondary continuous-comment-toggle" data-ci-comment-toggle>
              ${commentOpen ? "コメントを閉じる" : "コメントを残す"}
            </button>
          </div>
          <div class="continuous-required ${commentOpen ? "" : "hidden"}" data-ci-required data-ci-comment-open="${commentOpen && !reasons.length ? "1" : "0"}">
            <strong data-ci-comment-heading>${reasons.length ? "理由コメント必須" : "任意コメント"}</strong>
            <span class="${reasons.length ? "" : "hidden"}" data-ci-reasons>${esc(reasons.join(" / "))}</span>
            <textarea data-ci-comment rows="2" placeholder="${reasons.length ? "評価理由を入力してください。" : "必要に応じてコメントを入力してください。"}">${esc(comment)}</textarea>
          </div>
          <details class="continuous-row-criteria hidden" data-ci-row-criteria>
            <summary>この社員の評価基準</summary>
            ${ciCriteriaMarkup(rowCriteria)}
          </details>
        </div>
      </div>
    `;
  }

  function ciRenderPanel() {
    ciRemovePanel();
    const modeBox = ciEnsureModeSwitcher();
    if (!modeBox || ciState.mode !== "continuous") return;

    const panel = document.createElement("section");
    panel.id = "continuousInputPanel";
    panel.className = "continuous-input-panel panel";
    modeBox.insertAdjacentElement("afterend", panel);

    if (!ciState.catalog.length) {
      panel.innerHTML = `<div class="continuous-empty">連続入力できる評価項目がありません。</div>`;
      return;
    }

    const group = ciCurrentGroup();
    const info = ciCriteriaInfo(group);
    const stageLabel = ciState.stage === "primary" ? "一次評価" : "面談後評価";
    const missing = group.rows.filter(({record,item}) => !ciScore(record,item,ciState.stage)).length;
    const managedTotal = getManagedRecords().length;
    const nonTarget = Math.max(0, managedTotal - group.rows.length);

    panel.innerHTML = `
      <div class="continuous-sticky-head">
        <div class="continuous-topline">
          <button type="button" class="btn btn-secondary" id="ciPrevItem" ${ciState.itemIndex <= 0 ? "disabled" : ""}>← 前の項目</button>
          <div class="continuous-position">
            <span>${stageLabel}・連続入力</span>
            <strong>${ciState.itemIndex + 1} / ${ciState.catalog.length} 項目</strong>
          </div>
          <button type="button" class="btn btn-secondary" id="ciNextItem" ${ciState.itemIndex >= ciState.catalog.length - 1 ? "disabled" : ""}>次の項目 →</button>
        </div>
        <div class="continuous-jump-row">
          <label>評価項目へ移動
            <select id="ciItemSelect">
              ${ciState.catalog.map((g, idx) => `<option value="${idx}" ${idx === ciState.itemIndex ? "selected" : ""}>${idx + 1}. ${esc(g.itemText)}</option>`).join("")}
            </select>
          </label>
          <div class="continuous-save-actions">
            <span id="ciSaveMessage" class="message"></span>
            <button type="button" class="btn btn-secondary" id="ciSaveButton">一時保存</button>
          </div>
        </div>
      </div>

      <div class="continuous-question-card">
        <span class="panel-kicker">${esc(CI_SECTION_LABELS[group.section] || group.section || "")}</span>
        ${group.category ? `<h3>${esc(group.category)}</h3>` : ""}
        <h2>${esc(group.itemText)}</h2>
        <div class="continuous-question-meta">
          <span>対象 ${group.rows.length}名</span>
          ${nonTarget ? `<span>この項目の対象外 ${nonTarget}名</span>` : ""}
          <span data-ci-missing class="${missing ? "warn-text" : "done-text"}">未入力 ${missing}名</span>
          <span>数字キー1〜5でも入力できます</span>
        </div>
        <details class="continuous-criteria" open>
          <summary>評価基準</summary>
          ${info.same
            ? ciCriteriaMarkup(info.criteria)
            : `<p class="continuous-warning">対象者によって評価基準が異なります。各社員行の「この社員の評価基準」を確認してください。</p>`}
        </details>
      </div>

      <div class="continuous-table-head">
        <span>社員</span><span>参考</span><span>評価 1〜5</span>
      </div>
      <div id="ciEmployeeRows" class="continuous-employee-list">
        ${group.rows
          .slice()
          .sort((a,b) => String(employeeMap.get(a.record.employee_id)?.employee_code || "").localeCompare(String(employeeMap.get(b.record.employee_id)?.employee_code || ""), "ja", {numeric:true}))
          .map((row, idx) => ciRowMarkup(row, idx))
          .join("")}
      </div>

      <div class="continuous-footer">
        <div>
          <strong>連続入力は一時保存です。</strong>
          <span>提出・確定は個人入力に戻って未入力項目とコメントを確認したうえで行います。</span>
        </div>
        <button type="button" class="btn btn-primary" id="ciSaveBottom">一時保存</button>
      </div>
    `;

    if (!info.same) {
      panel.querySelectorAll("[data-ci-row-criteria]").forEach(el => el.classList.remove("hidden"));
    }

    panel.querySelector("#ciPrevItem")?.addEventListener("click", () => ciMoveItem(-1));
    panel.querySelector("#ciNextItem")?.addEventListener("click", () => ciMoveItem(1));
    panel.querySelector("#ciItemSelect")?.addEventListener("change", e => {
      ciState.itemIndex = Number(e.target.value) || 0;
      ciState.activeRowIndex = 0;
      ciRenderPanel();
    });
    panel.querySelector("#ciSaveButton")?.addEventListener("click", () => ciSaveDrafts());
    panel.querySelector("#ciSaveBottom")?.addEventListener("click", () => ciSaveDrafts());

    panel.querySelectorAll("[data-ci-row]").forEach(rowEl => {
      rowEl.addEventListener("click", e => {
        if (e.target.closest("button,textarea,summary,details")) return;
        ciSetActiveRow(Number(rowEl.dataset.ciRow));
      });
      rowEl.addEventListener("focus", () => ciSetActiveRow(Number(rowEl.dataset.ciRow), false));

      rowEl.querySelectorAll("[data-ci-score]").forEach(btn => {
        btn.addEventListener("click", () => {
          ciSetScore(Number(rowEl.dataset.ciRow), Number(btn.dataset.ciScore));
        });
      });
      rowEl.querySelector("[data-ci-clear]")?.addEventListener("click", () => {
        ciSetScore(Number(rowEl.dataset.ciRow), null);
      });
      rowEl.querySelector("[data-ci-comment-toggle]")?.addEventListener("click", () => {
        const box = rowEl.querySelector("[data-ci-required]");
        const button = rowEl.querySelector("[data-ci-comment-toggle]");
        if (!box || !button) return;
        const open = box.classList.contains("hidden");
        box.classList.toggle("hidden", !open);
        box.dataset.ciCommentOpen = open ? "1" : "0";
        button.textContent = open ? "コメントを閉じる" : "コメントを残す";
        if (open) box.querySelector("textarea")?.focus();
      });
      rowEl.querySelector("[data-ci-comment]")?.addEventListener("input", e => {
        ciSetComment(Number(rowEl.dataset.ciRow), e.target.value);
      });
    });

    ciRefreshActiveRow();
  }

  function ciSortedRows() {
    const group = ciCurrentGroup();
    if (!group) return [];
    return group.rows.slice().sort((a,b) => String(employeeMap.get(a.record.employee_id)?.employee_code || "").localeCompare(String(employeeMap.get(b.record.employee_id)?.employee_code || ""), "ja", {numeric:true}));
  }

  function ciSetActiveRow(index, focus = true) {
    const rows = ciSortedRows();
    if (!rows.length) return;
    ciState.activeRowIndex = Math.max(0, Math.min(index, rows.length - 1));
    ciRefreshActiveRow();
    if (focus) {
      document.querySelector(`[data-ci-row="${ciState.activeRowIndex}"]`)?.focus({ preventScroll: true });
    }
  }

  function ciRefreshActiveRow() {
    document.querySelectorAll("[data-ci-row]").forEach(el => {
      el.classList.toggle("active-row", Number(el.dataset.ciRow) === ciState.activeRowIndex);
    });
  }

  function ciSetScore(rowIndex, value) {
    const rows = ciSortedRows();
    const row = rows[rowIndex];
    if (!row) return;
    const {record,item} = row;
    ciEnsureDraft(record, ciState.stage);
    const scores = ciState.draftScores.get(record.id);
    const key = itemKey(item.id);
    if (value) scores[key] = Number(value);
    else delete scores[key];
    ciState.dirtyRecords.add(record.id);

    const rowEl = document.querySelector(`[data-ci-row="${rowIndex}"]`);
    rowEl?.querySelectorAll("[data-ci-score]").forEach(btn => {
      btn.classList.toggle("selected", Number(btn.dataset.ciScore) === Number(value));
    });

    if (ciState.stage === "interview") {
      const reasons = requiredInterviewReasons(record, item, value);
      const requiredBox = rowEl?.querySelector("[data-ci-required]");
      const reasonEl = rowEl?.querySelector("[data-ci-reasons]");
      const heading = rowEl?.querySelector("[data-ci-comment-heading]");
      const toggleRow = rowEl?.querySelector("[data-ci-comment-toggle-row]");
      const toggle = rowEl?.querySelector("[data-ci-comment-toggle]");
      const manuallyOpen = requiredBox?.dataset.ciCommentOpen === "1";
      const required = !!reasons.length;

      requiredBox?.classList.toggle("hidden", !required && !manuallyOpen);
      reasonEl?.classList.toggle("hidden", !required);
      toggleRow?.classList.toggle("hidden", required);
      if (reasonEl) reasonEl.textContent = reasons.join(" / ");
      if (heading) heading.textContent = required ? "理由コメント必須" : "任意コメント";
      if (toggle) toggle.textContent = manuallyOpen ? "コメントを閉じる" : "コメントを残す";
    }

    const missing = rows.filter(({record:r,item:i}) => !ciScore(r,i,ciState.stage)).length;
    const missingSpan = document.querySelector("[data-ci-missing]");
    if (missingSpan) {
      missingSpan.textContent = `未入力 ${missing}名`;
      missingSpan.className = missing ? "warn-text" : "done-text";
      missingSpan.dataset.ciMissing = "";
    }

    if (value && rowIndex < rows.length - 1) {
      ciSetActiveRow(rowIndex + 1);
      requestAnimationFrame(() => {
        document.querySelector(`[data-ci-row="${rowIndex + 1}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    } else if (
      value &&
      rowIndex === rows.length - 1 &&
      ciState.itemIndex < ciState.catalog.length - 1
    ) {
      setTimeout(() => ciMoveItem(1), 180);
    }
  }

  function ciSetComment(rowIndex, text) {
    const rows = ciSortedRows();
    const row = rows[rowIndex];
    if (!row) return;
    const {record,item} = row;
    ciEnsureDraft(record, ciState.stage);
    const comments = ciState.draftComments.get(record.id);
    comments[itemKey(item.id)] = text;
    ciState.dirtyRecords.add(record.id);
  }

  function ciMoveItem(delta) {
    const next = ciState.itemIndex + delta;
    if (next < 0 || next >= ciState.catalog.length) return;
    ciState.itemIndex = next;
    ciState.activeRowIndex = 0;
    ciRenderPanel();
    document.getElementById("continuousInputPanel")?.scrollIntoView({behavior:"smooth", block:"start"});
  }

  async function ciSaveDrafts() {
    if (ciState.saving) return false;
    if (!ciState.dirtyRecords.size) {
      const msg = document.getElementById("ciSaveMessage");
      if (msg) {
        msg.textContent = "保存する変更はありません。";
        msg.className = "message";
      }
      return true;
    }

    ciState.saving = true;
    const buttons = document.querySelectorAll("#continuousInputPanel button");
    buttons.forEach(b => b.disabled = true);
    const msg = document.getElementById("ciSaveMessage");
    if (msg) {
      msg.textContent = "保存中...";
      msg.className = "message";
    }

    const stage = ciState.stage;
    const field = ciStageField(stage);
    const ids = [...ciState.dirtyRecords];
    let saved = 0;
    const errors = [];

    for (const id of ids) {
      const record = allRecords.find(r => r.id === id);
      if (!record) continue;
      const patch = {
        [field]: { ...(ciState.draftScores.get(id) || record[field] || {}) },
        updated_at: new Date().toISOString()
      };
      const commentField = ciCommentField(stage);
      patch[commentField] = {
        ...(ciState.draftComments.get(id) || record[commentField] || {})
      };

      const {data,error} = await client.from("evaluation_records").update(patch).eq("id", id).select("*").single();
      if (error) {
        errors.push(`${employeeMap.get(record.employee_id)?.name || id}: ${error.message}`);
        continue;
      }

      const idx = allRecords.findIndex(r => r.id === data.id);
      if (idx >= 0) allRecords[idx] = data;
      ciState.draftScores.set(id, { ...(data[field] || {}) });
      ciState.draftComments.set(id, { ...(data[ciCommentField(stage)] || {}) });
      ciState.dirtyRecords.delete(id);
      saved++;
    }

    refreshCycleRecords();
    ciState.saving = false;
    buttons.forEach(b => b.disabled = false);

    if (msg) {
      if (errors.length) {
        msg.textContent = `${saved}名保存、${errors.length}名でエラーが発生しました。`;
        msg.className = "message error";
        console.error("連続入力保存エラー", errors);
      } else {
        msg.textContent = `${saved}名分を一時保存しました。`;
        msg.className = "message success";
      }
    }
    return errors.length === 0;
  }

  function ciResetForNewEvaluation() {
    ciState.mode = "individual";
    ciState.stage = null;
    ciState.catalog = [];
    ciState.itemIndex = 0;
    ciState.activeRowIndex = 0;
    ciState.returnRecordId = null;
    ciState.draftScores.clear();
    ciState.draftComments.clear();
    ciState.dirtyRecords.clear();
    ciRemovePanel();
    ciShowIndividual();
  }

  openEvaluation = async function(recordId, stage) {
    if (ciState.mode === "continuous" && ciState.dirtyRecords.size) {
      const ok = confirm("未保存の連続入力があります。移動すると失われます。移動しますか？");
      if (!ok) return;
    }
    ciResetForNewEvaluation();
    await ciBaseOpenEvaluation(recordId, stage);
    ciState.returnRecordId = recordId;
    ciEnsureModeSwitcher();
  };

  document.addEventListener("keydown", e => {
    if (ciState.mode !== "continuous") return;
    if (!document.getElementById("continuousInputPanel")) return;
    const tag = e.target?.tagName?.toLowerCase();
    if (["textarea","input","select"].includes(tag)) return;

    if (["1","2","3","4","5"].includes(e.key)) {
      e.preventDefault();
      ciSetScore(ciState.activeRowIndex, Number(e.key));
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      ciSetActiveRow(ciState.activeRowIndex + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      ciSetActiveRow(ciState.activeRowIndex - 1);
    }
  });

  document.addEventListener("click", e => {
    if (ciState.mode !== "continuous" || !ciState.dirtyRecords.size) return;
    const leaving = e.target.closest("[data-nav],#homeButton,#logoutButton");
    if (!leaving) return;
    const ok = confirm("連続入力に未保存の変更があります。保存せず移動しますか？");
    if (!ok) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    ciResetForNewEvaluation();
  }, true);

  window.addEventListener("beforeunload", e => {
    if (ciState.mode === "continuous" && ciState.dirtyRecords.size) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
})();
