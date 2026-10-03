# Adding a coverage package

A city is supported only inside its published planning rectangle. The same route engine consumes every package. Adding a compatible source requires a configuration and data build, not a React or routing change. The catalog is generated from validated packages, and NYC is the default when present.

## 1. Establish source suitability

Use a public source with stable report IDs, occurrence dates and local times, coordinates, primary offense classifications, and enough place information to distinguish relevant outdoor reports. Check the publisher's geographic masking, date semantics, reporting delays, license, and update policy. Street labels do not prove stranger-on-stranger events; police reports are neither complete victimization counts nor a pedestrian probability of harm. Do not infer demographic attributes or use them in the model.

Select an explicit coverage rectangle, local IANA timezone, completed occurrence period, category and place allowlists. Include a nominal 750 m source halo beyond the planning boundary. Graph access and incident premises must be compatible: if park paths are allowed, investigate the source's park premises rather than silently treating parks as report-free. Categories need not match another jurisdiction, but differences must be disclosed. Every included report has weight 1; normalization is independent per package.

## 2. Create configuration

Copy `configs/cities/chicago.json` or `configs/cities/nyc.json`. Required metadata includes `id` (unique package slug), `cityId`, `city`, `district`, `region`, state/province `regionCode`, `countryCode`, `timezone`, `description`, west/south/east/north `bounds`, inclusive `periodStart`/`periodEnd`, source provenance, and landmarks/default IDs. `region` in the *catalog* is the district, while `regionCode` is the state/province code. The city config's `region` is descriptive state/province metadata.

Keep `cellSizeMeters: 250` and `haloMeters: 750` for this model. `gridReferenceLatitude` defaults to the midpoint of the planning rectangle. Provide useful public landmark coordinates inside bounds; every landmark must snap to the real walking graph within 75 m. If a landmark fails, inspect its real access point or omit it. Never fabricate a connected graph point.

Supported `source.adapter` values:

- `chicago_socrata`: Chicago field names; requires `domestic=false`, configured primary categories and places.
- `nyc_socrata`: NYPD historic field names; configured `ky_cd` categories, optional per-category `pd_cd` subtype lists, and premises. Handles separate occurrence date/time and intervals.
- `normalized_csv`: a publisher-derived local CSV with the columns below. Supply `source.name`, `source.url`, `source.path`, `source.categories` (raw category to display label), and `source.places` (explicit list). Relative paths are resolved from the repository root.

The CSV header is:

```csv
id,occurred_at,longitude,latitude,category,place
```

`id` must be nonempty and stable. `occurred_at` is local naive ISO format `YYYY-MM-DDTHH:MM:SS` (optional fractional seconds); timezone offsets and `Z` are rejected, because the config declares the local timezone. Longitude and latitude are finite decimal WGS84 degrees. `category` and `place` must exactly match configured allowlists. Extra CSV columns are ignored. The source file may cover more than the package: out-of-period and out-of-halo rows are excluded and counted. Missing IDs, duplicate IDs (first record wins), missing/invalid coordinates, malformed/nonexistent local timestamps, unsupported categories and places are excluded and counted. Missing information is never silently manufactured.

The canonical onboarding example is `scripts/fixtures/onboarding.json` with `onboarding.csv`. **Both are synthetic test fixtures**, never distributed as a real coverage package. `python3 scripts/test_data.py IngestionTests.test_synthetic_csv_build_uses_same_package_pipeline` runs this example through the same builder with a synthetic graph injected only by the test.

## 3. Build and validate

```sh
python3 scripts/build_data.py --list
python3 scripts/build_data.py --city nyc
python3 scripts/build_data.py --config /path/to/city.json --cache /tmp/brisa-city-cache
python3 scripts/build_data.py --all --refresh
python3 scripts/test_data.py
npm test
npm run build
```

The compatibility default is `--city chicago`. `--city` accepts either a city ID or package ID. Configurations inside `configs/cities/*.json` are registered automatically; `--config` adds the explicit configuration to the current catalog build. `--output-dir /tmp/review-packages` creates review artifacts outside the public app. Do not put raw incident CSVs in `public/` or commit downloaded source caches.

Downloads are cached by configuration, source and query hashes. Up to 100,000 source rows are fetched in one response; larger results use stable system-row-ID ordered pages. Results must match the counted total and contain unique nonempty report IDs; the count is checked again after extraction. Failed refreshes preserve prior complete source/graph caches. OSM caches include their exact endpoint, query and bounds; `--osm-file` accepts this wrapped format only. All selected packages and their catalog relationships validate before any output changes. Each output file is atomically replaced. A multi-file deployment still needs an atomic release mechanism; the development builder cannot make several filesystem renames one transaction.

## 4. Review what the package claims

Inspect source and eligible counts, first-match exclusions, query/configuration hashes, period and timezone, graph/component size, snap distances, and the complete grid halo. Confirm that there is useful data in each time context without claiming absence of reports equals safety. Test real origin/destination pairs near coverage edges and in parks, endpoint rejection, directed reachability, maximum detour constraints, mobile controls, and switching between packages while a route is calculating.

For a new API schema, implement normalization and source-query logic in `scripts/build_data.py`, register the adapter, and add synthetic ingestion tests covering that publisher's failure modes. Keep publisher-specific fields and taxonomies outside the shared routing engine. Document source-specific limitations in the manifest and `docs/DATA.md` before publishing.
