const cycleLabels = {
  daily: "일간",
  weekly: "주간",
  semiannual: "반기"
};

const masterFields = [
  "capacity",
  "head",
  "speed",
  "typeModelSize",
  "lube",
  "driverOutput",
  "manufacturer",
  "placeInst",
  "drawingNo"
];

const PRINT_PAGE_HEIGHT_PX = 940;

const state = {
  equipment: [],
  inspections: [],
  selectedEquipmentId: null
};

const $ = (selector, root = document) => root.querySelector(selector);

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function category(item, index) {
  if (index === 0 && item.category0) return item.category0;
  if (index === 1 && item.category1) return item.category1;
  const parts = String(item.location || "").split("/").map((part) => part.trim()).filter(Boolean);
  return parts[index] || "미분류";
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
  return item.fieldZone || inferredFieldZone(category(item, 0));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function selectedEquipment() {
  return state.equipment.find((item) => item.id === state.selectedEquipmentId) || state.equipment[0] || null;
}

function renderFilters() {
  const zone = $("#fieldZoneFilter");
  const c0 = $("#category0Filter");
  const c1 = $("#category1Filter");

  const zoneOptions = ["현장구역 전체", ...uniqueSorted(state.equipment.map(equipmentFieldZone))];
  const zoneValue = zone.value || zoneOptions[0];
  zone.innerHTML = zoneOptions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
  zone.value = zoneOptions.includes(zoneValue) ? zoneValue : zoneOptions[0];

  const zoneFiltered = zone.value === zoneOptions[0] ? state.equipment : state.equipment.filter((item) => equipmentFieldZone(item) === zone.value);
  const c0Options = ["구역 전체", ...uniqueSorted(zoneFiltered.map((item) => category(item, 0)))];
  const c0Value = c0.value || c0Options[0];
  c0.innerHTML = c0Options.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
  c0.value = c0Options.includes(c0Value) ? c0Value : c0Options[0];

  const filtered = c0.value === c0Options[0] ? zoneFiltered : zoneFiltered.filter((item) => category(item, 0) === c0.value);
  const c1Options = ["계통 전체", ...uniqueSorted(filtered.map((item) => category(item, 1)))];
  const c1Value = c1.value || c1Options[0];
  c1.innerHTML = c1Options.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
  c1.value = c1Options.includes(c1Value) ? c1Value : c1Options[0];
}

function filteredEquipment() {
  const zone = $("#fieldZoneFilter").value;
  const c0 = $("#category0Filter").value;
  const c1 = $("#category1Filter").value;
  const keyword = $("#equipmentSearch").value.trim().toLowerCase();
  return state.equipment.filter((item) => {
    const zoneOk = zone.includes("전체") || equipmentFieldZone(item) === zone;
    const c0Ok = c0.includes("전체") || category(item, 0) === c0;
    const c1Ok = c1.includes("전체") || category(item, 1) === c1;
    const keywordOk =
      !keyword ||
      [item.name, item.equipmentCode, item.location, equipmentFieldZone(item)].some((value) => String(value || "").toLowerCase().includes(keyword));
    return zoneOk && c0Ok && c1Ok && keywordOk;
  });
}

function renderEquipmentList() {
  const items = filteredEquipment();
  if (!items.some((item) => item.id === state.selectedEquipmentId)) {
    state.selectedEquipmentId = items[0]?.id || state.equipment[0]?.id || null;
  }

  $("#equipmentList").innerHTML = items.length
    ? items
        .slice(0, 300)
        .map(
          (item) => `
            <button class="equipment-list-button ${item.id === state.selectedEquipmentId ? "is-active" : ""}" type="button" data-equipment-id="${escapeHtml(item.id)}">
              <strong>${escapeHtml(item.name || "-")}</strong>
              <span>${escapeHtml(item.equipmentCode || "-")} · ${escapeHtml(equipmentFieldZone(item))} · ${escapeHtml(item.location || "-")}</span>
            </button>
          `
        )
        .join("")
    : `<p class="empty">조회된 설비가 없습니다.</p>`;
}

function fillMasterForm(equipment) {
  const form = $("#masterForm");
  for (const field of masterFields) {
    form.elements[field].value = field === "placeInst" ? equipment?.placeInst || equipment?.location || "" : equipment?.[field] || "";
  }
}

function reportLocation(equipment) {
  if (!equipment) return "";
  return equipment.placeInst || equipment.location || [category(equipment, 0), category(equipment, 1)].filter(Boolean).join(" ");
}

function inspectionDescription(item) {
  const answers = item.answers || {};
  const pieces = [];

  if (answers.start === "yes") pieces.push("운전중");
  if (answers.start === "no") pieces.push("정지");

  if (answers.noise === "yes") pieces.push("소음 발생");
  if (answers.noise === "no") pieces.push("소음 없음");

  if (answers.oilCondition) pieces.push(`윤활유 ${answers.oilCondition}`);
  if (answers.oilLeak === "yes") pieces.push("윤활유 누유 있음");
  if (answers.oilLeak === "no") pieces.push("윤활유 누유 없음");
  if (answers.pumpFanLeak === "yes") pieces.push("펌프/팬 누수 있음");
  if (answers.pumpFanLeak === "no") pieces.push("펌프/팬 누수 없음");

  if (answers.clean === "yes") pieces.push("청소상태 양호");
  if (answers.clean === "no") pieces.push("청소 필요");

  if (answers.filterStrainerBlocked === "yes") pieces.push("필터/스트레이너 막힘");
  if (answers.filterStrainerBlocked === "no") pieces.push("필터/스트레이너 막힘 없음");
  if (answers.filterStrainerCleaned === "yes") pieces.push("스트레이너 청소완료");
  if (answers.filterStrainerCleaned === "no") pieces.push("스트레이너 미청소");

  if (item.note) pieces.push(item.note);
  return pieces.join(", ") || "정기 점검 완료";
}

function inspectionPhotos(item) {
  if (Array.isArray(item?.photos) && item.photos.length > 0) return item.photos;
  return item?.photoUrl ? [{ photoUrl: item.photoUrl, photoName: item.photoName }] : [];
}

function inspectionPhotoHtml(item) {
  const photos = inspectionPhotos(item);
  if (!photos.length) return "";
  return `
    <div class="report-photo-grid">
      ${photos
        .map(
          (photo) => `
            <a class="report-photo-link" href="${escapeHtml(photo.photoUrl)}" target="_blank" rel="noreferrer">
              <img class="report-photo-thumb" src="${escapeHtml(photo.photoUrl)}" alt="점검 사진" />
            </a>
          `
        )
        .join("")}
    </div>
  `;
}

function inspectionIssueCount(item) {
  const answers = item?.answers || {};
  let count = 0;

  if (answers.start === "no") count += 1;
  if (answers.noise === "yes") count += 1;
  if (String(answers.oilCondition || "").includes("부족")) count += 1;
  if (answers.oilLeak === "yes") count += 1;
  if (answers.pumpFanLeak === "yes") count += 1;
  if (answers.clean === "no") count += 1;
  if (answers.filterStrainerBlocked === "yes") count += 1;
  if (answers.filterStrainerCleaned === "no") count += 1;

  return count;
}

function inspectionTrendHtml(history) {
  const recent = history.slice(0, 12).reverse();
  if (!recent.length) {
    return `
      <div class="trend-title">INSPECTION TREND</div>
      <div class="trend-empty">No inspection history</div>
    `;
  }

  const values = recent.map((item) => inspectionIssueCount(item));
  const max = Math.max(1, ...values);

  return `
    <div class="trend-title">INSPECTION TREND</div>
    <div class="trend-bars">
      ${recent
        .map((item, index) => {
          const count = values[index];
          const height = count === 0 ? 6 : Math.max(12, Math.round((count / max) * 58));
          return `
            <div class="trend-item" title="${escapeHtml(item.inspectionDate || "")} / ${count}">
              <span class="trend-count">${count}</span>
              <span class="trend-bar ${count > 0 ? "has-issue" : ""}" style="height:${height}px"></span>
              <span class="trend-date">${escapeHtml(String(item.inspectionDate || "").slice(5) || "-")}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function estimateReportPages() {
  const card = $("#equipmentCard");
  if (!card) return 1;
  return Math.max(1, Math.ceil(card.scrollHeight / PRINT_PAGE_HEIGHT_PX));
}

function updateReportPageNo() {
  $("#cardPageNo").textContent = `1 / ${estimateReportPages()}`;
}

function renderCard() {
  const equipment = selectedEquipment();
  fillMasterForm(equipment);

  const setText = (id, value) => {
    $(id).textContent = value || "-";
  };

  setText("#cardPlant", equipment ? `${category(equipment, 0)} ${category(equipment, 1)}` : "-");
  setText("#cardKks", equipment?.equipmentCode);
  setText("#cardName", equipment?.name);
  setText("#cardCapacity", equipment?.capacity);
  setText("#cardHead", equipment?.head);
  setText("#cardSpeed", equipment?.speed);
  setText("#cardTypeModelSize", equipment?.typeModelSize);
  setText("#cardLube", equipment?.lube);
  setText("#cardDriverOutput", equipment?.driverOutput);
  setText("#cardManufacturer", equipment?.manufacturer);
  setText("#cardPlaceInst", reportLocation(equipment));
  setText("#cardDrawingNo", equipment?.drawingNo);

  const history = state.inspections
    .filter((item) => item.equipmentId === equipment?.id)
    .sort((a, b) => String(b.inspectionDate || "").localeCompare(String(a.inspectionDate || "")));

  $("#inspectionTrend").innerHTML = inspectionTrendHtml(history);

  const rows = Array.from({ length: Math.max(14, history.length) }, (_, index) => {
    const item = history[index];
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item?.inspectionDate || "")}</td>
        <td>${escapeHtml(item ? cycleLabels[item.cycle] || "" : "")}</td>
        <td class="history-description">${escapeHtml(item ? inspectionDescription(item) : "")}</td>
        <td class="history-remark">${inspectionPhotoHtml(item)}</td>
      </tr>
    `;
  });

  $("#cardHistory").innerHTML = rows.join("");
  updateReportPageNo();
}

function renderAll() {
  renderFilters();
  renderEquipmentList();
  renderCard();
}

async function loadData() {
  try {
    const [equipment, inspections] = await Promise.all([api("/api/equipment"), api("/api/inspections")]);
    state.equipment = equipment.items || [];
    state.inspections = inspections.items || [];
    renderAll();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function bindEvents() {
  $("#fieldZoneFilter").addEventListener("change", () => {
    $("#category0Filter").value = "";
    $("#category1Filter").value = "";
    renderAll();
  });
  $("#category0Filter").addEventListener("change", () => {
    $("#category1Filter").value = "";
    renderAll();
  });
  $("#category1Filter").addEventListener("change", renderAll);
  $("#equipmentSearch").addEventListener("input", renderAll);

  $("#equipmentList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-equipment-id]");
    if (!button) return;
    state.selectedEquipmentId = button.dataset.equipmentId;
    renderEquipmentList();
    renderCard();
  });

  $("#saveMaster").addEventListener("click", async () => {
    const equipment = selectedEquipment();
    if (!equipment) return;
    const form = $("#masterForm");
    const payload = Object.fromEntries(masterFields.map((field) => [field, form.elements[field].value]));

    try {
      const updated = await api(`/api/equipment/${encodeURIComponent(equipment.id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      state.equipment = state.equipment.map((item) => (item.id === equipment.id ? updated.item : item));
      showToast("설비 정보가 저장되었습니다.");
      renderCard();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#printReport").addEventListener("click", () => {
    updateReportPageNo();
    window.print();
  });
  window.addEventListener("beforeprint", updateReportPageNo);
}

async function init() {
  await ensureAppCode();
  bindEvents();
  await loadData();
}

init();
