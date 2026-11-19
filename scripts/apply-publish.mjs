#!/usr/bin/env node
// Applies a publish bundle (downloaded from the admin Activity log) to this
// working copy so the change can be reviewed with `git diff` and committed by Ship.
// It only writes files. It never runs git and never talks to the network.
//
// Usage: npm run apply-publish -- path/to/pub-XXXX.json [--dry-run]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED = [
    /^content\/[a-z]+\.json$/,
    /^index\.html$/,
    /^images\/uploads\/[A-Za-z0-9_-]+\.(?:jpg|png|gif|webp)$/
];

export function checkBundle(bundle) {
    if (!bundle || !Array.isArray(bundle.files) || bundle.files.length === 0) {
        throw new Error('Not a publish bundle: no files.');
    }
    for (const file of bundle.files) {
        if (typeof file.path !== 'string' || !ALLOWED.some((re) => re.test(file.path))) {
            throw new Error(`Refusing to write unexpected path: ${file.path}`);
        }
        if (!['utf8', 'base64'].includes(file.encoding) || typeof file.content !== 'string') {
            throw new Error(`Bad file entry: ${file.path}`);
        }
    }
    return bundle.files;
}

export async function applyBundle(bundle, root, { dryRun = false } = {}) {
    const base = resolve(root);
    const written = [];
    for (const file of checkBundle(bundle)) {
        const target = resolve(base, file.path);
        if (!target.startsWith(base + sep)) throw new Error(`Refusing to write outside the project: ${file.path}`);
        if (!dryRun) {
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, Buffer.from(file.content, file.encoding));
        }
        written.push(file.path);
    }
    return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const file = args.find((a) => !a.startsWith('--'));
    const dryRun = args.includes('--dry-run');
    if (!file) {
        console.error('Usage: npm run apply-publish -- path/to/pub-XXXX.json [--dry-run]');
        process.exit(2);
    }
    try {
        const bundle = JSON.parse(await readFile(file, 'utf8'));
        const root = fileURLToPath(new URL('../', import.meta.url));
        const written = await applyBundle(bundle, root, { dryRun });
        console.log(`${dryRun ? 'Would write' : 'Wrote'} ${written.length} file(s) from ${bundle.id}:`);
        for (const p of written) console.log(`  ${p}`);
        console.log(`\nSuggested commit message:\n  ${bundle.message}`);
        if (!dryRun) console.log('\nReview with `git diff`, run `npm test`, then commit. Nothing has been committed.');
    } catch (err) {
        console.error(`Could not apply bundle: ${err.message}`);
        process.exit(1);
    }
}
