import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { GAME_MODE, Game, WORLD_HEIGHT, WORLD_WIDTH } from '../game.js';
import { Player } from '../entities/player.js';
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
        experimentalDoors: [{ id: 'temporary-door' }],
        experimentalRoomPopulations: new Map([['temporary-room', { desired: {} }]]),
        experimentalSessionId: 4,
        experimentalRoomAssignments: new Map([[basePlayer, 'temporary-room']]),
        experimentalCameraState: { roomId: 'temporary-room' }
    };

    Game.prototype.clearExperimentalState.call(game);

    assert.deepEqual(game.experimentalRooms, []);
    assert.deepEqual(game.experimentalDoors, []);
    assert.equal(game.experimentalRoomPopulations.size, 0);
    assert.equal(game.experimentalSessionId, 5);
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
            this.experimentalRooms = [{ id: 'experimental-room-1', npcCount: 1 }];
        },
        spawnPlayers(mode, count) {
            calls.push(['spawn-players', mode, count]);
            this.gameState = mode;
        },
        setupExperimentalPopulations() {
            calls.push('setup-room-populations');
        }
    };

    Game.prototype.setupExperimentalMatch.call(game);

    assert.equal(game.gameState, GAME_MODE.EXPERIMENTAL);
    assert.deepEqual(game.experimentalRooms, [{ id: 'experimental-room-1', npcCount: 1 }]);
    assert.deepEqual(calls, [
        'clear-experimental',
        'initialize-rooms',
        ['spawn-players', GAME_MODE.SOLO, 2],
        'setup-room-populations'
    ]);
});

test('base world dimensions and wrapping remain unchanged by the mode shell', () => {
    assert.equal(WORLD_WIDTH, 17280);
    assert.equal(WORLD_HEIGHT, 9720);

    const entity = { x: WORLD_WIDTH + 10, y: -10 };
    wrap(entity);
    assert.deepEqual(entity, { x: 10, y: WORLD_HEIGHT - 10 });
});

test('Experimental cleanup invalidates pending room-local replacements', t => {
    let pendingReplacement;
    t.mock.method(globalThis, 'setTimeout', callback => { pendingReplacement = callback; return 1; });
    let spawned = false;
    const game = {
        gameState: GAME_MODE.EXPERIMENTAL,
        experimentalSessionId: 9,
        experimentalRooms: [{ id: 'experimental-room-2' }],
        experimentalRoomPopulations: new Map([['experimental-room-2', {
            desired: { asteroids: 1, debris: 0, satellites: 0 }
        }]]),
        asteroids: [],
        hazards: [],
        players: [],
        projectiles: []
    };
    Game.prototype.scheduleEnvironmentReplacement.call(
        game, 1, 'experimental-room-2', 'asteroids', () => { spawned = true; }
    );
    Game.prototype.clearExperimentalState.call(game);
    game.gameState = GAME_MODE.SOLO;
    pendingReplacement();
    assert.equal(spawned, false);
    assert.equal(game.experimentalSessionId, 10);
});

test('Experimental room and door state re-entry initializes one clean layout', () => {
    const game = {
        asteroidDensityLevel: 1,
        debrisDensityLevel: 1,
        satelliteDensityLevel: 1,
        players: [], asteroids: [], hazards: [], projectiles: []
    };
    Game.prototype.initializeExperimentalRooms.call(game);
    assert.deepEqual(game.experimentalRooms.map(room => room.id), Array.from({ length: 9 }, (_, index) => `experimental-room-${index + 1}`));
    assert.deepEqual(game.experimentalDoors.map(door => door.id), Array.from({ length: 8 }, (_, index) => `experimental-door-${index + 1}-${index + 2}`));
    Game.prototype.clearExperimentalState.call(game);
    Game.prototype.initializeExperimentalRooms.call(game);
    assert.equal(game.experimentalRooms.length, 9);
    assert.equal(game.experimentalDoors.length, 8);
    assert.equal(game.experimentalRoomPopulations.size, 9);
});

test('Experimental cleanup clears room-local NPC intent', () => {
    const target = new Player(100, 100, 1);
    const npc = new Player(200, 200, 3);
    npc.isNPC = true;
    npc.roomId = 'experimental-room-1';
    npc.npcTarget = target;
    npc.shouldFire = true;
    const game = {
        players: [target, npc], asteroids: [], hazards: [], projectiles: [],
        experimentalRooms: [], experimentalDoors: [], experimentalRoomPopulations: new Map()
    };
    Game.prototype.clearExperimentalState.call(game);
    assert.equal(npc.npcTarget, null);
    assert.equal(npc.shouldFire, false);
    assert.equal('roomId' in npc, false);
});
