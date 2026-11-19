// Shared test fixtures. No network: every test runs with fetch() replaced by a tripwire.
import { readFile } from 'node:fs/promises';
import { handleAdminApi } from '../cms/api.js';
import { localPublisher } from '../cms/publisher.js';
import { SECTION_ORDER } from '../cms/schema.js';
import { MemoryKV } from '../cms/store.js';

const root = new URL('../', import.meta.url);

export const ADMIN = 'admin@snowhillmbc.example';
export const PASTOR = 'pastor@snowhillmbc.example';
export const STRANGER = 'stranger@snowhillmbc.example';

const ALLOW = { ADMIN_EMAILS: ADMIN, PASTOR_EMAILS: PASTOR };
export const PROD_ENV = { ...ALLOW };
export const DEV_ENV = { ...ALLOW, ADMIN_DEV: '1' };

export const admin = { email: ADMIN, role: 'admin' };
export const pastor = { email: PASTOR, role: 'pastor' };

export async function repoContent() {
    const content = {};
    for (const key of SECTION_ORDER) {
        content[key] = JSON.parse(await readFile(new URL(`content/${key}.json`, root), 'utf8'));
    }
    return content;
}

export const template = () => readFile(new URL('index.html', root), 'utf8');

/** Workflow context backed by an in-memory store and a clock that ticks 1s per call. */
export function makeCtx(overrides = {}) {
    let clock = Date.UTC(2026, 10, 18, 15, 0, 0);
    return {
        kv: new MemoryKV(),
        now: () => (clock += 1000),
        publisher: localPublisher(),
        loadRepoContent: repoContent,
        loadTemplate: template,
        ...overrides
    };
}

/** Replace global fetch with a tripwire; returns { calls, restore }. */
export function blockNetwork() {
    const original = globalThis.fetch;
    const tripwire = { calls: 0, restore: () => { globalThis.fetch = original; } };
    globalThis.fetch = async () => {
        tripwire.calls += 1;
        throw new Error('Network access is not allowed in tests');
    };
    return tripwire;
}

/** Call the admin API the way a browser would. `as` sets the Access (prod) or dev identity header. */
export async function call(ctx, env, method, path, { as, body, headers = {}, csrf = true } = {}) {
    const h = new Headers(headers);
    if (as) h.set(env.ADMIN_DEV === '1' ? 'x-dev-user-email' : 'cf-access-authenticated-user-email', as);
    if (csrf && method !== 'GET') h.set('x-requested-with', 'snowhill-admin');
    if (body !== undefined) h.set('content-type', 'application/json');
    const request = new Request(`https://admin.test/api/admin/${path}`, {
        method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const response = await handleAdminApi(request, env, ctx, path.split('?')[0]);
    const type = response.headers.get('content-type') || '';
    return { status: response.status, response, json: type.includes('json') ? await response.json() : null };
}

/** A copy of the repo's events content with one field changed. */
export async function editedEvents(change = (d) => { d.items[0].time = '10:45 AM'; }) {
    const data = structuredClone((await repoContent()).events);
    change(data);
    return data;
}
