/*
 * 유틸리티(탱크) 트렌드 - 오피스 리포트용
 * 각 탱크군(DM Water / Service Water / Fuel Oil / Ammonia)의 충수율(%) 추이를
 * 기간 전체에 걸쳐 선 그래프로 보여줍니다. 외부 차트 라이브러리 없이 순수 SVG로 그립니다.
 */
(function () {
  const GROUP_ORDER_FALLBACK = ["DM Water", "Service Water", "Fuel Oil", "Ammonia"];
  const LINE_COLORS = ["#0f766e", "#2563eb", "#b45309", "#7c3aed"];

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function parseLocalDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function formatDateShort(date) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function buildLineChartSvg(series, { width = 640, height = 220 } = {}) {
    const padding = { top: 14, right: 16, bottom: 26, left: 34 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;

    const allPoints = series.flatMap((s) => s.points);
    if (!allPoints.length) {
      return `<p class="empty">데이터가 없습니다.</p>`;
    }

    const minTime = Math.min(...allPoints.map((p) => p.date.getTime()));
    const maxTime = Math.max(...allPoints.map((p) => p.date.getTime()));
    const timeSpan = Math.max(1, maxTime - minTime);

    const xFor = (date) => padding.left + ((date.getTime() - minTime) / timeSpan) * innerW;
    const yFor = (percent) => padding.top + innerH - (Math.max(0, Math.min(100, percent)) / 100) * innerH;

    const gridLines = [0, 25, 50, 75, 100]
      .map(
        (v) => `
          <line x1="${padding.left}" y1="${yFor(v)}" x2="${width - padding.right}" y2="${yFor(v)}" stroke="var(--line)" stroke-width="1" />
          <text x="${padding.left - 6}" y="${yFor(v) + 4}" font-size="10" fill="var(--muted)" text-anchor="end">${v}%</text>
        `
      )
      .join("");

    const startDate = new Date(minTime);
    const endDate = new Date(maxTime);
    const xLabels = `
      <text x="${padding.left}" y="${height - 8}" font-size="10" fill="var(--muted)" text-anchor="start">${formatDateShort(startDate)}</text>
      <text x="${width - padding.right}" y="${height - 8}" font-size="10" fill="var(--muted)" text-anchor="end">${formatDateShort(endDate)}</text>
    `;

    const lines = series
      .map((s, index) => {
        if (!s.points.length) return "";
        const color = LINE_COLORS[index % LINE_COLORS.length];
        const path = s.points
          .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.date).toFixed(1)} ${yFor(p.percent).toFixed(1)}`)
          .join(" ");
        return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" />`;
      })
      .join("");

    return `
      <svg viewBox="0 0 ${width} ${height}" class="utility-chart-svg" preserveAspectRatio="none" role="img">
        ${gridLines}
        ${lines}
        ${xLabels}
      </svg>
    `;
  }

  function buildLegend(series) {
    return series
      .map((s, index) => {
        const color = LINE_COLORS[index % LINE_COLORS.length];
        const latest = s.points[s.points.length - 1];
        const latestText = latest ? `${latest.percent.toFixed(1)}%` : "-";
        return `
          <span class="utility-legend-item">
            <span class="utility-legend-dot" style="background:${color}"></span>
            ${s.label} <strong>${latestText}</strong>
          </span>
        `;
      })
      .join("");
  }

  async function fetchJson(path) {
    try {
      const response = await api(path);
      return response;
    } catch (error) {
      return { items: [] };
    }
  }

  async function renderUtilityTrend() {
    const grid = $("#utilityTrendGrid");
    if (!grid) return;

    const [tanksRes, readingsRes] = await Promise.all([
      fetchJson("/api/tanks"),
      fetchJson("/api/tank-readings")
    ]);

    const tanks = tanksRes.items || [];
    const readings = readingsRes.items || [];

    if (!tanks.length) {
      grid.innerHTML = `<p class="empty">등록된 탱크가 없습니다.</p>`;
      return;
    }

    const tanksById = new Map(tanks.map((tank) => [tank.id, tank]));
    const groupOrder = [];
    tanks.forEach((tank) => {
      if (!groupOrder.includes(tank.tankGroup)) groupOrder.push(tank.tankGroup);
    });
    if (!groupOrder.length) groupOrder.push(...GROUP_ORDER_FALLBACK);

    const readingsByTank = new Map();
    readings.forEach((reading) => {
      const date = parseLocalDate(reading.readingDate);
      if (!date) return;
      const list = readingsByTank.get(reading.tankId) || [];
      list.push({ date, percent: Number(reading.levelPercent) || 0 });
      readingsByTank.set(reading.tankId, list);
    });
    readingsByTank.forEach((list) => list.sort((a, b) => a.date - b.date));

    const cards = groupOrder
      .map((group) => {
        const groupTanks = tanks.filter((tank) => tank.tankGroup === group);
        if (!groupTanks.length) return "";

        const series = groupTanks.map((tank) => ({
          label: tank.unitLabel ? `${tank.tankGroup} ${tank.unitLabel}` : tank.name,
          points: readingsByTank.get(tank.id) || []
        }));

        const hasAnyData = series.some((s) => s.points.length);

        return `
          <section class="panel utility-chart-card">
            <div class="panel-head">
              <h3>${group}</h3>
            </div>
            <div class="utility-chart-legend">${buildLegend(series)}</div>
            ${hasAnyData ? buildLineChartSvg(series) : `<p class="empty">기록된 수위 데이터가 없습니다.</p>`}
          </section>
        `;
      })
      .join("");

    grid.innerHTML = cards || `<p class="empty">표시할 탱크군이 없습니다.</p>`;

    const allDates = readings
      .map((r) => parseLocalDate(r.readingDate))
      .filter(Boolean)
      .sort((a, b) => a - b);
    const note = $("#utilityRangeNote");
    if (note && allDates.length) {
      note.textContent = `탱크 수위(충수율) 추이 · ${formatDateShort(allDates[0])} ~ ${formatDateShort(allDates[allDates.length - 1])}`;
    }
  }

  function setupTabs() {
    document.querySelectorAll(".tabs .tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tabs .tab").forEach((t) => t.classList.toggle("is-active", t === tab));
        document.querySelectorAll(".view").forEach((view) => {
          view.classList.toggle("is-active", view.id === `view-${tab.dataset.view}`);
        });
        if (tab.dataset.view === "utility") {
          renderUtilityTrend();
        }
      });
    });
  }

  function init() {
    setupTabs();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
