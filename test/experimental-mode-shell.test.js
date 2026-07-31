import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { GAME_MODE, Game, WORLD_HEIGHT, WORLD_WIDTH } from '../game.js';
import { wrap } from '../physics.js';

test('Experimental has an explicit mode identifier and separate screen controls', async () => {
    assert.equal(GAME_MODE.EXPERIMENTAL, 'EXPERIMENTAL');

    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    for (const id of ['btn-experimental-open', 'experimental-menu', 'btn-experimental-start', 'btn-experimental-back']) {
        assert.match(html, new RegExp(`id=["']${id}["']`));
    }
    assert.match(html, /Solo Arena, Local PvP Arena, or Arcade Mode/);
});

test('Experimental temporary state is cleared without assigning rooms to base entities', () => {
    const basePlayer = { id: 1 };
    const game = {
        experimentalRooms: [{ id: 'temporary-room' }],
        experimentalRoomAssignments: new Map([[basePlayer, 'temporary-room']]),
        experimentalCameraState: { roomId: 'temporary-room' }
    };

    Game.prototype.clearExperimentalState.call(game);

    assert.deepEqual(game.experimentalRooms, []);
    assert.equal(game.experimentalRoomAssignments.size, 0);
    assert.equal(game.experimentalCameraState, null);
    assert.equal('roomId' in basePlayer, false);
});

test('Experimental setup uses its dedicated state while reusing the unchanged Solo entity setup', () => {
    const calls = [];
    const game = {
        clearExperimentalState() {
            calls.push('clear-experimental');
            this.experimentalRooms = [];
        },
        initializeExperimentalRooms() {
            calls.push('initialize-rooms');
            this.experimentalRooms = [{ id: 'experimental-room-1' }];
        },
        spawnPlayers(mode, count) {
            calls.push(['spawn-players', mode, count]);
            this.gameState = mode;
        },
        spawnInitialAsteroids() {
            calls.push('spawn-asteroids');
        }
    };

    Game.prototype.setupExperimentalMatch.call(game);

    assert.equal(game.gameState, GAME_MODE.EXPERIMENTAL);
    assert.deepEqual(game.experimentalRooms, [{ id: 'experimental-room-1' }]);
    assert.deepEqual(calls, [
        'clear-experimental',
        'initialize-rooms',
        ['spawn-players', GAME_MODE.SOLO, 2],
        'spawn-asteroids'
    ]);
});

test('base world dimensions and wrapping remain unchanged by the mode shell', () => {
    assert.equal(WORLD_WIDTH, 17280);
    assert.equal(WORLD_HEIGHT, 9720);

    const entity = { x: WORLD_WIDTH + 10, y: -10 };
    wrap(entity);
    assert.deepEqual(entity, { x: 10, y: WORLD_HEIGHT - 10 });
});
