// Storage keys and a tiny in-memory stand-in for Workers KV.
// The real store is the ADMIN_KV binding (wrangler keeps it on disk locally,
// under .wrangler/state). MemoryKV implements the same calls for tests.

const MAX_TS = 9999999999999;

export const keys = {
    draft: (section) => `draft:${section}`,
    published: (section) => `published:${section}`,
    media: (name) => `media:${name}`,
    // Newest-first ordering: KV lists keys alphabetically, so store an inverted timestamp.
    audit: (ms, id) => `audit:${String(MAX_TS - ms).padStart(13, '0')}:${id}`,
    publish: (ms, id) => `publish:${String(MAX_TS - ms).padStart(13, '0')}:${id}`
};

export function randomId(bytes = 6) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class MemoryKV {
    constructor() {
        this.map = new Map();
    }

    async get(key, type = 'text') {
        const entry = this.map.get(key);
        if (!entry) return null;
        if (type === 'arrayBuffer') return entry.value.slice(0);
        if (type === 'json') return JSON.parse(entry.value);
        return entry.value;
    }

    async getWithMetadata(key, type = 'text') {
        const entry = this.map.get(key);
        return { value: await this.get(key, type), metadata: entry ? entry.metadata : null };
    }

    async put(key, value, options = {}) {
        const stored = typeof value === 'string' ? value : value.slice(0);
        this.map.set(key, { value: stored, metadata: options.metadata ?? null });
    }

    async delete(key) {
        this.map.delete(key);
    }

    async list({ prefix = '', limit = 1000, cursor } = {}) {
        const all = [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
        const start = cursor ? Number(cursor) : 0;
        const page = all.slice(start, start + limit);
        const end = start + page.length;
        const done = end >= all.length;
        return {
            keys: page.map((name) => ({ name, metadata: this.map.get(name).metadata })),
            list_complete: done,
            cursor: done ? undefined : String(end)
        };
    }
}
