# Live Snapshot Rollback Notes

This directory preserves the live Snow Hill site state that was deployed before repo synchronization work.

## Snapshot

- File: `live-2026-04-11-index.html`
- Captured: 2026-04-11
- Source: `https://snowhillmbc.com`
- Cloudflare Pages deployment: `834e64d9-ffa2-4069-bf46-7748c8eb2d3d`
- Deployment created on: 2026-04-09T05:13:49.854872Z

## Why this exists

The live site was ahead of the tracked git repo because production had been deployed ad hoc from a dirty working copy instead of from the repository's `main` branch.

This snapshot gives you a rollback reference for the exact homepage that was live before the repo was brought back in sync.

## Rollback

If you need to restore the homepage to this exact state:

1. Copy `snapshots/live-2026-04-11-index.html` over `index.html`
2. Commit the change
3. Push to the production branch that Cloudflare Pages deploys from
4. Trigger or wait for the next production deploy

## Follow-up

After the repo is synced, GitHub `main` should become the source of truth for production so future live changes are recoverable from git history instead of ad hoc snapshots.
