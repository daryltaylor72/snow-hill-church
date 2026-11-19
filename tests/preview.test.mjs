import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { onRequest } from '../functions/_middleware.js';
import { onRequest as apiRequest } from '../functions/api/admin/[[path]].js';
import { PASSWORD_SHA256, PREVIEW_EXPIRES_AT, isAdminPath, isBlockedPath, normalizePath, previewGate } from '../cms/preview.js';

const TEST_PASSWORD = 'correct horse';
const auth = (pw) => ({ authorization: `Basic ${Buffer.from(`user:${pw}`).toString('base64')}` });
const assets = { fetch: async () => new Response('<html>asset</html>', { headers: { 'content-type': 'text/html' } }) };
const run = (url, headers = {}, fn = onRequest, now) => fn({
    request: new Request(url, { headers }), env: { ASSETS: assets }, params: { path: 'session' },
    next: async () => new Response('next', { status: 200, headers: { 'content-type': 'text/plain' } })
});

test('hash in repo is a sha256 hex and no plaintext password file is referenced', async () => {
    assert.match(PASSWORD_SHA256, /^[0-9a-f]{64}$/);
    const src = await readFile(new URL('../cms/preview.js', import.meta.url), 'utf8');
    assert.ok(!/password\s*[:=]\s*['"][^'"]{6,}/i.test(src));
    assert.notEqual(createHash('sha256').update(TEST_PASSWORD).digest('hex'), PASSWORD_SHA256);
});

test('production hosts: admin and admin API are 404, public paths pass through', async () => {
    for (const host of ['snowhillmbc.com', 'www.snowhillmbc.com']) {
        assert.equal((await run(`https://${host}/admin/`)).status, 404);
        assert.equal((await run(`https://${host}/admin`, auth('x'))).status, 404);
        assert.equal((await run(`https://${host}/api/admin/session`)).status, 404);
        assert.equal((await run(`https://${host}/api/admin/session`, {}, apiRequest)).status, 404);
        const other = await run(`https://${host}/api/contact`);
        assert.equal(other.status, 200);
        assert.equal(await other.text(), 'next');
        assert.equal(other.headers.get('www-authenticate'), null);
    }
});

test('non-production hosts require the password and are noindex', async () => {
    for (const path of ['/', '/admin/', '/api/admin/session', '/api/contact']) {
        const res = await run(`https://x.snow-hill-church-git.pages.dev${path}`);
        assert.equal(res.status, 401, path);
        assert.match(res.headers.get('www-authenticate'), /Basic/);
        assert.match(res.headers.get('x-robots-tag'), /noindex/);
        const bad = await run(`https://x.snow-hill-church-git.pages.dev${path}`, auth('wrong'));
        assert.equal(bad.status, 401);
    }
    assert.equal((await run('https://x.pages.dev/api/admin/session', {}, apiRequest)).status, 401);
});

test('expiry: 410 at and after 2026-11-20 7:30 PM ET', async () => {
    assert.equal(new Date(PREVIEW_EXPIRES_AT).toISOString(), '2026-11-21T00:30:00.000Z');
    const req = new Request('https://x.pages.dev/');
    assert.equal((await previewGate(req, PREVIEW_EXPIRES_AT - 1)).status, 401);
    assert.equal((await previewGate(req, PREVIEW_EXPIRES_AT)).status, 410);
});

const CMS_FILES = readdirSync(new URL('../cms/', import.meta.url));

test('repo docs and local files are never served', async () => {
    for (const p of ['/ADMIN.md', '/.dev.vars', '/.dev.vars.example', '/BRIEF-admin-preview.md', '/cms/auth.js', '/tests/helpers.mjs', '/package.json']) {
        assert.ok(isBlockedPath(p), p);
        assert.equal((await run(`https://snowhillmbc.com${p}`)).status, 404);
        assert.equal((await run(`https://x.pages.dev${p}`)).status, 401);
    }
    assert.ok(!isBlockedPath('/images/logo.png'));
    assert.ok(!isBlockedPath('/'));
    // Telling isBlockedPath it is on a preview host unblocks only the PREVIEW_SERVABLE files.
    for (const p of ['/ADMIN.md', '/.dev.vars', '/.dev.vars.example', '/BRIEF-admin-preview.md', '/package.json', '/wrangler.toml',
        '/tests/helpers.mjs', '/scripts/bake.mjs', '/content/home.json', '/snapshots/README.md', '/cms', '/cms/',
        ...CMS_FILES.filter((f) => f !== 'schema.js').map((f) => `/cms/${f}`)]) {
        assert.ok(isBlockedPath(p, { production: false }), `preview ${p}`);
    }
});

test('gitignore keeps local files out', async () => {
    const gi = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
    for (const f of ['.dev.vars', 'BRIEF-admin-preview.md']) assert.ok(gi.split('\n').includes(f));
});

const TRICKY = ['/%61dmin/', '//admin/', '/admin%2F', '/%63ms/preview.js', '//cms/preview.js', '/%41DMIN.md',
    '/%2e%64ev.vars.example', '/%63ontent/home.json', '/%2561dmin/', '/a/../admin/', '/admin\\x', '/CLAUDE.md', '/snapshots/README.md', '/%53napshots/README.md'];

test('normalizePath: decoded, slash-collapsed, dot-resolved, lowercase; undecodable fails closed', () => {
    assert.equal(normalizePath('/%61dmin/'), '/admin');
    assert.equal(normalizePath('//Admin%2F'), '/admin');
    assert.equal(normalizePath('/%2561dmin'), '/admin');
    assert.equal(normalizePath('/x/%2e%2e/admin'), '/admin');
    assert.equal(normalizePath('/%E0%A4%A'), null);
    assert.equal(normalizePath('/a%00b'), null);
    assert.ok(isAdminPath('/%E0%A4%A') && isBlockedPath('/%E0%A4%A'));
});

test('encoded / double-slash variants: 401 on preview, 404 on prod hosts (never 200)', async () => {
    for (const p of TRICKY) {
        const preview = await run(`https://x.pages.dev${p}`);
        assert.equal(preview.status, 401, `preview ${p}`);
        for (const host of ['snowhillmbc.com', 'www.snowhillmbc.com']) {
            const prod = await run(`https://${host}${p}`);
            assert.equal(prod.status, 404, `${host} ${p}`);
        }
    }
});

test('encoded variants with a valid login on preview are still blocked or gated, never served raw', async () => {
    // wrong password: 401; wrong user: 401; no colon: 401
    const b64 = (v) => ({ authorization: 'Basic ' + Buffer.from(v).toString('base64') });
    for (const hdr of [auth('nope'), b64('daryl'), b64('notdaryl:nope')]) {
        assert.equal((await run('https://x.pages.dev/%61dmin/', hdr)).status, 401);
    }
});

test('expired preview returns 410 for every variant, before auth', async () => {
    for (const p of TRICKY) {
        const res = await previewGate(new Request(`https://x.pages.dev${p}`), PREVIEW_EXPIRES_AT);
        assert.equal(res.status, 410, p);
    }
});

test('gated responses are private, no-store, noindex', async () => {
    const res = await run('https://x.pages.dev/');
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.match(res.headers.get('x-robots-tag'), /noindex/);
});

test('public static paths still pass through on production', async () => {
    for (const p of ['/', '/images/logo.png', '/404.html', '/robots.txt']) {
        const res = await run(`https://snowhillmbc.com${p}`);
        assert.equal(res.status, 200, p);
    }
});

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { PREVIEW_ADMIN_EMAIL, PREVIEW_SERVABLE, PREVIEW_USER, previewEnv } from '../cms/preview.js';
import { resolveIdentity } from '../cms/auth.js';

test('preview env: Access email daryltaylor72@gmail.com is admin, unknown email has no role', async () => {
    const env = previewEnv({});
    assert.equal(PREVIEW_ADMIN_EMAIL, 'daryltaylor72@gmail.com');
    const via = (email) => resolveIdentity(new Request('https://x.pages.dev/admin/', { headers: { 'cf-access-authenticated-user-email': email } }), env);
    assert.deepEqual(await via('daryltaylor72@gmail.com'), { email: 'daryltaylor72@gmail.com', role: 'admin', dev: false });
    assert.equal((await via('Stranger@example.com')).role, null);
    // an explicitly configured allowlist is not overridden
    assert.equal(previewEnv({ ADMIN_EMAILS: 'a@b.c' }).ADMIN_EMAILS, 'a@b.c');
});

const CREDS = '/workspace/deploy-proofs/snowhill-preview-credentials.txt';
test('middleware on a preview host: valid Basic Auth + Access email gets admin; unknown email gets no-access', { skip: !existsSync(CREDS) }, async () => {
    const pw = readFileSync(CREDS, 'utf8').match(/^password:\s*(.+)$/mi)[1].trim();
    const basic = 'Basic ' + Buffer.from(`daryl:${pw}`).toString('base64');
    const go = (email) => run('https://x.pages.dev/admin/', { authorization: basic, 'cf-access-authenticated-user-email': email });
    assert.equal((await go('daryltaylor72@gmail.com')).status, 200);
    assert.equal((await go('stranger@example.com')).status, 403);
    // production hosts stay 404 regardless
    const prod = await run('https://snowhillmbc.com/admin/', { authorization: basic, 'cf-access-authenticated-user-email': 'daryltaylor72@gmail.com' });
    assert.equal(prod.status, 404);
});

// ---- /cms/schema.js: the one source file the admin page needs in the browser ----

const PREVIEW = 'https://x.snow-hill-church-git.pages.dev';
const ROOT = new URL('../', import.meta.url);
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8' };

// Stand-in for the Pages asset server: serves repo files by exact, case-sensitive path.
const repoAssets = {
    fetch: async (input) => {
        let { pathname } = new URL(input instanceof Request ? input.url : input);
        if (pathname.endsWith('/')) pathname += 'index.html';
        const file = new URL('.' + pathname, ROOT);
        if (!existsSync(file) || !statSync(file).isFile()) return new Response('asset 404', { status: 404 });
        return new Response(readFileSync(file), { headers: { 'content-type': TYPES[extname(pathname)] || 'application/octet-stream', etag: '"x"' } });
    }
};

/**
 * Run the middleware as a signed-in preview visitor. The real password is not in the repo,
 * so for the duration of the call SHA-256 of TEST_PASSWORD is made to equal the stored hash.
 * Everything else (user check, header parsing, expiry, path rules) runs unmodified.
 */
async function runSignedIn(url, { method = 'GET', password = TEST_PASSWORD } = {}) {
    const real = crypto.subtle.digest;
    crypto.subtle.digest = async function (algorithm, data) {
        if (new TextDecoder().decode(data) === TEST_PASSWORD) return Uint8Array.from(Buffer.from(PASSWORD_SHA256, 'hex')).buffer;
        return real.call(this, algorithm, data);
    };
    try {
        const request = new Request(url, { method, headers: { authorization: 'Basic ' + Buffer.from(`${PREVIEW_USER}:${password}`).toString('base64') } });
        return await onRequest({ request, env: { ASSETS: repoAssets }, params: {}, next: () => repoAssets.fetch(request) });
    } finally {
        delete crypto.subtle.digest;
    }
}

const SCHEMA_SRC = readFileSync(new URL('cms/schema.js', ROOT), 'utf8');
// Spellings that normalize to /cms/schema.js. (new URL() itself resolves the dot segments.)
const SCHEMA_VARIANTS = ['/cms/schema.js', '/CMS/schema.js', '/cms/Schema.JS', '/cms/../cms/schema.js', '//cms/schema.js',
    '/%63ms/schema.js', '/cms%2Fschema.js', '/cms/%2e%2e/cms/schema.js', '/%2563ms/schema.js', '/cms\\schema.js', '/cms/./schema.js', '/cms/schema.js/'];

test('signed-in test helper: only the right user and password pass', async () => {
    assert.equal((await runSignedIn(`${PREVIEW}/admin/`)).status, 200);
    assert.equal((await runSignedIn(`${PREVIEW}/admin/`, { password: 'wrong' })).status, 401);
    assert.equal(crypto.subtle.digest, SubtleCrypto.prototype.digest, 'digest restored');
    assert.equal((await run(`${PREVIEW}/admin/`, auth(TEST_PASSWORD))).status, 401, 'no bypass outside the helper');
});

test('preview host + valid login: /cms/schema.js is served as JavaScript, private and noindex', async () => {
    const res = await runSignedIn(`${PREVIEW}/cms/schema.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    assert.equal(await res.text(), SCHEMA_SRC);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.match(res.headers.get('x-robots-tag'), /noindex/);
    assert.equal(res.headers.get('etag'), null);
    assert.equal((await runSignedIn(`${PREVIEW}/cms/schema.js`, { method: 'HEAD' })).status, 200);
    assert.equal((await runSignedIn(`${PREVIEW}/cms/schema.js`, { method: 'POST' })).status, 404);
});

test('/cms/schema.js spellings: only ever the same file on preview, 404 on production, 401 without a login', async () => {
    for (const p of SCHEMA_VARIANTS) {
        assert.equal(normalizePath(new URL(PREVIEW + p).pathname), '/cms/schema.js', p);
        const res = await runSignedIn(PREVIEW + p);
        assert.equal(res.status, 200, `preview ${p}`);
        assert.equal(await res.text(), SCHEMA_SRC, `preview ${p}`);

        assert.equal((await run(PREVIEW + p)).status, 401, `no auth ${p}`);
        assert.equal((await run(PREVIEW + p, auth('wrong'))).status, 401, `bad auth ${p}`);
        assert.equal((await runSignedIn(PREVIEW + p, { password: 'wrong' })).status, 401, `bad password ${p}`);
        for (const host of ['snowhillmbc.com', 'www.snowhillmbc.com', 'SnowHillMBC.com']) {
            assert.equal((await run(`https://${host}${p}`)).status, 404, `${host} ${p}`);
            assert.equal((await runSignedIn(`https://${host}${p}`)).status, 404, `${host} signed in ${p}`);
            assert.ok(isBlockedPath(p), `default (production) ${p}`);
        }
    }
});

test('every other cms file and repo path stays 404 on preview with a valid login', async () => {
    assert.deepEqual([...PREVIEW_SERVABLE], ['/cms/schema.js']);
    assert.ok(CMS_FILES.includes('schema.js') && CMS_FILES.length > 5);
    const others = CMS_FILES.filter((f) => f !== 'schema.js').map((f) => `/cms/${f}`);
    for (const f of ['/cms/auth.js', '/cms/preview.js', '/cms/content-data.js', '/cms/workflow.js']) assert.ok(others.includes(f), f);
    const paths = [...others, '/cms', '/cms/', '/cms/schema.js.map', '/cms/schema.json', '/cms/schema.js/x', '/cms/schema.jsx', '/cms/schema',
        '/cms/x/schema.js', '/x/cms/schema.js/../auth.js', '/cms/schema.js/../auth.js', '/cms/schema.js%2F..%2Fpreview.js', '/cms/schema.js\\..\\store.js',
        '/%63ms/auth.js', '//CMS/Preview.js', '/cms/schema.js%00', '/cms/auth.js?x=/cms/schema.js',
        '/tests/preview.test.mjs', '/scripts/bake.mjs', '/content/home.json', '/snapshots/README.md',
        '/ADMIN.md', '/README.md', '/CLAUDE.md', '/package.json', '/wrangler.toml', '/.dev.vars.example'];
    for (const p of paths) {
        const res = await runSignedIn(PREVIEW + p);
        assert.ok(res.status === 404 || res.status === 400, `${p} -> ${res.status}`);
        const body = await res.text();
        assert.ok(!body.includes('export ') && !body.includes('import '), `${p} leaked source`);
    }
    // a query string never changes which file is chosen
    const q = await runSignedIn(`${PREVIEW}/cms/schema.js?file=/cms/auth.js`);
    assert.equal(await q.text(), SCHEMA_SRC);
});

test('expired preview: /cms/schema.js is 410 like everything else', async () => {
    const res = await previewGate(new Request(`${PREVIEW}/cms/schema.js`), PREVIEW_EXPIRES_AT);
    assert.equal(res.status, 410);
});

test('cms/schema.js is safe to expose: no imports, no secrets, no server APIs', () => {
    assert.deepEqual(relativeImports(SCHEMA_SRC), []);
    assert.ok(!/\bimport\b|\brequire\s*\(/.test(SCHEMA_SRC.replace(/\/\/.*$/gm, '')));
    assert.ok(!SCHEMA_SRC.includes(PASSWORD_SHA256) && !SCHEMA_SRC.includes(PREVIEW_ADMIN_EMAIL));
    assert.ok(!/secret|passw|token|api[_-]?key|authorization|sha-?256|process\.env|\benv\.|ADMIN_KV|@[a-z0-9-]+\.(com|org|net)/i.test(SCHEMA_SRC));
});

// Static scan for module specifiers: import ... from 'x', import 'x', export ... from 'x', import('x').
function relativeImports(src) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const found = new Set();
    const patterns = [/\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"`]([^'"`]+)['"`]/g];
    for (const re of patterns) for (const m of code.matchAll(re)) found.add(m[1]);
    return [...found];
}

test('every module the admin page loads is servable on a preview host (blank admin page regression)', async () => {
    const html = readFileSync(new URL('admin/index.html', ROOT), 'utf8');
    const entries = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]).filter((s) => !/^(https?:)?\/\//.test(s));
    assert.ok(entries.length > 0, 'admin/index.html loads a script');
    const queue = entries.map((s) => new URL(s, `${PREVIEW}/admin/`).pathname);
    assert.ok(queue.includes('/admin/admin.js'), 'admin/index.html loads admin.js');

    const seen = new Set();
    while (queue.length) {
        const path = queue.shift();
        if (seen.has(path)) continue;
        seen.add(path);
        const file = new URL('.' + path, ROOT);
        assert.ok(existsSync(file), `${path} exists in the repo`);
        assert.ok(!isBlockedPath(path, { production: false }), `${path} is imported by the admin page but blocked on preview hosts`);
        const res = await runSignedIn(PREVIEW + path);
        assert.equal(res.status, 200, `${path} is imported by the admin page but answers ${res.status} on preview`);
        assert.match(res.headers.get('content-type'), /javascript/, path);
        const src = readFileSync(file, 'utf8');
        assert.equal(await res.text(), src, path);
        for (const spec of relativeImports(src)) {
            assert.ok(/^\.{0,2}\//.test(spec), `${path} imports "${spec}": browser modules here must use relative paths`);
            queue.push(new URL(spec, PREVIEW + path).pathname);
        }
    }
    assert.ok(seen.has('/cms/schema.js'), 'walk reached cms/schema.js');
});
