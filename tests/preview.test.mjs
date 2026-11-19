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

test('repo docs and local files are never served', async () => {
    for (const p of ['/ADMIN.md', '/.dev.vars', '/.dev.vars.example', '/BRIEF-admin-preview.md', '/cms/auth.js', '/tests/helpers.mjs', '/package.json']) {
        assert.ok(isBlockedPath(p), p);
        assert.equal((await run(`https://snowhillmbc.com${p}`)).status, 404);
        assert.equal((await run(`https://x.pages.dev${p}`)).status, 401);
    }
    assert.ok(!isBlockedPath('/images/logo.png'));
    assert.ok(!isBlockedPath('/'));
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

import { existsSync, readFileSync } from 'node:fs';
import { PREVIEW_ADMIN_EMAIL, previewEnv } from '../cms/preview.js';
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
