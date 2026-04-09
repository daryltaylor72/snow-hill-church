# Snow Hill Missionary Baptist Church — Site

## Overview
Static church website for Snow Hill Missionary Baptist Church, Roseboro, NC.

- **Live site:** https://snowhillmbc.com
- **GitHub repo:** https://github.com/daryltaylor72/snow-hill-church
- **Hosting:** Cloudflare Pages (auto-deploys from GitHub `main` branch)
- **Cloudflare project:** `snow-hill-church`
- **Cloudflare account ID:** `e4ee87687ff09c05630246e23d2e9d7f`

## File structure
- `index.html` — entire site (single-page, all CSS/JS inline)
- `images/` — church photos (hero, gallery)
- `functions/api/contact.js` — Cloudflare Pages Function for the contact form (uses Resend, API key set as `RESEND_API_KEY` secret in Cloudflare dashboard)

## Deploy workflow
1. Make changes to `index.html`
2. Commit: `git add index.html && git commit -m "description"`
3. Push: `git push origin main`
4. Cloudflare Pages auto-deploys within ~1 minute — no manual deploy step needed

## Important notes
- The live site has been ahead of the repo before — if the live site and local file differ, download the live version first: `curl -s https://snowhillmbc.com > index.html`
- Contact form emails go to `info@snowhillmbc.com` via Resend
- Nav links: About, Services, Pastor, Events, Give, Gallery, Contact
