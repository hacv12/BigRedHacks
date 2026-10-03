# Latest activity: design decision

The app's historical route model and its latest-activity overlay answer different questions. Routes compare a fixed 2025 report index. The overlay shows what an independently identified public source has published, at that source's cadence. Enabling or refreshing it never changes route geometry or percentages.

## Council and adversarial review

The source researcher verified official metadata and bounded API responses. The implementation reviewer evaluated public API access, cancellation, limits and static hosting. The user-side reviewer challenged misleading locations, freshness, accessibility and route implications. Their shared recommendation is an opt-in, source-specific layer with fixed-area bubbles and explicit dates.

| Option | Benefit | Problem | Decision |
| --- | --- | --- | --- |
| Individual incident pins | Easy to inspect | Publisher locations are approximate; pins imply exact events and can overexpose locations | Do not use |
| Screen-space clusters | Reduces clutter | Group geography and counts change with zoom | Possible later at larger scale |
| Fixed 250 m aggregate bubbles | Stable geography, visible counts, matches existing grid | Nearby circles can overlap | Use counts, bounded square-root radius, selected cell outline and accessible list |
| Time-fading circles | Visually emphasizes recency | Fading can imply that danger has passed | Defer; show actual dates |
| Recent events directly reweight routes | Appealing immediate response | Calls are unverified; source delays and units differ; no calibrated model | Defer until evaluated |

## Source decisions

- San Francisco: selected non-sensitive police dispatch types, rolling 48 hours, updated every 10 minutes with a further 10-minute delay. Calls are unverified and multiple calls can describe one real event. No claim that calls occurred outdoors.
- NYC: latest published 30-day occurrence window from the current-year complaint source. Quarterly publication is prominently disclosed; a fresh request does not make the events recent.
- Chicago: latest published 30-day occurrence window using eligible public-place reports. Daily publication excludes the latest seven days, and observed delays can be longer.
- São Paulo: retain historical routing and state that no suitable recent feed is connected. Do not repackage the annual workbook as live activity.

Source evidence, filters and exact APIs are documented in [RECENT_SOURCES.md](RECENT_SOURCES.md). NYC/Chicago windows end at the source's latest nonfuture occurrence date, not the viewer's current date. A maximum timestamp describes the newest observed record, not guaranteed completeness through that time.

## Interface and data boundaries

Bubble count is a count of qualifying source records/calls, not victims, severity, danger radius or predicted risk. Selection outlines the represented cell and exposes category counts, event/receipt dates and approximate-location context. A keyboard-accessible list offers the same selections. Routes remain visually above bubbles; endpoint picking temporarily disables bubble interaction.

Three clocks remain distinct: event occurrence or call receipt in the source's timezone; publisher update time when available; and the app's last successful check. Failed refreshes preserve the last successful data with a visible error. An unavailable or invalid response must not become a zero-count success.

The prototype makes bounded anonymous requests directly to allowlisted official APIs after the user enables the layer. It uses no location tracking, private API keys or persistent report storage. Minimal source fields are normalized in memory, then aggregated; addresses, people and dispatch free-text notes are not requested. Requests use the coverage boundary, never trip endpoints. Disabling the layer or switching cities cancels pending requests. Refreshing pauses when the page is hidden; rapid manual requests are throttled.

For larger traffic, use a scheduled service to fetch and validate each source once, publish only aggregate snapshots with freshness metadata, and let clients poll the same-origin manifest. The current contracts isolate that future transport change from the map and routing engine.
