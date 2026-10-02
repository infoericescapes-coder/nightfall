# Nightfall for Safari

A personal dark-mode extension for Eric. It converts CSS colours across the page, including pale sidebars, toolbars, borders, forms and newly loaded panels. It uses the locally bundled MIT-licensed Dark Reader engine, rather than a whole-page inversion filter.

## Try it in Safari

1. Turn off the old **Toggle Dark Mode** extension on the website you want to test. Running two colour converters together produces unpredictable results.
2. Open **Safari → Settings → Developer → Add Temporary Extension…**.
3. Choose **`dist/Nightfall-Safari.zip`**, or the **`extension`** folder in this project. Choose the folder containing `manifest.json`, not the project folder.
4. Safari may ask you to allow unsigned extensions and authenticate. Review and approve that yourself. If the Developer tab is hidden, enable **Show features for web developers** in Safari's Advanced settings.
5. Enable Nightfall under Extensions. Allow access to the sites you want to darken, or all websites if that is your preference.
6. Reload the page, then click Nightfall's crescent toolbar button. Try Gmail first: inspect the search bar, left navigation, message toolbar, right rail and an open email.

**This ZIP is a development extension, not a signed Mac app.** Apple's temporary installation lasts until Safari quits or 24 hours elapse. A permanent installation needs packaging and signing with Apple’s tools.

Apple's instructions: [Running your Safari web extension](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension). [Packaging a web extension for Safari](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari).

## Updating an existing temporary install

Download the updated `dist/Nightfall-Safari.zip`, replacing the ZIP at the location you originally selected. In **Safari → Settings → Extensions → Nightfall**, click **Reload**, then close and reopen the toolbar popup. Version 1.0.1 fixes Safari’s collapsed popup width and provides a bounded, scrollable layout.

## Controls

- **Dark mode** is the master switch. Turning it off restores original colours everywhere, including sites set to Always dark.
- **This website** remembers an exact hostname: Use default, Always dark, or Leave original. Subdomains have separate settings.
- **Default behaviour** is Always dark or Follow system. A website override takes precedence over this default.
- **Deeper blacks** reduces surface brightness while keeping readable light text.
- **Apply again** re-reads saved preferences and rebuilds the theme for the current page. New and reloaded tabs pick up saved settings automatically.

## Privacy and permissions

There is no account, analytics, remote code loader or server. The engine, fonts and settings are local. Website access lets the content script inspect styles and change page colours. The extension stores only preferences and hostname exceptions in `browser.storage.local`; it does not store messages, page text or browsing history.

Dark Reader may request a page's linked stylesheets using normal browser CORS rules, with credentials omitted. There is no background fetch proxy. These are requests for the website's own style resources, not uploads of page content.

## Scope and limits

- Ordinary HTTP and HTTPS pages are supported. Safari's internal pages, browser toolbar, native PDF viewer and other protected pages cannot be recoloured by this extension.
- Ordinary image, video and canvas content is not globally inverted. White areas inside images, scanned documents or canvas drawings can remain white. CSS gradients are recoloured. A documented, pinned build adaptation keeps URL-based CSS background images unchanged, including pale photographs. Text on a deliberately light image can still need the site's original theme.
- Inaccessible cross-origin stylesheets, closed shadow roots, unusual widgets and complex SVG artwork may need a site-specific fix. No extension can guarantee perfect results on every website.
- Sites with strict Content Security Policy can block the engine's stylesheet hooks. Some CSSOM-only changes may then leave a new surface bright; choose **Apply again**, or reload the page.
- Dynamic DOM and inline style updates are handled by Dark Reader. Open shadow roots are supported by the engine; sites that create inaccessible roots are a limitation.
- Embedded frames follow the outer site's preference where Safari exposes the ancestor origin. Otherwise, they use their own hostname. Safari must also permit access to that frame's origin.
- Sites with their own dark theme can use **Leave original**. Disable your previous dark-mode extension before comparing results.
- Large pages may take a moment to settle; this build prioritises saved preference correctness over applying a dark flash before storage has loaded.

## Development

```sh
npm ci
npm run build
npx playwright install webkit chromium
npm test
```

`extension/` is ready to load. `npm run build` copies pinned engine/font assets, checks referenced content scripts and packages only extension files into `dist/Nightfall-Safari.zip`. No npm or Node installation is needed to use that ZIP.

Tests exercise the actual bundled engine in Playwright WebKit and Chromium on a synthetic mailbox, alongside storage/system-mode lifecycle tests. Browser API mocks exercise the popup and content-script contract. Those tests do not substitute for a live Safari extension install or Gmail account test.

For later permanent packaging on a Mac with full Xcode installed:

```sh
xcrun safari-web-extension-packager ./extension --app-name Nightfall --bundle-identifier com.ericescapes.nightfall --macos-only
```

Follow Xcode's signing prompts. This project does not choose a signing team, enrol in a developer programme, upload to App Store Connect or publish anything.

## Attribution

[Dark Reader](https://github.com/darkreader/darkreader), pinned to the version in `package-lock.json`, is bundled under the MIT licence. See `extension/vendor/DARKREADER-LICENSE`. The reproducible URL-image preservation adaptation is documented in `extension/vendor/NIGHTFALL-PATCH.txt`; the original npm package is not edited. This project is an independent personal wrapper, not the official Dark Reader Safari app. Space Grotesk and IBM Plex Mono are bundled with their font licences in `extension/fonts/`. The custom wrapper is MIT licensed.
