# Brisa demo walkthrough

Start with `npm ci && npm run dev`. The NYC comparison loads without API keys. Open `/?area=chicago-loop` to begin in Chicago instead.

1. Explain the motivation: our LATAM team wants navigation to surface context people otherwise need local knowledge to understand.
2. Show Penn Station → Grand Central Terminal, noon–6 pm, with eight extra minutes allowed. In the bundled NYC snapshot, the fastest walk takes 22.731 minutes and the lower-index walk 23.300 minutes: about 34 extra seconds for 9.876% lower modeled exposure. The cards round these to 23 and 24 minutes and a 10% reduction.
3. Select each route card. The map highlights its actual street geometry. Turn on reported incident intensity to reveal the 250 m aggregates influencing the path.
4. Set the detour budget to zero and compare again. Distinct longer alternatives disappear. Increase the budget and change the historical time window; scores are recomputed and routes may change. A different route is not promised for every input.
5. Open “Behind the routes.” Show the historical dates, public source, model assumptions and street-segment contributions. The index measures historical reported activity along the walk, not a probability of being harmed.
6. Switch “City and coverage” to Chicago · Loop. Locations, routes and settings reset to that package. Willis Tower → Chicago Riverwalk takes 17.31 minutes on the fastest path versus 17.39 minutes on the lower-index path, with approximately 30.68% less modeled exposure. Both display as 18 minutes. These percentages compare routes within each package; they do not rank NYC against Chicago.
7. Switch back to NYC and choose a different landmark pair. Try identical endpoints to demonstrate validation. Map picking supports locations near the selected street graph; unsupported regions and points more than 75 m from a node are rejected.
8. Show `configs/cities/` and [Adding cities](ADDING_CITIES.md). A city with compatible public data can be added through a configuration and normalized CSV without changing the UI or route engine.

## What is technically real

| Package | Verified source rows | Eligible reports | Aggregate cells | OSM nodes | OSM edges |
| --- | ---: | ---: | ---: | ---: | ---: |
| NYC · Central Manhattan | 90,116 | 5,497 | 1,050 | 73,021 | 91,746 |
| Chicago · Loop | 21,349 | 3,064 | 270 | 21,232 | 25,669 |

The data pipeline verifies source counts and unique IDs, applies publisher-specific eligibility rules, aggregates reports and validates real OSM walking geometry. Raw reports are never served. NYC covers a rectangle from Battery Park through Columbus Circle; Chicago covers the Loop. Neither package represents the entire city.

The engine integrates intensity along the displayed geometry and searches 18 travel-time/exposure tradeoffs. Only distinct candidates within the exact added-time budget are eligible; the UI displays at most three. Returned choices are not a guarantee of globally optimal constrained routing.

Routing runs locally in a Web Worker. The app loads the selected package's graph and aggregates; optional background tiles use an external service. Source fetching is a separate ingestion step, so the demo does not depend on live police/Overpass APIs. When tiles fail, bundled street geometry and routes remain available.

## Validation

The repository includes 42 TypeScript checks across package loading, routing, workers and both real city snapshots; 21 Python ingestion/package checks; and 20 desktop/mobile browser scenarios covering route selection, detour limits, source dialogs, city switching, stale downloads, invalid catalogs and load recovery. Browser tests suppress public tile requests. Desktop and mobile layouts were also inspected with real map tiles. `npm run build` compiles the application and its worker. GitHub Actions runs the checks on pushes and pull requests.

The cached data rebuild produces byte-identical packages and catalog. Independent NYC route sampling matches indexed exposure calculations to floating-point precision. On the development machine, default NYC route calculations took roughly 0.3–0.6 seconds, and a Battery Park → Columbus Circle comparison took roughly one second; these are local measurements, not device-independent guarantees.

## Language to use with judges

“We make the time-versus-historical-report tradeoff visible, using an explainable model.”

“The dataset is incomplete as a picture of real harm. Reporting, pedestrian activity and approximate locations affect it. We show these limits instead of calling a route safe.”

“Google does not expose arbitrary area avoidance in its Routes modifiers. We control an OSM walking graph to demonstrate the algorithm. The optional Google button opens only the destination; Google calculates a separate route.”

“The application supports a catalog of independently validated coverage packages. Adding compatible city data does not require rewriting the planner.”

## Limits and next engineering steps

The demo is walking-only, uses 2025 reports with newer OSM geometry, and does not verify current street conditions or provide turn-by-turn instructions. Way-level OSM tags are filtered; node barriers and physical accessibility are not audited. There are no accounts, location tracking, crowdsourced emergency alerts or crime predictions.

Next steps are local-user graph audits, category/smoothing sensitivity checks, temporal and spatial holdouts, and additional public data packages, including a suitable LATAM source. Larger coverage can use regional bundles or a server-side graph service. Routing across package boundaries needs graph stitching; indices with different source definitions cannot simply be combined. Add pedestrian-volume and lighting data only where credible.
