// Snow Hill MBC site admin (browser).
// All URLs are relative, so this works on localhost, behind a proxy, or through a tunnel.

import { SECTIONS, SECTION_ORDER, UPLOAD_PREFIX, blankItem } from '../cms/schema.js';

const API = '../api/admin/';
const SITE = '../';

const state = {
    session: null,
    sections: null,   // from GET content: { [key]: { published, draft, status, canEdit } }
    view: 'home',     // a section key, or 'activity'
    working: null,    // editable copy of the current section's data
    dirty: false,
    busy: false,
    errors: {},       // field path -> message
    audit: { entries: [], cursor: null, section: '' },
    publishes: []
};

const $ = (id) => document.getElementById(id);

/** Tiny DOM builder. Children may be nodes, strings, or falsy (skipped). */
function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v === false || v === null || v === undefined) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
    }
    for (const child of children.flat()) {
        if (child === false || child === null || child === undefined || child === '') continue;
        el.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return el;
}

/** Replace an element's children, skipping falsy entries. */
function mount(el, ...children) {
    el.replaceChildren(...children.flat().filter((c) => c !== false && c !== null && c !== undefined && c !== ''));
}

// ── API ─────────────────────────────────────────────────────────────────────

async function api(path, { method = 'GET', body, form } = {}) {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') headers['X-Requested-With'] = 'snowhill-admin';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
        res = await fetch(API + path, {
            method,
            headers,
            body: form || (body !== undefined ? JSON.stringify(body) : undefined),
            credentials: 'same-origin',
            cache: 'no-store'
        });
    } catch {
        throw Object.assign(new Error('Could not reach the server. Check your connection and try again.'), { status: 0 });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status, data });
    return data;
}

let toastTimer;
function toast(message, kind = '') {
    const el = $('toast');
    el.textContent = message;
    el.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'bad' ? 6000 : 3500);
}

const can = (permission) => Boolean(state.session?.permissions.includes(permission));
const clone = (value) => JSON.parse(JSON.stringify(value));
const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

const STATUS_LABEL = { published: 'Published', draft: 'Draft', reviewed: 'Reviewed', locked: 'Admin only' };

// ── Start-up ────────────────────────────────────────────────────────────────

async function start() {
    try {
        state.session = await api('session');
    } catch (err) {
        return showGate(err.status === 401 ? 'Sign in required' : 'Admin unavailable', err.message);
    }
    renderIdentity();
    if (!state.session.role) {
        return showGate('No access', `${state.session.email} is not on the admin list. Please contact the church administrator.`);
    }
    try {
        await loadContent();
    } catch (err) {
        return showGate('Admin unavailable', err.message);
    }
    $('shell').hidden = false;
    const wanted = location.hash.slice(1);
    state.view = wanted === 'activity' || SECTIONS[wanted] ? wanted : 'home';
    openView(state.view, { force: true });
}

function showGate(title, message) {
    $('shell').hidden = true;
    const gate = $('gate');
    gate.replaceChildren(h('h1', { text: title }), h('p', { text: message }));
    gate.hidden = false;
}

function renderIdentity() {
    const { email, role, devMode, devIdentities } = state.session;
    $('who-email').textContent = email;
    const chip = $('who-role');
    chip.textContent = role || 'No access';
    chip.className = role ? 'chip' : 'chip none';
    $('who').hidden = false;

    // The role switcher only exists when the server says this is the local preview.
    if (devMode && devIdentities) {
        const select = $('dev-identity');
        select.replaceChildren(...devIdentities.map((d) => h('option', {
            value: d.email, selected: d.email === email,
            text: `${d.role ? d.role[0].toUpperCase() + d.role.slice(1) : 'Not on the list'} (${d.email})`
        })));
        select.onchange = async () => {
            if (state.dirty && !confirm('You have unsaved changes. Switch user and lose them?')) {
                select.value = email;
                return;
            }
            try {
                await api('dev-identity', { method: 'POST', body: { email: select.value } });
                state.dirty = false;
                location.reload();
            } catch (err) {
                toast(err.message, 'bad');
            }
        };
        $('devbar').hidden = false;
    }
}

async function loadContent() {
    state.sections = (await api('content')).sections;
}

// ── Navigation between sections ─────────────────────────────────────────────

function renderNav() {
    const list = $('sections-list');
    const item = (key, label, status) => h('li', { class: key === 'activity' ? 'divider' : '' },
        h('button', {
            type: 'button',
            'aria-current': state.view === key ? 'page' : null,
            onclick: () => openView(key)
        },
            h('span', { text: label }),
            status && h('span', { class: `status ${status}`, text: STATUS_LABEL[status] })
        ));

    list.replaceChildren(
        ...SECTION_ORDER.map((key) => {
            const s = state.sections[key];
            return item(key, SECTIONS[key].label, s.canEdit ? s.status : 'locked');
        }),
        item('activity', 'Activity log')
    );
    $('sections-current').textContent = state.view === 'activity' ? 'Activity log' : SECTIONS[state.view].label;
}

function setMenu(open) {
    $('sections-list').classList.toggle('open', open);
    $('sections-toggle').setAttribute('aria-expanded', String(open));
}

function openView(key, { force = false } = {}) {
    if (!force && key === state.view) return setMenu(false);
    if (state.dirty && !confirm('You have unsaved changes in this section. Leave without saving?')) return;
    state.view = key;
    state.dirty = false;
    state.errors = {};
    history.replaceState(null, '', `#${key}`);
    setMenu(false);
    if (key === 'activity') {
        state.working = null;
        renderNav();
        renderActivity();
        loadActivity(true);
    } else {
        const s = state.sections[key];
        state.working = clone(s.draft ? s.draft.data : s.published);
        renderNav();
        renderSection();
    }
    window.scrollTo(0, 0);
}

// ── Section editor ──────────────────────────────────────────────────────────

const current = () => state.sections[state.view];

function readPath(path) {
    const m = /^([a-z_]+)(?:\[(\d+)\])?\.([a-z_]+)$/.exec(path);
    const group = state.working[m[1]];
    return (m[2] === undefined ? group : group[Number(m[2])])[m[3]];
}

function writePath(path, value) {
    const m = /^([a-z_]+)(?:\[(\d+)\])?\.([a-z_]+)$/.exec(path);
    const group = state.working[m[1]];
    (m[2] === undefined ? group : group[Number(m[2])])[m[3]] = value;
    markDirty();
}

function markDirty() {
    if (!state.dirty) {
        state.dirty = true;
    }
    renderActionBar();
}

const imageUrl = (path) => (path.startsWith(UPLOAD_PREFIX)
    ? `${API}media/${encodeURIComponent(path.slice(UPLOAD_PREFIX.length))}`
    : SITE + path);

function fieldControl(field, path, disabled) {
    const id = `f-${path}`;
    const value = readPath(path) ?? '';
    const common = { id, name: path, disabled, 'aria-describedby': `${id}-help ${id}-error` };

    if (field.type === 'select') {
        const known = field.options.some((o) => o.value === value);
        return h('select', { ...common, onchange: (e) => writePath(path, e.target.value) },
            !known && h('option', { value, selected: true, text: value || 'Choose…' }),
            field.options.map((o) => h('option', { value: o.value, selected: o.value === value, text: o.label })));
    }
    if (field.type === 'textarea') {
        const el = h('textarea', { ...common, rows: field.rows || 3, maxlength: field.max, oninput: (e) => writePath(path, e.target.value) });
        el.value = value;
        return el;
    }
    if (field.type === 'image') return imageSlot(field, path, disabled);

    const el = h('input', {
        ...common,
        type: field.type === 'date' ? 'date' : field.type === 'url' ? 'url' : 'text',
        maxlength: field.max,
        inputmode: field.type === 'url' ? 'url' : null,
        autocomplete: 'off',
        autocapitalize: field.type === 'url' ? 'none' : null,
        placeholder: field.type === 'url' ? 'https://' : null,
        oninput: (e) => writePath(path, e.target.value)
    });
    el.value = value;
    return el;
}

function imageSlot(field, path, disabled) {
    const id = `f-${path}`;
    const value = readPath(path) || '';
    const input = h('input', {
        id, type: 'file', accept: 'image/*', class: 'visually-hidden', disabled,
        onchange: (e) => uploadImage(e.target, path)
    });
    return h('div', { class: 'image-slot' },
        value
            ? h('img', { class: 'image-thumb', src: imageUrl(value), alt: '', loading: 'lazy' })
            : h('div', { class: 'image-thumb blank', text: 'No image' }),
        h('div', { class: 'image-meta' },
            h('p', { class: 'image-path', text: value || 'No image chosen yet.' }),
            h('div', { class: 'image-actions' },
                h('label', { class: `btn secondary file-btn`, 'aria-disabled': disabled ? 'true' : null },
                    value ? 'Replace image' : 'Choose image', input),
                value && !field.required && h('button', {
                    type: 'button', class: 'btn quiet danger', disabled,
                    onclick: () => { writePath(path, ''); renderSection(); }
                }, 'Remove')
            )
        )
    );
}

async function uploadImage(input, path) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
        input.value = '';
        return toast('That image is too large. Please use one under 5 MB.', 'bad');
    }
    const form = new FormData();
    form.append('file', file);
    form.append('section', state.view);
    form.append('field', path);
    toast('Uploading image…');
    try {
        const saved = await api('media', { method: 'POST', form });
        writePath(path, saved.path);
        delete state.errors[path];
        renderSection();
        toast('Image added. Save as draft to keep it.', 'good');
    } catch (err) {
        input.value = '';
        toast(err.message, 'bad');
    }
}

function fieldRow(field, path, disabled) {
    const id = `f-${path}`;
    const error = state.errors[path];
    const wide = field.type === 'textarea' || field.type === 'image';
    const label = field.type === 'image'
        ? h('p', { class: 'field-label' }, field.label, field.required && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *'))
        : h('label', { for: id }, field.label, field.required && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *'));
    return h('div', { class: `field${wide ? ' wide' : ''}${error ? ' invalid' : ''}` },
        label,
        fieldControl(field, path, disabled),
        h('p', { class: 'help', id: `${id}-help`, text: field.help || '' , hidden: !field.help }),
        h('p', { class: 'error', id: `${id}-error`, text: error || '', hidden: !error })
    );
}

function listGroup(group, disabled) {
    const items = state.working[group.key];
    const move = (from, to) => {
        const [moved] = items.splice(from, 1);
        items.splice(to, 0, moved);
        state.errors = {};
        markDirty();
        renderSection();
    };
    const rows = items.map((item, i) => h('div', { class: 'item' },
        h('div', { class: 'item-head' },
            h('p', { class: 'item-title', text: `${group.itemLabel} ${i + 1}${item[group.titleField] ? ': ' + item[group.titleField] : ''}` }),
            !disabled && h('div', { class: 'item-tools' },
                h('button', { type: 'button', class: 'btn quiet', disabled: i === 0, 'aria-label': `Move ${group.itemLabel} ${i + 1} up`, onclick: () => move(i, i - 1) }, '↑ Up'),
                h('button', { type: 'button', class: 'btn quiet', disabled: i === items.length - 1, 'aria-label': `Move ${group.itemLabel} ${i + 1} down`, onclick: () => move(i, i + 1) }, '↓ Down'),
                h('button', {
                    type: 'button', class: 'btn quiet danger', 'aria-label': `Remove ${group.itemLabel} ${i + 1}`,
                    onclick: () => {
                        if (!confirm(`Remove this ${group.itemLabel.toLowerCase()}?`)) return;
                        items.splice(i, 1);
                        state.errors = {};
                        markDirty();
                        renderSection();
                    }
                }, 'Remove')
            )
        ),
        h('div', { class: 'fields' }, group.fields.map((f) => fieldRow(f, `${group.key}[${i}].${f.key}`, disabled)))
    ));

    const full = group.max && items.length >= group.max;
    return [
        items.length === 0 && h('p', { class: 'empty', text: 'Nothing here yet.' }),
        ...rows,
        !disabled && h('button', {
            type: 'button', class: 'btn secondary list-add', disabled: full,
            onclick: () => {
                items.push(blankItem(group));
                markDirty();
                renderSection();
                const first = document.getElementById(`f-${group.key}[${items.length - 1}].${group.fields[0].key}`);
                if (first) first.focus();
            }
        }, full ? `Limit of ${group.max} reached` : `+ Add ${group.itemLabel.toLowerCase()}`)
    ];
}

function renderSection() {
    const key = state.view;
    const def = SECTIONS[key];
    const s = current();
    const disabled = !s.canEdit;

    const form = h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); saveDraft(); } },
        def.groups.map((group) => h('fieldset', { class: 'card' },
            h('legend', { text: group.label }),
            group.help && h('p', { class: 'card-help', text: group.help }),
            group.list
                ? h('div', {}, listGroup(group, disabled))
                : h('div', { class: 'fields' }, group.fields.map((f) => fieldRow(f, `${group.key}.${f.key}`, disabled)))
        ))
    );

    mount($('main'),
        h('div', { class: 'page-head' },
            h('p', { class: 'page-label', text: 'Edit section' }),
            h('h1', { class: 'page-title', text: def.label }),
            h('p', { class: 'page-desc', text: def.description }),
            h('div', { class: 'page-links' },
                h('a', { class: 'link', href: `${SITE}?preview=published`, target: '_blank', rel: 'noopener', text: 'View published version' }),
                s.draft && s.canEdit && h('button', { type: 'button', class: 'btn quiet danger', onclick: discardDraft }, 'Discard draft')
            )
        ),
        disabled && h('p', { class: 'notice', text: 'Only an administrator can change this section. You can look, but not edit.' }),
        form,
        h('div', { class: 'actionbar', id: 'actionbar' })
    );
    renderActionBar();
}

function renderActionBar() {
    const bar = $('actionbar');
    if (!bar) return;
    const s = current();
    const status = state.dirty ? 'draft' : s.status;
    const reviewed = s.status === 'reviewed' && !state.dirty;

    let hint;
    if (!s.canEdit) hint = 'View only.';
    else if (state.dirty) hint = 'Unsaved changes. Save as draft to keep them.';
    else if (!s.draft) hint = 'No changes waiting. This matches the published site.';
    else if (!reviewed) hint = `Draft saved ${when(s.draft.updatedAt)} by ${s.draft.updatedBy}. Mark it reviewed before publishing.`;
    else if (!can('publish')) hint = `Reviewed by ${s.draft.reviewed.by}. An administrator can now publish it.`;
    else hint = `Reviewed by ${s.draft.reviewed.by}. Ready to publish.`;

    const publishWhy = !can('publish') ? 'Only an administrator can publish.'
        : state.dirty ? 'Save your changes first.'
        : !s.draft ? 'There is no draft to publish.'
        : !reviewed ? 'Mark the draft as reviewed first.' : '';

    mount(bar,
        h('div', { class: 'actionbar-status' },
            h('span', { class: `status ${status}`, text: state.dirty ? 'Unsaved' : STATUS_LABEL[status] }),
            h('span', { class: 'hint', text: hint })
        ),
        h('div', { class: 'actionbar-buttons' },
            h('button', {
                type: 'button', class: 'btn', id: 'btn-save',
                disabled: !s.canEdit || !state.dirty || state.busy, onclick: saveDraft
            }, 'Save as draft'),
            h('button', { type: 'button', class: 'btn secondary', id: 'btn-preview', disabled: state.busy, onclick: preview }, 'Preview'),
            h('button', {
                type: 'button', class: 'btn secondary', id: 'btn-review', 'aria-pressed': String(reviewed),
                disabled: !s.canEdit || !can('draft:review') || !s.draft || state.dirty || state.busy,
                onclick: () => setReviewed(!reviewed)
            }, reviewed ? 'Reviewed ✓' : 'Mark reviewed'),
            h('button', {
                type: 'button', class: 'btn gold', id: 'btn-publish',
                disabled: Boolean(publishWhy) || state.busy, title: publishWhy || 'Publish this section', onclick: publish
            }, 'Publish')
        )
    );
}

function applyResult(result) {
    const s = current();
    s.draft = result.draft;
    s.status = result.status;
}

async function withBusy(fn) {
    if (state.busy) return false;
    state.busy = true;
    renderActionBar();
    try {
        await fn();
        return true;
    } catch (err) {
        if (err.status === 422 && err.data?.errors) {
            state.errors = Object.fromEntries(err.data.errors.map((e) => [e.path, e.message]));
            state.busy = false;
            renderSection();
            const first = document.querySelector('.field.invalid');
            if (first) first.scrollIntoView({ block: 'center' });
        }
        toast(err.message, 'bad');
        return false;
    } finally {
        state.busy = false;
        renderActionBar();
    }
}

async function saveDraft() {
    const s = current();
    if (!s.canEdit || !state.dirty) return true;
    return withBusy(async () => {
        const result = await api(`draft/${state.view}`, {
            method: 'PUT',
            body: { data: state.working, baseRev: s.draft ? s.draft.rev : 0 }
        });
        applyResult(result);
        state.dirty = false;
        state.errors = {};
        state.working = clone(s.draft ? s.draft.data : s.published);
        renderNav();
        renderSection();
        toast(result.status === 'published' ? 'No differences from the published site.' : 'Draft saved.', 'good');
    });
}

async function preview() {
    // Open the tab during the tap itself so mobile browsers do not block it.
    const tab = window.open('', '_blank');
    const ok = await saveDraft();
    if (!ok) {
        if (tab) tab.close();
        return;
    }
    const url = new URL(`${SITE}?preview=draft`, location.href).href;
    if (tab) tab.location.replace(url);
    else location.assign(url);
}

async function setReviewed(reviewed) {
    await withBusy(async () => {
        applyResult(await api(`draft/${state.view}/review`, { method: 'POST', body: { reviewed } }));
        renderNav();
        toast(reviewed ? 'Marked as reviewed.' : 'Review mark removed.', 'good');
    });
}

async function publish() {
    const label = SECTIONS[state.view].label;
    if (!confirm(`Publish the reviewed ${label} draft?`)) return;
    await withBusy(async () => {
        const result = await api(`publish/${state.view}`, { method: 'POST', body: {} });
        await loadContent();
        state.working = clone(current().published);
        renderNav();
        renderSection();
        toast(result.publish.delivery.mode === 'local'
            ? `${label} published to the local preview store. See Activity log for the bundle.`
            : `${label} publish recorded.`, 'good');
    });
}

async function discardDraft() {
    if (!confirm('Discard this draft and go back to the published version?')) return;
    await withBusy(async () => {
        applyResult(await api(`draft/${state.view}`, { method: 'DELETE' }));
        state.dirty = false;
        state.errors = {};
        state.working = clone(current().published);
        renderNav();
        renderSection();
        toast('Draft discarded.', 'good');
    });
}

// ── Activity (audit log + publish history) ──────────────────────────────────

const short = (value) => {
    const s = String(value ?? '');
    return s.length > 280 ? `${s.slice(0, 280)}…` : s;
};

function auditValue(value, kind) {
    return value === '' || value === null || value === undefined
        ? h('span', { class: 'audit-none', text: '(empty)' })
        : h('span', { class: `audit-value ${kind}`, text: short(value) });
}

function renderActivity() {
    const { entries, cursor, section } = state.audit;
    const filter = h('select', { id: 'audit-section', onchange: (e) => { state.audit.section = e.target.value; loadActivity(true); } },
        h('option', { value: '', text: 'All sections', selected: section === '' }),
        SECTION_ORDER.map((k) => h('option', { value: k, text: SECTIONS[k].label, selected: section === k })));

    mount($('main'),
        h('div', { class: 'page-head' },
            h('p', { class: 'page-label', text: 'History' }),
            h('h1', { class: 'page-title', text: 'Activity log' }),
            h('p', { class: 'page-desc', text: 'Every edit, review, upload and publish: who did it, when, and what changed.' })
        ),
        h('section', { class: 'card' },
            h('h2', { class: 'card-title', text: 'Publishes' }),
            h('div', { style: 'clear:both' },
                state.publishes.length === 0 && h('p', { class: 'empty', text: 'Nothing has been published from this admin yet.' }),
                state.publishes.map((p) => h('div', { class: 'publish-row' },
                    h('div', { class: 'publish-info' },
                        h('strong', { text: `${SECTIONS[p.section]?.label || p.section}: ${p.changeCount} field${p.changeCount === 1 ? '' : 's'} changed` }),
                        h('small', { text: `${when(p.createdAt)} by ${p.createdBy}. Reviewed by ${p.reviewedBy}.` }),
                        h('small', { text: p.delivery?.note || '' })
                    ),
                    can('publish') && h('a', {
                        class: 'btn secondary', href: `${API}publishes/${encodeURIComponent(p.id)}/bundle`, download: `${p.id}.json`
                    }, 'Download bundle')
                ))
            )
        ),
        h('div', { class: 'toolbar' },
            h('div', { class: 'field' }, h('label', { for: 'audit-section', text: 'Show changes for' }), filter)
        ),
        h('div', { class: 'audit-head', 'aria-hidden': 'true' },
            ...['When', 'Who', 'Action', 'Section / field', 'Old value', 'New value'].map((t) => h('span', { text: t }))),
        entries.length === 0
            ? h('p', { class: 'empty', text: 'No activity recorded yet.' })
            : h('ol', { class: 'audit-list' }, entries.map((e) => h('li', { class: 'audit-entry' },
                h('div', { class: 'audit-cell', 'data-label': 'When', text: when(e.at) }),
                h('div', { class: 'audit-cell', 'data-label': 'Who', text: `${e.who} (${e.role})` }),
                h('div', { class: 'audit-cell audit-action', 'data-label': 'Action', text: e.action }),
                h('div', { class: 'audit-cell', 'data-label': 'Section / field', text: `${SECTIONS[e.section]?.label || e.section} / ${e.field}` }),
                h('div', { class: 'audit-cell', 'data-label': 'Old value' }, auditValue(e.old, 'old')),
                h('div', { class: 'audit-cell', 'data-label': 'New value' }, auditValue(e.new, 'new'))
            ))),
        cursor && h('p', { style: 'margin:1rem 0' },
            h('button', { type: 'button', class: 'btn secondary', onclick: () => loadActivity(false) }, 'Load older activity')),
        h('div', { style: 'height:2rem' })
    );
}

async function loadActivity(reset) {
    try {
        const q = new URLSearchParams({ limit: '50' });
        if (state.audit.section) q.set('section', state.audit.section);
        if (!reset && state.audit.cursor) q.set('cursor', state.audit.cursor);
        const [page, pubs] = await Promise.all([
            api(`audit?${q}`),
            reset ? api('publishes') : Promise.resolve(null)
        ]);
        state.audit.entries = reset ? page.entries : state.audit.entries.concat(page.entries);
        state.audit.cursor = page.cursor;
        if (pubs) state.publishes = pubs.publishes;
        if (state.view === 'activity') renderActivity();
    } catch (err) {
        toast(err.message, 'bad');
    }
}

// ── Wiring ──────────────────────────────────────────────────────────────────

$('sections-toggle').addEventListener('click', () => {
    setMenu(!$('sections-list').classList.contains('open'));
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setMenu(false);
});

window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
    }
});

start();
