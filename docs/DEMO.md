# Brisa demo walkthrough

Start with `npm ci && npm run dev`. The default comparison loads without API keys.

1. Explain the motivation: our LATAM team wants navigation to surface context people otherwise need local knowledge to understand.
2. Show Willis Tower → Chicago Riverwalk, noon–6 pm, with eight extra minutes allowed. In the bundled snapshot, the fastest path takes 17.31 minutes and the lower-index path 17.39 minutes. The latter has approximately 30.68% lower modeled exposure. Both display as about 18 minutes because the UI rounds walking times up.
3. Select each route card. The map highlights its actual street geometry. Turn on reported incident intensity to reveal the 250 m aggregates influencing the path.
4. Set the detour budget to zero and compare again. Distinct longer alternatives disappear. Increase the budget and change the historical time window; the historical scores are recomputed, and routes may change when that changes the tradeoff. A different route is not promised for every input.
5. Open “Behind the routes.” Show the historical dates, public sources, exact model assumptions and street-segment contributions. Explain that the index measures historical reported activity along the walk, not a probability of being harmed.
6. Try the same origin and destination to demonstrate the validation state. Restore the default landmarks. Map picking supports locations near the bundled street graph; unsupported regions and points more than 75 m from a node are rejected.

## What is technically real

The bundled snapshot contains 21,232 OSM nodes, 25,669 edges, and 270 aggregate cells. The data pipeline verifies all 21,349 returned source records against the matching source count and unique IDs, then includes 3,064 eligible public-outdoor reports. The route engine integrates the intensity along the displayed geometry and searches 18 travel-time/exposure tradeoffs. Only distinct candidates within the exact added-time budget are eligible; the UI displays at most three. Returned choices are not a guarantee of globally optimal constrained routing.

The algorithm runs in the browser. All city data, graph topology, and scores are bundled; only optional background tiles depend on a runtime external service. Source data fetching is a separate reproducible ingestion step. This is a working custom route planner, not a screen overlay or prerecorded animation.

## Validation

The implementation passed 18 synthetic/real-snapshot routing tests, five Python snapshot/pipeline checks, and six browser scenarios across desktop and mobile. Browser checks cover real route selection, exact zero-detour behavior, time-window changes, source dialog/focus, truthful Google destination links, failed inputs, failed snapshot loading and recovery, and fallback streets with map tiles unavailable. Desktop and mobile screenshots were also inspected with real map tiles. `npm run build` passes. GitHub Actions runs the checks again on pushes and pull requests.

## Language to use with judges

“We make the time-versus-historical-report tradeoff visible, using an explainable model.”

“The dataset is incomplete as a picture of real harm. It is influenced by reporting and pedestrian activity, and locations are approximate. We show these limits instead of calling a route safe.”

“Google does not expose arbitrary area avoidance in its Routes modifiers. We control a bounded OSM graph to demonstrate the algorithm. The optional Google button opens only the destination; Google calculates a separate route.”

## Clear limits and next engineering steps

The demo is walking-only, covers a Chicago district, uses 2025 reports with a newer OSM graph, and does not verify current street conditions or provide turn-by-turn instructions. Way-level OSM tags are filtered; node barriers and physical accessibility are not audited. There are no accounts, location tracking, crowdsourced emergency alerts, or crime predictions.

Next steps: audit the graph with local users, evaluate category/smoothing sensitivity, test temporal and spatial holdouts, inspect a São Paulo source export, and add pedestrian-volume and lighting data only where credible. A Web Worker/API and per-city graph bundles extend the current boundaries without rewriting the UI contract.
