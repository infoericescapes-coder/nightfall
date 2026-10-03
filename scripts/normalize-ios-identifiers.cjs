const fs = require('node:fs');
const path = require('node:path');

function validateBundleIdentifier(identifier) {
    // Literal CFBundleIdentifier characters only; never accept Xcode variables,
    // wildcards, empty components, or text that could become project syntax.
    if (typeof identifier !== 'string' || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/.test(identifier)) {
        throw new Error('NIGHTFALL_BUNDLE_ID must contain only letters, numbers, hyphens, and nonempty dot-separated components.');
    }
    return identifier;
}

function unexpected(detail) {
    throw new Error(`Unexpected generated Xcode project: ${detail}; refusing to normalize identifiers.`);
}

// Deliberately support the packager's section/object layout, not arbitrary user
// projects. Resolve ownership through target references rather than UUIDs or IDs.
function objectsInSection(source, section) {
    const start = `/* Begin ${section} section */`;
    const end = `/* End ${section} section */`;
    if (source.split(start).length !== 2 || source.split(end).length !== 2) unexpected(section);
    const body = source.slice(source.indexOf(start) + start.length, source.indexOf(end));
    const objects = new Map();
    const pattern = /^\t\t([A-F0-9]{24})(?: \/\*[^\n]*?\*\/)? = \{\n[\s\S]*?^\t\t\};/gm;
    let remainder = body;
    for (const match of body.matchAll(pattern)) {
        if (objects.has(match[1]) || !match[0].includes(`\n\t\t\tisa = ${section};\n`)) unexpected(section);
        objects.set(match[1], {text: match[0], offset: source.indexOf(start) + start.length + match.index});
        remainder = remainder.replace(match[0], '');
    }
    if (remainder.trim() || !objects.size) unexpected(section);
    return objects;
}

function oneMatch(text, pattern, detail) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length !== 1) unexpected(detail);
    return matches[0];
}

function normalizeProject(source, identifier) {
    validateBundleIdentifier(identifier);
    if (source.includes('\r')) unexpected('line endings');
    const targets = objectsInSection(source, 'PBXNativeTarget');
    const lists = objectsInSection(source, 'XCConfigurationList');
    const configurations = objectsInSection(source, 'XCBuildConfiguration');
    if (targets.size !== 2) unexpected('expected exactly two native targets');
    const expected = new Map([
        ['Nightfall', {type: 'application', identifier}],
        ['Nightfall Extension', {type: 'app-extension', identifier: `${identifier}.Extension`}],
    ]);
    const edits = [];
    const usedConfigurations = new Set();
    const usedLists = new Set();
    for (const target of targets.values()) {
        const nameMatch = oneMatch(target.text, /^\t\t\tname = (?:"([^"]+)"|([^;\n]+));$/gm, 'target name');
        const name = nameMatch[1] || nameMatch[2];
        const settings = expected.get(name);
        if (!settings) unexpected('target names');
        expected.delete(name);
        const type = oneMatch(target.text, /^\t\t\tproductType = "com\.apple\.product-type\.([^"]+)";$/gm, 'product type')[1];
        if (type !== settings.type) unexpected('product type');
        const listId = oneMatch(target.text, /^\t\t\tbuildConfigurationList = ([A-F0-9]{24})(?: \/\*[^\n]*?\*\/)?;$/gm, 'target configuration list')[1];
        const list = lists.get(listId);
        if (!list || usedLists.has(listId)) unexpected('target configuration list reference');
        usedLists.add(listId);
        const entries = oneMatch(list.text, /^\t\t\tbuildConfigurations = \(\n([\s\S]*?)^\t\t\t\);$/gm, 'configuration references')[1];
        const refs = [...entries.matchAll(/^\t\t\t\t([A-F0-9]{24})(?: \/\*[^\n]*?\*\/)?,\n/gm)];
        if (refs.length !== 2 || entries.replace(/^\t\t\t\t[A-F0-9]{24}(?: \/\*[^\n]*?\*\/)?,\n/gm, '').trim()) unexpected('expected Debug and Release references');
        const names = new Set();
        for (const ref of refs) {
            const configuration = configurations.get(ref[1]);
            if (!configuration || usedConfigurations.has(ref[1])) unexpected('configuration ownership');
            usedConfigurations.add(ref[1]);
            const configurationName = oneMatch(configuration.text, /^\t\t\tname = (Debug|Release);$/gm, 'configuration name')[1];
            if (names.has(configurationName)) unexpected('duplicate configuration name');
            names.add(configurationName);
            const buildSettings = oneMatch(configuration.text, /^\t\t\tbuildSettings = \{\n([\s\S]*?)^\t\t\t\};$/gm, 'build settings');
            const assignment = oneMatch(buildSettings[1], /^\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ("[^"\n]*"|[^;\n]+);$/gm, 'bundle identifier assignment');
            const oldIdentifier = assignment[1].replace(/^"|"$/g, '');
            validateBundleIdentifier(oldIdentifier);
            const assignmentOffset = configuration.text.indexOf(buildSettings[1]) + assignment.index;
            edits.push({start: configuration.offset + assignmentOffset, length: assignment[0].length,
                text: `\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ${settings.identifier};`});
        }
    }
    // Reject additional, conditional, or project-level overrides instead of
    // silently leaving settings that could invalidate the embedded extension.
    if ((source.match(/\bPRODUCT_BUNDLE_IDENTIFIER\b/g) || []).length !== edits.length) unexpected('extra bundle identifier settings');
    let result = source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
        result = result.slice(0, edit.start) + edit.text + result.slice(edit.start + edit.length);
    }
    return result;
}

function normalizeGeneratedProject(output, identifier) {
    validateBundleIdentifier(identifier);
    const project = path.join(output, 'Nightfall', 'Nightfall.xcodeproj', 'project.pbxproj');
    const source = fs.readFileSync(project, 'utf8');
    const normalized = normalizeProject(source, identifier);
    if (normalized !== source) fs.writeFileSync(project, normalized);
}

if (require.main === module) {
    try {
        const args = process.argv.slice(2);
        if (args.length === 2 && args[0] === '--validate') validateBundleIdentifier(args[1]);
        else if (args.length === 2) normalizeGeneratedProject(args[0], args[1]);
        else throw new Error('Usage: normalize-ios-identifiers.cjs <generated-output> <bundle-id> | --validate <bundle-id>');
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = {validateBundleIdentifier, normalizeProject, normalizeGeneratedProject};
