# Building MitaPesa as a real .apk / .ipa (Capacitor)

## What's already done for you

- `capacitor.config.json` - app ID `com.dugapay.mitapesa`, points at this
  project's own `dist` build output. (Originally a `.js` file, but
  Capacitor's CLI didn't reliably read values from the ES Module syntax
  this project's `"type": "module"` setting requires - JSON sidesteps
  that entirely, and it's the format Capacitor's own tooling generates by
  default anyway.)
- `package.json` - Capacitor core/CLI added as dependencies, plus three
  new scripts: `cap:sync`, `cap:android`, `cap:ios`.
- Verified `src/api.js` already always calls the real production backend
  (`https://mitapesa-api.dugapay.com`) regardless of where the
  app is running - a packaged app has no "current website" to infer a
  backend URL from the way a browser does, so this matters and it's
  already handled correctly.

## Compatibility check - good news

Three browser APIs this app uses were checked for how they behave inside
a native WebView, since that's a common source of surprises when wrapping
a web app:

- **Voice logging** (Web Speech API) - often unavailable inside embedded
  WebViews. Already handled: the app checks for support and shows an
  honest "voice input isn't supported, please add manually" message
  rather than crashing or (the old, since-fixed behavior) fabricating a
  fake transcript.
- **Biometric login** (WebAuthn) - checks `PublicKeyCredential`
  availability with a try/catch, falls back to password login cleanly if
  unsupported.
- **Receipt camera capture** - genuinely needs one manual step: iOS
  requires explicit privacy usage descriptions in `Info.plist` before it
  will open the camera at all, even for a plain HTML file input like this
  app uses (not just the dedicated Capacitor Camera plugin). Without
  these keys, tapping to scan a receipt does nothing - no error, no
  crash, just silence. See "Camera not responding on iOS" below for the
  exact fix - this was incorrectly described as working out of the box
  in an earlier version of this guide.

None of these needed code changes to be safe to wrap - they already fail
honestly rather than silently.

## Prerequisites

- **For the Android build (.apk)**: Android Studio (developer.android.com/studio), any OS (Windows/Mac/Linux)
- **For the iOS build (.ipa)**: a Mac with Xcode (developer.apple.com/xcode) - this is a hard Apple requirement, there's no way around needing a real Mac for this specific step
- Node.js already installed (you have this, since you're running this project already)

## One-time setup

From inside the `mitapesa-frontend` folder:

```
npm install
```

**Skip `npx cap init`** - `capacitor.config.js` already exists in this
project (app ID `com.dugapay.mitapesa`, app name "MitaPesa" already set), so
running `cap init` will fail with an error about a "non-JSON
configuration file" since it tries to create a fresh config that
conflicts with the one already here. There's nothing `cap init` would add
that isn't already in place - go straight to adding platforms below.

Add each platform you want to build for:

```
npx cap add android
npx cap add ios
```

This creates two new folders, `android/` and `ios/` - these are real
native project folders (Android Studio / Xcode projects respectively).
They get committed to your repo like any other project files.

**Note**: `@capacitor/android` and `@capacitor/ios` are already listed in
`package.json`, so `npm install` (the one-time setup step above) already
pulled them in - `cap add` needs the platform package present first, it
does not install it for you.

## Building the Android .apk

```
npm run cap:android
```

This builds the web app, syncs it into the native Android project, and
opens Android Studio. From there:
1. Let Gradle finish syncing (first time takes a few minutes)
2. Build -> Build Bundle(s) / APK(s) -> Build APK(s)
3. The `.apk` lands in `android/app/build/outputs/apk/debug/`

That debug APK can be installed directly on an Android phone for testing
(enable "Install from unknown sources" on the phone first). A real
Play Store release needs a signed release build, which Android Studio's
Build -> Generate Signed Bundle/APK menu walks through - you'll need to
create a signing key the first time, and keep it safe, since Google
requires the same key for every future update to the same app listing.

## Building the iOS .ipa

On a Mac, with Xcode installed:

```
npm run cap:ios
```

This builds the web app, syncs it into the native Xcode project, and
opens Xcode. From there:
1. Select your Apple Developer team under Signing & Capabilities (you'll
   need a free or paid Apple Developer account)
2. Product -> Archive
3. Once archived, the Organizer window lets you export an `.ipa` or
   upload straight to TestFlight/App Store Connect

Unlike Android, Apple doesn't allow installing an `.ipa` on a real iPhone
without either a paid Apple Developer account ($99/year) or using
Xcode's own device-install feature during development.

## After any code update

Whenever I send you an updated mitapesa-frontend.zip, the sync step is
the same each time:

```
npm run cap:sync
```

This rebuilds the web app and copies the new build into both the
`android/` and `ios/` native projects - then re-open Android Studio /
Xcode and re-build as above.

## Push notifications - worth knowing before you rely on this

The app's current push notification setup uses web push (a service
worker). Once wrapped as a native app, Capacitor's own Push Notifications
plugin is the more reliable path for real native push (via Firebase Cloud
Messaging on Android, APNs on iOS) - the current web push implementation
may not work the same way, or at all, inside the native shell. This is a
real, separate piece of follow-up work, not something this setup handles
automatically - flagging it now rather than let it be a surprise later.

## Camera not responding on iOS

If tapping to scan a receipt does nothing on a real iPhone (no error, no
camera opens, nothing happens) - this is the fix. iOS requires your app
to declare *why* it wants camera/photo access before it will grant it,
even for a plain HTML file input.

1. In Xcode, find `Info.plist` in the file navigator (inside `App > App`)
2. Right-click it in the file list and choose **Open As > Source Code**
   (this shows the raw XML, easier to edit precisely than the property
   list UI)
3. Find the closing `</dict>` tag near the bottom, and add these four
   entries just before it:
   ```xml
   <key>NSCameraUsageDescription</key>
   <string>MitaPesa needs camera access to scan receipts.</string>
   <key>NSPhotoLibraryUsageDescription</key>
   <string>MitaPesa needs photo library access to attach receipt photos.</string>
   <key>NSPhotoLibraryAddUsageDescription</key>
   <string>MitaPesa needs photo library access to save receipt photos.</string>
   <key>UIViewControllerBasedStatusBarAppearance</key>
   <true/>
   ```
   The last one is required for the app's status bar (the clock/battery
   area at the very top) to actually respond to the SystemBars styling
   the app sets in code - without it, iOS ignores those calls entirely
   and the status bar area can show as a plain black bar instead of
   matching the app's background.
4. Save the file (Cmd+S)
5. Run the app again (play button) - no rebuild/resync needed for an
   Info.plist-only change, Xcode picks it up directly

The first time you tap to scan a receipt after this, iOS will show a
real permission popup ("MitaPesa Would Like to Access the Camera") with
the exact text from NSCameraUsageDescription above - that's the
expected, correct behavior this was missing before.

Note: since ios/ isn't tracked in Git (it's regenerated locally via
npx cap add ios), this edit needs to be redone if you ever delete and
recreate that folder from scratch on a new machine.

## QR scanning - native plugin setup (@capacitor/barcode-scanner)

QR scanning now uses the official Capacitor Barcode Scanner plugin
instead of the browser's own camera-streaming API, which proved
unreliable inside Capacitor's iOS WebView (see the note above about the
receipt camera fix - this is a related but distinct issue, since QR
scanning needs a live, continuously-updating camera view rather than a
single photo). This plugin uses real native camera access on both
platforms instead.

After pulling this update:

```
npm install
npx cap sync
```

**iOS**: no extra setup needed beyond what's already there - it uses the
same NSCameraUsageDescription key already added to Info.plist for
receipt scanning.

**Android**: this plugin requires a higher minimum Android SDK version
(26) than Capacitor's own default. Since `android/` isn't tracked in
Git either, this needs to be set directly on each machine that builds
for Android:

1. Open `android/variables.gradle` in a text editor
2. Find the line `minSdkVersion = ...` (or add one if missing) inside
   the `ext { }` block
3. Set it to:
   ```gradle
   ext {
       minSdkVersion = 26
   }
   ```
4. Save, then re-sync: `npx cap sync android`

**Also required on Android**: the plugin's Android side depends on a
package hosted via JitPack, which isn't in the project's default Gradle
repositories - without this, the build fails with something like
"Could not find any matches for com.github.outsystems:osbarcode-android".

1. Open `android/build.gradle` (the root-level one, not `android/app/build.gradle`)
2. Find the `allprojects { repositories { ... } }` block
3. Add this line inside it:
   ```gradle
   maven { url 'https://jitpack.io' }
   ```
4. If that block isn't in `build.gradle`, check `android/settings.gradle`
   instead - some Gradle setups use a `dependencyResolutionManagement { repositories { ... } }`
   block there instead. Add the same line to whichever one actually has it.
5. In Android Studio: File -> Sync Project with Gradle Files, then run again

**A version note worth knowing**: this plugin's current documentation is
written against Capacitor v8, while this project is on Capacitor v6.
`npm install` should resolve a compatible version automatically, but if
`npx cap sync` shows any version-conflict warnings after installing,
that's the first thing to look at.

## Native push notifications (Android)

This replaces the old web-push system for the native app - real Android
push via Firebase Cloud Messaging (FCM), using the official
`@capacitor/push-notifications` plugin. The web push system stays intact
and unchanged for anyone using the regular website; both paths now run
through the same backend `sendPushToUser()` call, so nothing else in the
codebase needed to change.

iOS is deliberately not covered here - real iOS push needs a paid Apple
Developer account (APNs certificates), same blocker as Face ID. This is
Android-only for now.

### Step 1: Create a Firebase project (free, one-time, web console)

1. Go to [console.firebase.google.com](https://console.firebase.google.com/)
   and click **Add project**
2. Name it (e.g. "MitaPesa"), accept the terms, click through to create it
   - Google Analytics is optional, safe to skip

### Step 2: Register the Android app with Firebase

1. On the Firebase project's Overview page, click the **Android** icon
   to add a new Android app
2. **Android package name** must exactly match `com.dugapay.mitapesa` (the
   `appId` in `capacitor.config.json`) - this is the one field that must
   be precise, everything else is optional
3. Click **Register app**
4. Download the `google-services.json` file when prompted

### Step 3: Place `google-services.json` in the Android project

Move the downloaded file to:
```
android/app/google-services.json
```
No further Gradle edits needed for this one - the plugin already
includes the necessary Firebase Messaging dependency in its own
`build.gradle`, confirmed directly from Capacitor's own documentation.

Since `android/` isn't tracked in Git, this file needs to be placed
again if that folder is ever deleted and regenerated on a new machine -
same situation as the `Info.plist` and `network security` edits.

### Step 4: Install the plugin and sync

```
npm install
npx cap sync android
```

### Step 5: Create a service account for the backend to send push

This is separate from `google-services.json` - that file is client-side
and ships inside the app; this is a private server-side credential that
must never be committed to Git or shared publicly.

1. In the Firebase console, go to **Project Settings** (gear icon) →
   **Service Accounts** tab
2. Click **Generate new private key** - downloads a JSON file
3. Open that file, copy its **entire contents** as one block
4. On Render, go to the backend service → **Environment**, add a new
   variable:
   - Key: `FIREBASE_SERVICE_ACCOUNT_JSON`
   - Value: paste the entire JSON file's contents as a single value
5. Save - Render will redeploy the backend automatically

### Step 6: Run a schema migration

The backend now has a new `PushDeviceToken` table. After deploying,
run `npm run prisma:migrate` against the production database (this
project's existing script for applying schema changes).

### Step 7: Build and test

```
npm run build
npx cap sync android
npx cap open android
```

Run on a real Android phone (the emulator can receive FCM push too, but
a real device is the more reliable test). In the app:

1. Go to **Profile → Push notifications**
2. Tap **Enable notifications** - Android grants silently, no prompt
3. Tap **Send test** - a real system notification should arrive within
   a few seconds

If "Send test" doesn't produce a notification, the most likely causes,
in order of likelihood:
- `FIREBASE_SERVICE_ACCOUNT_JSON` isn't set correctly on Render (check
  the backend's logs for "Failed to initialize Firebase Admin")
- The Android package name in Firebase doesn't exactly match
  `com.dugapay.mitapesa`
- `google-services.json` wasn't placed in `android/app/` before the
  build

## iOS biometric login / Face ID - Associated Domains setup

The app's WebAuthn code (registerDevice, loginWithDevice in api.js) was
already fully built before this - what was missing was purely native
iOS configuration, unblocked now that a paid Apple Developer account
exists. No new plugin needed; WKWebView has built-in WebAuthn support,
this is only about proving to iOS that the app and the domain
(mitapesa.dugapay.com) belong to the same organization.

Two pieces, both already done in code, one manual Xcode step remains:

1. `public/apple-app-site-association.json` - contains the Apple Team
   ID (U2BF729SSV) and bundle ID (com.dugapay.mitapesa). Deliberately
   NOT placed directly at `public/.well-known/apple-app-site-association`
   - Vite has a documented issue serving paths under a dot-prefixed
   directory like `.well-known` (github.com/vitejs/vite/discussions/15859),
   which caused this to 404 the first time it was tried. Using a normal
   file path sidesteps that entirely.
2. `vercel.json` - a rewrite maps the required public URL
   (`/.well-known/apple-app-site-association`, which Apple's spec
   requires exactly, no changing that) to the actual file above, and a
   headers rule forces `Content-Type: application/json` on both the
   rewritten path and the real file. Without the content-type header,
   Vercel may serve this as a generic download instead of JSON, which
   silently breaks Apple's validation with no useful error message.

The remaining manual step, in Xcode (same pattern as the signing team
and Info.plist edits above - lost if `ios/` is ever regenerated, so
document any future repeat of this too):

1. Select the **App** target -> **Signing & Capabilities**
2. Click **+ Capability**, search for and add **Associated Domains**
3. Under the new Associated Domains section, click **+** and add:
   `webcredentials:mitapesa.dugapay.com`
4. Save, rebuild, run on a real device (Associated Domains does not
   work in the Simulator)

Apple's validation of the AASA file happens silently at install time,
with minimal error feedback if something's wrong - if biometric login
doesn't work after this, first double check the file is actually
reachable at the URL above in a browser and returns the raw JSON (not
a downloaded file), before assuming the code itself is broken.

## Android biometric login / passkeys - Credential Manager setup

**Earlier attempt, for context**: `@capgo/capacitor-passkey` (a
third-party plugin shimming `navigator.credentials` to Android's
native Credential Manager) was tried and reverted - its current
version requires `@capacitor/core >= 8.0.0`, a hard conflict with this
project's `^6.1.2`. Not retrying that specific plugin route.

**Current approach**: Google's own `androidx.credentials` /
`androidx.webkit` libraries directly, with a few lines of native code
in `MainActivity.java` - no third-party plugin at all, so the
Capacitor version conflict above doesn't apply here. Confirmed
directly from Android's own developer documentation
(developer.android.com/identity/sign-in/credential-manager-webview,
last updated 2026-02-26): embedded WebViews (what Capacitor uses on
Android) don't support WebAuthn out of the box at all - this needs
enabling explicitly, native-side, same spirit as the iOS Associated
Domains step above but a different mechanism entirely.

Three pieces:

1. **`public/assetlinks.json`** - Android's equivalent of the iOS AASA
   file (Digital Asset Linking), contains the app's package ID and
   SHA-256 signing certificate fingerprint. Same dotfile-path issue as
   the iOS file applies here too, so this isn't placed directly under
   `public/.well-known/` either - `vercel.json` rewrites
   `/.well-known/assetlinks.json` to this file, same pattern as the
   AASA setup above.
2. **Gradle dependencies** - add to `android/app/build.gradle`, inside
   the existing `dependencies { }` block:
   ```gradle
   implementation "androidx.credentials:credentials:1.6.0"
   implementation "androidx.credentials:credentials-play-services-auth:1.6.0"
   implementation "androidx.webkit:webkit:1.14.0"
   ```
   (check for newer patch versions before building for real production
   use - these were current as of this session)
3. **`MainActivity.java`** changes - the file already exists from
   `cap add android`, this only adds to it, doesn't replace the whole
   file. Add these imports:
   ```java
   import android.os.PersistableBundle;
   import android.webkit.WebView;
   import androidx.annotation.Nullable;
   import androidx.webkit.WebSettingsCompat;
   import androidx.webkit.WebViewFeature;
   ```
   Then add this method inside the `MainActivity` class (alongside
   `onCreate`, not replacing it):
   ```java
   @Override
   public void onPostCreate(@Nullable Bundle savedInstanceState, @Nullable PersistableBundle persistentState) {
       super.onPostCreate(savedInstanceState, persistentState);
       WebView webView = getBridge().getWebView();
       if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
           WebSettingsCompat.setWebAuthenticationSupport(
               webView.getSettings(),
               WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP
           );
       }
   }
   ```
   `getBridge().getWebView()` is Capacitor's own documented way to
   reach the underlying WebView instance from `MainActivity` - this
   isn't a workaround, it's the supported pattern.

**Important - this fingerprint is per-signing-certificate**: the SHA-256
value in `assetlinks.json` right now is the **debug** keystore's
fingerprint (from `./gradlew signingReport`), used for testing via
Android Studio. Once a release keystore exists for actual Google Play
submission, that build is signed with a *different* certificate - its
SHA-256 fingerprint needs adding to the `sha256_cert_fingerprints`
array too (a JSON array can hold both), or biometric login will appear
to break again specifically on the production build, with everything
else about it working fine.

iOS biometric login is covered separately above - different mechanism
entirely, not affected by anything in this section.



## Note: Capacitor v6 -> v8 upgrade (future, deliberate task)

This project is currently on Capacitor `^6.1.2`; the current release
is v8 (`8.4.2` as of this writing). Not an emergency - Capacitor
doesn't publish a hard "v6 stops receiving patches on this date"
notice - but two major versions behind means the plugin ecosystem
thins out over time, which is exactly what blocked biometric login
above.

When this upgrade actually happens (recommended: during pre-production
hardening, not before), it should start with a full review of this
project's own code for what the version jump touches - looking at
callers of `Capacitor.isNativePlatform()`, `Capacitor.getPlatform()`,
every native plugin's own breaking-changes notes between v6 and v8
(barcode scanner, push notifications), and Capacitor's own official
migration guides (`capacitorjs.com/docs/updating/7-0` and
`/updating/8-0`) - rather than assuming `npx cap migrate` alone covers
everything specific to this app. This note exists so that review
happens deliberately, with the person aware of what's being changed
and why, rather than as a background dependency bump.
