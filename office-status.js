/*
 * 오피스 앱 – 점검 현황 (오늘 KPI + 일별 완료/미완료 추이 + 오늘 미완료 목록)
 * 대상 계산 규칙은 현장 앱과 동일: 반기(최초 기동일 기준 6개월) > 주간(목요일) > 일간
 */
(function () {
  const COLORS = { done: "#0ca30c", open: "#d03b3b" };
  const CYCLE_LABEL = { daily: "일간", weekly: "주간", semiannual: "반기" };
  let rangeDays = 14;

  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function parse(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const has = (eq, c) => (eq.cycles || []).includes(c);

  function semiannualDue(start, day) {
    const diff = (day.getFullYear() - start.getFullYear()) * 12 + (day.getMonth() - start.getMonth());
    if (diff <= 0 || diff % 6 !== 0) return false;
    const target = new Date(start.getFullYear(), start.getMonth() + diff, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(start.getDate(), last));
    return ymd(target) === ymd(day);
  }

  // 그 날 해당 설비의 점검 대상 주기 (없으면 null)
  function dueCycle(eq, day) {
    const startup = parse(eq.startupDate);
    if (startup && day >= startup && has(eq, "semiannual") && semiannualDue(startup, day)) return "semiannual";
    if (has(eq, "weekly") && day.getDay() === 4) return "weekly";
    if (has(eq, "daily")) return "daily";
    return null;
  }

  function computeDays(state, days) {
    const doneKeys = new Set(
      state.inspections
        .filter((i) => (i.resultStatus || "complete") === "complete")
        .map((i) => `${i.equipmentId}|${i.inspectionDate}|${i.cycle}`)
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = [];
    for (let k = days - 1; k >= 0; k--) {
      const day = new Date(today);
      day.setDate(today.getDate() - k);
      const date = ymd(day);
      let due = 0;
      let done = 0;
      const open = [];
      state.equipment.forEach((eq) => {
        if (eq.active === false) return;
        const startup = parse(eq.startupDate);
        const cycle = dueCycle(eq, day);
        if (!cycle) return;
        due++;
        if (doneKeys.has(`${eq.id}|${date}|${cycle}`)) done++;
        else open.push({ eq, cycle });
      });
      result.push({ date, day, due, done, open });
    }
    return result;
  }

  function chartSvg(series) {
    const W = 760;
    const H = 220;
    const m = { l: 34, r: 8, t: 12, b: 26 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const max = Math.max(1, ...series.map((s) => s.due));
    const step = iw / series.length;
    const bw = Math.max(6, Math.min(34, step * 0.62));
    const y = (v) => m.t + ih - (v / max) * ih;
    const ticks = [0, Math.round(max / 2), max];
    const labelEvery = series.length > 16 ? 3 : series.length > 9 ? 2 : 1;

    let g = "";
    ticks.forEach((t) => {
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="#e3e8eb" stroke-width="1"/>`;
      g += `<text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end" class="st-axis">${t}</text>`;
    });

    series.forEach((s, i) => {
      const cx = m.l + step * i + step / 2;
      const x = cx - bw / 2;
      const openCount = s.due - s.done;
      const hDone = (s.done / max) * ih;
      const hOpen = (openCount / max) * ih;
      const base = m.t + ih;
      const gap = hDone > 0 && hOpen > 0 ? 2 : 0;
      const r = Math.min(4, bw / 2);
      // 위쪽 끝만 둥글게 (데이터 끝), 아래는 기준선에 붙임
      const rounded = (x0, yTop, w, h) =>
        h <= 0
          ? ""
          : `M${x0},${yTop + h} L${x0},${yTop + Math.min(r, h)} Q${x0},${yTop} ${x0 + r},${yTop} L${x0 + w - r},${yTop} Q${x0 + w},${yTop} ${x0 + w},${yTop + Math.min(r, h)} L${x0 + w},${yTop + h} Z`;
      const topIsOpen = hOpen > 0;
      if (hDone > 0) {
        g += topIsOpen
          ? `<rect x="${x}" y="${base - hDone}" width="${bw}" height="${hDone}" fill="${COLORS.done}"/>`
          : `<path d="${rounded(x, base - hDone, bw, hDone)}" fill="${COLORS.done}"/>`;
      }
      if (hOpen > 0) {
        g += `<path d="${rounded(x, base - hDone - gap - hOpen, bw, hOpen)}" fill="${COLORS.open}"/>`;
      }
      if (i % labelEvery === 0 || i === series.length - 1) {
        g += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="st-axis">${s.date.slice(5)}</text>`;
      }
      // 마우스 올리는 영역 (막대보다 넓게)
      g += `<rect x="${m.l + step * i}" y="${m.t}" width="${step}" height="${ih}" fill="transparent" data-st-index="${i}" class="st-hit"/>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="st-chart" role="img" aria-label="일별 점검 완료/미완료 추이">${g}</svg>`;
  }

  function render(state) {
    const root = document.getElementById("statusPanel");
    if (!root || !state.equipment.length) return;
    const series = computeDays(state, rangeDays);
    const today = series[series.length - 1];
    const rate = today.due ? Math.round((today.done / today.due) * 100) : 0;
    const total = series.reduce((a, s) => ({ due: a.due + s.due, done: a.done + s.done }), { due: 0, done: 0 });
    const periodRate = total.due ? Math.round((total.done / total.due) * 100) : 0;

    root.innerHTML = `
      <div class="st-head">
        <h2>점검 현황</h2>
        <div class="st-range" role="group" aria-label="기간">
          ${[7, 14, 30].map((d) => `<button type="button" data-st-range="${d}" class="${d === rangeDays ? "is-active" : ""}">${d}일</button>`).join("")}
        </div>
      </div>
      <div class="st-kpis">
        <div class="st-kpi"><span>오늘 대상</span><strong>${today.due}</strong></div>
        <div class="st-kpi"><span>오늘 완료</span><strong>${today.done}</strong></div>
        <div class="st-kpi"><span>오늘 미완료</span><strong>${today.due - today.done}</strong></div>
        <div class="st-kpi"><span>오늘 완료율</span><strong>${rate}%</strong></div>
        <div class="st-kpi"><span>최근 ${rangeDays}일 완료율</span><strong>${periodRate}%</strong></div>
      </div>
      <div class="st-legend">
        <span><i style="background:${COLORS.done}"></i>완료</span>
        <span><i style="background:${COLORS.open}"></i>미완료</span>
      </div>
      <div class="st-chart-wrap">${chartSvg(series)}<div class="st-tip" hidden></div></div>
      <details class="st-table">
        <summary>표로 보기</summary>
        <table><thead><tr><th>날짜</th><th>대상</th><th>완료</th><th>미완료</th><th>완료율</th></tr></thead><tbody>
          ${[...series].reverse().map((s) => `<tr><td>${s.date}</td><td>${s.due}</td><td>${s.done}</td><td>${s.due - s.done}</td><td>${s.due ? Math.round((s.done / s.due) * 100) : 0}%</td></tr>`).join("")}
        </tbody></table>
      </details>
      <div class="st-open">
        <h3>오늘 미완료 설비 (${today.open.length})</h3>
        <div class="st-open-list">
          ${
            today.open.length
              ? today.open
                  .sort((a, b) => String(a.eq.location || "").localeCompare(String(b.eq.location || "")) || a.eq.name.localeCompare(b.eq.name))
                  .slice(0, 300)
                  .map((o) => `<button type="button" data-st-eq="${esc(o.eq.id)}"><strong>${esc(o.eq.name)}</strong><span>${esc(o.eq.equipmentCode || "")} · ${CYCLE_LABEL[o.cycle]}</span></button>`)
                  .join("")
              : '<p class="st-empty">✓ 오늘 대상 점검이 모두 완료되었습니다.</p>'
          }
        </div>
      </div>`;

    root.querySelectorAll("[data-st-range]").forEach((b) =>
      b.addEventListener("click", () => {
        rangeDays = Number(b.dataset.stRange);
        render(state);
      })
    );
    root.querySelectorAll("[data-st-eq]").forEach((b) =>
      b.addEventListener("click", () => window.officeSelectEquipment && window.officeSelectEquipment(b.dataset.stEq))
    );
    const tip = root.querySelector(".st-tip");
    const wrap = root.querySelector(".st-chart-wrap");
    root.querySelectorAll(".st-hit").forEach((hit) => {
      hit.addEventListener("mouseenter", () => {
        const s = series[Number(hit.dataset.stIndex)];
        tip.innerHTML = `<strong>${s.date}</strong><br>대상 ${s.due} · 완료 ${s.done} · 미완료 ${s.due - s.done}<br>완료율 ${s.due ? Math.round((s.done / s.due) * 100) : 0}%`;
        tip.hidden = false;
      });
      hit.addEventListener("mousemove", (e) => {
        const box = wrap.getBoundingClientRect();
        const x = Math.min(e.clientX - box.left + 12, box.width - 170);
        tip.style.left = `${Math.max(0, x)}px`;
        tip.style.top = `${e.clientY - box.top - 10}px`;
      });
      hit.addEventListener("mouseleave", () => (tip.hidden = true));
    });
  }

  window.renderStatusPanel = render;
})();
