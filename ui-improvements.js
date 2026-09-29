// 人事評価システム UI/入力検証改善パッチ 2026-09-10
// app.js 読み込み後に実行する。v1.2

(() => {
  const uiImpOriginalRenderSections = renderSections;
  const uiImpOriginalOpenEvaluation = openEvaluation;
  const uiImpOriginalSaveStage = saveStage;
  let uiImpBulkPasting = false;
  let uiImpCopiedEvaluation = null;

  function uiImpNormalizeKeyText(value) {
    return String(value || "")
      .replaceAll("\\n", "\n")
      .replace(/\s+/g, " ")
      .trim();
  }

  function uiImpSemanticKey(item) {
    return [
      item.section || "",
      uiImpNormalizeKeyText(item.category),
      uiImpNormalizeKeyText(item.item_text)
    ].join("|");
  }

  function uiImpScrollToNextItem(select) {
    if (uiImpBulkPasting || activeStage === "executive" || !select?.value) return;
    const inputs = [...document.querySelectorAll("#evaluationSections select[data-item]")]
      .filter(el => !el.disabled && el.offsetParent !== null);
    const index = inputs.indexOf(select);
    if (index < 0 || index >= inputs.length - 1) return;

    const next = inputs[index + 1];
    const row = next.closest(".eval-item");
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => next.focus({ preventScroll: true }), 220);
  }

  function uiImpCopyCurrentEvaluation() {
    if (!["primary", "interview"].includes(activeStage) || !activeRecord) return;
    const canField = STAGE_META[activeStage]?.can;
    const current = collectCurrent();
    const scores = {};

    activeItems
      .filter(item => !!item[canField])
      .forEach(item => {
        const value = Number(current[itemKey(item.id)] || 0);
        if (value) scores[uiImpSemanticKey(item)] = value;
      });

    const employee = employeeMap.get(activeRecord.employee_id);
    uiImpCopiedEvaluation = {
      stage: activeStage,
      sourceRecordId: activeRecord.id,
      sourceName: employee?.name || "コピー元社員",
      scores,
      count: Object.keys(scores).length
    };

    uiImpRenderCopyPasteActions();
    setMsg(
      $("saveMessage"),
      `${uiImpCopiedEvaluation.sourceName}さんの評価点 ${uiImpCopiedEvaluation.count}項目をコピーしました。`,
      "success"
    );
  }

  function uiImpPasteEvaluation() {
    if (!uiImpCopiedEvaluation || !activeRecord) return;
    if (uiImpCopiedEvaluation.stage !== activeStage) {
      setMsg($("saveMessage"), "コピー元と現在の評価段階が異なるため貼り付けできません。", "error");
      return;
    }

    const target = employeeMap.get(activeRecord.employee_id);
    const ok = confirm(
      `${uiImpCopiedEvaluation.sourceName}さんの評価点を${target?.name || "この社員"}さんへ貼り付けますか？\nコメントはコピーしません。`
    );
    if (!ok) return;

    const canField = STAGE_META[activeStage]?.can;
    let pasted = 0;
    uiImpBulkPasting = true;

    try {
      activeItems
        .filter(item => !!item[canField])
        .forEach(item => {
          const value = uiImpCopiedEvaluation.scores[uiImpSemanticKey(item)];
          if (!value) return;
          const select = document.querySelector(`select[data-item="${item.id}"]`);
          if (!select) return;
          select.value = String(value);
          select.dispatchEvent(new Event("change", { bubbles: true }));
          pasted++;
        });
    } finally {
      uiImpBulkPasting = false;
    }

    updateEvalSummary();
    updateRequiredCommentSummary();
    setMsg(
      $("saveMessage"),
      `${pasted}項目の評価点を貼り付けました。まだ保存されていません。`,
      "success"
    );
  }

  function uiImpRenderCopyPasteActions() {
    let box = document.getElementById("evaluationCopyActions");
    if (!["primary", "interview"].includes(activeStage)) {
      box?.remove();
      return;
    }

    const panel = document.querySelector("#evaluationView .employee-info-panel");
    const scoreSummary = panel?.querySelector(".evaluation-score-summary");
    if (!panel || !scoreSummary) return;

    if (!box) {
      box = document.createElement("div");
      box.id = "evaluationCopyActions";
      box.className = "evaluation-copy-actions";
      panel.insertBefore(box, scoreSummary);
    }

    const copied = uiImpCopiedEvaluation;
    const usable = copied && copied.stage === activeStage;
    box.innerHTML = `
      <div class="evaluation-copy-actions-buttons">
        <button type="button" class="btn btn-secondary" data-eval-copy>評価をコピー</button>
        <button type="button" class="btn btn-secondary" data-eval-paste ${usable ? "" : "disabled"}>コピーを貼り付け</button>
      </div>
      <small>${
        usable
          ? `${esc(copied.sourceName)}さん / ${copied.count}項目をコピー中（点数のみ）`
          : "別の社員へ評価点だけコピーできます。"
      }</small>
    `;

    box.querySelector("[data-eval-copy]")?.addEventListener("click", uiImpCopyCurrentEvaluation);
    box.querySelector("[data-eval-paste]")?.addEventListener("click", uiImpPasteEvaluation);
  }

  function uiImpEnsureMissingBanner() {
    let banner = document.getElementById("missingInputSummary");
    if (banner) return banner;

    banner = document.createElement("div");
    banner.id = "missingInputSummary";
    banner.className = "missing-input-summary hidden";
    banner.innerHTML = "<strong>未入力項目があります</strong><span></span>";

    const toolbar = document.querySelector("#evaluationView .evaluation-toolbar");
    if (toolbar?.parentNode) toolbar.parentNode.insertBefore(banner, toolbar);
    return banner;
  }

  function uiImpResetMissingState() {
    document.querySelectorAll(".eval-item.missing-input").forEach(el => {
      el.classList.remove("missing-input");
    });
    const banner = uiImpEnsureMissingBanner();
    banner.classList.add("hidden");
    const span = banner.querySelector("span");
    if (span) span.textContent = "";
  }

  function uiImpSubmissionItems() {
    // 役員最終評価は「変更時のみ」の項目があるため、
    // ここでは自己評価・一次評価・面談後評価だけを全入力必須とする。
    if (activeStage === "executive") return [];
    const canField = STAGE_META[activeStage]?.can;
    if (!canField) return [];
    return activeItems.filter(item => !!item[canField]);
  }

  function uiImpValidateSubmission() {
    if (activeStage === "executive") return true;

    const scores = collectCurrent();
    const required = uiImpSubmissionItems();
    const missing = required.filter(item => !Number(scores[itemKey(item.id)] || 0));

    required.forEach(item => {
      const row = document.querySelector(`[data-item-row="${item.id}"]`);
      if (!row) return;
      row.classList.toggle(
        "missing-input",
        !Number(scores[itemKey(item.id)] || 0)
      );
    });

    const banner = uiImpEnsureMissingBanner();

    if (!missing.length) {
      banner.classList.add("hidden");
      return true;
    }

    banner.classList.remove("hidden");
    const span = banner.querySelector("span");
    if (span) {
      span.textContent =
        `${missing.length}件の評価が未入力です。赤く表示された項目をすべて入力してから提出してください。`;
    }

    setMsg(
      $("saveMessage"),
      `未入力項目があります（${missing.length}件）。すべて入力してから提出してください。`,
      "error"
    );

    const first = document.querySelector(`[data-item-row="${missing[0].id}"]`);
    first?.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }

  function uiImpBindMissingClear() {
    document.querySelectorAll("[data-item]").forEach(select => {
      select.addEventListener("change", () => {
        const row = select.closest(".eval-item");
        if (select.value) row?.classList.remove("missing-input");
        if (select.value && !uiImpBulkPasting) {
          setTimeout(() => uiImpScrollToNextItem(select), 70);
        }

        const required = uiImpSubmissionItems();
        if (!required.length) return;

        const scores = collectCurrent();
        const missingCount = required.filter(
          item => !Number(scores[itemKey(item.id)] || 0)
        ).length;

        const banner = uiImpEnsureMissingBanner();
        if (!missingCount) {
          banner.classList.add("hidden");
        } else if (!banner.classList.contains("hidden")) {
          const span = banner.querySelector("span");
          if (span) {
            span.textContent =
              `${missingCount}件の評価が未入力です。赤く表示された項目をすべて入力してから提出してください。`;
          }
        }
      });
    });
  }

  function uiImpCollapseExecutiveOnlySection() {
    document.querySelectorAll(".eval-section").forEach(section => {
      const title = section.querySelector("summary h2")?.textContent || "";
      if (!title.includes("全社共通の成果評価")) return;

      section.open = false;
      section.classList.add("executive-only-collapsible");

      const pill = section.querySelector(".section-pill");
      if (pill) pill.textContent = "クリックして表示";
    });
  }

  function uiImpRenderEmployeeSwitcher() {
    let switcher = document.getElementById("employeeSwitcher");

    if (!["primary", "interview"].includes(activeStage)) {
      switcher?.remove();
      return;
    }

    const targets = getManagedRecords()
      .slice()
      .sort((a, b) => {
        const ac = String(employeeMap.get(a.employee_id)?.employee_code || "");
        const bc = String(employeeMap.get(b.employee_id)?.employee_code || "");
        return ac.localeCompare(bc, "ja", { numeric: true });
      });

    if (!targets.length) {
      switcher?.remove();
      return;
    }

    if (!switcher) {
      switcher = document.createElement("div");
      switcher.id = "employeeSwitcher";
      switcher.className = "employee-switcher";

      const employeePanel = document.querySelector(
        "#evaluationView .employee-info-panel"
      );
      employeePanel?.parentNode?.insertBefore(switcher, employeePanel);
    }

    const stageLabel = activeStage === "primary" ? "一次評価" : "面談後評価";
    switcher.innerHTML = `
      <div>
        <span class="employee-switcher-label">評価対象者を切り替える</span>
        <span class="employee-switcher-note">${stageLabel}の対象社員へ直接移動できます。</span>
      </div>
      <select id="employeeSwitcherSelect" aria-label="評価対象者を切り替える">
        ${targets
          .map(record => {
            const emp = employeeMap.get(record.employee_id);
            const selected = record.id === activeRecord?.id ? "selected" : "";
            return `<option value="${record.id}" ${selected}>${esc(
              emp?.employee_code || ""
            )}　${esc(emp?.name || "-")}　${esc(emp?.department || "")}</option>`;
          })
          .join("")}
      </select>
    `;

    const stageAtRender = activeStage;
    const select = document.getElementById("employeeSwitcherSelect");
    if (select) {
      select.onchange = () => {
        const recordId = Number(select.value);
        if (recordId) openEvaluation(recordId, stageAtRender);
      };
    }
  }

  renderSections = function () {
    uiImpOriginalRenderSections();
    uiImpCollapseExecutiveOnlySection();
    uiImpBindMissingClear();
  };

  openEvaluation = async function (recordId, stage) {
    uiImpResetMissingState();
    await uiImpOriginalOpenEvaluation(recordId, stage);
    uiImpRenderEmployeeSwitcher();
    uiImpRenderCopyPasteActions();
  };

  saveStage = async function (submit = false) {
    if (submit && !uiImpValidateSubmission()) return;
    return await uiImpOriginalSaveStage(submit);
  };

  // 既存の提出ボタンは saveStage(true) を呼ぶため、上記差し替えで両方に効く。
  uiImpEnsureMissingBanner();
})();

// 連続入力モードを追加読み込み。既存の個人入力はそのまま残す。
(() => {
  if (!document.querySelector('link[data-continuous-input]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './continuous-input.css?v=1.2';
    link.dataset.continuousInput = 'true';
    document.head.appendChild(link);
  }
  if (!document.querySelector('script[data-continuous-input]')) {
    const script = document.createElement('script');
    script.src = './continuous-input.js?v=1.2';
    script.dataset.continuousInput = 'true';
    document.body.appendChild(script);
  }
})();
