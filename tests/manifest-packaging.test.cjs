const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const {validateManifest} = require('../scripts/validate-manifest.cjs');

test('accepts the actual manifest and the 112-character description boundary', () => {
    validateManifest(require('../extension/manifest.json'));
    validateManifest({description: 'a'.repeat(112)});
});

test('rejects missing, non-string and 113-character descriptions', () => {
    for (const manifest of [{}, {description: null}, {description: 112},
        {description: []}, {description: 'a'.repeat(113)}]) {
        assert.throws(() => validateManifest(manifest), /manifest\.json description must be .*112/);
    }
});

test('invalid descriptions fail packaging before generated files or an existing ZIP change', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nightfall-manifest-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    for (const dir of ['scripts', 'extension', 'dist']) {
        fs.mkdirSync(path.join(root, dir));
    }
    for (const file of ['build.cjs', 'validate-manifest.cjs']) {
        fs.copyFileSync(path.join(__dirname, '../scripts', file), path.join(root, 'scripts', file));
    }
    const output = path.join(root, 'dist/Nightfall-Safari.zip');
    fs.writeFileSync(output, 'existing package');
    for (const manifest of [{}, {description: null}, {description: 'a'.repeat(113)}]) {
        const source = JSON.stringify(manifest);
        fs.writeFileSync(path.join(root, 'extension/manifest.json'), source);
        const result = spawnSync(process.execPath, [path.join(root, 'scripts/build.cjs')], {encoding: 'utf8'});
        assert.equal(result.status, 1);
        assert.match(result.stderr, /manifest\.json description must be .*112/);
        assert.equal(result.stdout, '');
        assert.equal(fs.readFileSync(output, 'utf8'), 'existing package');
        assert.deepEqual(fs.readdirSync(path.join(root, 'extension')), ['manifest.json']);
        assert.equal(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'), source);
    }
});
