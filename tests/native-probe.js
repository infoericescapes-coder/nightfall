(() => {
    'use strict';
    if (window.__nightfallNativeProbe) return;
    window.__nightfallNativeProbe = true;
    const topFrame = window.top === window;
    const events = [];
    const record = (type, detail = {}) => {
        events.push({type, timestamp:performance.now(), ...detail});
        if (events.length > 30) events.shift();
    };
    window.addEventListener('pageshow', event => { record('pageshow', {persisted:event.persisted}); report(); });
    window.addEventListener('pagehide', event => { record('pagehide', {persisted:event.persisted}); report(); });
    document.addEventListener('visibilitychange', () => { record('visibilitychange', {visibility:document.visibilityState}); report(); });

    const photo = document.querySelector('#photo');
    const backgrounds = ['background-picture', 'highkey', 'mixed-background'];
    const fingerprint = value => {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
        return {prefix:value.slice(0, 30), length:value.length, hash:(hash >>> 0).toString(16)};
    };
    const imageURLs = value => [...value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)]
        .map(match => (match[1] ?? match[2] ?? match[3]).trim());
    // Fixture media are assigned inline before this external probe loads. These
    // source URLs remain a baseline even when extension styles already exist.
    const baseline = {
        photoSource:photo?.src || '',
        photoFilter:'none', // The unmodified synthetic fixture defines no filter.
        observedInitialPhotoFilter:photo ? getComputedStyle(photo).filter : null,
        backgrounds:Object.fromEntries(backgrounds.map(id => {
            const element = document.getElementById(id);
            return [id, element ? imageURLs(element.style.backgroundImage) : []];
        })),
    };
    let status;
    let posting = false;
    let postStatus = 'waiting';

    const surface = selector => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const style = getComputedStyle(element);
        return {backgroundColor:style.backgroundColor, backgroundImage:style.backgroundImage,
            color:style.color, filter:style.filter};
    };
    function measure() {
        const currentPhoto = document.querySelector('#photo');
        return {
            kind:'nightfall-native-probe', url:location.href, topFrame,
            userAgent:navigator.userAgent,
            viewport:{innerWidth:window.innerWidth, innerHeight:window.innerHeight, devicePixelRatio:window.devicePixelRatio},
            systemDark:window.matchMedia('(prefers-color-scheme: dark)').matches,
            frameKind:new URL(location.href).searchParams.get('frame') || 'top',
            timestamp:performance.now(), timeOrigin:performance.timeOrigin,
            visibility:document.visibilityState, events:events.slice(),
            navigationType:performance.getEntriesByType('navigation')[0]?.type || null,
            surfaces:{body:surface('body'), sidebar:surface('#sidebar'), card:surface('#card'),
                gradient:surface('#gradient'), dynamic:surface('#dynamic')},
            engineStyles:{count:document.querySelectorAll('style.darkreader').length,
                classes:[...document.querySelectorAll('style.darkreader')].map(style => style.className)},
            image:currentPhoto ? {source:fingerprint(currentPhoto.src), baselineSource:fingerprint(baseline.photoSource),
                sourcePreserved:currentPhoto.src === baseline.photoSource,
                filter:getComputedStyle(currentPhoto).filter, baselineFilter:baseline.photoFilter,
                observedInitialFilter:baseline.observedInitialPhotoFilter,
                filterPreserved:getComputedStyle(currentPhoto).filter === baseline.photoFilter} : null,
            rasterBackgrounds:Object.fromEntries(backgrounds.map(id => {
                const element = document.getElementById(id);
                if (!element) return [id, null];
                const style = getComputedStyle(element);
                const urls = imageURLs(style.backgroundImage);
                return [id, {urls:urls.map(fingerprint), baselineURLs:baseline.backgrounds[id].map(fingerprint),
                    urlsPreserved:JSON.stringify(urls) === JSON.stringify(baseline.backgrounds[id]), filter:style.filter}];
            })),
        };
    }
    async function report() {
        const sample = measure();
        if (status) status.textContent = `Measured ${Math.round(sample.timestamp)} ms · ${sample.visibility}\n` +
            `Body ${sample.surfaces.body?.backgroundColor} · engine styles ${sample.engineStyles.count}\n` +
            `Photo source ${sample.image?.sourcePreserved ? 'preserved' : 'absent/changed'} · filter ${sample.image?.filter || 'n/a'}\n` +
            `Raster URLs ${Object.values(sample.rasterBackgrounds).filter(Boolean).every(value => value.urlsPreserved) ? 'preserved' : 'changed'}\n` +
            `Latest pageshow persisted: ${sample.events.filter(event => event.type === 'pageshow').at(-1)?.persisted ?? 'pending'} · telemetry ${postStatus}`;
        if (posting) return;
        posting = true;
        try {
            const response = await fetch('/telemetry', {method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify(sample), keepalive:true});
            postStatus = response.ok ? 'saved' : `HTTP ${response.status}`;
        } catch { postStatus = 'unavailable'; }
        finally { posting = false; }
    }

    if (topFrame) {
        const panel = document.createElement('section');
        panel.id = 'native-probe-controls';
        panel.style.cssText = 'padding:16px;border:2px solid #777;position:relative;z-index:1;font:15px/1.5 system-ui';
        const title = document.createElement('h2');
        title.textContent = 'Synthetic native Safari probe';
        panel.append(title);
        const button = (label, action) => {
            const control = document.createElement('button');
            control.type = 'button'; control.textContent = label;
            control.style.cssText = 'min-height:48px;margin:4px;padding:12px;font-size:16px';
            control.addEventListener('click', () => { record('control', {label}); action(); report(); });
            panel.append(control);
        };
        if (location.pathname === '/away') button('Back to fixture', () => history.back());
        else {
            button('Add synthetic surface', () => window.addSyntheticSurface());
            button('Reload fixture', () => location.reload());
            button('Navigate away', () => location.assign('/away'));
            button('History back', () => history.back());
            button('Embed fixture frames', () => {
                if (document.getElementById('native-probe-frames')) return;
                const container = document.createElement('div');
                container.id = 'native-probe-frames';
                for (const kind of ['same-origin', 'cross-origin']) {
                    const frame = document.createElement('iframe');
                    const url = new URL('/fixture.html', location.href);
                    if (kind === 'cross-origin') url.hostname = location.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
                    url.searchParams.set('frame', kind);
                    frame.src = url.href; frame.title = `Synthetic ${kind} fixture`;
                    frame.style.cssText = 'width:100%;height:360px;border:2px solid #777;margin:8px 0';
                    container.append(frame);
                }
                panel.append(container);
            });
        }
        status = document.createElement('pre');
        status.style.cssText = 'white-space:pre-wrap;font-size:13px';
        status.setAttribute('aria-live', 'polite');
        panel.append(status);
        document.body.prepend(panel);
    }
    // Frames measure independently but never create controls or nested frames.
    report();
    window.setInterval(report, 2000);
})();
