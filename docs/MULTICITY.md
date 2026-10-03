# Multi-city architecture and implementation

Requested October 3, 2026: support any city with usable data and include New York City.

Brisa is a city-independent planner with a catalog of validated coverage packages. A package defines its real planning boundary, source, source-specific filters, local timezone, record period, default landmarks and graph. The UI discovers packages from the catalog. Adding a city using the normalized CSV contract requires no changes to React or the routing algorithm; a different public API schema requires an ingestion adapter.

The release includes NYC Central Manhattan, Chicago Loop, San Francisco Downtown and São Paulo Paulista–Centro, with actual available coverage named on screen. NYC opens by default and covers a rectangle from Battery Park through Columbus Circle. A city name is not a promise of entire metropolitan coverage. Additional districts and cities use the same ingestion and registration process, documented in [ADDING_CITIES.md](ADDING_CITIES.md).

Completed implementation slices:

1. Versioned package/catalog contracts; validate catalog and loaded datasets together.
2. Configurable source adapters for Chicago and NYPD, plus a documented normalized CSV adapter for additional jurisdictions. Source-specific field names, dates and offense/premise taxonomies stay outside the route engine. Isolate caches by configuration and verify counts before publishing.
3. Fetch and validate real NYC public records and public OSM walking geometry. Preserve provenance, excluded/invalid row counts, a complete incident halo and deterministic aggregated output. No raw incident records in the app.
4. Catalog-driven city/coverage selection, lazy loading, dynamic source and time labels, useful errors and cancellation. Switching cities must clear old locations, routes, tiles/status, and explanations; delayed requests must never overwrite the active city.
5. Indexed spatial sampling and off-thread route computation for larger graphs. Keep shared request/result contracts and retain exact detour constraints.
6. Multi-city integrity/routing tests, browser city-switch and failure tests, mobile checks, setup/onboarding instructions and incremental commits.

Each package has an independently normalized historical report index. Values and percentage reductions compare routes within the same package/time context; they do not rank cities against each other. Unknown coverage remains unsupported. Claims about live risk or universally safe routes remain out of scope.

## Review decisions

The implementation and independent review retained regional packages instead of claiming citywide coverage from a small graph. New York's complete 90,116-row source extraction and 73,021-node walking graph fit the browser approach without shrinking the selected rectangle. The 22.2 MB uncompressed NYC package loads only when selected. Spatial indexing and a Web Worker keep graph search off the UI thread; deployment should enable HTTP compression for JSON. Further scale requires smaller regional packages or a graph service, and routing across package boundaries requires explicit graph stitching.

Source review rejected treating NYPD and Chicago offenses as equivalent. NYPD has no domestic relationship flag, includes uncertain occurrence intervals and can fall back to precinct coordinates. The adapter filters unsuitable categories and intervals and publishes the remaining limitations. Parks are included in both the walking network and eligible premises. The UI displays the selected package's source, period and timezone, and explicitly limits index comparisons to that package.

Lifecycle review covered switching cities during downloads and planning, failed packages, invalid catalogs, unknown deep links and recovery. City changes abort downloads, terminate the previous worker, remove the old map and reset endpoints, routes and settings. Package identity, metadata, full grid coverage and graph integrity are validated before display.

Independent route checks reproduced the indexed NYC exposure calculations with the original linear cell lookup to within floating-point precision. Penn Station → Grand Central takes 22.731 minutes on the fastest path; the noon–6 pm lower-index candidate takes 23.300 minutes with 9.876% less modeled exposure. These are properties of the bundled historical model, not observed reductions in victimization. Refreshing sources can change the results.

## Overnight review and additions

An independent product review prioritized the street sequence, explicit share/export actions, coverage controls and mobile feedback. The four-window chart scores the same selected geometry throughout; it does not disguise route changes as a time effect. The engine reuses its existing edge integrals, preserving the original route objective and exact detour limits.

Source reviews added SF with a deliberately narrow street/public-place robbery filter, then São Paulo with actual pedestrian cellphone theft/robbery records. The SSP workbook joins objects, people and offenses, so publisher report identity and highest-version consolidation happen before aggregation. Missing or imprecise occurrence times are excluded and disclosed. These packages remain independently normalized and cannot rank cities.

The São Paulo geometry review caught MASP snapping onto a tunnel beneath Paulista. The selectable landmark now pins a reviewed surface sidewalk node and fails a future rebuild if that node disappears. This is a specific corrected access point, not a general accessibility audit. Copan → Sé supplies a useful default comparison in all four historical windows.

Browser review verified selected-path GPX coordinates, shared-trip restoration, malformed-link recovery, stale-action removal, map-picker feedback and desktop/mobile layouts. Accessibility testing led to stronger contrast and a keyboard-focusable street list. Fonts are bundled locally. A production build was exercised under `/BigRedHacks/` with all four city workers and a shared-link reload. Publishing remains a separate manual action; [DEPLOY.md](DEPLOY.md) records the prepared workflow.
