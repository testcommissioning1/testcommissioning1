const cycleLabels = {
  daily: "일간",
  weekly: "주간",
  semiannual: "반기"
};

const statusLabels = {
  complete: "완료",
  open: "미완료"
};

const WORK_TYPE_LABELS = {
  repair: "수리",
  partReplace: "부품 교체",
  breakdown: "고장 발생",
  checkedOut: "외부 반출",
  checkedIn: "반입(복귀)",
  other: "기타"
};

const state = {
  equipment: [],
  inspections: [],
  inspectionsFull: [],
  tanks: [],
  tankReadings: [],
  photos: [],
  workLogs: [],
  pmTasks: [],
  selectedHistoryId: null,
  selectedDetailEquipmentId: null,
  plantZones: [],
  plantZoneEditMode: false,
  selectedPlantZoneId: null,
  dashboardDrill: {
    fieldZone: "",
    category0: "",
    category1: ""
  }
};

const PLANT_ZONE_COLORS = ["pink", "orange", "purple", "blue", "green", "yellow"];

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

// ===== 저장 중 표시 / 결과 안내창 =====
function ensureFeedbackElements() {
  if (document.getElementById("busyOverlay")) return;
  const busy = document.createElement("div");
  busy.id = "busyOverlay";
  busy.className = "busy-overlay";
  busy.hidden = true;
  busy.innerHTML = '<div class="busy-box"><div class="busy-spinner"></div><strong id="busyText">저장 중입니다</strong><small id="busySub">사진이 있으면 시간이 조금 걸립니다. 화면을 닫지 마세요.</small></div>';
  document.body.appendChild(busy);

  const result = document.createElement("div");
  result.id = "resultOverlay";
  result.className = "result-overlay";
  result.hidden = true;
  result.innerHTML = '<div class="result-box" role="alertdialog" aria-live="assertive"><div class="result-icon" id="resultIcon"></div><strong id="resultTitle"></strong><p id="resultDetail"></p><button type="button" id="resultOk">확인</button></div>';
  document.body.appendChild(result);
  const close = () => {
    result.hidden = true;
    window.clearTimeout(showResult.timer);
  };
  result.addEventListener("click", (event) => {
    if (event.target === result || event.target.id === "resultOk") close();
  });
}

function showBusy(text = "저장 중입니다", sub = "사진이 있으면 시간이 조금 걸립니다. 화면을 닫지 마세요.") {
  ensureFeedbackElements();
  $("#busyText").textContent = text;
  $("#busySub").textContent = sub;
  $("#busyOverlay").hidden = false;
}

function hideBusy() {
  const busy = document.getElementById("busyOverlay");
  if (busy) busy.hidden = true;
}

// type: "success" | "offline" | "error"
function showResult(type, title, detail = "") {
  ensureFeedbackElements();
  hideBusy();
  const icons = { success: "✓", offline: "⏳", error: "!" };
  const box = $("#resultOverlay .result-box");
  box.className = `result-box result-${type}`;
  $("#resultIcon").textContent = icons[type] || "i";
  $("#resultTitle").textContent = title;
  $("#resultDetail").textContent = detail;
  $("#resultOverlay").hidden = false;
  if (navigator.vibrate) navigator.vibrate(type === "error" ? [80, 60, 80] : 60);
  window.clearTimeout(showResult.timer);
  if (type !== "error") {
    showResult.timer = window.setTimeout(() => {
      $("#resultOverlay").hidden = true;
    }, type === "offline" ? 6000 : 2500);
  }
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

function workLogsForEquipment(equipmentId) {
  return state.workLogs
    .filter((item) => item.equipmentId === equipmentId)
    .slice()
    .sort(
      (a, b) =>
        String(b.workDate || "").localeCompare(String(a.workDate || "")) ||
        String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );
}

function isEquipmentCheckedOut(equipmentId) {
  const logs = workLogsForEquipment(equipmentId).filter(
    (item) => item.workType === "checkedOut" || item.workType === "checkedIn"
  );
  return Boolean(logs.length && logs[0].workType === "checkedOut");
}

function checkedOutEquipmentList() {
  return state.equipment
    .map((equipment) => ({ equipment, logs: workLogsForEquipment(equipment.id) }))
    .filter(({ logs }) => logs.length && logs[0].workType === "checkedOut")
    .map(({ equipment, logs }) => ({ equipment, latestLog: logs[0] }));
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
  if (viewName === "history" || viewName === "equipmentdetail") {
    ensureFullInspectionHistory();
  }
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
    ...(checkedValue(form, "dailyOilCondition") === "부족" ? { oilRefilled: checkedValue(form, "oilRefilled") } : {}),
    oilLeak: checkedValue(form, "oilLeak"),
    ...(checkedValue(form, "oilLeak") === "yes" ? { oilLeakFixed: checkedValue(form, "oilLeakFixed") } : {}),
    pumpFanLeak: checkedValue(form, "pumpFanLeak"),
    ...(checkedValue(form, "pumpFanLeak") === "yes" ? { pumpFanLeakFixed: checkedValue(form, "pumpFanLeakFixed") } : {}),
    coolingWaterLeak: checkedValue(form, "coolingWaterLeak")
  };
}

// 윤활유 누유 "예"일 때만 누유 조치 여부 표시
function updateOilLeakFixVisibility() {
  const row = $("#oilLeakFixRow");
  if (!row) return;
  const leak = checkedValue($("#inspectionForm"), "oilLeak") === "yes";
  row.hidden = !leak;
  if (!leak) {
    const yes = $('input[name="oilLeakFixed"][value="yes"]', $("#inspectionForm"));
    if (yes) yes.checked = true;
  }
}

// 펌프/팬 누수 "예"일 때만 누수 조치 여부 표시
function updateLeakFixVisibility() {
  updateOilLeakFixVisibility();
  const row = $("#leakFixRow");
  if (!row) return;
  const leak = checkedValue($("#inspectionForm"), "pumpFanLeak") === "yes";
  row.hidden = !leak;
  if (!leak) {
    const yes = $('input[name="pumpFanLeakFixed"][value="yes"]', $("#inspectionForm"));
    if (yes) yes.checked = true;
  }
}

// 윤활유 "부족"일 때만 보충 여부 표시
function updateOilRefillVisibility() {
  updateLeakFixVisibility();
  const row = $("#oilRefillRow");
  if (!row) return;
  const low = checkedValue($("#inspectionForm"), "dailyOilCondition") === "부족";
  row.hidden = !low;
  if (!low) {
    const yes = $('input[name="oilRefilled"][value="yes"]', $("#inspectionForm"));
    if (yes) yes.checked = true;
  }
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

function pmTasksForEquipment(equipment) {
  if (!equipment) return [];
  const tasks = state.pmTasks || [];
  if (Array.isArray(equipment.pmCodes) && equipment.pmCodes.length) {
    return tasks.filter((task) => equipment.pmCodes.includes(task.code));
  }
  const nh3 = String(equipmentFieldZone(equipment) || "").toUpperCase() === "NH3";
  return tasks.filter((task) => task.target === "pump" || task.target === "motor" || (nh3 && task.target === "ammonia"));
}

function renderWorkRelatedPmOptions() {
  const row = $("#workRelatedPmRow");
  const select = $("#workRelatedPmSelect");
  if (!row || !select) return;

  const workType = checkedValue($("#workLogForm"), "workType");
  const showRow = workType === "repair" || workType === "partReplace";
  const equipment = getEquipmentById($("#workEquipmentSelect").value);
  const tasks = showRow ? pmTasksForEquipment(equipment) : [];

  row.hidden = !showRow || tasks.length === 0;

  const previous = select.value;
  select.innerHTML =
    `<option value="">선택 안 함</option>` +
    tasks.map((task) => `<option value="${escapeHtml(task.code)}">${escapeHtml(task.name || task.code)}</option>`).join("");
  if (tasks.some((task) => task.code === previous)) select.value = previous;
}

function renderWorkLogPicker() {
  const hidden = $("#workEquipmentSelect");
  const category0Select = $("#workCategory0Select");
  const category1Select = $("#workCategory1Select");
  const category2Select = $("#workCategory2Select");
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
      const label = `${equipmentCategory(item, 2)}${item.equipmentCode ? ` (${item.equipmentCode})` : ""}${isEquipmentCheckedOut(item.id) ? " · 반출중" : ""}`;
      return `<option value="${escapeHtml(item.id)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  if (filteredEquipment.some((item) => item.id === hidden.value)) {
    category2Select.value = hidden.value;
  }

  hidden.value = category2Select.value || "";
  renderWorkRelatedPmOptions();
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
    .filter((equipment) => !isEquipmentCheckedOut(equipment.id))
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

function isAbnormalAnswers(answers) {
  if (!answers) return false;
  return (
    answers.noise === "yes" ||
    answers.oilLeak === "yes" ||
    answers.pumpFanLeak === "yes" ||
    answers.coolingWaterLeak === "yes" ||
    answers.filterStrainerBlocked === "yes" ||
    answers.oilCondition === "부족"
  );
}

function todayAbnormalEquipmentIds() {
  const today = todayText();
  const ids = new Set();

  state.inspections
    .filter(
      (item) => item.inspectionDate === today && item.resultStatus === "complete" && isAbnormalAnswers(item.answers)
    )
    .forEach((item) => ids.add(item.equipmentId));

  pendingInspectionPayloads()
    .filter((item) => item.inspectionDate === today && isAbnormalAnswers(item.answers))
    .forEach((item) => ids.add(item.equipmentId));

  return ids;
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

function plantZoneNameHtml(zone) {
  return escapeHtml(zone.name || "").replace(/\n/g, "<br />");
}

function renderPlantZones() {
  const map = $("#plantMap");
  if (!map) return;

  const zones = [...state.plantZones].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  const editMode = state.plantZoneEditMode;

  map.innerHTML = zones
    .map((zone) => {
      const color = PLANT_ZONE_COLORS.includes(zone.color) ? zone.color : "blue";
      const classes = [
        "plant-zone",
        zone.static ? "plant-zone-static" : "",
        `zc-${color}`,
        editMode ? "is-editing" : "",
        editMode && zone.id === state.selectedPlantZoneId ? "is-selected" : ""
      ]
        .filter(Boolean)
        .join(" ");
      const style = `left:${zone.left}%;top:${zone.top}%;width:${zone.width}%;height:${zone.height}%;`;
      const resizeHandle = editMode ? `<span class="plant-zone-resize" data-zone-resize></span>` : "";
      const badge = zone.static ? "" : `<span class="plant-zone-badge" data-zone-badge>-</span>`;
      const inner = `<span class="plant-zone-name">${plantZoneNameHtml(zone)}</span>${badge}${resizeHandle}`;

      if (zone.static) {
        return `<div class="${classes}" data-zone-id="${escapeHtml(zone.id)}" style="${style}">${inner}</div>`;
      }
      return `<button class="${classes}" type="button" data-zone="${escapeHtml(zone.zoneKey || "")}" data-zone-id="${escapeHtml(zone.id)}" style="${style}">${inner}</button>`;
    })
    .join("");

  renderPlantZoneEditor();
}

function renderPlantZoneEditor() {
  const editor = $("#plantZoneEditor");
  if (!editor) return;

  if (!state.plantZoneEditMode || !state.selectedPlantZoneId) {
    editor.hidden = true;
    editor.innerHTML = "";
    return;
  }

  const zone = state.plantZones.find((item) => item.id === state.selectedPlantZoneId);
  if (!zone) {
    editor.hidden = true;
    editor.innerHTML = "";
    return;
  }

  editor.hidden = false;
  editor.innerHTML = `
    <div class="form-row">
      <label>표시 이름 (줄바꿈은 그대로 두 줄로 표시됩니다)
        <textarea data-zone-field="name" rows="2">${escapeHtml(zone.name || "")}</textarea>
      </label>
    </div>
    <div class="form-row">
      <label>연결 구역 키 (설비 등록의 "현장구역"과 값이 같아야 점검 목록과 연결됩니다)
        <input type="text" data-zone-field="zoneKey" value="${escapeHtml(zone.zoneKey || "")}" placeholder="예: GT-1 BLOCK" />
      </label>
    </div>
    <div class="form-row-inline">
      <label>왼쪽(%) <input type="number" step="0.1" data-zone-field="left" value="${zone.left}" /></label>
      <label>위(%) <input type="number" step="0.1" data-zone-field="top" value="${zone.top}" /></label>
      <label>너비(%) <input type="number" step="0.1" data-zone-field="width" value="${zone.width}" /></label>
      <label>높이(%) <input type="number" step="0.1" data-zone-field="height" value="${zone.height}" /></label>
    </div>
    <div class="form-row">
      <span>색상</span>
      <div class="row-actions">
        ${PLANT_ZONE_COLORS.map(
          (color) => `
            <button type="button" class="secondary zone-color-option ${zone.color === color ? "is-active" : ""}" data-zone-color="${color}">
              <span class="plant-zone-color-swatch zc-${color}"></span>${color}
            </button>
          `
        ).join("")}
      </div>
    </div>
    <div class="form-row">
      <label class="check-inline">
        <input type="checkbox" data-zone-field="static" ${zone.static ? "checked" : ""} /> 정적 안내 상자로 표시 (클릭 불가, 점검 목록과 연결 안 함)
      </label>
    </div>
    <div class="row-actions">
      <button type="button" class="danger-button" id="plantZoneDeleteButton">이 구역 삭제</button>
      <button type="button" class="secondary" id="plantZoneCloseEditorButton">닫기</button>
    </div>
  `;
}

async function persistPlantZoneUpdate(zoneId, patch) {
  try {
    const result = await api(`/api/plant-zones/${encodeURIComponent(zoneId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    const zone = state.plantZones.find((item) => item.id === zoneId);
    if (zone && result.item) Object.assign(zone, result.item);
  } catch (error) {
    showToast(error.message || "구역 저장에 실패했습니다.", "error");
  }
}

async function addPlantZone() {
  const maxOrder = state.plantZones.reduce((max, z) => Math.max(max, Number(z.order) || 0), 0);
  const draft = {
    name: "새 구역",
    zoneKey: "",
    color: "blue",
    static: false,
    left: 5,
    top: 5,
    width: 15,
    height: 15,
    order: maxOrder + 1
  };
  try {
    const result = await api("/api/plant-zones", { method: "POST", body: JSON.stringify(draft) });
    state.plantZones.push(result.item);
    state.selectedPlantZoneId = result.item.id;
    renderPlantZones();
    showToast("구역을 추가했습니다. 위치/이름을 설정하세요.");
  } catch (error) {
    showToast(error.message || "구역 추가에 실패했습니다.", "error");
  }
}

async function deletePlantZone(zoneId) {
  const zone = state.plantZones.find((item) => item.id === zoneId);
  if (!zone) return;
  if (!window.confirm(`"${zone.name.replace(/\n/g, " ")}" 구역을 삭제할까요?`)) return;
  try {
    await api(`/api/plant-zones/${encodeURIComponent(zoneId)}`, { method: "DELETE" });
    state.plantZones = state.plantZones.filter((item) => item.id !== zoneId);
    if (state.selectedPlantZoneId === zoneId) state.selectedPlantZoneId = null;
    renderPlantZones();
    showToast("구역을 삭제했습니다.");
  } catch (error) {
    showToast(error.message || "구역 삭제에 실패했습니다.", "error");
  }
}

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
    const mappedZones = new Set(state.plantZones.map((zone) => zone.zoneKey).filter(Boolean));
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
  $("#metricAbnormal").textContent = todayAbnormalEquipmentIds().size;

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

  renderPlantZones();
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
  const abnormalOnly = $("#historyAbnormalOnly")?.checked || false;
  return fullInspectionHistory().filter((item) => {
    const cycleOk = !cycle || item.cycle === cycle;
    const equipmentOk = !equipmentId || item.equipmentId === equipmentId;
    const date = item.inspectionDate || "";
    const startOk = !startDate || date >= startDate;
    const endOk = !endDate || date <= endDate;
    const keywordOk = !keyword || String(item.equipmentName || "").toLowerCase().includes(keyword);
    const abnormalOk = !abnormalOnly || isAbnormalAnswers(item.answers);
    return cycleOk && equipmentOk && startOk && endOk && keywordOk && abnormalOk;
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
    detailRow("점검일", escapeHtml(formatInspectionDateTime(item))),
    detailRow("점검자", escapeHtml(item.inspector || "-")),
    detailRow("점검 주기", escapeHtml(cycleLabels[item.cycle] || "-")),
    detailRow("완료 여부", `<span class="badge ${item.resultStatus === "open" ? "open" : ""}">${escapeHtml(statusLabels[item.resultStatus] || item.resultStatus || "완료")}</span>`),
    detailRow("기동 여부", escapeHtml(displayYesNo(answers.start))),
    detailRow("이음 여부", escapeHtml(displayYesNo(answers.noise))),
    detailRow("윤활유 상태", escapeHtml(answers.oilCondition || "-")),
    ...(answers.oilCondition === "부족" ? [detailRow("윤활유 보충", escapeHtml(displayYesNo(answers.oilRefilled)))] : []),
    detailRow("윤활유 누유", escapeHtml(displayYesNo(answers.oilLeak))),
    ...(answers.oilLeak === "yes" ? [detailRow("누유 조치", escapeHtml(displayYesNo(answers.oilLeakFixed)))] : []),
    detailRow("펌프/팬 누수", escapeHtml(displayYesNo(answers.pumpFanLeak))),
    ...(answers.pumpFanLeak === "yes" ? [detailRow("누수 조치", escapeHtml(displayYesNo(answers.pumpFanLeakFixed)))] : [])
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
                <span class="history-date">${escapeHtml(formatInspectionDateTime(item))}</span>
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

function equipmentInspectionsSorted(equipmentId) {
  return fullInspectionHistory()
    .filter((item) => item.equipmentId === equipmentId)
    .slice()
    .sort(
      (a, b) =>
        String(b.inspectionDate || "").localeCompare(String(a.inspectionDate || "")) ||
        String(b.id || "").localeCompare(String(a.id || ""))
    );
}

function renderEquipmentDetailPicker() {
  const category0Select = $("#detailCategory0Select");
  const category1Select = $("#detailCategory1Select");
  const category2Select = $("#detailCategory2Select");
  if (!category0Select || !category1Select || !category2Select) return;

  if (!state.equipment.length) {
    category0Select.innerHTML = `<option value="">등록된 설비 없음</option>`;
    category1Select.innerHTML = `<option value="">-</option>`;
    category2Select.innerHTML = `<option value="">-</option>`;
    state.selectedDetailEquipmentId = null;
    return;
  }

  const selectedEquipment = getEquipmentById(state.selectedDetailEquipmentId);

  const category0Options = uniqueSorted(state.equipment.map((item) => equipmentCategory(item, 0)));
  const category0Value =
    category0Select.value || (selectedEquipment ? equipmentCategory(selectedEquipment, 0) : "") || category0Options[0];
  setSelectOptions(category0Select, category0Options, category0Value);

  const category0 = category0Select.value;
  const category1Options = uniqueSorted(
    state.equipment.filter((item) => equipmentCategory(item, 0) === category0).map((item) => equipmentCategory(item, 1))
  );
  const category1Value =
    category1Select.value ||
    (selectedEquipment && equipmentCategory(selectedEquipment, 0) === category0
      ? equipmentCategory(selectedEquipment, 1)
      : "") ||
    category1Options[0];
  setSelectOptions(category1Select, category1Options, category1Value);

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

  if (filteredEquipment.some((item) => item.id === state.selectedDetailEquipmentId)) {
    category2Select.value = state.selectedDetailEquipmentId;
  } else if (filteredEquipment.length) {
    category2Select.value = filteredEquipment[0].id;
  }

  state.selectedDetailEquipmentId = category2Select.value || null;
}

function workLogHistoryCard(item) {
  const badge =
    item.workType === "checkedOut"
      ? `<span class="badge open">반출</span>`
      : item.workType === "checkedIn"
        ? `<span class="badge">반입</span>`
        : item.workType === "breakdown"
          ? `<span class="badge open">고장</span>`
          : `<span class="badge">${escapeHtml(WORK_TYPE_LABELS[item.workType] || "기록")}</span>`;
  return `
    <button class="history-card" type="button" data-detail-worklog-id="${escapeHtml(item.id)}">
      <span class="history-card-main">
        <span class="history-date">${escapeHtml(item.workDate || "-")}</span>
        <span class="history-title">${escapeHtml(WORK_TYPE_LABELS[item.workType] || "작업")} · ${escapeHtml(item.worker || "작업자 미입력")}</span>
        <span class="history-meta">${escapeHtml(item.description || "-")}</span>
      </span>
      ${badge}
    </button>
  `;
}

function equipmentDetailHistoryCard(item, badgeHtml, metaText) {
  return `
    <button class="history-card" type="button" data-history-jump-id="${escapeHtml(item.id)}">
      <span class="history-card-main">
        <span class="history-date">${escapeHtml(formatInspectionDateTime(item))}</span>
        <span class="history-title">${escapeHtml(cycleLabels[item.cycle] || "-")} · ${escapeHtml(item.inspector || "점검자 미입력")}</span>
        <span class="history-meta">${escapeHtml(metaText || "-")}</span>
      </span>
      ${badgeHtml}
    </button>
  `;
}

function renderEquipmentDetailBody() {
  const container = $("#equipmentDetailBody");
  if (!container) return;

  const equipment = getEquipmentById(state.selectedDetailEquipmentId);
  if (!equipment) {
    container.innerHTML = `<p class="empty">좌측에서 설비를 선택하세요.</p>`;
    return;
  }

  const inspections = equipmentInspectionsSorted(equipment.id);
  const recent = inspections.slice(0, 10);
  const abnormalList = inspections.filter((item) => isAbnormalAnswers(item.answers));
  const allPhotos = inspections.flatMap((item) =>
    inspectionPhotos(item).map((photo) => ({ ...photo, inspectionDate: item.inspectionDate }))
  );

  const workLogs = workLogsForEquipment(equipment.id);
  const checkedOut = isEquipmentCheckedOut(equipment.id);

  const infoRows = [
    detailRow("설비번호", escapeHtml(equipment.equipmentCode || "-")),
    detailRow("상태", checkedOut ? `<span class="badge open">외부 반출중</span>` : `<span class="badge">정상 운용중</span>`),
    detailRow("현장구역", escapeHtml(equipmentFieldZone(equipment) || "-")),
    detailRow("위치", escapeHtml(equipment.location || "-")),
    detailRow("담당자", escapeHtml(equipment.manager || "-")),
    detailRow("최초 기동일", escapeHtml(equipment.startupDate || "-")),
    detailRow("점검주기", escapeHtml((equipment.cycles || []).map((c) => cycleLabels[c] || c).join(", ") || "-")),
    detailRow("메모", escapeHtml(equipment.notes || "-"))
  ].join("");

  const recentHtml = recent.length
    ? recent
        .map((item) =>
          equipmentDetailHistoryCard(
            item,
            `<span class="badge ${item.resultStatus === "open" ? "open" : ""}">${escapeHtml(statusLabels[item.resultStatus] || item.resultStatus || "완료")}</span>`,
            isAbnormalAnswers(item.answers) ? "이상 발견" : "정상"
          )
        )
        .join("")
    : `<p class="empty">점검 이력이 없습니다.</p>`;

  const photoHtml = allPhotos.length
    ? `
      <div class="detail-photo-grid">
        ${allPhotos
          .slice(0, 24)
          .map(
            (photo) => `
              <a href="${photo.photoUrl}" target="_blank" rel="noreferrer" title="${escapeHtml(photo.inspectionDate || "")}">
                <img class="detail-photo" src="${photo.photoUrl}" alt="점검 사진" />
              </a>
            `
          )
          .join("")}
      </div>
      <div class="photo-count">${allPhotos.length}장</div>
    `
    : `<p class="empty">등록된 사진이 없습니다.</p>`;

  const abnormalHtml = abnormalList.length
    ? abnormalList
        .map((item) =>
          equipmentDetailHistoryCard(item, `<span class="badge open">이상</span>`, item.note || "이상 항목 발견")
        )
        .join("")
    : `<p class="empty">이상 이력이 없습니다.</p>`;

  const workLogHtml = workLogs.length
    ? workLogs.map((item) => workLogHistoryCard(item)).join("")
    : `<p class="empty">작업 기록이 없습니다.</p>`;

  container.innerHTML = `
    <h3 class="detail-section-title">기본정보</h3>
    <div class="detail-rows">${infoRows}</div>

    <h3 class="detail-section-title">최근 점검결과</h3>
    <div class="history-list">${recentHtml}</div>

    <h3 class="detail-section-title">작업 기록</h3>
    <div class="history-list">${workLogHtml}</div>

    <h3 class="detail-section-title">사진 이력</h3>
    ${photoHtml}

    <h3 class="detail-section-title">이상 이력</h3>
    <div class="history-list">${abnormalHtml}</div>
  `;
}

function renderEquipmentDetail() {
  renderEquipmentDetailPicker();
  renderEquipmentDetailBody();
}

function renderAll() {
  renderEquipmentPicker();
  renderWorkLogPicker();
  renderEquipmentAdminTable();
  renderDashboard();
  renderHistoryEquipmentFilter();
  renderHistory();
  renderEquipmentDetail();
  renderUtilityTab();
}

function renderPhotoPreview() {
  const preview = $(".view.is-active .photo-preview");
  if (!preview) return;
  const grid = preview.querySelector(".photo-preview-grid");
  const count = state.photos.length;
  grid.innerHTML = state.photos
    .map(
      (photo, index) => `
        <div class="photo-thumb">
          <img src="${photo.dataUrl}" alt="사진 ${index + 1}" title="${Math.round(photo.compressedBytes / 1024)}KB" />
          <button type="button" class="photo-remove" data-remove-photo="${index}" aria-label="사진 ${index + 1} 삭제">×</button>
        </div>`
    )
    .join("");
  preview.hidden = count === 0;
  const counter = preview.querySelector(".photo-count");
  if (counter) counter.textContent = count ? `사진 ${count}/${PHOTO_MAX_COUNT}장 · 계속 촬영하면 추가됩니다` : "";
}

function resetInspectionFormAfterSubmit(inspectorName) {
  const form = $("#inspectionForm");
  form.reset();
  form.elements.inspectionDate.value = todayText();
  form.elements.inspector.value = inspectorName;
  state.photos = [];
  renderPhotoPreview();
  renderEquipmentPicker();
  updateNoiseVisibility("daily");
  updateCommonInspectionVisibility();
  updateOilRefillVisibility();
}

function continueAfterInspectionSubmit({ goNextAfterSave, previousEquipmentId, offline = false, reallyOffline = false, equipmentName = "" }) {
  const title = offline ? "폰에 임시 저장했습니다" : "점검이 저장되었습니다";
  const offlineNote = reallyOffline
    ? "인터넷이 연결되면 자동으로 전송됩니다. (오른쪽 아래 미전송 표시 확인)"
    : "인터넷 연결은 되어 있지만 서버 전송에 실패해서 폰에 임시 저장했습니다. 사진 용량이 크거나 일시적인 문제일 수 있어요. 오른쪽 아래 '지금 전송' 버튼으로 다시 시도해보세요.";
  const name = equipmentName ? `${equipmentName}\n` : "";

  if (goNextAfterSave) {
    if (selectNextOpenInspection(previousEquipmentId)) {
      setActiveView("inspection");
      $("#inspectionForm").scrollIntoView({ behavior: "smooth", block: "start" });
      showResult(offline ? "offline" : "success", title, `${name}${offline ? offlineNote + "\n" : ""}다음 미완료 설비로 이동했습니다.`);
      return;
    }

    setActiveView("dashboard");
    renderDashboard();
    showResult(offline ? "offline" : "success", title, `${name}${offline ? offlineNote + "\n" : ""}오늘 남은 미완료 설비가 없습니다.`);
    return;
  }

  showResult(offline ? "offline" : "success", title, `${name}${offline ? offlineNote : ""}`.trim());
  setActiveView("history");
}

const DEFAULT_PLANT_ZONES = [
  { id: "default-ccr", zoneKey: "", name: "CCR", color: "pink", static: true, left: 24.0, top: 5.3, width: 17.0, height: 19.7, order: 1 },
  { id: "default-air-compressor", zoneKey: "", name: "AIR\nCOMPRESSOR", color: "orange", static: true, left: 42.0, top: 5.3, width: 15.0, height: 19.7, order: 2 },
  { id: "default-nh3", zoneKey: "NH3", name: "NH3", color: "purple", static: false, left: 58.0, top: 5.3, width: 8.0, height: 19.7, order: 3 },
  { id: "default-bs-edg", zoneKey: "BS EDG", name: "BS EDG", color: "blue", static: false, left: 67.0, top: 5.3, width: 31.0, height: 19.7, order: 4 },
  { id: "default-acc-area", zoneKey: "ACC AREA", name: "AIR COOLED\nCONDENSER", color: "green", static: false, left: 0.0, top: 34.2, width: 41.0, height: 61.8, order: 5 },
  { id: "default-stg", zoneKey: "STG", name: "STG", color: "purple", static: false, left: 43.0, top: 34.2, width: 10.0, height: 61.8, order: 6 },
  { id: "default-hrsg-1", zoneKey: "HRSG-1 AREA", name: "HRSG 11", color: "yellow", static: false, left: 55.0, top: 34.2, width: 13.0, height: 25.0, order: 7 },
  { id: "default-gt-1", zoneKey: "GT-1 BLOCK", name: "GT 11", color: "blue", static: false, left: 55.0, top: 61.8, width: 13.0, height: 31.6, order: 8 },
  { id: "default-hrsg-2", zoneKey: "HRSG-2 AREA", name: "HRSG 12", color: "yellow", static: false, left: 70.0, top: 34.2, width: 13.0, height: 25.0, order: 9 },
  { id: "default-gt-2", zoneKey: "GT-2 BLOCK", name: "GT 12", color: "blue", static: false, left: 70.0, top: 61.8, width: 13.0, height: 31.6, order: 10 },
  { id: "default-hrsg-3", zoneKey: "HRSG-3 AREA", name: "HRSG 13", color: "yellow", static: false, left: 85.0, top: 34.2, width: 14.0, height: 25.0, order: 11 },
  { id: "default-gt-3", zoneKey: "GT-3 BLOCK", name: "GT 13", color: "blue", static: false, left: 85.0, top: 61.8, width: 14.0, height: 31.6, order: 12 }
];

const RECENT_INSPECTION_DAYS = 7;
let fullInspectionHistoryPromise = null;

// 점검 이력 전체 목록(설비 상세 / 이력 조회 탭에서만 필요)은 처음엔 불러오지 않고,
// 해당 탭을 열 때만 한 번 따로 불러옵니다. 그 전까지는 최근 N일치(state.inspections)로 대체합니다.
function fullInspectionHistory() {
  return state.inspectionsFull.length ? state.inspectionsFull : state.inspections;
}

async function ensureFullInspectionHistory() {
  if (state.inspectionsFull.length) return state.inspectionsFull;
  if (fullInspectionHistoryPromise) return fullInspectionHistoryPromise;
  fullInspectionHistoryPromise = api("/api/inspections")
    .then((result) => {
      state.inspectionsFull = result.items || [];
      renderHistory();
      renderEquipmentDetail();
      return state.inspectionsFull;
    })
    .catch((error) => {
      console.error("전체 점검 이력을 불러오지 못했습니다.", error);
      return [];
    })
    .finally(() => {
      fullInspectionHistoryPromise = null;
    });
  return fullInspectionHistoryPromise;
}

function formatTimeFromIso(iso) {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function formatInspectionDateTime(item) {
  const date = item.inspectionDate || "-";
  const time = formatTimeFromIso(item.createdAt);
  return time ? `${date} ${time}` : date;
}

async function loadData({ syncPending = true } = {}) {
  try {
    const [equipment, inspections, tanks, tankReadings] = await Promise.all([
      api("/api/equipment"),
      api(`/api/inspections?days=${RECENT_INSPECTION_DAYS}`),
      api("/api/tanks"),
      api("/api/tank-readings")
    ]);
    state.equipment = equipment.items || [];
    state.inspections = inspections.items || [];
    // 최근 N일치로 갱신되었으니, 이전에 따로 불러둔 전체 이력 캐시는 비워서
    // 이력 조회 / 설비 상세 탭을 다시 열 때 최신 데이터로 다시 받아오게 합니다.
    state.inspectionsFull = [];
    state.tanks = tanks.items || [];
    state.tankReadings = tankReadings.items || [];

    // 구역 편집 API는 별도로 시도합니다. 배포된 Apps Script 백엔드가 아직
    // plantZones 컬렉션을 모르는 구버전이어도 나머지 화면은 정상 동작해야 합니다.
    try {
      const plantZones = await api("/api/plant-zones");
      state.plantZones = plantZones.items && plantZones.items.length ? plantZones.items : DEFAULT_PLANT_ZONES;
    } catch (zoneError) {
      state.plantZones = DEFAULT_PLANT_ZONES;
    }

    // 작업 기록 / 정비 항목도 구버전 백엔드에서는 없을 수 있으니 개별적으로 시도합니다.
    try {
      const workLogs = await api("/api/work-logs");
      state.workLogs = workLogs.items || [];
    } catch (workLogError) {
      state.workLogs = [];
    }
    try {
      const pmTasks = await api("/api/pm-tasks");
      state.pmTasks = pmTasks.items || [];
    } catch (pmError) {
      state.pmTasks = [];
    }

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

  $("#workCategory0Select")?.addEventListener("change", () => {
    $("#workCategory1Select").value = "";
    $("#workEquipmentSelect").value = "";
    renderWorkLogPicker();
  });

  $("#workCategory1Select")?.addEventListener("change", () => {
    $("#workEquipmentSelect").value = "";
    renderWorkLogPicker();
  });

  $("#workCategory2Select")?.addEventListener("change", () => {
    $("#workEquipmentSelect").value = $("#workCategory2Select").value;
    renderWorkRelatedPmOptions();
  });

  $$('input[name="workType"]').forEach((input) => {
    input.addEventListener("change", renderWorkRelatedPmOptions);
  });

  $("#workLogForm")?.addEventListener("reset", () => {
    state.photos = [];
    window.setTimeout(() => {
      renderPhotoPreview();
      const dateInput = $('#workLogForm [name="workDate"]');
      if (dateInput) dateInput.value = todayText();
      renderWorkRelatedPmOptions();
    }, 0);
  });

  $("#workLogForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const equipment = getEquipmentById($("#workEquipmentSelect").value);
    if (!equipment) {
      showToast("설비를 먼저 선택하세요.", "error");
      return;
    }

    const workerName = normalizeInspectorName(form.elements.worker.value);
    const payload = {
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      workType: checkedValue(form, "workType"),
      workDate: form.elements.workDate.value || todayText(),
      worker: workerName,
      description: form.elements.description.value.trim(),
      relatedPmCode: form.elements.relatedPmCode ? form.elements.relatedPmCode.value : "",
      photos: state.photos
    };

    try {
      await api("/api/work-logs", { method: "POST", body: JSON.stringify(payload) });

      if (payload.relatedPmCode) {
        const task = (state.pmTasks || []).find((item) => item.code === payload.relatedPmCode);
        try {
          await api("/api/pm-records", {
            method: "POST",
            body: JSON.stringify({
              doneDate: payload.workDate,
              equipmentId: equipment.id,
              equipmentName: equipment.name,
              pmCode: payload.relatedPmCode,
              pmName: (task && task.name) || payload.relatedPmCode,
              hoursAtDone: equipment.runningHours ?? null,
              doneBy: workerName,
              note: payload.description
            })
          });
        } catch (pmRecordError) {
          // 정비 일정 연동은 부가 기능이라 실패해도 작업 기록 저장 자체는 유지합니다.
        }
      }

      rememberInspectorName(workerName);
      form.reset();
      form.elements.workDate.value = todayText();
      form.elements.worker.value = workerName;
      state.photos = [];
      renderPhotoPreview();
      renderWorkRelatedPmOptions();
      showToast(
        payload.workType === "checkedOut"
          ? "외부 반출로 기록했습니다. 반입 전까지 오늘 점검 대상에서 제외됩니다."
          : "작업 기록이 저장되었습니다."
      );
      await loadData();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

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
    if (state.plantZoneEditMode) return;
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

  (function setupPlantZoneEditing() {
    const map = $("#plantMap");
    if (!map) return;

    let dragState = null;

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    map.addEventListener("pointerdown", (event) => {
      if (!state.plantZoneEditMode) return;
      const zoneEl = event.target.closest("[data-zone-id]");
      if (!zoneEl) return;
      const resizeHandle = event.target.closest("[data-zone-resize]");
      const zoneId = zoneEl.dataset.zoneId;
      const zone = state.plantZones.find((item) => item.id === zoneId);
      if (!zone) return;

      event.preventDefault();
      const rect = map.getBoundingClientRect();
      dragState = {
        mode: resizeHandle ? "resize" : "move",
        zoneId,
        zone,
        el: zoneEl,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: zone.left,
        startTop: zone.top,
        startWidth: zone.width,
        startHeight: zone.height,
        rectWidth: rect.width,
        rectHeight: rect.height,
        moved: false
      };
      try {
        zoneEl.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    });

    map.addEventListener("pointermove", (event) => {
      if (!dragState) return;
      const dxPercent = ((event.clientX - dragState.startX) / dragState.rectWidth) * 100;
      const dyPercent = ((event.clientY - dragState.startY) / dragState.rectHeight) * 100;
      if (Math.abs(dxPercent) > 0.3 || Math.abs(dyPercent) > 0.3) dragState.moved = true;

      if (dragState.mode === "move") {
        const newLeft = clamp(dragState.startLeft + dxPercent, 0, 100 - dragState.startWidth);
        const newTop = clamp(dragState.startTop + dyPercent, 0, 100 - dragState.startHeight);
        dragState.zone.left = Math.round(newLeft * 10) / 10;
        dragState.zone.top = Math.round(newTop * 10) / 10;
      } else {
        const newWidth = clamp(dragState.startWidth + dxPercent, 4, 100 - dragState.startLeft);
        const newHeight = clamp(dragState.startHeight + dyPercent, 4, 100 - dragState.startTop);
        dragState.zone.width = Math.round(newWidth * 10) / 10;
        dragState.zone.height = Math.round(newHeight * 10) / 10;
      }

      dragState.el.style.left = `${dragState.zone.left}%`;
      dragState.el.style.top = `${dragState.zone.top}%`;
      dragState.el.style.width = `${dragState.zone.width}%`;
      dragState.el.style.height = `${dragState.zone.height}%`;
    });

    function endDrag(event) {
      if (!dragState) return;
      const { zoneId, zone, moved, mode, el } = dragState;
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      dragState = null;

      if (!moved) {
        state.selectedPlantZoneId = zoneId;
        renderPlantZones();
        return;
      }

      persistPlantZoneUpdate(
        zoneId,
        mode === "move" ? { left: zone.left, top: zone.top } : { width: zone.width, height: zone.height }
      );
      if (zoneId === state.selectedPlantZoneId) renderPlantZoneEditor();
    }

    map.addEventListener("pointerup", endDrag);
    map.addEventListener("pointercancel", endDrag);
  })();

  $("#plantZoneEditToggle")?.addEventListener("click", () => {
    state.plantZoneEditMode = !state.plantZoneEditMode;
    if (!state.plantZoneEditMode) state.selectedPlantZoneId = null;
    $("#plantZoneEditToggle").textContent = state.plantZoneEditMode ? "편집 완료" : "구역 편집";
    if ($("#plantZoneAddButton")) $("#plantZoneAddButton").hidden = !state.plantZoneEditMode;
    renderPlantZones();
  });

  $("#plantZoneAddButton")?.addEventListener("click", addPlantZone);

  $("#plantZoneEditor")?.addEventListener("click", (event) => {
    if (event.target.closest("#plantZoneDeleteButton")) {
      if (state.selectedPlantZoneId) deletePlantZone(state.selectedPlantZoneId);
      return;
    }
    if (event.target.closest("#plantZoneCloseEditorButton")) {
      state.selectedPlantZoneId = null;
      renderPlantZones();
      return;
    }
    const colorButton = event.target.closest("[data-zone-color]");
    if (colorButton) {
      const zone = state.plantZones.find((item) => item.id === state.selectedPlantZoneId);
      if (!zone) return;
      zone.color = colorButton.dataset.zoneColor;
      renderPlantZones();
      persistPlantZoneUpdate(zone.id, { color: zone.color });
    }
  });

  $("#plantZoneEditor")?.addEventListener("change", (event) => {
    const zone = state.plantZones.find((item) => item.id === state.selectedPlantZoneId);
    if (!zone) return;
    const field = event.target.dataset.zoneField;
    if (!field) return;

    if (field === "static") {
      zone.static = event.target.checked;
      persistPlantZoneUpdate(zone.id, { static: zone.static });
      renderPlantZones();
      return;
    }
    if (["left", "top", "width", "height"].includes(field)) {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) {
        zone[field] = value;
        persistPlantZoneUpdate(zone.id, { [field]: value });
        renderPlantZones();
      }
      return;
    }
    const value = field === "zoneKey" ? event.target.value.trim() : event.target.value;
    zone[field] = value;
    persistPlantZoneUpdate(zone.id, { [field]: value });
    renderPlantZones();
  });

  $("#detailCategory0Select")?.addEventListener("change", () => {
    $("#detailCategory1Select").value = "";
    state.selectedDetailEquipmentId = null;
    renderEquipmentDetail();
  });

  $("#detailCategory1Select")?.addEventListener("change", () => {
    state.selectedDetailEquipmentId = null;
    renderEquipmentDetail();
  });

  $("#detailCategory2Select")?.addEventListener("change", () => {
    state.selectedDetailEquipmentId = $("#detailCategory2Select").value || null;
    renderEquipmentDetailBody();
  });

  $("#equipmentDetailBody")?.addEventListener("click", (event) => {
    const jumpButton = event.target.closest("[data-history-jump-id]");
    if (!jumpButton) return;
    state.selectedHistoryId = jumpButton.dataset.historyJumpId;
    $("#historyCycle").value = "";
    $("#historyEquipment").value = "";
    $("#historyStartDate").value = "";
    $("#historyEndDate").value = "";
    $("#historySearch").value = "";
    setActiveView("history");
    renderHistory();
  });

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

  $("#inspectionForm").addEventListener("reset", () => {
    state.photos = [];
    window.setTimeout(() => {
      renderPhotoPreview();
      updateOilRefillVisibility();
    }, 0);
  });

  let inspectionSubmitting = false;
  $("#inspectionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (inspectionSubmitting) return; // 두 번 눌러도 한 번만 저장
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

    inspectionSubmitting = true;
    const submitButtons = $$('button[type="submit"]', form);
    submitButtons.forEach((button) => (button.disabled = true));
    const photoCount = (state.photos || []).length;
    showBusy("점검 저장 중입니다", photoCount ? `사진 ${photoCount}장을 올리는 중입니다. 화면을 닫지 마세요.` : "잠시만 기다려주세요.");

    try {
      await postInspectionPayload(payload);
      const rememberedInspector = rememberInspectorName(inspectorName);
      resetInspectionFormAfterSubmit(rememberedInspector);
      showBusy("저장 완료 – 목록을 새로 불러오는 중", "");
      await loadData();
      continueAfterInspectionSubmit({ goNextAfterSave, previousEquipmentId: equipment.id, equipmentName: equipment.name });
    } catch (error) {
      if (!isLikelyNetworkError(error)) {
        showResult("error", "저장하지 못했습니다", error.message || "다시 시도해주세요.");
        return;
      }

      await queuePendingInspection(payload);
      const rememberedInspector = rememberInspectorName(inspectorName);
      resetInspectionFormAfterSubmit(rememberedInspector);
      renderDashboard();
      continueAfterInspectionSubmit({ goNextAfterSave, previousEquipmentId: equipment.id, offline: true, reallyOffline: !navigator.onLine, equipmentName: equipment.name });
    } finally {
      inspectionSubmitting = false;
      submitButtons.forEach((button) => (button.disabled = false));
      hideBusy();
    }
  });

  $$('input[name="oilLeak"]').forEach((input) => {
    input.addEventListener("change", updateOilLeakFixVisibility);
  });

  $$('input[name="pumpFanLeak"]').forEach((input) => {
    input.addEventListener("change", updateLeakFixVisibility);
  });

  $$('input[name="dailyOilCondition"]').forEach((input) => {
    input.addEventListener("change", updateOilRefillVisibility);
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

  // 사진: 촬영/선택할 때마다 "추가"됩니다 (최대 PHOTO_MAX_COUNT 장). 썸네일의 ×로 개별 삭제.
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-photo]");
    if (!button) return;
    state.photos.splice(Number(button.dataset.removePhoto), 1);
    renderPhotoPreview();
  });

  $$("[data-photo-input]").forEach((input) => input.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = ""; // 같은 버튼으로 계속 추가 촬영할 수 있게 초기화
    if (files.length === 0) return;

    const room = PHOTO_MAX_COUNT - state.photos.length;
    if (room <= 0) {
      showToast(`사진은 점검 1건에 최대 ${PHOTO_MAX_COUNT}장까지입니다. 필요 없는 사진을 ×로 지우세요.`, "error");
      return;
    }
    const accepted = files.slice(0, room);
    if (files.length > room) {
      showToast(`최대 ${PHOTO_MAX_COUNT}장이라 ${accepted.length}장만 추가했습니다.`, "error");
    }

    const totalSize = accepted.reduce((sum, file) => sum + file.size, 0);
    if (accepted.some((file) => file.size > PHOTO_MAX_SOURCE_BYTES) || totalSize > PHOTO_MAX_TOTAL_SOURCE_BYTES) {
      showToast("원본 사진이 너무 큽니다. 사진을 조금 줄여서 다시 선택해주세요.", "error");
      return;
    }

    try {
      showBusy("사진 준비 중입니다", `${accepted.length}장 용량을 줄이는 중...`);
      for (const file of accepted) {
        state.photos.push(await compressPhoto(file, state.photos.length));
      }
      hideBusy();
      renderPhotoPreview();
    } catch (error) {
      hideBusy();
      renderPhotoPreview();
      showToast(error.message || "사진을 처리하지 못했습니다.", "error");
    }
  }));

  $("#historyCycle").addEventListener("change", renderHistory);
  $("#historyEquipment").addEventListener("change", renderHistory);
  $("#historyStartDate").addEventListener("change", renderHistory);
  $("#historyEndDate").addEventListener("change", renderHistory);
  $("#historySearch").addEventListener("input", renderHistory);
  $("#historyAbnormalOnly")?.addEventListener("change", renderHistory);

  $("#metricAbnormalCard")?.addEventListener("click", () => {
    const today = todayText();
    $("#historyCycle").value = "";
    $("#historyEquipment").value = "";
    $("#historyStartDate").value = today;
    $("#historyEndDate").value = today;
    $("#historySearch").value = "";
    const abnormalCheckbox = $("#historyAbnormalOnly");
    if (abnormalCheckbox) abnormalCheckbox.checked = true;
    setActiveView("history");
    renderHistory();
  });
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
  updateOilRefillVisibility();
  await loadData();
}

init();
