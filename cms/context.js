// Builds the workflow context for Pages Functions (see cms/workflow.js).
// Only the Functions import this file; tests build their own context.
import { home, services, events, staff, media, navigation } from './content-data.js';
import { selectPublisher } from './publisher.js';

// content/*.json is bundled (via the generated ./content-data.js, see scripts/gen-content-data.mjs) with the Functions at deploy time, so the site and
// the admin always read the same files that are in the repository.
export const repoContent = { home, services, events, staff, media, navigation };

export function buildContext(context) {
    const { env, request } = context;
    return {
        kv: env.ADMIN_KV,
        now: () => Date.now(),
        publisher: selectPublisher(env),
        loadRepoContent: async () => repoContent,
        loadTemplate: async () => {
            const res = await env.ASSETS.fetch(new URL('/', request.url));
            if (!res.ok) throw new Error('Could not load index.html');
            return res.text();
        }
    };
}
