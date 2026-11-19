// Temporary password-gated preview support. Remove before anything merges to main.
//
// Production hosts (snowhillmbc.com, www): nothing here changes the public site,
// and the admin pages and admin API answer 404.
// Every other host (*.pages.dev previews, custom hosts): HTTP Basic Auth on the
// gated paths, noindex, simulated sign-in with the role switcher, in-memory
// storage when no KV is bound, and a hard 410 after the expiry below.

import { MemoryKV } from './store.js';

export const PRODUCTION_HOSTS = ['snowhillmbc.com', 'www.snowhillmbc.com'];
// 2026-11-20 7:30 PM America/New_York (EST, UTC-5) = 2026-11-21 00:30 UTC.
export const PREVIEW_EXPIRES_AT = Date.UTC(2026, 10, 21, 0, 30, 0);
// SHA-256 of the preview password. The password itself is never stored in the repo.
export const PREVIEW_USER = 'daryl';
export const PASSWORD_SHA256 = '31a84164a22487fb62d24c34bd67298684b4dbaf77f26c4f97f13a91a181e47a';

// Repo files that must never be served on any host.
const BLOCKED = [
    /^\/(ADMIN|README|CLAUDE|BRIEF-admin-preview)\.md$/i,
    /^\/\.dev\.vars(\.example)?$/i,
    /^\/(package\.json|wrangler\.toml)$/i,
    /^\/(tests|scripts|cms|content|snapshots)(\/|$)/i
];

export const isProductionHost = (request) =>
    PRODUCTION_HOSTS.includes(new URL(request.url).hostname.toLowerCase());

/**
 * Canonical form of a request path for access decisions: percent-decoding is
 * repeated until stable, backslashes become slashes, repeated slashes collapse,
 * dot segments resolve, and the result is lowercased. Returns null (callers fail
 * closed) when the path cannot be decoded or contains a NUL.
 */
export function normalizePath(raw) {
    let path = String(raw ?? '');
    for (let i = 0; i < 10; i++) {
        let next;
        try { next = decodeURIComponent(path); } catch { return null; }
        if (next === path) break;
        path = next;
        if (i === 9) return null; // still changing: refuse
    }
    if (path.includes('\0')) return null;
    const out = [];
    for (const seg of path.replace(/\\/g, '/').split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') { out.pop(); continue; }
        out.push(seg);
    }
    return ('/' + out.join('/')).toLowerCase();
}

export const isBlockedPath = (pathname) => {
    const path = normalizePath(pathname);
    return path === null || BLOCKED.some((re) => re.test(path));
};

export const isAdminPath = (pathname) => {
    const path = normalizePath(pathname);
    return path === null || path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin');
};

const sharedKV = new MemoryKV();

const plain = (status, body, headers = {}) => new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', ...headers }
});

async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export async function passwordOk(request) {
    const header = request.headers.get('authorization') || '';
    const match = /^Basic\s+(.+)$/i.exec(header);
    if (!match) return false;
    let decoded;
    try { decoded = new TextDecoder().decode(Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0))); } catch { return false; }
    const colon = decoded.indexOf(':');
    if (colon < 0) return false;
    // Compare digests of both parts, without short-circuiting between them.
    const userOk = constantTimeEqual(await sha256Hex(decoded.slice(0, colon)), await sha256Hex(PREVIEW_USER));
    const passOk = constantTimeEqual(await sha256Hex(decoded.slice(colon + 1)), PASSWORD_SHA256);
    return userOk && passOk;
}

/**
 * Gate for non-production hosts. Returns a Response to send (expired or
 * challenge), or null when the caller may continue.
 */
export async function previewGate(request, now = Date.now()) {
    if (now >= PREVIEW_EXPIRES_AT) return plain(410, 'This preview has expired.');
    if (!(await passwordOk(request))) {
        return plain(401, 'Password required.', { 'WWW-Authenticate': 'Basic realm="Snow Hill preview", charset="UTF-8"' });
    }
    return null;
}

/** Environment for a gated preview host: dev role switcher on, local publishing, memory storage if no KV. */
export function previewEnv(env = {}) {
    return { ...env, ADMIN_DEV: '1', ADMIN_HOSTS: '', PUBLISH_MODE: 'local', ADMIN_KV: env.ADMIN_KV || sharedKV };
}

export const notFound = () => plain(404, 'Not found');
export const badRequest = () => plain(400, 'Bad request');
export const withNoindex = (response) => {
    const headers = new Headers(response.headers);
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    headers.set('Cache-Control', 'private, no-store');
    for (const h of ['etag', 'last-modified', 'expires']) headers.delete(h);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
