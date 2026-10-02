const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const ext = path.join(root, 'extension');
fs.mkdirSync(path.join(ext, 'vendor'), {recursive:true});
// Dark Reader's exclusion skips the entire background-image declaration, including
// CSS gradients. Limit it to URL images so photography stays intact while gradients
// are still darkened. Keep this patch pinned and fail closed on upstream changes.
const engineVersion = require(path.join(root,'node_modules/darkreader/package.json')).version;
if (engineVersion !== '4.9.133') throw new Error('Review the image-preservation patch before upgrading Dark Reader.');
let engine = fs.readFileSync(path.join(root,'node_modules/darkreader/darkreader.js'),'utf8').replace(/\r\n/g,'\n');
function patchOnce(before, after) {
  if (engine.split(before).length !== 2) throw new Error('Dark Reader patch anchor changed; refusing to package.');
  engine = engine.replace(before, after);
}
patchOnce(
  '            if (shouldIgnoreImage(rule.selectorText, ignoreImageSelectors)) {\n                return value;\n            }\n            const gradients = parseGradient(value);',
  '            const ignoreRasterImages = ignoreImageSelectors.includes("*") || shouldIgnoreImage(rule.selectorText, ignoreImageSelectors);\n            const gradients = parseGradient(value);'
);
patchOnce(
  '                url = getAbsoluteURL(baseURL, url);\n                return async (theme) => {',
  '                url = getAbsoluteURL(baseURL, url);\n                // Nightfall: preserve URL images; gradient modifiers still run.\n                if (ignoreRasterImages) {\n                    return () => isURLEmpty ? "url(\'\')" : `url(${JSON.stringify(url)})`;\n                }\n                return async (theme) => {'
);
patchOnce(
  'if (property === "background-image" && value.includes("url")) {',
  'if (property === "background-image" && value.includes("url") && !value.includes("gradient(")) {'
);
patchOnce(
  ': ownerNode?.baseURI || location.origin;',
  ': ownerNode?.baseURI || document.baseURI;'
);
fs.writeFileSync(path.join(ext,'vendor/darkreader.js'),'/* Nightfall adaptation: URL-only image exclusion. See scripts/build.cjs and vendor/NIGHTFALL-PATCH.txt. */\n'+engine);
fs.copyFileSync(path.join(root,'node_modules/darkreader/LICENSE'),path.join(ext,'vendor/DARKREADER-LICENSE'));
fs.copyFileSync(path.join(root,'LICENSE'),path.join(ext,'LICENSE'));
fs.mkdirSync(path.join(ext,'fonts'),{recursive:true});
for(const [font,weight] of [['space-grotesk',500],['ibm-plex-mono',400]]) {
  const name=`${font}-latin-${weight}-normal.woff2`;
  fs.copyFileSync(path.join(root,`node_modules/@fontsource/${font}/files/${name}`),path.join(ext,'fonts',name));
  fs.copyFileSync(path.join(root,`node_modules/@fontsource/${font}/LICENSE`),path.join(ext,'fonts',`${font}-LICENSE`));
}
const manifest = JSON.parse(fs.readFileSync(path.join(ext,'manifest.json')));
for(const script of manifest.content_scripts.flatMap(x=>x.js)) if(!fs.existsSync(path.join(ext,script))) throw new Error(`Missing ${script}`);
fs.mkdirSync(path.join(root,'dist'),{recursive:true});
const output=path.join(root,'dist','Nightfall-Safari.zip');
if(fs.existsSync(output)) fs.unlinkSync(output);
execFileSync('/usr/bin/zip',['-qr',output,'.','-x','*.DS_Store','__MACOSX/*'],{cwd:ext});
console.log(`Packaged ${manifest.name} ${manifest.version}: ${output}`);
