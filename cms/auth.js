// Who is making this request, and what may they do?
//
// Production: the admin lives behind Cloudflare Access. Access adds
//   Cf-Access-Authenticated-User-Email (the signed-in user) and
//   Cf-Access-Jwt-Assertion (a signed token proving it).
// Local preview (dev mode): identity is simulated with a cookie or header so the
// on-page role switcher works. Dev mode can never be active on a deployed site.

export const PERMISSIONS = {
    pastor: ['content:edit', 'draft:review', 'audit:view'],
    admin: ['content:edit', 'draft:review', 'audit:view', 'nav:edit', 'publish']
};

export const DEV_COOKIE = 'sh_dev_user';
export const DEV_HEADER = 'x-dev-user-email';
const ACCESS_EMAIL_HEADER = 'cf-access-authenticated-user-email';
const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';

// Placeholder addresses used only when dev mode has no allowlist configured.
const DEV_DEFAULTS = {
    ADMIN_EMAILS: 'admin@snowhillmbc.example',
    PASTOR_EMAILS: 'pastor@snowhillmbc.example'
};

/** The explicit local-preview flag. Set only in .dev.vars, never in the dashboard. */
const devFlag = (env) => env?.ADMIN_DEV === '1';

/**
 * Dev mode (simulated identity + role switcher) applies to a request only when
 *   1. ADMIN_DEV=1 is set (it lives in .dev.vars, which Cloudflare never deploys), and
 *   2. the request did NOT come through Cloudflare Access.
 * Rule 2 is a second lock: if the flag were ever set on the live project by
 * mistake, requests arriving through Access still use the real signed-in user
 * and the dev switcher stays off. Pair with ADMIN_HOSTS (see hostAllowed).
 */
export function isDevMode(env, request) {
    if (!devFlag(env)) return false;
    if (request && (request.headers.has(ACCESS_EMAIL_HEADER) || request.headers.has(ACCESS_JWT_HEADER))) return false;
    return true;
}

const parseList = (value) => String(value || '')
    .split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Email allowlist: { admin: [...], pastor: [...] } from env configuration. */
export function allowlist(env) {
    const dev = devFlag(env);
    const read = (name) => {
        const list = parseList(env?.[name]);
        return list.length || !dev ? list : parseList(DEV_DEFAULTS[name]);
    };
    return { admin: read('ADMIN_EMAILS'), pastor: read('PASTOR_EMAILS') };
}

export function roleFor(email, env) {
    const address = String(email || '').trim().toLowerCase();
    if (!address) return null;
    const lists = allowlist(env);
    if (lists.admin.includes(address)) return 'admin';
    if (lists.pastor.includes(address)) return 'pastor';
    return null;
}

export function can(identity, permission) {
    return Boolean(identity?.role) && PERMISSIONS[identity.role].includes(permission);
}

function readCookie(request, name) {
    const header = request.headers.get('cookie') || '';
    for (const part of header.split(';')) {
        const [k, ...rest] = part.trim().split('=');
        if (k === name) {
            try { return decodeURIComponent(rest.join('=')); } catch { return ''; }
        }
    }
    return '';
}

/**
 * Optionally limit the admin to named hosts (ADMIN_HOSTS), so the admin pages
 * and API do not answer on the public site hostnames at all. Enforced in every
 * mode whenever it is set; the local preview simply leaves it unset.
 */
export function hostAllowed(request, env) {
    const hosts = parseList(env?.ADMIN_HOSTS);
    if (hosts.length === 0) return true;
    return hosts.includes(new URL(request.url).hostname.toLowerCase());
}

// ── Cloudflare Access token check ───────────────────────────────────────────

const b64urlBytes = (s) => {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

let jwksCache = { url: '', keys: null, at: 0 };

async function defaultFetchJwks(url) {
    if (jwksCache.url === url && jwksCache.keys && Date.now() - jwksCache.at < 10 * 60 * 1000) {
        return jwksCache.keys;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not load Access signing keys');
    const { keys } = await res.json();
    jwksCache = { url, keys, at: Date.now() };
    return keys;
}

/**
 * Verify a Cloudflare Access JWT (RS256). Returns the payload or throws.
 * @param {string} token
 * @param {{ teamDomain: string, aud: string, fetchJwks?: Function, now?: () => number }} options
 */
export async function verifyAccessJwt(token, { teamDomain, aud, fetchJwks = defaultFetchJwks, now = Date.now }) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('Malformed Access token');
    const header = b64urlJson(parts[0]);
    const payload = b64urlJson(parts[1]);
    if (header.alg !== 'RS256') throw new Error('Unexpected Access token algorithm');

    const issuer = `https://${teamDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
    const keys = await fetchJwks(`${issuer}/cdn-cgi/access/certs`);
    const jwk = (keys || []).find((k) => k.kid === header.kid);
    if (!jwk) throw new Error('Unknown Access signing key');

    const key = await crypto.subtle.importKey(
        'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]),
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!valid) throw new Error('Bad Access token signature');

    const seconds = Math.floor(now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= seconds) throw new Error('Access token expired');
    if (typeof payload.nbf === 'number' && payload.nbf > seconds + 60) throw new Error('Access token not yet valid');
    if (payload.iss !== issuer) throw new Error('Access token issuer mismatch');
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(aud)) throw new Error('Access token audience mismatch');
    return payload;
}

/**
 * Resolve the caller.
 * @returns {Promise<{ email: string, role: 'admin'|'pastor'|null, dev: boolean } | null>}
 *          null when no identity is presented at all.
 */
export async function resolveIdentity(request, env, deps = {}) {
    if (isDevMode(env, request)) {
        const lists = allowlist(env);
        const email = (request.headers.get(DEV_HEADER) || readCookie(request, DEV_COOKIE) || lists.admin[0] || '')
            .trim().toLowerCase();
        if (!email) return null;
        return { email, role: roleFor(email, env), dev: true };
    }

    // Production: dev header and cookie are ignored entirely.
    const email = (request.headers.get(ACCESS_EMAIL_HEADER) || '').trim().toLowerCase();
    if (!email) return null;

    const teamDomain = env?.ACCESS_TEAM_DOMAIN;
    const aud = env?.ACCESS_AUD;
    if (teamDomain || aud) {
        if (!teamDomain || !aud) return null; // half-configured: fail closed
        try {
            const payload = await verifyAccessJwt(request.headers.get(ACCESS_JWT_HEADER), {
                teamDomain, aud, fetchJwks: deps.fetchJwks, now: deps.now
            });
            if (String(payload.email || '').toLowerCase() !== email) return null;
        } catch {
            return null;
        }
    }
    return { email, role: roleFor(email, env), dev: false };
}
