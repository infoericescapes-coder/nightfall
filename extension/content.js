(() => {
    'use strict';

    const api = globalThis.browser;
    const settingsAPI = globalThis.NightfallSettings;
    const engine = globalThis.DarkReader;
    const scheme = matchMedia('(prefers-color-scheme: dark)');

    // Accessible top origins let a site override cover its embedded frames too.
    // Cross-origin frames without ancestorOrigins fall back to their own host.
    function siteHostname() {
        try {
            return settingsAPI.hostname(window.top.location.href);
        } catch {
            const origins = location.ancestorOrigins;
            return settingsAPI.hostname(origins?.length ? origins[origins.length - 1] : location.href);
        }
    }

    const hostname = siteHostname();
    let settings = settingsAPI.normalize();
    let enabled = false;
    let error;
    let revision = 0;
    let appliedTheme;
    let settingsAvailable = false;

    const rootReady = document.documentElement ? Promise.resolve() : new Promise((resolve) => {
        const observer = new MutationObserver(() => {
            if (!document.documentElement) return;
            observer.disconnect();
            resolve();
        });
        observer.observe(document, {childList: true});
    });
    // Storage and scheme events may arrive before the HTML parser creates the root.
    rootReady.then(() => apply());

    function status() {
        return {enabled, hostname, ...(error ? {error} : {})};
    }

    function disable() {
        enabled = false;
        appliedTheme = undefined;
        engine?.disable();
    }

    function apply(forceRebuild = false) {
        if (!settingsAvailable || !document.documentElement) return status();
        error = undefined;
        try {
            if (forceRebuild) disable();
            if (!engine) throw new Error('The bundled dark-mode engine is unavailable.');
            if (!settingsAPI.effective(settings, hostname, scheme.matches)) {
                disable();
                return status();
            }
            const background = settings.deeper ? '#111315' : '#181a1b';
            if (!enabled || appliedTheme !== background) {
                engine.enable({
                    mode: 1,
                    brightness: 100,
                    contrast: 100,
                    grayscale: 0,
                    sepia: 0,
                    darkSchemeBackgroundColor: background,
                    darkSchemeTextColor: '#e8e6e3',
                    styleSystemControls: true,
                }, {
                    invert: [],
                    css: '',
                    ignoreInlineStyle: [],
                    // Our pinned build restricts this exclusion to URL images;
                    // CSS gradients are still converted. See scripts/build.cjs.
                    ignoreImageAnalysis: ['*'],
                });
                appliedTheme = background;
                enabled = true;
            }
        } catch (failure) {
            try { disable(); } catch { /* Preserve the original engine error. */ }
            error = failure instanceof Error ? failure.message : String(failure);
        }
        return status();
    }

    async function refresh(forceRebuild = false) {
        const requestRevision = ++revision;
        try {
            await rootReady;
            const stored = await api.storage.local.get('nightfall');
            if (requestRevision === revision) {
                settings = settingsAPI.normalize(stored.nightfall);
                settingsAvailable = true;
                apply(forceRebuild);
            }
        } catch {
            if (requestRevision === revision) {
                settingsAvailable = false;
                try { disable(); } catch { /* Report the storage failure. */ }
                error = 'Nightfall could not read its saved settings.';
            }
        }
        return status();
    }

    if (engine) {
        // No background proxy, credentials, or remote service: normal CORS applies.
        engine.setFetchMethod((url) => fetch(url, {credentials: 'omit', mode: 'cors'}));
    }

    api.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !Object.hasOwn(changes, 'nightfall')) return;
        ++revision;
        settings = settingsAPI.normalize(changes.nightfall.newValue);
        settingsAvailable = true;
        apply();
    });

    const ready = refresh();
    api.runtime.onMessage.addListener((message) => {
        if (message?.type === 'nightfall:status') return ready.then(status);
        if (message?.type === 'nightfall:refresh') return refresh(true);
        return undefined;
    });

    const onSchemeChange = () => apply();
    if (scheme.addEventListener) scheme.addEventListener('change', onSchemeChange);
    else scheme.addListener(onSchemeChange);

    // Safari may suspend pages without delivering storage events. Reconcile
    // saved preferences when a page resumes, without rebuilding an unchanged theme.
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) return refresh();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') return refresh();
    });
})();
