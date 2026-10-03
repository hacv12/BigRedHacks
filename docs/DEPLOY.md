# Optional GitHub Pages publishing

Publishing support is prepared; adding these files does not publish the site. The workflow is manual-only: ordinary pushes and pull requests run validation but do not deploy. No GitHub settings have been changed by this implementation.

The expected project URL, after an authorized successful deployment, is [hacv12.github.io/BigRedHacks/](https://hacv12.github.io/BigRedHacks/). This is an expected destination, not confirmation of a live deployment.

## Validate locally before publishing

```sh
npm ci
npm test
python3 scripts/test_data.py
BASE_PATH=/BigRedHacks/ npm run build
BASE_PATH=/BigRedHacks/ npm run preview -- --port 4173
```

Open `http://127.0.0.1:4173/BigRedHacks/`. Confirm all four cities load, a route comparison completes through the worker, the brand/home link stays within `/BigRedHacks/`, and shared links reload the selected trip under that path. Check the favicon and browser network panel: scripts, worker, catalog and city datasets should have no 404s. Exercise downloads and the mobile layout. Check default-on latest activity in SF, NYC and Chicago: verify official API requests pass CORS, bubbles load, and source dates/window labels remain visible. São Paulo should explain that no verified recent feed is available. Disable networking to confirm an explicit unavailable/stale state without fixture substitution; historical routing should remain separate. The existing end-to-end suite uses the default root development server; subpath production validation is a separate check.

`BASE_PATH` is read by `vite.config.ts` at build/preview startup. Its default is `/`, preserving ordinary root hosting. Use a leading and trailing slash for a subdirectory, such as `/BigRedHacks/`. Vite rewrites bundled assets and worker URLs; runtime data loaders prepend Vite's `import.meta.env.BASE_URL` to the validated catalog/package paths. The packaged catalog stays host-independent. Rebuild with the appropriate base when moving to another host. Run `npm run build` without `BASE_PATH` to restore a root-hosted local build.

## One-time setup, when publishing is authorized

A repository administrator selects **Settings → Pages → Build and deployment → Source: GitHub Actions**. The deployment workflow must be on the repository's default branch to appear as a manually runnable workflow. Keep the `github-pages` environment's permitted deployment branches aligned with the branch you intend to publish. GitHub documents this setup in [configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

The workflow uses GitHub's built-in token and OIDC identity; no personal access token, repository secret, cloud account or API key is required. Its build job has read access; only the deployment job receives `pages: write` and `id-token: write`. This follows [GitHub's custom Pages workflow model](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Publish a reviewed revision

After publication is authorized and local/CI checks pass:

1. Commit and push the reviewed source, aggregate packages and workflow together.
2. Open **Actions → Publish Brisa to GitHub Pages → Run workflow** and select the approved branch.
3. The build job installs locked dependencies, runs TypeScript/unit and offline data tests, derives the base path from the configured Pages site, builds the complete `dist/` directory, then runs the desktop/mobile browser suite before uploading it as one Pages artifact.
4. The deployment job publishes that artifact. Open the actual URL reported by its `github-pages` environment, and repeat the city-switch, route, worker and shared-link checks on HTTPS. Verify the default-on activity layer, official-feed CORS and visible source freshness on the deployed origin.

The workflow uses current official actions: [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node), [configure-pages](https://github.com/actions/configure-pages/releases/tag/v6.0.0), [upload-pages-artifact](https://github.com/actions/upload-pages-artifact/releases/tag/v5.0.0), and [deploy-pages](https://github.com/actions/deploy-pages/releases/tag/v5.0.1). It has no automatic deployment trigger. A failed build never reaches the deploy job; concurrent deployments are serialized.

All code, catalog and city packages ship together. Do not update a deployed catalog separately from its snapshots. The public artifact includes only aggregate incident grids and walking geometry—not private source caches or individual reports. The optional activity layer fetches minimal official records transiently in the browser; those records are not deployment artifacts. No historical source refresh occurs during deployment; source refreshes are a separate reviewed data-build operation.

## Operational notes

GitHub Pages serves static files; planning runs in the browser's worker. Latest activity starts ON and requires official-feed network access; users can switch it OFF. Brisa checks SF every minute, Chicago hourly and NYC every six hours while visible. Typed address searches use the configured Photon-compatible endpoint (the public Photon demo by default); local place search works without it. SF dispatch updates every ten minutes with an additional ten-minute delay over a 48-hour window; NYC is quarterly and Chicago daily with at least seven days of omitted recent incidents. NYC/Chicago display explicit latest-published 30-day windows. These bubbles do not change historical route scores. See [LIVE_ACTIVITY.md](LIVE_ACTIVITY.md) and [RECENT_SOURCES.md](RECENT_SOURCES.md). External map tiles still require network access and obey the configured provider's availability and terms. If tiles fail, bundled streets and route geometry remain available. A fresh visit still needs to download the app and selected package, so this is not an offline-installable application.

If Pages reports a missing site, complete the one-time settings step first. If deployment is rejected, inspect the environment's branch/protection rules. If assets request `/assets/` or `/data/` instead of `/BigRedHacks/...`, rebuild with the correct base; do not patch generated output manually. To roll back, manually run this workflow on a reviewed branch containing the previously validated source and matching datasets, subject to the same environment rules.
