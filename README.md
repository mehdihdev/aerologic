# AeroLogic - Visa Intelligence Globe

Interactive visa-checker concept app inspired by your references:
- Add/remove travel documents
- Draggable + auto-rotating globe
- Country-level visa status coloring (`visa-free`, `eVisa/VoA`, `visa required`, `travel ban`)
- Search + focus a country
- Dynamic right-side requirements/explanation panel
- Animated route lines from your document countries to selected destination
- Live visa status fetching through a local API proxy (no profile scoring)

## Run

From the project folder:

```bash
node server.js
```

Then open:

`http://localhost:4173`

## Notes

- Visa status data is served via local endpoints (`/api/visa-status`, `/api/visa-matrix`) with Passport Index dataset (`imorte/passport-index-data`) as primary source and live endpoint fallback.
- Globe updates in batches and merges all passport documents, picking the best available access status per destination.
- Countries matching your owned passport/permanent-residence documents are always forced to cleared entry.
- Globe geometry is loaded from `world-atlas` TopoJSON.
- Country flags are loaded from `restcountries` with fallback emoji when unavailable.
