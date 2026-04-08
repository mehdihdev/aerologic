"use strict";

const GEOJSON_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const COUNTRY_API_URL = "https://restcountries.com/v3.1/all?fields=name,flag,altSpellings,cca2";

const STATUS = {
  VISA_FREE: "visa-free",
  EVISA: "evisa",
  VOA: "visa-on-arrival",
  VISA_REQUIRED: "visa-required",
  TRAVEL_BAN: "travel-ban"
};

const STATUS_COLORS = {
  [STATUS.VISA_FREE]: "rgba(32, 201, 122, 0.88)",
  [STATUS.EVISA]: "rgba(246, 172, 35, 0.9)",
  [STATUS.VOA]: "rgba(248, 190, 45, 0.9)",
  [STATUS.VISA_REQUIRED]: "rgba(248, 79, 112, 0.9)",
  [STATUS.TRAVEL_BAN]: "rgba(156, 16, 32, 0.95)"
};

const STATUS_COPY = {
  [STATUS.VISA_FREE]: "You are cleared for entry",
  [STATUS.EVISA]: "eVisa required before departure",
  [STATUS.VOA]: "Visa on arrival available",
  [STATUS.VISA_REQUIRED]: "Visa required before travel",
  [STATUS.TRAVEL_BAN]: "You are not cleared for entry"
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

const DEFAULT_DOCUMENTS = [
  { id: 1, country: "United States of America", type: "Passport" },
  { id: 2, country: "India", type: "Passport" },
  { id: 3, country: "Australia", type: "Passport" }
];

const AUTO_CLEAR_DOC_TYPES = new Set([
  "Passport",
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
  documents: [...DEFAULT_DOCUMENTS],
  nextDocId: 4,
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
  const prefix = state.loadingApiData ? "Updating" : "";
  elements.globalStatus.textContent = `${prefix}${prefix ? " " : ""}${counts[STATUS.VISA_FREE]} visa-free • ${mixed} eVisa/VoA • ${counts[STATUS.VISA_REQUIRED]} visa required`;
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
      validity: "Check official source",
      stay: "Varies",
      explanation: "Live visa data unavailable for this destination right now. Try again in a few seconds."
    };
  }

  if (detail.sourceCode === "LOCAL_DOC") {
    return {
      visa: "Not Required",
      validity: "N/A",
      stay: "Resident/Citizen Access",
      explanation: `Entry is cleared because this country matches a document you hold (${detail.documentType}).`
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
    stay: status === STATUS.TRAVEL_BAN ? "Travel Ban" : stayCopy,
    explanation: `Based on live visa data for ${sourcePassport} entering ${countryName}. Status updates may change; verify with the destination embassy before travel.`
  };
}

function updateCountryPanel(countryName) {
  if (!countryName) {
    elements.countryEmoji.textContent = "🌍";
    elements.countryName.textContent = "Select a country";
    elements.entryPill.className = "entry-pill neutral";
    elements.entryPill.textContent = "Choose a destination";
    elements.reqVisa.textContent = "-";
    elements.reqValidity.textContent = "-";
    elements.reqStay.textContent = "-";
    elements.countryExplainer.textContent =
      "Add one or more passport documents and click a country to load live visa requirements.";
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

function applyDocumentOverrides() {
  state.documents.forEach((doc) => {
    if (!AUTO_CLEAR_DOC_TYPES.has(doc.type)) return;

    let countryName = doc.country;
    if (!state.countryByName.has(countryName)) {
      const code = resolveCountryCode(doc.country);
      if (code && state.countryNameByCode.has(code)) {
        const mappedName = state.countryNameByCode.get(code);
        if (state.countryByName.has(mappedName)) countryName = mappedName;
      }
    }

    if (!state.countryByName.has(countryName)) return;

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

  elements.countrySearch.addEventListener("blur", () => setTimeout(() => renderSearchResults([]), 120));
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
    await refreshStatusesFromApi();
  });

  elements.docList.addEventListener("click", async (event) => {
    const removeButton = event.target.closest("button[data-doc-id]");
    if (!removeButton) return;
    const docId = Number(removeButton.dataset.docId);
    state.documents = state.documents.filter((doc) => doc.id !== docId);
    renderDocList();
    await refreshStatusesFromApi();
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
    lastFrame: performance.now()
  };

  function resize() {
    const width = elements.globeRoot.clientWidth;
    const height = elements.globeRoot.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    projection.translate([width / 2, height / 2]).scale(Math.min(width, height) * 0.47);
  }

  resize();
  window.addEventListener("resize", resize);

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
    projection.rotate([
      state.globe.dragState.lon + dx * 0.33,
      clamp(state.globe.dragState.lat - dy * 0.33, -85, 85),
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
    const radius = isSelected ? 3.6 + pulse : 1.9;

    context.beginPath();
    context.fillStyle = STATUS_COLORS[status];
    context.globalAlpha = isHovered ? 1 : 0.88;
    context.arc(point[0], point[1], radius, 0, Math.PI * 2);
    context.fill();

    if (isSelected || isHovered) {
      context.beginPath();
      context.globalAlpha = 0.2 + pulse * 0.18;
      context.arc(point[0], point[1], radius + 5 + pulse * 1.5, 0, Math.PI * 2);
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
    const interpolate = d3.geoInterpolate([source.lng, source.lat], [destination.lng, destination.lat]);
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
    context.lineWidth = 1;
    context.setLineDash([6, 10]);
    context.lineDashOffset = -(timestamp * 0.05 + index * 7);
    context.globalAlpha = 0.58;
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
    context.globalAlpha = isSelected ? 0.96 : 0.78;
    context.fill();
    context.lineWidth = isSelected ? 1.1 : 0.45;
    context.strokeStyle = isHovered ? "rgba(240,247,255,0.9)" : "rgba(180,193,218,0.28)";
    context.stroke();
  });
  context.globalAlpha = 1;
}

function drawFrame(timestamp) {
  const globe = state.globe;
  if (!globe) return;

  const { context, projection, path } = globe;
  const width = elements.globeRoot.clientWidth;
  const height = elements.globeRoot.clientHeight;
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
  const gradient = context.createRadialGradient(
    cx - radius * 0.38,
    cy - radius * 0.33,
    radius * 0.14,
    cx,
    cy,
    radius * 1.04
  );
  gradient.addColorStop(0, "#f4f7ff");
  gradient.addColorStop(0.56, "#d6deed");
  gradient.addColorStop(1, "#adb9cb");

  context.beginPath();
  path({ type: "Sphere" });
  context.fillStyle = gradient;
  context.fill();

  context.beginPath();
  path(globe.graticule);
  context.strokeStyle = "rgba(96, 110, 134, 0.2)";
  context.lineWidth = 0.55;
  context.stroke();

  drawCountries();
  drawRoutes(timestamp);
  drawCountryDots(timestamp);

  context.beginPath();
  path({ type: "Sphere" });
  context.lineWidth = 1.1;
  context.strokeStyle = "rgba(72, 82, 103, 0.7)";
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
    const [topology, _] = await Promise.all([fetchJson(GEOJSON_URL), loadCountryMetadata()]);
    buildCountries(topology);
    populateCountrySelect();
    renderDocList();
    initDefaultStatuses();
    updateCountryPanel(null);
    initGlobe();
    wireSearch();
    wireDocuments();
    selectCountry("Germany", true);
    elements.globeLoading.classList.add("hidden");
    requestAnimationFrame(drawFrame);
    await refreshStatusesFromApi();
  } catch (error) {
    elements.globeLoading.textContent = `Could not initialize app: ${error?.message || error}`;
  }
}

init();
