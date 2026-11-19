// Draft -> Reviewed -> Published workflow, with an audit entry for every change.
//
// Every function takes a context:
//   ctx.kv               KV-style store (ADMIN_KV binding, or MemoryKV in tests)
//   ctx.loadRepoContent  async () => { home, services, ... } from content/*.json
//   ctx.loadTemplate     async () => index.html text
//   ctx.publisher        { mode, publish(bundle) }  see cms/publisher.js
//   ctx.now              () => epoch milliseconds
// and the caller's identity ({ email, role }) where a permission applies.

import { can } from './auth.js';
import { keys, randomId } from './store.js';
import { renderSite } from './render.js';
import {
    SECTIONS, SECTION_ORDER, UPLOAD_PREFIX, diffSection, imagePaths, isSection, sanitizeSection
} from './schema.js';

export class HttpError extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.status = status;
        this.extra = extra;
    }
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function requireSection(section) {
    if (!isSection(section)) throw new HttpError(404, 'Unknown section.');
    return SECTIONS[section];
}

function requirePermission(identity, permission, message) {
    if (!can(identity, permission)) {
        throw new HttpError(403, message || 'Your role does not allow this action.');
    }
}

const sameData = (a, b) => diffSection(a, b).length === 0;

// ── Audit log ───────────────────────────────────────────────────────────────

/**
 * Append audit entries. One entry per changed field for edits; one entry for
 * workflow actions (review, publish, discard, upload).
 */
export async function writeAudit(ctx, identity, entries) {
    const ms = ctx.now();
    const written = [];
    for (let i = 0; i < entries.length; i++) {
        const entry = {
            id: randomId(),
            at: new Date(ms).toISOString(),
            who: identity.email,
            role: identity.role,
            action: entries[i].action,
            section: entries[i].section,
            field: entries[i].field,
            old: entries[i].old ?? '',
            new: entries[i].new ?? ''
        };
        // +i keeps entries from a single save in a stable order.
        await ctx.kv.put(keys.audit(ms, `${String(1000 - i).padStart(4, '0')}${entry.id}`), JSON.stringify(entry));
        written.push(entry);
    }
    return written;
}

export async function listAudit(ctx, identity, { section, limit = 50, cursor } = {}) {
    requirePermission(identity, 'audit:view');
    const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const page = await ctx.kv.list({ prefix: 'audit:', limit: size, cursor: cursor || undefined });
    const entries = (await Promise.all(page.keys.map((k) => ctx.kv.get(k.name, 'json')))).filter(Boolean);
    return {
        entries: section ? entries.filter((e) => e.section === section) : entries,
        cursor: page.list_complete ? null : page.cursor
    };
}

// ── Reading state ───────────────────────────────────────────────────────────

/** The published version of a section: the local published store, else the repo file. */
async function baseline(ctx, section, repo) {
    const record = await ctx.kv.get(keys.published(section), 'json');
    if (record) return record.data;
    return (repo || await ctx.loadRepoContent())[section];
}

function statusOf(draft) {
    if (!draft) return 'published';
    return draft.reviewed && draft.reviewed.rev === draft.rev ? 'reviewed' : 'draft';
}

export async function getState(ctx, identity) {
    if (!identity?.role) throw new HttpError(403, 'Your account is not on the admin list.');
    const repo = await ctx.loadRepoContent();
    const sections = {};
    for (const key of SECTION_ORDER) {
        const draft = await ctx.kv.get(keys.draft(key), 'json');
        sections[key] = {
            published: await baseline(ctx, key, repo),
            draft,
            status: statusOf(draft),
            canEdit: can(identity, SECTIONS[key].permission)
        };
    }
    return sections;
}

/** Full site content for a preview: 'draft' layers drafts over what is published. */
export async function contentFor(ctx, mode) {
    const repo = await ctx.loadRepoContent();
    const content = {};
    for (const key of SECTION_ORDER) {
        const draft = mode === 'draft' ? await ctx.kv.get(keys.draft(key), 'json') : null;
        content[key] = draft ? draft.data : await baseline(ctx, key, repo);
    }
    return content;
}

// ── Drafts ──────────────────────────────────────────────────────────────────

export async function saveDraft(ctx, identity, section, input, baseRev) {
    const def = requireSection(section);
    requirePermission(identity, def.permission,
        def.permission === 'nav:edit' ? 'Only an administrator can change navigation.' : undefined);

    const { data, errors } = sanitizeSection(section, input);
    if (errors.length) throw new HttpError(422, 'Please fix the highlighted fields.', { errors });

    const existing = await ctx.kv.get(keys.draft(section), 'json');
    const currentRev = existing ? existing.rev : 0;
    if (Number(baseRev || 0) !== currentRev) {
        throw new HttpError(409, 'Someone else changed this section since you opened it. Reload to see their changes.');
    }

    const published = await baseline(ctx, section);
    const before = existing ? existing.data : published;
    const changes = diffSection(before, data);
    if (changes.length === 0) {
        return { draft: existing, status: statusOf(existing), changes: [] };
    }

    await writeAudit(ctx, identity, changes.map((c) => ({ action: 'edit', section, ...c })));

    // Editing back to exactly what is published leaves nothing to publish.
    if (sameData(published, data)) {
        await ctx.kv.delete(keys.draft(section));
        return { draft: null, status: 'published', changes };
    }

    const draft = {
        data,
        rev: currentRev + 1,
        updatedBy: identity.email,
        updatedAt: new Date(ctx.now()).toISOString(),
        reviewed: null // any edit sends the draft back for review
    };
    await ctx.kv.put(keys.draft(section), JSON.stringify(draft));
    return { draft, status: 'draft', changes };
}

export async function setReviewed(ctx, identity, section, reviewed) {
    const def = requireSection(section);
    requirePermission(identity, 'draft:review');
    requirePermission(identity, def.permission);

    const draft = await ctx.kv.get(keys.draft(section), 'json');
    if (!draft) throw new HttpError(409, 'There is no saved draft to review. Save a draft first.');

    const was = statusOf(draft);
    draft.reviewed = reviewed
        ? { by: identity.email, at: new Date(ctx.now()).toISOString(), rev: draft.rev }
        : null;
    const is = statusOf(draft);
    await ctx.kv.put(keys.draft(section), JSON.stringify(draft));
    if (was !== is) {
        await writeAudit(ctx, identity, [{
            action: reviewed ? 'review' : 'unreview', section, field: '(status)', old: was, new: is
        }]);
    }
    return { draft, status: is };
}

export async function discardDraft(ctx, identity, section) {
    const def = requireSection(section);
    requirePermission(identity, def.permission);
    const draft = await ctx.kv.get(keys.draft(section), 'json');
    if (!draft) return { draft: null, status: 'published' };
    await ctx.kv.delete(keys.draft(section));
    await writeAudit(ctx, identity, [{
        action: 'discard', section, field: '(status)', old: statusOf(draft), new: 'published'
    }]);
    return { draft: null, status: 'published' };
}

// ── Publish ─────────────────────────────────────────────────────────────────

/**
 * Publish gate: administrators only, and only a draft whose current revision
 * has been marked Reviewed.
 */
export async function publishSection(ctx, identity, section) {
    const def = requireSection(section);
    requirePermission(identity, 'publish', 'Only an administrator can publish.');

    const draft = await ctx.kv.get(keys.draft(section), 'json');
    if (!draft) throw new HttpError(409, 'There is no draft to publish.');
    if (statusOf(draft) !== 'reviewed') {
        throw new HttpError(409, 'This draft must be marked Reviewed before it can be published.');
    }

    const ms = ctx.now();
    const repo = await ctx.loadRepoContent();
    const content = {};
    for (const key of SECTION_ORDER) content[key] = await baseline(ctx, key, repo);
    const changes = diffSection(content[section], draft.data);
    content[section] = draft.data;

    const id = `pub-${new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15)}-${randomId(3)}`;
    const bundle = {
        id,
        section,
        createdAt: new Date(ms).toISOString(),
        createdBy: identity.email,
        reviewedBy: draft.reviewed.by,
        branch: `content/${id}`,
        message: `content(${section}): ${def.label} update from site admin (${changes.length} field${changes.length === 1 ? '' : 's'})`,
        changes,
        files: [
            { path: `content/${section}.json`, encoding: 'utf8', content: JSON.stringify(draft.data, null, 2) + '\n' },
            { path: 'index.html', encoding: 'utf8', content: renderSite(await ctx.loadTemplate(), content) }
        ],
        // Uploaded images this content points at; bytes are attached on download.
        media: [...new Set(imagePaths(section, draft.data).filter((p) => p.startsWith(UPLOAD_PREFIX)))]
    };

    const delivery = await ctx.publisher.publish(bundle);
    const record = { ...bundle, delivery };

    await ctx.kv.put(keys.publish(ms, id), JSON.stringify(record));
    await ctx.kv.put(keys.published(section), JSON.stringify({
        data: draft.data, publishId: id, publishedAt: bundle.createdAt, publishedBy: identity.email
    }));
    await ctx.kv.delete(keys.draft(section));
    await writeAudit(ctx, identity, [{
        action: 'publish', section, field: '(status)', old: 'reviewed', new: `published (${id})`
    }]);

    return { publish: summarize(record), status: 'published' };
}

const summarize = (r) => ({
    id: r.id, section: r.section, createdAt: r.createdAt, createdBy: r.createdBy,
    reviewedBy: r.reviewedBy, message: r.message, branch: r.branch,
    changeCount: r.changes.length, delivery: r.delivery
});

export async function listPublishes(ctx, identity) {
    requirePermission(identity, 'audit:view');
    const page = await ctx.kv.list({ prefix: 'publish:', limit: 25 });
    const records = (await Promise.all(page.keys.map((k) => ctx.kv.get(k.name, 'json')))).filter(Boolean);
    return records.map(summarize);
}

/** The full bundle for one publish, with uploaded image bytes attached (base64). */
export async function getBundle(ctx, identity, id) {
    requirePermission(identity, 'publish', 'Only an administrator can download publish bundles.');
    const page = await ctx.kv.list({ prefix: 'publish:', limit: 200 });
    const hit = page.keys.find((k) => k.name.endsWith(`:${id}`));
    const record = hit ? await ctx.kv.get(hit.name, 'json') : null;
    if (!record) throw new HttpError(404, 'Publish not found.');

    const files = [...record.files];
    for (const path of record.media) {
        const bytes = await ctx.kv.get(keys.media(path.slice(UPLOAD_PREFIX.length)), 'arrayBuffer');
        if (bytes) files.push({ path, encoding: 'base64', content: toBase64(bytes) });
    }
    const { media, delivery, ...rest } = record;
    return { ...rest, files };
}

function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
}

// ── Image uploads ───────────────────────────────────────────────────────────

/** Identify an image by its leading bytes; the browser-supplied type is not trusted. */
export function sniffImage(bytes) {
    const b = bytes;
    if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { ext: 'jpg', type: 'image/jpeg' };
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return { ext: 'png', type: 'image/png' };
    if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { ext: 'gif', type: 'image/gif' };
    if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
        && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ext: 'webp', type: 'image/webp' };
    return null;
}

export async function uploadMedia(ctx, identity, { buffer, originalName, section, field }) {
    requirePermission(identity, 'content:edit');
    if (!buffer || buffer.byteLength === 0) throw new HttpError(400, 'No image was received.');
    if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, 'That image is too large. Please use one under 5 MB.');
    const kind = sniffImage(new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength)));
    if (!kind) throw new HttpError(415, 'Please choose a JPG, PNG, WebP, or GIF image.');

    const ms = ctx.now();
    const name = `${new Date(ms).toISOString().slice(0, 10).replace(/-/g, '')}-${randomId(4)}.${kind.ext}`;
    await ctx.kv.put(keys.media(name), buffer, {
        metadata: { type: kind.type, size: buffer.byteLength, uploadedBy: identity.email, uploadedAt: new Date(ms).toISOString() }
    });
    const path = UPLOAD_PREFIX + name;
    await writeAudit(ctx, identity, [{
        action: 'upload',
        section: isSection(section) ? section : 'media',
        field: String(field || '(image)').slice(0, 80),
        old: '',
        new: `${path} (${String(originalName || 'image').slice(0, 80)}, ${Math.ceil(buffer.byteLength / 1024)} KB)`
    }]);
    return { path, name, type: kind.type, size: buffer.byteLength };
}

export async function getMedia(ctx, identity, name) {
    if (!identity?.role) throw new HttpError(403, 'Not allowed.');
    if (!/^[A-Za-z0-9_-]+\.(?:jpg|png|gif|webp)$/.test(name)) throw new HttpError(404, 'Not found.');
    const { value, metadata } = await ctx.kv.getWithMetadata(keys.media(name), 'arrayBuffer');
    if (!value) throw new HttpError(404, 'Not found.');
    return { buffer: value, type: metadata?.type || 'application/octet-stream' };
}
