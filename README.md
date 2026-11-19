# Snow Hill Missionary Baptist Church website

Static site for Snow Hill Missionary Baptist Church, Roseboro, NC, plus a preview build of a site admin panel.

- Public page: `index.html`, with its editable text and photos coming from `content/*.json`.
- Admin panel (preview only, not deployed): `/admin`. Full details in [ADMIN.md](ADMIN.md).

## Run the local preview

Requires Node 20 or newer. No install step: there are no npm dependencies.

```sh
cp .dev.vars.example .dev.vars        # first time only
npx wrangler pages dev . --port 8788
```

Then open:

| What | Address |
| --- | --- |
| Public site | http://localhost:8788/ |
| Admin panel | http://localhost:8788/admin/ |
| Site with drafts applied | http://localhost:8788/?preview=draft |

Everything runs on your machine. Drafts, the activity log, uploads and the local "published" store live in `.wrangler/state/` (git-ignored). Delete that folder to start fresh.

To try it on a phone, put an HTTPS tunnel (with a basic-auth proxy in front) on port 8788. The admin uses relative addresses only, so it works on any hostname. It must be HTTPS: the site's security headers upgrade plain-HTTP requests on any host other than `localhost`.

## Tests

```sh
npm test
```

Node's built-in test runner, no network. Covers role checks, the draft, reviewed, publish gate, audit log writes, and that `index.html` matches `content/*.json`.

## Editing content by hand

Edit a file in `content/`, then run `npm run bake` to refresh the copy baked into `index.html`. `npm test` fails if the two are out of step.
