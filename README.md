# Brisa

A BigRedHacks navigation project: compare walking routes using historical reported incidents, with an explicit limit on added walking time. Inspired by our team's experiences in Latin America; the first demo uses Chicago's Loop because its public data is suitable for a reproducible prototype.

## Run locally

Requires Node.js 22.12+ (or a compatible newer version) and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. No Google Maps key, paid API, backend, or account is needed. Routing and incident analysis use the bundled snapshot. Background map tiles require internet; street geometry and routes remain available without them.

```sh
npm test                         # routing and integration tests
python3 scripts/test_data.py      # bundled snapshot integrity
npm run build                    # TypeScript + production build
npm run preview                  # serve the production build locally
```

Browser checks exercise desktop and mobile layouts, tile failure, route changes, invalid inputs, and snapshot-load recovery:

```sh
npx playwright install chromium  # once per machine
npm run test:e2e
```

Alternatively, use an installed Chrome with `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. The tests run in an isolated browser profile and suppress public map-tile requests.

## What the prototype does

- Plans routes along a real OpenStreetMap walking graph inside the demo boundary.
- Compares fastest and distinct alternatives found within your extra-time budget.
- Uses four Chicago-local time windows from 2025 incident records.
- Integrates a smoothed historical report index along the actual returned street geometry.
- Shows source dates, aggregate context, route explanations, and unsupported-location errors.
- Opens a destination in Google Maps as a separate action. Google calculates its own route; the selected path and exposure estimate do not transfer.

The index is **modeled exposure to nearby historical reports**, not a calibrated probability of harm. It is influenced by foot traffic, reporting and policing patterns, location approximation, and missing reports. Fewer reports do not establish safety. This is a historical route-comparison prototype; it does not supply live incidents, verified street accessibility, or turn-by-turn navigation.

## How the parts fit together

| Part | Location | Responsibility |
| --- | --- | --- |
| Product decisions | [docs/PLAN.md](docs/PLAN.md) | Council rounds, alternatives, model, scope and roadmap |
| Demo walkthrough | [docs/DEMO.md](docs/DEMO.md) | A working example and honest pitch for the judges |
| Data provenance | [docs/DATA.md](docs/DATA.md) | Source queries, filters, spatial coverage, dates and limitations |
| Data pipeline | `scripts/build_data.py` | Fetch, validate, aggregate and publish a city snapshot |
| Shared contracts | `src/domain/types.ts` | City graph, cells, requests and route results |
| Routing engine | `src/domain/routing.ts` | Pure graph/scoring logic, independent of React |
| Interface | `src/App.tsx`, `src/components/`, `src/styles.css` | Responsive planner and interactive map |
| Snapshot | `public/data/chicago-loop.json` | Real street graph and aggregate historical reports |

The browser loads the city bundle once and evaluates routes locally. City data, route calculation and UI are separate modules. A larger release can move the same request/result contract into a Web Worker or API, store incident aggregates in a spatial database, serve graph tiles by city, and add audited data adapters. The current bundle deliberately covers one small district; it is not a worldwide routing engine.

## Data and refresh

Read [docs/DATA.md](docs/DATA.md) before changing the source window or graph filters. Python uses only the standard library. Refresh requires network access to the City of Chicago and Overpass, and deliberately fails on incomplete data rather than silently generating an apparently complete map.

```sh
npm run data:refresh
python3 scripts/test_data.py
npm test
```

The committed snapshot makes demo startup independent of public API availability. Do not commit raw case records or `.data-cache/`.

## Deployment and configuration

`npm run build` produces a static `dist/` folder suitable for a static web host. Serve it at the domain root. No server-side secrets are required. `.env.example` documents the optional tile URL; all `VITE_` values are public browser configuration. Follow your chosen tile provider's attribution and usage policy. There is no service worker or bulk tile downloader.

## Sources and attribution

- Crime reports: [City of Chicago, Crimes 2001 to Present](https://data.cityofchicago.org/Public-Safety/Crimes-2001-to-Present/ijzp-q8t2/data). Historical reports are approximate and may be revised; see the source terms and [data notes](docs/DATA.md).
- Streets: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the ODbL. The derived street database retains that attribution and license; it is separate from the report aggregates.
- Map tiles: [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/). Only normal interactive tile requests are used.

The team has not selected a license for application code; no blanket license is asserted over third-party data.
