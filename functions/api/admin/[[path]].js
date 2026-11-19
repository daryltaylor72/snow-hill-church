import { handleAdminApi } from '../../../cms/api.js';
import { buildContext } from '../../../cms/context.js';
import { isProductionHost, notFound, previewEnv, previewGate, withNoindex } from '../../../cms/preview.js';

export async function onRequest(original) {
    const { request } = original;
    if (isProductionHost(request)) return notFound();
    const blocked = await previewGate(request);
    if (blocked) return blocked;
    const env = previewEnv(original.env);
    const response = await run({ ...original, env });
    return withNoindex(response);
}

async function run(context) {
    const { request, env, params } = context;
    if (!env.ADMIN_KV) {
        return new Response(JSON.stringify({ error: 'Admin storage is not configured (ADMIN_KV binding missing).' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
    }
    const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
    return handleAdminApi(request, env, buildContext(context), path);
}
