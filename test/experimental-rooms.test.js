import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EXPERIMENTAL_ROOM_HEIGHT,
    EXPERIMENTAL_ROOM_WIDTH,
    GAME_MODE,
    Game,
    WORLD_HEIGHT,
    WORLD_WIDTH,
    getArenaPopulationTargets,
    getExperimentalPopulationTargets,
    getExperimentalRoomPopulationTargets
} from '../game.js';
import { Asteroid } from '../entities/asteroid.js';
import { SpaceDebris, Satellite } from '../entities/hazards.js';
import { isPointInRoom } from '../physics.js';
import {
    createExperimentalArea,
    createExperimentalAreas,
    createExperimentalDoors,
    createExperimentalShortcutDefinitions,
    createExperimentalHallways,
    createExperimentalRoomProgression,
    createExperimentalRooms,
    EXPERIMENTAL_AREA_TYPE,
    EXPERIMENTAL_ENTRANCE_WIDTH,
    EXPERIMENTAL_HALLWAY_LENGTH,
    EXPERIMENTAL_HALLWAY_WIDTH,
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
    assert.equal(room.walls.length, 8);
    assert.equal(room.connectedAreaIds.length, 4);
    assert.deepEqual(room.walls.map(wall => wall.id).sort(), [
        'experimental-room-1-wall-bottom-left', 'experimental-room-1-wall-bottom-right',
        'experimental-room-1-wall-left-bottom', 'experimental-room-1-wall-left-top',
        'experimental-room-1-wall-right-bottom', 'experimental-room-1-wall-right-top',
        'experimental-room-1-wall-top-left', 'experimental-room-1-wall-top-right'
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

test('Experimental room 2 is equal-sized and physically separated from room 1 by hallway 1-2', () => {
    const [room1, room2] = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);
    const [hallway] = createExperimentalHallways(WORLD_WIDTH, WORLD_HEIGHT);

    assert.equal(room2.id, 'experimental-room-2');
    assert.deepEqual(room2.origin, { x: 0, y: 13720 });
    assert.equal(room2.width, room1.width);
    assert.equal(room2.height, room1.height);
    assert.deepEqual(hallway.bounds, { left: 7920, top: 9720, right: 9360, bottom: 13720 });
    assert.equal(hallway.bounds.top, room1.bounds.bottom);
    assert.equal(hallway.bounds.bottom, room2.bounds.top);
    assert.deepEqual(room2.bounds, { left: 0, top: 13720, right: 17280, bottom: 23440 });
    assert.deepEqual(room2.spawnRegion, { left: 120, top: 13840, right: 17160, bottom: 23320 });
    assert.equal(room2.npcCount, 3);
    assert.equal(room2.npcLevel, 2);
    assert.equal(hallway.roomNumber, 0);
    assert.equal(hallway.population, null);
});

test('room-to-hallway entrances own invisible blockers and aligned opening metadata', () => {
    const areas = createExperimentalAreas(WORLD_WIDTH, WORLD_HEIGHT);
    const [door] = createExperimentalDoors(areas);

    assert.equal(door.id, 'experimental-entrance-experimental-room-1-experimental-hallway-1-2');
    assert.deepEqual(door.roomIds, ['experimental-room-1', 'experimental-hallway-1-2']);
    assert.equal(door.orientation, 'HORIZONTAL');
    assert.equal(door.boundaryCoordinate, 9720);
    assert.deepEqual(
        { min: door.openingMin, max: door.openingMax, center: door.openingCenter, width: door.openingWidth },
        { min: 8160, max: 9120, center: 8640, width: 960 }
    );
    assert.deepEqual([door.blocker.start, door.blocker.end], [{ x: 8160, y: 9720 }, { x: 9120, y: 9720 }]);
    assert.equal(door.allowedCategories.includes('human-player'), true);
    assert.equal(door.blockedCategories.includes('ordinary-projectile'), true);
});

test('nine-room layout keeps exact route coordinates, progression, and safe spawns', () => {
    const rooms = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);
    const expectedOrigins = [
        [0, 0], [0, 13720], [-21280, 13720], [-21280, 0], [-21280, -13720],
        [0, -13720], [21280, -13720], [21280, 0], [21280, 13720]
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
        assert.deepEqual([room.width, room.height, room.npcCount, room.npcLevel], [17280, 9720, 1 + 2 * (number - 1), number]);
    });

    assert.equal(createExperimentalHallways(WORLD_WIDTH, WORLD_HEIGHT).length, 11);
});

test('eleven long Room 0 hallways have aligned entrances and no area overlaps', () => {
    const areas = createExperimentalAreas(WORLD_WIDTH, WORLD_HEIGHT);
    const hallways = areas.filter(area => area.areaType === EXPERIMENTAL_AREA_TYPE.HALLWAY);
    const doors = createExperimentalDoors(areas);
    assert.equal(hallways.length, 11);
    assert.equal(new Set(hallways.map(area => area.id)).size, 11);
    for (const hallway of hallways) {
        assert.equal(hallway.roomNumber, 0);
        assert.equal(hallway.isPopulationEligible, false);
        assert.ok([hallway.width, hallway.height].includes(EXPERIMENTAL_HALLWAY_LENGTH));
        assert.ok([hallway.width, hallway.height].includes(EXPERIMENTAL_HALLWAY_WIDTH));
        assert.equal(hallway.connectedAreaIds.length, 2);
    }
    assert.equal(doors.length, 22);
    doors.forEach(door => {
        assert.equal(door.openingWidth, EXPERIMENTAL_ENTRANCE_WIDTH);
        assert.equal(door.blocker.isDoorBlocker, true);
        assert.equal('render' in door.blocker, false);
        assert.deepEqual(door.allowedCategories, ['human-player']);
        assert.equal(door.blockedCategories.length, 11);
    });
    for (let firstIndex = 0; firstIndex < areas.length; firstIndex++) {
        for (let secondIndex = firstIndex + 1; secondIndex < areas.length; secondIndex++) {
            const first = areas[firstIndex].bounds;
            const second = areas[secondIndex].bounds;
            const overlapWidth = Math.min(first.right, second.right) - Math.max(first.left, second.left);
            const overlapHeight = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
            assert.equal(overlapWidth > 0 && overlapHeight > 0, false, `${areas[firstIndex].id} overlaps ${areas[secondIndex].id}`);
        }
    }
});

test('three immutable shortcut definitions connect Sector 1 walls to safe aligned destinations', () => {
    const shortcuts = createExperimentalShortcutDefinitions(WORLD_WIDTH, WORLD_HEIGHT);
    assert.equal(shortcuts.length, 3);
    assert.deepEqual(shortcuts.map(({ id, sourceWall, destinationRoomNumber, destinationWall, colorName }) =>
        [id, sourceWall, destinationRoomNumber, destinationWall, colorName]), [
        ['sector-1-to-4', 'left', 4, 'right', 'blue'],
        ['sector-1-to-6', 'top', 6, 'bottom', 'green'],
        ['sector-1-to-8', 'right', 8, 'left', 'magenta']
    ]);
    assert.ok(shortcuts.every(Object.isFrozen));
    assert.ok(shortcuts.every(shortcut => Object.isFrozen(shortcut.hallwayBounds)));
    const areas = createExperimentalAreas(WORLD_WIDTH, WORLD_HEIGHT);
    const shortcutDoors = createExperimentalDoors(areas).filter(door => door.shortcutId);
    assert.equal(shortcutDoors.filter(door => door.shortcutRole === 'LOCKED_SOURCE').length, 3);
    assert.equal(shortcutDoors.filter(door => door.shortcutRole === 'UNLOCKING_DESTINATION').length, 3);
});

test('each hallway gap exceeds the maximum camera span along its travel axis', () => {
    const areas = createExperimentalAreas(WORLD_WIDTH, WORLD_HEIGHT);
    const byId = new Map(areas.map(area => [area.id, area]));
    const maximumVisibleWidth = 1920 / 0.6;
    const maximumVisibleHeight = 1080 / 0.6;
    for (const hallway of areas.filter(area => area.roomNumber === 0)) {
        const [first, second] = hallway.connectedAreaIds.map(id => byId.get(id));
        const horizontal = hallway.width === EXPERIMENTAL_HALLWAY_LENGTH;
        const gap = horizontal
            ? Math.max(first.bounds.left, second.bounds.left) - Math.min(first.bounds.right, second.bounds.right)
            : Math.max(first.bounds.top, second.bounds.top) - Math.min(first.bounds.bottom, second.bounds.bottom);
        assert.equal(gap, EXPERIMENTAL_HALLWAY_LENGTH);
        assert.ok(gap > (horizontal ? maximumVisibleWidth : maximumVisibleHeight), hallway.id);
    }
});

test('active Experimental geometry uses 5x5 rooms without changing standard or hallway dimensions', () => {
    assert.deepEqual([WORLD_WIDTH, WORLD_HEIGHT], [17280, 9720]);
    assert.deepEqual([EXPERIMENTAL_ROOM_WIDTH, EXPERIMENTAL_ROOM_HEIGHT], [9600, 5400]);

    const areas = createExperimentalAreas(EXPERIMENTAL_ROOM_WIDTH, EXPERIMENTAL_ROOM_HEIGHT);
    const rooms = areas.filter(area => area.areaType === EXPERIMENTAL_AREA_TYPE.ROOM);
    const hallways = areas.filter(area => area.areaType === EXPERIMENTAL_AREA_TYPE.HALLWAY);
    assert.ok(rooms.every(room => room.width === 9600 && room.height === 5400));
    assert.ok(hallways.every(hallway => (
        hallway.width === EXPERIMENTAL_HALLWAY_LENGTH && hallway.height === EXPERIMENTAL_HALLWAY_WIDTH
    ) || (
        hallway.width === EXPERIMENTAL_HALLWAY_WIDTH && hallway.height === EXPERIMENTAL_HALLWAY_LENGTH
    )));
    assert.ok(createExperimentalDoors(areas).every(door => door.openingWidth === EXPERIMENTAL_ENTRANCE_WIDTH));
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

test('Experimental environmental targets preserve density at the 25/81 room-area ratio', () => {
    assert.deepEqual(
        Array.from({ length: 6 }, (_, level) => getExperimentalPopulationTargets(level, level, level)),
        [
            { asteroids: 0, debris: 0, satellites: 0 },
            { asteroids: 25, debris: 1, satellites: 1 },
            { asteroids: 49, debris: 2, satellites: 2 },
            { asteroids: 74, debris: 3, satellites: 2 },
            { asteroids: 99, debris: 5, satellites: 3 },
            { asteroids: 123, debris: 6, satellites: 4 }
        ]
    );
});

test('Experimental Sectors 7 and 8 derive asteroid-only targets from the standard room target', () => {
    for (let level = 0; level <= 5; level++) {
        const baseline = getExperimentalPopulationTargets(level, level, level);
        const sector6 = getExperimentalRoomPopulationTargets(6, level, level, level);
        const sector7 = getExperimentalRoomPopulationTargets(7, level, level, level);
        const sector8 = getExperimentalRoomPopulationTargets(8, level, level, level);
        assert.deepEqual(sector6, baseline);
        assert.equal(sector7.asteroids, Math.round(baseline.asteroids * 1.2));
        assert.equal(sector8.asteroids, Math.round(baseline.asteroids * 1.4));
        assert.deepEqual({ debris: sector7.debris, satellites: sector7.satellites },
            { debris: baseline.debris, satellites: baseline.satellites });
        assert.deepEqual({ debris: sector8.debris, satellites: sector8.satellites },
            { debris: baseline.debris, satellites: baseline.satellites });
    }
});

test('Experimental population setup applies area-scaled targets through room-local spawn methods', () => {
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
        const targets = getExperimentalPopulationTargets(level, level, level);
        assert.deepEqual(calls, {
            asteroids: targets.asteroids * 7
                + Math.round(targets.asteroids * 1.2)
                + Math.round(targets.asteroids * 1.4),
            debris: targets.debris * 9,
            satellites: targets.satellites * 9
        });
        for (const room of game.experimentalRooms) {
            const roomTargets = getExperimentalRoomPopulationTargets(
                room.roomNumber, level, level, level
            );
            assert.deepEqual(roomCalls.get(room.id) || {}, Object.fromEntries(
                Object.entries(roomTargets).filter(([, count]) => count > 0)
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
    assert.equal(game.experimentalRooms.length, 20);
    assert.equal(game.experimentalDoors.length, 22);
    for (const room of game.experimentalRooms) {
        if (room.isPopulationEligible) assert.deepEqual(
            game.experimentalRoomPopulations.get(room.id)?.desired,
            getExperimentalRoomPopulationTargets(room.roomNumber, 2, 3, 4)
        );
        else assert.equal(game.experimentalRoomPopulations.has(room.id), false);
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

    assert.equal(game.players.length, 72);
    assert.equal(game.players.filter(player => !player.isNPC).length, 1);
    assert.equal(game.players.filter(player => player.isNPC).length, 71);
    assert.equal(game.players[0].controlMode, 'KEYBOARD');
    assert.equal(game.players[0].level, 0);
    const ordinaryNPCs = game.players.filter(player => player.isNPC && !player.isSector9BBGEncounterNPC);
    assert.deepEqual(ordinaryNPCs.map(player => [player.roomId, player.level]),
        game.experimentalRooms.filter(room => room.ordinaryNPCsAllowed).flatMap(room => (
            Array.from({ length: room.npcCount }, () => [room.id, room.npcLevel])
        )));
    assert.equal(game.players.filter(player => player.isSector9BBGEncounterNPC).length, 7);
    assert.ok(game.players.slice(1).every(player => Math.hypot(game.players[0].x - player.x, game.players[0].y - player.y) > 120));
});

test('future Experimental room progression scales count and level from explicit room number', () => {
    assert.deepEqual(createExperimentalRoomProgression(3), { roomNumber: 3, npcCount: 5, npcLevel: 3 });
    assert.deepEqual(createExperimentalRoomProgression(12), { roomNumber: 12, npcCount: 23, npcLevel: 12 });
});
