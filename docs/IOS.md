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

On the tested Mac mini, select Xcode 27 for each command with `DEVELOPER_DIR=/Applications/Xcode-27.app/Contents/Developer`; the machine-wide default remains Xcode 26.6. The local generated wrapper reports version 1.0 (1), while its copied extension manifest is 1.1.0. Set intentional wrapper versions before local distribution; the verified local distribution archive is 1.1.0 (3). Apple’s earlier cloud packager run used 1.1.0 (1).

Open the generated project in Xcode. Select your signing team for the app and extension targets, confirm the generated bundle identifiers and AppIcon assets, select a connected iPhone/iPad or simulator, then build and run. Test the extension in Safari as well as the containing app's welcome screen.

Because the script copies resources, later JavaScript/CSS changes must also be copied into the generated extension resources or packaged into a fresh project before rebuilding.

Safari distribution requires a manifest description of at most 112 characters. The build now checks this before packaging; version 1.1.0 uses a 110-character description after Apple rejected the earlier 115-character value.

### Local distribution signing and export

On Eric's Mac, read `/Users/eric/Claude/Projects/Base Team/Documentation/apple-signing-for-codex.md` before any Release archive, distribution signature, export or upload. Use a disposable per-run keychain populated from the existing distribution assets. Fixed-path `foundation-release*` keychains must remain untouched. If a keychain prompt appears, cancel it and stop; its password is not needed.

The Nightfall export helper ports Simple Social's hardened keychain/lock/cleanup functions. It uses Xcode 27, the existing ignored `native-ios/Nightfall-build3.xcarchive` and `native-ios/ExportOptions.plist`, API authentication for provisioning, and Apple's `/usr/bin/rsync` through a temporary shim scoped to export. It refuses an upload destination and an existing output directory:

```sh
scripts/release-ios.sh
# Or choose a fresh export directory inside ignored native-ios/:
scripts/release-ios.sh ./native-ios/export-next
```

The helper checks the archive's expected **1.1.0 (3)** app/extension metadata and the configured distribution identity, exports an IPA, verifies both exported signatures, and prints the user keychain search list before and after. Cleanup subtracts only the disposable keychain from the current list and removes the temporary keychain/shim; the earlier list is used only for comparison, never restored as a snapshot. Signing assets, generated passwords and PKCS12 material stay outside the repository. Archive, IPA and local signing logs stay ignored.

The corrected local **1.1.0 (3)** IPA was uploaded on 3 October 2026 and processed successfully. API readback confirms it is ready for internal beta testing after the export-compliance answer. External beta submission and tester invitations remain separate; see the [upload evidence](ios-evidence/testflight-upload.json).

This helper exports an existing archive only. A future version/build or archive path needs an intentional helper update and the same signing procedure. Upload and TestFlight invitations require their own authorised step. See the [native test report](IOS-TEST-RESULTS.md) for the actual export result; an archive or IPA alone does not establish TestFlight availability.

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
