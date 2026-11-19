import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REGION_NAMES, findRegions, renderSite } from '../cms/render.js';
import { SECTION_ORDER, sanitizeSection } from '../cms/schema.js';
import { repoContent, template } from './helpers.mjs';

test('index.html carries a marker pair for every editable region', async () => {
    assert.deepEqual(findRegions(await template()), REGION_NAMES);
});

test('index.html is exactly what content/*.json renders to (public page unchanged)', async () => {
    const html = await template();
    assert.equal(renderSite(html, await repoContent()), html);
});

test('content/*.json passes schema validation unchanged', async () => {
    const content = await repoContent();
    for (const key of SECTION_ORDER) {
        const { data, errors } = sanitizeSection(key, content[key]);
        assert.deepEqual(errors, [], `${key} has validation errors`);
        assert.deepEqual(data, content[key], `${key} is not in canonical form`);
    }
});

test('edited content shows up in the rendered page', async () => {
    const content = await repoContent();
    content.services.cards[1].time = '10:30 AM';
    content.events.items.push({ title: 'Homecoming', desc: 'Dinner on the grounds.', time: '3:00 PM', schedule: 'dated', weekday: '0', date: '2027-06-13' });
    const html = renderSite(await template(), content);
    assert.match(html, /<p class="service-time">10:30 AM<\/p>/);
    assert.match(html, /Morning Worship: 10:30 AM/, 'contact hours follow the service time');
    assert.match(html, /Worship — 10:30 AM/, 'footer hours follow the service time');
    assert.match(html, /data-date="2027-06-13">[\s\S]*?<p class="event-month">Jun<\/p>\s*<p class="event-day-num">13<\/p>/);
});

test('announcement and staff list render only when they have content', async () => {
    const content = await repoContent();
    const base = await template();
    assert.doesNotMatch(base, /class="announcement"/);
    assert.doesNotMatch(base, /class="staff-grid/);

    content.home.announcement = { enabled: 'yes', heading: 'Revival Week', body: 'Nightly at 7 PM.', link_label: 'Details', link_url: '#events' };
    content.staff.members = [{ name: 'Deacon Example', role: 'Chairman of Deacons', photo: '' }];
    const html = renderSite(base, content);
    assert.match(html, /<aside class="announcement"[\s\S]*Revival Week[\s\S]*Nightly at 7 PM\.[\s\S]*href="#events"/);
    assert.match(html, /class="staff-name">Deacon Example</);
});

test('hidden menu links are left out', async () => {
    const content = await repoContent();
    content.navigation.links[4].visible = 'no';
    const html = renderSite(await template(), content);
    const menu = html.match(/<!--cms:nav\.links-->([\s\S]*?)<!--\/cms:nav\.links-->/)[1];
    assert.doesNotMatch(menu, /#give/);
    assert.match(menu, /#gallery/);
});

test('content is escaped, never injected as markup', async () => {
    const content = await repoContent();
    content.home.hero.subtitle_top = '<script>alert(1)</script>';
    content.media.images[0].alt = '" onerror="alert(1)';
    content.home.verse_banner.text = 'Costs $& and $1 & more';
    const html = renderSite(await template(), content);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /alt="&quot; onerror=&quot;alert\(1\)"/);
    assert.match(html, /Costs \$&amp; and \$1 &amp; more/);
});

test('previews serve uploaded images from the admin media store and are marked noindex', async () => {
    const content = await repoContent();
    content.media.images[0].src = 'images/uploads/20261118-abcd1234.jpg';
    const html = renderSite(await template(), content, { mediaBase: 'api/admin/media/', badge: 'Draft preview' });
    assert.match(html, /src="api\/admin\/media\/20261118-abcd1234\.jpg"/);
    assert.match(html, /noindex/);
    assert.match(html, />Draft preview<\/div>/);
    // The published page keeps the real repo path.
    assert.match(renderSite(await template(), content), /src="images\/uploads\/20261118-abcd1234\.jpg"/);
});

test('rendering twice gives the same result', async () => {
    const content = await repoContent();
    content.home.hero.title = 'Snow Hill\nMBC';
    const once = renderSite(await template(), content);
    assert.equal(renderSite(once, content), once);
});
