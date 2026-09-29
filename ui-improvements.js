// 人事評価システム UI/入力検証改善パッチ 2026-09-10
// app.js 読み込み後に実行する。v1.7

(() => {
  const uiImpOriginalRenderSections = renderSections;
  const uiImpOriginalOpenEvaluation = openEvaluation;
  const uiImpOriginalSaveStage = saveStage;
  let uiImpBulkPasting = false;
  let uiImpCopiedEvaluation = null;
  let uiImpManualScoreMode = false;
  let uiImpStickyObserver = null;

  function uiImpUpdateStickyOffsets() {
    const panel = document.querySelector("#evaluationView .employee-info-panel");
    if (!panel || panel.offsetParent === null) return;
    const stickyTop = 64 + panel.offsetHeight;
    document.documentElement.style.setProperty(
      "--eval-section-sticky-top",
      `${stickyTop}px`
    );
  }

  function uiImpSetupStickySectionTitles() {
    const panel = document.querySelector("#evaluationView .employee-info-panel");
    if (!panel) return;

    uiImpStickyObserver?.disconnect();
    uiImpStickyObserver = new ResizeObserver(() => uiImpUpdateStickyOffsets());
    uiImpStickyObserver.observe(panel);
    requestAnimationFrame(uiImpUpdateStickyOffsets);
  }

  function uiImpApplyManualScoreMode() {
    document
      .querySelectorAll("#evaluationSections .score-input-mode-row")
      .forEach(row => {
        const select = row.querySelector("select[data-item]");
        const input = row.querySelector("[data-manual-score]");
        const button = row.querySelector("[data-manual-score-toggle]");
        if (!select || !input || !button) return;

        input.value = select.value || "";
        select.classList.toggle("manual-score-hidden", uiImpManualScoreMode);
        input.classList.toggle("hidden", !uiImpManualScoreMode);
        button.textContent = uiImpManualScoreMode ? "解除" : "手入力";
        button.classList.toggle("manual-active", uiImpManualScoreMode);
      });
  }

  function uiImpSetManualScoreMode(enabled, focusItemId = null) {
    if (!enabled && uiImpManualScoreMode) {
      alert(
        "手入力モードを解除します。手入力した内容は、一時保存または提出を行うまでデータベースには保存されません。"
      );
    }

    uiImpManualScoreMode = enabled;
    uiImpApplyManualScoreMode();

    if (enabled && focusItemId != null) {
      setTimeout(() => {
        document
          .querySelector(`[data-manual-score="${focusItemId}"]`)
          ?.focus();
      }, 0);
    }
  }

  function uiImpSetupManualScoreInputs() {
    document
      .querySelectorAll("#evaluationSections .input-box select[data-item]")
      .forEach(select => {
        let row = select.closest(".score-input-mode-row");

        if (!row) {
          row = document.createElement("div");
          row.className = "score-input-mode-row";
          select.parentNode.insertBefore(row, select);
          row.appendChild(select);

          const input = document.createElement("input");
          input.type = "text";
          input.inputMode = "numeric";
          input.maxLength = 1;
          input.autocomplete = "off";
          input.className = "manual-score-input hidden";
          input.dataset.manualScore = select.dataset.item;
          input.setAttribute("aria-label", "評価点を手入力");
          input.setAttribute("placeholder", "1～5");
          row.appendChild(input);

          const button = document.createElement("button");
          button.type = "button";
          button.className = "btn btn-secondary manual-score-toggle";
          button.dataset.manualScoreToggle = select.dataset.item;
          button.textContent = "手入力";
          row.appendChild(button);

          input.addEventListener("beforeinput", event => {
            if (
              event.data &&
              !/^[1-5]$/.test(event.data)
            ) {
              event.preventDefault();
            }
          });

          input.addEventListener("input", () => {
            const value = input.value;
            if (value === "") {
              select.value = "";
              select.dispatchEvent(new Event("change", { bubbles: true }));
              return;
            }
            if (!/^[1-5]$/.test(value)) {
              input.value = select.value || "";
              return;
            }
            select.value = value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          });

          select.addEventListener("change", () => {
            if (document.activeElement !== input) {
              input.value = select.value || "";
            }
          });

          button.addEventListener("click", () => {
            uiImpSetManualScoreMode(
              !uiImpManualScoreMode,
              select.dataset.item
            );
          });
        }
      });

    uiImpApplyManualScoreMode();
  }

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

    const selects = [
      ...document.querySelectorAll("#evaluationSections select[data-item]")
    ].filter(el => !el.disabled);
    const index = selects.indexOf(select);
    if (index < 0 || index >= selects.length - 1) return;

    const nextSelect = selects[index + 1];
    const nextRow = nextSelect.closest(".eval-item");
    const nextFocus = uiImpManualScoreMode
      ? nextRow?.querySelector("[data-manual-score]")
      : nextSelect;

    nextRow?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => nextFocus?.focus({ preventScroll: true }), 220);
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
          setTimeout(() => {
            if (
              activeStage === "interview" &&
              row?.classList.contains("comment-required")
            ) {
              row.querySelector("[data-item-comment]")?.focus();
              return;
            }
            uiImpScrollToNextItem(select);
          }, 70);
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

  let uiImpEmployeeListRenderSeq = 0;

  function uiImpScoreSummary(record, items, stage) {
    const meta = STAGE_META[stage];
    const eligible = items.filter(item => !!item[meta.can]);
    const scores = record[meta.field] || {};
    const entered = eligible.filter(
      item => Number(scores[itemKey(item.id)] || 0) > 0
    ).length;

    return {
      value: entered ? weighted(eligible, scores) : null,
      entered,
      total: eligible.length
    };
  }

  function uiImpScoreBadge(label, summary) {
    const value = summary.value == null ? "-" : summary.value.toFixed(1);
    return `
      <div class="employee-list-score">
        <span>${esc(label)}</span>
        <strong>${value}</strong>
        <small>${summary.entered} / ${summary.total}項目</small>
      </div>
    `;
  }

  renderEmployeeRows = async function (stage, q) {
    const renderSeq = ++uiImpEmployeeListRenderSeq;
    let targets = getManagedRecords().filter(record => {
      const employee = employeeMap.get(record.employee_id);
      const haystack = `${employee?.name || ""} ${employee?.employee_code || ""}`.toLowerCase();
      return !q || haystack.includes(q);
    });

    targets.sort((a, b) => {
      const aComplete = recordCompleteForStage(a, stage);
      const bComplete = recordCompleteForStage(b, stage);
      if (aComplete !== bComplete) return aComplete ? 1 : -1;

      return String(employeeMap.get(a.employee_id)?.employee_code || "")
        .localeCompare(
          String(employeeMap.get(b.employee_id)?.employee_code || ""),
          "ja",
          { numeric: true }
        );
    });

    const incomplete = targets.filter(
      record => !recordCompleteForStage(record, stage)
    ).length;

    $("employeeListCount").textContent = `${targets.length}名`;
    $("listIncompleteNotice").innerHTML =
      `<strong>${incomplete}名の${stage === "primary" ? "一次評価" : "面談後評価"}が完了していません。${incomplete ? "対応が必要です。" : ""}</strong><br>未完了の社員は一覧上部に表示しています。`;

    if (!targets.length) {
      $("employeeList").innerHTML =
        '<div class="employee-score-loading">該当する社員はいません。</div>';
      return;
    }

    $("employeeList").innerHTML =
      '<div class="employee-score-loading">点数を集計しています...</div>';

    const templateIds = [...new Set(targets.map(record => record.template_id))];
    const templateEntries = await Promise.all(
      templateIds.map(async templateId => [
        templateId,
        await getItems(templateId)
      ])
    );
    const itemsByTemplate = new Map(templateEntries);

    if (renderSeq !== uiImpEmployeeListRenderSeq || activeStage !== stage) return;

    $("employeeList").innerHTML = targets.map(record => {
      const employee = employeeMap.get(record.employee_id);
      const complete = recordCompleteForStage(record, stage);
      const items = itemsByTemplate.get(record.template_id) || [];

      const selfScore = uiImpScoreSummary(record, items, "self");
      const primaryScore = uiImpScoreSummary(record, items, "primary");
      const interviewScore =
        stage === "interview"
          ? uiImpScoreSummary(record, items, "interview")
          : null;

      const scoreMarkup = `
        <div class="employee-list-scores" aria-label="${esc(employee?.name || "")}の評価点">
          ${uiImpScoreBadge("自己", selfScore)}
          ${uiImpScoreBadge("一次", primaryScore)}
          ${interviewScore ? uiImpScoreBadge("面談後", interviewScore) : ""}
        </div>
      `;

      return `
        <div class="employee-row employee-row-with-scores ${complete ? "complete" : "need-action"}">
          <div class="row-avatar">${esc(employeeInitial(employee?.name))}</div>
          <div class="employee-list-person">
            <div class="row-title">${esc(employee?.name || "-")}</div>
            <div class="row-meta">${esc(employee?.employee_code || "")} / ${esc(employee?.department || "")} / ${esc(employee?.job_level || "")}</div>
          </div>
          ${scoreMarkup}
          <span class="status-chip ${complete ? "done" : "warn"}">${complete ? "完了" : "未完了"}</span>
          <button class="btn ${complete ? "btn-secondary" : "btn-primary"}" data-record="${record.id}" data-stage="${stage}">
            ${complete ? "確認・編集" : "評価する"}
          </button>
        </div>
      `;
    }).join("");

    document.querySelectorAll("#employeeList [data-stage]").forEach(button => {
      button.onclick = () =>
        openEvaluation(Number(button.dataset.record), button.dataset.stage);
    });
  };

  renderSections = function () {
    uiImpOriginalRenderSections();
    uiImpCollapseExecutiveOnlySection();
    uiImpBindMissingClear();
    uiImpSetupManualScoreInputs();
    requestAnimationFrame(uiImpUpdateStickyOffsets);
  };

  openEvaluation = async function (recordId, stage) {
    uiImpResetMissingState();
    await uiImpOriginalOpenEvaluation(recordId, stage);
    uiImpRenderEmployeeSwitcher();
    uiImpRenderCopyPasteActions();
    uiImpSetupStickySectionTitles();
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
    link.href = './continuous-input.css?v=1.4';
    link.dataset.continuousInput = 'true';
    document.head.appendChild(link);
  }
  if (!document.querySelector('script[data-continuous-input]')) {
    const script = document.createElement('script');
    script.src = './continuous-input.js?v=1.4';
    script.dataset.continuousInput = 'true';
    document.body.appendChild(script);
  }
})();
