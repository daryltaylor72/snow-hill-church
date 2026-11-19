// Renders site content (content/*.json) into index.html.
//
// index.html carries marker comments around every editable region:
//     <!--cms:services.cards--> ... <!--/cms:services.cards-->
// renderSite() replaces what is between each pair with freshly generated markup.
// The markup already between the markers is the "baked" copy of the published
// content, so the page still works if this renderer never runs.
//
// Pure string work: runs in Pages Functions, in Node (tests, scripts), anywhere.

import { UPLOAD_PREFIX } from './schema.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');
/** Text with line breaks kept as <br>. */
const text = (s) => esc(s).replace(/\n/g, '<br>');
const paragraphs = (s) => String(s ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const delay = (n) => (n > 0 ? ` reveal-delay-${Math.min(n, 4)}` : '');

/** An intentional empty line between items (falsy entries are dropped). */
const BLANK = '\u0000';

/** Put lines inside a region at the given indent, closing marker aligned with it. */
function block(indent, lines) {
    const pad = ' '.repeat(indent);
    const body = lines.filter((l) => typeof l === 'string' && l !== '');
    if (body.length === 0) return '';
    return '\n' + body.map((l) => (l === BLANK ? '' : pad + l)).join('\n') + '\n' + pad;
}

function sectionHeader(indent, h) {
    return block(indent, [
        `<p class="section-label">${esc(h.label)}</p>`,
        `<h2 class="section-title">${text(h.title)}</h2>`
    ]);
}

function buildRegions(content, opts) {
    const { home, services, events, staff, media, navigation } = content;
    const src = (path) => {
        if (opts.mediaBase && path.startsWith(UPLOAD_PREFIX)) {
            return attr(opts.mediaBase + path.slice(UPLOAD_PREFIX.length));
        }
        return attr(path);
    };

    const regions = {};

    // Navigation
    regions['nav.brand'] = esc(navigation.brand.text);
    regions['nav.links'] = block(12, navigation.links
        .filter((l) => l.visible !== 'no')
        .map((l) => `<li><a href="${attr(l.target)}">${esc(l.label)}</a></li>`));
    regions['footer.links'] = block(20, navigation.footer_links
        .map((l) => `<li><a href="${attr(l.target)}">${esc(l.label)}</a></li>`));

    // Home: hero
    const hero = home.hero;
    regions['hero'] = block(12, [
        `<p class="hero-subtitle-top">${esc(hero.subtitle_top)}</p>`,
        `<h1 class="hero-title">${text(hero.title)}</h1>`,
        hero.location && `<p class="hero-location">${esc(hero.location)}</p>`,
        hero.motto && `<p class="hero-motto">${esc(hero.motto)}</p>`,
        '<div class="hero-divider"></div>',
        hero.verse && `<p class="hero-verse">${text(hero.verse)}</p>`,
        `<a href="${attr(hero.cta_target)}" class="hero-cta">${esc(hero.cta_label)}</a>`,
        hero.visit_label && `<a href="${attr(hero.visit_target)}" class="hero-visit-link">${esc(hero.visit_label)}</a>`
    ]);

    // Home: announcement (renders nothing unless switched on)
    const ann = home.announcement;
    regions['announcement'] = ann.enabled === 'yes' && (ann.heading || ann.body)
        ? block(4, [
            '<aside class="announcement" aria-label="Announcement">',
            '    <div class="container">',
            ann.heading && `        <p class="announcement-heading">${esc(ann.heading)}</p>`,
            ann.body && `        <p class="announcement-body">${text(ann.body)}</p>`,
            ann.link_label && ann.link_url && `        <a class="announcement-link" href="${attr(ann.link_url)}"${/^https?:/i.test(ann.link_url) ? ' target="_blank" rel="noopener"' : ''}>${esc(ann.link_label)}</a>`,
            '    </div>',
            '</aside>'
        ])
        : '';

    // Home: about
    regions['about.header'] = sectionHeader(16, home.about);
    regions['about.body'] = block(20, paragraphs(home.about.body).map((p) => `<p>${text(p)}</p>`));
    regions['about.image'] = `<img src="${src(home.about.image)}" alt="${attr(home.about.image_alt)}">`;
    regions['about.values'] = block(24, home.values.flatMap((v, i) => [
        `<div class="about-value reveal${delay(i + 1)}">`,
        '    <div class="about-value-inner">',
        '        <div class="about-value-front">',
        `            <h3>${esc(v.title)}</h3>`,
        `            <p>${esc(v.text)}</p>`,
        '        </div>',
        '        <div class="about-value-back">',
        `            <p>${text(v.verse || v.text)}</p>`,
        v.cite && `            <cite>${esc(v.cite)}</cite>`,
        '        </div>',
        '    </div>',
        '</div>'
    ]));
    regions['verse_banner'] = block(12, [
        text(home.verse_banner.text),
        home.verse_banner.cite && `<cite>${esc(home.verse_banner.cite)}</cite>`
    ]);

    // Services
    regions['services.header'] = sectionHeader(16, services.header);
    regions['services.cards'] = block(16, services.cards.flatMap((c, i) => [
        i > 0 ? BLANK : null,
        `<div class="service-card reveal${delay(i + 1)}">`,
        '    <div class="service-icon">',
        '        <div class="service-icon-cross"></div>',
        '    </div>',
        `    <p class="service-day">${esc(c.day)}</p>`,
        `    <h3 class="service-name">${esc(c.name)}</h3>`,
        `    <p class="service-time">${esc(c.time)}</p>`,
        c.desc && `    <p class="service-desc">${text(c.desc)}</p>`,
        c.live_label && c.live_url && `    <a href="${attr(c.live_url)}" target="_blank" rel="noopener" class="fb-live-badge">${esc(c.live_label)}</a>`,
        '</div>'
    ]));
    regions['contact.hours'] = services.cards
        .map((c) => `${esc(c.contact_label)}: ${esc(c.time)}`).join('<br>');
    regions['footer.hours'] = block(20, services.cards
        .map((c) => `<li><a href="#services">${esc(c.footer_label)} — ${esc(c.time)}</a></li>`));

    // Staff
    const pastor = staff.pastor;
    regions['staff.header'] = sectionHeader(16, staff.header);
    regions['staff.pastor'] = block(16, [
        '<div class="pastor-photo">',
        `    <img src="${src(pastor.photo)}" alt="${attr(pastor.photo_alt)}">`,
        '</div>',
        '<div class="pastor-content">',
        '    <div class="pastor-quote-mark">&ldquo;</div>',
        `    <p class="pastor-message">${paragraphs(pastor.message).map(text).join('<br><br>')}</p>`,
        `    <p class="pastor-name">${esc(pastor.name)}</p>`,
        pastor.title && `    <p class="pastor-title">${esc(pastor.title)}</p>`,
        '</div>'
    ]);
    regions['staff.members'] = staff.members.length
        ? block(12, [
            '<div class="staff-grid reveal">',
            ...staff.members.flatMap((m) => [
                '    <div class="staff-card">',
                m.photo && `        <img class="staff-photo" src="${src(m.photo)}" alt="">`,
                `        <p class="staff-name">${esc(m.name)}</p>`,
                `        <p class="staff-role">${esc(m.role)}</p>`,
                '    </div>'
            ]),
            '</div>'
        ])
        : '';

    // Events
    regions['events.header'] = sectionHeader(16, events.header);
    regions['events.items'] = block(16, events.items.flatMap((e, i) => {
        const dated = e.schedule === 'dated' && /^\d{4}-\d{2}-\d{2}$/.test(e.date);
        const [, month, day] = dated ? e.date.split('-').map(Number) : [];
        return [
            i > 0 ? BLANK : null,
            dated
                ? `<div class="event-item reveal${delay(i + 1)}" data-date="${attr(e.date)}">`
                : `<div class="event-item reveal${delay(i + 1)}" data-weekday="${attr(e.weekday)}">`,
            '    <div class="event-date">',
            `        <p class="event-month">${dated ? MONTHS[month - 1] || '' : ''}</p>`,
            `        <p class="event-day-num">${dated ? day : ''}</p>`,
            '    </div>',
            '    <div class="event-details">',
            `        <h3>${esc(e.title)}</h3>`,
            `        <p>${text(e.desc)}</p>`,
            '    </div>',
            `    <span class="event-time-badge">${esc(e.time)}</span>`,
            '</div>'
        ];
    }));

    // Media
    regions['media.header'] = sectionHeader(16, media.header);
    regions['media.images'] = block(16, media.images.flatMap((g, i) => [
        `<div class="gallery-item reveal${delay(i === 0 ? 0 : i + 1)}">`,
        `    <img src="${src(g.src)}" alt="${attr(g.alt)}">`,
        '</div>'
    ]));
    regions['media.cta'] = media.more.label && media.more.url
        ? `<a href="${attr(media.more.url)}" target="_blank" rel="noopener">${esc(media.more.label)}</a>`
        : '';

    return regions;
}

export const REGION_NAMES = [
    'nav.brand', 'nav.links', 'hero', 'announcement', 'about.header', 'about.body',
    'about.values', 'about.image', 'verse_banner', 'services.header', 'services.cards',
    'staff.header', 'staff.pastor', 'staff.members', 'events.header', 'events.items',
    'media.header', 'media.images', 'media.cta', 'contact.hours', 'footer.links', 'footer.hours'
];

const regionPattern = (name) => {
    const n = name.replace(/\./g, '\\.');
    return new RegExp(`(<!--cms:${n}-->)[\\s\\S]*?(<!--/cms:${n}-->)`);
};

/**
 * @param {string} html      index.html (with cms markers)
 * @param {object} content   { home, services, events, staff, media, navigation }
 * @param {object} [opts]
 * @param {string} [opts.mediaBase]  URL prefix that serves images/uploads/* from the
 *                                   admin media store (previews only)
 * @param {string} [opts.badge]      label for a small "preview" pill (previews only)
 * @returns {string}
 */
export function renderSite(html, content, opts = {}) {
    const regions = buildRegions(content, opts);
    let out = html;
    for (const name of REGION_NAMES) {
        // Function replacement so "$" in content is never treated as a pattern.
        out = out.replace(regionPattern(name), (_, open, close) => open + regions[name] + close);
    }
    if (opts.badge) {
        const pill = '<div style="position:fixed;left:12px;bottom:12px;z-index:2000;pointer-events:none;'
            + 'background:#C9A84C;color:#1C2030;font:600 13px/1 Georgia,serif;letter-spacing:.06em;'
            + 'text-transform:uppercase;padding:9px 14px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.3)">'
            + esc(opts.badge) + '</div>';
        out = out
            .replace('</head>', '    <meta name="robots" content="noindex, nofollow">\n</head>')
            .replace('</body>', pill + '\n</body>');
    }
    return out;
}

/** Marker names present in a template (used by tests to catch a missing marker). */
export function findRegions(html) {
    return REGION_NAMES.filter((name) => regionPattern(name).test(html));
}
