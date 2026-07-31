import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../game.js';
import {
    createExperimentalRooms,
    EXPERIMENTAL_WALL_COLLISION_THICKNESS,
    EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES,
    EXPERIMENTAL_WALL_SEPARATION_EPSILON,
    EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS
} from '../world/experimental_rooms.js';

test('Experimental room 1 defines a 1920 by 1080 rectangle with four boundary walls', () => {
    const [room] = createExperimentalRooms();

    assert.equal(room.id, 'experimental-room-1');
    assert.deepEqual(room.origin, { x: 0, y: 0 });
    assert.equal(room.width, 1920);
    assert.equal(room.height, 1080);
    assert.deepEqual(room.bounds, { left: 0, top: 0, right: 1920, bottom: 1080 });
    assert.equal(room.walls.length, 4);
    assert.deepEqual(room.walls.map(wall => [wall.start, wall.end]), [
        [{ x: 0, y: 0 }, { x: 1920, y: 0 }],
        [{ x: 1920, y: 0 }, { x: 1920, y: 1080 }],
        [{ x: 1920, y: 1080 }, { x: 0, y: 1080 }],
        [{ x: 0, y: 1080 }, { x: 0, y: 0 }]
    ]);
});

test('Experimental room 1 owns wall dimensions and conservative population mappings', () => {
    const [room] = createExperimentalRooms();

    assert.equal(room.wallCollisionThickness, EXPERIMENTAL_WALL_COLLISION_THICKNESS);
    assert.equal(room.wallVisualCoreThickness, EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS);
    assert.equal(room.collisionEpsilon, EXPERIMENTAL_WALL_SEPARATION_EPSILON);
    assert.equal(room.maxCorrectionPasses, EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES);
    assert.deepEqual(room.spawnRegion, { left: 120, top: 120, right: 1800, bottom: 960 });
    assert.deepEqual(room.populationMappings, {
        asteroids: [0, 1, 2, 3, 4, 5],
        debris: [0, 1, 1, 2, 3, 4],
        satellites: [0, 1, 1, 2, 2, 3]
    });
    assert.equal(room.npcCount, 1);
});

test('only the Experimental initialization seam adds room definitions', () => {
    const game = { experimentalRooms: [] };

    assert.deepEqual(game.experimentalRooms, []);
    Game.prototype.initializeExperimentalRooms.call(game);
    assert.deepEqual(game.experimentalRooms.map(room => room.id), ['experimental-room-1']);
    Game.prototype.clearExperimentalState.call(game);
    assert.deepEqual(game.experimentalRooms, []);
});
