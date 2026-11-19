import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { can, hostAllowed, isDevMode, resolveIdentity, roleFor, verifyAccessJwt } from '../cms/auth.js';
import {
    ADMIN, DEV_ENV, PASTOR, PROD_ENV, STRANGER, blockNetwork, call, editedEvents, makeCtx, repoContent
} from './helpers.mjs';

let net;
before(() => { net = blockNetwork(); });
after(() => { assert.equal(net.calls, 0, 'tests must not touch the network'); net.restore(); });

const req = (headers = {}, url = 'https://admin.test/admin/') => new Request(url, { headers });

test('roles come from the email allowlist', () => {
    assert.equal(roleFor(ADMIN, PROD_ENV), 'admin');
    assert.equal(roleFor(' Pastor@SnowHillMBC.example ', PROD_ENV), 'pastor');
    assert.equal(roleFor(STRANGER, PROD_ENV), null);
    assert.equal(roleFor('', PROD_ENV), null);
    assert.equal(roleFor(ADMIN, {}), null, 'no allowlist configured means nobody gets in');
});

test('pastor edits content and reviews; only admin changes navigation and publishes', () => {
    const pastor = { role: 'pastor' };
    const admin = { role: 'admin' };
    for (const p of ['content:edit', 'draft:review', 'audit:view']) {
        assert.ok(can(pastor, p), `pastor should have ${p}`);
        assert.ok(can(admin, p), `admin should have ${p}`);
    }
    for (const p of ['nav:edit', 'publish']) {
        assert.ok(!can(pastor, p), `pastor must not have ${p}`);
        assert.ok(can(admin, p), `admin should have ${p}`);
    }
    assert.ok(!can({ role: null }, 'content:edit'));
    assert.ok(!can(null, 'content:edit'));
});

test('production reads the Cloudflare Access email header', async () => {
    const id = await resolveIdentity(req({ 'cf-access-authenticated-user-email': PASTOR }), PROD_ENV);
    assert.deepEqual(id, { email: PASTOR, role: 'pastor', dev: false });
    assert.equal(await resolveIdentity(req(), PROD_ENV), null, 'no header, no identity');
});

test('production ignores the dev header and dev cookie', async () => {
    const id = await resolveIdentity(req({ 'x-dev-user-email': ADMIN, cookie: `sh_dev_user=${ADMIN}` }), PROD_ENV);
    assert.equal(id, null);
    assert.equal(isDevMode(PROD_ENV, req()), false);
});

test('the dev role switcher endpoint does not exist in production', async () => {
    const ctx = makeCtx();
    const res = await call(ctx, PROD_ENV, 'POST', 'dev-identity', { as: ADMIN, body: { email: ADMIN } });
    assert.equal(res.status, 404);
    assert.equal(res.response.headers.get('set-cookie'), null);
    const session = await call(ctx, PROD_ENV, 'GET', 'session', { as: ADMIN });
    assert.equal(session.json.devMode, false);
    assert.equal(session.json.devIdentities, undefined);
});

test('dev mode simulates identity and offers the switcher', async () => {
    const ctx = makeCtx();
    const session = await call(ctx, DEV_ENV, 'GET', 'session');
    assert.equal(session.json.role, 'admin', 'defaults to the first admin placeholder');
    assert.equal(session.json.devMode, true);
    assert.ok(session.json.devIdentities.some((d) => d.role === 'pastor'));

    const swap = await call(ctx, DEV_ENV, 'POST', 'dev-identity', { body: { email: PASTOR } });
    assert.equal(swap.status, 200);
    const cookie = swap.response.headers.get('set-cookie');
    assert.match(cookie, /^sh_dev_user=/);
    const asPastor = await call(ctx, DEV_ENV, 'GET', 'session', { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(asPastor.json.role, 'pastor');
});

test('a request that came through Access is never treated as dev mode, even with ADMIN_DEV=1', async () => {
    const headers = { 'cf-access-authenticated-user-email': PASTOR, 'x-dev-user-email': ADMIN };
    assert.equal(isDevMode(DEV_ENV, req(headers)), false);
    const id = await resolveIdentity(req(headers), DEV_ENV);
    assert.deepEqual(id, { email: PASTOR, role: 'pastor', dev: false });
    const ctx = makeCtx();
    const res = await call(ctx, DEV_ENV, 'POST', 'dev-identity', { headers, body: { email: ADMIN } });
    assert.equal(res.status, 404);
});

test('signed-out and unlisted users are refused', async () => {
    const ctx = makeCtx();
    assert.equal((await call(ctx, PROD_ENV, 'GET', 'content')).status, 401);
    assert.equal((await call(ctx, PROD_ENV, 'GET', 'content', { as: STRANGER })).status, 403);
    assert.equal((await call(ctx, PROD_ENV, 'GET', 'audit', { as: STRANGER })).status, 403);
    const save = await call(ctx, PROD_ENV, 'PUT', 'draft/events', { as: STRANGER, body: { data: await editedEvents(), baseRev: 0 } });
    assert.equal(save.status, 403);
    assert.equal((await ctx.kv.list({ prefix: '' })).keys.length, 0, 'nothing was stored');
});

test('pastor can save content drafts but cannot change navigation', async () => {
    const ctx = makeCtx();
    const ok = await call(ctx, PROD_ENV, 'PUT', 'draft/events', { as: PASTOR, body: { data: await editedEvents(), baseRev: 0 } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.status, 'draft');

    const nav = structuredClone((await repoContent()).navigation);
    nav.links[0].label = 'Our Story';
    const denied = await call(ctx, PROD_ENV, 'PUT', 'draft/navigation', { as: PASTOR, body: { data: nav, baseRev: 0 } });
    assert.equal(denied.status, 403);
    assert.equal(await ctx.kv.get('draft:navigation'), null);

    const allowed = await call(ctx, PROD_ENV, 'PUT', 'draft/navigation', { as: ADMIN, body: { data: nav, baseRev: 0 } });
    assert.equal(allowed.status, 200);

    const state = await call(ctx, PROD_ENV, 'GET', 'content', { as: PASTOR });
    assert.equal(state.json.sections.navigation.canEdit, false);
    assert.equal(state.json.sections.events.canEdit, true);
});

test('pastor cannot review or discard a navigation draft', async () => {
    const ctx = makeCtx();
    const nav = structuredClone((await repoContent()).navigation);
    nav.brand.text = 'Snow Hill';
    await call(ctx, PROD_ENV, 'PUT', 'draft/navigation', { as: ADMIN, body: { data: nav, baseRev: 0 } });
    assert.equal((await call(ctx, PROD_ENV, 'POST', 'draft/navigation/review', { as: PASTOR, body: { reviewed: true } })).status, 403);
    assert.equal((await call(ctx, PROD_ENV, 'DELETE', 'draft/navigation', { as: PASTOR })).status, 403);
    assert.ok(await ctx.kv.get('draft:navigation'));
});

test('changes are refused without the anti-forgery header', async () => {
    const ctx = makeCtx();
    const res = await call(ctx, PROD_ENV, 'PUT', 'draft/events', { as: ADMIN, csrf: false, body: { data: await editedEvents(), baseRev: 0 } });
    assert.equal(res.status, 403);
    assert.equal(await ctx.kv.get('draft:events'), null);
});

test('ADMIN_HOSTS limits which hostnames answer admin requests', async () => {
    const env = { ...PROD_ENV, ADMIN_HOSTS: 'admin.snowhillmbc.com' };
    assert.equal(hostAllowed(req({}, 'https://admin.snowhillmbc.com/admin/'), env), true);
    assert.equal(hostAllowed(req({}, 'https://snowhillmbc.com/admin/'), env), false);
    assert.equal(hostAllowed(req({}, 'https://snowhillmbc.com/admin/'), PROD_ENV), true, 'unset means no host limit');
    const res = await call(makeCtx(), env, 'GET', 'session', { as: ADMIN });
    assert.equal(res.status, 404, 'admin.test is not an allowed host');
});

// ── Optional Access token verification (keys generated locally, no network) ──

const b64url = (data) => Buffer.from(data).toString('base64url');

async function accessFixture() {
    const pair = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true, ['sign', 'verify']
    );
    const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
    const now = Date.UTC(2026, 10, 18, 15, 0, 0);
    const sign = async (claims) => {
        const head = b64url(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' }));
        const body = b64url(JSON.stringify({
            iss: 'https://snowhill.cloudflareaccess.example', aud: ['aud-123'], email: ADMIN,
            exp: Math.floor(now / 1000) + 600, iat: Math.floor(now / 1000), ...claims
        }));
        const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
        return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
    };
    const options = { teamDomain: 'snowhill.cloudflareaccess.example', aud: 'aud-123', fetchJwks: async () => [jwk], now: () => now };
    return { sign, options };
}

test('Access token: valid token accepted; wrong audience, expiry and tampering rejected', async () => {
    const { sign, options } = await accessFixture();
    const payload = await verifyAccessJwt(await sign({}), options);
    assert.equal(payload.email, ADMIN);

    await assert.rejects(verifyAccessJwt(await sign({ aud: ['someone-else'] }), options), /audience/);
    await assert.rejects(verifyAccessJwt(await sign({ exp: 1 }), options), /expired/);
    await assert.rejects(verifyAccessJwt(await sign({ iss: 'https://evil.example' }), options), /issuer/);
    const token = await sign({});
    const [h, , s] = token.split('.');
    const forged = `${h}.${b64url(JSON.stringify({ email: ADMIN, aud: ['aud-123'], exp: 9999999999, iss: 'https://snowhill.cloudflareaccess.example' }))}.${s}`;
    await assert.rejects(verifyAccessJwt(forged, options), /signature/);
});

test('when Access verification is configured, a bare email header is not enough', async () => {
    const { sign, options } = await accessFixture();
    const env = { ...PROD_ENV, ACCESS_TEAM_DOMAIN: options.teamDomain, ACCESS_AUD: options.aud };
    const deps = { fetchJwks: options.fetchJwks, now: options.now };

    const spoofed = await resolveIdentity(req({ 'cf-access-authenticated-user-email': ADMIN }), env, deps);
    assert.equal(spoofed, null);

    const good = await resolveIdentity(req({
        'cf-access-authenticated-user-email': ADMIN, 'cf-access-jwt-assertion': await sign({})
    }), env, deps);
    assert.deepEqual(good, { email: ADMIN, role: 'admin', dev: false });

    const mismatch = await resolveIdentity(req({
        'cf-access-authenticated-user-email': ADMIN, 'cf-access-jwt-assertion': await sign({ email: PASTOR })
    }), env, deps);
    assert.equal(mismatch, null, 'header email must match the signed token');

    const half = await resolveIdentity(req({ 'cf-access-authenticated-user-email': ADMIN }), { ...PROD_ENV, ACCESS_AUD: 'aud-123' }, deps);
    assert.equal(half, null, 'half-configured verification fails closed');
});
