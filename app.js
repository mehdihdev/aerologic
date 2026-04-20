"use strict";

const GEOJSON_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";
const COUNTRY_API_URL = "https://restcountries.com/v3.1/all?fields=name,flag,altSpellings,cca2";

const STATUS = {
  VISA_FREE: "visa-free",
  EVISA: "evisa",
  VOA: "visa-on-arrival",
  VISA_REQUIRED: "visa-required",
  TRAVEL_BAN: "travel-ban"
};

const STATUS_COLORS = {
  [STATUS.VISA_FREE]: "rgba(32, 201, 122, 0.92)",
  [STATUS.EVISA]: "rgba(246, 172, 35, 0.94)",
  [STATUS.VOA]: "rgba(248, 190, 45, 0.94)",
  [STATUS.VISA_REQUIRED]: "rgba(248, 79, 112, 0.90)",
  [STATUS.TRAVEL_BAN]: "rgba(156, 16, 32, 0.97)"
};

// Unselected country base color on dark ocean globe
const OCEAN_COUNTRY_ALPHA = 0.72;

const STATUS_COPY = {
  [STATUS.VISA_FREE]: "Visa Free",
  [STATUS.EVISA]: "eVisa Required",
  [STATUS.VOA]: "Visa on Arrival",
  [STATUS.VISA_REQUIRED]: "Visa Required",
  [STATUS.TRAVEL_BAN]: "No Entry"
};

const STATUS_RANK = {
  [STATUS.TRAVEL_BAN]: 0,
  [STATUS.VISA_REQUIRED]: 1,
  [STATUS.VOA]: 2,
  [STATUS.EVISA]: 3,
  [STATUS.VISA_FREE]: 4
};

const API_STATUS_MAP = {
  "visa-free": STATUS.VISA_FREE,
  evisa: STATUS.EVISA,
  "visa-on-arrival": STATUS.VOA,
  "visa-required": STATUS.VISA_REQUIRED,
  "travel-ban": STATUS.TRAVEL_BAN
};

const NAME_ALIASES = {
  "United States of America": "United States",
  "Democratic Republic of the Congo": "DR Congo",
  "Northern Cyprus": "Cyprus",
  "Czech Republic": "Czechia",
  England: "United Kingdom",
  Macedonia: "North Macedonia",
  Somaliland: "",
  "West Bank": "Palestine"
};

// ISO-2 codes for all 26 Schengen Area members
const SCHENGEN_CODES = new Set([
  "AT","BE","CZ","DK","EE","FI","FR","DE","GR","HU",
  "IS","IT","LV","LI","LT","LU","MT","NL","NO","PL",
  "PT","SK","SI","ES","SE","CH"
]);

// Countries that honour a valid visa or PR card from a given issuing country.
// Each entry: { dest: ISO-2, status: STATUS.*, days: number|null }
const VISA_GRANTS = {
  // A valid US non-immigrant visa (B1/B2 or similar) unlocks these destinations
  US: [
    { dest: "AL", status: "visa-free",       days: 90  },  // Albania
    { dest: "AM", status: "visa-free",       days: null },  // Armenia
    { dest: "BA", status: "visa-free",       days: 30  },  // Bosnia & Herzegovina
    { dest: "CO", status: "visa-free",       days: 90  },  // Colombia
    { dest: "GE", status: "visa-free",       days: 365 },  // Georgia
    { dest: "MD", status: "visa-free",       days: 90  },  // Moldova
    { dest: "ME", status: "visa-free",       days: 30  },  // Montenegro
    { dest: "MK", status: "visa-free",       days: 90  },  // North Macedonia
    { dest: "MX", status: "visa-free",       days: 180 },  // Mexico
    { dest: "PA", status: "visa-free",       days: 180 },  // Panama
    { dest: "PE", status: "visa-free",       days: 183 },  // Peru
    { dest: "PH", status: "visa-on-arrival", days: 59  },  // Philippines (extended)
    { dest: "RS", status: "visa-free",       days: 30  },  // Serbia
  ],
  // A valid Schengen visa (any member state) unlocks these destinations
  SCHENGEN: [
    { dest: "AL", status: "visa-free",       days: 90  },
    { dest: "BA", status: "visa-free",       days: 30  },
    { dest: "GE", status: "visa-free",       days: 90  },
    { dest: "MD", status: "visa-free",       days: 90  },
    { dest: "ME", status: "visa-free",       days: 30  },
    { dest: "MK", status: "visa-free",       days: 90  },
    { dest: "RS", status: "visa-free",       days: 30  },
    { dest: "CO", status: "visa-free",       days: 90  },
    { dest: "PE", status: "visa-free",       days: 183 },
    { dest: "PA", status: "visa-free",       days: 180 },
  ],
  // UK Standard Visitor visa
  GB: [
    { dest: "GE", status: "visa-free",       days: 365 },
    { dest: "AL", status: "visa-free",       days: 90  },
    { dest: "BA", status: "visa-free",       days: 30  },
    { dest: "ME", status: "visa-free",       days: 30  },
    { dest: "MK", status: "visa-free",       days: 90  },
    { dest: "RS", status: "visa-free",       days: 30  },
    { dest: "CO", status: "visa-free",       days: 90  },
  ],
  // Canadian Temporary Resident Visa
  CA: [
    { dest: "GE", status: "visa-free",       days: 365 },
    { dest: "AL", status: "visa-free",       days: 90  },
    { dest: "MX", status: "visa-free",       days: 180 },
    { dest: "PH", status: "visa-on-arrival", days: 59  },
  ],
};

const DOCS_KEY = "aerologic-docs";
const ONBOARDED_KEY = "aerologic-onboarded";

function loadSavedDocuments() {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDocuments(docs) {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(docs));
  } catch {}
}

const AUTO_CLEAR_DOC_TYPES = new Set([
  "Passport",
  "Visa",
  "Permanent Resident",
  "Residence Permit",
  "OCI Card"
]);

const state = {
  countries: [],
  countryByName: new Map(),
  countryCodeByName: new Map(),
  countryNameByCode: new Map(),
  flagsByName: new Map(),
  selectedCountry: null,
  hoveredCountry: null,
  documents: [],
  nextDocId: 1,
  statusByCountry: new Map(),
  detailByCountry: new Map(),
  globe: null,
  loadingApiData: false,
  refreshRunId: 0
};

const elements = {
  globeRoot: document.getElementById("globe-root"),
  globeLoading: document.getElementById("globe-loading"),
  globalStatus: document.getElementById("global-status"),
  docList: document.getElementById("doc-list"),
  addDocumentBtn: document.getElementById("add-document-btn"),
  docModal: document.getElementById("doc-modal"),
  docForm: document.getElementById("doc-form"),
  docCountry: document.getElementById("doc-country"),
  docType: document.getElementById("doc-type"),
  cancelDoc: document.getElementById("cancel-doc"),
  countrySearch: document.getElementById("country-search"),
  searchResults: document.getElementById("search-results"),
  countryEmoji: document.getElementById("country-emoji"),
  countryName: document.getElementById("country-name"),
  entryPill: document.getElementById("entry-pill"),
  reqVisa: document.getElementById("req-visa"),
  reqValidity: document.getElementById("req-validity"),
  reqStay: document.getElementById("req-stay"),
  countryExplainer: document.getElementById("country-explainer")
};

function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function preferredCountryName(name) {
  return Object.prototype.hasOwnProperty.call(NAME_ALIASES, name) ? NAME_ALIASES[name] : name;
}

function getCountryFlag(countryName) {
  const aliased = preferredCountryName(countryName);
  if (!aliased) return "🌐";
  return state.flagsByName.get(normalizeName(aliased)) || "🌐";
}

function resolveCountryCode(countryName) {
  const direct = state.countryCodeByName.get(countryName);
  if (direct) return direct;
  const aliased = preferredCountryName(countryName);
  if (!aliased) return null;
  return state.countryCodeByName.get(aliased) || null;
}

function summarizeCounts() {
  const counts = {
    [STATUS.VISA_FREE]: 0,
    [STATUS.EVISA]: 0,
    [STATUS.VOA]: 0,
    [STATUS.VISA_REQUIRED]: 0,
    [STATUS.TRAVEL_BAN]: 0
  };
  state.statusByCountry.forEach((status) => {
    counts[status] += 1;
  });
  return counts;
}

function updateGlobalSummary() {
  const counts = summarizeCounts();
  const mixed = counts[STATUS.EVISA] + counts[STATUS.VOA];
  const loading = state.loadingApiData ? "Updating · " : "";
  elements.globalStatus.textContent = `${loading}${counts[STATUS.VISA_FREE]} visa-free · ${mixed} eVisa · ${counts[STATUS.VISA_REQUIRED]} required`;
}

function renderDocList() {
  elements.docList.innerHTML = state.documents
    .map((doc) => {
      const flag = getCountryFlag(doc.country);
      return `
        <div class="doc-item">
          <div class="doc-flag">${flag}</div>
          <div class="doc-main">
            <strong>${doc.country}</strong>
            <small>${doc.type}</small>
          </div>
          <button class="doc-remove" data-doc-id="${doc.id}" aria-label="Remove document">×</button>
        </div>
      `;
    })
    .join("");
}

function countryDetailsFromRecord(status, countryName) {
  const detail = state.detailByCountry.get(countryName);
  if (!detail) {
    return {
      visa: status === STATUS.VISA_FREE ? "Not Required" : "Visa Required",
      validity: "Check source",
      stay: "Varies",
      explanation: "Visa data unavailable right now. Try again in a moment."
    };
  }

  if (detail.sourceCode === "LOCAL_DOC") {
    return {
      visa: "Not Required",
      validity: "N/A",
      stay: "Resident Access",
      explanation: `Entry cleared — you hold a ${detail.documentType} for this country.`
    };
  }

  if (detail.sourceCode === "VISA_GRANT") {
    const dur = detail.durationDays;
    return {
      visa: "Not Required",
      validity: "Must be valid",
      stay: Number.isFinite(dur) ? `${dur} days` : "Varies",
      explanation: `Access granted because you hold a ${detail.grantingType} from ${detail.grantingCountry}. This country accepts it in lieu of a separate visa. Always verify current rules before travel.`
    };
  }

  const dur = detail.durationDays;
  const stayCopy = Number.isFinite(dur) ? `${dur} days` : "Varies";
  const validity =
    status === STATUS.VISA_FREE
      ? "3+ months"
      : status === STATUS.TRAVEL_BAN
        ? "N/A"
        : "6+ months";
  const sourcePassport = detail.passport?.name || "selected passport";
  const sourceVisa = detail.visa || "Visa Required";

  return {
    visa: sourceVisa,
    validity,
    stay: status === STATUS.TRAVEL_BAN ? "Banned" : stayCopy,
    explanation: `Based on visa data for ${sourcePassport} entering ${countryName}. Verify with destination embassy before travel.`
  };
}

function updateCountryPanel(countryName) {
  if (!countryName) {
    elements.countryEmoji.textContent = "🌍";
    elements.countryName.textContent = "Select a country";
    elements.entryPill.className = "entry-pill neutral";
    elements.entryPill.textContent = "Choose a destination on the globe";
    elements.reqVisa.textContent = "—";
    elements.reqValidity.textContent = "—";
    elements.reqStay.textContent = "—";
    elements.countryExplainer.textContent =
      "Add travel documents and click a country to see entry requirements.";
    return;
  }

  const status = state.statusByCountry.get(countryName) || STATUS.VISA_REQUIRED;
  const details = countryDetailsFromRecord(status, countryName);

  elements.countryEmoji.textContent = getCountryFlag(countryName);
  elements.countryName.textContent = countryName;
  elements.entryPill.className = `entry-pill ${status}`;
  elements.entryPill.textContent = STATUS_COPY[status];
  elements.reqVisa.textContent = details.visa;
  elements.reqValidity.textContent = details.validity;
  elements.reqStay.textContent = details.stay;
  elements.countryExplainer.textContent = details.explanation;
}

function populateCountrySelect() {
  const names = state.countries
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  elements.docCountry.innerHTML = names
    .map((name) => `<option value="${name}">${name}</option>`)
    .join("");
}

function initDefaultStatuses() {
  state.statusByCountry.clear();
  state.countries.forEach((country) => {
    state.statusByCountry.set(country.name, STATUS.VISA_REQUIRED);
  });
  updateGlobalSummary();
}

function isBetterStatus(candidate, current) {
  const candidateRank = STATUS_RANK[candidate] ?? -Infinity;
  const currentRank = STATUS_RANK[current] ?? -Infinity;
  return candidateRank > currentRank;
}

// Returns all visa-grant entries for a given issuing country code,
// including Schengen grants if the code is a Schengen member.
function getVisaGrants(code) {
  const grants = [...(VISA_GRANTS[code] || [])];
  if (SCHENGEN_CODES.has(code)) {
    grants.push(...(VISA_GRANTS.SCHENGEN || []));
  }
  return grants;
}

function applyDocumentOverrides() {
  state.documents.forEach((doc) => {
    const code = resolveCountryCode(doc.country);

    // 1. Mark issuing country as visa-free for passport / residency documents
    if (AUTO_CLEAR_DOC_TYPES.has(doc.type)) {
      let countryName = doc.country;
      if (!state.countryByName.has(countryName) && code && state.countryNameByCode.has(code)) {
        const mapped = state.countryNameByCode.get(code);
        if (state.countryByName.has(mapped)) countryName = mapped;
      }
      if (state.countryByName.has(countryName)) {
        state.statusByCountry.set(countryName, STATUS.VISA_FREE);
        state.detailByCountry.set(countryName, {
          status: STATUS.VISA_FREE,
          visa: "Not Required",
          durationDays: null,
          sourceCode: "LOCAL_DOC",
          sourceUpdatedAt: null,
          passport: null,
          destination: { name: countryName },
          documentType: doc.type
        });
      }
    }

    // 2. Apply visa-grant access for Visa and Permanent Resident documents
    if (doc.type !== "Visa" && doc.type !== "Permanent Resident") return;
    if (!code) return;

    getVisaGrants(code).forEach(({ dest, status, days }) => {
      const destName = state.countryNameByCode.get(dest);
      if (!destName) return;
      const existingDetail = state.detailByCountry.get(destName);
      if (existingDetail?.sourceCode === "LOCAL_DOC") return;
      const currentStatus = state.statusByCountry.get(destName) || STATUS.VISA_REQUIRED;
      if (!isBetterStatus(status, currentStatus)) return;

      state.statusByCountry.set(destName, status);
      state.detailByCountry.set(destName, {
        status,
        visa: status === STATUS.VISA_FREE ? "Not Required" : "Visa on Arrival",
        durationDays: days,
        sourceCode: "VISA_GRANT",
        sourceUpdatedAt: null,
        passport: null,
        destination: { name: destName },
        grantingCountry: doc.country,
        grantingType: doc.type
      });
    });
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

async function refreshStatusesFromApi() {
  const runId = state.refreshRunId + 1;
  state.refreshRunId = runId;

  const passportCodes = state.documents
    .filter((doc) => doc.type === "Passport")
    .map((doc) => resolveCountryCode(doc.country))
    .filter(Boolean);

  const activePassports = [...new Set(passportCodes)];
  if (!activePassports.length) {
    initDefaultStatuses();
    applyDocumentOverrides();
    updateGlobalSummary();
    updateCountryPanel(state.selectedCountry);
    return;
  }

  state.loadingApiData = true;
  state.detailByCountry.clear();
  initDefaultStatuses();
  applyDocumentOverrides();
  updateGlobalSummary();

  const destinationCodes = [
    ...new Set(
      state.countries
        .map((country) => resolveCountryCode(country.name))
        .filter(Boolean)
    )
  ];

  const codeToName = new Map();
  state.countries.forEach((country) => {
    const code = resolveCountryCode(country.name);
    if (code && !codeToName.has(code)) codeToName.set(code, country.name);
  });

  try {
    const chunkSize = 28;
    for (const passportCode of activePassports) {
      for (let i = 0; i < destinationCodes.length; i += chunkSize) {
        if (runId !== state.refreshRunId) return;

        const batch = destinationCodes.slice(i, i + chunkSize);
        let matrix = {};
        try {
          const payload = await fetchJson(
            `/api/visa-matrix?passport=${encodeURIComponent(passportCode)}&destinations=${encodeURIComponent(batch.join(","))}`
          );
          matrix = payload.matrix || {};
        } catch (error) {
          console.error("Visa matrix batch failed:", passportCode, error);
          continue;
        }

        Object.entries(matrix).forEach(([destinationCode, record]) => {
          const countryName = codeToName.get(destinationCode);
          if (!countryName) return;

          const existingDetail = state.detailByCountry.get(countryName);
          if (existingDetail?.sourceCode === "LOCAL_DOC") return;

          const candidateStatus = API_STATUS_MAP[record.status] || STATUS.VISA_REQUIRED;
          const currentStatus = state.statusByCountry.get(countryName) || STATUS.VISA_REQUIRED;
          if (!isBetterStatus(candidateStatus, currentStatus)) return;

          state.statusByCountry.set(countryName, candidateStatus);
          state.detailByCountry.set(countryName, {
            ...record,
            status: candidateStatus,
            viaPassport: passportCode
          });
        });

        applyDocumentOverrides();
        updateGlobalSummary();
        updateCountryPanel(state.selectedCountry);
      }
    }
  } finally {
    if (runId !== state.refreshRunId) return;
    applyDocumentOverrides();
    state.loadingApiData = false;
    updateGlobalSummary();
    updateCountryPanel(state.selectedCountry);
  }
}

function getCountryByPointer(clientX, clientY) {
  if (!state.globe) return null;
  const rect = state.globe.canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const coords = state.globe.projection.invert([x, y]);
  if (!coords) return null;

  for (let i = state.countries.length - 1; i >= 0; i -= 1) {
    const country = state.countries[i];
    if (d3.geoContains(country.feature, coords)) return country;
  }
  return null;
}

function shortestAngleDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function centerOnCountry(countryName, duration = 850) {
  if (!state.globe) return;
  const country = state.countryByName.get(countryName);
  if (!country) return;

  const start = state.globe.projection.rotate().slice();
  const targetLon = -country.lng;
  const targetLat = clamp(-country.lat, -85, 85);
  const target = [start[0] + shortestAngleDelta(start[0], targetLon), targetLat, 0];
  state.globe.rotationTransition = { start, target, startTs: performance.now(), duration };
}

function selectCountry(countryName, focus = true) {
  if (!state.countryByName.has(countryName)) return;
  state.selectedCountry = countryName;
  updateCountryPanel(countryName);
  if (focus) centerOnCountry(countryName);
}

function renderSearchResults(items) {
  if (!items.length) {
    elements.searchResults.classList.remove("show");
    elements.searchResults.innerHTML = "";
    return;
  }
  elements.searchResults.innerHTML = items
    .map((country) => `<li data-country="${country.name}">${country.name}</li>`)
    .join("");
  elements.searchResults.classList.add("show");
}

function wireSearch() {
  const all = state.countries
    .map((country) => country.name)
    .sort((a, b) => a.localeCompare(b));

  elements.countrySearch.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    if (!query) {
      renderSearchResults([]);
      return;
    }
    const hits = all
      .filter((name) => name.toLowerCase().includes(query))
      .slice(0, 10)
      .map((name) => ({ name }));
    renderSearchResults(hits);
  });

  elements.countrySearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const first = elements.searchResults.querySelector("li[data-country]");
    if (!first) return;
    event.preventDefault();
    selectCountry(first.dataset.country, true);
    elements.countrySearch.value = first.dataset.country;
    renderSearchResults([]);
  });

  elements.countrySearch.addEventListener("blur", () =>
    setTimeout(() => renderSearchResults([]), 120)
  );

  elements.searchResults.addEventListener("click", (event) => {
    const item = event.target.closest("li[data-country]");
    if (!item) return;
    const name = item.dataset.country;
    selectCountry(name, true);
    elements.countrySearch.value = name;
    renderSearchResults([]);
  });
}

function wireDocuments() {
  elements.addDocumentBtn.addEventListener("click", () => {
    elements.docModal.showModal();
  });

  elements.cancelDoc.addEventListener("click", () => elements.docModal.close());
  document.getElementById("cancel-doc-footer").addEventListener("click", () =>
    elements.docModal.close()
  );

  elements.docForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.documents.push({
      id: state.nextDocId,
      country: elements.docCountry.value,
      type: elements.docType.value
    });
    state.nextDocId += 1;
    elements.docModal.close();
    renderDocList();
    saveDocuments(state.documents);
    await refreshStatusesFromApi();
  });

  elements.docList.addEventListener("click", async (event) => {
    const removeButton = event.target.closest("button[data-doc-id]");
    if (!removeButton) return;
    const docId = Number(removeButton.dataset.docId);
    state.documents = state.documents.filter((doc) => doc.id !== docId);
    renderDocList();
    saveDocuments(state.documents);
    await refreshStatusesFromApi();
  });
}

function wireOnboarding() {
  const overlay = document.getElementById("onboarding");
  const searchInput = document.getElementById("onboard-search");
  const searchResults = document.getElementById("onboard-results");
  const typeSelect = document.getElementById("onboard-type");
  const docListEl = document.getElementById("onboard-doc-list");
  const startBtn = document.getElementById("onboard-start");
  const skipBtn = document.getElementById("onboard-skip");

  const allNames = state.countries.map((c) => c.name).sort((a, b) => a.localeCompare(b));
  const tempDocs = [];
  let tempNextId = 1;

  function renderResults(items) {
    if (!items.length) { searchResults.classList.remove("show"); searchResults.innerHTML = ""; return; }
    searchResults.innerHTML = items.map((n) => `<li data-name="${n}">${n}</li>`).join("");
    searchResults.classList.add("show");
  }

  function renderChips() {
    docListEl.innerHTML = tempDocs
      .map((doc) => {
        const flag = getCountryFlag(doc.country);
        return `<div class="onboard-chip">
          <span class="onboard-chip-flag">${flag}</span>
          <span>${doc.country} · ${doc.type}</span>
          <button class="onboard-chip-remove" data-id="${doc.id}" aria-label="Remove">×</button>
        </div>`;
      })
      .join("");
    startBtn.disabled = tempDocs.length === 0;
  }

  function addDoc(countryName) {
    const type = typeSelect.value;
    if (tempDocs.some((d) => d.country === countryName && d.type === type)) return;
    tempDocs.push({ id: tempNextId++, country: countryName, type });
    renderChips();
    searchInput.value = "";
    renderResults([]);
  }

  searchInput.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { renderResults([]); return; }
    renderResults(allNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 10));
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = searchResults.querySelector("li[data-name]");
    if (!first) return;
    e.preventDefault();
    addDoc(first.dataset.name);
  });

  searchInput.addEventListener("blur", () => setTimeout(() => renderResults([]), 120));

  searchResults.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-name]");
    if (li) addDoc(li.dataset.name);
  });

  docListEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-id]");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    tempDocs.splice(tempDocs.findIndex((d) => d.id === id), 1);
    renderChips();
  });

  startBtn.addEventListener("click", () => {
    state.documents = [...tempDocs];
    state.nextDocId = tempNextId;
    saveDocuments(state.documents);
    localStorage.setItem(ONBOARDED_KEY, "1");
    overlay.classList.add("hidden");
    renderDocList();
    refreshStatusesFromApi();
  });

  skipBtn.addEventListener("click", () => {
    localStorage.setItem(ONBOARDED_KEY, "1");
    overlay.classList.add("hidden");
  });
}

function initGlobe() {
  const canvas = document.createElement("canvas");
  elements.globeRoot.replaceChildren(canvas);
  const context = canvas.getContext("2d");
  const projection = d3.geoOrthographic().precision(0.1).clipAngle(90);
  const path = d3.geoPath(projection, context);
  const graticule = d3.geoGraticule10();

  state.globe = {
    canvas,
    context,
    projection,
    path,
    graticule,
    dragState: null,
    autoRotate: true,
    rotationTransition: null,
    lastFrame: performance.now(),
    zoomLevel: 1.0,
    baseScale: 0
  };

  function applyZoom() {
    projection.scale(state.globe.baseScale * state.globe.zoomLevel);
  }

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.globe.baseScale = Math.min(width, height) * 0.42;
    projection.translate([width / 2, height / 2]);
    applyZoom();
  }

  resize();
  window.addEventListener("resize", resize);

  // Scroll-wheel zoom
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.08 : 0.93;
    state.globe.zoomLevel = clamp(state.globe.zoomLevel * factor, 0.5, 12);
    applyZoom();
    state.globe.autoRotate = false;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => { state.globe.autoRotate = true; }, 2400);
  }, { passive: false });

  // Pinch-to-zoom
  let pinchStartDist = null;
  let pinchStartZoom = null;

  canvas.addEventListener("touchstart", (event) => {
    if (event.touches.length === 2) {
      pinchStartDist = Math.hypot(
        event.touches[0].clientX - event.touches[1].clientX,
        event.touches[0].clientY - event.touches[1].clientY
      );
      pinchStartZoom = state.globe.zoomLevel;
    }
  }, { passive: true });

  canvas.addEventListener("touchmove", (event) => {
    if (event.touches.length !== 2 || pinchStartDist === null) return;
    event.preventDefault();
    const dist = Math.hypot(
      event.touches[0].clientX - event.touches[1].clientX,
      event.touches[0].clientY - event.touches[1].clientY
    );
    state.globe.zoomLevel = clamp(pinchStartZoom * (dist / pinchStartDist), 0.5, 12);
    applyZoom();
  }, { passive: false });

  canvas.addEventListener("touchend", (event) => {
    if (event.touches.length < 2) { pinchStartDist = null; pinchStartZoom = null; }
  });

  let restartTimer = null;

  canvas.addEventListener("pointerdown", (event) => {
    const rot = projection.rotate();
    state.globe.dragState = {
      x: event.clientX,
      y: event.clientY,
      lon: rot[0],
      lat: rot[1],
      moved: false
    };
    state.globe.autoRotate = false;
    if (restartTimer) clearTimeout(restartTimer);
    canvas.classList.add("dragging");
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.globe.dragState) {
      const hovered = getCountryByPointer(event.clientX, event.clientY);
      state.hoveredCountry = hovered ? hovered.name : null;
      canvas.style.cursor = hovered ? "pointer" : "grab";
      return;
    }
    const dx = event.clientX - state.globe.dragState.x;
    const dy = event.clientY - state.globe.dragState.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) state.globe.dragState.moved = true;
    // Divide by zoomLevel so drag speed stays consistent at any zoom
    const sensitivity = 0.33 / state.globe.zoomLevel;
    projection.rotate([
      state.globe.dragState.lon + dx * sensitivity,
      clamp(state.globe.dragState.lat - dy * sensitivity, -85, 85),
      0
    ]);
  });

  canvas.addEventListener("pointerup", (event) => {
    if (!state.globe.dragState) return;
    const moved = state.globe.dragState.moved;
    state.globe.dragState = null;
    canvas.classList.remove("dragging");
    canvas.releasePointerCapture(event.pointerId);

    if (!moved) {
      const country = getCountryByPointer(event.clientX, event.clientY);
      if (country) selectCountry(country.name, true);
    }

    restartTimer = setTimeout(() => {
      state.globe.autoRotate = true;
    }, 2400);
  });
}

function isVisible([lon, lat]) {
  const rotate = state.globe.projection.rotate();
  const center = [-rotate[0], -rotate[1]];
  return d3.geoDistance([lon, lat], center) < Math.PI / 2;
}

function drawCountryDots(timestamp) {
  const pulse = (Math.sin(timestamp * 0.006) + 1) / 2;
  const { context, projection } = state.globe;
  state.countries.forEach((country) => {
    if (!isVisible([country.lng, country.lat])) return;
    const point = projection([country.lng, country.lat]);
    if (!point) return;
    const status = state.statusByCountry.get(country.name) || STATUS.VISA_REQUIRED;
    const isSelected = country.name === state.selectedCountry;
    const isHovered = country.name === state.hoveredCountry;
    const radius = isSelected ? 3.8 + pulse : 2.0;

    context.beginPath();
    context.fillStyle = STATUS_COLORS[status];
    context.globalAlpha = isHovered ? 1 : 0.9;
    context.arc(point[0], point[1], radius, 0, Math.PI * 2);
    context.fill();

    if (isSelected || isHovered) {
      context.beginPath();
      context.globalAlpha = 0.22 + pulse * 0.18;
      context.arc(point[0], point[1], radius + 5 + pulse * 2, 0, Math.PI * 2);
      context.fill();
    }
  });
  context.globalAlpha = 1;
}

function drawRoutes(timestamp) {
  if (!state.selectedCountry) return;
  const destination = state.countryByName.get(state.selectedCountry);
  if (!destination) return;
  const { context, projection } = state.globe;
  const status = state.statusByCountry.get(state.selectedCountry) || STATUS.VISA_REQUIRED;
  const color = STATUS_COLORS[status];

  const passportDocs = state.documents
    .filter((doc) => doc.type === "Passport")
    .map((doc) => state.countryByName.get(doc.country))
    .filter(Boolean);

  passportDocs.forEach((source, index) => {
    const interpolate = d3.geoInterpolate(
      [source.lng, source.lat],
      [destination.lng, destination.lat]
    );
    context.save();
    context.beginPath();
    let started = false;
    for (let i = 0; i <= 30; i += 1) {
      const point = interpolate(i / 30);
      if (!isVisible(point)) continue;
      const projected = projection(point);
      if (!projected) continue;
      if (!started) {
        context.moveTo(projected[0], projected[1]);
        started = true;
      } else {
        context.lineTo(projected[0], projected[1]);
      }
    }
    context.strokeStyle = color;
    context.lineWidth = 1.2;
    context.setLineDash([5, 9]);
    context.lineDashOffset = -(timestamp * 0.055 + index * 8);
    context.globalAlpha = 0.55;
    context.stroke();
    context.restore();
  });
  context.setLineDash([]);
}

function drawCountries() {
  const { context, path } = state.globe;
  state.countries.forEach((country) => {
    const status = state.statusByCountry.get(country.name) || STATUS.VISA_REQUIRED;
    const isSelected = country.name === state.selectedCountry;
    const isHovered = country.name === state.hoveredCountry;
    context.beginPath();
    path(country.feature);
    context.fillStyle = STATUS_COLORS[status];
    context.globalAlpha = isSelected ? 0.97 : OCEAN_COUNTRY_ALPHA;
    context.fill();
    context.lineWidth = isSelected ? 1.2 : 0.5;
    context.strokeStyle = isHovered
      ? "rgba(255, 255, 255, 0.65)"
      : isSelected
        ? "rgba(255, 255, 255, 0.5)"
        : "rgba(255, 255, 255, 0.1)";
    context.stroke();
  });
  context.globalAlpha = 1;
}

function drawFrame(timestamp) {
  const globe = state.globe;
  if (!globe) return;

  const { context, projection, path } = globe;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const radius = projection.scale();
  const [cx, cy] = projection.translate();
  const dt = Math.min(64, timestamp - globe.lastFrame);
  globe.lastFrame = timestamp;

  if (globe.rotationTransition) {
    const { start, target, startTs, duration } = globe.rotationTransition;
    const t = clamp((timestamp - startTs) / duration, 0, 1);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const lon = start[0] + shortestAngleDelta(start[0], target[0]) * eased;
    const lat = start[1] + (target[1] - start[1]) * eased;
    projection.rotate([lon, lat, 0]);
    if (t >= 1) globe.rotationTransition = null;
  } else if (!globe.dragState && globe.autoRotate) {
    const current = projection.rotate();
    projection.rotate([current[0] + dt * 0.0038, current[1], 0]);
  }

  context.clearRect(0, 0, width, height);

  // Atmosphere glow (outside sphere)
  const atmo = context.createRadialGradient(cx, cy, radius * 0.88, cx, cy, radius * 1.12);
  atmo.addColorStop(0, "rgba(40, 90, 220, 0)");
  atmo.addColorStop(0.6, "rgba(30, 70, 180, 0.06)");
  atmo.addColorStop(1, "rgba(20, 50, 140, 0.0)");
  context.beginPath();
  context.arc(cx, cy, radius * 1.12, 0, Math.PI * 2);
  context.fillStyle = atmo;
  context.fill();

  // Ocean gradient — dark blue
  const oceanGrad = context.createRadialGradient(
    cx - radius * 0.32,
    cy - radius * 0.28,
    radius * 0.08,
    cx,
    cy,
    radius * 1.02
  );
  oceanGrad.addColorStop(0, "#1e3c6e");
  oceanGrad.addColorStop(0.4, "#0f2040");
  oceanGrad.addColorStop(1, "#060d1c");

  context.beginPath();
  path({ type: "Sphere" });
  context.fillStyle = oceanGrad;
  context.fill();

  // Graticule grid
  context.beginPath();
  path(globe.graticule);
  context.strokeStyle = "rgba(70, 110, 200, 0.16)";
  context.lineWidth = 0.5;
  context.stroke();

  drawCountries();
  drawRoutes(timestamp);
  drawCountryDots(timestamp);

  // Sphere border
  context.beginPath();
  path({ type: "Sphere" });
  context.lineWidth = 1.2;
  context.strokeStyle = "rgba(25, 60, 140, 0.75)";
  context.stroke();

  requestAnimationFrame(drawFrame);
}

async function loadCountryMetadata() {
  const list = await fetchJson(COUNTRY_API_URL);
  list.forEach((country) => {
    const common = country?.name?.common;
    const code = country?.cca2;
    const flag = country?.flag;
    if (common && code) {
      state.countryCodeByName.set(common, code);
      state.countryNameByCode.set(code, common);
    }
    if (common && flag) state.flagsByName.set(normalizeName(common), flag);
    if (Array.isArray(country?.altSpellings)) {
      country.altSpellings.forEach((alias) => {
        if (flag) state.flagsByName.set(normalizeName(alias), flag);
        if (code) state.countryCodeByName.set(alias, code);
      });
    }
  });
}

function buildCountries(topology) {
  const countriesFeature = topojson.feature(topology, topology.objects.countries);
  const blocked = new Set(["Antarctica", "French Southern and Antarctic Lands"]);
  state.countries = countriesFeature.features
    .filter((feature) => feature?.properties?.name && !blocked.has(feature.properties.name))
    .map((feature) => {
      const [lng, lat] = d3.geoCentroid(feature);
      return { name: feature.properties.name, lng, lat, feature };
    });
  state.countryByName = new Map(state.countries.map((country) => [country.name, country]));
}

async function init() {
  try {
    const [topology] = await Promise.all([fetchJson(GEOJSON_URL), loadCountryMetadata()]);
    buildCountries(topology);
    populateCountrySelect();
    initDefaultStatuses();
    updateCountryPanel(null);
    initGlobe();
    wireSearch();
    wireDocuments();
    selectCountry("Germany", true);
    elements.globeLoading.classList.add("hidden");
    requestAnimationFrame(drawFrame);

    const isOnboarded = localStorage.getItem(ONBOARDED_KEY);
    if (isOnboarded) {
      const saved = loadSavedDocuments();
      if (saved && saved.length > 0) {
        state.documents = saved;
        state.nextDocId = Math.max(...saved.map((d) => d.id)) + 1;
      }
      renderDocList();
      await refreshStatusesFromApi();
    } else {
      wireOnboarding();
      document.getElementById("onboarding").classList.remove("hidden");
    }
  } catch (error) {
    elements.globeLoading.textContent = `Could not initialize: ${error?.message || error}`;
  }
}

init();
