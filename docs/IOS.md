# Nightfall on iOS 27 and iPadOS 27

Nightfall 1.1.0 prepares the shared Safari extension for iPhone and iPad. The dark-mode engine and saved hostname preferences are shared source code across platforms. Settings use storage.local and remain on each device; they do not sync between Mac, iPhone and iPad.

## What is ready

- Mobile controls use the available sheet width, safe-area padding, 44-point touch targets and 16px select text.
- iPad popovers retain a 320px minimum intrinsic width. Mac popovers retain their proven 360×600 layout.
- Pages reread saved preferences after returning from the back-forward cache or becoming visible after suspension.
- Popup messages time out instead of leaving the controls disabled indefinitely when Safari cannot respond. Saved preferences remain available when the page resumes.
- `dist/Nightfall-Safari.zip` contains the shared resources for Apple's Safari Web Extension Packager.

**This ZIP is not an IPA or an installable iPhone app.** The source and emulated browser checks do not prove execution inside iOS 27 Safari. Native packaging, signing and device testing are separate steps. The [3 October 2026 native test report](IOS-TEST-RESULTS.md) records successful iPhone/iPad simulator checks, a signed physical iPhone run and the remaining gaps.

## Recommended: Apple's web packager and TestFlight

An Apple Developer Program membership and access to App Store Connect are required. The web packager avoids installing Xcode on the development Mac.

1. In App Store Connect, create a new app record with **iOS** selected. Use **Nightfall** as the app name if available. Register or choose a unique bundle identifier; `com.ericescapes.nightfall` and its `.Extension` identifier were registered for Eric’s account during this test session; the existing app record is **Nightfall — Smart Dark Mode**. Other accounts must use their own identifiers. Pick a SKU and primary language appropriate to your account.
2. Open the app's **Xcode Cloud** tab, find **Safari Web Extension Packager**, and upload `dist/Nightfall-Safari.zip`.
3. Wait for Apple's packaging result. Resolve any compatibility or signing diagnostics; a successful ZIP validation alone is not an iOS build.
4. Once Apple processes a successful build, use the **TestFlight** tab to make it available to the appropriate testers. Complete any required compliance questions using the actual app behaviour and your account's details. External testing may require Apple's review.
5. Install the app from TestFlight on an iPhone or iPad running iOS/iPadOS 27.
6. Enable Nightfall in **Settings → Apps → Safari → Extensions** and grant access to the websites you want to darken. Open an ordinary website in Safari, then choose Nightfall from Safari's page/extension menu.

The cloud packager uses the Xcode Cloud compute allowance associated with the developer membership. Creating an app record or uploading a ZIP does not itself publish the app to the App Store. This project does not automatically enrol an account, accept agreements, upload a build or add testers.

Sources: [Apple's cloud packaging guide](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect), [running Safari web extensions](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension).

## Alternative: full Xcode on a Mac

Use full Xcode with the iOS 27 SDK for validation against the requested platform. A command-line-tools-only installation cannot create, sign or run an iOS container.

```sh
npm ci
npm run package:ios
```

The script invokes Apple's official packager to generate an iOS-only Swift container at `native-ios/`. It copies the current extension resources into that project, refuses to overwrite an existing directory, and does not sign or launch the app. It also validates the requested identifier and normalises the generated app/extension target identifiers: the Xcode 27 packager produced inconsistent capitalisation that otherwise failed embedded-extension validation. Unexpected project structures fail without a partial rewrite. Choose a different output directory when generating again:

```sh
bash scripts/package-ios.sh ./native-ios-next
```

To use an already registered bundle identifier:

```sh
NIGHTFALL_BUNDLE_ID=com.example.nightfall npm run package:ios
```

On the tested Mac mini, select Xcode 27 for each command with `DEVELOPER_DIR=/Applications/Xcode-27.app/Contents/Developer`; the machine-wide default remains Xcode 26.6. The local generated wrapper reports version 1.0 (1), while its copied extension manifest is 1.1.0. Set intentional wrapper versions before local distribution; Apple’s cloud packager reads the uploaded manifest and queued 1.1.0 (1).

Open the generated project in Xcode. Select your signing team for the app and extension targets, confirm the generated bundle identifiers and AppIcon assets, select a connected iPhone/iPad or simulator, then build and run. Test the extension in Safari as well as the containing app's welcome screen.

Because the script copies resources, later JavaScript/CSS changes must also be copied into the generated extension resources or packaged into a fresh project before rebuilding.

### CLI archive and TestFlight upload

A signed-in Xcode account is separate from Safari's App Store Connect login. The native test session confirmed that `xcodebuild` can use the account for automatic provisioning. Local keychain authorization may still require the account holder to approve a macOS prompt; never put its password in a script or repository.

For a generated project, build an archive with an intentional native version and a new build number. Replace the example team and paths with your own values; preserve an existing archive by choosing a fresh path:

```sh
DEVELOPER_DIR=/Applications/Xcode-27.app/Contents/Developer \
  xcodebuild -project native-ios/verified/Nightfall/Nightfall.xcodeproj \
  -scheme Nightfall -configuration Release -destination 'generic/platform=iOS' \
  -archivePath native-ios/Nightfall-next.xcarchive \
  -derivedDataPath native-ios/DerivedData-distribution-next \
  DEVELOPMENT_TEAM=YOUR_TEAM_ID MARKETING_VERSION=1.1.0 \
  CURRENT_PROJECT_VERSION=YOUR_NEW_BUILD_NUMBER archive
```

Keep an ignored export-options plist with `method=app-store-connect`, `signingStyle=automatic`, `teamID=YOUR_TEAM_ID`, `manageAppVersionAndBuildNumber=false`, and `destination=export` for a local IPA or `destination=upload` to upload through Xcode's account session. Use it with:

```sh
DEVELOPER_DIR=/Applications/Xcode-27.app/Contents/Developer \
  xcodebuild -exportArchive -archivePath native-ios/Nightfall-next.xcarchive \
  -exportPath native-ios/export-next \
  -exportOptionsPlist native-ios/ExportOptions.plist -allowProvisioningUpdates
```

The provisioning flag permits Xcode to request/update signing assets through the selected developer account. It cannot resolve a locked or unapproved private key by itself. Archive success, export success, upload acceptance, Apple processing and TestFlight availability are separate results; verify each one. TestFlight tester management through Apple's public API needs its own authenticated API setup; Xcode sign-in does not provide an API key for other tools.

Source: [Apple's local packaging guide](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari).

## Native acceptance checks before claiming iOS 27 support

- On iPhone portrait and landscape, every control is readable, reachable by scrolling and usable with touch. Check larger text as well.
- On iPad, open the extension in a content-sized popover, with Split View and with a trackpad. The panel must not collapse to a narrow strip.
- Grant website access, then verify pale sidebars, forms, gradients and newly loaded content darken. Verify photographs remain unchanged.
- Switch Nightfall off and verify the site's original colours return. Reopen the popup and verify the setting persists.
- Verify hostname exceptions, system light/dark changes, reloads, background/foreground transitions and back/forward navigation.
- Check an embedded frame with appropriate website permissions, and the no-permission state.
- Test a long page for scrolling responsiveness and battery/CPU impact on a physical device.

The shared engine's limitations still apply: protected Safari pages, inaccessible stylesheets, closed shadow roots, image/canvas interiors and some strict-CSP CSSOM updates cannot all be recoloured automatically. See the root README.
