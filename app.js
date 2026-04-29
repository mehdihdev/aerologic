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
const DEMO_DEFAULT_COUNTRY = "Germany";
const DEMO_DESTINATIONS = ["Germany", "Japan", "India", "Brazil", "United Arab Emirates"];
const DEMO_DOCUMENTS = Object.freeze([
  { country: "United States", type: "Passport", expirationDate: null }
]);

// Initialized once config is fetched from /api/config
let supabaseClient = null;

async function initSupabase() {
  try {
    const config = await fetchJson("/api/config", 5000);
    if (config?.supabaseUrl && config?.supabaseAnonKey && window.supabase) {
      supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    }
  } catch {
    // Supabase unavailable — fall back to localStorage-only mode
  }
}

async function loadDocsFromSupabase(userId) {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient
    .from("travel_documents")
    .select("*")
    .eq("user_id", userId)
    .order("created_at");
  if (error || !data) return null;
  return data.map((row, i) => ({
    id: i + 1,
    country: row.country,
    type: row.type,
    expirationDate: row.expiration_date || null
  }));
}

async function saveDocsToSupabase(userId, docs) {
  if (!supabaseClient) return;
  await supabaseClient.from("travel_documents").delete().eq("user_id", userId);
  if (!docs.length) return;
  await supabaseClient.from("travel_documents").insert(
    docs.map((doc) => ({
      user_id: userId,
      country: doc.country,
      type: doc.type,
      expiration_date: doc.expirationDate || null
    }))
  );
}

async function syncDocsToSupabase() {
  if (!supabaseClient) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) await saveDocsToSupabase(session.user.id, state.documents);
  } catch {}
}

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
  refreshRunId: 0,
  currentUser: null,  // Supabase user object when signed in
  isDemoMode: false
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
      const meta = state.isDemoMode ? `${doc.type} · Demo` : doc.type;
      return `
        <div class="doc-item">
          <div class="doc-flag">${flag}</div>
          <div class="doc-main">
            <strong>${doc.country}</strong>
            <small>${meta}</small>
          </div>
          ${state.isDemoMode ? "" : `<button class="doc-remove" data-doc-id="${doc.id}" aria-label="Remove document">×</button>`}
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

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, timeoutMs = 10000, retries = 4) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fetchJson(url, timeoutMs);
    } catch (err) {
      if (attempt === retries - 1) throw err;
      elements.globeLoading.querySelector("span.loading-spinner") && (
        elements.globeLoading.lastChild.textContent = ` Retrying… (${attempt + 2}/${retries})`
      );
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
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
  if (state.isDemoMode) syncLandingSearchValue(countryName);
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
    if (state.isDemoMode) {
      startOnboardingFromLanding();
      return;
    }
    openDocModalAdd();
  });

  elements.cancelDoc.addEventListener("click", () => elements.docModal.close());
  document.getElementById("cancel-doc-footer").addEventListener("click", () =>
    elements.docModal.close()
  );

  elements.docForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const editId = document.getElementById("doc-edit-id").value;

    if (editId) {
      // Edit mode: update existing doc
      const doc = state.documents.find((d) => d.id === Number(editId));
      if (doc) {
        doc.country = elements.docCountry.value;
        doc.type    = elements.docType.value;
      }
    } else {
      // Add mode: push new doc
      state.documents.push({
        id: state.nextDocId,
        country: elements.docCountry.value,
        type: elements.docType.value
      });
      state.nextDocId += 1;
    }

    elements.docModal.close();
    renderDocList();
    renderProfileDocs();
    saveDocuments(state.documents);
    syncDocsToSupabase();
    await refreshStatusesFromApi();
  });

  elements.docList.addEventListener("click", async (event) => {
    if (state.isDemoMode) return;
    const removeButton = event.target.closest("button[data-doc-id]");
    if (!removeButton) return;
    const docId = Number(removeButton.dataset.docId);
    state.documents = state.documents.filter((doc) => doc.id !== docId);
    renderDocList();
    renderProfileDocs();
    saveDocuments(state.documents);
    syncDocsToSupabase();
    await refreshStatusesFromApi();
  });
}

// Guards to prevent double-wiring
let _searchWired = false, _documentsWired = false, _profileWired = false, _mainGlobeStarted = false;
let _landingWired = false;
let _landingSearchWired = false;
let _onboardingWired = false;
let _startingOnboarding = false;
let _onboardingSource = null;
let _onboardingMode = "signup";
let _demoDestinationIndex = 1;
let _resetOnboardingUI = null;

function getGlobeViewportConfig() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  if (!state.isDemoMode) {
    return {
      translate: [width / 2, height / 2],
      scale: Math.min(width, height) * 0.42,
      zoomLevel: null
    };
  }

  const isHowView = document.body.classList.contains("demo-mode-how");
  const isMobile = width <= 768;

  if (isHowView) {
    return {
      translate: isMobile ? [width * 0.52, height * 0.8] : [width * 0.78, height * 0.57],
      scale: Math.min(width, height) * (isMobile ? 0.54 : 0.61),
      zoomLevel: 1
    };
  }

  return {
    translate: [width * 0.5, height * (isMobile ? 0.8 : 0.84)],
    scale: Math.min(width, height) * (isMobile ? 0.56 : 0.58),
    zoomLevel: 1
  };
}

function updateGlobeViewportLayout() {
  if (!state.globe?.applyViewportLayout) return;
  state.globe.applyViewportLayout();
}

function syncLandingSearchValue(value = "") {
  const input = document.getElementById("landing-country-search");
  if (input) input.value = value;
}

function getDemoDocuments() {
  return DEMO_DOCUMENTS.map((doc, index) => ({
    id: index + 1,
    country: doc.country,
    type: doc.type,
    expirationDate: doc.expirationDate
  }));
}

function setLandingView(view) {
  const isHowView = view === "how";
  document.getElementById("landing-home-view")?.classList.toggle("hidden", isHowView);
  document.getElementById("landing-how-view")?.classList.toggle("hidden", !isHowView);
  document.getElementById("landing-tab-home")?.classList.toggle("landing-tab--active", !isHowView);
  document.getElementById("landing-tab-how")?.classList.toggle("landing-tab--active", isHowView);
  document.body.classList.toggle("demo-mode-how", state.isDemoMode && isHowView);
  updateGlobeViewportLayout();
  if (isHowView) {
    const howContent = document.querySelector(".lhow-content");
    if (howContent) howContent.scrollTop = 0;
  }
}

function enterDemoMode() {
  state.isDemoMode = true;
  document.body.classList.add("demo-mode");
  renderDocList();
  renderProfileDocs();
  setLandingView("home");
  updateGlobeViewportLayout();
  document.getElementById("landing").classList.remove("hidden");
}

function exitDemoMode({ clearDocuments = false } = {}) {
  state.isDemoMode = false;
  document.body.classList.remove("demo-mode", "demo-mode-how");
  updateGlobeViewportLayout();
  if (clearDocuments) {
    state.documents = [];
    state.nextDocId = 1;
    renderDocList();
    renderProfileDocs();
  }
}

function seedDemoDocuments() {
  _demoDestinationIndex = 1;
  state.documents = getDemoDocuments();
  state.nextDocId = state.documents.length + 1;
  renderDocList();
  renderProfileDocs();
  syncLandingSearchValue("");
}

function focusNextDemoDestination() {
  if (!state.isDemoMode) return;
  const countryName = DEMO_DESTINATIONS[_demoDestinationIndex % DEMO_DESTINATIONS.length];
  _demoDestinationIndex += 1;
  setLandingView("home");
  selectCountry(countryName, true);
}

function startOnboardingFromLanding() {
  if (_startingOnboarding) return;
  _startingOnboarding = true;
  document.getElementById("landing").classList.add("hidden");
  exitDemoMode({ clearDocuments: true });
  showOnboarding("landing", "signup");
}

function wireLanding() {
  if (_landingWired) return;
  _landingWired = true;

  document.getElementById("landing-brand")?.addEventListener("click", () => setLandingView("home"));
  document.getElementById("landing-tab-home")?.addEventListener("click", () => setLandingView("home"));
  document.getElementById("landing-tab-how")?.addEventListener("click", () => setLandingView("how"));

  ["landing-signup", "landing-try-free", "landing-cta-btn"]
    .forEach((id) => document.getElementById(id)?.addEventListener("click", startOnboardingFromLanding));
  document.getElementById("landing-login")?.addEventListener("click", () => {
    if (_startingOnboarding) return;
    _startingOnboarding = true;
    document.getElementById("landing").classList.add("hidden");
    exitDemoMode({ clearDocuments: true });
    showOnboarding("landing", "login");
  });

  wireLandingSearch();
}

function wireLandingSearch() {
  if (_landingSearchWired) return;
  _landingSearchWired = true;

  const input = document.getElementById("landing-country-search");
  const results = document.getElementById("landing-country-results");
  if (!input || !results) return;

  const allNames = state.countries
    .map((country) => country.name)
    .sort((a, b) => a.localeCompare(b));

  function renderResults(items) {
    if (!items.length) {
      results.classList.remove("show");
      results.innerHTML = "";
      return;
    }
    results.innerHTML = items
      .map((name) => `<li data-country="${name}">${name}</li>`)
      .join("");
    results.classList.add("show");
  }

  function commitSelection(countryName) {
    if (!state.countryByName.has(countryName)) return;
    setLandingView("home");
    syncLandingSearchValue(countryName);
    renderResults([]);
    selectCountry(countryName, true);
  }

  function findMatches(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return allNames
      .filter((name) => name.toLowerCase().includes(normalized))
      .slice(0, 8);
  }

  input.addEventListener("input", (event) => {
    renderResults(findMatches(event.target.value));
  });

  input.addEventListener("focus", (event) => {
    renderResults(findMatches(event.target.value));
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();

    const query = input.value.trim();
    const exactMatch = allNames.find((name) => name.toLowerCase() === query.toLowerCase());
    if (exactMatch) {
      commitSelection(exactMatch);
      return;
    }

    const first = results.querySelector("li[data-country]");
    if (first) commitSelection(first.dataset.country);
  });

  input.addEventListener("blur", () => {
    window.setTimeout(() => renderResults([]), 120);
  });

  results.addEventListener("click", (event) => {
    const item = event.target.closest("li[data-country]");
    if (!item) return;
    commitSelection(item.dataset.country);
  });
}

function showOnboarding(source = "landing", mode = "signup") {
  _onboardingSource = source;
  _onboardingMode = mode;
  wireOnboarding();
  document.body.classList.add("onboarding-open");
  document.getElementById("onboarding").classList.remove("hidden");
}

async function returnToLandingFromOnboarding() {
  if (supabaseClient) {
    try {
      await supabaseClient.auth.signOut();
    } catch {}
  }
  state.currentUser = null;
  setAvatarInitial(null);
  localStorage.removeItem(ONBOARDED_KEY);
  localStorage.removeItem(DOCS_KEY);
  state.documents = [];
  state.nextDocId = 1;
  document.getElementById("onboarding").classList.add("hidden");
  document.body.classList.remove("onboarding-open");
  _onboardingSource = null;
  _onboardingMode = "signup";
  _startingOnboarding = false;
  seedDemoDocuments();
  renderDocList();
  renderProfileDocs();
  await refreshStatusesFromApi();
  selectCountry(DEMO_DEFAULT_COUNTRY, true);
  enterDemoMode();
  wireLanding();
}

function setAvatarInitial(user) {
  const initial = user
    ? (user.user_metadata?.display_name || user.email || "?")[0].toUpperCase()
    : null;

  ["profile-btn", "prof-close-btn"].forEach((btnId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const iconEl    = btn.querySelector("svg");
    const initialEl = btn.querySelector(".avatar-initial");
    if (!iconEl || !initialEl) return;
    if (initial) {
      iconEl.classList.add("hidden");
      initialEl.textContent = initial;
      initialEl.classList.remove("hidden");
    } else {
      iconEl.classList.remove("hidden");
      initialEl.classList.add("hidden");
    }
  });

  const lgEl = document.getElementById("prof-avatar-lg");
  if (lgEl) {
    if (initial) {
      lgEl.innerHTML = initial;
      lgEl.style.fontSize = "2.2rem";
    } else {
      lgEl.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="36" height="36" aria-hidden="true"><path d="M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-6 8a6 6 0 0 1 12 0H4z"/></svg>`;
    }
  }
}

function renderProfileDocs() {
  const container = document.getElementById("prof-doc-rows");
  if (!container) return;
  if (!state.documents.length) {
    container.innerHTML = `<p style="font-size:13px;color:rgba(255,255,255,0.35);padding:14px 0;">No documents added yet.</p>`;
    return;
  }
  container.innerHTML = state.documents.map((doc) => {
    const code = resolveCountryCode(doc.country);
    const flagHtml = code
      ? `<img src="https://flagcdn.com/w40/${code.toLowerCase()}.png" class="prof-doc-flag-img" alt="${doc.country}" onerror="this.style.display='none'">`
      : `<span class="prof-doc-flag-emoji">${getCountryFlag(doc.country)}</span>`;
    return `<div class="prof-doc-row">
      ${flagHtml}
      <div class="prof-doc-body">
        <strong>${doc.country}</strong>
        <small>${doc.type}</small>
      </div>
      <button class="prof-edit-icon-btn" data-edit-id="${doc.id}" aria-label="Edit document" title="Edit">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
          <path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L6 17l-4 1 1-4L13.5 3.5z"/>
        </svg>
      </button>
    </div>`;
  }).join("");
}

function openDocModalAdd() {
  document.getElementById("doc-edit-id").value = "";
  document.getElementById("doc-modal-title").textContent = "Add Document";
  document.getElementById("doc-submit-btn").textContent = "Save Document";
  document.getElementById("doc-country").value = "";
  document.getElementById("doc-type").value = "Passport";
  document.getElementById("doc-modal").showModal();
}

function openDocModalEdit(docId) {
  const doc = state.documents.find((d) => d.id === docId);
  if (!doc) return;
  document.getElementById("doc-edit-id").value = String(docId);
  document.getElementById("doc-modal-title").textContent = "Edit Document";
  document.getElementById("doc-submit-btn").textContent = "Update Document";
  document.getElementById("doc-country").value = doc.country;
  document.getElementById("doc-type").value = doc.type;
  document.getElementById("doc-modal").showModal();
}

function wireProfile() {
  const overlay = document.getElementById("profile-overlay");
  const profileBtn = document.getElementById("profile-btn");
  const closeBtn = document.getElementById("prof-close-btn");

  function openProfile() {
    // Populate user info
    const user = state.currentUser;
    const isLoggedIn = Boolean(user);

    document.getElementById("prof-account-rows").style.display  = isLoggedIn ? "" : "none";
    document.getElementById("prof-not-signed-in").classList.toggle("hidden", isLoggedIn);
    document.getElementById("prof-signout-row").style.display   = isLoggedIn ? "" : "none";

    if (isLoggedIn) {
      const name  = user.user_metadata?.display_name || "";
      const email = user.email || "";
      document.getElementById("prof-name-val").textContent  = name  || "—";
      document.getElementById("prof-email-val").textContent = email || "—";
    }

    renderProfileDocs();
    overlay.classList.remove("hidden");
  }

  function closeProfile() { overlay.classList.add("hidden"); }

  profileBtn.addEventListener("click", openProfile);
  closeBtn.addEventListener("click", closeProfile);

  // Sign in prompt from profile (redirect to onboarding)
  document.getElementById("prof-signin-prompt")?.addEventListener("click", () => {
    closeProfile();
    localStorage.removeItem(ONBOARDED_KEY);
    showOnboarding("profile", "login");
  });

  // ── Inline edits ────────────────────────────────────

  function toggleInlineEdit(rowId, editId, show) {
    document.getElementById(rowId).style.display = show ? "none" : "";
    document.getElementById(editId).classList.toggle("hidden", !show);
  }

  // Name
  document.getElementById("prof-change-name").addEventListener("click", () => {
    document.getElementById("prof-name-input").value =
      state.currentUser?.user_metadata?.display_name || "";
    toggleInlineEdit("prof-row-name", "prof-edit-name", true);
  });
  document.getElementById("prof-name-cancel").addEventListener("click", () =>
    toggleInlineEdit("prof-row-name", "prof-edit-name", false)
  );
  document.getElementById("prof-name-save").addEventListener("click", async () => {
    const val = document.getElementById("prof-name-input").value.trim();
    const errEl = document.getElementById("prof-name-error");
    if (!val) { errEl.textContent = "Name cannot be empty."; errEl.classList.remove("hidden"); return; }
    errEl.classList.add("hidden");
    if (supabaseClient) {
      const { error } = await supabaseClient.auth.updateUser({ data: { display_name: val } });
      if (error) { errEl.textContent = error.message; errEl.classList.remove("hidden"); return; }
    }
    if (state.currentUser) state.currentUser.user_metadata = { ...state.currentUser.user_metadata, display_name: val };
    document.getElementById("prof-name-val").textContent = val;
    setAvatarInitial(state.currentUser);
    toggleInlineEdit("prof-row-name", "prof-edit-name", false);
  });

  // Email
  document.getElementById("prof-change-email").addEventListener("click", () => {
    document.getElementById("prof-email-input").value = state.currentUser?.email || "";
    toggleInlineEdit("prof-row-email", "prof-edit-email", true);
  });
  document.getElementById("prof-email-cancel").addEventListener("click", () =>
    toggleInlineEdit("prof-row-email", "prof-edit-email", false)
  );
  document.getElementById("prof-email-save").addEventListener("click", async () => {
    const val = document.getElementById("prof-email-input").value.trim();
    const errEl = document.getElementById("prof-email-error");
    if (!val) { errEl.textContent = "Email cannot be empty."; errEl.classList.remove("hidden"); return; }
    errEl.classList.add("hidden");
    if (supabaseClient) {
      const { error } = await supabaseClient.auth.updateUser({ email: val });
      if (error) { errEl.textContent = error.message; errEl.classList.remove("hidden"); return; }
    }
    document.getElementById("prof-email-val").textContent = val;
    toggleInlineEdit("prof-row-email", "prof-edit-email", false);
  });

  // Password
  document.getElementById("prof-change-pw").addEventListener("click", () => {
    document.getElementById("prof-pw-new").value = "";
    document.getElementById("prof-pw-confirm").value = "";
    toggleInlineEdit("prof-row-pw", "prof-edit-pw", true);
  });
  document.getElementById("prof-pw-cancel").addEventListener("click", () =>
    toggleInlineEdit("prof-row-pw", "prof-edit-pw", false)
  );
  document.getElementById("prof-pw-save").addEventListener("click", async () => {
    const pw      = document.getElementById("prof-pw-new").value;
    const confirm = document.getElementById("prof-pw-confirm").value;
    const errEl   = document.getElementById("prof-pw-error");
    if (pw.length < 8 || !/[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?]/.test(pw)) {
      errEl.textContent = "Password must be 8+ characters with a special character.";
      errEl.classList.remove("hidden"); return;
    }
    if (pw !== confirm) {
      errEl.textContent = "Passwords do not match.";
      errEl.classList.remove("hidden"); return;
    }
    errEl.classList.add("hidden");
    if (supabaseClient) {
      const { error } = await supabaseClient.auth.updateUser({ password: pw });
      if (error) { errEl.textContent = error.message; errEl.classList.remove("hidden"); return; }
    }
    toggleInlineEdit("prof-row-pw", "prof-edit-pw", false);
  });

  // Delete account
  document.getElementById("prof-delete-account").addEventListener("click", async () => {
    if (!confirm("Are you sure you want to delete your account? This cannot be undone.")) return;
    if (supabaseClient) await supabaseClient.auth.signOut();
    state.currentUser = null;
    state.documents = [];
    localStorage.clear();
    setAvatarInitial(null);
    closeProfile();
    location.reload();
  });

  // ── Documents ────────────────────────────────────────

  document.getElementById("prof-add-doc").addEventListener("click", () => {
    closeProfile();
    openDocModalAdd();
  });

  document.getElementById("prof-doc-rows").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-edit-id]");
    if (!btn) return;
    closeProfile();
    openDocModalEdit(Number(btn.dataset.editId));
  });

  // ── Sign out ─────────────────────────────────────────

  document.getElementById("prof-signout").addEventListener("click", async () => {
    if (supabaseClient) await supabaseClient.auth.signOut();
    localStorage.clear();
    location.reload();
  });
}

function wireOnboarding() {
  if (_onboardingWired) {
    _resetOnboardingUI?.();
    return;
  }
  _onboardingWired = true;

  const overlay   = document.getElementById("onboarding");
  const s1        = document.getElementById("onb-s1");
  const s1Login   = document.getElementById("onb-s1-login");
  const s2        = document.getElementById("onb-s2");
  const bar1      = document.getElementById("onb-bar-1");
  const bar2      = document.getElementById("onb-bar-2");
  const stepLabel = document.getElementById("onb-step-label");
  const stepName  = document.getElementById("onb-step-name");
  const s1Error   = document.getElementById("onb-s1-error");
  const loginErr  = document.getElementById("onb-login-error");
  const s2Error   = document.getElementById("onb-s2-error");
  const titleEl   = overlay.querySelector(".onb-title");
  const subtitleEl = overlay.querySelector(".onb-subtitle");
  const progressRow = overlay.querySelector(".onb-progress-row");
  const progressBar = overlay.querySelector(".onb-bar");
  const countryEl = document.getElementById("onb-country");
  const docGrid   = document.getElementById("onb-doc-grid");
  const backBtn   = document.getElementById("onb-back-btn");
  const wordmarkBtn = document.getElementById("onb-wordmark-btn");
  const signupBtn = document.getElementById("onb-signup-btn");
  const loginBtn  = document.getElementById("onb-login-btn");
  const saveBtn   = document.getElementById("onb-save-btn");

  let currentUser = null;
  const pendingDocs = [];
  let pendingNextId = 1;

  // ── helpers ──────────────────────────────────────────

  function showError(el, msg) {
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function hideError(el) { el.classList.add("hidden"); }

  function closeOnboardingOverlay() {
    overlay.classList.add("hidden");
    document.body.classList.remove("onboarding-open");
    _onboardingSource = null;
    _onboardingMode = "signup";
    _startingOnboarding = false;
  }

  function setCredentialMode(mode) {
    const isLogin = mode === "login";
    _onboardingMode = isLogin ? "login" : "signup";
    s1.classList.toggle("hidden", isLogin);
    s1Login.classList.toggle("hidden", !isLogin);
    progressRow?.classList.toggle("hidden", isLogin);
    progressBar?.classList.toggle("hidden", isLogin);

    if (titleEl) {
      titleEl.textContent = isLogin ? "Log In to AeroLogic" : "Get Started with AeroLogic";
    }
    if (subtitleEl) {
      subtitleEl.textContent = isLogin
        ? "Access your saved travel documents and continue where you left off."
        : "Create an account or log in to manage your travel documents.";
    }

    if (isLogin) {
      stepLabel.textContent = "Log in";
      stepName.textContent = "Account access";
      return;
    }

    stepLabel.textContent = "Step 1 of 2";
    stepName.textContent = "Account Credentials";
  }

  function setStep2() {
    setCredentialMode("signup");
    s1.classList.add("hidden");
    s1Login.classList.add("hidden");
    s2.classList.remove("hidden");
    bar2.classList.add("active");
    stepLabel.textContent = "Step 2 of 2";
    stepName.textContent  = "Add Travel Documents";
  }

  function flagHtml(countryName) {
    const code = resolveCountryCode(countryName);
    if (code) {
      return `<img src="https://flagcdn.com/w40/${code.toLowerCase()}.png" class="onb-doc-flag-img" alt="${countryName}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'onb-doc-flag-emoji',textContent:'${getCountryFlag(countryName)}'}))">`;
    }
    return `<span class="onb-doc-flag-emoji">${getCountryFlag(countryName)}</span>`;
  }

  function renderDocGrid() {
    docGrid.innerHTML = pendingDocs.map((doc) => `
      <div class="onb-doc-card">
        <button class="onb-doc-remove" data-id="${doc.id}" aria-label="Remove">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="9" height="9">
            <path d="M5 5l10 10M15 5 5 15"/>
          </svg>
        </button>
        ${flagHtml(doc.country)}
        <div class="onb-doc-info">
          <strong>${doc.country}</strong>
          <small>${doc.type}</small>
        </div>
      </div>`).join("");
  }

  function resetStep2Form() {
    countryEl.value = "";
    document.getElementById("onb-doctype").value = "";
    document.getElementById("onb-expiry").value = "";
    hideError(s2Error);
  }

  function resetButtons() {
    signupBtn.disabled = false;
    signupBtn.textContent = "Sign up";
    loginBtn.disabled = false;
    loginBtn.textContent = "Log in";
    saveBtn.disabled = false;
    saveBtn.textContent = "Save and continue";
  }

  function resetOnboardingUI() {
    const allNames = state.countries.map((c) => c.name).sort((a, b) => a.localeCompare(b));
    countryEl.innerHTML = '<option value="">Select a country</option>' +
      allNames.map((n) => `<option value="${n}">${n}</option>`).join("");

    currentUser = null;
    pendingDocs.length = 0;
    pendingNextId = 1;

    setCredentialMode(_onboardingMode);
    s2.classList.add("hidden");
    bar1.classList.add("active");
    bar2.classList.remove("active");

    document.getElementById("onb-name").value = "";
    document.getElementById("onb-email").value = "";
    document.getElementById("onb-password").value = "";
    document.getElementById("onb-terms").checked = false;
    document.getElementById("onb-login-email").value = "";
    document.getElementById("onb-login-password").value = "";
    resetStep2Form();
    renderDocGrid();
    hideError(s1Error);
    hideError(loginErr);
    hideError(s2Error);
    resetButtons();

    backBtn?.classList.toggle("hidden", _onboardingSource !== "landing");
    wordmarkBtn?.classList.toggle("onb-wordmark-btn--interactive", _onboardingSource === "landing");
  }

  _resetOnboardingUI = resetOnboardingUI;

  function addPendingDoc() {
    const country = countryEl.value;
    const type    = document.getElementById("onb-doctype").value;
    if (!country || !type) {
      showError(s2Error, "Please select a country and document type.");
      return false;
    }
    if (pendingDocs.some((d) => d.country === country && d.type === type)) {
      showError(s2Error, "This document is already added.");
      return false;
    }
    hideError(s2Error);
    const expiry = document.getElementById("onb-expiry").value || null;
    pendingDocs.push({ id: pendingNextId++, country, type, expirationDate: expiry });
    renderDocGrid();
    resetStep2Form();
    return true;
  }

  async function finishOnboarding() {
    state.documents  = pendingDocs.map((d, i) => ({ ...d, id: i + 1 }));
    state.nextDocId  = state.documents.length + 1;
    saveDocuments(state.documents);
    localStorage.setItem(ONBOARDED_KEY, "1");
    if (supabaseClient && currentUser) {
      await saveDocsToSupabase(currentUser.id, state.documents);
    }
    closeOnboardingOverlay();
    renderDocList();
    renderProfileDocs();
    await refreshStatusesFromApi();
  }

  backBtn?.addEventListener("click", async () => {
    if (_onboardingSource !== "landing") return;
    await returnToLandingFromOnboarding();
  });

  wordmarkBtn?.addEventListener("click", async () => {
    if (_onboardingSource !== "landing") return;
    await returnToLandingFromOnboarding();
  });

  // ── Step 1: Sign-up ───────────────────────────────────

  signupBtn.addEventListener("click", async () => {
    const name     = document.getElementById("onb-name").value.trim();
    const email    = document.getElementById("onb-email").value.trim();
    const password = document.getElementById("onb-password").value;
    const terms    = document.getElementById("onb-terms").checked;
    hideError(s1Error);

    if (!name || !email || !password) {
      showError(s1Error, "Please fill in all fields.");
      return;
    }
    if (!terms) {
      showError(s1Error, "Please accept the terms to continue.");
      return;
    }
    if (password.length < 8 || !/[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?]/.test(password)) {
      showError(s1Error, "Password must be at least 8 characters and contain a special character.");
      return;
    }

    signupBtn.disabled = true;
    signupBtn.textContent = "Creating account…";

    if (supabaseClient) {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { display_name: name } }
      });
      if (error) {
        showError(s1Error, error.message);
        resetButtons();
        return;
      }
      currentUser = data.user;
      state.currentUser = data.user;
      setAvatarInitial(data.user);
    }

    resetButtons();
    setStep2();
  });

  // ── Step 1: toggle to log in ──────────────────────────

  document.getElementById("onb-to-login").addEventListener("click", () => {
    setCredentialMode("login");
  });

  document.getElementById("onb-to-signup").addEventListener("click", () => {
    setCredentialMode("signup");
  });

  loginBtn.addEventListener("click", async () => {
    const email    = document.getElementById("onb-login-email").value.trim();
    const password = document.getElementById("onb-login-password").value;
    hideError(loginErr);

    if (!email || !password) {
      showError(loginErr, "Please enter your email and password.");
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = "Logging in…";

    if (!supabaseClient) {
      showError(loginErr, "Log in is unavailable right now.");
      resetButtons();
      return;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      showError(loginErr, error.message);
      resetButtons();
      return;
    }

    currentUser = data.user;
    state.currentUser = data.user;
    setAvatarInitial(data.user);

    const docs = await loadDocsFromSupabase(data.user.id);
    const saved = loadSavedDocuments();

    if (Array.isArray(docs)) {
      state.documents = docs;
      state.nextDocId = docs.length + 1;
    } else if (saved && saved.length > 0) {
      state.documents = saved;
      state.nextDocId = Math.max(...saved.map((d) => d.id)) + 1;
    } else {
      state.documents = [];
      state.nextDocId = 1;
    }

    saveDocuments(state.documents);
    localStorage.setItem(ONBOARDED_KEY, "1");
    closeOnboardingOverlay();
    renderDocList();
    renderProfileDocs();
    await refreshStatusesFromApi();
  });

  // ── Step 2: Add documents ─────────────────────────────

  document.getElementById("onb-add-btn").addEventListener("click", addPendingDoc);

  docGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-id]");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const idx = pendingDocs.findIndex((d) => d.id === id);
    if (idx !== -1) { pendingDocs.splice(idx, 1); renderDocGrid(); }
  });

  saveBtn.addEventListener("click", async () => {
    // Auto-add current form values if filled
    const country = countryEl.value;
    const type    = document.getElementById("onb-doctype").value;
    if (country && type && !addPendingDoc()) return;
    if (!pendingDocs.length) {
      showError(s2Error, "Add at least one travel document to continue.");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    await finishOnboarding();
  });

  resetOnboardingUI();
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

  function applyViewportLayout() {
    const { translate, scale, zoomLevel } = getGlobeViewportConfig();
    state.globe.baseScale = scale;
    projection.translate(translate);
    if (Number.isFinite(zoomLevel)) state.globe.zoomLevel = zoomLevel;
    applyZoom();
  }

  state.globe.applyViewportLayout = applyViewportLayout;

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    applyViewportLayout();
  }

  resize();
  window.addEventListener("resize", resize);

  // Scroll-wheel zoom
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (state.isDemoMode) return;
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
    if (state.isDemoMode) return;
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
  const list = await fetchWithRetry(COUNTRY_API_URL, 8000, 4);
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

async function initMainApp(topology, options = {}) {
  const { hideLoading = true, defaultCountry = "Germany" } = options;
  buildCountries(topology);
  populateCountrySelect();
  initDefaultStatuses();
  updateCountryPanel(null);
  initGlobe();
  if (!_searchWired)    { _searchWired    = true; wireSearch(); }
  if (!_documentsWired) { _documentsWired = true; wireDocuments(); }
  if (!_profileWired)   { _profileWired   = true; wireProfile(); }
  if (defaultCountry) selectCountry(defaultCountry, true);
  if (hideLoading) elements.globeLoading.classList.add("hidden");
  if (!_mainGlobeStarted) {
    _mainGlobeStarted = true;
    requestAnimationFrame(drawFrame);
  }
}

async function init() {
  try {
    // Start all fetches in parallel immediately
    const topologyPromise = fetchJson(GEOJSON_URL);
    const metadataPromise = loadCountryMetadata();

    await initSupabase();

    // ── Returning authenticated user ──────────────────
    if (supabaseClient) {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session) {
        const [topology] = await Promise.all([topologyPromise, metadataPromise]);
        await initMainApp(topology);

        state.currentUser = session.user;
        setAvatarInitial(session.user);

        const docs = await loadDocsFromSupabase(session.user.id);
        if (docs && docs.length > 0) {
          state.documents = docs;
          state.nextDocId = docs.length + 1;
          saveDocuments(state.documents);
        } else {
          const saved = loadSavedDocuments();
          if (saved && saved.length > 0) {
            state.documents = saved;
            state.nextDocId = Math.max(...saved.map((d) => d.id)) + 1;
          }
        }
        localStorage.setItem(ONBOARDED_KEY, "1");
        renderDocList();
        await refreshStatusesFromApi();
        return;
      }
    }

    // ── Previously onboarded (localStorage) ──────────
    const isOnboarded = localStorage.getItem(ONBOARDED_KEY);
    if (isOnboarded) {
      const [topology] = await Promise.all([topologyPromise, metadataPromise]);
      await initMainApp(topology);

      const saved = loadSavedDocuments();
      if (saved && saved.length > 0) {
        state.documents = saved;
        state.nextDocId = Math.max(...saved.map((d) => d.id)) + 1;
      }
      renderDocList();
      await refreshStatusesFromApi();
      return;
    }

    // ── New user → start live demo with a seeded US passport ──
    const [topology] = await Promise.all([topologyPromise, metadataPromise]);
    await initMainApp(topology, { hideLoading: false, defaultCountry: DEMO_DEFAULT_COUNTRY });

    seedDemoDocuments();
    await refreshStatusesFromApi();
    selectCountry(DEMO_DEFAULT_COUNTRY, true);
    enterDemoMode();
    wireLanding();
    elements.globeLoading.classList.add("hidden");

  } catch (error) {
    elements.globeLoading.textContent = `Could not initialize: ${error?.message || error}`;
  }
}

init();
