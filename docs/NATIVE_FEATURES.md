# Native platform behavior

The iOS/Android app uses Capacitor 8 plugins behind `src/platform/native.ts`. The web planner keeps browser location, clipboard and file-download behavior. Location and sharing calls occur only after the corresponding user action; app lifecycle and Android Back listeners initialize automatically. No location watcher, background tracking or automatic sharing is added.

## Location and external pages

`requestCurrentPosition` uses the native [Geolocation plugin](https://capacitorjs.com/docs/apis/geolocation) on-device and browser geolocation on the web. Permission denial maps to the existing recoverable location error. The caller's generation token still rejects late callbacks after editing, map selection or city switching. The adapter requests a single high-accuracy fix, allows a cached position up to 60 seconds old and waits up to ten seconds. This is a chosen starting point, not turn-by-turn tracking or a verified entrance.

Native configuration needs foreground coarse/fine location permissions on Android. The official plugin documentation requires both `NSLocationWhenInUseUsageDescription` and `NSLocationAlwaysAndWhenInUseUsageDescription` strings on iOS because of its underlying library, even though this app never requests background location. Do not enable background-location capabilities. Native permission prompts and accuracy behavior must be checked on physical devices.

HTTPS external pages open using Capacitor [Browser](https://capacitorjs.com/docs/apis/browser), leaving the bundled planner available. Other URL schemes and embedded credentials are rejected by this helper. Clipboard writes use [Clipboard](https://capacitorjs.com/docs/apis/clipboard) on native platforms and the browser clipboard API on the web; failures leave the displayed link available for manual copying.

## Foreground activity

`initNativeLifecycle()` runs once before rendering and combines native App activity with document visibility. A WebView can remain document-visible while its app is backgrounded, so both conditions must permit polling. Native background events cancel in-flight activity fetches; foreground events resume the existing cache/cooldown logic. Browser visibility events still work unchanged. A late initial-state response cannot overwrite a newer lifecycle event, and cleanup removes listeners even when registration is still pending. If native activity state cannot be obtained, polling pauses and a `brisa:platformerror` event carries a user-facing explanation. This helper does not handle Android Back or external links.

## Sharing and exports

A WebView origin such as `capacitor://localhost` or `https://localhost` cannot produce a useful shared trip link. Set `VITE_PUBLIC_APP_URL` to the **already deployed public HTTPS app URL**, including its hosting path, then rebuild/sync the native app. The helper preserves the encoded trip query while replacing the WebView origin/path with that configured address. It rejects localhost, local/private IPs, credentials, query strings and fragments in the configured base. Configuration does not publish a site or establish that the URL is reachable. Web-browser sharing retains its existing current-site URL behavior.

Without a valid public URL, native Share trip explicitly offers a route summary rather than a broken link. With a public URL, the UI first discloses that both locations are included, then offers copying or a system share sheet. The [Share plugin](https://capacitorjs.com/docs/apis/share) shares the selected route's text summary and, when configured, its reproducible link. Cancellation/failure is recoverable and does not change the route.

Native GPX/text exports write exact existing export contents to the app's `Directory.Cache/brisa-exports` via [Filesystem](https://capacitorjs.com/docs/apis/filesystem), then pass that file URI to the system share sheet. This avoids WebView blob-download assumptions. GPX contains the selected route coordinates; text contains its street sequence and historical context. Nothing is uploaded automatically. The recipient app controls where a shared copy is stored.

Before an export, cleanup attempts to retain the nine newest owned cache files and removes owned files older than seven days, then writes the new export. Cleanup only touches matching generated filenames in that dedicated cache subdirectory; unrelated files and directories are untouched. OS cache eviction or cleanup failure does not invalidate the route. Files are not removed immediately after opening the share sheet because recipient apps may still need them. Cache storage does not require public external-storage permissions. File sharing uses Capacitor's cache FileProvider support on Android.

The official Filesystem plugin requires an iOS `PrivacyInfo.xcprivacy` entry for `NSPrivacyAccessedAPICategoryFileTimestamp`, recommended reason `C617.1`. Native scaffold configuration and store disclosures must match actual plugins and behavior.

## Verification boundary

Unit tests exercise plugin selection, public-link validation, permission-error mapping, native clipboard/browser delegation, cache-only export contents/URIs, scoped cleanup, and failure handling with mocked native bridges. TypeScript compilation verifies installed plugin APIs. These checks are not a substitute for running native builds: verify location grant/denial, share cancellation, GPX/text recipient handling, external browser return and clipboard on actual iOS/Android devices before release. No App Store or Play Store publication is implied.
