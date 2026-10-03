# MacminiM4: native iOS testing handoff

## Follow-up

Native testing on 3 October 2026 is recorded in [IOS-TEST-RESULTS.md](IOS-TEST-RESULTS.md), including the packaging repair, simulator evidence, signed physical iPhone run and remaining checks. The starting point below is the historical handoff baseline.

## Starting point

- Repository: https://github.com/infoericescapes-coder/nightfall.git
- Branch: `main`. The iOS preparation is commit `5a80c2bcc372e278068206ba892f12127d7b63e2`, version **1.1.0**. Pull the latest main to include this handoff.
- Eric has confirmed the Mac extension works well. Preserve that behaviour and its 360×600 popup sizing.
- The shared source includes an iOS layout with a 320px minimum width, safe-area padding, 44px controls, 16px select text, and recovery after page suspension/back-forward cache restoration.
- Last verified here: **12 unit tests and 26 browser tests passed** in Chromium and desktop Playwright WebKit. Mobile checks simulate the iOS platform API and viewport sizes; they are not native iOS tests.
- The previous Mac had only Command Line Tools. No native project, signed app, simulator run or physical-device test has been produced. MacminiM4 reportedly has Xcode; inspect the installed version and runtimes rather than assuming iOS 27 is available.

Read `README.md`, `docs/IOS.md`, and `scripts/package-ios.sh`, plus applicable local agent instructions. This handoff contains no signing team, registered app identifier or developer-membership confirmation.

## Start on the Mac mini

Find an existing checkout first. Inspect its status and preserve local changes. Otherwise clone the repository into a suitable local development directory. Do not assume the previous Mac's absolute workspace path exists here.

For a clean checkout, update with `git pull --ff-only`. Check the native tools:

```sh
xcode-select -p
xcodebuild -version
xcodebuild -showsdks
xcrun --find safari-web-extension-packager
xcrun simctl list devices available
xcrun simctl list runtimes
```

If Command Line Tools is selected despite full Xcode being installed, use a process-local `DEVELOPER_DIR` pointing to the discovered Xcode app's `Contents/Developer`. If an iOS 27 runtime is unavailable, state the exact gap; testing an older runtime does not establish iOS 27 compatibility.

Install the pinned dependencies and establish the baseline:

```sh
npm ci
npx playwright install chromium webkit
npm test
npm run package:ios
```

The packaging helper rebuilds the ZIP and invokes Apple's packager to generate an iOS-only Swift container in `native-ios/`. That folder is ignored by Git. It refuses to overwrite an existing project. Inspect and reuse an existing generated project, or choose a fresh output folder and keep it out of commits.

The default `com.ericescapes.nightfall` identifier is a proposal, not a registered identifier. Inspect the actual generated project, schemes, app/extension bundle identifiers and destinations before building. Prefer an available iPhone simulator first, then iPad; use XcodeBuildMCP if available or the installed Xcode CLI. Discover scheme names rather than guessing them. A simulator build and Safari test can proceed separately from physical-device signing.

## What to verify in Safari

Install and launch the generated containing app, enable its Safari extension and grant website access. Verify that the extension actually runs inside Safari, not just that the containing app builds.

1. **Presentation:** iPhone portrait/landscape, iPad popover, narrow multitasking windows and larger text. All controls and the footer should be reachable. Recheck the former collapsed-width bug.
2. **Colour conversion:** pale navigation, toolbars, panels, borders, form controls, gradients and dynamically inserted content become dark; photos retain their original appearance. Use the synthetic `tests/fixture.html` via a local HTTP server for reproducible evidence. Use the user's Gmail only when available and keep private content out of committed evidence.
3. **Settings:** master switch, hostname exceptions, system appearance and deeper blacks apply correctly and persist across reopening and reloads. Turning Nightfall off restores the original page.
4. **Lifecycle:** background/foreground, back/forward cache, and reopening the extension sheet after a suspended tab. Saved settings should recover and controls should not stay disabled when page messaging fails.
5. **Permissions:** no website access and permitted embedded frames behave coherently. Do not confuse an access denial with an engine defect.
6. **Regression:** keep the working Mac popup and existing engine tests passing. Physical-device responsiveness, battery impact and real suspension behaviour remain separate checks if only simulators are available.

Changes to `extension/` do not automatically update the generated project's copied resources. Synchronise those resources or regenerate into a fresh directory before each native retest; record which source revision was actually run.

## Finish the testing session

Fix failures in the shared source or packaging helper, rebuild the ZIP when extension resources change, and run checks appropriate to the fix. Save a concise report in `docs/IOS-TEST-RESULTS.md` recording machine, Xcode/SDK/runtime, device or simulator, tested source revision, scenarios, results and outstanding limitations. Include useful screenshots/logs without personal page content.

Commit and push the source fixes, updated build and test report to this repository. Keep signing credentials, provisioning profiles, local Xcode user state and build output out of Git. If native container changes are needed, make them reproducible through the helper or a deliberate portable project change. App Store/TestFlight distribution is a separate step from this local testing handoff.
