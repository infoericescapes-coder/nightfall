const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const shots = '/tmp/nightfall-qa';
fs.mkdirSync(shots, {recursive: true});
const defaults = {enabled:true,mode:'dark',deeper:true,sites:{}};
function mockBrowser({initial,tabURL,platform = 'mac',unresponsive = false}) {
    let value=structuredClone(initial); const listeners=[]; const messages=[];
    window.qa={writes:[],messages,tabMessages:[],unresponsive,read:()=>structuredClone(value),set:async next=>{
      const oldValue=value; value=structuredClone(next);
      for(const fn of listeners)fn({nightfall:{oldValue,newValue:value}},'local');
    },send:async type=>{for(const fn of messages){const result=fn({type});if(result!==undefined)return await result;}},status:async()=>window.qa.send('nightfall:status')};
    window.browser={storage:{local:{get:async()=>({nightfall:structuredClone(value)}),set:async data=>{window.qa.writes.push(structuredClone(data));await window.qa.set(data.nightfall);}},onChanged:{addListener:fn=>listeners.push(fn)}},runtime:{getPlatformInfo:async()=>({os:platform}),onMessage:{addListener:fn=>messages.push(fn)}},tabs:{query:async()=>[{id:1,url:tabURL}],sendMessage:async(_tab,message)=>{window.qa.tabMessages.push({type:message.type,time:performance.now()});if(window.qa.unresponsive)return new Promise(()=>{});return {enabled:window.NightfallSettings.effective(value,tabURL,matchMedia('(prefers-color-scheme: dark)').matches),hostname:new URL(tabURL).hostname};}}};
}
async function mockAPI(page, initial = defaults, tabURL = 'https://mail.example.test/inbox', options = {}) {
  await page.addInitScript(mockBrowser, {initial,tabURL,...options});
}
async function routes(page, {scriptCSP = false} = {}) {
  await page.route('https://mail.example.test/**', route => route.fulfill({path:path.join(root,'tests/fixture.html'),contentType:'text/html',headers:scriptCSP?{'Content-Security-Policy':"script-src 'self'"}:{}}));
  await page.route('https://nightfall.example.test/**', async route => {
    const relative=new URL(route.request().url()).pathname.replace(/^\//,'');
    const file=path.join(root,'extension',relative);
    const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.woff2':'font/woff2'};
    await route.fulfill({path:file,contentType:types[path.extname(file)]||'application/octet-stream'});
  });
}
async function inject(page) {
  for(const file of ['vendor/darkreader.js','settings.js','content.js'])await page.addScriptTag({path:path.join(root,'extension',file)});
}
async function bg(page, selector) {return page.locator(selector).evaluate(el=>getComputedStyle(el).backgroundColor);}
function luminance(css) {const c=css.match(/[\d.]+/g).slice(0,3).map(Number);return .2126*c[0]+.7152*c[1]+.0722*c[2];}
async function expectDark(page, selector) {await expect.poll(async()=>luminance(await bg(page,selector)), {message:`${selector} should become a dark surface`}).toBeLessThan(100);}
async function mediaStyles(page) {return page.evaluate(()=>Object.fromEntries(['photo','video','canvas','background-picture'].map(id=>{const e=document.getElementById(id),s=getComputedStyle(e);return[id,{filter:s.filter,opacity:s.opacity,src:e.src||e.poster||e.toDataURL?.()||s.backgroundImage}]})));}

test('bundled engine darkens pale surfaces, dynamic DOM and shadow DOM; disabling restores originals', async ({page},info) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await mockAPI(page,{...defaults,enabled:false});await routes(page);await page.goto('https://mail.example.test/inbox');
  await expect(page).toHaveTitle('Synthetic mail test fixture');await expect(page.locator('h1')).toHaveText('Synthetic inbox');
  const selectors=['body','#sidebar','#toolbar','#main','#card','.shadow-card'];
  const originals=Object.fromEntries(await Promise.all(selectors.map(async s=>[s,await bg(page,s)])));
  const media=await mediaStyles(page);
  await page.screenshot({path:`${shots}/${info.project.name}-before.png`,fullPage:true});
  await inject(page);await page.evaluate(s=>window.qa.set(s),defaults);
  await expect.poll(()=>page.evaluate(()=>window.qa.status())).toMatchObject({enabled:true,hostname:'mail.example.test'});
  for(const selector of selectors)await expectDark(page,selector);
  await expect.poll(()=>page.locator('#card').evaluate(e=>getComputedStyle(e).color)).not.toBe('rgb(51, 51, 51)');
  expect(await mediaStyles(page)).toEqual(media);
  expect(await page.locator('#gradient').evaluate(e=>getComputedStyle(e).backgroundImage)).toContain('linear-gradient');
  await page.evaluate(()=>window.addSyntheticSurface());await expectDark(page,'#dynamic');
  await page.screenshot({path:`${shots}/${info.project.name}-after.png`,fullPage:true});
  await page.evaluate(s=>window.qa.set({...s,enabled:false}),defaults);
  for(const selector of selectors)await expect.poll(()=>bg(page,selector)).toBe(originals[selector]);
  await expect.poll(()=>bg(page,'#dynamic')).toBe('rgb(255, 255, 255)');
  expect(await mediaStyles(page)).toEqual(media);expect(errors).toEqual([]);
});

test('CSS gradients remain readable without pale glare', async ({page}) => {
  await mockAPI(page);await routes(page);await page.goto('https://mail.example.test/inbox');await inject(page);await expectDark(page,'#card');
  const gradient=await page.locator('#gradient').evaluate(e=>({image:getComputedStyle(e).backgroundImage,text:getComputedStyle(e).color}));
  const stops=gradient.image.match(/rgba?\([^)]+\)/g)||[];expect(stops.length).toBeGreaterThan(0);
  for(const stop of stops)expect(luminance(stop),JSON.stringify(gradient)).toBeLessThan(100);
});

test('large pale raster backgrounds retain pixels while mixed gradients and relative URLs are converted', async ({page},info) => {
  await mockAPI(page,{...defaults,enabled:false});await routes(page);await page.goto('https://mail.example.test/folder/inbox');
  const raster=await page.evaluate(()=>window.fixtureMedia.highkeyURL.split(',')[1]);
  await page.route('https://mail.example.test/folder/assets/highkey.png',route=>route.fulfill({body:Buffer.from(raster,'base64'),contentType:'image/png'}));
  await page.evaluate(async()=>{document.querySelector('#mixed-background').style.backgroundImage='linear-gradient(90deg,rgba(255,255,255,.5),rgba(221,221,221,.5)),url("assets/highkey.png")';const image=new Image();image.src='assets/highkey.png';await image.decode()});
  const highkey=page.locator('#highkey');
  const originalImage=await highkey.evaluate(e=>getComputedStyle(e).backgroundImage);
  const rasterShot=async suffix=>{await highkey.scrollIntoViewIfNeeded();const box=await highkey.boundingBox();return page.screenshot({path:`${shots}/${info.project.name}-highkey-${suffix}.png`,clip:{x:Math.ceil(box.x),y:Math.ceil(box.y),width:Math.floor(box.width)-1,height:Math.floor(box.height)-1}})};
  const original=await rasterShot('before');
  const originalMixed=await page.locator('#mixed-background').evaluate(e=>getComputedStyle(e).backgroundImage);
  const originalURL=originalMixed.match(/url\(.*\)$/)[0];
  expect(originalURL).toContain('https://mail.example.test/folder/assets/highkey.png');
  await inject(page);await page.evaluate(s=>window.qa.set(s),defaults);await expectDark(page,'#card');
  await expect.poll(()=>highkey.evaluate(e=>getComputedStyle(e).backgroundImage)).toBe(originalImage);
  const filters=await highkey.evaluate(e=>{const result=[];for(let n=e;n;n=n.parentElement)result.push(getComputedStyle(n).filter);return result});
  expect(filters).toEqual(filters.map(()=> 'none'));
  const after=await rasterShot('after');
  expect(after.equals(original),'opaque raster screenshot pixels should be identical').toBe(true);
  await expect.poll(async()=>{const image=await page.locator('#mixed-background').evaluate(e=>getComputedStyle(e).backgroundImage);return (image.match(/rgba?\([^)]+\)/g)||[]).map(luminance)}, {message:'mixed inline gradient stops should become dark while its raster URL is retained'}).toEqual([expect.any(Number),expect.any(Number)]);
  await expect.poll(async()=>{const image=await page.locator('#mixed-background').evaluate(e=>getComputedStyle(e).backgroundImage);return Math.max(...(image.match(/rgba?\([^)]+\)/g)||[]).map(luminance))}).toBeLessThan(100);
  const mixed=await page.locator('#mixed-background').evaluate(e=>getComputedStyle(e).backgroundImage);
  expect(mixed.match(/url\(.*\)$/)[0]).toBe(originalURL);
  await page.locator('#mixed-background').screenshot({path:`${shots}/${info.project.name}-mixed-background.png`});
});

test('document-start injection and explicit refresh recover same-count CSSOM changes under script CSP', async ({page}) => {
  const scripts=['vendor/darkreader.js','settings.js','content.js'].map(file=>fs.readFileSync(path.join(root,'extension',file),'utf8')).join('\n');
  await page.addInitScript({content:`(${mockBrowser.toString()})(${JSON.stringify({initial:defaults,tabURL:'https://mail.example.test/inbox'})});window.qa.startedBeforeRoot=!document.documentElement;\n${scripts}`});
  await routes(page,{scriptCSP:true});await page.goto('https://mail.example.test/inbox');
  expect(await page.evaluate(()=>window.qa.startedBeforeRoot)).toBe(true);await expectDark(page,'#card');
  await page.evaluate(()=>{const style=document.createElement('style');style.id='cssom-test';style.textContent='.unused-cssom-selector{background:#fff;color:#333}';document.head.append(style);const target=document.createElement('div');target.id='cssom-target';target.textContent='Same rule count CSSOM recovery';document.body.append(target)});
  // The strict CSP blocks DarkReader's page-script proxy. A selector replacement
  // with unchanged rule count exercises manual rebuild rather than a DOM mutation.
  await expect.poll(()=>page.evaluate(()=>{return Array.from(document.querySelectorAll('style.darkreader--sync')).flatMap(style=>Array.from(style.sheet?.cssRules||[]).map(rule=>rule.cssText));})).toContainEqual(expect.stringContaining('.unused-cssom-selector'));
  await page.evaluate(()=>{const sheet=document.querySelector('#cssom-test').sheet;sheet.deleteRule(0);sheet.insertRule('#cssom-target{background:#fff;color:#333}',0)});
  await expect.poll(()=>bg(page,'#cssom-target')).toBe('rgb(255, 255, 255)');
  expect(await page.evaluate(()=>document.querySelector('#cssom-test').sheet.cssRules.length)).toBe(1);
  await page.evaluate(()=>window.qa.send('nightfall:refresh'));await expectDark(page,'#cssom-target');
});

test('system preference, deeper setting and hostname overrides update live rendering', async ({page}) => {
  await page.emulateMedia({colorScheme:'light'});await mockAPI(page,{...defaults,mode:'system'});await routes(page);await page.goto('https://mail.example.test/inbox');await inject(page);
  await expect.poll(()=>page.evaluate(()=>window.qa.status())).toMatchObject({enabled:false});
  expect(await bg(page,'#card')).toBe('rgb(255, 255, 255)');
  await page.emulateMedia({colorScheme:'dark'});await expectDark(page,'#card');
  const deep=await bg(page,'body');await page.evaluate(s=>window.qa.set({...s,mode:'system',deeper:false}),defaults);
  await expect.poll(()=>bg(page,'body')).not.toBe(deep);
  await page.evaluate(s=>window.qa.set({...s,sites:{'mail.example.test':'off'}}),defaults);
  await expect.poll(()=>bg(page,'#card')).toBe('rgb(255, 255, 255)');
  await page.emulateMedia({colorScheme:'light'});await page.evaluate(s=>window.qa.set({...s,mode:'system',sites:{'mail.example.test':'on'}}),defaults);await expectDark(page,'#card');
  await page.evaluate(s=>window.qa.set({...s,mode:'system',sites:{'other.example.test':'on'}}),defaults);
  await expect.poll(()=>bg(page,'#card')).toBe('rgb(255, 255, 255)');
});

for(const width of [160,360])test(`popup keeps intrinsic width from ${width}px and persists preferences`,async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.setViewportSize({width,height:600});await mockAPI(page);await routes(page);await page.goto('https://nightfall.example.test/popup.html');
  await expect(page).toHaveTitle('Nightfall');await expect(page.locator('h1')).toHaveText('Nightfall');await expect(page.locator('#controls')).toBeEnabled();await expect(page.locator('#hostname')).toHaveText('mail.example.test');
  // Native Safari initially measures a tiny viewport, then sizes the popover to the root.
  expect(await page.locator('html').evaluate(e=>e.getBoundingClientRect().width)).toBe(360);
  expect(await page.locator('body').evaluate(e=>e.getBoundingClientRect().width)).toBe(360);
  await page.setViewportSize({width:360,height:600});
  await page.locator('#enabled').uncheck();await expect.poll(()=>page.evaluate(()=>window.qa.read().enabled)).toBe(false);await expect(page.locator('#status')).toHaveText('Nightfall is paused everywhere.');
  await page.locator('#enabled').check();await expect(page.locator('#controls')).toBeEnabled();await page.locator('#deeper').uncheck();await expect.poll(()=>page.evaluate(()=>window.qa.read().deeper)).toBe(false);
  await page.locator('#mode').selectOption('system');await expect.poll(()=>page.evaluate(()=>window.qa.read().mode)).toBe('system');
  await page.locator('#site').selectOption('off');await expect.poll(()=>page.evaluate(()=>window.qa.read().sites['mail.example.test'])).toBe('off');
  await page.locator('#site').selectOption('on');await expect.poll(()=>page.evaluate(()=>window.qa.read().sites['mail.example.test'])).toBe('on');
  await page.locator('#site').selectOption('default');await expect.poll(()=>page.evaluate(()=>Object.keys(window.qa.read().sites).length)).toBe(0);
  await expect(page.locator('#controls')).toBeEnabled();await page.locator('#refresh').click();
  await page.evaluate(()=>document.fonts.ready);
  expect(await page.evaluate(()=>document.fonts.check('500 34px "Space Grotesk"')&&document.fonts.check('400 10px "IBM Plex Mono"'))).toBe(true);
  const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));expect(sizes.document).toBe(360);expect(sizes.body).toBe(360);
  expect(await page.locator('body').evaluate(e=>e.clientHeight)).toBe(600);
  await page.locator('footer').scrollIntoViewIfNeeded();await expect(page.locator('footer')).toBeInViewport();
  await page.evaluate(()=>document.body.scrollTop=0);
  expect(await page.evaluate(()=>window.qa.writes.length)).toBe(7);
  await page.screenshot({path:`${shots}/${info.project.name}-popup-${width}.png`,fullPage:true});expect(errors).toEqual([]);
});

// These exercise the iOS runtime-class layout in desktop browser engines.
// They do not model the native Safari extension sheet or device safe-area values.
const longHost=`mail.${'a'.repeat(60)}.${'b'.repeat(60)}.example.test`;
for(const viewport of [{width:320,height:568},{width:390,height:700},{width:844,height:390},{width:768,height:1024}]) {
  test(`simulated iOS popup fits ${viewport.width}px, exposes touch controls and saves a toggle`, async ({page},info)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize(viewport);await mockAPI(page,defaults,`https://${longHost}/inbox`,{platform:'ios'});await routes(page);await page.goto('https://nightfall.example.test/popup.html');
    await expect(page.locator('html')).toHaveClass('nightfall-ios');await expect(page.locator('#enabled')).toBeEnabled();
    await expect(page.locator('#hostname')).toHaveText(longHost);
    const dimensions=await page.evaluate(()=>({viewport:innerWidth,root:document.documentElement.getBoundingClientRect().width,body:document.body.getBoundingClientRect().width,scroll:document.documentElement.scrollWidth,bodyScroll:document.body.scrollWidth,padding:parseFloat(getComputedStyle(document.body).paddingBottom)}));
    expect(dimensions.root).toBe(viewport.width);expect(dimensions.body).toBe(viewport.width);expect(dimensions.scroll).toBeLessThanOrEqual(viewport.width);expect(dimensions.bodyScroll).toBeLessThanOrEqual(viewport.width);expect(dimensions.padding).toBeGreaterThanOrEqual(18);
    const controls=await page.locator('#site,#mode,#refresh,.toggle-row').evaluateAll(elements=>elements.map(e=>({height:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize),select:e.tagName==='SELECT'})));
    for(const control of controls){expect(control.height).toBeGreaterThanOrEqual(44);if(control.select)expect(control.font).toBe(16);}
    const hostBox=await page.locator('#hostname').boundingBox();expect(hostBox.x).toBeGreaterThanOrEqual(0);expect(hostBox.x+hostBox.width).toBeLessThanOrEqual(viewport.width);
    await page.locator('#enabled').uncheck();await expect.poll(()=>page.evaluate(()=>window.qa.read().enabled)).toBe(false);await expect(page.locator('#enabled')).toBeEnabled();await expect(page.locator('#status')).toHaveText('Nightfall is paused everywhere.');
    await page.locator('footer').scrollIntoViewIfNeeded();await expect(page.locator('footer')).toBeInViewport({ratio:1});
    const footer=await page.locator('footer').boundingBox();expect(footer.y).toBeGreaterThanOrEqual(0);expect(footer.y+footer.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({path:`${shots}/${info.project.name}-ios-${viewport.width}.png`,fullPage:true});expect(errors).toEqual([]);
  });
}

test('simulated iOS popup maintains a 320px intrinsic minimum from an initial 160px viewport',async({page})=>{
  await page.setViewportSize({width:160,height:568});await mockAPI(page,defaults,'https://mail.example.test/inbox',{platform:'ios'});await routes(page);await page.goto('https://nightfall.example.test/popup.html');await expect(page.locator('html')).toHaveClass('nightfall-ios');
  for(const selector of ['html','body'])expect(await page.locator(selector).evaluate(e=>e.getBoundingClientRect().width)).toBe(320);
  await page.setViewportSize({width:320,height:568});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);await expect(page.locator('#enabled')).toBeEnabled();
});

test('simulated iOS popup bounds an unresponsive page request and saves preferences within one timeout',async({page})=>{
  await page.setViewportSize({width:390,height:700});await mockAPI(page,defaults,'https://mail.example.test/inbox',{platform:'ios',unresponsive:true});await routes(page);await page.goto('https://nightfall.example.test/popup.html');
  await expect(page.locator('#status')).toContainText('Nightfall cannot reach this page yet.',{timeout:4500});await expect(page.locator('#enabled')).toBeEnabled();
  await page.evaluate(()=>{window.qa.tabMessages=[];window.qa.saveStarted=performance.now()});
  await page.locator('#enabled').uncheck();await expect.poll(()=>page.evaluate(()=>window.qa.read().enabled)).toBe(false);await expect(page.locator('#enabled')).toBeDisabled();
  await expect(page.locator('#enabled')).toBeEnabled({timeout:4500});await expect(page.locator('#status')).toHaveText('Preference saved on this device. Reload the website to apply it when Safari is ready.');
  const result=await page.evaluate(()=>({elapsed:performance.now()-window.qa.saveStarted,writes:window.qa.writes,requests:window.qa.tabMessages}));
  expect(result.elapsed).toBeGreaterThanOrEqual(2900);expect(result.elapsed).toBeLessThan(4500);expect(result.writes).toHaveLength(1);expect(result.writes[0].nightfall.enabled).toBe(false);expect(result.requests.map(request=>request.type)).toEqual(['nightfall:refresh']);
  await expect(page.locator('#refresh')).toBeHidden();
});
