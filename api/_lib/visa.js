"use strict";

const EXTERNAL_VISA_API = process.env.EXTERNAL_VISA_API || "https://rough-sun-2523.fly.dev/visa";
const PASSPORT_INDEX_DATA_URL =
  process.env.PASSPORT_INDEX_DATA_URL || "https://raw.githubusercontent.com/imorte/passport-index-data/main/passport-index.json";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const PAIR_CACHE = new Map();
const DATA_REFRESH_MS = 1000 * 60 * 60 * 12;
let PASSPORT_INDEX_DATA = null;
let PASSPORT_INDEX_LOADED_AT = 0;

const STATUS_MAP = {
  VF: "visa-free",
  EV: "evisa",
  VOA: "visa-on-arrival",
  VR: "visa-required",
  TB: "travel-ban"
};

const PASSPORT_INDEX_STATUS_MAP = {
  "visa free": "visa-free",
  "visa on arrival": "visa-on-arrival",
  eta: "evisa",
  "e-visa": "evisa",
  "visa required": "visa-required",
  "no admission": "travel-ban",
  "covid ban": "travel-ban"
};

function normalizeVisaLabel(status) {
  switch (status) {
    case "visa-free":
      return "Visa Free";
    case "visa-on-arrival":
      return "Visa On Arrival";
    case "evisa":
      return "eVisa";
    case "travel-ban":
      return "No Admission";
    default:
      return "Visa Required";
  }
}

function normalizeVisaRecord(raw) {
  const categoryCode = raw?.category?.code || "VR";
  const normalizedStatus = STATUS_MAP[categoryCode] || "visa-required";
  return {
    status: normalizedStatus,
    visa: raw?.category?.name || "Visa Required",
    durationDays: raw?.dur ?? null,
    sourceCode: categoryCode,
    sourceUpdatedAt: raw?.last_updated || null,
    passport: raw?.passport || null,
    destination: raw?.destination || null
  };
}

function cacheGet(key) {
  const hit = PAIR_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    PAIR_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  PAIR_CACHE.set(key, { ts: Date.now(), value });
}

async function ensurePassportIndexLoaded() {
  const now = Date.now();
  if (PASSPORT_INDEX_DATA && now - PASSPORT_INDEX_LOADED_AT < DATA_REFRESH_MS) return;

  const response = await fetch(PASSPORT_INDEX_DATA_URL, {
    headers: {
      "user-agent": "AeroLogicVisaChecker/1.0 (+https://localhost)"
    }
  });
  if (!response.ok) {
    throw new Error(`Passport index dataset fetch failed (${response.status})`);
  }

  PASSPORT_INDEX_DATA = await response.json();
  PASSPORT_INDEX_LOADED_AT = Date.now();
}

function lookupPassportIndex(passport, destination) {
  if (!PASSPORT_INDEX_DATA) return null;
  if (passport === destination) {
    return {
      status: "visa-free",
      visa: "Visa Free",
      durationDays: null,
      sourceCode: "LOCAL_SAME_COUNTRY",
      sourceUpdatedAt: new Date(PASSPORT_INDEX_LOADED_AT).toISOString(),
      passport: { code: passport },
      destination: { code: destination }
    };
  }

  const passportData = PASSPORT_INDEX_DATA[passport];
  if (!passportData) return null;
  const entry = passportData[destination];
  if (!entry) return null;

  const raw = String(entry.status || "visa required").toLowerCase();
  const status = PASSPORT_INDEX_STATUS_MAP[raw] || "visa-required";
  return {
    status,
    visa: normalizeVisaLabel(status),
    durationDays: Number.isFinite(entry.days) ? entry.days : null,
    sourceCode: `PI:${raw}`,
    sourceUpdatedAt: new Date(PASSPORT_INDEX_LOADED_AT).toISOString(),
    passport: { code: passport },
    destination: { code: destination }
  };
}

async function fetchVisaStatus(passport, destination) {
  const pairKey = `${passport}:${destination}`;
  const cached = cacheGet(pairKey);
  if (cached) return cached;

  try {
    await ensurePassportIndexLoaded();
    const fromDataset = lookupPassportIndex(passport, destination);
    if (fromDataset) {
      cacheSet(pairKey, fromDataset);
      return fromDataset;
    }
  } catch (error) {
    console.error("Passport index dataset unavailable, falling back to live endpoint:", error.message);
  }

  const url = `${EXTERNAL_VISA_API}/${passport}/${destination}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "AeroLogicVisaChecker/1.0 (+https://localhost)"
    }
  });

  if (!response.ok) {
    throw new Error(`Visa API request failed (${response.status}) for ${pairKey}`);
  }

  const payload = await response.json();
  const normalized = normalizeVisaRecord(payload);
  cacheSet(pairKey, normalized);
  return normalized;
}

async function mapWithConcurrency(items, worker, concurrency = 12) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) break;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, run);
  await Promise.all(workers);
  return results;
}

module.exports = {
  fetchVisaStatus,
  mapWithConcurrency,
  PASSPORT_INDEX_DATA: () => PASSPORT_INDEX_DATA,
  PASSPORT_INDEX_LOADED_AT: () => PASSPORT_INDEX_LOADED_AT
};
