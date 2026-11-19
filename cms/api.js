// HTTP layer for /api/admin/*. Thin: parse, call cms/workflow.js, serialise.
// Uses only web-standard Request/Response so it runs in Pages Functions and in Node tests.

import { DEV_COOKIE, PERMISSIONS, allowlist, hostAllowed, isDevMode, resolveIdentity, roleFor } from './auth.js';
import {
    HttpError, discardDraft, getBundle, getMedia, getState, listAudit, listPublishes,
    publishSection, saveDraft, setReviewed, uploadMedia
} from './workflow.js';

const MAX_JSON_BYTES = 256 * 1024;
const MAX_UPLOAD_REQUEST_BYTES = 6 * 1024 * 1024;
// Browsers will not send a custom header cross-site without a CORS preflight,
// which this API never approves, so requiring it blocks cross-site form posts.
const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'snowhill-admin';

const baseHeaders = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex'
};

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
    status,
    headers: { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8', ...extra }
});

async function readJson(request) {
    const type = (request.headers.get('content-type') || '').toLowerCase();
    if (!type.includes('application/json')) throw new HttpError(415, 'Expected JSON.');
    const raw = await request.text();
    if (raw.length > MAX_JSON_BYTES) throw new HttpError(413, 'That is too much content to save at once.');
    try {
        const body = JSON.parse(raw);
        if (!body || typeof body !== 'object') throw new Error('not an object');
        return body;
    } catch {
        throw new HttpError(400, 'Could not read the request.');
    }
}

/**
 * @param {Request} request
 * @param {object} env   Pages env (ADMIN_DEV, ADMIN_EMAILS, PASTOR_EMAILS, ...)
 * @param {object} ctx   workflow context, see cms/workflow.js
 * @param {string} path  path after /api/admin/, e.g. "draft/events"
 */
export async function handleAdminApi(request, env, ctx, path) {
    try {
        return await route(request, env, ctx, path);
    } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message, ...err.extra }, err.status);
        console.error('admin api error', err);
        return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
}

async function route(request, env, ctx, path) {
    const method = request.method.toUpperCase();
    const dev = isDevMode(env, request);
    const parts = path.split('/').filter(Boolean);

    if (!hostAllowed(request, env)) throw new HttpError(404, 'Not found.');
    if (method !== 'GET' && request.headers.get(CSRF_HEADER) !== CSRF_VALUE) {
        throw new HttpError(403, 'Request blocked.');
    }

    // Dev-only identity switcher. Does not exist in production mode.
    if (parts[0] === 'dev-identity') {
        if (!dev || method !== 'POST') throw new HttpError(404, 'Not found.');
        const { email } = await readJson(request);
        const address = String(email || '').trim().toLowerCase();
        if (!/^[^\s@;,]+@[^\s@;,]+$/.test(address)) throw new HttpError(400, 'Invalid email.');
        return json({ ok: true, email: address, role: roleFor(address, env) }, 200, {
            'Set-Cookie': `${DEV_COOKIE}=${encodeURIComponent(address)}; Path=/; SameSite=Lax; HttpOnly`
        });
    }

    const identity = await resolveIdentity(request, env, ctx);
    if (!identity) throw new HttpError(401, 'Please sign in.');

    if (parts[0] === 'session' && method === 'GET') {
        const body = {
            email: identity.email,
            role: identity.role,
            permissions: identity.role ? PERMISSIONS[identity.role] : [],
            devMode: dev,
            publishMode: ctx.publisher.mode
        };
        if (dev) {
            const lists = allowlist(env);
            body.devIdentities = [
                ...lists.admin.map((email) => ({ email, role: 'admin' })),
                ...lists.pastor.map((email) => ({ email, role: 'pastor' })),
                { email: 'visitor@snowhillmbc.example', role: null }
            ];
        }
        return json(body);
    }

    if (!identity.role) throw new HttpError(403, 'Your account is not on the admin list.');

    if (parts[0] === 'content' && method === 'GET') {
        return json({ sections: await getState(ctx, identity) });
    }

    if (parts[0] === 'draft' && parts[1]) {
        const section = parts[1];
        if (parts[2] === 'review' && method === 'POST') {
            const { reviewed } = await readJson(request);
            return json(await setReviewed(ctx, identity, section, reviewed === true));
        }
        if (!parts[2] && method === 'PUT') {
            const { data, baseRev } = await readJson(request);
            return json(await saveDraft(ctx, identity, section, data, baseRev));
        }
        if (!parts[2] && method === 'DELETE') {
            return json(await discardDraft(ctx, identity, section));
        }
    }

    if (parts[0] === 'publish' && parts[1] && method === 'POST') {
        return json(await publishSection(ctx, identity, parts[1]));
    }

    if (parts[0] === 'publishes' && method === 'GET') {
        if (!parts[1]) return json({ publishes: await listPublishes(ctx, identity) });
        if (parts[2] === 'bundle') {
            const bundle = await getBundle(ctx, identity, parts[1]);
            return json(bundle, 200, { 'Content-Disposition': `attachment; filename="${bundle.id}.json"` });
        }
    }

    if (parts[0] === 'audit' && method === 'GET') {
        const q = new URL(request.url).searchParams;
        return json(await listAudit(ctx, identity, {
            section: q.get('section') || '', limit: q.get('limit'), cursor: q.get('cursor')
        }));
    }

    if (parts[0] === 'media') {
        if (!parts[1] && method === 'POST') {
            if (Number(request.headers.get('content-length') || 0) > MAX_UPLOAD_REQUEST_BYTES) {
                throw new HttpError(413, 'That image is too large. Please use one under 5 MB.');
            }
            let form;
            try { form = await request.formData(); } catch { throw new HttpError(400, 'Could not read the upload.'); }
            const file = form.get('file');
            if (!file || typeof file === 'string') throw new HttpError(400, 'No image was received.');
            const saved = await uploadMedia(ctx, identity, {
                buffer: await file.arrayBuffer(),
                originalName: file.name,
                section: String(form.get('section') || ''),
                field: String(form.get('field') || '')
            });
            return json(saved, 201);
        }
        if (parts[1] && method === 'GET') {
            const media = await getMedia(ctx, identity, parts[1]);
            return new Response(media.buffer, {
                headers: {
                    'Content-Type': media.type,
                    'Cache-Control': 'private, max-age=3600',
                    'X-Content-Type-Options': 'nosniff',
                    'Content-Disposition': 'inline'
                }
            });
        }
    }

    throw new HttpError(404, 'Not found.');
}
