# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

```bash
node server.js          # starts server at http://localhost:4173
```

No build step — all frontend files are served as-is. The `public/` directory mirrors root-level frontend files and must be kept in sync manually when editing `app.js`, `index.html`, or `styles.css`.

Health check: `curl http://localhost:4173/api/health`

## Deployment

Deployed on Vercel. The `api/` directory contains serverless function equivalents of the backend endpoints in `server.js`. When adding or changing API behavior, both `server.js` and the corresponding `api/*.js` file must be updated.

`vercel.json` rewrites `/api/*` to the serverless functions.

## Architecture

**AeroLogic** is an interactive visa intelligence globe. Users add travel documents (passports, visas, residency permits), and the app colors every country on a 3D rotating globe by visa entry requirement.

### Frontend (`app.js`, ~1100 lines)

Single vanilla JS file with no bundler. Key globals:
- `state` — central app state (countries, documents, visa statuses, selected country)
- `elements` — cached DOM references
- `countryByName`, `countryCodeByName`, `statusByCountry`, `detailByCountry` — lookup maps

**Data flow**: `init()` fetches world topology (TopoJSON) + country metadata (REST Countries API), then builds the globe. When documents are added, `fetchVisaStatusForDocuments()` calls `/api/visa-matrix` and populates `statusByCountry`. All rendering reads from `state` and the lookup maps.

**Globe rendering**: D3.js handles geographic projections and hit-testing; Canvas 2D handles all drawing. There is an animation loop for auto-rotation and route lines. Drag events rotate the globe manually.

**Visa status priority**: statuses are ranked 0–4 (travel-ban → visa-required → VoA → eVisa → visa-free). When a user has multiple documents, the best (highest-rank) status wins per country.

**Special logic**:
- Countries where a document was issued are automatically visa-free
- `VISA_GRANTS` maps US/Schengen/GB visas to lists of countries they unlock
- Schengen visa holders get access to all Schengen members

### Backend (`server.js`, ~310 lines)

Minimal Node.js `http` server with no framework. Serves static files and three API endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Status + passport index load time |
| `GET /api/visa-status?passport=US&destination=DE` | Single pair lookup |
| `GET /api/visa-matrix?passport=US&destinations=DE,FR` | Batch lookup (12 concurrent) |

**Caching**: In-memory `Map` per passport–destination pair, 24h TTL. The Passport Index dataset (fetched from GitHub) is cached separately with a 12h refresh.

**Fallback**: If the Passport Index dataset is unavailable, individual queries fall back to `EXTERNAL_VISA_API`.

### Onboarding & Auth

A 2-step full-screen onboarding flow replaces the old modal overlay:
- **Step 1** — email/password sign-up (or log-in toggle). Calls `supabase.auth.signUp` / `signInWithPassword`. Falls back gracefully if Supabase is not configured.
- **Step 2** — travel document addition. Documents are saved to the `travel_documents` Supabase table **and** to localStorage. Returning users with an active Supabase session skip straight to the globe.

Required Supabase table:
```sql
CREATE TABLE travel_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  country TEXT NOT NULL,
  type TEXT NOT NULL,
  expiration_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE travel_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own docs" ON travel_documents
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### Environment Variables (`.env`)

```
PORT=4173
EXTERNAL_VISA_API=<base URL>
PASSPORT_INDEX_DATA_URL=<GitHub raw URL>
SUPABASE_URL=<project URL>
SUPABASE_ANON_KEY=<anon/public key>
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are served to the frontend via `/api/config`. Without them the app works in localStorage-only mode.
