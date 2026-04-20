"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;

const EXTERNAL_VISA_API = process.env.EXTERNAL_VISA_API || "https://rough-sun-2523.fly.dev/visa";
const PASSPORT_INDEX_DATA_URL =
  process.env.PASSPORT_INDEX_DATA_URL || "https://raw.githubusercontent.com/imorte/passport-index-data/main/passport-index.json";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const PAIR_CACHE = new Map();
const DATA_REFRESH_MS = 1000 * 60 * 60 * 12;
let PASSPORT_INDEX_DATA = null;
let PASSPORT_INDEX_LOADED_AT = 0;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

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
    // Fallback to live endpoint below when dataset fetch fails.
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

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(ROOT, path.normalize(safePath));
  if (!filePath.startsWith(ROOT)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      notFound(res);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "content-type": MIME_TYPES[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = reqUrl.pathname;

    if (pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        service: "AeroLogic Visa API Proxy",
        passportIndexLoaded: Boolean(PASSPORT_INDEX_DATA),
        passportIndexLoadedAt: PASSPORT_INDEX_LOADED_AT
          ? new Date(PASSPORT_INDEX_LOADED_AT).toISOString()
          : null
      });
      return;
    }

    if (pathname === "/api/visa-status") {
      const passport = (reqUrl.searchParams.get("passport") || "").trim().toUpperCase();
      const destination = (reqUrl.searchParams.get("destination") || "").trim().toUpperCase();
      if (!passport || !destination) {
        sendJson(res, 400, { error: "Missing required passport/destination query params." });
        return;
      }
      const result = await fetchVisaStatus(passport, destination);
      sendJson(res, 200, { passport, destination, result });
      return;
    }

    if (pathname === "/api/visa-matrix") {
      const passport = (reqUrl.searchParams.get("passport") || "").trim().toUpperCase();
      const destinations = (reqUrl.searchParams.get("destinations") || "")
        .split(",")
        .map((entry) => entry.trim().toUpperCase())
        .filter(Boolean)
        .filter((entry) => /^[A-Z]{2}$/.test(entry));

      if (!passport || !destinations.length) {
        sendJson(res, 400, {
          error: "Missing required params. Use ?passport=US&destinations=DE,FR,BR"
        });
        return;
      }

      const pairs = await mapWithConcurrency(destinations, async (destinationCode) => {
        try {
          const result = await fetchVisaStatus(passport, destinationCode);
          return [destinationCode, result];
        } catch (error) {
          return [
            destinationCode,
            {
              status: "visa-required",
              visa: "Visa Required",
              durationDays: null,
              sourceCode: "ERR",
              sourceUpdatedAt: null,
              error: error.message
            }
          ];
        }
      });

      sendJson(res, 200, {
        passport,
        matrix: Object.fromEntries(pairs)
      });
      return;
    }

    if (pathname === "/new") {
      serveStatic(req, res, "/new.html");
      return;
    }

    serveStatic(req, res, pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AeroLogic server running on http://${HOST}:${PORT}`);
});
