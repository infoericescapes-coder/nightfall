(() => {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const S = globalThis.NightfallSettings;
  // WebKit reports the iOS family here, including iPad with desktop browsing.
  // CSS also has an iOS feature fallback so layout does not wait on this query.
  try {
    Promise.resolve(api.runtime?.getPlatformInfo?.()).then(platform => {
      if (platform?.os === 'ios') document.documentElement.classList.add('nightfall-ios');
    }).catch(() => {});
  } catch { /* Keep the CSS fallback when the API is unavailable. */ }
  const el = Object.fromEntries(['controls','enabled','site','hostname','mode','deeper','status','refresh'].map(id => [id, document.getElementById(id)]));
  let tab, host = '', settings, pending = Promise.resolve();
  let statusRevision = 0;
  // iOS can suspend a tab while the Safari extension sheet is open. Do not leave
  // the controls disabled indefinitely if the tab never answers a message.
  async function sendToTab(type) {
    let timer;
    try {
      return await Promise.race([
        api.tabs.sendMessage(tab.id, {type}, {frameId:0}),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Page response timed out')), 3000); })
      ]);
    } finally { clearTimeout(timer); }
  }
  function render() {
    el.enabled.checked = settings.enabled;
    el.mode.value = settings.mode;
    el.deeper.checked = settings.deeper;
    el.site.value = settings.sites[host] || 'default';
    el.site.disabled = !host;
    el.hostname.textContent = host || 'No supported website open';
  }
  async function status(response) {
    const revision = ++statusRevision;
    if (!host) { el.status.textContent = 'Open an ordinary website to use Nightfall. Safari settings and built-in pages cannot be themed.'; el.refresh.hidden = true; return; }
    try {
      const result = response || await sendToTab('nightfall:status');
      if (revision !== statusRevision) return;
      if (!result || result.error) throw new Error(result?.error || 'No response');
      const desired = S.effective(settings, host, matchMedia('(prefers-color-scheme: dark)').matches);
      el.status.textContent = result.enabled !== desired ? 'Preference saved. The page is still applying it; choose Apply again if needed.' : result.enabled ? 'Dark mode is active on this page.' : !settings.enabled ? 'Nightfall is paused everywhere.' : 'This page is using its original colours.';
      el.refresh.hidden = false;
    } catch {
      if (revision !== statusRevision) return;
      el.status.textContent = 'Nightfall cannot reach this page yet. Allow website access in Safari, then reload the page. Turn off your other dark-mode extension first.';
      el.refresh.hidden = true;
    }
  }
  function save(change) {
    el.controls.disabled = true;
    pending = pending.then(async () => {
      const fresh = S.normalize((await api.storage.local.get('nightfall')).nightfall);
      change(fresh);
      await api.storage.local.set({nightfall: fresh});
      settings = fresh;
      render();
      if (host) {
        try { await status(await sendToTab('nightfall:refresh')); }
        catch { el.status.textContent = 'Preference saved on this device. Reload the website to apply it when Safari is ready.'; }
      } else { await status(); }
    }).catch(() => { el.status.textContent = 'Could not save this change. Close Nightfall and try again.'; }).finally(() => { el.controls.disabled = false; });
  }
  el.enabled.addEventListener('change', () => { const value=el.enabled.checked; save(s => {s.enabled=value;}); });
  el.deeper.addEventListener('change', () => { const value=el.deeper.checked; save(s => {s.deeper=value;}); });
  el.mode.addEventListener('change', () => { const value=el.mode.value; save(s => {s.mode=value;}); });
  el.site.addEventListener('change', () => { const value=el.site.value; save(s => {if(value==='default') delete s.sites[host]; else s.sites[host]=value;}); });
  el.refresh.addEventListener('click', async () => {
    el.refresh.disabled=true;
    try { await status(await sendToTab('nightfall:refresh')); }
    catch { el.status.textContent = 'Safari has not responded yet. Your preferences are saved; reload the website to apply them.'; }
    finally { el.refresh.disabled=false; }
  });
  (async () => {
    try {
      settings = S.normalize((await api.storage.local.get('nightfall')).nightfall);
      [tab] = await api.tabs.query({active:true,currentWindow:true});
      host = S.hostname(tab?.url || '');
      render(); el.controls.disabled=false; await status();
    } catch { el.status.textContent='Nightfall could not connect. Close this panel and try again.'; }
  })();
})();
