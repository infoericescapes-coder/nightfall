const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const defaultLog = path.join(root, 'native-ios', 'native-probe.jsonl');

function createServer({logPath = defaultLog} = {}) {
    return http.createServer((request, response) => {
        let url;
        try { url = new URL(request.url, 'http://127.0.0.1'); }
        catch { response.writeHead(400).end(); return; }
        // Revalidate fixture/navigation responses without prohibiting storage;
        // no-store can exclude pages from native back/forward cache testing.
        response.setHeader('Cache-Control', url.pathname === '/native-probe.js' || url.pathname === '/telemetry' ? 'no-store' : 'no-cache');
        if (request.method === 'POST' && url.pathname === '/telemetry') {
            let body = '';
            let bytes = 0;
            request.on('data', chunk => {
                bytes += chunk.length;
                if (bytes > 65536) { response.writeHead(413).end(); request.destroy(); return; }
                body += chunk;
            });
            request.on('end', () => {
                if (bytes > 65536) return;
                let sample;
                try {
                    sample = JSON.parse(body);
                    const sampleURL = new URL(sample.url);
                    if (sample.kind !== 'nightfall-native-probe' ||
                        !['127.0.0.1', 'localhost'].includes(sampleURL.hostname) ||
                        !['/', '/fixture.html', '/away'].includes(sampleURL.pathname)) throw new Error('Invalid synthetic sample');
                } catch { response.writeHead(400).end('Invalid synthetic telemetry'); return; }
                try {
                    fs.mkdirSync(path.dirname(logPath), {recursive:true});
                    fs.appendFileSync(logPath, JSON.stringify({...sample, receivedAt: new Date().toISOString()}) + '\n');
                    response.writeHead(204).end();
                } catch { response.writeHead(500).end('Cannot write probe log'); }
            });
            return;
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
        let content;
        let type;
        try {
            if (url.pathname === '/' || url.pathname === '/fixture.html') {
                content = fs.readFileSync(path.join(root, 'tests/fixture.html'), 'utf8');
                if (!content.includes('</body>')) throw new Error('Missing fixture body');
                content = content.replace('</body>', '<script src="/native-probe.js"></script></body>');
                type = 'text/html; charset=utf-8';
            } else if (url.pathname === '/native-probe.js') {
                content = fs.readFileSync(path.join(root, 'tests/native-probe.js'));
                type = 'text/javascript; charset=utf-8';
            } else if (url.pathname === '/away') {
                content = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic navigation destination</title></head><body><h1>Synthetic navigation destination</h1><p>Use Back below to test restoration of the fixture.</p><script src="/native-probe.js"></script></body></html>';
                type = 'text/html; charset=utf-8';
            } else if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
            else { response.writeHead(404).end('Not found'); return; }
            response.writeHead(200, {'Content-Type':type});
            response.end(request.method === 'HEAD' ? undefined : content);
        } catch { response.writeHead(500).end('Cannot serve synthetic fixture'); }
    });
}

if (require.main === module) {
    const host = process.env.NIGHTFALL_PROBE_HOST || '127.0.0.1';
    if (!['127.0.0.1', 'localhost', '0.0.0.0'].includes(host)) {
        console.error('NIGHTFALL_PROBE_HOST must be 127.0.0.1, localhost, or 0.0.0.0.');
        process.exitCode = 1;
    } else {
        const server = createServer();
        server.on('error', error => { console.error(error.message); process.exitCode = 1; });
        server.listen(8766, host, () => console.log(
            `Synthetic Safari fixture: http://127.0.0.1:8766/ (localhost also serves the cross-origin frame).\n` +
            `Telemetry: ${defaultLog}\nUse the page buttons with the installed extension; Ctrl-C stops the server.`));
    }
}

module.exports = {createServer};
