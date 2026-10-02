const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const settingsSource = fs.readFileSync(path.join(__dirname, '../extension/settings.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');

function settingsContext() {
    const context = vm.createContext({URL});
    vm.runInContext(settingsSource, context);
    return context;
}

test('settings sanitize storage, parse hostnames, and enforce precedence', () => {
    const s = settingsContext().NightfallSettings;
    assert.equal(s.hostname('https://MAIL.Google.com.:443/inbox'), 'mail.google.com');
    assert.equal(s.hostname('Example.com'), 'example.com');
    assert.equal(s.hostname('file:///private/example'), '');
    assert.equal(s.hostname('not a hostname'), '');
    const value = s.normalize({enabled: 'false', mode: 'bogus', deeper: 0,
        sites: {'HTTPS://EXAMPLE.COM/a': 'off', 'bad host': 'on', invalid: 'yes'}});
    assert.equal(value.enabled, true);
    assert.equal(value.mode, 'dark');
    assert.equal(value.deeper, true);
    assert.deepEqual(Object.keys(value.sites), ['example.com']);
    assert.equal(s.effective(value, 'example.com', true), false);
    assert.equal(s.effective({enabled: false, sites: {'example.com': 'on'}}, 'example.com', true), false);
    assert.equal(s.effective({mode: 'system'}, 'example.com', false), false);
    assert.equal(s.effective({mode: 'system'}, 'example.com', true), true);
    assert.equal(s.effective({mode: 'system', sites: {'example.com': 'on'}}, 'example.com', false), true);
    assert.equal(s.effective({sites: {}}, 'constructor', false), true);
});

function engineContext(initial, options = {}) {
    const context = settingsContext();
    const calls = [];
    let onStorage, onMessage, onScheme, onRoot;
    const windowEvents = {}, documentEvents = {};
    let stored = initial;
    const scheme = {matches: false, addEventListener: (_, callback) => {onScheme = callback;}};
    Object.assign(context, {
        document: {documentElement: options.noRoot ? null : {}, visibilityState: 'visible', addEventListener: (name, callback) => {documentEvents[name] = callback;}},
        MutationObserver: class {
            constructor(callback) {onRoot = callback;}
            observe(target, configuration) {
                assert.equal(target, context.document);
                assert.equal(configuration.childList, true);
            }
            disconnect() {onRoot = undefined;}
        },
        browser: {
            storage: {local: {get: async () => {
                if (options.failRead) throw new Error('read failed');
                if (options.pendingRead) return options.pendingRead;
                return {nightfall: stored};
            }}, onChanged: {addListener: (callback) => {onStorage = callback;}}},
            runtime: {onMessage: {addListener: (callback) => {onMessage = callback;}}},
        },
        DarkReader: {
            enable: (theme, fixes) => {
                assert.ok(context.document.documentElement, 'engine needs the document root');
                calls.push({theme, fixes});
            },
            disable: () => calls.push('disable'),
            setFetchMethod: (callback) => {context.engineFetch = callback;},
        },
        matchMedia: () => scheme,
        location: {href: 'https://frame.example/', ancestorOrigins: ['https://parent.example', 'https://top.example']},
        fetch: async (...args) => {calls.push(args); return {};},
        window: {addEventListener: (name, callback) => {windowEvents[name] = callback;}, top: options.crossOrigin ? {get location() {throw new Error('cross origin');}} :
            {location: {href: 'https://mail.google.com/mail/'}}},
    });
    vm.runInContext(contentSource, context);
    return {
        calls, scheme, context,
        storeWithoutEvent: value => {stored = value;},
        resumeFromCache: () => windowEvents.pageshow({persisted: true}),
        becomeVisible: () => documentEvents.visibilitychange(),
        status: () => onMessage({type: 'nightfall:status'}),
        refresh: () => onMessage({type: 'nightfall:refresh'}),
        update: (value) => {stored = value; onStorage({nightfall: {newValue: value}}, 'local');},
        changeScheme: (dark) => {scheme.matches = dark; onScheme();},
        addRoot: () => {context.document.documentElement = {}; onRoot?.();},
    };
}

test('engine uses neutral dynamic theme, permits gradient processing, and updates stored controls', async () => {
    const h = engineContext(undefined);
    assert.equal((await h.status()).enabled, true);
    assert.equal((await h.status()).hostname, 'mail.google.com');
    assert.equal(h.calls[0].theme.darkSchemeBackgroundColor, '#111315');
    assert.equal(h.calls[0].theme.darkSchemeTextColor, '#e8e6e3');
    assert.equal(h.calls[0].fixes.ignoreImageAnalysis.join(','), '*');
    assert.equal(h.calls[0].fixes.invert.length, 0);
    h.update({mode: 'system'});
    assert.equal((await h.status()).enabled, false);
    h.changeScheme(true);
    assert.equal((await h.status()).enabled, true);
    h.update({deeper: false});
    assert.equal(h.calls.at(-1).theme.darkSchemeBackgroundColor, '#181a1b');
    h.update({sites: {'mail.google.com': 'off'}});
    assert.equal((await h.status()).enabled, false);
    h.update({enabled: false});
    assert.equal((await h.refresh()).enabled, false);
    await h.context.engineFetch('https://static.example/styles.css');
    assert.equal(h.calls.at(-1)[1].credentials, 'omit');
    assert.equal(h.calls.at(-1)[1].mode, 'cors');
});

test('cross-origin frames use top ancestor host without elevated permissions', async () => {
    const h = engineContext({sites: {'top.example': 'off'}}, {crossOrigin: true});
    assert.equal((await h.status()).hostname, 'top.example');
    assert.equal((await h.status()).enabled, false);
});

test('storage failures keep engine disabled even after a scheme change', async () => {
    const h = engineContext(undefined, {failRead: true});
    assert.equal((await h.status()).enabled, false);
    assert.match((await h.status()).error, /saved settings/);
    h.changeScheme(true);
    assert.equal((await h.status()).enabled, false);
    assert.match((await h.status()).error, /saved settings/);
});

test('a storage change takes precedence over an older pending initial read', async () => {
    const h = engineContext(undefined);
    h.update({enabled: false});
    assert.equal((await h.status()).enabled, false);
    assert.equal(h.calls.includes('disable'), true);
    assert.equal(h.calls.some((call) => typeof call === 'object' && call.theme), false);
});

test('explicit refresh rebuilds the enabled engine even when its theme is unchanged', async () => {
    const h = engineContext(undefined);
    await h.status();
    assert.equal(h.calls.length, 1);
    h.changeScheme(true);
    assert.equal(h.calls.length, 1);
    const result = await h.refresh();
    assert.equal(result.enabled, true);
    assert.equal(h.calls.length, 3);
    assert.equal(h.calls[1], 'disable');
    assert.equal(h.calls[2].theme.darkSchemeBackgroundColor, '#111315');
});

test('failed explicit refresh disables safely without re-enabling stale settings', async () => {
    const options = {};
    const h = engineContext(undefined, options);
    await h.status();
    options.failRead = true;
    const result = await h.refresh();
    assert.equal(result.enabled, false);
    assert.match(result.error, /saved settings/);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1], 'disable');
    h.changeScheme(true);
    assert.equal(h.calls.length, 2);
});

test('a superseded explicit refresh does not rebuild after a newer storage update', async () => {
    const options = {};
    const h = engineContext(undefined, options);
    await h.status();
    let resolveRead;
    options.pendingRead = new Promise((resolve) => {resolveRead = resolve;});
    const pendingRefresh = h.refresh();
    h.update({deeper: true});
    resolveRead({nightfall: {deeper: false}});
    assert.equal((await pendingRefresh).enabled, true);
    assert.equal(h.calls.length, 1);
});

test('document_start waits for the parser root before enabling or explicitly refreshing', async () => {
    const h = engineContext(undefined, {noRoot: true});
    const pendingRefresh = h.refresh();
    h.changeScheme(true);
    await Promise.resolve();
    assert.equal(h.calls.length, 0);
    h.addRoot();
    assert.equal((await pendingRefresh).enabled, true);
    assert.equal((await h.status()).enabled, true);
    assert.equal(h.calls.filter((call) => call && call.theme).length, 1);
});

test('disabled saved preferences never transiently enable when the root appears', async () => {
    const h = engineContext({enabled: false}, {noRoot: true});
    await Promise.resolve();
    assert.equal(h.calls.length, 0);
    h.addRoot();
    assert.equal((await h.status()).enabled, false);
    assert.equal(h.calls.some((call) => call && call.theme), false);
});

test('storage changes received before the root are applied once it appears', async () => {
    const h = engineContext(undefined, {noRoot: true});
    h.update({enabled: false});
    h.changeScheme(true);
    assert.equal(h.calls.length, 0);
    h.addRoot();
    assert.equal((await h.status()).enabled, false);
    assert.equal(h.calls.some((call) => call && call.theme), false);
});


test('resumed Safari pages reconcile preferences missed during suspension', async () => {
    const h = engineContext(undefined);
    await h.status();
    h.storeWithoutEvent({enabled: false});
    await h.resumeFromCache();
    assert.equal((await h.status()).enabled, false);
    h.storeWithoutEvent({enabled: true});
    await h.becomeVisible();
    assert.equal((await h.status()).enabled, true);
    const count = h.calls.length;
    await h.becomeVisible();
    assert.equal(h.calls.length, count, 'unchanged visibility resumes must not rebuild the engine');
});
