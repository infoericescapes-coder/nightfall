const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const {validateBundleIdentifier, normalizeProject, normalizeGeneratedProject} = require('../scripts/normalize-ios-identifiers.cjs');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/xcode27-identifiers.pbxproj'), 'utf8');
const helper = path.join(__dirname, '../scripts/normalize-ios-identifiers.cjs');

function identifiers(source) {
    return [...source.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map(match => match[1]);
}

test('normalizes the Xcode 27 app casing mismatch in both configurations, preserving other content', () => {
    const normalized = normalizeProject(fixture, 'com.ericescapes.nightfall');
    assert.deepEqual(identifiers(normalized), [
        'com.ericescapes.nightfall.Extension', 'com.ericescapes.nightfall.Extension',
        'com.ericescapes.nightfall', 'com.ericescapes.nightfall',
    ]);
    assert.equal(normalized, fixture.replaceAll('com.ericescapes.Nightfall;', 'com.ericescapes.nightfall;'));
    assert.equal(normalizeProject(normalized, 'com.ericescapes.nightfall'), normalized);
});

test('honors custom identifiers including case and hyphens and quoted generated values', () => {
    const requested = 'au.example.Photo-Team.Nightfall2';
    const customFixture = fixture.replace(/(PRODUCT_BUNDLE_IDENTIFIER = )([^;]+);/g, '$1"$2";');
    const result = identifiers(normalizeProject(customFixture, requested));
    assert.deepEqual(result, [`${requested}.Extension`, `${requested}.Extension`, requested, requested]);
});

test('rejects invalid requested identifiers before file access, including project syntax', () => {
    for (const value of ['', 'com..nightfall', '.com', 'com.', 'com.night_fall', 'com.*',
        'com. nightfall', 'com.nightfall\n', '$(PRODUCT_NAME)', 'com.test;OTHER = YES', null]) {
        assert.throws(() => validateBundleIdentifier(value), /NIGHTFALL_BUNDLE_ID/);
        assert.throws(() => normalizeGeneratedProject('/does-not-exist', value), /NIGHTFALL_BUNDLE_ID/);
    }
    assert.equal(validateBundleIdentifier('Photo-Team'), 'Photo-Team');
});

test('packaging script rejects an explicitly empty identifier before packager or build steps', () => {
    const result = spawnSync('bash', [path.join(__dirname, '../scripts/package-ios.sh')], {
        encoding:'utf8', env: {...process.env, NIGHTFALL_BUNDLE_ID:''},
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /NIGHTFALL_BUNDLE_ID/);
    assert.equal(result.stdout, '');
});

test('fails closed on unexpected targets, references, configurations, and identifier overrides', () => {
    const unexpected = [
        fixture.replace('name = Nightfall;', 'name = AnotherApp;'),
        fixture.replace('productType = "com.apple.product-type.app-extension";', 'productType = "com.apple.product-type.framework";'),
        fixture.replace('buildConfigurationList = 073AA519307072EB000D09C7', 'buildConfigurationList = FFFFFFFFFFFFFFFFFFFFFFFF'),
        fixture.replace('073AA51B307072EB000D09C7 /* Release configuration', 'FFFFFFFFFFFFFFFFFFFFFFFF /* Release configuration'),
        fixture.replaceAll('name = Release;', 'name = Profile;'),
        fixture.replace('PRODUCT_BUNDLE_IDENTIFIER = com.ericescapes.Nightfall;', 'PRODUCT_BUNDLE_IDENTIFIER = "$(PRODUCT_NAME)";'),
        fixture.replace('PRODUCT_BUNDLE_IDENTIFIER = com.ericescapes.Nightfall;', 'PRODUCT_BUNDLE_IDENTIFIER[sdk=iphoneos*] = com.ericescapes.Nightfall;'),
        fixture.replace('SDKROOT = iphoneos;', 'SDKROOT = iphoneos;\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.unexpected.project;'),
        fixture.replace('/* End XCConfigurationList section */', ''),
        fixture.replaceAll('\n', '\r\n'),
    ];
    for (const [index, source] of unexpected.entries()) {
        assert.throws(() => normalizeProject(source, 'com.example.nightfall'), `unexpected structure case ${index}`);
    }
});

test('CLI uses generated output layout, writes only identifiers, and leaves rejected projects untouched', t => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'nightfall-identifiers-'));
    t.after(() => fs.rmSync(output, {recursive:true, force:true}));
    const project = path.join(output, 'Nightfall', 'Nightfall.xcodeproj', 'project.pbxproj');
    fs.mkdirSync(path.dirname(project), {recursive:true});
    fs.writeFileSync(project, fixture);
    const success = spawnSync(process.execPath, [helper, output, 'com.example.My-App'], {encoding:'utf8'});
    assert.equal(success.status, 0, success.stderr);
    assert.equal(fs.readFileSync(project, 'utf8'), normalizeProject(fixture, 'com.example.My-App'));
    const unexpected = fixture.replace('name = Nightfall;', 'name = Unknown;');
    fs.writeFileSync(project, unexpected);
    const failure = spawnSync(process.execPath, [helper, output, 'com.example.My-App'], {encoding:'utf8'});
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /Unexpected generated Xcode project/);
    assert.equal(fs.readFileSync(project, 'utf8'), unexpected);
    assert.equal(spawnSync(process.execPath, [helper, '--validate', 'com.example.Valid']).status, 0);
    assert.equal(spawnSync(process.execPath, [helper, '--validate', '']).status, 1);
});
