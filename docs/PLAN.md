# Brisa: agreed hackathon plan

Status: council decision accepted for implementation, October 2, 2026.

## Product decision

Build a responsive standalone React/TypeScript walking-route planner for a bounded Chicago Loop demo. The user approved choosing the easiest workable city and stack. The Brazilian/LATAM motivation remains the product story; Chicago is the first verified data adapter, not a claim that the same evidence applies in Brazil.

| Option | Advantages | Costs / limits | Decision |
| --- | --- | --- | --- |
| Chrome extension | Familiar desktop Maps surface; quick shortcut or comparison panel | Desktop-only; DOM integration is brittle; cannot change Google's routing cost function; extension distribution friction | Possible future launcher |
| Plugin inside Google Maps mobile app | Familiar live navigation | No documented third-party plugin surface for replacing its route objective | Not feasible for this MVP |
| Native standalone app | GPS, background navigation, full mobile experience | Two platforms, permissions, navigation lifecycle, more build time | Later |
| Standalone mobile web app | Shareable URL, phone-friendly, full control of scoring and routes, no account required | Own map/UI; route planning rather than production turn-by-turn navigation | Build now |

Google Routes exposes feature preferences such as highway/ferry/toll avoidance, not arbitrary avoidance polygons. Ranking Google's alternative routes is possible but cannot discover arbitrary custom routes. Via points can encourage a detour but Google recalculates geometry, and intermediates disable alternate-route results. Maps URLs do not preserve an evaluated polyline. Google Routes display/caching policies also constrain mixing Google route content with other basemaps. The MVP uses OSM data for both graph and display; Google is only a clearly labeled destination link. A future openrouteservice provider supports avoid polygons.

## Council rounds

1. **Independent ideation:** full-context product/user advocate, full-context implementation skeptic, and fresh-context critic considered alternatives independently. All preferred a bounded standalone planner. The fresh critic proposed verified walking corridors or lighting/active-place preferences as alternatives to crime optimization.
2. **Adversarial review:** critics challenged density versus personal risk, unsupported endpoints, false certainty from timestamps, route export, data truncation, three-route promises, alleys, arbitrary category severity and detour enforcement. Revisions: historical labeling, incident ingestion halo, snapshot count verification, public walking access filter, no guaranteed three routes, no invented confidence badge.
3. **Final red team:** the independent critic challenged normalization, spatial scale, relevance of offenses, and midnight/live semantics. Final vote was conditional go: actual connected streets, complete scoring coverage, explicit documented incident filters, real alternatives on at least one trip, honest single-route state. The owner accepted these conditions.

## Scope and acceptance

- One real OSM walking graph, one fixed 2025 historical Chicago incident snapshot, source attribution and reproducible ingestion. Bundle aggregates, not case identifiers or exact incident pins.
- Curated landmarks plus map-based endpoint selection; show snapped street endpoints, reject outside coverage, snaps over 75 m and disconnected points. Static access tags are not a sidewalk/crosswalk audit.
- Time window in 2025 records: midnight–6 am, 6 am–noon, noon–6 pm, 6 pm–midnight, all America/Chicago. One selected window applies to the whole trip; this is not a current prediction.
- Input maximum extra walking minutes. Calculate fastest plus distinct weighted shortest paths, enforce the unrounded budget, discard dominated choices, show up to three actual alternatives. Do not claim globally optimal constrained routing.
- Compare walking time, distance, added minutes and lower modeled exposure. A percentage describes the index only; never label it percent safer or probability of harm. Zero reports never means safe.
- Optional aggregate report-intensity overlay; selected route prominent, alternatives muted; source/method details and street-by-street route summary.
- Core graph and scoring work without paid API credentials or runtime API calls. Base tiles may use normal interactive OSM requests; bundled street geometry remains visible if tiles fail. No tile prefetch/offline cache.
- No demographics, home-address storage, account, tracking, emergency promises, live alerts, ML or native navigation in this version.

## Quantitative model

Use 250 m aggregate cells. Include documented street-relevant offense/place categories and exclude domestic/private contexts where fields permit. Initially use equal offense weights to avoid unsupported severity ratios. Fetch a halo of at least 500 m around the planning rectangle; preserve exclusion and missing-data counts. Verify source count against unique fetched rows. Missing coverage is unsupported, not zero.

For a cell with eligible count N, weighted all-day sum S and selected bucket sum S_b, a = N/(N+20). Activity = a × 4 × S_b + (1−a) × S. This is equivalent to shrinking a six-hour count toward S/4, expressed on a daily scale. Apply a fixed documented spatial smoothing kernel, then normalize with one dataset-wide constant Q = max(1, 90th percentile of positive activities across every cell and time bucket). Intensity = activity/(activity+Q). This is an explanatory heuristic, not a calibrated probability. Cell sizes, prior strength and weights need later sensitivity validation.

Sample each edge at most every 25 m. Walking time uses 1.35 m/s. Route exposure is the integral of walking minutes × cell intensity along its actual geometry. Candidate edge cost = minutes + lambda × exposure for several nonnegative lambda values, including zero. Enforce detour budget and deduplicate; select nondominated returned paths. Fixed scoring across all routes and buckets supports consistent comparison. Display a reduction percentage only for a meaningful nonzero baseline.

## Complexity roadmap

1. **Ship now:** true graph routing, time-aware smoothed scoring, bounded detour tradeoffs, explainable source data, unknown/unsupported states, automated algorithm/data checks.
2. **Next:** sensitivity analysis and time-held-out validation, weekday/weekend where sample sizes support it, spatial validation, mode-specific incident relevance, audited São Paulo ingestion and Portuguese/Spanish copy. Include footfall denominators only when their coverage and validity are defensible.
3. **Then:** verified lighting/sidewalk/activity/corridor layers, scalable spatial DB and per-city graph extracts, worker/server route engine, provider interface for polygon avoidance and validated route geometry.
4. **ML gate:** only after defining a measurable target and ground truth. Compare regularized count models (e.g. Poisson/negative-binomial with exposure offsets) against the simple baseline using spatial and temporal holdouts, calibration, bias/coverage audit and uncertainty. No deep-learning crime prediction for a weekend demo.

## Implementation ownership and commits

1. Owner: plan, shared types, build setup (commit first).
2. Data agent: reproducible public data ingestion, attributed snapshot, validation, provenance.
3. Routing agent: pure TypeScript graph/scoring engine, meaningful algorithm tests.
4. Interface agent: responsive map planner, controls, route cards, explanation and error states.
5. Owner: integrate and commit each coherent slice separately, run algorithm/data tests and production build, exercise browser interactions and mobile layout, fix findings in follow-up commits, push completed commits.

Use Vite/React for straightforward static deployment; no backend or secret keys on the critical path. Keep city data independent of UI, pure routing independent of React, and documented types between them. Growth to a server/worker and database should preserve this boundary.

## Primary references checked

- [Google route modifiers](https://developers.google.com/maps/documentation/routes/reference/rest/v2/RouteModifiers)
- [Google alternative route constraints](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes)
- [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)
- [Google Routes display policies](https://developers.google.com/maps/documentation/routes/policies)
- [Chrome extension availability](https://support.google.com/chrome_webstore/answer/1698338)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chicago official reported incidents](https://data.cityofchicago.org/Public-Safety/Crimes-2001-to-Present/ijzp-q8t2/data)
- [São Paulo technical methodology](https://www.ssp.sp.gov.br/estatistica/nota-tecnica)
- [São Paulo public report queries](https://www.ssp.sp.gov.br/estatistica/consultas)
- [openrouteservice polygon options](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options)
- [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/)
- [Vite setup](https://vite.dev/guide/)
- [Leaflet documentation](https://leafletjs.com/examples.html)
