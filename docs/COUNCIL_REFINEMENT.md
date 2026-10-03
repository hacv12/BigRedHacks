# Product and engineering council: October 3

This records the earlier review. The subsequent [navigation refinement](NAVIGATION_REFINEMENT.md) supersedes its local-only endpoint search and activity defaults with address search and default-on updates.

Three independent agent reviews represented hackathon-judge, prospective-user and senior-engineering perspectives. The user review inspected desktop and mobile browser flows; these are usability observations, not a field user study.

| Perspective | Finding | Agreed action |
| --- | --- | --- |
| Judges | A route's benefit requires mentally combining several card values | Generate a concise selected-versus-fastest takeaway from actual route results |
| Judges | The core demo attempts too many controls | Center it on one Brazil walk, one tradeoff, one explanation and sharing; keep additional features for questions |
| Users | Source details and recent activity appear before the main trip controls | Condense coverage metadata and move the activity panel below the planner |
| Users | Map picking depends on a mouse; landmark choices alone are restrictive | Add keyboard map-center confirmation and local street/landmark search with explicit reference-point semantics |
| Engineers | Stalled catalog/package fetches can leave indefinite loading | Add bounded header/body deadlines and recoverable messages |
| Engineers | Rapid edits queue obsolete worker requests | Keep one active search and only the latest waiting request, preserving the prepared graph |
| Engineers | Manual publishing does not include the browser validation used by CI | Require the browser suite before uploading the deployment artifact |

## Adversarial corrections and boundaries

An initial report that mobile map selection failed to scroll was retracted after allowing the existing smooth-scroll animation to finish. The revised flow improves immediacy and keyboard completion; it is not evidence of a previously broken scroll implementation.

Street-difference explanations use actual graph edge traversals, not guesses from whole street names. The named examples are the two longest differences on each path; the measured shared/different distances include all traversed edges. They never attribute a detour to lighting, accessibility or verified danger. Matching street names can represent different sections, which the explanation states. Approximate time/reduction wording avoids rounding small improvements to zero.

Local search uses the bundled, bounded walking graph and existing landmarks. A street result centers a known graph-node reference; it is not an address, entrance, or street-access audit. The user confirms the map point. No external geocoder or address-history store is added.

Recent dispatch calls remain informational. More cities, prediction models, emergency alerts, accounts, location tracking and fragmented localization were deferred in favor of a clearer, more reliable walking decision.

The final engineering pass caught pending route results recentering the map during endpoint selection. A real-worker delayed-response test reproduces a greater-than-one-kilometre unintended shift without the guard and preserves the chosen reference within one metre with it. Integration also corrected interrupted loads on same-city reselection and kept the mobile tradeoff shortcut compact enough to preserve the tested activity-bubble interaction.

## What the project verifies

- Connected OSM geometry and complete historical scoring coverage for displayed paths.
- Every displayed candidate satisfies the exact, unrounded added-time budget.
- The selected geometry matches GPX output; shared requests are validated and recalculated.
- Source-specific definitions, timing, coverage and report/call units remain explicit.
- Cancellation, stalled loading, superseded requests and keyboard interactions have targeted checks.

These checks do not establish predictive accuracy, current street access, physical accessibility or a personal-safety benefit. The original architecture council remains in [PLAN.md](PLAN.md); current city and feed scope lives in [MULTICITY.md](MULTICITY.md) and [LIVE_ACTIVITY.md](LIVE_ACTIVITY.md).

Local validation for this round passed 144 unit tests, 25 Python data checks and 66 desktop/mobile browser tests, including automated accessibility checks. A production build under `/BigRedHacks/` loaded and planned all four cities, restored a shared request, exercised local search and example reset, and loaded its worker/assets without local HTTP errors. Updated demo captures are linked from [DEMO.md](DEMO.md).
