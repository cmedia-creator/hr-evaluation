// 人事評価システム UI/入力検証改善パッチ 2026-09-10
// app.js 読み込み後に実行する。

(() => {
  const uiImpOriginalRenderSections = renderSections;
  const uiImpOriginalOpenEvaluation = openEvaluation;
  const uiImpOriginalSaveStage = saveStage;

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
  };

  saveStage = async function (submit = false) {
    if (submit && !uiImpValidateSubmission()) return;
    return await uiImpOriginalSaveStage(submit);
  };

  // 既存の提出ボタンは saveStage(true) を呼ぶため、上記差し替えで両方に効く。
  uiImpEnsureMissingBanner();
})();
