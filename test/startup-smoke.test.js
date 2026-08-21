import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = new URL('../', import.meta.url);

async function assertFileExists(url, label) {
    await assert.doesNotReject(access(url), `${label} should resolve to ${fileURLToPath(url)}`);
}

test('browser entry module graph and local shell resources resolve from a static server', async () => {
    const pendingModules = [new URL('main.js', repositoryRoot)];
    const visitedModules = new Set();

    while (pendingModules.length > 0) {
        const moduleUrl = pendingModules.pop();
        if (visitedModules.has(moduleUrl.href)) continue;
        visitedModules.add(moduleUrl.href);
        const source = await readFile(moduleUrl, 'utf8');
        const imports = source.matchAll(/(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](\.[^'"]+)['"]/g);
        for (const [, specifier] of imports) {
            const dependencyUrl = new URL(specifier, moduleUrl);
            await assertFileExists(dependencyUrl, `module ${specifier}`);
            pendingModules.push(dependencyUrl);
        }
    }

    const html = await readFile(new URL('index.html', repositoryRoot), 'utf8');
    assert.match(html, /<script type="module" src="main\.js"><\/script>/);

    const localShellResources = [
        ...html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="(?!https?:\/\/)([^"#?]+)"/g)
    ].map(([, resource]) => resource);
    for (const resource of localShellResources) {
        await assertFileExists(new URL(resource, repositoryRoot), `shell resource ${resource}`);
    }

    for (const asset of [
        'assets/player_ship.webp',
        'assets/asteroid.webp',
        'assets/projectile.webp',
        'assets/space_background.webp'
    ]) {
        await assertFileExists(new URL(`public/${asset}`, repositoryRoot), `core asset ${asset}`);
    }
});
