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
  setText("#cardStartupDate", equipment?.startupDate);
  setText("#cardDrawingNo", equipment?.drawingNo);

  const history = state.inspections
    .filter((item) => item.equipmentId === equipment?.id)
    .sort((a, b) => String(b.inspectionDate || "").localeCompare(String(a.inspectionDate || "")));

  // INSPECTION TREND 그래프는 레포트에서 제외 (요청)

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

  $("#excelTemplate").addEventListener("click", () => downloadExcelTemplate().catch((e) => showToast(e.message, "error")));
  $("#excelImport").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (file) importExcel(file).catch((e) => showToast(e.message, "error"));
  });

  $("#printReport").addEventListener("click", () => {
    updateReportPageNo();
    window.print();
  });
  window.addEventListener("beforeprint", updateReportPageNo);
}

// ===== 엑셀 양식 내려받기 / 불러오기 (설비 정보 일괄 입력) =====
const EXCEL_COLUMNS = [
  { key: "id", header: "ID (수정 금지)", readonly: true, width: 10 },
  { key: "equipmentCode", header: "KKS (수정 금지)", readonly: true, width: 16 },
  { key: "name", header: "설비명 (참고)", readonly: true, width: 34 },
  { key: "location", header: "위치 (참고)", readonly: true, width: 22 },
  { key: "capacity", header: "Capacity", width: 14 },
  { key: "head", header: "Head", width: 12 },
  { key: "speed", header: "Speed", width: 12 },
  { key: "typeModelSize", header: "Type/Model/Size", width: 20 },
  { key: "lube", header: "Lube", width: 14 },
  { key: "driverOutput", header: "Driver Output", width: 14 },
  { key: "manufacturer", header: "Manufacturer", width: 18 },
  { key: "placeInst", header: "Location (Place Inst.)", width: 18 },
  { key: "drawingNo", header: "Drawing No.", width: 18 },
  { key: "pageNo", header: "Page No.", width: 10 },
  { key: "startupDate", header: "최초 기동일 (YYYY-MM-DD)", width: 16 },
  { key: "manager", header: "담당자", width: 12 },
  { key: "notes", header: "메모", width: 24 }
];

let xlsxLoader = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxLoader) {
    xlsxLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      script.onload = () => resolve(window.XLSX);
      script.onerror = () => {
        xlsxLoader = null;
        reject(new Error("엑셀 기능을 불러오지 못했습니다. 인터넷 연결을 확인하세요."));
      };
      document.head.appendChild(script);
    });
  }
  return xlsxLoader;
}

async function downloadExcelTemplate() {
  const XLSX = await loadXlsx();
  const rows = [...state.equipment]
    .sort((a, b) => String(a.location || "").localeCompare(String(b.location || "")) || String(a.name || "").localeCompare(String(b.name || "")))
    .map((item) => EXCEL_COLUMNS.map((col) => item[col.key] ?? ""));
  const sheet = XLSX.utils.aoa_to_sheet([EXCEL_COLUMNS.map((col) => col.header), ...rows]);
  sheet["!cols"] = EXCEL_COLUMNS.map((col) => ({ wch: col.width }));
  sheet["!freeze"] = { xSplit: 3, ySplit: 1 };
  const guide = XLSX.utils.aoa_to_sheet([
    ["설비 정보 일괄 입력 방법"],
    ["1. '설비정보' 시트의 Capacity ~ 메모 칸을 채웁니다."],
    ["2. ID, KKS, 설비명, 위치 칸은 수정하지 마세요. (ID로 설비를 찾습니다. ID가 비어 있으면 KKS로 찾습니다)"],
    ["3. 빈 칸은 기존 값을 그대로 둡니다. (지우지 않음)"],
    ["4. 최초 기동일은 2026-06-07 형식으로 입력합니다."],
    ["5. 저장 후 오피스 화면의 [엑셀 불러오기]로 파일을 선택하면 한 번에 반영됩니다."]
  ]);
  guide["!cols"] = [{ wch: 90 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "설비정보");
  XLSX.utils.book_append_sheet(book, guide, "사용방법");
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(book, `설비정보_양식_${today}.xlsx`);
}

function excelCellText(value, key, XLSX) {
  // 날짜 칸: 엑셀 날짜(숫자)를 YYYY-MM-DD 로 (시간대 영향 없이)
  if (key === "startupDate" && typeof value === "number" && XLSX) {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  if (key === "startupDate") return String(value ?? "").trim().replace(/[./]/g, "-");
  return String(value ?? "").trim();
}

async function importExcel(file) {
  const XLSX = await loadXlsx();
  const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = book.Sheets["설비정보"] || book.Sheets[book.SheetNames[0]];
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  if (table.length < 2) throw new Error("엑셀에 데이터가 없습니다.");

  const headerRow = table[0].map((cell) => String(cell).trim());
  const colIndex = {};
  EXCEL_COLUMNS.forEach((col) => {
    const index = headerRow.indexOf(col.header);
    if (index !== -1) colIndex[col.key] = index;
  });
  if (!("id" in colIndex) && !("equipmentCode" in colIndex)) {
    throw new Error("양식이 다릅니다. [엑셀 양식 내려받기]로 받은 파일을 사용하세요.");
  }

  const items = table
    .slice(1)
    .map((row) => {
      const item = {};
      EXCEL_COLUMNS.forEach((col) => {
        if (col.key in colIndex && (!col.readonly || col.key === "id" || col.key === "equipmentCode")) {
          item[col.key] = excelCellText(row[colIndex[col.key]], col.key, XLSX);
        }
      });
      return item;
    })
    .filter((item) => item.id || item.equipmentCode);

  if (!items.length) throw new Error("불러올 설비가 없습니다.");
  if (!window.confirm(`엑셀의 설비 ${items.length}개 정보를 앱에 덮어쓸까요?\n(빈 칸은 기존 값 유지)`)) return;

  showToast("엑셀 내용을 저장하는 중입니다...");
  const result = await api("/api/equipment-bulk", { method: "POST", body: JSON.stringify({ items }) });
  await loadData();
  const missing = result.notFound && result.notFound.length ? ` / 못 찾은 설비 ${result.notFound.length}개: ${result.notFound.slice(0, 5).join(", ")}` : "";
  showToast(`설비 ${result.updated}개 정보를 반영했습니다.${missing}`);
}

async function init() {
  await ensureAppCode();
  bindEvents();
  await loadData();
}

init();
