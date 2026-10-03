# Brisa phone app

Brisa has Android and iOS projects built with Capacitor, plus an installable web app. All three reuse the same planner and city data. The native apps bundle all four walking packages; no web deployment or Google key is required to calculate historical routes in the native app.

## Get the Android demo

Open the latest successful **[Build phone apps](https://github.com/hacv12/BigRedHacks/actions/workflows/mobile.yml)** run. Download the `brisa-android-debug` artifact, unzip it and transfer `app-debug.apk` to your Android phone. Open the APK and allow installation from the app you used to open it when Android asks. This is a debug build for the hackathon, not a Play Store release. Android 7 or newer is required.

CI signs debug builds with a temporary development certificate. A later CI build may require uninstalling the previous demo before installing the new one. This removes that installation's local app cache. Production distribution needs a team-owned signing key and release build.

The same workflow compiles an unsigned **iOS Simulator** app and uploads `brisa-ios-simulator`. It cannot be installed on a physical iPhone. On a Mac with Xcode, unzip `Brisa-iOS-Simulator.zip`, start a simulator and use `xcrun simctl install booted App.app` followed by `xcrun simctl launch booted com.bigredhacks.brisa`.

## Build or run from the repo

Use Node 22.12+ and install dependencies:

```sh
npm ci
npm run app:sync
npm run app:android  # opens Android Studio after rebuilding/syncing
npm run app:ios      # opens Xcode after rebuilding/syncing
```

Android builds need Java 21 and Android SDK 36. With those tools configured, run `./gradlew assembleDebug` from `android/`; the APK is `android/app/build/outputs/apk/debug/app-debug.apk`. iOS builds need full Xcode 26+, not only the command-line tools. The generated project uses Swift Package Manager, so CocoaPods is unnecessary. See the [official Capacitor environment guide](https://capacitorjs.com/docs/getting-started/environment-setup).

To run on a physical iPhone, open the App target's **Signing & Capabilities**, select your development team and run on your connected device. A public App Store/TestFlight release additionally requires the team's Apple signing and distribution setup. No store submission is performed by these scripts or workflows.

`npm run build:native` always builds with a root asset path and `VITE_NATIVE=1` into `dist-native/`. `npm run app:sync` then copies that build into both projects. This keeps web hosting prefixes and service workers out of the native WebView. Commit native project configuration; generated web copies, SDK paths, build outputs and signing keys are ignored. Rebuild and sync after changing app code or data.

## Install from a browser

After the web build is served over HTTPS, open **Advanced options → Install Brisa**. Supporting browsers show an install button; on iPhone, use Safari's **Share → Add to Home Screen**. Installation metadata and offline caching are production-build features, so use `npm run build` and `npm run preview` for local development checks. A phone cannot reach your Mac through its own `localhost` address.

The web app saves its shell and the areas you open. It does not download every city on first visit. Use the offline status inside Install Brisa to check which packages are saved. Browser storage can be evicted; the native app is the more dependable prepared offline demo. See [PWA details](PWA.md).

## Phone behavior

- Native GPS is requested only by **Use my location**. No continuous or background location tracking is enabled.
- Native GPX/text export opens the system share sheet, allowing the user to choose a destination for the file.
- Android Back closes the methodology dialog or map picker first, closes active suggestions, returns to the top of a scrolled screen, then backgrounds the app.
- External HTTPS source links open a system browser view. Foreground activity polling pauses when the native app is backgrounded.
- Notches, system bars and home indicators are accounted for; phone controls use larger touch targets.

Native Share trip can send the route summary immediately. To enable shareable web links, set `VITE_PUBLIC_APP_URL` to the actual deployed HTTPS app URL, including its path, then rebuild. Leave it empty before deployment: the app deliberately avoids sharing an unusable WebView `localhost` URL. All `VITE_` configuration is public; no private keys belong there.

Bundled historical routes and local place names work offline. Address search, background map tiles and recent activity require a connection. Recent activity remains limited by source delays: the app does not convert published reports into instantaneous crime alerts. Phone builds retain the same bounded coverage, historical-index limitations and separate Google Maps handoff as the web planner.

See [native plugin behavior](NATIVE_FEATURES.md), [app visuals](APP_VISUALS.md), and [web deployment](DEPLOY.md). Native compilation, mocked bridge tests and responsive browser checks do not replace checking permissions, keyboard behavior and share destinations on the team's actual phones before a public release.
