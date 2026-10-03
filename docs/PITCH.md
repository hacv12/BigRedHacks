# Brisa pitch kit

## Two-minute pitch

**0:00–0:20 — Why.** “Our LATAM team's experiences inspired a question: what if a walking planner made local context visible alongside arrival time? Brisa compares walks using historical reported incidents and lets you decide how much extra walking time to allow.”

**0:20–0:50 — Show the decision.** Open `/?area=sao-paulo-centro`: Edifício Copan → Praça da Sé, noon–6 pm, eight extra minutes. Select Fastest walk, then Lower exposure if available. “These lines follow real OpenStreetMap streets. Each card shows the walking time and modeled report exposure. The extra-time budget is a constraint on every displayed choice.” Set the budget to zero and compare again.

**0:50–1:15 — Make it explainable.** Restore the budget and select Compare walking routes again. Open Street sequence and show Same walk, different windows. “These four values score this exact path against four historical local-time windows. They do not silently substitute four different routes. Street names describe the path; they are not verified turn instructions.”

**1:15–1:35 — Make it portable.** Select Share trip. “Sharing is explicit: this link contains both locations. Opening it recalculates the request. GPX preserves the selected geometry, and the summary carries its historical context.” Show coverage and point out the four-city selector. Keep another city load for questions.

**1:35–2:00 — State the boundary and next step.** “São Paulo uses 2,466 eligible pedestrian cellphone theft/robbery reports. Missing times introduce bias. This models historical reports, not your probability of harm. We compare walks within a package, never rank cities. Next: local-user street audits and sensitivity testing.”

If a distinct lower-exposure alternative is unavailable, show the explanatory message. Do not imply every request has one.

## Devpost-ready factual draft

### Inspiration

Our LATAM team's experiences made us interested in the local knowledge people use when choosing a walk. Brisa explores how a planner can expose historical context and time tradeoffs without pretending to predict personal safety.

### What it does

Brisa compares walking routes inside bounded packages for Central Manhattan, Chicago's Loop, downtown San Francisco and São Paulo's Paulista–Centro area in Brazil. Choose endpoints, a historical local-time window and an extra-time budget. Select a route to inspect its geometry, contiguous street sequence and exposure across four windows on the same path. Explicit share links reproduce the request; GPX and text downloads preserve the selected walk and its context.

### How we built it

A Python pipeline normalizes publisher-specific incident records, produces aggregate cells and imports OpenStreetMap walking graphs. TypeScript validates packages before use. A React interface sends planning work to a Web Worker, where graph searches compare walking time with a historical-report index sampled along the displayed geometry. The planner shows at most three distinct candidates within the budget. No paid routing API, account or application backend is required.

### Challenges and tradeoffs

Source definitions differ, so each package retains its own provenance and normalization. São Paulo’s complete workbook has 383,635 physical rows and 309,326 distinct publisher report keys. We consolidate the latest report versions; 32,552 distinct reports lie in the incident halo and 2,466 qualify for the pedestrian cellphone theft/robbery subset. The 19,217 halo reports excluded for missing or imprecise times make time-reporting bias a concrete limitation. The MASP access point is explicitly a reviewed Paulista surface-sidewalk node, avoiding a nearby tunnel, not a verified museum entrance. San Francisco's 160 eligible street/public-place robbery reports support a deliberately narrow demo rather than broad crime coverage. Bounded graphs keep local routing practical but do not support cross-package trips. A finite set of graph searches produces useful candidates without claiming a globally optimal constrained route. Background tiles remain an external service; bundled street geometry provides a fallback.

### What we learned

An explainable route needs more than a line: users need coverage, dates, a meaningful comparison and clear limits. Scoring the same path across time windows separates historical context from changes in route geometry. Exporting a path and sharing a request are different operations, so Brisa makes that distinction explicit.

### What's next

Audit walking access with local users; test category weights and smoothing sensitivity; evaluate temporal and spatial holdouts; and assess additional sources, including additional LATAM jurisdictions beyond the working São Paulo package. These are future work, not completed validation or supported coverage.

### Built with

React, TypeScript, Vite, Leaflet, Web Workers, Python, OpenStreetMap, NYC Open Data, Chicago Data Portal, DataSF, SSP-SP, Vitest and Playwright.

## Submission notes

Use the current local app for screenshots and record the actual returned choices. Do not describe Brisa as a deployed service unless a deployment has been completed. [Manual deployment instructions](DEPLOY.md) are separate from a live URL. See [DEMO.md](DEMO.md) for rehearsal and fallback steps; source details remain in [DATA.md](DATA.md).
