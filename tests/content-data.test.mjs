import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildContentData } from '../scripts/gen-content-data.mjs';
import { repoContent } from '../cms/context.js';

test('cms/content-data.js matches content/*.json (run npm run gen-content if this fails)', async () => {
    const current = await readFile(new URL('../cms/content-data.js', import.meta.url), 'utf8');
    assert.equal(current, await buildContentData());
});

test('repoContent from the generated module equals the JSON files', async () => {
    for (const key of Object.keys(repoContent)) {
        const json = JSON.parse(await readFile(new URL(`../content/${key}.json`, import.meta.url), 'utf8'));
        assert.deepEqual(repoContent[key], json, key);
    }
});
