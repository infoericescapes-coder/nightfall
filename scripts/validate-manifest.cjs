function validateManifest(manifest) {
    if (typeof manifest?.description !== 'string') {
        throw new Error('manifest.json description must be a string of 112 characters or fewer.');
    }
    if (manifest.description.length > 112) {
        throw new Error(`manifest.json description must be 112 characters or fewer (received ${manifest.description.length}).`);
    }
}

module.exports = {validateManifest};
