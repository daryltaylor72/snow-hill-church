import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { githubPublisherStub, selectPublisher } from '../cms/publisher.js';
import { getBundle, publishSection, saveDraft, setReviewed, uploadMedia } from '../cms/workflow.js';
import { applyBundle, checkBundle } from '../scripts/apply-publish.mjs';
import {
    ADMIN, PASTOR, PROD_ENV, admin, blockNetwork, call, editedEvents, makeCtx, pastor, repoContent
} from './helpers.mjs';

let net;
before(() => { net = blockNetwork(); });
after(() => { assert.equal(net.calls, 0, 'tests must not touch the network'); net.restore(); });

const save = async (ctx, as, data, baseRev = 0) =>
    call(ctx, PROD_ENV, 'PUT', 'draft/events', { as, body: { data, baseRev } });
const review = (ctx, as, reviewed = true) =>
    call(ctx, PROD_ENV, 'POST', 'draft/events/review', { as, body: { reviewed } });
const publish = (ctx, as) => call(ctx, PROD_ENV, 'POST', 'publish/events', { as, body: {} });
const status = async (ctx) => (await call(ctx, PROD_ENV, 'GET', 'content', { as: ADMIN })).json.sections.events.status;

test('gate: nothing to publish when there is no draft', async () => {
    const ctx = makeCtx();
    const res = await publish(ctx, ADMIN);
    assert.equal(res.status, 409);
    assert.match(res.json.error, /no draft/i);
});

test('gate: a saved draft cannot be published until it is marked Reviewed', async () => {
    const ctx = makeCtx();
    assert.equal((await save(ctx, PASTOR, await editedEvents())).status, 200);
    assert.equal(await status(ctx), 'draft');

    const blocked = await publish(ctx, ADMIN);
    assert.equal(blocked.status, 409);
    assert.match(blocked.json.error, /reviewed/i);
    assert.equal(await ctx.kv.get('published:events'), null);
    assert.ok(await ctx.kv.get('draft:events'), 'draft is untouched');
});

test('gate: publishing is admin-only, even for a reviewed draft', async () => {
    const ctx = makeCtx();
    await save(ctx, PASTOR, await editedEvents());
    assert.equal((await review(ctx, PASTOR)).json.status, 'reviewed');

    const denied = await publish(ctx, PASTOR);
    assert.equal(denied.status, 403);
    assert.match(denied.json.error, /administrator/i);
    assert.equal(await ctx.kv.get('published:events'), null);
    assert.equal(await status(ctx), 'reviewed');
});

test('draft -> reviewed -> published: the full path', async () => {
    const ctx = makeCtx();
    const data = await editedEvents();
    await save(ctx, PASTOR, data);
    await review(ctx, PASTOR);

    const res = await publish(ctx, ADMIN);
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'published');
    assert.equal(res.json.publish.delivery.mode, 'local');
    assert.equal(res.json.publish.changeCount, 1);
    assert.equal(res.json.publish.reviewedBy, PASTOR);

    assert.equal(await ctx.kv.get('draft:events'), null, 'draft is cleared');
    const published = await ctx.kv.get('published:events', 'json');
    assert.deepEqual(published.data, data);
    assert.equal(published.publishedBy, ADMIN);

    const state = (await call(ctx, PROD_ENV, 'GET', 'content', { as: ADMIN })).json.sections.events;
    assert.equal(state.status, 'published');
    assert.equal(state.published.items[0].time, '10:45 AM');

    assert.equal((await publish(ctx, ADMIN)).status, 409, 'cannot publish the same draft twice');
});

test('gate: editing after review sends the draft back for review', async () => {
    const ctx = makeCtx();
    const first = await save(ctx, PASTOR, await editedEvents());
    await review(ctx, PASTOR);
    assert.equal(await status(ctx), 'reviewed');

    const second = await save(ctx, PASTOR, await editedEvents((d) => { d.items[0].time = '10:30 AM'; }), first.json.draft.rev);
    assert.equal(second.status, 200);
    assert.equal(second.json.status, 'draft');
    assert.equal(second.json.draft.reviewed, null);
    assert.equal((await publish(ctx, ADMIN)).status, 409);

    await review(ctx, ADMIN);
    assert.equal((await publish(ctx, ADMIN)).status, 200);
});

test('gate: a review mark only counts for the revision it was given to', async () => {
    const ctx = makeCtx();
    await saveDraft(ctx, pastor, 'events', await editedEvents(), 0);
    await setReviewed(ctx, pastor, 'events', true);
    // Simulate a stale mark left behind on a newer revision.
    const draft = await ctx.kv.get('draft:events', 'json');
    draft.rev += 1;
    await ctx.kv.put('draft:events', JSON.stringify(draft));
    await assert.rejects(publishSection(ctx, admin, 'events'), /Reviewed/);
});

test('review can be withdrawn, and needs a saved draft', async () => {
    const ctx = makeCtx();
    assert.equal((await review(ctx, PASTOR)).status, 409, 'nothing to review yet');
    await save(ctx, PASTOR, await editedEvents());
    await review(ctx, PASTOR);
    assert.equal((await review(ctx, ADMIN, false)).json.status, 'draft');
    assert.equal((await publish(ctx, ADMIN)).status, 409);
});

test('saving a draft never changes the published content', async () => {
    const ctx = makeCtx();
    await save(ctx, PASTOR, await editedEvents());
    const state = (await call(ctx, PROD_ENV, 'GET', 'content', { as: PASTOR })).json.sections.events;
    assert.equal(state.published.items[0].time, '11:00 AM');
    assert.equal(state.draft.data.items[0].time, '10:45 AM');
    assert.equal(state.draft.updatedBy, PASTOR);
});

test('discarding a draft returns the section to its published state', async () => {
    const ctx = makeCtx();
    await save(ctx, PASTOR, await editedEvents());
    const res = await call(ctx, PROD_ENV, 'DELETE', 'draft/events', { as: PASTOR });
    assert.equal(res.json.status, 'published');
    assert.equal(await ctx.kv.get('draft:events'), null);
});

test('two editors: a save based on an out-of-date draft is refused', async () => {
    const ctx = makeCtx();
    await save(ctx, PASTOR, await editedEvents());
    const stale = await save(ctx, ADMIN, await editedEvents((d) => { d.items[1].time = '6:00 PM'; }), 0);
    assert.equal(stale.status, 409);
    assert.equal((await ctx.kv.get('draft:events', 'json')).data.items[0].time, '10:45 AM');
});

test('invalid content is rejected with per-field messages', async () => {
    const ctx = makeCtx();
    const bad = await editedEvents((d) => {
        d.items[0].title = '';
        d.items[1].weekday = '9';
        d.items[2].schedule = 'dated';
        d.items[2].date = '';
        d.extra = { anything: true };
    });
    const res = await save(ctx, PASTOR, bad);
    assert.equal(res.status, 422);
    assert.deepEqual(res.json.errors.map((e) => e.path).sort(), ['items[0].title', 'items[1].weekday', 'items[2].date']);
    assert.equal(await ctx.kv.get('draft:events'), null);

    const nav = structuredClone((await repoContent()).navigation);
    nav.links[0].target = 'javascript:alert(1)';
    const unsafe = await call(ctx, PROD_ENV, 'PUT', 'draft/navigation', { as: ADMIN, body: { data: nav, baseRev: 0 } });
    assert.equal(unsafe.status, 422);

    const svc = structuredClone((await repoContent()).services);
    svc.cards[1].live_url = 'javascript:alert(1)';
    const unsafeUrl = await call(ctx, PROD_ENV, 'PUT', 'draft/services', { as: ADMIN, body: { data: svc, baseRev: 0 } });
    assert.equal(unsafeUrl.status, 422);
    assert.equal(unsafeUrl.json.errors[0].path, 'cards[1].live_url');
});

test('publish produces a bundle of repo files: content JSON plus re-baked index.html', async () => {
    const ctx = makeCtx();
    await save(ctx, PASTOR, await editedEvents());
    await review(ctx, PASTOR);
    const { json } = await publish(ctx, ADMIN);

    const bundle = await getBundle(ctx, admin, json.publish.id);
    assert.deepEqual(bundle.files.map((f) => f.path), ['content/events.json', 'index.html']);
    assert.equal(JSON.parse(bundle.files[0].content).items[0].time, '10:45 AM');
    assert.match(bundle.files[1].content, /<span class="event-time-badge">10:45 AM<\/span>/);
    assert.match(bundle.branch, /^content\/pub-/);
    assert.deepEqual(bundle.changes, [{ field: 'items[0].time', old: '11:00 AM', new: '10:45 AM' }]);
    assert.doesNotThrow(() => checkBundle(bundle));

    const download = await call(ctx, PROD_ENV, 'GET', `publishes/${json.publish.id}/bundle`, { as: PASTOR });
    assert.equal(download.status, 403, 'bundles are admin-only');
    const list = await call(ctx, PROD_ENV, 'GET', 'publishes', { as: PASTOR });
    assert.equal(list.json.publishes.length, 1);
});

test('a later publish builds on earlier ones in the local published store', async () => {
    const ctx = makeCtx();
    await save(ctx, PASTOR, await editedEvents());
    await review(ctx, PASTOR);
    await publish(ctx, ADMIN);

    const services = structuredClone((await repoContent()).services);
    services.cards[0].time = '9:45 AM';
    await call(ctx, PROD_ENV, 'PUT', 'draft/services', { as: ADMIN, body: { data: services, baseRev: 0 } });
    await call(ctx, PROD_ENV, 'POST', 'draft/services/review', { as: ADMIN, body: { reviewed: true } });
    const second = await call(ctx, PROD_ENV, 'POST', 'publish/services', { as: ADMIN, body: {} });

    const html = (await getBundle(ctx, admin, second.json.publish.id)).files.find((f) => f.path === 'index.html').content;
    assert.match(html, /<p class="service-time">9:45 AM<\/p>/);
    assert.match(html, /<span class="event-time-badge">10:45 AM<\/span>/, 'keeps the earlier events publish');
});

test('uploaded images travel with the publish bundle', async () => {
    const ctx = makeCtx();
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 1, 2, 3, 4]).buffer;
    const saved = await uploadMedia(ctx, pastor, { buffer: png, originalName: 'choir.png', section: 'media', field: 'images[0].src' });
    assert.match(saved.path, /^images\/uploads\/\d{8}-[0-9a-f]{8}\.png$/);

    const media = structuredClone((await repoContent()).media);
    media.images[0].src = saved.path;
    await saveDraft(ctx, pastor, 'media', media, 0);
    await setReviewed(ctx, pastor, 'media', true);
    const { publish: record } = await publishSection(ctx, admin, 'media');

    const bundle = await getBundle(ctx, admin, record.id);
    const image = bundle.files.find((f) => f.path === saved.path);
    assert.equal(image.encoding, 'base64');
    assert.deepEqual(new Uint8Array(Buffer.from(image.content, 'base64')), new Uint8Array(png));
    assert.doesNotThrow(() => checkBundle(bundle));
});

test('uploads must really be images and stay under the size limit', async () => {
    const ctx = makeCtx();
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>').buffer;
    await assert.rejects(uploadMedia(ctx, pastor, { buffer: html, originalName: 'x.png' }), /JPG, PNG, WebP, or GIF/);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>').buffer;
    await assert.rejects(uploadMedia(ctx, pastor, { buffer: svg, originalName: 'x.svg' }), /JPG, PNG/);
    const huge = new Uint8Array(5 * 1024 * 1024 + 1);
    huge.set([0xFF, 0xD8, 0xFF]);
    await assert.rejects(uploadMedia(ctx, pastor, { buffer: huge.buffer, originalName: 'big.jpg' }), /too large/);
    await assert.rejects(uploadMedia(ctx, { email: 'x', role: null }, { buffer: html }), /not allow/);
});

test('publish calls nothing live: local store only, and the GitHub publisher is a stub', async () => {
    const before = net.calls;
    const ctx = makeCtx();
    await save(ctx, PASTOR, await editedEvents());
    await review(ctx, PASTOR);
    await publish(ctx, ADMIN);
    assert.equal(net.calls, before, 'local publish made no network calls');

    assert.equal(selectPublisher({}).mode, 'local');
    assert.equal(selectPublisher({ PUBLISH_MODE: 'github' }).mode, 'github-stub');

    const stubCtx = makeCtx({ publisher: githubPublisherStub({}) });
    await saveDraft(stubCtx, pastor, 'events', await editedEvents(), 0);
    await setReviewed(stubCtx, pastor, 'events', true);
    const { publish: record } = await publishSection(stubCtx, admin, 'events');
    assert.equal(record.delivery.status, 'not-sent');
    assert.ok(record.delivery.wouldDo.some((step) => /pulls/.test(step)));
    assert.equal(net.calls, before, 'the GitHub stub made no network calls');
});

test('apply-publish refuses paths outside content/, index.html and images/uploads/', async () => {
    const file = (path) => ({ files: [{ path, encoding: 'utf8', content: 'x' }] });
    for (const path of ['../evil.txt', 'functions/api/contact.js', '_headers', 'content/../index.html', '/etc/passwd', 'images/uploads/x.svg', '.dev.vars']) {
        assert.throws(() => checkBundle(file(path)), /unexpected path/, path);
    }
    assert.deepEqual(await applyBundle(file('content/events.json'), '/nonexistent-root', { dryRun: true }), ['content/events.json']);
});
