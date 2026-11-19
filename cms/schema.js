// Content schema for the Snow Hill MBC site admin.
// Shared by the admin UI (browser), the Pages Functions API, and the tests.
// Pure data + pure functions only: no DOM, no Workers APIs, no Node APIs.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const WEEKDAY_NAME_OPTIONS = WEEKDAYS.map((d) => ({ value: d, label: d }));
const WEEKDAY_INDEX_OPTIONS = WEEKDAYS.map((d, i) => ({ value: String(i), label: d }));

const TARGET_OPTIONS = [
    { value: '#home', label: 'Top of page' },
    { value: '#about', label: 'About' },
    { value: '#services', label: 'Service Times' },
    { value: '#pastor', label: 'Pastor' },
    { value: '#events', label: 'Events' },
    { value: '#give', label: 'Give' },
    { value: '#gallery', label: 'Gallery' },
    { value: '#contact', label: 'Contact' }
];

const YES_NO = [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' }
];

const header = (label) => ({
    key: 'header',
    label,
    fields: [
        { key: 'label', label: 'Small label above the heading', type: 'text', max: 60, required: true },
        { key: 'title', label: 'Heading', type: 'text', max: 120, required: true }
    ]
});

export const SECTION_ORDER = ['home', 'services', 'events', 'staff', 'media', 'navigation'];

export const SECTIONS = {
    home: {
        label: 'Home',
        description: 'Welcome banner, announcement, and the "Our Story" block.',
        permission: 'content:edit',
        groups: [
            {
                key: 'hero',
                label: 'Welcome banner',
                fields: [
                    { key: 'subtitle_top', label: 'Small line above the church name', type: 'text', max: 60, required: true },
                    { key: 'title', label: 'Church name', type: 'textarea', rows: 2, max: 120, required: true, help: 'Press Enter to start a new line.' },
                    { key: 'location', label: 'Location line', type: 'text', max: 80 },
                    { key: 'motto', label: 'Motto', type: 'text', max: 160 },
                    { key: 'verse', label: 'Scripture verse', type: 'textarea', rows: 3, max: 400, help: 'Press Enter to start a new line.' },
                    { key: 'cta_label', label: 'Main button text', type: 'text', max: 40, required: true },
                    { key: 'cta_target', label: 'Main button goes to', type: 'select', options: TARGET_OPTIONS, required: true },
                    { key: 'visit_label', label: 'Second link text', type: 'text', max: 60 },
                    { key: 'visit_target', label: 'Second link goes to', type: 'select', options: TARGET_OPTIONS, required: true }
                ]
            },
            {
                key: 'announcement',
                label: 'Announcement',
                help: 'Shows as a band under the welcome banner when turned on.',
                fields: [
                    { key: 'enabled', label: 'Show announcement', type: 'select', options: YES_NO, required: true },
                    { key: 'heading', label: 'Announcement heading', type: 'text', max: 100 },
                    { key: 'body', label: 'Announcement text', type: 'textarea', rows: 3, max: 600 },
                    { key: 'link_label', label: 'Link text (optional)', type: 'text', max: 60 },
                    { key: 'link_url', label: 'Link address (optional)', type: 'url', max: 300, help: 'A full web address starting with https://, or a page section such as #events.' }
                ]
            },
            {
                key: 'about',
                label: 'Our Story',
                fields: [
                    { key: 'label', label: 'Small label above the heading', type: 'text', max: 60, required: true },
                    { key: 'title', label: 'Heading', type: 'textarea', rows: 2, max: 120, required: true, help: 'Press Enter to start a new line.' },
                    { key: 'body', label: 'Story text', type: 'textarea', rows: 10, max: 4000, required: true, help: 'Leave a blank line between paragraphs.' },
                    { key: 'image', label: 'Church photo', type: 'image', required: true },
                    { key: 'image_alt', label: 'Photo description (for screen readers)', type: 'text', max: 160 }
                ]
            },
            {
                key: 'values',
                label: 'Core values',
                list: true,
                itemLabel: 'Value',
                titleField: 'title',
                max: 8,
                fields: [
                    { key: 'title', label: 'Value', type: 'text', max: 40, required: true },
                    { key: 'text', label: 'Short description', type: 'text', max: 120, required: true },
                    { key: 'verse', label: 'Verse shown on the back of the card', type: 'textarea', rows: 2, max: 240 },
                    { key: 'cite', label: 'Verse reference', type: 'text', max: 60 }
                ]
            },
            {
                key: 'verse_banner',
                label: 'Verse banner',
                fields: [
                    { key: 'text', label: 'Verse', type: 'textarea', rows: 3, max: 400, required: true },
                    { key: 'cite', label: 'Verse reference', type: 'text', max: 60 }
                ]
            }
        ]
    },

    services: {
        label: 'Services',
        description: 'Weekly service times. These also update the times shown in the Contact area and the footer.',
        permission: 'content:edit',
        groups: [
            header('Section heading'),
            {
                key: 'cards',
                label: 'Service times',
                list: true,
                itemLabel: 'Service',
                titleField: 'name',
                max: 9,
                fields: [
                    { key: 'day', label: 'Day', type: 'select', options: WEEKDAY_NAME_OPTIONS, required: true },
                    { key: 'name', label: 'Service name', type: 'text', max: 60, required: true },
                    { key: 'time', label: 'Time', type: 'text', max: 30, required: true, help: 'Example: 11:00 AM' },
                    { key: 'desc', label: 'Description', type: 'textarea', rows: 3, max: 300 },
                    { key: 'contact_label', label: 'Short name for the Contact area', type: 'text', max: 40, required: true },
                    { key: 'footer_label', label: 'Short name for the footer', type: 'text', max: 40, required: true },
                    { key: 'live_label', label: 'Live stream badge text (optional)', type: 'text', max: 60 },
                    { key: 'live_url', label: 'Live stream link (optional)', type: 'url', max: 300 }
                ]
            }
        ]
    },

    events: {
        label: 'Events',
        description: 'Upcoming and weekly events.',
        permission: 'content:edit',
        groups: [
            header('Section heading'),
            {
                key: 'items',
                label: 'Events',
                list: true,
                itemLabel: 'Event',
                titleField: 'title',
                max: 20,
                fields: [
                    { key: 'title', label: 'Event name', type: 'text', max: 80, required: true },
                    { key: 'desc', label: 'Description', type: 'textarea', rows: 2, max: 300 },
                    { key: 'time', label: 'Time', type: 'text', max: 40, required: true, help: 'Example: 6:30 PM' },
                    {
                        key: 'schedule', label: 'How often', type: 'select', required: true,
                        options: [
                            { value: 'weekly', label: 'Every week' },
                            { value: 'dated', label: 'One date only' }
                        ]
                    },
                    { key: 'weekday', label: 'Day of the week (for weekly events)', type: 'select', options: WEEKDAY_INDEX_OPTIONS, required: true },
                    { key: 'date', label: 'Date (for one date only)', type: 'date' }
                ]
            }
        ]
    },

    staff: {
        label: 'Staff',
        description: "The Pastor's welcome and church staff.",
        permission: 'content:edit',
        groups: [
            header('Section heading'),
            {
                key: 'pastor',
                label: 'Pastor',
                fields: [
                    { key: 'photo', label: 'Photo', type: 'image', required: true },
                    { key: 'photo_alt', label: 'Photo description (for screen readers)', type: 'text', max: 160 },
                    { key: 'message', label: 'Welcome message', type: 'textarea', rows: 10, max: 4000, required: true, help: 'Leave a blank line between paragraphs.' },
                    { key: 'name', label: 'Name', type: 'text', max: 120, required: true },
                    { key: 'title', label: 'Title line under the name', type: 'text', max: 120 }
                ]
            },
            {
                key: 'members',
                label: 'Staff and ministry leaders',
                help: 'Optional. Shown under the Pastor message when at least one person is added.',
                list: true,
                itemLabel: 'Person',
                titleField: 'name',
                max: 24,
                fields: [
                    { key: 'name', label: 'Name', type: 'text', max: 80, required: true },
                    { key: 'role', label: 'Role', type: 'text', max: 80, required: true },
                    { key: 'photo', label: 'Photo (optional)', type: 'image' }
                ]
            }
        ]
    },

    media: {
        label: 'Media',
        description: 'Photo gallery.',
        permission: 'content:edit',
        groups: [
            header('Section heading'),
            {
                key: 'images',
                label: 'Gallery photos',
                list: true,
                itemLabel: 'Photo',
                titleField: 'alt',
                max: 12,
                fields: [
                    { key: 'src', label: 'Photo', type: 'image', required: true },
                    { key: 'alt', label: 'Photo description (for screen readers)', type: 'text', max: 160 }
                ]
            },
            {
                key: 'more',
                label: 'More photos link',
                fields: [
                    { key: 'label', label: 'Button text', type: 'text', max: 60 },
                    { key: 'url', label: 'Button link', type: 'url', max: 300 }
                ]
            }
        ]
    },

    navigation: {
        label: 'Navigation',
        description: 'Menu links at the top of the site and quick links in the footer. Administrators only.',
        permission: 'nav:edit',
        groups: [
            {
                key: 'brand',
                label: 'Site name in the menu bar',
                fields: [
                    { key: 'text', label: 'Short site name', type: 'text', max: 40, required: true }
                ]
            },
            {
                key: 'links',
                label: 'Menu links',
                list: true,
                itemLabel: 'Link',
                titleField: 'label',
                max: 9,
                fields: [
                    { key: 'label', label: 'Link text', type: 'text', max: 24, required: true },
                    { key: 'target', label: 'Goes to', type: 'select', options: TARGET_OPTIONS, required: true },
                    { key: 'visible', label: 'Show in menu', type: 'select', options: YES_NO, required: true }
                ]
            },
            {
                key: 'footer_links',
                label: 'Footer quick links',
                list: true,
                itemLabel: 'Link',
                titleField: 'label',
                max: 9,
                fields: [
                    { key: 'label', label: 'Link text', type: 'text', max: 30, required: true },
                    { key: 'target', label: 'Goes to', type: 'select', options: TARGET_OPTIONS, required: true }
                ]
            }
        ]
    }
};

export const isSection = (key) => Object.prototype.hasOwnProperty.call(SECTIONS, key);

// Uploaded images land here. In the repo this is a real folder; while a draft is
// being previewed the same path is served from the admin media store.
export const UPLOAD_PREFIX = 'images/uploads/';

const IMAGE_PATH = /^images\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:jpe?g|png|webp|gif)$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isSafeUrl(value) {
    if (/[\u0000- "'<>`\\]/.test(value)) return false;
    if (/^#[A-Za-z][A-Za-z0-9_-]*$/.test(value)) return true;
    if (/^(?:https:\/\/|http:\/\/)[^/]+/i.test(value)) return true;
    if (/^mailto:[^@\s]+@[^@\s]+$/i.test(value)) return true;
    if (/^tel:\+?[0-9().-]+$/i.test(value)) return true;
    return false;
}

export function isSafeImagePath(value) {
    return IMAGE_PATH.test(value) && !value.includes('..');
}

function cleanString(raw, multiline) {
    let s = typeof raw === 'string' ? raw : (raw == null ? '' : String(raw));
    s = s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    if (!multiline) s = s.replace(/\s*\n\s*/g, ' ');
    return s.trim();
}

function sanitizeField(field, raw, path, errors) {
    const value = cleanString(raw, field.type === 'textarea');
    const fail = (message) => errors.push({ path, label: field.label, message });

    if (!value) {
        if (field.required) fail('This field is required.');
        return '';
    }
    if (field.max && value.length > field.max) {
        fail(`Please keep this under ${field.max} characters.`);
    }
    if (field.type === 'select' && !field.options.some((o) => o.value === value)) {
        fail('Please choose one of the listed options.');
    }
    if (field.type === 'url' && !isSafeUrl(value)) {
        fail('Please enter a full web address starting with https://');
    }
    if (field.type === 'image' && !isSafeImagePath(value)) {
        fail('Please choose an image using the upload button.');
    }
    if (field.type === 'date' && (!DATE.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z')))) {
        fail('Please enter a valid date.');
    }
    return value;
}

function sanitizeObject(fields, raw, path, errors) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = {};
    for (const field of fields) {
        out[field.key] = sanitizeField(field, source[field.key], `${path}.${field.key}`, errors);
    }
    return out;
}

/**
 * Validate and normalise one section's data against the schema.
 * Unknown keys are dropped; every known key is present in the result.
 * @returns {{ data: object, errors: Array<{path: string, label: string, message: string}> }}
 */
export function sanitizeSection(sectionKey, input) {
    const section = SECTIONS[sectionKey];
    if (!section) throw new Error(`Unknown section: ${sectionKey}`);
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const errors = [];
    const data = {};

    for (const group of section.groups) {
        if (group.list) {
            const items = Array.isArray(source[group.key]) ? source[group.key] : [];
            if (group.max && items.length > group.max) {
                errors.push({ path: group.key, label: group.label, message: `No more than ${group.max} items.` });
            }
            data[group.key] = items
                .slice(0, group.max || items.length)
                .map((item, i) => sanitizeObject(group.fields, item, `${group.key}[${i}]`, errors));
        } else {
            data[group.key] = sanitizeObject(group.fields, source[group.key], group.key, errors);
        }
    }

    // Cross-field rule: a one-date event needs its date.
    if (sectionKey === 'events') {
        data.items.forEach((item, i) => {
            if (item.schedule === 'dated' && !item.date) {
                errors.push({ path: `items[${i}].date`, label: 'Date (for one date only)', message: 'Please pick the date for this event.' });
            }
        });
    }

    return { data, errors };
}

/** A blank item for a list group (used by the "Add" buttons). */
export function blankItem(group) {
    const item = {};
    for (const field of group.fields) {
        item[field.key] = field.type === 'select' && field.required ? field.options[0].value : '';
    }
    return item;
}

/** Flatten section data to { "group.field" | "group[i].field": value } for diffing. */
export function flatten(data) {
    const out = {};
    for (const [groupKey, group] of Object.entries(data || {})) {
        if (Array.isArray(group)) {
            group.forEach((item, i) => {
                for (const [k, v] of Object.entries(item || {})) out[`${groupKey}[${i}].${k}`] = v;
            });
        } else if (group && typeof group === 'object') {
            for (const [k, v] of Object.entries(group)) out[`${groupKey}.${k}`] = v;
        }
    }
    return out;
}

/** Field-level differences between two versions of a section. */
export function diffSection(before, after) {
    const a = flatten(before);
    const b = flatten(after);
    const changes = [];
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const oldValue = a[field] ?? '';
        const newValue = b[field] ?? '';
        if (oldValue !== newValue) changes.push({ field, old: oldValue, new: newValue });
    }
    return changes;
}

/** Every image path referenced by a section's data. */
export function imagePaths(sectionKey, data) {
    const section = SECTIONS[sectionKey];
    const paths = [];
    for (const group of section.groups) {
        const items = group.list ? (data[group.key] || []) : [data[group.key] || {}];
        for (const item of items) {
            for (const field of group.fields) {
                if (field.type === 'image' && item[field.key]) paths.push(item[field.key]);
            }
        }
    }
    return paths;
}
