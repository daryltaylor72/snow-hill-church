// Runs only for the paths listed in /_routes.json.
//   /            render index.html from content/*.json (and draft previews)
//   /admin/*     keep the admin pages private in production
// Everything else passes straight through.

import { hostAllowed, isDevMode, resolveIdentity } from '../cms/auth.js';
import { renderSite } from '../cms/render.js';
import { contentFor } from '../cms/workflow.js';
import { buildContext, repoContent } from '../cms/context.js';
import { badRequest, isAdminPath, normalizePath, isBlockedPath, isProductionHost, notFound, previewEnv, previewGate, withNoindex } from '../cms/preview.js';

const page = (status, title, message) => new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${title}</title><body style="font-family:Georgia,serif;background:#F0F2FF;color:#1C2030;padding:3rem 1.5rem;text-align:center">`
    + `<h1 style="font-size:1.5rem">${title}</h1><p style="margin-top:1rem">${message}</p></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } }
);

export async function onRequest(original) {
    const { request, next } = original;
    const url = new URL(request.url);

    // Decisions use a normalized path (decoded, slash-collapsed, dot-resolved, lowercase).
    // A path that cannot be normalized is refused.
    if (normalizePath(url.pathname) === null) return badRequest();

    const production = isProductionHost(request);
    if (!production) {
        // Expiry and password come before anything else on a preview host,
        // so unauthenticated callers learn nothing (not even which paths exist).
        const early = await previewGate(request);
        if (early) return early;
    }

    // Repo docs and source are never served, on any host.
    if (isBlockedPath(url.pathname)) return withNoindex(notFound());

    if (production) {
        // Production: the admin does not exist yet. Everything else is untouched.
        if (isAdminPath(url.pathname)) return notFound();
        return handle(original, original.env);
    }

    const response = await handle({ ...original, env: previewEnv(original.env) }, previewEnv(original.env));
    return withNoindex(response);
}

async function handle(context, env) {
    const { request, next } = context;
    const url = new URL(request.url);
    const path = url.pathname;
    const clean = normalizePath(path);

    if (clean === '/admin' || clean.startsWith('/admin/')) {
        if (!hostAllowed(request, env)) return page(404, 'Page not found', 'This page does not exist.');
        if (!isDevMode(env, request)) {
            const identity = await resolveIdentity(request, env);
            if (!identity) return page(401, 'Sign in required', 'Please sign in through the church admin address.');
            if (!identity.role) return page(403, 'No access', 'Your account is not on the admin list. Please contact the church administrator.');
        }
        return next();
    }

    if (path === '/' && request.method === 'GET') {
        const mode = url.searchParams.get('preview');
        if (mode === 'draft' || mode === 'published') {
            return renderPreview(context, mode);
        }
        try {
            const asset = await next();
            const type = asset.headers.get('content-type') || '';
            if (asset.status !== 200 || !type.includes('text/html')) return asset;
            const html = renderSite(await asset.text(), repoContent);
            const headers = new Headers(asset.headers);
            headers.delete('content-length');
            return new Response(html, { status: 200, headers });
        } catch (err) {
            // Never let the renderer take the homepage down: serve the baked copy.
            console.error('render failed, serving static index.html', err);
            return env.ASSETS.fetch(request);
        }
    }

    return next();
}

async function renderPreview(context, mode) {
    const { request, env } = context;
    if (!hostAllowed(request, env)) return page(404, 'Page not found', 'This page does not exist.');
    const identity = await resolveIdentity(request, env);
    if (!identity || !identity.role) {
        return page(403, 'No access', 'Previews are only available to signed-in site editors.');
    }
    if (!env.ADMIN_KV) return page(503, 'Preview unavailable', 'Admin storage is not configured.');

    const ctx = buildContext(context);
    const html = renderSite(await ctx.loadTemplate(), await contentFor(ctx, mode), {
        mediaBase: 'api/admin/media/',
        badge: mode === 'draft' ? 'Draft preview' : 'Published preview'
    });
    const asset = await env.ASSETS.fetch(new URL('/', request.url));
    const headers = new Headers(asset.headers);
    for (const h of ['content-length', 'etag', 'last-modified']) headers.delete(h);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    return new Response(html, { status: 200, headers });
}
