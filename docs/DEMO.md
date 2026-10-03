# Brisa demo walkthrough

## Rehearse locally

```sh
npm ci
npm run dev
```

Open the printed local URL. NYC is the app default. For the LATAM demo, open `/?area=sao-paulo-centro`; `/?area=chicago-loop` and `/?area=sf-downtown` select the other packages. Prepare dependencies before the event. The committed graph, aggregate packages and fonts work from the local server; optional background map tiles use the network. There are no live incident-source or Overpass requests during the demo.

## Two-minute working demo

1. **0:00 — Frame the decision.** Our LATAM team's experiences inspired a walking planner that exposes historical report context alongside time. Begin in São Paulo with Edifício Copan → Praça da Sé, noon–6 pm, eight extra minutes allowed. This is the working Brazil package.
2. **0:20 — Compare geometry.** Select Fastest walk and a distinct lower-exposure choice if available. The highlighted line is the scored OSM path. Enable reported incident intensity to show aggregate context. The current São Paulo default is about 20.30 minutes fastest versus 22.53 minutes for 14.89% lower modeled exposure (cards round values). Use the displayed values if a package or model changes.
3. **0:40 — Enforce the budget.** Set Room for a detour to zero. Old results and their share/export actions disappear until Compare walking routes runs again. Restore eight minutes. A distinct alternative is not promised for every request.
4. **1:00 — Explain the chosen path.** Open Street sequence. These are contiguous named segments, not turn instructions. Same walk, different windows shows the selected geometry's four historical exposure values; choosing another route updates all four.
5. **1:20 — Share and export.** Share trip reveals the coordinate disclosure and a link; Copy link is optional. Open that link to restore the endpoints, window, budget and semantic route preference. The browser address then retains only the coverage area. Download GPX preserves the selected path; Download summary preserves its street sequence and historical context. Shared links recalculate rather than freeze route geometry.
6. **1:40 — Show scope and limits.** Show coverage fits the package boundary; Fit routes to map returns to the walk. Show the four-city selector without waiting for another comparison. Say: “São Paulo uses 2,466 eligible pedestrian cellphone theft/robbery reports with known times. Missing times introduce bias. These historical indices do not predict safety or rank cities.” Keep a city switch and SF’s narrow scope for questions.

For a spoken script and submission draft, use [PITCH.md](PITCH.md).

## Included packages

Counts below describe the committed snapshots, not live incident totals. All use 2025 historical reports.

| Package | Source extract count | Eligible reports | Aggregate cells | OSM nodes | OSM edges |
| --- | ---: | ---: | ---: | ---: | ---: |
| NYC · Central Manhattan | 90,116 | 5,497 | 1,050 | 73,021 | 91,746 |
| Chicago · Loop | 21,349 | 3,064 | 270 | 21,232 | 25,669 |
| San Francisco · Downtown | 48,533 | 160 | 400 | 22,819 | 29,178 |
| São Paulo · Paulista–Centro | 32,552 | 2,466 | 576 | 29,861 | 35,551 |

**Count units:** The US counts are retrieved source rows. São Paulo’s 32,552 count is distinct latest-version reports with coordinates in the incident halo, not workbook rows. The complete workbook contains 383,635 physical data rows and 309,326 distinct publisher report keys; repeated phone/person/offense rows are deduplicated before aggregation. Of the halo reports, 19,217 with missing or imprecise occurrence times are excluded under the timestamp eligibility rule. This known-time subset can introduce time-reporting bias; it is not representative general-crime coverage.

NYC is a rectangle from Battery Park through Columbus Circle; Chicago covers the Loop; SF covers a downtown rectangle; São Paulo covers a Paulista–Centro rectangle. None represents its entire city. Eligibility follows source-specific rules. SF is explicitly limited to street/public-place robbery; a small count does not establish a safer city. São Paulo includes pedestrian cellphone theft/robbery only. Raw case records are not served by the app.

São Paulo's MASP landmark is named **MASP · Paulista sidewalk**. Its reviewed surface-sidewalk OSM node avoids the geometrically closer Nove de Julho tunnel; it is not a verified museum entrance or a general street-access audit. See [DATA.md](DATA.md) for source and geometry checks.

## If the demo network fails

- Keep the local Vite server running and reload the local app. Bundled streets and routes remain available when background tile requests fail; the app shows a map-unavailable explanation.
- If dependencies are already installed, `npm run build` followed by `npm run preview` serves the production bundle locally. Open the URL that command prints. No incident API or Google key is needed.
- Do not refresh source data at the event. The committed packages are the demo inputs; ingestion is a separate operation.
- If a package load fails, use Try again or switch coverage. Invalid shared links show a notice and fall back to default landmarks. Identical endpoints and points outside supported street coverage produce recoverable errors.
- The app is not a service-worker offline install. A remote deployment must load its assets and selected package first; a prepared local server is the dependable network fallback.

## What is implemented and checked

Routing runs in a Web Worker over a real OSM graph. The engine integrates the historical index along route geometry and searches 18 time/exposure tradeoffs, displaying at most three distinct budget-compliant candidates. This is not a guarantee of globally optimal constrained routing.

Run `npm test`, `python3 scripts/test_data.py`, `npm run build`, and `npm run test:e2e`. Browser tests use actual workers and suppress public tile requests. Covered flows include city switching, load recovery, route selection, exact selected GPX coordinates, share-link roundtrips, invalid links, stale-action removal, street sequences and the four-window profile on desktop and mobile. Tests validate implementation behavior; they do not establish predictive accuracy, physical accessibility or improved personal safety.

## Honest answers for judges

**Is it a safe-route predictor?** No. It models exposure to historical reports. Reporting, pedestrian activity, policing, approximate coordinates and missing incidents affect the data.

**Can I navigate with it?** The path and GPX are planning references. Current access, crossings, barriers and physical accessibility are not audited. There are no verified turn instructions. The optional Google Maps destination handoff calculates a separate route.

**What does sharing reveal?** Both endpoint coordinates, the area and planning settings. Sharing requires an explicit action. The app has no accounts or continuous location tracking; this is not a claim that external tile providers or hosting logs collect nothing.

**Can you add my city?** Compatible public data can become a new package using [Adding cities](ADDING_CITIES.md). A usable location, occurrence time, incident definition, source rights and street graph are prerequisites. São Paulo Paulista–Centro is the current LATAM package. Other LATAM jurisdictions require their own source evaluation; this does not imply region-wide coverage.

**Is it live?** Historical packages are bundled. Publication is a separate manual step described in [DEPLOY.md](DEPLOY.md); do not claim a public deployment before it exists.
