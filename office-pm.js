/*
 * 오피스 앱 – 예방정비(PM) 일정
 *  - 정비 기준(pmTasks) × 설비 → 다음 예정일 / 남은 운전시간 / 상태 계산
 *  - 오피스 "정비 일정" 패널, Equipment Card 의 MAINTENANCE 표, 정비 완료 기록 입력
 * 계산: 달력(개월)과 운전시간 중 먼저 도래하는 쪽. 기준일 = 최근 수행일, 없으면 최초 기동일.
 */
(function () {
  const SOON_DAYS = 14;
  const SOON_HOURS = 200;
  let filter = "urgent"; // urgent | all

  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const num = (v) => (v === "" || v === null || v === undefined || !isFinite(Number(v)) ? null : Number(v));
  function parse(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function addMonths(date, months) {
    const t = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    t.setDate(Math.min(date.getDate(), last));
    return t;
  }
  const todayDate = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  };

  // 설비에 적용할 정비 항목: pmCodes 가 있으면 그것, 없으면 펌프+전동기 (NH3 구역은 암모니아 항목 추가)
  function tasksFor(eq, tasks) {
    if (Array.isArray(eq.pmCodes) && eq.pmCodes.length) return tasks.filter((t) => eq.pmCodes.includes(t.code));
    const nh3 = String(eq.fieldZone || "").toUpperCase() === "NH3";
    return tasks.filter((t) => t.target === "pump" || t.target === "motor" || (nh3 && t.target === "ammonia"));
  }

  function scheduleFor(eq, state) {
    const tasks = [...(state.pmTasks || [])].sort((a, b) => String(a.code).localeCompare(String(b.code)));
    const today = todayDate();
    const hoursNow = num(eq.runningHours);
    return tasksFor(eq, tasks).map((task) => {
      const records = (state.pmRecords || [])
        .filter((r) => r.equipmentId === eq.id && r.pmCode === task.code)
        .sort((a, b) => String(b.doneDate).localeCompare(String(a.doneDate)));
      const last = records[0] || null;
      const base = parse(last ? last.doneDate : eq.startupDate);
      const months = num(task.intervalMonths);
      const hours = num(task.intervalHours);
      const nextDate = base && months ? addMonths(base, months) : null;
      const daysLeft = nextDate ? Math.round((nextDate - today) / 86400000) : null;
      const hoursLeft = hours && hoursNow !== null ? hours - (hoursNow - (num(last && last.hoursAtDone) || 0)) : null;
      let status = "ok";
      if ((daysLeft !== null && daysLeft < 0) || (hoursLeft !== null && hoursLeft < 0)) status = "overdue";
      else if ((daysLeft !== null && daysLeft <= SOON_DAYS) || (hoursLeft !== null && hoursLeft <= SOON_HOURS)) status = "soon";
      else if (daysLeft === null && hoursLeft === null) status = "nobase";
      return { eq, task, last, nextDate, daysLeft, hoursLeft, status };
    });
  }

  const STATUS = {
    overdue: { label: "기한 초과", cls: "pm-overdue", icon: "!" },
    soon: { label: "임박", cls: "pm-soon", icon: "⏳" },
    ok: { label: "정상", cls: "pm-ok", icon: "✓" },
    nobase: { label: "기준일 없음", cls: "pm-nobase", icon: "?" }
  };
  const intervalText = (t) =>
    [num(t.intervalMonths) ? `${t.intervalMonths}개월` : "", num(t.intervalHours) ? `${Number(t.intervalHours).toLocaleString()}h` : ""]
      .filter(Boolean)
      .join(" / ") || "-";
  const remainText = (s) => {
    const parts = [];
    if (s.daysLeft !== null) parts.push(s.daysLeft < 0 ? `${-s.daysLeft}일 지남` : `${s.daysLeft}일`);
    if (s.hoursLeft !== null) parts.push(s.hoursLeft < 0 ? `${Math.round(-s.hoursLeft).toLocaleString()}h 초과` : `${Math.round(s.hoursLeft).toLocaleString()}h`);
    return parts.join(" / ") || "-";
  };
  const badge = (status) => `<span class="pm-badge ${STATUS[status].cls}">${STATUS[status].icon} ${STATUS[status].label}</span>`;

  // ---------- 오피스 "정비 일정" 패널 ----------
  function renderPanel(state) {
    const root = document.getElementById("pmPanel");
    if (!root) return;
    if (!(state.pmTasks || []).length) {
      root.innerHTML = '<h2>정비 일정</h2><p class="pm-note">정비 기준을 불러오는 중이거나, 서버(Code.gs)가 아직 정비 기능 버전이 아닙니다.</p>';
      return;
    }
    const all = state.equipment.flatMap((eq) => scheduleFor(eq, state));
    const count = (st) => all.filter((s) => s.status === st).length;
    const order = { overdue: 0, soon: 1, nobase: 2, ok: 3 };
    const rows = all
      .filter((s) => (filter === "urgent" ? s.status === "overdue" || s.status === "soon" : true))
      .sort((a, b) => order[a.status] - order[b.status] || (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999));
    const shown = rows.slice(0, 300);

    root.innerHTML = `
      <div class="st-head">
        <h2>정비 일정 <small class="pm-note">(샘플 기준 · 달력/운전시간 중 먼저 도래)</small></h2>
        <div class="st-range" role="group" aria-label="보기">
          <button type="button" data-pm-filter="urgent" class="${filter === "urgent" ? "is-active" : ""}">기한 초과·임박</button>
          <button type="button" data-pm-filter="all" class="${filter === "all" ? "is-active" : ""}">전체</button>
        </div>
      </div>
      <div class="st-kpis pm-kpis">
        <div class="st-kpi"><span>! 기한 초과</span><strong>${count("overdue")}</strong></div>
        <div class="st-kpi"><span>⏳ ${SOON_DAYS}일/${SOON_HOURS}h 이내</span><strong>${count("soon")}</strong></div>
        <div class="st-kpi"><span>✓ 정상</span><strong>${count("ok")}</strong></div>
        <div class="st-kpi"><span>? 기준일 없음</span><strong>${count("nobase")}</strong></div>
      </div>
      <div class="pm-table-wrap">
        <table class="pm-table">
          <thead><tr><th>설비</th><th>정비 항목</th><th>주기</th><th>최근 수행</th><th>다음 예정</th><th>남은 기간</th><th>상태</th><th></th></tr></thead>
          <tbody>
            ${
              shown.length
                ? shown
                    .map(
                      (s) => `<tr>
                  <td><button type="button" class="pm-link" data-pm-eq="${esc(s.eq.id)}">${esc(s.eq.name)}</button><small>${esc(s.eq.equipmentCode || "")}</small></td>
                  <td>${esc(s.task.name)}</td>
                  <td>${esc(intervalText(s.task))}</td>
                  <td>${s.last ? esc(s.last.doneDate) : "-"}</td>
                  <td>${s.nextDate ? ymd(s.nextDate) : "-"}</td>
                  <td>${esc(remainText(s))}</td>
                  <td>${badge(s.status)}</td>
                  <td><button type="button" class="pm-done-btn" data-pm-done="${esc(s.eq.id)}|${esc(s.task.code)}">완료 기록</button></td>
                </tr>`
                    )
                    .join("")
                : `<tr><td colspan="8" class="pm-empty">${filter === "urgent" ? "✓ 기한 초과·임박 정비가 없습니다." : "정비 항목이 없습니다."}</td></tr>`
            }
          </tbody>
        </table>
        ${rows.length > shown.length ? `<p class="pm-note">상위 ${shown.length}건만 표시 (전체 ${rows.length}건)</p>` : ""}
      </div>
      <p class="pm-note">운전시간 기준 항목은 설비의 <b>누적 운전시간</b>이 입력돼야 계산됩니다 (아래 '추가 설비 정보' 또는 엑셀 불러오기).</p>`;

    root.querySelectorAll("[data-pm-filter]").forEach((b) =>
      b.addEventListener("click", () => {
        filter = b.dataset.pmFilter;
        renderPanel(state);
      })
    );
    root.querySelectorAll("[data-pm-eq]").forEach((b) =>
      b.addEventListener("click", () => window.officeSelectEquipment && window.officeSelectEquipment(b.dataset.pmEq))
    );
    root.querySelectorAll("[data-pm-done]").forEach((b) =>
      b.addEventListener("click", () => {
        const [eqId, code] = b.dataset.pmDone.split("|");
        openDoneDialog(state, eqId, code);
      })
    );
  }

  // ---------- Equipment Card 의 MAINTENANCE 표 (인쇄 포함) ----------
  function renderCard(state, eq) {
    const root = document.getElementById("cardMaintenance");
    if (!root) return;
    if (!eq || !(state.pmTasks || []).length) {
      root.innerHTML = "";
      return;
    }
    const list = scheduleFor(eq, state);
    root.innerHTML = `
      <div class="history-title-line">○ MAINTENANCE SCHEDULE</div>
      <table class="pm-card-table">
        <thead><tr><th>No</th><th>ITEM</th><th>INTERVAL</th><th>LAST DONE</th><th>NEXT DUE</th><th>REMAINING</th><th>STATUS</th></tr></thead>
        <tbody>
          ${list
            .map(
              (s, i) => `<tr>
              <td>${i + 1}</td><td class="pm-left">${esc(s.task.name)}</td><td>${esc(intervalText(s.task))}</td>
              <td>${s.last ? esc(s.last.doneDate) : "-"}</td><td>${s.nextDate ? ymd(s.nextDate) : "-"}</td>
              <td>${esc(remainText(s))}</td><td>${STATUS[s.status].icon} ${STATUS[s.status].label}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  }

  // ---------- 정비 완료 기록 입력창 ----------
  function openDoneDialog(state, eqId, code) {
    const eq = state.equipment.find((e) => e.id === eqId);
    const task = (state.pmTasks || []).find((t) => t.code === code);
    if (!eq || !task) return;
    let overlay = document.getElementById("pmDialog");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "pmDialog";
      overlay.className = "pm-dialog";
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <form class="pm-dialog-box">
        <h3>정비 완료 기록</h3>
        <p><b>${esc(eq.name)}</b> <small>${esc(eq.equipmentCode || "")}</small><br>${esc(task.name)} <small>(${esc(intervalText(task))})</small></p>
        <label>완료일<input type="date" name="doneDate" value="${ymd(todayDate())}" required /></label>
        <label>완료 시 누적 운전시간 (h, 선택)<input type="number" name="hoursAtDone" min="0" step="1" value="${num(eq.runningHours) ?? ""}" /></label>
        <label>작업자<input name="doneBy" placeholder="예: 홍길동" /></label>
        <label>메모<input name="note" placeholder="교체 부품, 특이사항 등" /></label>
        <div class="pm-dialog-actions">
          <button type="button" class="secondary" data-pm-cancel>취소</button>
          <button type="submit">저장</button>
        </div>
      </form>`;
    overlay.hidden = false;
    const form = overlay.querySelector("form");
    overlay.querySelector("[data-pm-cancel]").addEventListener("click", () => (overlay.hidden = true));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = "저장 중...";
      try {
        await window.officeApi("/api/pm-records", {
          method: "POST",
          body: JSON.stringify({ ...data, equipmentId: eq.id, equipmentName: eq.name, pmCode: task.code, pmName: task.name })
        });
        overlay.hidden = true;
        if (window.officeReload) await window.officeReload();
        if (window.officeToast) window.officeToast(`정비 완료 기록을 저장했습니다: ${eq.name} – ${task.name}`);
      } catch (error) {
        button.disabled = false;
        button.textContent = "저장";
        alert(error.message || "저장하지 못했습니다.");
      }
    });
  }

  window.renderPmPanel = renderPanel;
  window.renderPmCard = renderCard;
})();
