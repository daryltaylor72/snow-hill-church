// Where a publish goes.
//
// PREVIEW (default, and the only mode that does anything today):
//   The bundle is kept in the local "published" store and can be downloaded
//   from the Activity screen, then applied to a working copy with
//   `npm run apply-publish -- <bundle.json>`. Nothing leaves this machine.
//
// PRODUCTION DESIGN (stub, not wired up, makes no network calls):
//   With PUBLISH_MODE=github the publisher would open a pull request so Ship can
//   review and merge. See ADMIN.md, "Production publish flow". The stub below
//   only describes the requests it would make.

export function localPublisher() {
    return {
        mode: 'local',
        async publish(bundle) {
            return {
                mode: 'local',
                status: 'stored',
                note: 'Saved to the local published store. Download the bundle to hand it to Ship.',
                files: bundle.files.map((f) => f.path).concat(bundle.media)
            };
        }
    };
}

export function githubPublisherStub(env = {}) {
    const repo = env.GITHUB_REPO || 'daryltaylor72/snow-hill-church';
    const base = env.GITHUB_BASE_BRANCH || 'main';
    return {
        mode: 'github-stub',
        async publish(bundle) {
            // Intentionally no fetch() here. This is the plan a real implementation follows.
            const paths = bundle.files.map((f) => f.path).concat(bundle.media);
            return {
                mode: 'github-stub',
                status: 'not-sent',
                note: 'GitHub publishing is designed but not implemented. No request was made.',
                wouldDo: [
                    `GET  /repos/${repo}/git/ref/heads/${base}  (find the commit to branch from)`,
                    `POST /repos/${repo}/git/refs  (create branch ${bundle.branch})`,
                    ...paths.map((p) => `PUT  /repos/${repo}/contents/${p}  (commit on ${bundle.branch})`),
                    `POST /repos/${repo}/pulls  (open PR "${bundle.message}" into ${base} for Ship to review and merge)`
                ]
            };
        }
    };
}

export function selectPublisher(env = {}) {
    return env.PUBLISH_MODE === 'github' ? githubPublisherStub(env) : localPublisher();
}
