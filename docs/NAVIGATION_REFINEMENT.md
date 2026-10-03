# Navigation refinement: October 3

Independent agents reviewed the product as an impatient phone user, a keyboard user, an everyday NYC pedestrian, a LATAM traveler and a consumer interpreting recent reports. These are simulated user perspectives and browser observations, not field research.

| Concern | Implemented response |
| --- | --- |
| Landmark dropdowns feel like a fixed demo | Editable From/To with bounded address/place search, local suggestions, map selection and explicit device location |
| Settings dominate the main task | Collapsed Advanced options holds time window, detour budget, example reset and coverage/source details |
| Decorative cards and slogans obscure the directions | Compact header, flat route list, restrained colors and a direct selected-route explanation |
| Phone users must scroll before entering a trip | Mobile document order is controls → map → routes; desktop keeps directions beside the map |
| Dense bubbles hide streets at smaller zooms | Circles shrink with the projected 250 m cell; counts appear when there is room, with the full count available in cell details |
| New reports should appear automatically | Activity defaults ON, with foreground polling and a session-wide OFF preference |
| A fresh check could be mistaken for a fresh event | Separate source windows, publisher delays and successful-check timestamps remain explicit |

Address suggestions are selected explicitly. Typing alone cannot become a route endpoint. The adapter and UI cancel obsolete queries, reject results outside coverage, and preserve local search when the address provider fails. Device location requires a button press; denial, unsupported coverage and late callbacks cannot silently replace a different selected place.

The app still routes inside four bounded walking packages. A globally found address does not create street or incident coverage. Source definitions differ; route indices do not rank cities or predict safety. Address points and nearby graph connections are not verified entrances.

Activity is automatic, not instantaneous crime confirmation. San Francisco publishes selected unverified dispatch calls every ten minutes with additional delay; Brisa checks for releases every minute while visible. Chicago is checked hourly and NYC every six hours because their report publication is slower. Hidden tabs pause work and catch up when due; errors keep the last successful feed visibly marked. São Paulo has no verified recent feed. See [source details](RECENT_SOURCES.md).

The adversarial browser pass caught endpoint markers intercepting map selection, a search popup reopening on programmatic focus return, a small city-selector touch target, visually hidden table text extending the page and a coverage button implicitly submitting the form. Each was corrected and checked. Search, location permission, stale-response rejection, map selection, source updates and exports have desktop/mobile regressions; public API and tile requests are replaced by explicit fixtures in automated tests. A publication-change regression confirms a newly released SF call updates the bubble count automatically while preserving the selected historical route.

Manual production checks exercised all four city packages, actual Photon address selection (Empire State Building to Grand Central), shared-link restoration and worker/asset loading under `/BigRedHacks/`. Updated [desktop](screenshots/navigation-desktop.jpg) and [mobile](screenshots/navigation-mobile.jpg) captures show actual source responses, not fixture bubbles. The automated suite contains 163 TypeScript tests, 25 data checks and 90 desktop/mobile browser cases, including accessibility checks.

For larger usage, configure a suitable Photon-compatible service using [PLACE_SEARCH.md](PLACE_SEARCH.md). Shared server-side feed caching would reduce duplicate requests across viewers; faster polling cannot remove publisher delays.
