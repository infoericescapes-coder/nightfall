/* Shared by the popup and content scripts; no page or storage side effects. */
(() => {
    'use strict';

    const DEFAULTS = Object.freeze({
        enabled: true,
        mode: 'dark',
        deeper: true,
        sites: Object.freeze({}),
    });

    function hostname(value) {
        if (typeof value !== 'string' || !value.trim()) return '';
        try {
            const input = value.trim();
            const url = new URL(input.includes('://') ? input : `https://${input}`);
            if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
            return url.hostname.toLowerCase().replace(/\.$/, '');
        } catch {
            return '';
        }
    }

    function normalize(value) {
        const source = value && typeof value === 'object' ? value : {};
        const sites = {};
        if (source.sites && typeof source.sites === 'object' && !Array.isArray(source.sites)) {
            for (const [key, override] of Object.entries(source.sites)) {
                const host = hostname(key);
                if (host && (override === 'on' || override === 'off')) {
                    Object.defineProperty(sites, host, {
                        value: override, enumerable: true, writable: true, configurable: true,
                    });
                }
            }
        }
        return {
            enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULTS.enabled,
            mode: source.mode === 'system' ? 'system' : DEFAULTS.mode,
            deeper: typeof source.deeper === 'boolean' ? source.deeper : DEFAULTS.deeper,
            sites,
        };
    }

    function effective(value, host, isSystemDark) {
        const settings = normalize(value);
        if (!settings.enabled) return false;
        const key = hostname(host);
        const override = Object.hasOwn(settings.sites, key) ? settings.sites[key] : undefined;
        if (override === 'off') return false;
        if (override === 'on') return true;
        return settings.mode === 'dark' || Boolean(isSystemDark);
    }

    globalThis.NightfallSettings = Object.freeze({DEFAULTS, normalize, hostname, effective});
})();
