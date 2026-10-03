# Installable web app and offline areas

The production web build is an installable PWA. In Advanced options, open **Install Brisa**. Chromium may offer an install button; on iPhone/iPad use Safari → Share → Add to Home Screen. Browser installation availability varies. This is separate from the native Capacitor build.

On the first successful online visit, Brisa saves its app shell, local fonts, routing worker, icons and coverage catalog. It saves only city packages you actually open, including the first loaded package without a second download. It does not download all four packages in advance. A saved area can calculate routes offline using the bundled historical model. Map tiles, remote address search and recent activity still require internet; the street overlay and local street/landmark search remain available.

Storage can fail or be evicted by the browser. Check the visited-area count in Install Brisa, and reopen the needed area online before relying on offline access. Existing recent-activity results are not a persistent offline feed.

## Updates and privacy

Each build has a content revision. Core assets are verified before installation succeeds; whole city JSON packages are verified against that build before they enter its cache. A mismatched deployment returns an unavailable response instead of combining versions. App updates wait for the explicit **Update and reload app** action. This reload loses an unsaved trip: save a share link first. Activating an update preserves previously saved city packages only when their content matches the new build, then removes the old caches. Changed packages require reopening that area online.

Only allowlisted same-origin app assets and city packages are cached. Tiles, geocoder responses and official activity feeds are never cached by this service worker. Query-bearing resource requests bypass it. Navigation uses the canonical app-shell cache key, so coordinate-bearing share URLs do not become cache entries. Browser history is a separate browser feature.

HTTPS is required outside localhost. `BASE_PATH` must be a root-relative path ending in `/`; manifest scope, startup URL and worker scope use that same path. `VITE_NATIVE=1` excludes the PWA build output and disables web registration/install UI. Development mode does not register a worker.

## Verification

Worker regression tests:

```sh
npx vitest run src/pwa/service-worker.test.ts
```

Production browser smoke (three terminals, with Chromium installed):

```sh
npx vite build --outDir /private/tmp/brisa-pwa-build --emptyOutDir --base /pwa-test/
npx vite preview --outDir /private/tmp/brisa-pwa-build --base /pwa-test/ --host 127.0.0.1 --port 4175 --strictPort
PLAYWRIGHT_CHANNEL=chrome node scripts/pwa-smoke.mjs
```

Omit `PLAYWRIGHT_CHANNEL=chrome` to use Playwright's installed Chromium. `PWA_TEST_URL` overrides the default `http://127.0.0.1:4175/pwa-test/`. The smoke uses a fresh browser context, blocks public network requests, verifies only the visited package is cached without a duplicate download, and reloads/calculates routes offline. It does not validate OS installation prompts or physical iOS device behavior.
