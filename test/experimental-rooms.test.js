import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_MODE, Game, WORLD_HEIGHT, WORLD_WIDTH, getArenaPopulationTargets } from '../game.js';
import { Asteroid } from '../entities/asteroid.js';
import { SpaceDebris, Satellite } from '../entities/hazards.js';
import { isPointInRoom } from '../physics.js';
import {
    createExperimentalArea,
    createExperimentalDoors,
    createExperimentalRoomProgression,
    createExperimentalRooms,
    EXPERIMENTAL_AREA_TYPE,
    EXPERIMENTAL_WALL_COLLISION_THICKNESS,
    EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES,
    EXPERIMENTAL_WALL_SEPARATION_EPSILON,
    EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS
} from '../world/experimental_rooms.js';

test('Experimental area metadata separates unique identity from progression classification', () => {
    const rooms = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);
    assert.equal(rooms.length, 9);
    for (const [index, room] of rooms.entries()) {
        assert.equal(room.areaType, EXPERIMENTAL_AREA_TYPE.ROOM);
        assert.equal(room.roomNumber, index + 1);
        assert.equal(room.isPopulationEligible, true);
        assert.ok(room.population);
    }

    const hallwayBounds = { left: 0, top: WORLD_HEIGHT, right: 960, bottom: WORLD_HEIGHT + 4000 };
    const first = createExperimentalArea({
        id: 'experimental-hallway-1-2',
        areaType: EXPERIMENTAL_AREA_TYPE.HALLWAY,
        roomNumber: 0,
        bounds: hallwayBounds,
        connectedAreaIds: ['experimental-room-1', 'experimental-room-2'],
        population: { npcCount: 99 }
    });
    const second = createExperimentalArea({
        id: 'experimental-hallway-2-3',
        areaType: EXPERIMENTAL_AREA_TYPE.HALLWAY,
        roomNumber: 0,
        bounds: { left: -4000, top: WORLD_HEIGHT, right: 0, bottom: WORLD_HEIGHT + 960 }
    });

    assert.notEqual(first.id, second.id);
    assert.deepEqual([first.roomNumber, second.roomNumber], [0, 0]);
    assert.deepEqual(first.connectedAreaIds, ['experimental-room-1', 'experimental-room-2']);
    assert.equal(first.isPopulationEligible, false);
    assert.equal(first.population, null);
});

test('Experimental room 1 uses the full authoritative arena dimensions and doorway-split boundary walls', () => {
    const [room] = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);

    assert.equal(room.id, 'experimental-room-1');
    assert.deepEqual(room.origin, { x: 0, y: 0 });
    assert.equal(room.width, 17280);
    assert.equal(room.height, 9720);
    assert.deepEqual(room.bounds, { left: 0, top: 0, right: 17280, bottom: 9720 });
    assert.equal(room.walls.length, 5);
    assert.deepEqual(room.walls.map(wall => [wall.start, wall.end]), [
        [{ x: 0, y: 0 }, { x: 17280, y: 0 }],
        [{ x: 17280, y: 0 }, { x: 17280, y: 9720 }],
        [{ x: 17280, y: 9720 }, { x: 9120, y: 9720 }],
        [{ x: 8160, y: 9720 }, { x: 0, y: 9720 }],
        [{ x: 0, y: 9720 }, { x: 0, y: 0 }]
    ]);
    assert.equal(isPointInRoom({ x: 5000, y: 5000 }, room.bounds), true);
    assert.equal(isPointInRoom({ x: 17281, y: 5000 }, room.bounds), false);
});

test('Experimental room 1 preserves wall dimensions and a 120-unit safe-spawn inset', () => {
    const [room] = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);

    assert.equal(room.wallCollisionThickness, EXPERIMENTAL_WALL_COLLISION_THICKNESS);
    assert.equal(room.wallVisualCoreThickness, EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS);
    assert.equal(room.collisionEpsilon, EXPERIMENTAL_WALL_SEPARATION_EPSILON);
    assert.equal(room.maxCorrectionPasses, EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES);
    assert.deepEqual(room.spawnRegion, { left: 120, top: 120, right: 17160, bottom: 9600 });
    assert.equal(room.spawnRegion.left - room.bounds.left, 120);
    assert.equal(room.bounds.right - room.spawnRegion.right, 120);
    assert.equal(room.npcCount, 1);
});

test('Experimental room 2 is equal-sized, directly below room 1, and reuses its shared boundary', () => {
    const [room1, room2] = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);

    assert.equal(room2.id, 'experimental-room-2');
    assert.deepEqual(room2.origin, { x: 0, y: 9720 });
    assert.equal(room2.width, room1.width);
    assert.equal(room2.height, room1.height);
    assert.equal(room2.bounds.top, room1.bounds.bottom);
    assert.deepEqual(room2.bounds, { left: 0, top: 9720, right: 17280, bottom: 19440 });
    assert.deepEqual(room2.spawnRegion, { left: 120, top: 9840, right: 17160, bottom: 19320 });
    assert.equal(room2.npcCount, 2);
    assert.equal(room2.npcLevel, 2);
    assert.deepEqual(room2.walls.map(wall => wall.id), [
        'room-2-wall-right', 'room-2-wall-bottom',
        'room-2-wall-left-bottom', 'room-2-wall-left-top'
    ]);
    assert.equal(room2.walls.some(wall => wall.start.y === room1.bounds.bottom && wall.end.y === room1.bounds.bottom), false);
    assert.equal(room1.walls.filter(wall => wall.start.y === room1.bounds.bottom && wall.end.y === room1.bounds.bottom).length, 2);
});

test('the centered doorway owns one invisible blocker and exact shared-wall opening metadata', () => {
    const rooms = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);
    const [door] = createExperimentalDoors(rooms);
    const sharedWalls = rooms[0].walls.filter(wall => wall.start.y === WORLD_HEIGHT && wall.end.y === WORLD_HEIGHT);

    assert.equal(door.id, 'experimental-door-1-2');
    assert.deepEqual(door.roomIds, ['experimental-room-1', 'experimental-room-2']);
    assert.equal(door.orientation, 'HORIZONTAL');
    assert.equal(door.boundaryCoordinate, 9720);
    assert.deepEqual(
        { min: door.openingMin, max: door.openingMax, center: door.openingCenter, width: door.openingWidth },
        { min: 8160, max: 9120, center: 8640, width: 960 }
    );
    assert.deepEqual(sharedWalls.map(wall => [wall.start.x, wall.end.x]), [[17280, 9120], [8160, 0]]);
    assert.deepEqual([door.blocker.start, door.blocker.end], [{ x: 8160, y: 9720 }, { x: 9120, y: 9720 }]);
    assert.equal(door.allowedCategories.includes('human-player'), true);
    assert.equal(door.blockedCategories.includes('ordinary-projectile'), true);
});

test('nine-room layout uses exact continuous coordinates, progression, safe spawns, and chain-only adjacency', () => {
    const rooms = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);
    const expectedOrigins = [
        [0, 0], [0, 9720], [-17280, 9720], [-17280, 0], [-17280, -9720],
        [0, -9720], [17280, -9720], [17280, 0], [17280, 9720]
    ];
    assert.equal(rooms.length, 9);
    rooms.forEach((room, index) => {
        const number = index + 1;
        const [left, top] = expectedOrigins[index];
        assert.deepEqual({ id: room.id, roomNumber: room.roomNumber, origin: room.origin }, {
            id: `experimental-room-${number}`, roomNumber: number, origin: { x: left, y: top }
        });
        assert.deepEqual(room.bounds, { left, top, right: left + 17280, bottom: top + 9720 });
        assert.deepEqual(room.spawnRegion, { left: left + 120, top: top + 120, right: left + 17160, bottom: top + 9600 });
        assert.deepEqual([room.width, room.height, room.npcCount, room.npcLevel], [17280, 9720, number, number]);
    });

    const doors = createExperimentalDoors(rooms);
    assert.equal(doors.length, 8);
    assert.deepEqual(doors.map(door => door.roomIds), Array.from({ length: 8 }, (_, index) => [
        `experimental-room-${index + 1}`, `experimental-room-${index + 2}`
    ]));
});

test('all horizontal and vertical doors are centered, split their one authoritative wall, and stay invisible', () => {
    const rooms = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);
    const doors = createExperimentalDoors(rooms);
    const expected = [
        ['HORIZONTAL', 9720, 8160, 9120], ['VERTICAL', 0, 14100, 15060],
        ['HORIZONTAL', 9720, -9120, -8160], ['HORIZONTAL', 0, -9120, -8160],
        ['VERTICAL', 0, -5340, -4380], ['VERTICAL', 17280, -5340, -4380],
        ['HORIZONTAL', 0, 25440, 26400], ['HORIZONTAL', 9720, 25440, 26400]
    ];
    doors.forEach((door, index) => {
        assert.deepEqual([door.orientation, door.boundaryCoordinate, door.openingMin, door.openingMax], expected[index]);
        assert.equal(door.sharedWallIds.length, 2);
        assert.equal(door.blocker.isDoorBlocker, true);
        assert.equal('render' in door.blocker, false);
        assert.deepEqual(door.allowedCategories, ['human-player']);
        assert.equal(door.blockedCategories.length, 11);
    });
});

test('Experimental and standard setup share one density resolver for every option level', () => {
    assert.deepEqual(
        Array.from({ length: 6 }, (_, level) => getArenaPopulationTargets(level, level, level)),
        [
            { asteroids: 0, debris: 0, satellites: 0 },
            { asteroids: 80, debris: 3, satellites: 3 },
            { asteroids: 160, debris: 7, satellites: 5 },
            { asteroids: 240, debris: 10, satellites: 6 },
            { asteroids: 320, debris: 16, satellites: 9 },
            { asteroids: 400, debris: 21, satellites: 14 }
        ]
    );
});

test('Experimental population setup applies the shared targets through room-local spawn methods', () => {
    for (let level = 0; level <= 5; level++) {
        const calls = { asteroids: 0, debris: 0, satellites: 0 };
        const roomCalls = new Map();
        const game = {
            experimentalRooms: createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT),
            players: [],
            asteroidDensityLevel: level,
            debrisDensityLevel: level,
            satelliteDensityLevel: level,
            spawnAsteroid(size, x, y, roomId) {
                calls.asteroids++;
                roomCalls.set(roomId, { ...(roomCalls.get(roomId) || {}), asteroids: (roomCalls.get(roomId)?.asteroids || 0) + 1 });
            },
            spawnSpaceDebris(roomId) {
                calls.debris++;
                roomCalls.set(roomId, { ...(roomCalls.get(roomId) || {}), debris: (roomCalls.get(roomId)?.debris || 0) + 1 });
            },
            spawnSatellite(roomId) {
                calls.satellites++;
                roomCalls.set(roomId, { ...(roomCalls.get(roomId) || {}), satellites: (roomCalls.get(roomId)?.satellites || 0) + 1 });
            }
        };
        Game.prototype.setupExperimentalPopulations.call(game);
        const targets = getArenaPopulationTargets(level, level, level);
        assert.deepEqual(calls, {
            asteroids: targets.asteroids * 9,
            debris: targets.debris * 9,
            satellites: targets.satellites * 9
        });
        for (const room of game.experimentalRooms) {
            assert.deepEqual(roomCalls.get(room.id) || {}, Object.fromEntries(
                Object.entries(targets).filter(([, count]) => count > 0)
            ));
        }
    }
});

test('standard initialization applies the same shared targets through its existing spawn methods', () => {
    const calls = { asteroids: 0, debris: 0, satellites: 0 };
    const game = {
        asteroidDensityLevel: 4,
        debrisDensityLevel: 4,
        satelliteDensityLevel: 4,
        asteroids: [{}],
        hazards: [{}],
        spawnAsteroid() { calls.asteroids++; },
        spawnSpaceDebris() { calls.debris++; },
        spawnSatellite() { calls.satellites++; }
    };
    Game.prototype.spawnInitialAsteroids.call(game);
    assert.deepEqual(calls, getArenaPopulationTargets(4, 4, 4));
    assert.deepEqual(game.asteroids, []);
    assert.deepEqual(game.hazards, []);
});

test('Experimental entity spawns retain room-local coordinates and membership', () => {
    const room = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT)[0];
    const game = {
        gameState: GAME_MODE.EXPERIMENTAL,
        experimentalRooms: [room],
        players: [],
        asteroids: [],
        hazards: [],
        findExperimentalSpawn: () => ({ x: 5000, y: 4000 })
    };
    Game.prototype.spawnAsteroid.call(game, 'large');
    Game.prototype.spawnSpaceDebris.call(game);
    Game.prototype.spawnSatellite.call(game);
    for (const entity of [...game.asteroids, ...game.hazards]) {
        assert.deepEqual({ x: entity.x, y: entity.y, roomId: entity.roomId }, {
            x: 5000,
            y: 4000,
            roomId: 'experimental-room-1'
        });
    }
});

test('only the Experimental initialization seam adds room definitions', () => {
    const game = {
        experimentalRooms: [],
        asteroidDensityLevel: 2,
        debrisDensityLevel: 3,
        satelliteDensityLevel: 4
    };

    assert.deepEqual(game.experimentalRooms, []);
    Game.prototype.initializeExperimentalRooms.call(game);
    assert.deepEqual(game.experimentalRooms.map(room => room.id), Array.from({ length: 9 }, (_, index) => `experimental-room-${index + 1}`));
    assert.deepEqual(game.experimentalDoors.map(door => door.id), Array.from({ length: 8 }, (_, index) => `experimental-door-${index + 1}-${index + 2}`));
    for (const room of game.experimentalRooms) {
        assert.deepEqual(game.experimentalRoomPopulations.get(room.id)?.desired, { asteroids: 160, debris: 10, satellites: 9 });
    }
    Game.prototype.clearExperimentalState.call(game);
    assert.deepEqual(game.experimentalRooms, []);
    assert.equal(game.experimentalRoomPopulations.size, 0);
});

test('Experimental live population counts are derived independently per room', () => {
    const [room1, room2] = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);
    const game = {
        experimentalRoomPopulations: new Map([
            [room1.id, { desired: { asteroids: 80, debris: 3, satellites: 3 } }],
            [room2.id, { desired: { asteroids: 80, debris: 3, satellites: 3 } }]
        ]),
        asteroids: [
            Object.assign(new Asteroid(100, 100, 'large'), { roomId: room1.id }),
            Object.assign(new Asteroid(100, 10000, 'large'), { roomId: room2.id })
        ],
        hazards: [
            Object.assign(new SpaceDebris(100, 100), { roomId: room1.id }),
            Object.assign(new Satellite(100, 10000), { roomId: room2.id })
        ]
    };
    assert.deepEqual(Game.prototype.getExperimentalRoomPopulation.call(game, room1.id).live, {
        asteroids: 1, largeAsteroids: 1, debris: 1, satellites: 0
    });
    assert.deepEqual(Game.prototype.getExperimentalRoomPopulation.call(game, room2.id).live, {
        asteroids: 1, largeAsteroids: 1, debris: 0, satellites: 1
    });
});

test('Experimental destruction preserves Room 2 across children and authoritative replacements', t => {
    t.mock.method(globalThis, 'setTimeout', callback => { callback(); return 1; });
    const rooms = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);
    const room2 = rooms[1];
    const large = Object.assign(new Asteroid(500, 11000, 'large'), { roomId: room2.id });
    const satellite = Object.assign(new Satellite(600, 11000), { roomId: room2.id });
    const debris = Object.assign(new SpaceDebris(700, 11000), { roomId: room2.id });
    const spawned = [];
    const game = {
        gameState: GAME_MODE.EXPERIMENTAL,
        experimentalSessionId: 7,
        experimentalRooms: rooms,
        experimentalRoomPopulations: new Map(rooms.map(room => [room.id, {
            desired: { asteroids: room.id === room2.id ? 1 : 0, debris: room.id === room2.id ? 1 : 0, satellites: room.id === room2.id ? 1 : 0 }
        }])),
        players: [],
        asteroids: [large],
        hazards: [satellite, debris],
        audio: { playSpatial() {} },
        getActiveCameras: () => [],
        createExplosion() {},
        awardXP() {},
        spawnAsteroid(size, x, y, roomId) { spawned.push({ type: size, roomId }); },
        spawnSatellite(roomId) { spawned.push({ type: 'satellite', roomId }); },
        spawnSpaceDebris(roomId) { spawned.push({ type: 'debris', roomId }); }
    };

    large.hits = large.maxHits - 1;
    Game.prototype.hitTarget.call(game, large, null);
    satellite.hits = satellite.maxHits - 1;
    Game.prototype.hitTarget.call(game, satellite, null);
    debris.hits = debris.maxHits - 1;
    Game.prototype.hitTarget.call(game, debris, null);

    assert.deepEqual(spawned, [
        { type: 'medium', roomId: room2.id },
        { type: 'medium', roomId: room2.id },
        { type: 'medium', roomId: room2.id },
        { type: 'large', roomId: room2.id },
        { type: 'satellite', roomId: room2.id },
        { type: 'debris', roomId: room2.id }
    ]);
});

test('Experimental composition follows each room NPC count and level', () => {
    const game = {
        players: [],
        p1ControlMode: 'KEYBOARD',
        botAggressionLevel: 3,
        transformationKills: 20,
        resetMouseLockInput() {},
        configurePlayerShields() {},
        experimentalRooms: createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT),
        asteroidDensityLevel: 0,
        debrisDensityLevel: 0,
        satelliteDensityLevel: 0,
        findExperimentalSpawn: Game.prototype.findExperimentalSpawn,
        spawnAsteroid() {},
        spawnSpaceDebris() {},
        spawnSatellite() {}
    };

    Game.prototype.spawnPlayers.call(game, GAME_MODE.SOLO, game.experimentalRooms[0].npcCount + 1);
    game.gameState = GAME_MODE.EXPERIMENTAL;
    Game.prototype.setupExperimentalPopulations.call(game);

    assert.equal(game.players.length, 46);
    assert.equal(game.players.filter(player => !player.isNPC).length, 1);
    assert.equal(game.players.filter(player => player.isNPC).length, 45);
    assert.equal(game.players[0].controlMode, 'KEYBOARD');
    assert.deepEqual(game.players.filter(player => player.isNPC).map(player => [player.roomId, player.level]),
        game.experimentalRooms.flatMap(room => Array.from({ length: room.roomNumber }, () => [room.id, room.roomNumber])));
    assert.ok(game.players.slice(1).every(player => Math.hypot(game.players[0].x - player.x, game.players[0].y - player.y) > 120));
});

test('future Experimental room progression scales count and level from explicit room number', () => {
    assert.deepEqual(createExperimentalRoomProgression(3), { roomNumber: 3, npcCount: 3, npcLevel: 3 });
    assert.deepEqual(createExperimentalRoomProgression(12), { roomNumber: 12, npcCount: 12, npcLevel: 12 });
});
