#!/usr/bin/env node
// Re-bakes index.html from content/*.json so the static copy matches the content files.
// Usage: node scripts/bake.mjs          (rewrite index.html)
//        node scripts/bake.mjs --check  (exit 1 if index.html is out of date)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderSite } from '../cms/render.js';
import { SECTION_ORDER } from '../cms/schema.js';

const root = new URL('../', import.meta.url);

export async function loadRepoContent() {
    const content = {};
    for (const key of SECTION_ORDER) {
        content[key] = JSON.parse(await readFile(new URL(`content/${key}.json`, root), 'utf8'));
    }
    return content;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const file = new URL('index.html', root);
    const before = await readFile(file, 'utf8');
    const after = renderSite(before, await loadRepoContent());
    if (process.argv.includes('--check')) {
        if (before !== after) {
            console.error('index.html is out of date with content/*.json. Run: npm run bake');
            process.exit(1);
        }
        console.log('index.html matches content/*.json');
    } else {
        await writeFile(file, after);
        console.log(before === after ? 'index.html already up to date' : 'index.html re-baked from content/*.json');
    }
}
