# Site admin panel: preview build

Status: **local preview only.** Nothing here is deployed, and nothing in this build can change the live site, GitHub, or Cloudflare.

## What it is

A small admin at `/admin` where church staff edit the website's words and photos without touching code.

- **Sections:** Home, Services, Events, Staff, Media, plus Navigation (administrators only) and an Activity log.
- **Buttons:** Save as draft, Preview, Mark reviewed, Publish.
- **Preview** opens the real site in a new tab with the saved drafts applied (`/?preview=draft`).
- **Publish** is enabled only for an administrator, and only once the current draft has been marked Reviewed.

## Run it

```sh
cp .dev.vars.example .dev.vars        # first time only
npx wrangler pages dev . --port 8788
```

Open http://localhost:8788/admin/. Run the tests with `npm test`.

## Roles

Roles come from an email allowlist in environment variables. The preview uses placeholder addresses from `.dev.vars`.

| Variable | Role | Can do |
| --- | --- | --- |
| `PASTOR_EMAILS` | pastor | Edit announcements, events and all other content drafts; upload photos; mark drafts reviewed; see the activity log |
| `ADMIN_EMAILS` | admin | Everything a pastor can, plus change navigation and publish |

Anyone not on either list gets a "No access" screen and every API call is refused. If an email is on both lists, admin wins. Checks are enforced on the server (`cms/workflow.js`); the page only hides or disables what the server would refuse anyway.

### Who is signed in

- **Production design:** the admin sits behind Cloudflare Access. The code reads `Cf-Access-Authenticated-User-Email`. If `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set, it also verifies the signed `Cf-Access-Jwt-Assertion` token and requires its email to match, so a hand-written header is not enough.
- **Local preview (dev mode):** with `ADMIN_DEV=1` in `.dev.vars`, identity is simulated. The yellow "Local preview" bar has a role switcher (admin, pastor, not on the list). It sets a cookie; an `X-Dev-User-Email` header also works for scripts.

The dev switcher cannot be used in production mode:

1. It needs `ADMIN_DEV=1`, which lives only in `.dev.vars`. Cloudflare does not deploy that file, and it is git-ignored.
2. Any request that arrives through Cloudflare Access is treated as production even if the flag is set. The dev header and cookie are ignored and the switcher endpoint returns 404.
3. Without the flag, the server never reports dev mode, so the page never shows the switcher.

**Never set `ADMIN_DEV` in the Cloudflare dashboard.**

## Draft, review, publish

Each section moves through three states, shown as a badge next to its name.

1. **Published.** No changes waiting.
2. **Draft.** Someone saved changes. The public site is unchanged.
3. **Reviewed.** A pastor or admin marked this exact draft as reviewed.

Rules, all enforced on the server and covered by tests:

- Saving any further edit clears the Reviewed mark. The review applies to one revision only.
- Publish requires the admin role **and** a Reviewed draft.
- If two people edit the same section, the second save is refused instead of overwriting the first.
- Every field is validated. Links must be `https://` (or a page section such as `#events`); uploads must really be JPG, PNG, WebP or GIF and under 5 MB.

## Activity log

Every edit writes one entry per changed field: **who, when, section, field, old value, new value.** Reviews, publishes, discarded drafts and uploads are logged too. On a phone the log shows as stacked cards; on a desktop it is a table.

## Where things are stored

| Thing | Preview build |
| --- | --- |
| Drafts, activity log, uploads, publish history, local "published" copy | Wrangler's simulated KV (`ADMIN_KV`), on disk in `.wrangler/state/` |
| Live content | `content/*.json` in the repo |

Delete `.wrangler/state/` to wipe all preview data.

## How content reaches the page

- `content/*.json` holds the editable content, one file per section.
- `index.html` has marker comments around each editable region, for example `<!--cms:services.cards-->`. The markup between the markers is a baked copy of the content, so the page is complete even as a plain static file.
- `cms/render.js` rebuilds those regions from the content. `functions/_middleware.js` runs it on each request for `/`. If rendering ever fails it serves the baked `index.html` as is.
- `npm run bake` refreshes the baked copy after a hand edit. A test fails if `index.html` and `content/*.json` disagree.

Moving the content into data files did not change the public page: before and after screenshots at 1280, 390 and 360 pixels wide are identical pixel for pixel.

Not yet editable (still plain HTML in `index.html`): the Give section, the Contact address, phone and form, and the footer blurb. Note that the Give section mentions the 11:00 AM service time in a sentence; change it by hand if that time changes.

## Publish

### In this preview: local only

Publish does three things, all on this machine:

1. Copies the reviewed draft into the local "published" store. See it at `/?preview=published`.
2. Records a **publish bundle**: the new `content/<section>.json`, a re-baked `index.html`, and any newly uploaded photos.
3. Writes an activity log entry.

No network request is made. The public page at `/` keeps reading `content/*.json` from the repo, so it does not change.

To hand a publish to Ship, download the bundle from the Activity log (admin only) and apply it to a working copy:

```sh
npm run apply-publish -- ~/Downloads/pub-XXXX.json --dry-run   # list the files
npm run apply-publish -- ~/Downloads/pub-XXXX.json             # write them
git diff                                                        # review
npm test
```

`apply-publish` only writes files under `content/`, `images/uploads/` and `index.html`. It never runs git.

### Production design: pull request for Ship (stub, not implemented)

The intended production flow keeps Ship as the only path to the live site:

1. An admin presses Publish.
2. The server creates a branch `content/pub-<id>` from `main` and commits the bundle's files to it.
3. It opens a pull request titled with the bundle message, listing each changed field.
4. Ship reviews and merges. Cloudflare Pages deploys `main` as it does today.

`cms/publisher.js` contains this as `githubPublisherStub`, selected by `PUBLISH_MODE=github`. **It makes no network calls.** It returns the list of GitHub API requests it would make and marks the publish as not sent. A real implementation needs a fine-scoped GitHub token stored as a Pages secret, which is deliberately out of scope here.

## Phone support

Checked in Chrome at 390x844 and 360x800 with touch emulation:

- No sideways scrolling on any screen.
- The section list collapses into a menu button.
- Buttons, links and inputs are at least 44px tall; inputs use 16px text so iOS does not zoom.
- Photo slots use `accept="image/*"`, which offers the camera and photo library.
- Save, Preview, Mark reviewed and Publish sit in a bar fixed to the bottom of the screen.
- All addresses are relative, so it works on any hostname behind a proxy or tunnel. Tested through an HTTPS basic-auth proxy on a different hostname.

## Settings reference

| Variable | Where | Purpose |
| --- | --- | --- |
| `ADMIN_DEV` | `.dev.vars` only | `1` turns on simulated identity and the role switcher |
| `ADMIN_EMAILS`, `PASTOR_EMAILS` | `.dev.vars`; Pages settings later | Comma-separated allowlists |
| `ADMIN_HOSTS` | Pages settings later | If set, `/admin` and `/api/admin` answer only on these hostnames (for example `admin.snowhillmbc.com`) and return 404 elsewhere |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Pages settings later | Turn on Cloudflare Access token verification |
| `PUBLISH_MODE` | Pages settings later | `github` selects the pull request publisher (currently a stub) |
| `ADMIN_KV` | binding | Storage. Simulated locally via `wrangler.toml` |

## Files

| Path | What |
| --- | --- |
| `admin/` | The admin page (HTML, CSS, JS) |
| `cms/schema.js` | Sections, fields, validation, change detection. Shared by browser, server and tests |
| `cms/render.js` | Builds the page regions from content |
| `cms/auth.js` | Identity, roles, dev mode rules, Access token check |
| `cms/workflow.js` | Drafts, review, publish gate, activity log, uploads |
| `cms/publisher.js` | Local publisher and the GitHub stub |
| `cms/api.js` | `/api/admin/*` routes |
| `cms/context.js`, `cms/store.js` | Wiring for Pages Functions; storage keys and the in-memory test store |
| `functions/_middleware.js` | Renders `/`, serves previews, guards `/admin` |
| `functions/api/admin/[[path]].js` | Entry point for the admin API |
| `content/*.json` | Site content |
| `_routes.json` | Limits Functions to `/`, `/admin*` and `/api/*`; images and other files stay fully static |
| `wrangler.toml` | Local-only simulated KV binding |
| `scripts/bake.mjs`, `scripts/apply-publish.mjs` | Re-bake `index.html`; apply a publish bundle |
| `tests/` | `npm test` |

## Before any of this goes live (for Ship)

Nothing below has been done. These are the open items for a production rollout.

1. **`wrangler.toml` is local-only.** It has no `pages_build_output_dir`; per Cloudflare's documentation Pages then ignores the file and dashboard settings stay in charge. This was not tested against a real Pages build (no deploys were made), so confirm it on a preview branch before merging to `main`. Adding that key would make the file override dashboard bindings; do not add it without a real KV namespace ID.
2. **The repo root is the published folder.** Every file in it is publicly downloadable from the live site, including `cms/`, `tests/`, `ADMIN.md`, `wrangler.toml` and `.dev.vars.example` (as `CLAUDE.md` and `snapshots/` already are today). Nothing secret is in these files and the allowlist is kept in environment variables for this reason, but moving the site into a `public/` folder would be cleaner.
3. **The homepage now passes through a Pages Function.** `_routes.json` sends `/` to the middleware. It falls back to the static file on any error, but it is a behaviour change for the live homepage and counts against the Functions request quota.
4. **Create the real storage and settings:** a KV namespace bound as `ADMIN_KV`, the two allowlists with real addresses, `ADMIN_HOSTS`, and the Access settings. Workers KV is eventually consistent; for a busy admin, D1 would be a better home for the activity log.
5. **Put Cloudflare Access in front of the admin hostname** and set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. Without token verification the email header is trusted as is.
6. **Implement the GitHub publisher** behind `PUBLISH_MODE=github`. Until then, in production the local "published" store would drift from the repo; the preview store is meant for preview only.
7. **`.gitignore` now lists `.dev.vars` and `node_modules/`.**
