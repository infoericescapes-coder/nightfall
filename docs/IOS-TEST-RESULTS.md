# Native iOS / iPadOS test results

Tested 3 October 2026, Australia/Sydney (AEST, UTC+10). Native evidence is from Safari with the installed extension, not an emulated browser extension API. This is a **partial acceptance pass**, with the remaining checks listed below.

## Source and environment

- Clean clone of `main` at `4a063cd` into `/Users/eric/Documents/nightfall`; shared extension version **1.1.0**. No existing local work was overwritten. This report's commit adds the packaging repair and test instrumentation; shared `extension/` source remains byte-for-byte at that baseline.
- Eric’s Mac mini, Apple M4, 24 GB, Mac16,10.
- Machine-wide selection: `/Applications/Xcode.app/Contents/Developer`, Xcode **26.6 (17F113)**, iOS SDK 26.5. It was left unchanged.
- Native verification explicitly used `/Applications/Xcode-27.app/Contents/Developer`: Xcode **27.0 (27A266a)**, iOS SDK **27.0**, installed simulator runtime **iOS 27.0 (24A434)**. **No iOS 27 runtime is missing.**
- iPhone 18 Pro simulator and a dedicated iPad Pro 11-inch (M5, 12 GB) simulator, both iOS/iPadOS 27.0. Xcode 27 Device Hub was used for interactive Safari controls.
- Paired physical iPhone 17 Pro, **iOS 27.0.1 (24A446)**, Developer Mode enabled. No physical iPad was available.

## Packaging defect and repair

Apple's generated project used `com.ericescapes.Nightfall` for the app but `com.ericescapes.nightfall.Extension` for the embedded extension. Xcode rejected it during `ValidateEmbeddedBinary` because the extension identifier did not start with the containing app's identifier.

`package:ios` now validates `NIGHTFALL_BUNDLE_ID` before generation and normalises the generated app and extension identifiers in both Debug and Release, using target/configuration references. The normaliser rejects unexpected structures before writing, preserves other settings, and is idempotent. Six regression tests cover the generated shape, custom identifiers and rejection paths. Fresh generation under `native-ios/verified` and native rebuilds passed; the result does not depend on hand-editing a generated project.

The local generated wrapper retains Apple's **1.0 (1)** defaults; its embedded extension manifest is **1.1.0**. These are distinct version fields. Set intentional wrapper versions before distributing a locally archived build. The cloud packager used manifest version **1.1.0 (1)**.

## Builds, resources and regression checks

| Check | Result |
| --- | --- |
| `npm ci` | Pass; pinned dependencies, zero reported vulnerabilities |
| `npm test` | **18 unit tests and 26 Chromium/WebKit browser tests passed** |
| Shell syntax and `git diff --check` | Pass |
| Fresh `npm run package:ios -- ./native-ios/verified` with Xcode 27 | Pass after identifier repair |
| iPhone 18 Pro simulator build/install/launch | Pass; extension enabled and exercised inside Safari |
| iPad Pro simulator build/install/launch | Pass; extension enabled and exercised inside Safari |
| Signed physical iPhone build/install/launch | Pass with existing local signing assets; initial remote launch failed, retry through active Device Hub connection succeeded |
| Release archive | Pass with command-line version 1.1.0 / build 2; App Store export blocked as described below |
| Resource freshness | All 20 shared files compared against generated resources, simulator bundle, device bundle and ZIP; see [hash evidence](ios-evidence/resource-hashes.json) |
| Mac preservation | No shared extension code/CSS changes; existing desktop popup/engine regression suite remains green. A new native Mac build was not performed. |

The existing ZIP's members already match the latest source. A packaging run only changed ZIP timestamps, so the exact committed archive was retained: SHA-256 `d1d0c7d25dbb6ec38b8eb2a22ff98b3a9f2a9495c894e47394f7a64bc34b52a8`. No functional ZIP update is required for a local project-generation fix.

## Native Safari acceptance

| Scenario | Observation and scope |
| --- | --- |
| iPhone portrait and landscape sheet | Controls and footer reachable; expanding/scrolling the Safari sheet exposes all content. No collapsed-width defect observed. Landscape footer screenshot retained. |
| Larger text | Simulator set to the largest accessibility content size in landscape; footer remained reachable. CSS uses fixed pixel typography, so this does **not** establish Dynamic Type scaling or complete accessibility. |
| iPad popover | Content-sized panel retained usable width, with lower controls and footer reachable by scrolling. Narrow multitasking and a physical trackpad remain unverified. |
| Pale surfaces, gradient, dynamic insertion | Native iPad probe measured body/card/dynamic surface `rgb(24, 26, 27)`, sidebar `rgb(31, 34, 35)` and a recoloured CSS gradient with deeper blacks off; nine engine style elements. Phone deeper-black surfaces measured `rgb(17, 19, 21)`. |
| Image preservation | Synthetic coloured media swatches visually retained colour; image source/own filter and three URL-background fingerprints remained unchanged. The cream raster is intentionally preserved, not a failed CSS conversion. These checks do not establish every photo/video/canvas or ancestor-filter case. |
| Master switch and persistence | Off restored white body/card/dynamic surfaces and removed engine styles; on restored dark colours. State persisted across reopening and cross-host navigation. |
| Hostname override | iPhone Leave original restored the fixture and corresponding status; Use default restored normal policy. |
| Follow system | iPhone light appearance produced original white/zero engine styles, dark appearance produced dark/nine styles. A transient dark-system sample before recovery still had zero styles; later foreground sample recovered. Popup status could remain stale while the sheet stayed open, then refreshed on reopening. |
| Deeper blacks | iPad toggle visibly changed surface brightness; measured normal versus deeper-dark colours agree with intended policy. |
| Reload / dynamic DOM | Native reload preserved preferences and dynamic inserted surface darkened. |
| Back-forward cache | On iPad, changed master setting while fixture was away; cached return recorded `pageshow.persisted=true`. Settled samples restored white body/card/dynamic surface and zero engine styles, confirming saved preferences were reread. |
| Background / foreground | Phone (~39 seconds) and iPad (~62 seconds) recorded hidden/visible transitions and dark rendering on return. This is foreground recovery evidence, **not proof of OS suspension or process eviction**. |
| Frame permissions | Permitted same-origin frame darkened. Denied 127.0.0.1 cross-origin frame stayed white with zero engine styles. Once both fixture origins were permitted, both frames darkened with nine styles each. |
| Physical iPhone | Signed app installed and launched. Eric tested Safari and supplied the screenshots below, confirming only Nightfall was active. Synthetic fixture is dark with preserved coloured swatches/cream raster; full popup exposes all controls/footer and reports the selected site's dark mode active. This does not establish every simulator scenario on hardware. |

The synthetic probe uses the actual installed extension, with no extension API mocks. It records computed colours and lifecycle events into an ignored local JSONL file. [Selected native samples](ios-evidence/native-samples.json) preserve timestamps and raw fields. Scenario labels combine those measurements with observed UI actions; the probe does not directly read Nightfall preferences or Safari permission settings.

Apple’s local and cloud packagers warn that `match_about_blank` is unsupported by their Safari version. Native frame checks covered ordinary URL frames; about:blank/srcdoc execution remains unverified. The warning alone did not prevent local native builds.

One permission/reinjection transition produced **18** engine style elements; turning Nightfall off removed all of them, and a fresh enabled reload returned to nine. No persistent visual defect was reproduced, so this is recorded as an observation, not a claimed fix. A light-appearance iPhone sheet also briefly showed poor contrast in Safari's native title chrome; extension controls were readable, and dark system appearance showed the title normally. Recheck this on hardware before release.

## Screenshot evidence

- [iPhone master off](ios-evidence/iphone-master-off.png), [portrait popup](ios-evidence/iphone-popup-on.png), [landscape footer](ios-evidence/iphone-landscape-footer.png), [largest text setting](ios-evidence/iphone-landscape-large-text.png).
- [iPad popover](ios-evidence/ipad-popover.png), [popover footer](ios-evidence/ipad-popover-footer.png), [frame permission boundary](ios-evidence/ipad-frame-permission-boundary.png), [BFcache restored master-off state](ios-evidence/ipad-bfcache-master-off.png).
- Eric's physical iPhone: [synthetic page, Nightfall alone](ios-evidence/physical-iphone-user.png), [full extension sheet](ios-evidence/physical-iphone-popup-user.png).

Only synthetic-page/extension screenshots are committed. No private mailbox content, signing identity material, profiles or generated native build outputs are included.

## Reproduction

Use a fresh ignored output directory; the helper deliberately refuses to overwrite an existing project:

```sh
npm ci
npx playwright install chromium webkit
npm test
DEVELOPER_DIR=/Applications/Xcode-27.app/Contents/Developer \
  npm run package:ios -- ./native-ios/verification-next
DEVELOPER_DIR=/Applications/Xcode-27.app/Contents/Developer \
  xcodebuild -project native-ios/verification-next/Nightfall/Nightfall.xcodeproj \
  -scheme Nightfall -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO build
node scripts/native-test-server.cjs
```

Install `DerivedData/Build/Products/Debug-iphonesimulator/Nightfall.app` with `xcrun simctl install <simulator-id> <app-path>` under the same `DEVELOPER_DIR`. Launch it, enable Nightfall in Safari settings, and permit the fixture origin. Open `http://localhost:8766/fixture.html`; the fixture's buttons add a dynamic surface, navigate away/back and insert same/cross-origin frames. Grant access to 127.0.0.1 separately for the permitted cross-origin case. Check settled samples after lifecycle events, and require `pageshow.persisted=true` when claiming BFcache coverage.

For the signed device build, the same project was built with `-destination 'generic/platform=iOS'`, `-derivedDataPath native-ios/DerivedData-device`, and a command-line `DEVELOPMENT_TEAM` selecting Eric's registered team. Existing local profiles/certificate sufficed; no provisioning-update flag was needed. Install/launch used `xcrun devicectl`. Initial missing-team errors were resolved for development installs; distribution signing has separate outstanding requirements below.

Before every native retest after a shared source change, regenerate or synchronise copied resources, rebuild and compare resource hashes. The ZIP, copied project and installed bundle must agree.

## Distribution status

The authorised Apple Developer setup registered the app and extension identifiers and created **Nightfall — Smart Dark Mode** in App Store Connect. The verified ZIP was uploaded on 3 October at 09:56 AEST as **1.1.0 (1)**. Apple’s cloud packager subsequently reported **Failed**, with an iOS App Store distribution export error and development-distribution export warning. Local signed development build success does not establish cloud distribution signing. The packager issues page offered only these generic diagnostics; no downloadable log artifact control was exposed on the accessible build/issues pages. TestFlight still displayed **No Builds**, with no external-testing group available. The requested tester invitation has **not** been sent.

As a local fallback, an Xcode 27 Release archive succeeded using command-line `MARKETING_VERSION=1.1.0` and `CURRENT_PROJECT_VERSION=2`. Export with method `app-store-connect` found no App Store provisioning profiles for either target. Retrying once with `-allowProvisioningUpdates` returned **No Accounts** and the same missing-profile errors. Existing development signing assets are sufficient for direct device testing, but not this distribution export. Eric signed into Xcode 27 Accounts at 10:07 AEST. The next automatic export reached replacement of the embedded extension signature, then failed with `errSecInternalComponent`; the former No Accounts/missing-profile errors no longer appeared. One valid Apple Distribution identity is visible to the signing tools. A retry is waiting with `codesign` and SecurityAgent active, and Eric was asked to approve the macOS signing-key authorization himself. The computer-use tool explicitly blocks access to SecurityAgent. The error alone does not prove the underlying cause; distribution export/upload is still unverified. No credentials or profiles are committed. The cloud failure’s underlying cause remains unconfirmed; it must not be inferred solely from the local export error.

## Remaining acceptance checks

- Native iPad narrow/windowed multitasking, physical trackpad and a physical iPad. Windowed Apps mode was available, but no verified narrow resize was achieved.
- Long-page physical scrolling, measured CPU/battery impact and actual OS suspension/process termination recovery. Short foreground transitions are insufficient.
- Physical-device landscape, larger text/accessibility, denied/permitted frame combinations and complete settings/lifecycle matrix beyond the supplied smoke-test screenshots.
- Real-world complex sites (including Gmail), strict-CSP behaviour and varied images/video/canvas. Existing documented engine limitations remain.
- Simulator/native Safari title contrast in light appearance and the transient duplicate-style observation above.
- Apple cloud export failure or the local signing-key/export blocker must be resolved before TestFlight invitation/installation; Apple processing and external beta review may then apply.


## Signing correction and successful export — 3 October 2026, 10:33 AEST

This addendum supersedes the local export/keychain blocker and password-prompt advice in the earlier Distribution status checkpoint. Eric cancelled the previous prompt and identified the retired `foundation-release-13sep.keychain-db` as its source. Its password is neither available nor required. The corrected run followed `/Users/eric/Claude/Projects/Base Team/Documentation/apple-signing-for-codex.md`; it did not read, unlock, copy, rename, remove or otherwise modify any `foundation-release*` keychain.

Added `scripts/release-ios.sh`, porting Simple Social's `build_release_keychain`, teardown/cleanup, search-list lock family and rsync cleanup from commit `c94b784b04d0e368047935a70dc795ca65eade4f`. Nightfall prefixes replace the original lock/temp names. The wrapper pins the existing **1.1.0 (2)** archive and export-only plist, validates the distribution identity SHA-1 `7F10906FE961004F5693CDCD7D84C225F6B4017B`, and supplies the documented API authentication flags with `-allowProvisioningUpdates`. The Apple rsync shim affects only export's PATH. The only executable changes inside the copied helpers add cleanup audit/status checks and correctly convert the DER WWDR certificate to PEM for both PKCS12 branches.

Before live signing, independent review and the primary rerun passed **24 isolated mock scenarios** on `/bin/bash` 3.2.57: failed/empty list reads, partition failure, export error propagation, cleanup preserving another process's entry, owned/foreign lock handling, completion guards, complete-chain fallback, and physical/symlinked repository temporary-directory rejection. Review caught and repaired the inherited-TMPDIR gap before signing. Explicit `set +x` now disables inherited tracing before secrets are handled. The actual export was then run with full filesystem access and Eric present; no other signing process was active.

**Result: EXPORT SUCCEEDED, exit 0.** The local IPA is `native-ios/export-disposable-20261003-103250/Nightfall.ipa` (232,129 bytes), SHA-256 `4e704e5710117620507f1090ea7838ef3352c5b8f29508ced4724c90218005b3`. No upload or tester invitation was performed in this export-only step. No keychain prompt was observed.

`codesign -dvv` on the actual exported IPA payload showed:

```text
Nightfall.app
Identifier=com.ericescapes.nightfall
Authority=Apple Distribution: Eric Kowalczyk (B3Z8GRN254)
TeamIdentifier=B3Z8GRN254

Nightfall Extension.appex
Identifier=com.ericescapes.nightfall.Extension
Authority=Apple Distribution: Eric Kowalczyk (B3Z8GRN254)
TeamIdentifier=B3Z8GRN254
```

Both also passed `codesign --verify --strict`. All **20** exported shared resource files match the tested source byte-for-byte. The app and extension retain native version **1.1.0 (2)**.

Actual `security list-keychains -d user` evidence before and after:

```text
BEFORE
    "/Users/eric/Library/Keychains/login.keychain-db"
AFTER
    "/Users/eric/Library/Keychains/login.keychain-db"
```

`cmp` returned **0**: the lists are byte-identical. No Nightfall disposable keychain directory, rsync shim or search-list lock remained after exit. Cleanup reread the current list and removed only its own keychain; the before list was used only for audit. [Full portable export evidence](ios-evidence/distribution-export.json) records signature output, resource comparison and artifact hashes. Private keys, profiles, the disposable keychain, archive, IPA and local signing logs remain outside Git.

The remaining native acceptance checks above still apply. Distribution export is now verified locally; Apple cloud packaging failure remains historical/unresolved, and TestFlight upload, processing/review and invitation are separate future actions.
