import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { listAudit, uploadMedia } from '../cms/workflow.js';
import {
    ADMIN, PASTOR, PROD_ENV, STRANGER, admin, blockNetwork, call, editedEvents, makeCtx, pastor, repoContent
} from './helpers.mjs';

let net;
before(() => { net = blockNetwork(); });
after(() => { assert.equal(net.calls, 0, 'tests must not touch the network'); net.restore(); });

const save = (ctx, as, data, baseRev = 0) => call(ctx, PROD_ENV, 'PUT', 'draft/events', { as, body: { data, baseRev } });
const audit = async (ctx, section) => (await listAudit(ctx, admin, { section })).entries;

test('every edited field is logged with who, when, section, field, old value and new value', async () => {
    const ctx = makeCtx();
    await save(ctx, PASTOR, await editedEvents((d) => {
        d.items[0].time = '10:45 AM';
        d.header.title = 'Upcoming Events';
    }));

    const entries = await audit(ctx);
    assert.equal(entries.length, 2);
    const byField = Object.fromEntries(entries.map((e) => [e.field, e]));

    assert.deepEqual(
        { ...byField['items[0].time'], id: undefined },
        {
            id: undefined, at: '2026-11-18T15:00:01.000Z', who: PASTOR, role: 'pastor', action: 'edit',
            section: 'events', field: 'items[0].time', old: '11:00 AM', new: '10:45 AM'
        }
    );
    assert.equal(byField['header.title'].old, 'Church Events');
    assert.equal(byField['header.title'].new, 'Upcoming Events');
    for (const e of entries) assert.match(e.id, /^[0-9a-f]{12}$/);
});

test('a second edit logs the change from the previous draft, not from the published copy', async () => {
    const ctx = makeCtx();
    const first = await save(ctx, PASTOR, await editedEvents());
    await save(ctx, ADMIN, await editedEvents((d) => { d.items[0].time = '10:30 AM'; }), first.json.draft.rev);

    const entries = await audit(ctx);
    assert.equal(entries.length, 2);
    assert.deepEqual(
        entries.map((e) => [e.who, e.old, e.new]),
        [[ADMIN, '10:45 AM', '10:30 AM'], [PASTOR, '11:00 AM', '10:45 AM']],
        'newest first'
    );
    assert.ok(entries[0].at > entries[1].at);
});

test('added and removed list items are logged field by field', async () => {
    const ctx = makeCtx();
    await save(ctx, PASTOR, await editedEvents((d) => {
        d.items.push({ title: 'Homecoming', desc: '', time: '3:00 PM', schedule: 'dated', weekday: '0', date: '2027-06-13' });
    }));
    const entries = await audit(ctx);
    const added = Object.fromEntries(entries.map((e) => [e.field, e.new]));
    assert.equal(added['items[4].title'], 'Homecoming');
    assert.equal(added['items[4].date'], '2027-06-13');
    assert.ok(entries.every((e) => e.old === ''));
});

test('saving with no changes writes nothing to the log', async () => {
    const ctx = makeCtx();
    const res = await save(ctx, PASTOR, (await repoContent()).events);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.changes, []);
    assert.equal((await audit(ctx)).length, 0);
});

test('rejected saves are not logged', async () => {
    const ctx = makeCtx();
    await save(ctx, STRANGER, await editedEvents());                                   // 403
    await save(ctx, PASTOR, await editedEvents((d) => { d.items[0].title = ''; }));     // 422
    await call(ctx, PROD_ENV, 'PUT', 'draft/navigation', { as: PASTOR, body: { data: (await repoContent()).navigation, baseRev: 0 } }); // 403
    assert.equal((await ctx.kv.list({ prefix: 'audit:' })).keys.length, 0);
});

test('review, publish, discard and upload are logged too', async () => {
    const ctx = makeCtx();
    await save(ctx, PASTOR, await editedEvents());
    await call(ctx, PROD_ENV, 'POST', 'draft/events/review', { as: PASTOR, body: { reviewed: true } });
    await call(ctx, PROD_ENV, 'POST', 'publish/events', { as: ADMIN, body: {} });

    const first = await save(ctx, PASTOR, await editedEvents((d) => { d.items[0].time = '10:00 AM'; }));
    assert.equal(first.status, 200);
    await call(ctx, PROD_ENV, 'DELETE', 'draft/events', { as: PASTOR });

    const jpg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]).buffer;
    await uploadMedia(ctx, pastor, { buffer: jpg, originalName: 'picnic.jpg', section: 'media', field: 'images[2].src' });

    const entries = (await audit(ctx)).reverse(); // oldest first
    assert.deepEqual(entries.map((e) => `${e.action}:${e.who === ADMIN ? 'admin' : 'pastor'}`), [
        'edit:pastor', 'review:pastor', 'publish:admin', 'edit:pastor', 'discard:pastor', 'upload:pastor'
    ]);
    assert.deepEqual([entries[1].old, entries[1].new], ['draft', 'reviewed']);
    assert.match(entries[2].new, /^published \(pub-/);
    assert.deepEqual([entries[3].old, entries[3].new], ['10:45 AM', '10:00 AM'], 'diffed against what was published');
    assert.match(entries[5].new, /^images\/uploads\/.+\.jpg \(picnic\.jpg, 1 KB\)$/);
    assert.equal(entries[5].field, 'images[2].src');
});

test('the log can be filtered by section and is closed to unlisted users', async () => {
    const ctx = makeCtx();
    await save(ctx, PASTOR, await editedEvents());
    const services = structuredClone((await repoContent()).services);
    services.cards[0].time = '9:45 AM';
    await call(ctx, PROD_ENV, 'PUT', 'draft/services', { as: PASTOR, body: { data: services, baseRev: 0 } });

    const res = await call(ctx, PROD_ENV, 'GET', 'audit?section=services', { as: PASTOR });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.entries.map((e) => e.section), ['services']);
    assert.equal((await call(ctx, PROD_ENV, 'GET', 'audit', { as: PASTOR })).json.entries.length, 2);
    assert.equal((await call(ctx, PROD_ENV, 'GET', 'audit', { as: STRANGER })).status, 403);
    assert.equal((await call(ctx, PROD_ENV, 'GET', 'audit')).status, 401);
});

test('the log pages through long histories', async () => {
    const ctx = makeCtx();
    let rev = 0;
    for (let i = 0; i < 5; i++) {
        const res = await save(ctx, PASTOR, await editedEvents((d) => { d.items[0].time = `${i + 1}:00 PM`; }), rev);
        rev = res.json.draft.rev;
    }
    const first = await listAudit(ctx, admin, { limit: 2 });
    assert.equal(first.entries.length, 2);
    assert.equal(first.entries[0].new, '5:00 PM');
    assert.ok(first.cursor);
    const second = await listAudit(ctx, admin, { limit: 2, cursor: first.cursor });
    assert.deepEqual(second.entries.map((e) => e.new), ['3:00 PM', '2:00 PM']);
});
