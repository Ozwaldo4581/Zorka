import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { GAME_MODE, Game, WORLD_HEIGHT, WORLD_WIDTH } from '../game.js';
import { Player } from '../entities/player.js';
import { createExperimentalRooms } from '../world/experimental_rooms.js';
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
        initializeExperimentalWorldState() {
            calls.push('initialize-world');
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
        ['spawn-players', GAME_MODE.SOLO, 2],
        'initialize-world'
    ]);
});

test('Experimental world-loop reset retains the human and persistent progression', t => {
    const human = Object.assign(new Player(10, 20, 1), {
        name: 'Veteran', level: 6, totalXP: 777, pendingLevelUps: 2,
        projectileUpgradeCount: 2, speedUpgradeCount: 1, shieldRechargeUpgradeCount: 1,
        maxShieldCharges: 9, deaths: 4, experimentalWorldResetPending: true
    });
    const game = {
        gameState: GAME_MODE.EXPERIMENTAL,
        players: [human, Object.assign(new Player(30, 40, 2), { isNPC: true })]
    };
    const progressionBefore = human.getPersistentProgressionSnapshot();
    let initialized = 0;
    t.mock.method(Game.prototype, 'initializeExperimentalWorldState', function () {
        initialized++;
        this.players = this.players.filter(player => !player.isNPC);
    });

    assert.equal(Game.prototype.resetExperimentalWorldLoop.call(game, human), true);
    assert.equal(initialized, 1);
    assert.deepEqual(game.players, [human]);
    assert.deepEqual(human.getPersistentProgressionSnapshot(), progressionBefore);
    assert.equal(human.experimentalWorldResetPending, false);
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
    assert.equal(game.experimentalRooms.length, 20);
    assert.equal(game.experimentalRooms.filter(area => area.roomNumber === 0).length, 11);
    assert.equal(game.experimentalDoors.length, 22);
    Game.prototype.clearExperimentalState.call(game);
    Game.prototype.initializeExperimentalRooms.call(game);
    assert.equal(game.experimentalRooms.length, 20);
    assert.equal(game.experimentalDoors.length, 22);
    assert.equal(game.experimentalRoomPopulations.size, 9);
    const sector9 = game.experimentalRooms.find(area => area.roomNumber === 9);
    assert.equal(sector9.ordinaryNPCsAllowed, false);
    assert.equal(sector9.specialEncounterNPCsAllowed, true);
    assert.equal(sector9.isPopulationEligible, true);
});

test('Experimental setup creates BBG-only Sector 9 NPC population', () => {
    const rooms = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);
    const human = new Player(0, 0, 1);
    const game = {
        gameState: GAME_MODE.EXPERIMENTAL,
        experimentalRooms: rooms,
        experimentalAreaIndexes: new Map(rooms.map(area => [area.id, {
            players: new Set(), asteroids: new Set(), hazards: new Set(), projectiles: new Set(), vfx: new Set()
        }])),
        players: [human],
        asteroids: [], hazards: [], projectiles: [],
        asteroidDensityLevel: 0, debrisDensityLevel: 0, satelliteDensityLevel: 0,
        experimentalNewGamePlusCycle: 0,
        botAggressionLevel: 1,
        sector9BBGEncounter: Game.prototype.createSector9BBGEncounterState(),
        configurePlayerShields() {},
        spawnAsteroid() {},
        spawnSpaceDebris() {},
        spawnSatellite() {},
        findExperimentalSpawn: Game.prototype.findExperimentalSpawn
    };

    Game.prototype.setupExperimentalPopulations.call(game);

    const sector9 = rooms.find(room => room.roomNumber === 9);
    const sector9Npcs = game.players.filter(player => player.isNPC && player.roomId === sector9.id);
    assert.equal(sector9Npcs.length, 7);
    assert.equal(sector9Npcs.every(player => Game.prototype.isSector9BBGDefender.call(game, player)), true);
    assert.equal(sector9Npcs.every(player => player.aggressionLevel === 2), true);
    for (const roomNumber of [1, 2, 8]) {
        const room = rooms.find(candidate => candidate.roomNumber === roomNumber);
        const ordinaryNpcs = game.players.filter(player => player.isNPC && !Game.prototype.isSector9BBGDefender.call(game, player) && player.roomId === room.id);
        assert.equal(ordinaryNpcs.length, room.npcCount);
        assert.equal(ordinaryNpcs.every(player => player.aggressionLevel === game.botAggressionLevel), true);
    }

    game.botAggressionLevel = 5;
    assert.equal(Game.prototype.resetSector9BBGEncounterForCurrentWorld.call(game), true);
    const resetSector9Npcs = game.players.filter(player => player.isNPC && player.roomId === sector9.id);
    assert.equal(resetSector9Npcs.length, 7);
    assert.equal(resetSector9Npcs.every(player => player.aggressionLevel === 2), true);

    game.experimentalNewGamePlusCycle = 1;
    assert.equal(Game.prototype.resetSector9BBGEncounterForCurrentWorld.call(game), true);
    const newGamePlusSector9Npcs = game.players.filter(player => player.isNPC && player.roomId === sector9.id);
    assert.equal(newGamePlusSector9Npcs.length, 7);
    assert.equal(newGamePlusSector9Npcs.every(player => player.aggressionLevel === 2), true);
    assert.equal(newGamePlusSector9Npcs.every(player => player.level > sector9Npcs[0].level), true);
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
