// Builds the workflow context for Pages Functions (see cms/workflow.js).
// Only the Functions import this file; tests build their own context.
import home from '../content/home.json' with { type: 'json' };
import services from '../content/services.json' with { type: 'json' };
import events from '../content/events.json' with { type: 'json' };
import staff from '../content/staff.json' with { type: 'json' };
import media from '../content/media.json' with { type: 'json' };
import navigation from '../content/navigation.json' with { type: 'json' };
import { selectPublisher } from './publisher.js';

// content/*.json is bundled with the Functions at deploy time, so the site and
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
