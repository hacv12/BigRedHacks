# Multi-city implementation plan

Requested October 3, 2026: support any city with usable data and include New York City.

Brisa is becoming a city-independent planner with a catalog of validated coverage packages. A package defines its real planning boundary, source, source-specific filters, local timezone, record period, default landmarks and graph. The UI discovers packages from the catalog. Adding a supported city must not require changes to React or the routing algorithm.

The next release includes Chicago Loop and a larger NYC Central Manhattan package, with actual available coverage named on screen. A city name is not a promise of entire metropolitan coverage. Additional districts and cities use the same ingestion and registration process.

Implementation slices:

1. Versioned package/catalog contracts; validate catalog and loaded datasets together.
2. Configurable source adapters for Chicago and NYPD, plus a documented normalized CSV adapter for additional jurisdictions. Source-specific field names, dates and offense/premise taxonomies stay outside the route engine. Isolate caches by configuration and verify counts before publishing.
3. Fetch and validate real NYC public records and public OSM walking geometry. Preserve provenance, excluded/invalid row counts, a complete incident halo and deterministic aggregated output. No raw incident records in the app.
4. Catalog-driven city/coverage selection, lazy loading, dynamic source and time labels, useful errors and cancellation. Switching cities must clear old locations, routes, tiles/status, and explanations; delayed requests must never overwrite the active city.
5. Indexed spatial sampling and off-thread route computation for larger graphs. Keep shared request/result contracts and retain exact detour constraints.
6. Multi-city integrity/routing tests, browser city-switch and failure tests, mobile checks, setup/onboarding instructions and incremental commits.

Each package has an independently normalized historical report index. Values and percentage reductions compare routes within the same package/time context; they do not rank cities against each other. Unknown coverage remains unsupported. Claims about live risk or universally safe routes remain out of scope.
