/*
 * 오피스 앱 - 반출 중 설비 목록 + 반입 처리
 * 작업 기록(work-logs) 중 가장 최근 항목이 "외부 반출"인 설비를 모아 보여주고,
 * "반입 처리" 버튼으로 반입(복귀) 작업 기록을 즉시 생성합니다.
 */
(function () {
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function workLogsForEquipment(state, equipmentId) {
    return state.workLogs
      .filter((item) => item.equipmentId === equipmentId)
      .slice()
      .sort(
        (a, b) =>
          String(b.workDate || "").localeCompare(String(a.workDate || "")) ||
          String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
      );
  }

  function checkedOutList(state) {
    return state.equipment
      .map((equipment) => ({ equipment, logs: workLogsForEquipment(state, equipment.id) }))
      .filter(({ logs }) => logs.length && logs[0].workType === "checkedOut")
      .map(({ equipment, logs }) => ({ equipment, latestLog: logs[0] }));
  }

  async function checkIn(equipment, latestLog) {
    if (!window.officeApi) return;
    if (!window.confirm(`${equipment.name} 을(를) 반입 처리할까요?`)) return;
    try {
      await window.officeApi("/api/work-logs", {
        method: "POST",
        body: JSON.stringify({
          equipmentId: equipment.id,
          workType: "checkedIn",
          workDate: today(),
          worker: latestLog.worker || "",
          description: "반입(복귀) 처리"
        })
      });
      window.officeToast && window.officeToast(`${equipment.name} 반입 처리되었습니다.`);
      window.officeReload && window.officeReload();
    } catch (error) {
      window.officeToast && window.officeToast(error.message, "error");
    }
  }

  function render(state) {
    const root = document.getElementById("worklogPanel");
    if (!root || !state.equipment.length) return;

    const list = checkedOutList(state).sort((a, b) =>
      String(a.latestLog.workDate || "").localeCompare(String(b.latestLog.workDate || ""))
    );

    root.innerHTML = `
      <div class="panel-head">
        <h2>반출 중 설비 (${list.length})</h2>
      </div>
      <div class="office-equipment-list worklog-checkedout-list">
        ${
          list.length
            ? list
                .map(
                  ({ equipment, latestLog }) => `
                    <div class="worklog-checkedout-row">
                      <button type="button" class="worklog-eq-link" data-worklog-jump="${esc(equipment.id)}">
                        <strong>${esc(equipment.name)}</strong>
                        <span>${esc(equipment.equipmentCode || "-")} · 반출일 ${esc(latestLog.workDate || "-")} · ${esc(latestLog.worker || "작업자 미입력")}</span>
                        ${latestLog.description ? `<span class="worklog-desc">${esc(latestLog.description)}</span>` : ""}
                      </button>
                      <button type="button" class="secondary worklog-checkin-btn" data-worklog-checkin="${esc(equipment.id)}">반입 처리</button>
                    </div>
                  `
                )
                .join("")
            : `<p class="empty">현재 반출 중인 설비가 없습니다.</p>`
        }
      </div>
    `;

    root.querySelectorAll("[data-worklog-jump]").forEach((btn) =>
      btn.addEventListener("click", () => window.officeSelectEquipment && window.officeSelectEquipment(btn.dataset.worklogJump))
    );
    root.querySelectorAll("[data-worklog-checkin]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.dataset.worklogCheckin;
        const entry = list.find((row) => row.equipment.id === id);
        if (entry) checkIn(entry.equipment, entry.latestLog);
      })
    );
  }

  window.renderWorklogPanel = render;
})();
