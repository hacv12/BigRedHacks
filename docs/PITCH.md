# Brisa pitch kit

## Two-minute pitch

**0:00–0:20 — Why.** “Our LATAM team's experiences inspired a question: what if a walking planner made local context visible alongside arrival time? Brisa compares walks using historical reported incidents and lets you decide how much extra walking time to allow.”

**0:20–0:50 — Show one decision.** Open `/?area=sao-paulo-centro`, expand **Advanced options**, select **Try example walk**, then collapse the options. Select a distinct lower-exposure route if available. Read its generated takeaway: the current example offers about two extra minutes for a 15% lower historical report index. “These lines follow real OpenStreetMap streets. Every displayed choice respects the extra-time budget.” Use actual returned values, not a memorized promise.

**0:50–1:20 — Show what changed.** Open **What changes from fastest?** “Here are the street sections shared by the walks, and the sections that differ. We explain the actual geometry, not an invented claim about why a street is safer.” Point to one named section and the highlighted path.

**1:20–1:40 — Make it portable.** Select Share trip. “Sharing is explicit: this link contains both locations and recalculates the request. GPX preserves the selected geometry.” Keep downloading and reopening for questions.

**1:40–2:00 — State the boundary.** “São Paulo uses 2,466 eligible pedestrian cellphone theft/robbery reports. Missing times introduce bias. This models historical reports, not your probability of harm. We compare walks within a package, never rank cities. Next: local-user street audits and sensitivity testing.”

If a distinct alternative is unavailable, show the explanation honestly. Keep zero-budget proof, the four-window profile, bundled offline street search, and SF's delayed unverified dispatch bubbles for optional questions; see [DEMO.md](DEMO.md). The core presentation stays on one Brazil walking decision.

## Devpost-ready factual draft

### Inspiration

Our LATAM team's experiences made us interested in the local knowledge people use when choosing a walk. Brisa explores how a planner can expose historical context and time tradeoffs without pretending to predict personal safety.

### What it does

Brisa compares walking routes inside bounded packages for Central Manhattan, Chicago's Loop, downtown San Francisco and São Paulo's Paulista–Centro area in Brazil. Type addresses, places or streets in From/To and select a suggestion; local map references and explicit device location are also available. Historical time windows and the extra-time budget live in Advanced options. Select a route to inspect its geometry, contiguous street sequence and exposure across four windows on the same path. Explicit share links reproduce the request; GPX and text downloads preserve the selected walk and its context.

A default-on activity layer with an OFF option adds automatically refreshed aggregate bubbles without changing historical route scores. SF uses selected unverified dispatch calls from the past 48 hours, refreshed by the source every ten minutes with an additional ten-minute delay. NYC and Chicago show 30-day windows ending on their latest published occurrence dates: NYC releases quarterly; Chicago updates daily and omits at least the latest seven days. São Paulo has no verified recent feed. Activity requires network access and has explicit failure states, not fixture fallback.

### How we built it

A Python pipeline normalizes publisher-specific incident records, produces aggregate cells and imports OpenStreetMap walking graphs. TypeScript validates packages before use. A React interface sends planning work to a Web Worker, where graph searches compare walking time with a historical-report index sampled along the displayed geometry. The planner shows at most three distinct candidates within the budget. No paid routing API, account or application backend is required.

### Challenges and tradeoffs

Source definitions differ, so each package retains its own provenance and normalization. São Paulo’s complete workbook has 383,635 physical rows and 309,326 distinct publisher report keys. We consolidate the latest report versions; 32,552 distinct reports lie in the incident halo and 2,466 qualify for the pedestrian cellphone theft/robbery subset. The 19,217 halo reports excluded for missing or imprecise times make time-reporting bias a concrete limitation. The MASP access point is explicitly a reviewed Paulista surface-sidewalk node, avoiding a nearby tunnel, not a verified museum entrance. San Francisco's 160 eligible street/public-place robbery reports support a deliberately narrow demo rather than broad crime coverage. Bounded graphs keep local routing practical but do not support cross-package trips. A finite set of graph searches produces useful candidates without claiming a globally optimal constrained route. Background tiles remain an external service; bundled street geometry provides a fallback.

### What we learned

An explainable route needs more than a line: users need coverage, dates, a meaningful comparison and clear limits. Scoring the same path across time windows separates historical context from changes in route geometry. Exporting a path and sharing a request are different operations, so Brisa makes that distinction explicit.

### What's next

Audit walking access with local users; test category weights and smoothing sensitivity; evaluate temporal and spatial holdouts; and assess additional sources, including additional LATAM jurisdictions beyond the working São Paulo package. These are future work, not completed validation or supported coverage.

### Built with

React, TypeScript, Vite, Leaflet, Web Workers, Python, OpenStreetMap, NYC Open Data, Chicago Data Portal, DataSF, SSP-SP, Photon, Vitest and Playwright.

## Submission notes

Use the current local app for screenshots and record the actual returned choices. Do not describe Brisa as a deployed service unless a deployment has been completed. [Manual deployment instructions](DEPLOY.md) are separate from a live URL. See [DEMO.md](DEMO.md) for rehearsal and fallback steps; historical source details remain in [DATA.md](DATA.md). See [LIVE_ACTIVITY.md](LIVE_ACTIVITY.md) and [RECENT_SOURCES.md](RECENT_SOURCES.md) for the optional activity layer; [DEMO.md](DEMO.md) includes a separate 30-second SF segment.
