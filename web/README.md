# Schnell Fleet Analytics — Dashboard UI (`web/`)

**This is THE dashboard.** React 18 + TypeScript + Vite + Tailwind CSS v4 +
Chart.js + Lucide icons. `public/` is its **build output** (via `../build-web.sh`)
— that's what FastAPI, Firebase and the Dockerfile serve. Never hand-edit `public/`.

**Design system v2 — "refined modern dark"**: zinc neutrals + indigo accent
(Linear/Vercel-style). All tokens live in `src/styles/global.css` (`:root` CSS
variables + the component classes); chart palette maps to the same accents.
To retheme, change the tokens — components reference `var(--…)` throughout.

## Run

```bash
# 1. Start the backend (unchanged)
../analytics-api/run-local.sh          # FastAPI on :8080

# 2. Start the React dev server
npm install                            # first time only
npm run dev                            # http://localhost:5173
                                       # /api and /matter proxy to :8080
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :5173 with `/api` + `/matter` proxied to :8080 |
| `npm run build` | Typecheck + production build → `dist/` |
| `npm run typecheck` | Strict TS check — includes the golden-fixture contract check |

## Structure

```
src/
├── types/api.ts          Typed API contract (derived from real captured responses)
├── types/contract.check.ts  Compile-time check: golden fixture must satisfy the types
├── api/client.ts         The only place that talks to the backend
├── lib/
│   ├── pool.ts           Event pool — the reconciliation core (ported 1:1)
│   ├── format.ts         Formatting/classification helpers
│   ├── constants.ts      Targets, Matter UI config, use-case labels
│   └── info.ts           ⓘ info-modal texts (ported verbatim)
├── styles/global.css     Design system v2 — tokens + all component classes
├── charts/setup.ts       Chart.js registration + global defaults
├── state/DashboardContext.tsx  Date range, hub data, view routing, modal
├── components/           Modal, InfoButton, EventTable, Heatmap, …
├── modals/               dayDebug, fleetModals, hubModals (drill-downs)
└── views/
    ├── Landing.tsx       Fleet overview (KPIs + hub health grid)
    ├── HubDetail.tsx     Hub KPI row + tab shell + Matter Node/Thread iframe
    ├── LogCenter.tsx     Virtualized event workspace (timing pipelines)
    └── tabs/             OverallTab · SpeedTab · ReliabilityTab · UsageTab
```

## The two guarantees

1. **Backend behavior is frozen** — `analytics-api/tests/verify_golden.py`
   re-runs the API and diffs against captured fixtures. Run it after any
   backend change.
2. **The frontend reconciles** — the event pool (`lib/pool.ts`) is verified to
   produce exactly the backend's `total_activity` / `activity_fail` / source
   split for every golden hub fixture (pool === summary cards === Log Center).

## Scale notes

- Log Center rows are **virtualized** (`@tanstack/react-virtual`) — tens of
  thousands of events render smoothly.
- Server data is cached by TanStack Query (5 min, matching the backend cache).

## Ship a UI change

```bash
../build-web.sh      # typecheck + build → refresh ../public/ (keeps matter/ + 404.html)
../deploy.sh         # deploy live (Cloud Run + Firebase)
```
