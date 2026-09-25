const cycleLabels = {
  daily: "일간",
  weekly: "주간",
  semiannual: "반기"
};

const statusLabels = {
  complete: "완료",
  open: "미완료"
};

const state = {
  equipment: [],
  inspections: [],
  tanks: [],
  tankReadings: [],
  photos: [],
  selectedHistoryId: null,
  dashboardDrill: {
    fieldZone: "",
    category0: "",
    category1: ""
  }
};

const INSPECTOR_NAMES_KEY = "rotatingEquipmentInspectorNames";
const LAST_INSPECTOR_NAME_KEY = "rotatingEquipmentLastInspectorName";
const PENDING_INSPECTIONS_KEY = "rotatingEquipmentPendingInspections";
const MAX_INSPECTOR_NAMES = 40;
const PHOTO_MAX_COUNT = 6;
const PHOTO_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const PHOTO_MAX_TOTAL_SOURCE_BYTES = 90 * 1024 * 1024;
const PHOTO_MAX_STORED_BYTES = 1.5 * 1024 * 1024;
const PHOTO_COMPRESSION_STEPS = [
  { maxDimension: 1920, quality: 0.82 },
  { maxDimension: 1920, quality: 0.74 },
  { maxDimension: 1600, quality: 0.78 },
  { maxDimension: 1600, quality: 0.7 },
  { maxDimension: 1280, quality: 0.76 },
  { maxDimension: 1024, quality: 0.72 }
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function todayText() {
  return dateText(new Date());
}

function dateText(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function showToast(message, type = "info") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast is-visible ${type === "error" ? "error" : ""}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.className = "toast";
  }, 2600);
}

const APP_CODE_KEY = "rotatingEquipmentAppCode";
let appCodeChecked = false;

function getStoredAppCode() {
  try {
    return localStorage.getItem(APP_CODE_KEY) || "";
  } catch {
    return "";
  }
}

function setStoredAppCode(code) {
  try {
    if (code) localStorage.setItem(APP_CODE_KEY, code);
    else localStorage.removeItem(APP_CODE_KEY);
  } catch {
    /* ignore storage errors */
  }
}

async function ensureAppCode() {
  if (appCodeChecked) return;
  try {
    const health = await apiFetch("/api/health").then((r) => r.json());
    if (health.codeRequired && !getStoredAppCode()) {
      const input = window.prompt("현장 코드를 입력하세요.");
      if (input) setStoredAppCode(input.trim());
    }
  } catch {
    /* health check failed; continue without blocking local use */
  }
  appCodeChecked = true;
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const storedCode = getStoredAppCode();
  if (storedCode) headers["x-app-code"] = storedCode;
  const response = await apiFetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    setStoredAppCode("");
    const input = window.prompt("현장 코드가 올바르지 않습니다. 다시 입력하세요.");
    if (input) {
      setStoredAppCode(input.trim());
      return api(path, options);
    }
  }
  if (!response.ok) {
    throw new Error(data.error || "요청을 처리하지 못했습니다.");
  }
  return data;
}

function formToObject(form) {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

function checkedValues(form, name) {
  return $$(`input[name="${name}"]:checked`, form).map((input) => input.value);
}

function checkedValue(form, name) {
  return $(`input[name="${name}"]:checked`, form)?.value || "";
}

function normalizeInspectorName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function storedInspectorNames() {
  try {
    const parsed = JSON.parse(localStorage.getItem(INSPECTOR_NAMES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeInspectorName).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function uniqueInspectorNames(values) {
  const seen = new Set();
  const names = [];
  for (const value of values) {
    const name = normalizeInspectorName(value);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names.slice(0, MAX_INSPECTOR_NAMES);
}

function inspectorNames() {
  return uniqueInspectorNames([...storedInspectorNames(), ...state.inspections.map((item) => item.inspector)]);
}

function renderInspectorSuggestions() {
  const options = inspectorNames().map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  const list = $("#inspectorList");
  if (list) list.innerHTML = options;
  const tankList = $("#tankInspectorList");
  if (tankList) tankList.innerHTML = options;
}

function rememberInspectorName(value) {
  const name = normalizeInspectorName(value);
  if (!name) return "";
  const names = uniqueInspectorNames([name, ...storedInspectorNames()]);
  localStorage.setItem(INSPECTOR_NAMES_KEY, JSON.stringify(names));
  localStorage.setItem(LAST_INSPECTOR_NAME_KEY, name);
  renderInspectorSuggestions();
  return name;
}

function lastInspectorName() {
  return normalizeInspectorName(localStorage.getItem(LAST_INSPECTOR_NAME_KEY));
}

function pendingInspections() {
  // 미전송 기록은 IndexedDB(OfflineStore)에 보관합니다. 사진이 많아도 저장 가능.
  return window.OfflineStore.getPending();
}

function pendingInspectionPayloads() {
  return pendingInspections().map((item) => item.payload || item).filter(Boolean);
}

function savePendingInspections(items) {
  return window.OfflineStore.setPending(items);
}

function newOfflineId() {
  return window.crypto && typeof window.crypto.randomUUID === "function"
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function renderPendingBadge(count) {
  let badge = document.getElementById("pendingBadge");
  if (!badge) {
    badge = document.createElement("button");
    badge.id = "pendingBadge";
    badge.type = "button";
    badge.className = "pending-badge";
    badge.addEventListener("click", () => syncPendingInspections());
    document.body.appendChild(badge);
  }
  badge.hidden = !count;
  badge.textContent = navigator.onLine ? `미전송 ${count}건 · 지금 전송` : `미전송 ${count}건 · 오프라인`;
}

function queuePendingInspection(payload) {
  const offlineId = payload.offlineId || newOfflineId();
  payload.offlineId = offlineId;

  const item = {
    offlineId,
    queuedAt: new Date().toISOString(),
    payload
  };
  return savePendingInspections([...pendingInspections(), item]).then(() => item);
}

function isLikelyNetworkError(error) {
  const message = String(error?.message || "");
  return !navigator.onLine || error instanceof TypeError || /failed to fetch|networkerror|load failed|fetch/i.test(message);
}

async function postInspectionPayload(payload) {
  return api("/api/inspections", { method: "POST", body: JSON.stringify(payload) });
}

let pendingSyncRunning = false;

async function syncPendingInspections({ silent = false } = {}) {
  if (pendingSyncRunning) return 0;
  const pending = pendingInspections();
  if (!pending.length || !navigator.onLine) return 0;
  pendingSyncRunning = true;
  try {
    return await syncPendingInspectionsNow(pending, silent);
  } finally {
    pendingSyncRunning = false;
  }
}

async function syncPendingInspectionsNow(pending, silent) {

  const remaining = [];
  let sent = 0;

  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index];
    try {
      const payload = item.payload || item;
      if (!payload.offlineId && item.offlineId) payload.offlineId = item.offlineId;
      await postInspectionPayload(payload);
      sent += 1;
    } catch (error) {
      remaining.push(item, ...pending.slice(index + 1));
      if (!silent) showToast("아직 서버 연결이 불안정해서 미전송 기록을 보관했습니다.", "error");
      break;
    }
  }

  // 전송 중 새로 추가된 기록은 유지
  const sentItems = pending.filter((item) => !remaining.includes(item));
  await savePendingInspections(pendingInspections().filter((item) => !sentItems.includes(item)));
  if (sent > 0) {
    if (!silent) showToast(`오프라인 저장 ${sent}건을 서버로 보냈습니다.`);
    await loadData({ syncPending: false });
  }
  return sent;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const register = () =>
    navigator.serviceWorker.register("sw.js").catch(() => {
      console.info("Service worker registration skipped.");
    });
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register);
}

function equipmentCategory(item, index) {
  if (index === 0 && item.category0) return item.category0;
  if (index === 1 && item.category1) return item.category1;
  if (index === 2 && item.category2) return item.category2;

  const locationParts = String(item.location || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (index === 0) return locationParts[0] || "미분류";
  if (index === 1) return locationParts[1] || "미분류";
  return item.name || "미분류";
}

function inferredFieldZone(category0) {
  return (
    {
      SCR: "NH3",
      ACC: "ACC AREA",
      GT1: "GT-1 BLOCK",
      GT2: "GT-2 BLOCK",
      GT3: "GT-3 BLOCK",
      HRSG1: "HRSG-1 AREA",
      HRSG2: "HRSG-2 AREA",
      HRSG3: "HRSG-3 AREA",
      ST: "STG",
      "COM-STG": "STG"
    }[category0] || "COMMON / OTHER AREA"
  );
}

function equipmentFieldZone(item) {
  return item.fieldZone || inferredFieldZone(equipmentCategory(item, 0));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function setSelectOptions(select, options, selectedValue, labelFor = (item) => item) {
  select.innerHTML = options.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(labelFor(item))}</option>`).join("");
  if (options.includes(selectedValue)) {
    select.value = selectedValue;
  }
}

function setActiveView(viewName) {
  $$(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === viewName));
  $$(".view").forEach((view) => view.classList.toggle("is-active", view.id === `view-${viewName}`));
}

function setCyclePanel(cycle) {
  $("#cycleInput").value = cycle;
  $("#autoCycleLabel").textContent = cycleLabels[cycle] || "일간";
  $("#autoCycleNote").textContent =
    cycle === "weekly"
      ? "목요일은 주간 점검으로 일간 점검을 함께 처리합니다."
      : cycle === "semiannual"
        ? "반기 점검일은 반기 점검으로 일간 점검을 함께 처리합니다."
        : "오늘은 일간 점검 대상입니다.";
}

function answerPayload(form, cycle) {
  const start = checkedValue(form, "dailyStart");
  const common =
    start === "yes"
      ? {
          filterStrainerBlocked: checkedValue(form, "filterBlocked")
        }
      : {
          filterStrainerBlocked: "not_applicable",
          filterStrainerCleaned: "not_applicable"
        };

  if (common.filterStrainerBlocked === "yes") {
    common.filterStrainerCleaned = checkedValue(form, "filterCleaned");
  }

  return {
    ...common,
    start,
    clean: checkedValue(form, "dailyClean"),
    noise: start === "yes" ? checkedValue(form, "dailyNoise") : "not_applicable",
    oilCondition: checkedValue(form, "dailyOilCondition"),
    oilLeak: checkedValue(form, "oilLeak"),
    pumpFanLeak: checkedValue(form, "pumpFanLeak"),
    coolingWaterLeak: checkedValue(form, "coolingWaterLeak")
  };
}

function updateFilterCleanedVisibility() {
  const blocked = checkedValue($("#inspectionForm"), "filterBlocked") === "yes";
  $("#filterCleanedRow").hidden = !blocked;
}

function updateCommonInspectionVisibility() {
  const form = $("#inspectionForm");
  const running = checkedValue(form, "dailyStart") === "yes";
  const panel = $(".common-panel", form);
  if (panel) panel.hidden = !running;

  if (!running) {
    const notBlocked = $('input[name="filterBlocked"][value="no"]', form);
    const cleaned = $('input[name="filterCleaned"][value="yes"]', form);
    if (notBlocked) notBlocked.checked = true;
    if (cleaned) cleaned.checked = true;
  }

  updateFilterCleanedVisibility();
}

function updateNoiseVisibility(prefix) {
  const row = $(`#${prefix}NoiseRow`);
  if (!row) return;
  row.hidden = checkedValue($("#inspectionForm"), `${prefix}Start`) !== "yes";
}

function getSelectedEquipment() {
  const id = $("#equipmentSelect").value;
  return state.equipment.find((item) => item.id === id);
}

function getEquipmentById(id) {
  return state.equipment.find((item) => item.id === id);
}

function updateInspectionCycle() {
  const equipment = getSelectedEquipment();
  const dateValue = $('input[name="inspectionDate"]').value || todayText();
  setCyclePanel(equipment ? autoCycleForEquipment(equipment, dateValue) : "daily");
  updateChecklistVisibility(equipment);
}

function updateChecklistVisibility(equipment) {
  const category1 = equipment ? equipmentCategory(equipment, 1) : "";

  $$("[data-only-for]").forEach((el) => {
    const targets = el.dataset.onlyFor.split(",").map((value) => value.trim());
    const show = targets.includes(category1);
    el.hidden = !show;
    el.style.display = show ? "" : "none";
  });

  $$("[data-hide-for]").forEach((el) => {
    const targets = el.dataset.hideFor.split(",").map((value) => value.trim());
    const hide = targets.includes(category1);
    el.hidden = hide;
    el.style.display = hide ? "none" : "";
  });
}

function renderEquipmentPicker() {
  const hidden = $("#equipmentSelect");
  const category0Select = $("#category0Select");
  const category1Select = $("#category1Select");
  const category2Select = $("#category2Select");
  if (!hidden || !category0Select || !category1Select || !category2Select) return;

  if (!state.equipment.length) {
    hidden.value = "";
    category0Select.innerHTML = `<option value="">등록된 설비 없음</option>`;
    category1Select.innerHTML = `<option value="">-</option>`;
    category2Select.innerHTML = `<option value="">-</option>`;
    return;
  }

  const category0Options = uniqueSorted(state.equipment.map((item) => equipmentCategory(item, 0)));
  setSelectOptions(category0Select, category0Options, category0Select.value || category0Options[0]);

  const category0 = category0Select.value;
  const category1Options = uniqueSorted(
    state.equipment.filter((item) => equipmentCategory(item, 0) === category0).map((item) => equipmentCategory(item, 1))
  );
  setSelectOptions(category1Select, category1Options, category1Select.value || category1Options[0]);

  const category1 = category1Select.value;
  const filteredEquipment = state.equipment
    .filter((item) => equipmentCategory(item, 0) === category0 && equipmentCategory(item, 1) === category1)
    .sort((a, b) => equipmentCategory(a, 2).localeCompare(equipmentCategory(b, 2)));

  category2Select.innerHTML = filteredEquipment
    .map((item) => {
      const label = `${equipmentCategory(item, 2)}${item.equipmentCode ? ` (${item.equipmentCode})` : ""}`;
      return `<option value="${escapeHtml(item.id)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  if (filteredEquipment.some((item) => item.id === hidden.value)) {
    category2Select.value = hidden.value;
  }

  hidden.value = category2Select.value || "";
  updateInspectionCycle();
}

function selectEquipmentForInspection(equipmentId) {
  const equipment = getEquipmentById(equipmentId);
  if (!equipment) return false;

  const category0Select = $("#category0Select");
  const category1Select = $("#category1Select");
  const category2Select = $("#category2Select");
  const hidden = $("#equipmentSelect");

  category0Select.value = equipmentCategory(equipment, 0);
  renderEquipmentPicker();
  category1Select.value = equipmentCategory(equipment, 1);
  renderEquipmentPicker();
  hidden.value = equipment.id;
  category2Select.value = equipment.id;
  updateInspectionCycle();
  return true;
}

function renderEquipmentAdminTable() {
  const table = $("#equipmentAdminTable");
  if (!table) return;

  const keyword = ($("#equipmentSearch")?.value || "").trim().toLowerCase();
  const rows = state.equipment
    .filter((item) => {
      if (!keyword) return true;
      return [item.name, item.equipmentCode, item.fieldZone, item.location].some((value) => String(value || "").toLowerCase().includes(keyword));
    })
    .slice(0, 80);

  table.innerHTML = rows.length
    ? rows
        .map(
          (item) => `
            <tr>
              <td><input data-equipment-field="name" value="${escapeHtml(item.name || "")}" /></td>
              <td><input data-equipment-field="equipmentCode" value="${escapeHtml(item.equipmentCode || "")}" /></td>
              <td><input data-equipment-field="fieldZone" value="${escapeHtml(equipmentFieldZone(item))}" /></td>
              <td><input data-equipment-field="location" value="${escapeHtml(item.location || "")}" /></td>
              <td><input type="date" data-equipment-field="startupDate" value="${escapeHtml(item.startupDate || "")}" /></td>
              <td>
                <div class="row-actions">
                  <button type="button" class="secondary" data-save-equipment="${escapeHtml(item.id)}">저장</button>
                  <button type="button" class="danger-button" data-delete-equipment="${escapeHtml(item.id)}">삭제</button>
                </div>
              </td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="6" class="empty">조회된 설비가 없습니다.</td></tr>`;
}

function formatNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function tankById(id) {
  return state.tanks.find((tank) => tank.id === id);
}

function latestReadingForTank(tankId) {
  return state.tankReadings.find((reading) => reading.tankId === tankId) || null;
}

function renderTankSelectOptions() {
  const select = $("#tankSelect");
  if (!select) return;

  const previousValue = select.value;
  const tanks = [...state.tanks].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  select.innerHTML = tanks.map((tank) => `<option value="${escapeHtml(tank.id)}">${escapeHtml(tank.name)}</option>`).join("");
  if (tanks.some((tank) => tank.id === previousValue)) {
    select.value = previousValue;
  }
  updateTankReadingPreview();
}

function renderTankSpecTable() {
  const table = $("#tankSpecTable");
  if (!table) return;

  const tanks = [...state.tanks].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  table.innerHTML = tanks.length
    ? tanks
        .map(
          (tank) => `
            <tr>
              <td>${escapeHtml(tank.name)}</td>
              <td>${formatNumber(tank.workingVolumeM3)}</td>
              <td>${formatNumber(tank.diameterMm)}</td>
              <td>${formatNumber(tank.heightMm)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="4" class="empty">등록된 탱크가 없습니다.</td></tr>`;
}

const TANK_GROUP_COLORS = {
  "DM Water": "#2563eb",
  "Service Water": "#0f766e",
  "Fuel Oil": "#b45309",
  "Ammonia": "#7c3aed"
};

const TANK_GROUP_ICONS = {
  "DM Water": "\uD83D\uDCA7",
  "Service Water": "\uD83D\uDEB0",
  "Fuel Oil": "\uD83D\uDEE2\uFE0F",
  "Ammonia": "\uD83E\uDDEA"
};

const TANK_GROUP_ORDER = ["DM Water", "Service Water", "Fuel Oil", "Ammonia"];

function tankGaugeCardHtml(tank) {
  const tankColor = TANK_GROUP_COLORS[tank.tankGroup] || "#0f766e";
  const icon = TANK_GROUP_ICONS[tank.tankGroup] || "\uD83D\uDCA7";
  const reading = latestReadingForTank(tank.id);

  if (!reading) {
    return `
      <article class="tank-gauge-card is-empty" style="--tank-color: ${tankColor};">
        <div class="tank-gauge-head">
          <span class="tank-gauge-icon">${icon}</span>
          <span class="tank-gauge-name">${escapeHtml(tank.name)}</span>
        </div>
        <div class="tank-gauge-value">-</div>
        <div class="tank-gauge-unit">m³</div>
        <div class="tank-gauge-percent">미기록</div>
        <div class="tank-gauge-caption">&nbsp;</div>
        <div class="tank-gauge-tube"><div class="tank-gauge-fill" style="height:0%;"></div></div>
      </article>
    `;
  }

  const percent = Math.max(0, Math.min(100, Number(reading.levelPercent) || 0));
  return `
    <article class="tank-gauge-card" style="--tank-color: ${tankColor};">
      <div class="tank-gauge-head">
        <span class="tank-gauge-icon">${icon}</span>
        <span class="tank-gauge-name">${escapeHtml(tank.name)}</span>
      </div>
      <div class="tank-gauge-value">${formatNumber(reading.estimatedVolumeM3, 0)}</div>
      <div class="tank-gauge-unit">m³</div>
      <div class="tank-gauge-percent">${formatNumber(percent, 1)}%</div>
      <div class="tank-gauge-caption">${escapeHtml(reading.readingDate || "")} 측정 기준</div>
      <div class="tank-gauge-tube"><div class="tank-gauge-fill" style="height:${percent}%;"></div></div>
    </article>
  `;
}

function tankGroupTotalHtml(group) {
  const capacity = group.tanks.reduce((sum, tank) => sum + (Number(tank.workingVolumeM3) || 0), 0);
  let recordedCount = 0;
  let estimatedTotal = 0;
  let latestDate = "";

  group.tanks.forEach((tank) => {
    const reading = latestReadingForTank(tank.id);
    if (reading) {
      recordedCount += 1;
      estimatedTotal += Number(reading.estimatedVolumeM3) || 0;
      if (!latestDate || reading.readingDate > latestDate) latestDate = reading.readingDate;
    }
  });

  if (recordedCount === 0) {
    return `
      <article class="metric tank-group-total">
        <span>${escapeHtml(group.name)} 합계</span>
        <strong>미기록</strong>
      </article>
    `;
  }

  const percent = capacity > 0 ? Math.round((estimatedTotal / capacity) * 1000) / 10 : 0;
  const partial = recordedCount < group.tanks.length ? ` (${recordedCount}/${group.tanks.length}기)` : "";

  return `
    <article class="metric tank-group-total">
      <span>${escapeHtml(group.name)} 합계${partial}</span>
      <strong>${formatNumber(estimatedTotal, 0)} m³</strong>
      <small>${percent}% · ${escapeHtml(latestDate)}</small>
    </article>
  `;
}

function renderTankGroups() {
  const container = $("#utilityTankGroups");
  if (!container) return;

  const groups = new Map();
  state.tanks.forEach((tank) => {
    const key = tank.tankGroup || tank.name;
    if (!groups.has(key)) groups.set(key, { name: key, tanks: [] });
    groups.get(key).tanks.push(tank);
  });

  const orderedGroups = [...groups.values()].sort((a, b) => {
    const indexA = TANK_GROUP_ORDER.indexOf(a.name);
    const indexB = TANK_GROUP_ORDER.indexOf(b.name);
    if (indexA === -1 && indexB === -1) return a.name.localeCompare(b.name);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  const boxesHtml = orderedGroups
    .map((group) => {
      const tanks = [...group.tanks].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      return `<div class="tank-group-box">${tanks.map((tank) => tankGaugeCardHtml(tank)).join("")}</div>`;
    })
    .join("");

  const totalsHtml = orderedGroups.map((group) => tankGroupTotalHtml(group)).join("");

  container.innerHTML = boxesHtml + totalsHtml;
}

function renderTankHistoryTable() {
  const table = $("#tankReadingTable");
  if (!table) return;

  const keyword = ($("#tankHistorySearch")?.value || "").trim().toLowerCase();
  const rows = state.tankReadings
    .filter((reading) => !keyword || String(reading.tankName || "").toLowerCase().includes(keyword))
    .slice(0, 100);

  table.innerHTML = rows.length
    ? rows
        .map(
          (reading) => `
            <tr>
              <td>${escapeHtml(reading.readingDate || "")}</td>
              <td>${escapeHtml(reading.tankName || "")}</td>
              <td>${formatNumber(reading.levelMm)}</td>
              <td>${formatNumber(reading.levelPercent, 1)}%</td>
              <td>${formatNumber(reading.estimatedVolumeM3, 1)}</td>
              <td>${escapeHtml(reading.measuredBy || "")}</td>
              <td>${escapeHtml(reading.note || "")}</td>
              <td>
                <div class="row-actions">
                  <button type="button" class="danger-button" data-delete-tank-reading="${escapeHtml(reading.id)}">삭제</button>
                </div>
              </td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="8" class="empty">기록된 탱크 레벨이 없습니다.</td></tr>`;
}

function updateTankReadingPreview() {
  const preview = $("#tankReadingPreview");
  if (!preview) return;

  const form = $("#tankReadingForm");
  const tank = tankById($("#tankSelect")?.value || "");
  if (!tank) {
    preview.textContent = "";
    return;
  }

  const levelMmValue = form?.elements.levelMm?.value ?? "";
  const levelMmRaw = Number(levelMmValue);

  if (levelMmValue === "" || !Number.isFinite(levelMmRaw) || levelMmRaw < 0) {
    preview.textContent = `높이 ${formatNumber(tank.heightMm)}mm · Working Volume ${formatNumber(tank.workingVolumeM3)}m³`;
    return;
  }

  const heightMm = Number(tank.heightMm) || 0;
  const levelMm = heightMm > 0 ? Math.min(levelMmRaw, heightMm) : levelMmRaw;
  const ratio = heightMm > 0 ? levelMm / heightMm : 0;
  const percent = Math.round(ratio * 1000) / 10;
  const estimatedVolume = Math.round((Number(tank.workingVolumeM3) || 0) * ratio * 10) / 10;

  preview.textContent = `예상 충수율 ${percent}% · 추정 저장량 약 ${formatNumber(estimatedVolume, 1)} m³ (Working Volume ${formatNumber(tank.workingVolumeM3)} m³ 기준)`;
}

function renderUtilityTab() {
  renderTankSelectOptions();
  renderTankSpecTable();
  renderTankGroups();
  renderTankHistoryTable();
}

function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);

  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysBetween(start, end) {
  const startTime = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endTime = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return Math.round((endTime - startTime) / 86_400_000);
}

function sameDate(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function addMonthsClamped(start, months) {
  const target = new Date(start.getFullYear(), start.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(start.getDate(), lastDay));
  target.setHours(0, 0, 0, 0);
  return target;
}

function isSemiannualDueToday(start, today) {
  const monthDiff = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
  if (monthDiff <= 0 || monthDiff % 6 !== 0) return false;
  return sameDate(addMonthsClamped(start, monthDiff), today);
}

function hasCycle(equipment, cycle) {
  return (equipment.cycles || []).includes(cycle);
}

function autoCycleForEquipment(equipment, dateTextValue = todayText()) {
  const date = parseLocalDate(dateTextValue) || parseLocalDate(todayText());
  const startupDate = parseLocalDate(equipment.startupDate);

  if (date && startupDate && date >= startupDate && hasCycle(equipment, "semiannual") && isSemiannualDueToday(startupDate, date)) {
    return "semiannual";
  }

  if (date && hasCycle(equipment, "weekly") && date.getDay() === 4) {
    return "weekly";
  }

  if (hasCycle(equipment, "daily")) return "daily";
  if (hasCycle(equipment, "weekly")) return "weekly";
  if (hasCycle(equipment, "semiannual")) return "semiannual";
  return "daily";
}

function isDueToday(equipment, cycle, today = parseLocalDate(todayText())) {
  if (!today) return false;
  const chosenCycle = autoCycleForEquipment(equipment, dateText(today));
  if (chosenCycle !== cycle) return false;
  if (cycle === "daily") return hasCycle(equipment, "daily");
  if (cycle === "weekly") return hasCycle(equipment, "weekly") && today.getDay() === 4;
  if (cycle === "semiannual") {
    const startupDate = parseLocalDate(equipment.startupDate);
    return Boolean(startupDate && hasCycle(equipment, "semiannual") && isSemiannualDueToday(startupDate, today));
  }
  return false;
}

function dueItemsForToday() {
  const today = parseLocalDate(todayText());
  return state.equipment
    .map((equipment) => ({ equipment, cycle: autoCycleForEquipment(equipment, todayText()) }))
    .filter((item) => isDueToday(item.equipment, item.cycle, today));
}

function isCompletedToday(equipmentId, cycle) {
  const today = todayText();
  const savedDone = state.inspections.some(
    (item) =>
      item.equipmentId === equipmentId &&
      item.cycle === cycle &&
      item.inspectionDate === today &&
      item.resultStatus === "complete"
  );
  const pendingDone = pendingInspectionPayloads().some(
    (item) =>
      item.equipmentId === equipmentId &&
      item.cycle === cycle &&
      item.inspectionDate === today &&
      item.resultStatus === "complete"
  );
  return savedDone || pendingDone;
}

function completionForCycle(cycle, dueItems) {
  const cycleDueItems = dueItems.filter((item) => item.cycle === cycle);
  if (!cycleDueItems.length) return { due: 0, done: 0, percent: 0 };

  const done = cycleDueItems.filter((item) => isCompletedToday(item.equipment.id, item.cycle)).length;

  return {
    due: cycleDueItems.length,
    done,
    percent: Math.round((done / cycleDueItems.length) * 100)
  };
}

function dueItemWithStatus(item) {
  return { ...item, done: isCompletedToday(item.equipment.id, item.cycle) };
}

function openDueItemsForToday() {
  return dueItemsForToday()
    .map(dueItemWithStatus)
    .filter((item) => !item.done)
    .sort((a, b) => a.equipment.name.localeCompare(b.equipment.name));
}

function selectNextOpenInspection(currentEquipmentId = "") {
  const openItems = openDueItemsForToday();
  if (!openItems.length) return false;

  const currentIndex = openItems.findIndex((item) => item.equipment.id === currentEquipmentId);
  const nextItem = openItems[currentIndex >= 0 ? (currentIndex + 1) % openItems.length : 0];
  return selectEquipmentForInspection(nextItem.equipment.id);
}

function dueStats(items) {
  const done = items.filter((item) => item.done).length;
  return {
    total: items.length,
    done,
    open: items.length - done
  };
}

function groupDueItems(items, categoryIndex) {
  const groups = new Map();
  for (const item of items) {
    const label = equipmentCategory(item.equipment, categoryIndex);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  }

  return [...groups.entries()]
    .map(([label, groupItems]) => ({ label, items: groupItems, ...dueStats(groupItems) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function dashboardPathHtml() {
  const { fieldZone, category0, category1 } = state.dashboardDrill;
  if (!fieldZone && !category0 && !category1) return "";

  const path = ["오늘 점검 대상", fieldZone, category0, category1].filter(Boolean).join(" / ");
  return `
    <div class="dashboard-path">
      <button class="dashboard-back" type="button" data-dashboard-back>뒤로</button>
      <span>${escapeHtml(path)}</span>
    </div>
  `;
}

function dashboardGroupButton(group, level, attrs = "") {
  const badgeClass = group.open > 0 ? "open" : "";
  const badgeText = group.open > 0 ? `남음 ${group.open}` : "완료";
  const firstOpenItem = group.items.find((item) => !item.done) || group.items[0];
  const quickTarget = firstOpenItem?.equipment?.id || "";
  return `
    <button class="recent-item due-target due-group" type="button" data-dashboard-group data-dashboard-level="${level}" data-first-open-equipment-id="${escapeHtml(quickTarget)}" ${attrs}>
      <div>
        <strong>${escapeHtml(group.label)}</strong>
        <span>대상 ${group.total} · 완료 ${group.done} · 남음 ${group.open}</span>
      </div>
      <span class="badge ${badgeClass}" data-dashboard-quick>${escapeHtml(badgeText)}</span>
    </button>
  `;
}

function renderDashboardTargets(dueItems) {
  const todayTargets = dueItems
    .map(dueItemWithStatus)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.equipment.name.localeCompare(b.equipment.name));

  if (!todayTargets.length) {
    state.dashboardDrill.fieldZone = "";
    state.dashboardDrill.category0 = "";
    state.dashboardDrill.category1 = "";
    $("#recentList").innerHTML = `<p class="empty">오늘 도래한 점검이 없습니다.</p>`;
    return;
  }

  const zoneValues = new Set(todayTargets.map((item) => equipmentFieldZone(item.equipment)));
  if (state.dashboardDrill.fieldZone && !zoneValues.has(state.dashboardDrill.fieldZone)) {
    state.dashboardDrill.fieldZone = "";
    state.dashboardDrill.category0 = "";
    state.dashboardDrill.category1 = "";
  }

  const activeZone = state.dashboardDrill.fieldZone;
  if (!activeZone) {
    const groups = new Map();
    for (const item of todayTargets) {
      const label = equipmentFieldZone(item.equipment);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(item);
    }
    $("#recentList").innerHTML = [...groups.entries()]
      .map(([label, groupItems]) => ({ label, items: groupItems, ...dueStats(groupItems) }))
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((group) => dashboardGroupButton(group, 0, `data-field-zone="${escapeHtml(group.label)}"`))
      .join("");
    return;
  }

  const zoneItems = todayTargets.filter((item) => equipmentFieldZone(item.equipment) === activeZone);
  const category0Values = new Set(zoneItems.map((item) => equipmentCategory(item.equipment, 0)));
  if (state.dashboardDrill.category0 && !category0Values.has(state.dashboardDrill.category0)) {
    state.dashboardDrill.category0 = "";
    state.dashboardDrill.category1 = "";
  }

  const activeCategory0 = state.dashboardDrill.category0;
  if (!activeCategory0) {
    $("#recentList").innerHTML =
      dashboardPathHtml() +
      groupDueItems(zoneItems, 0)
        .map((group) => dashboardGroupButton(group, 1, `data-category0="${escapeHtml(group.label)}"`))
        .join("");
    return;
  }

  const category0Items = zoneItems.filter((item) => equipmentCategory(item.equipment, 0) === activeCategory0);
  const category1Values = new Set(category0Items.map((item) => equipmentCategory(item.equipment, 1)));
  if (state.dashboardDrill.category1 && !category1Values.has(state.dashboardDrill.category1)) {
    state.dashboardDrill.category1 = "";
  }

  if (!state.dashboardDrill.category1) {
    $("#recentList").innerHTML =
      dashboardPathHtml() +
      groupDueItems(category0Items, 1)
        .map((group) => dashboardGroupButton(group, 2, `data-category1="${escapeHtml(group.label)}"`))
        .join("");
    return;
  }

  const equipmentItems = category0Items.filter((item) => equipmentCategory(item.equipment, 1) === state.dashboardDrill.category1);
  $("#recentList").innerHTML =
    dashboardPathHtml() +
    equipmentItems
      .map(
        (item) => `
          <button class="recent-item due-target" type="button" data-equipment-id="${escapeHtml(item.equipment.id)}">
            <div>
              <strong>${escapeHtml(equipmentCategory(item.equipment, 2))}</strong>
              <span>${cycleLabels[item.cycle] || "-"} · ${escapeHtml(item.equipment.equipmentCode || "설비번호 없음")}</span>
            </div>
            <span class="badge ${item.done ? "" : "open"}">${item.done ? "완료" : "남음"}</span>
          </button>
        `
      )
      .join("");
}

const PLANT_MAP_ZONES = [
  "CCR",
  "AIR COMPRESSOR",
  "NH3",
  "BS EDG",
  "ACC AREA",
  "STG",
  "HRSG-1 AREA",
  "HRSG-2 AREA",
  "HRSG-3 AREA",
  "GT-1 BLOCK",
  "GT-2 BLOCK",
  "GT-3 BLOCK"
];

function zoneStatsToday(dueItems) {
  const statusItems = dueItems.map(dueItemWithStatus);
  const stats = new Map();
  for (const item of statusItems) {
    const zone = equipmentFieldZone(item.equipment);
    if (!stats.has(zone)) stats.set(zone, []);
    stats.get(zone).push(item);
  }
  return new Map([...stats.entries()].map(([zone, items]) => [zone, dueStats(items)]));
}

function plantZoneClass(stat) {
  if (!stat || stat.total === 0) return "zone-empty";
  if (stat.open === 0) return "zone-complete";
  if (stat.open === stat.total) return "zone-open";
  return "zone-partial";
}

function renderPlantMap(dueItems) {
  const map = $("#plantMap");
  if (!map) return;
  const stats = zoneStatsToday(dueItems);

  $$(".plant-zone[data-zone]", map).forEach((button) => {
    const zone = button.dataset.zone;
    const stat = stats.get(zone);
    const badge = $("[data-zone-badge]", button);
    button.classList.remove("zone-empty", "zone-complete", "zone-open", "zone-partial");
    button.classList.add(plantZoneClass(stat));
    badge.innerHTML = stat && stat.total > 0 ? `${stat.done}/${stat.total}<span class="badge-open"> · 남음 ${stat.open}</span>` : "대상 없음";
  });

  const chipsContainer = $("#plantZoneChips");
  if (chipsContainer) {
    const mappedZones = new Set(PLANT_MAP_ZONES);
    const otherZones = [...stats.entries()]
      .filter(([zone]) => !mappedZones.has(zone))
      .sort((a, b) => a[0].localeCompare(b[0]));

    chipsContainer.innerHTML = otherZones
      .map(([zone, stat]) => {
        const cls = plantZoneClass(stat);
        return `
          <button class="plant-zone-chip ${cls}" type="button" data-zone="${escapeHtml(zone)}">
            <strong>${escapeHtml(zone)}</strong>
            <span>${stat.done}/${stat.total} · 남음 ${stat.open}</span>
          </button>
        `;
      })
      .join("");
  }
}

function renderDashboard() {
  const dueItems = dueItemsForToday();
  const cycleStats = Object.keys(cycleLabels).map((cycle) => ({ cycle, ...completionForCycle(cycle, dueItems) }));
  const todayDone = cycleStats.reduce((total, item) => total + item.done, 0);
  const openCount = cycleStats.reduce((total, item) => total + Math.max(item.due - item.done, 0), 0);

  $("#metricEquipment").textContent = state.equipment.length;
  $("#metricToday").textContent = todayDone;
  $("#metricOpen").textContent = openCount;
  $("#metricMissingStartup").textContent = dueItems.length;

  $("#cycleBars").innerHTML = cycleStats
    .map(
      (item) => `
        <div class="bar-row">
          <span>${cycleLabels[item.cycle]}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${item.percent}%"></div></div>
          <strong>${item.percent}%</strong>
        </div>
      `
    )
    .join("");

  renderPlantMap(dueItems);
  renderDashboardTargets(dueItems);
}

function displayYesNo(value) {
  if (value === "yes") return "예";
  if (value === "no") return "아니오";
  if (value === "not_applicable") return "-";
  return value || "-";
}

function inspectionPhotos(item) {
  if (Array.isArray(item?.photos) && item.photos.length > 0) return item.photos;
  return item?.photoUrl ? [{ photoUrl: item.photoUrl, photoName: item.photoName }] : [];
}

function renderHistoryEquipmentFilter() {
  const select = $("#historyEquipment");
  if (!select) return;

  const currentValue = select.value;
  const options = [...state.equipment]
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || "-")} ${
          item.equipmentCode ? `· ${escapeHtml(item.equipmentCode)}` : ""
        }</option>`
    )
    .join("");

  select.innerHTML = `<option value="">전체 설비</option>${options}`;
  select.value = state.equipment.some((item) => item.id === currentValue) ? currentValue : "";
}

function filteredHistoryRows() {
  const cycle = $("#historyCycle").value;
  const equipmentId = $("#historyEquipment").value;
  const startDate = $("#historyStartDate").value;
  const endDate = $("#historyEndDate").value;
  const keyword = $("#historySearch").value.trim().toLowerCase();
  return state.inspections.filter((item) => {
    const cycleOk = !cycle || item.cycle === cycle;
    const equipmentOk = !equipmentId || item.equipmentId === equipmentId;
    const date = item.inspectionDate || "";
    const startOk = !startDate || date >= startDate;
    const endOk = !endDate || date <= endDate;
    const keywordOk = !keyword || String(item.equipmentName || "").toLowerCase().includes(keyword);
    return cycleOk && equipmentOk && startOk && endOk && keywordOk;
  });
}

function detailRow(label, value) {
  return `
    <div class="detail-row">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div class="detail-value">${value}</div>
    </div>
  `;
}

function renderHistoryDetail(item) {
  const detail = $("#historyDetail");
  if (!item) {
    detail.innerHTML = `<p class="empty">조회된 이력이 없습니다.</p>`;
    return;
  }

  const equipment = getEquipmentById(item.equipmentId) || {};
  const answers = item.answers || {};
  const note = item.note || "이상 없음";
  const photos = inspectionPhotos(item);
  const photoHtml = photos.length
    ? `
      <div class="detail-photo-grid">
        ${photos
          .map(
            (photo) => `
              <a href="${photo.photoUrl}" target="_blank" rel="noreferrer">
                <img class="detail-photo" src="${photo.photoUrl}" alt="점검 사진" />
              </a>
            `
          )
          .join("")}
      </div>
      <div class="photo-count">${photos.length}장</div>
    `
    : `<span class="empty">사진 없음</span>`;

  const rows = [
    detailRow("설비명", escapeHtml(item.equipmentName || "-")),
    detailRow("설비번호", escapeHtml(equipment.equipmentCode || "-")),
    detailRow("점검일", escapeHtml(item.inspectionDate || "-")),
    detailRow("점검자", escapeHtml(item.inspector || "-")),
    detailRow("점검 주기", escapeHtml(cycleLabels[item.cycle] || "-")),
    detailRow("완료 여부", `<span class="badge ${item.resultStatus === "open" ? "open" : ""}">${escapeHtml(statusLabels[item.resultStatus] || item.resultStatus || "완료")}</span>`),
    detailRow("기동 여부", escapeHtml(displayYesNo(answers.start))),
    detailRow("이음 여부", escapeHtml(displayYesNo(answers.noise))),
    detailRow("윤활유 상태", escapeHtml(answers.oilCondition || "-")),
    detailRow("윤활유 누유", escapeHtml(displayYesNo(answers.oilLeak))),
    detailRow("펌프/팬 누수", escapeHtml(displayYesNo(answers.pumpFanLeak)))
  ];

  if (equipmentCategory(equipment, 1) === "EDG") {
    rows.push(detailRow("냉각수 누유", escapeHtml(displayYesNo(answers.coolingWaterLeak))));
  } else {
    rows.push(detailRow("필터 막힘", escapeHtml(displayYesNo(answers.filterStrainerBlocked))));
    if (answers.filterStrainerBlocked === "yes") {
      rows.push(detailRow("막힘 청소", escapeHtml(displayYesNo(answers.filterStrainerCleaned))));
    }
  }

  rows.push(detailRow("메모", escapeHtml(note)));
  rows.push(detailRow("사진", photoHtml));

  detail.innerHTML = `<div class="detail-rows">${rows.join("")}</div>`;
}

function renderHistory() {
  const rows = filteredHistoryRows();

  if (!rows.some((item) => item.id === state.selectedHistoryId)) {
    state.selectedHistoryId = rows[0]?.id || null;
  }

  $("#historyList").innerHTML = rows.length
    ? rows
        .map(
          (item) => `
            <button class="history-card ${item.id === state.selectedHistoryId ? "is-active" : ""}" type="button" data-history-id="${escapeHtml(item.id)}">
              <span class="history-card-main">
                <span class="history-date">${escapeHtml(item.inspectionDate || "-")}</span>
                <span class="history-title">${escapeHtml(item.equipmentName || "-")}</span>
                <span class="history-meta">${escapeHtml(item.inspector || "점검자 미입력")} / ${cycleLabels[item.cycle] || "-"}</span>
              </span>
              <span class="badge ${item.resultStatus === "open" ? "open" : ""}">${statusLabels[item.resultStatus] || item.resultStatus || "완료"}</span>
              ${
                inspectionPhotos(item)[0]?.photoUrl
                  ? `<img class="history-thumb" src="${inspectionPhotos(item)[0].photoUrl}" alt="" />`
                  : `<span class="history-thumb" aria-hidden="true"></span>`
              }
              <span class="history-arrow" aria-hidden="true">›</span>
            </button>
          `
        )
        .join("")
    : `<p class="empty">조회된 기록이 없습니다.</p>`;

  renderHistoryDetail(rows.find((item) => item.id === state.selectedHistoryId));
}

function renderAll() {
  renderEquipmentPicker();
  renderEquipmentAdminTable();
  renderDashboard();
  renderHistoryEquipmentFilter();
  renderHistory();
  renderUtilityTab();
}

function resetInspectionFormAfterSubmit(inspectorName) {
  const form = $("#inspectionForm");
  form.reset();
  form.elements.inspectionDate.value = todayText();
  form.elements.inspector.value = inspectorName;
  state.photos = [];
  $("#photoPreview").hidden = true;
  $(".photo-preview-grid").innerHTML = "";
  renderEquipmentPicker();
  updateNoiseVisibility("daily");
  updateCommonInspectionVisibility();
}

function continueAfterInspectionSubmit({ goNextAfterSave, previousEquipmentId, offline = false }) {
  if (goNextAfterSave) {
    if (selectNextOpenInspection(previousEquipmentId)) {
      setActiveView("inspection");
      $("#inspectionForm").scrollIntoView({ behavior: "smooth", block: "start" });
      showToast(offline ? "임시 저장했습니다. 다음 미완료 설비로 이동했습니다." : "저장되었습니다. 다음 미완료 설비로 이동했습니다.");
      return;
    }

    setActiveView("dashboard");
    renderDashboard();
    showToast(offline ? "임시 저장했습니다. 오늘 남은 미완료 설비가 없습니다." : "저장되었습니다. 오늘 남은 미완료 설비가 없습니다.");
    return;
  }

  showToast(offline ? "인터넷 연결이 불안정해서 이 점검은 임시 저장했습니다. 온라인이 되면 자동 전송됩니다." : "점검 기록이 저장되었습니다.");
  setActiveView("history");
}

async function loadData({ syncPending = true } = {}) {
  try {
    const [equipment, inspections, tanks, tankReadings] = await Promise.all([
      api("/api/equipment"),
      api("/api/inspections"),
      api("/api/tanks"),
      api("/api/tank-readings")
    ]);
    state.equipment = equipment.items || [];
    state.inspections = inspections.items || [];
    state.tanks = tanks.items || [];
    state.tankReadings = tankReadings.items || [];
    renderInspectorSuggestions();
    renderAll();
    if (syncPending) await syncPendingInspections({ silent: true });
  } catch (error) {
    showToast(error.message, "error");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dataUrlByteLength(dataUrl) {
  const base64 = String(dataUrl).split(",")[1] || "";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function photoFileName(file, index) {
  const rawName = file.name || `photo-${index + 1}`;
  const baseName = rawName.replace(/\.[^.]+$/, "") || `photo-${index + 1}`;
  return `${baseName}.jpg`;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("사진을 읽지 못했습니다."));
    };
    image.src = url;
  });
}

function canvasToJpegDataUrl(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("사진 압축에 실패했습니다."));
          return;
        }

        const reader = new FileReader();
        reader.onload = () => resolve({ dataUrl: reader.result, bytes: blob.size });
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

async function compressPhoto(file, index) {
  const image = await loadImageFromFile(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error("사진 크기를 확인하지 못했습니다.");

  let bestResult = null;
  for (const step of PHOTO_COMPRESSION_STEPS) {
    const scale = Math.min(1, step.maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("사진 압축을 지원하지 않는 브라우저입니다.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const result = await canvasToJpegDataUrl(canvas, step.quality);
    bestResult = { ...result, width, height, quality: step.quality };
    if (result.bytes <= PHOTO_MAX_STORED_BYTES) break;
  }

  if (!bestResult) throw new Error("사진 압축에 실패했습니다.");
  if (bestResult.bytes > PHOTO_MAX_STORED_BYTES) {
    throw new Error("사진 압축 후에도 용량이 큽니다. 사진을 조금 줄여서 다시 선택해주세요.");
  }

  return {
    name: photoFileName(file, index),
    type: "image/jpeg",
    dataUrl: bestResult.dataUrl,
    width: bestResult.width,
    height: bestResult.height,
    originalBytes: file.size,
    compressedBytes: bestResult.bytes
  };
}

function bindEvents() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setActiveView(tab.dataset.view));
  });

  $("#equipmentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
      ...formToObject(form),
      cycles: checkedValues(form, "cycles")
    };

    try {
      await api("/api/equipment", { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      showToast("설비가 저장되었습니다.");
      await loadData();
      setActiveView("inspection");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#category0Select").addEventListener("change", () => {
    $("#category1Select").value = "";
    $("#equipmentSelect").value = "";
    renderEquipmentPicker();
  });

  $("#category1Select").addEventListener("change", () => {
    $("#equipmentSelect").value = "";
    renderEquipmentPicker();
  });

  $("#category2Select").addEventListener("change", () => {
    $("#equipmentSelect").value = $("#category2Select").value;
    updateInspectionCycle();
  });

  $('input[name="inspectionDate"]').addEventListener("change", updateInspectionCycle);

  $("#nextOpenInspection").addEventListener("click", () => {
    const currentId = $("#equipmentSelect").value;
    if (selectNextOpenInspection(currentId)) {
      setActiveView("inspection");
      $("#inspectionForm").scrollIntoView({ behavior: "smooth", block: "start" });
      showToast("다음 미완료 설비로 이동했습니다.");
    } else {
      showToast("오늘 남은 미완료 설비가 없습니다.");
    }
  });

  function handlePlantZoneClick(event) {
    const zoneEl = event.target.closest("[data-zone]");
    if (!zoneEl) return;
    const zone = zoneEl.dataset.zone || "";

    const zoneEquipment = state.equipment
      .filter((item) => equipmentFieldZone(item) === zone)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    if (zoneEquipment.length) {
      selectEquipmentForInspection(zoneEquipment[0].id);
      setActiveView("inspection");
      return;
    }

    state.dashboardDrill.fieldZone = zone;
    state.dashboardDrill.category0 = "";
    state.dashboardDrill.category1 = "";
    renderDashboard();
    $("#recentList")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  $("#plantMap")?.addEventListener("click", handlePlantZoneClick);
  $("#plantZoneChips")?.addEventListener("click", handlePlantZoneClick);

  $("#recentList").addEventListener("click", (event) => {
    const backButton = event.target.closest("[data-dashboard-back]");
    if (backButton) {
      if (state.dashboardDrill.category1) {
        state.dashboardDrill.category1 = "";
      } else if (state.dashboardDrill.category0) {
        state.dashboardDrill.category0 = "";
      } else {
        state.dashboardDrill.fieldZone = "";
      }
      renderDashboard();
      return;
    }

    const groupButton = event.target.closest("[data-dashboard-group]");
    if (groupButton) {
      const quickButton = event.target.closest("[data-dashboard-quick]");
      if (quickButton && groupButton.dataset.firstOpenEquipmentId) {
        if (selectEquipmentForInspection(groupButton.dataset.firstOpenEquipmentId)) {
          setActiveView("inspection");
          $("#inspectionForm").scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }

      if (groupButton.dataset.dashboardLevel === "0") {
        state.dashboardDrill.fieldZone = groupButton.dataset.fieldZone || "";
        state.dashboardDrill.category0 = "";
        state.dashboardDrill.category1 = "";
      }
      if (groupButton.dataset.dashboardLevel === "1") {
        state.dashboardDrill.category0 = groupButton.dataset.category0 || "";
        state.dashboardDrill.category1 = "";
      }
      if (groupButton.dataset.dashboardLevel === "2") {
        state.dashboardDrill.category1 = groupButton.dataset.category1 || "";
      }
      renderDashboard();
      return;
    }

    const target = event.target.closest("[data-equipment-id]");
    if (!target) return;

    if (selectEquipmentForInspection(target.dataset.equipmentId)) {
      setActiveView("inspection");
      $("#inspectionForm").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  $("#tankSelect")?.addEventListener("change", updateTankReadingPreview);
  $("#tankReadingForm [name=\"levelMm\"]")?.addEventListener("input", updateTankReadingPreview);

  $("#tankReadingForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = formToObject(form);

    try {
      await api("/api/tank-readings", { method: "POST", body: JSON.stringify(payload) });
      rememberInspectorName(payload.measuredBy);
      const measuredBy = form.elements.measuredBy.value;
      form.reset();
      form.elements.readingDate.value = todayText();
      form.elements.measuredBy.value = measuredBy;
      showToast("탱크 레벨이 저장되었습니다.");
      await loadData();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#tankHistorySearch")?.addEventListener("input", renderTankHistoryTable);

  $("#tankReadingTable")?.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete-tank-reading]");
    if (!deleteButton) return;

    const id = deleteButton.dataset.deleteTankReading;
    if (!window.confirm("이 탱크 레벨 기록을 삭제할까요?")) return;

    try {
      await api(`/api/tank-readings/${encodeURIComponent(id)}`, { method: "DELETE" });
      showToast("기록이 삭제되었습니다.");
      await loadData();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#equipmentSearch").addEventListener("input", renderEquipmentAdminTable);

  $("#equipmentAdminTable").addEventListener("click", async (event) => {
    const saveButton = event.target.closest("[data-save-equipment]");
    const deleteButton = event.target.closest("[data-delete-equipment]");
    if (!saveButton && !deleteButton) return;

    const row = event.target.closest("tr");
    const id = saveButton?.dataset.saveEquipment || deleteButton?.dataset.deleteEquipment;

    try {
      if (deleteButton) {
        const equipment = getEquipmentById(id);
        if (!window.confirm(`${equipment?.name || "이 설비"}를 삭제할까요? 기존 점검 이력은 남습니다.`)) return;
        await api(`/api/equipment/${encodeURIComponent(id)}`, { method: "DELETE" });
        showToast("설비가 삭제되었습니다.");
      } else {
        const payload = Object.fromEntries(
          $$("[data-equipment-field]", row).map((input) => [input.dataset.equipmentField, input.value])
        );
        await api(`/api/equipment/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        showToast("설비 정보가 저장되었습니다.");
      }
      await loadData();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#inspectionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const equipment = getSelectedEquipment();
    const goNextAfterSave = event.submitter?.dataset.afterSubmit === "next";
    if (!equipment) {
      showToast("설비를 먼저 등록하세요.", "error");
      return;
    }

    updateInspectionCycle();
    const cycle = form.elements.cycle.value || "daily";
    const inspectorName = normalizeInspectorName(form.elements.inspector.value);
    const payload = {
      ...formToObject(form),
      inspector: inspectorName,
      equipmentName: equipment.name,
      cycle,
      resultStatus: "complete",
      answers: answerPayload(form, cycle),
      photos: state.photos,
      offlineId: newOfflineId()
    };

    try {
      await postInspectionPayload(payload);
      const rememberedInspector = rememberInspectorName(inspectorName);
      resetInspectionFormAfterSubmit(rememberedInspector);
      await loadData();
      continueAfterInspectionSubmit({ goNextAfterSave, previousEquipmentId: equipment.id });
    } catch (error) {
      if (!isLikelyNetworkError(error)) {
        showToast(error.message, "error");
        return;
      }

      await queuePendingInspection(payload);
      const rememberedInspector = rememberInspectorName(inspectorName);
      resetInspectionFormAfterSubmit(rememberedInspector);
      renderDashboard();
      continueAfterInspectionSubmit({ goNextAfterSave, previousEquipmentId: equipment.id, offline: true });
    }
  });

  $$('input[name="filterBlocked"]').forEach((input) => {
    input.addEventListener("change", updateFilterCleanedVisibility);
  });

  $$('input[name="dailyStart"]').forEach((input) => {
    input.addEventListener("change", () => {
      updateNoiseVisibility("daily");
      updateCommonInspectionVisibility();
    });
  });

  $$("[data-photo-input]").forEach((input) => input.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    if (files.length === 0) {
      state.photos = [];
      $("#photoPreview").hidden = true;
      $(".photo-preview-grid").innerHTML = "";
      return;
    }

    if (files.length > PHOTO_MAX_COUNT) {
      showToast(`사진은 한 번에 최대 ${PHOTO_MAX_COUNT}장까지 등록할 수 있습니다.`, "error");
      event.target.value = "";
      return;
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (files.some((file) => file.size > PHOTO_MAX_SOURCE_BYTES) || totalSize > PHOTO_MAX_TOTAL_SOURCE_BYTES) {
      showToast("원본 사진이 너무 큽니다. 사진을 조금 줄여서 다시 선택해주세요.", "error");
      event.target.value = "";
      return;
    }

    try {
      showToast("사진 용량을 자동으로 줄이는 중입니다.");
      const compressedPhotos = [];
      for (const [index, file] of files.entries()) {
        compressedPhotos.push(await compressPhoto(file, index));
      }

      state.photos = compressedPhotos;
      $(".photo-preview-grid").innerHTML = state.photos
        .map((photo) => `<img src="${photo.dataUrl}" alt="점검 사진 미리보기" title="${Math.round(photo.compressedBytes / 1024)}KB" />`)
        .join("");
      $("#photoPreview").hidden = false;
      showToast("사진이 저장용 크기로 자동 조정되었습니다.");
    } catch (error) {
      state.photos = [];
      $("#photoPreview").hidden = true;
      $(".photo-preview-grid").innerHTML = "";
      event.target.value = "";
      showToast(error.message || "사진을 처리하지 못했습니다.", "error");
    }
  }));

  $("#historyCycle").addEventListener("change", renderHistory);
  $("#historyEquipment").addEventListener("change", renderHistory);
  $("#historyStartDate").addEventListener("change", renderHistory);
  $("#historyEndDate").addEventListener("change", renderHistory);
  $("#historySearch").addEventListener("input", renderHistory);
  $("#historyList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-history-id]");
    if (!button) return;
    state.selectedHistoryId = button.dataset.historyId;
    renderHistory();
  });
}

async function init() {
  await window.OfflineStore.init();
  window.OfflineStore.onChange(renderPendingBadge);
  renderPendingBadge(pendingInspections().length);
  window.addEventListener("offline", () => renderPendingBadge(pendingInspections().length));
  await ensureAppCode();
  $('input[name="inspectionDate"]').value = todayText();
  $('input[name="inspector"]').value = lastInspectorName();
  const tankReadingDate = $('#tankReadingForm [name="readingDate"]');
  if (tankReadingDate) tankReadingDate.value = todayText();
  const tankMeasuredBy = $('#tankReadingForm [name="measuredBy"]');
  if (tankMeasuredBy) tankMeasuredBy.value = lastInspectorName();
  renderInspectorSuggestions();
  bindEvents();
  registerServiceWorker();
  window.addEventListener("online", () => {
    renderPendingBadge(pendingInspections().length);
    syncPendingInspections();
  });
  updateInspectionCycle();
  updateNoiseVisibility("daily");
  updateCommonInspectionVisibility();
  await loadData();
}

init();
