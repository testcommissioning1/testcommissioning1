/*
 * 기존 앱의 /api/... 호출을 Google Apps Script 백엔드 호출로 바꿔주는 어댑터
 * + 오프라인 저장소(IndexedDB): 미전송 점검 기록, 마지막으로 받은 데이터 캐시
 */
(function () {
  const COLLECTION_BY_PATH = {
    equipment: "equipment",
    inspections: "inspections",
    tanks: "tanks",
    "tank-readings": "tankReadings"
  };
  const ACTION_BY_METHOD = { GET: "list", POST: "create", PATCH: "update", DELETE: "delete" };

  function apiUrl() {
    return String((window.APP_CONFIG && window.APP_CONFIG.API_URL) || "").trim();
  }

  function route(path, method) {
    const match = /^\/api\/([^/?]+)(?:\/([^/?]+))?/.exec(path);
    if (!match) return null;
    if (match[1] === "health") return { action: "health" };
    const collection = COLLECTION_BY_PATH[match[1]];
    const action = ACTION_BY_METHOD[String(method || "GET").toUpperCase()];
    if (!collection || !action) return null;
    return { action, collection, id: match[2] ? decodeURIComponent(match[2]) : "" };
  }

  function fakeResponse(status, data) {
    return { status, ok: status >= 200 && status < 300, json: async () => data };
  }

  // ---------- IndexedDB (실패하면 메모리 + localStorage 로 대체) ----------
  const DB_NAME = "rotating-pm-offline";
  const STORE = "kv";
  const LEGACY_PENDING_KEY = "rotatingEquipmentPendingInspections";
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("no indexedDB"));
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      dbPromise = Promise.resolve(null);
      return null;
    });
    return dbPromise;
  }

  async function idbGet(key) {
    const db = await openDb();
    if (!db) {
      try {
        return JSON.parse(localStorage.getItem(`${DB_NAME}:${key}`) || "null");
      } catch {
        return null;
      }
    }
    return new Promise((resolve) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
  }

  async function idbSet(key, value) {
    const db = await openDb();
    if (!db) {
      try {
        localStorage.setItem(`${DB_NAME}:${key}`, JSON.stringify(value));
      } catch {
        /* 저장 공간 부족 */
      }
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  const OfflineStore = {
    pending: [],
    listeners: [],
    async init() {
      const stored = await idbGet("pending");
      this.pending = Array.isArray(stored) ? stored : [];
      // 이전 버전(localStorage)에 남아있던 미전송 기록 옮기기
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_PENDING_KEY) || "[]");
        if (Array.isArray(legacy) && legacy.length) {
          this.pending = this.pending.concat(legacy);
          await idbSet("pending", this.pending);
          localStorage.removeItem(LEGACY_PENDING_KEY);
        }
      } catch {
        /* ignore */
      }
      // 브라우저가 저장 공간을 임의로 비우지 않도록 요청
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      this.notify();
    },
    getPending() {
      return this.pending.slice();
    },
    setPending(items) {
      this.pending = items.slice();
      this.notify();
      return idbSet("pending", this.pending).catch(() => {
        alert("폰 저장 공간이 부족해서 미전송 기록을 저장하지 못했습니다.");
      });
    },
    onChange(fn) {
      this.listeners.push(fn);
    },
    notify() {
      this.listeners.forEach((fn) => {
        try {
          fn(this.pending.length);
        } catch {
          /* ignore */
        }
      });
    },
    getCache(collection) {
      return idbGet(`cache:${collection}`);
    },
    setCache(collection, items) {
      return idbSet(`cache:${collection}`, items).catch(() => {});
    }
  };

  // ---------- fetch 대체 ----------
  async function apiFetch(path, options = {}) {
    const url = apiUrl();
    if (!url) return fakeResponse(500, { error: "config.js 에 API_URL(Apps Script 주소)을 입력해주세요." });
    const r = route(path, options.method);
    if (!r) return fakeResponse(404, { error: "API를 찾을 수 없습니다." });
    const code = (options.headers && options.headers["x-app-code"]) || "";

    let response;
    if (r.action === "health" || r.action === "list") {
      const query = new URLSearchParams({ action: r.action });
      if (r.collection) query.set("collection", r.collection);
      if (code) query.set("code", code);
      try {
        response = await fetch(`${url}?${query}`, { method: "GET", redirect: "follow" });
      } catch (error) {
        // 오프라인: 마지막으로 받아둔 데이터로 화면 표시
        if (r.action === "list") {
          const cached = await OfflineStore.getCache(r.collection);
          if (cached) return fakeResponse(200, { items: cached, fromCache: true });
        }
        throw error;
      }
    } else {
      const body = {
        action: r.action,
        collection: r.collection,
        id: r.id,
        code,
        data: options.body ? JSON.parse(options.body) : {}
      };
      // text/plain 으로 보내야 브라우저 CORS 사전요청 없이 Apps Script 로 전송됩니다.
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        redirect: "follow"
      });
    }

    const data = await response.json().catch(() => null);
    if (!data) return fakeResponse(502, { error: "서버 응답을 읽지 못했습니다. Apps Script 배포 설정(액세스: 모든 사용자)을 확인하세요." });
    const status = Number(data.status) || (data.ok ? 200 : 500);
    if (data.ok && r.action === "list") OfflineStore.setCache(r.collection, data.items || []);
    return fakeResponse(status, data);
  }

  window.apiFetch = apiFetch;
  window.OfflineStore = OfflineStore;
})();
