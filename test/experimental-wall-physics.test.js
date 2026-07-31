import test from 'node:test';
import assert from 'node:assert/strict';

import { Camera } from '../camera.js';
import { Game, GAME_MODE, WORLD_WIDTH } from '../game.js';
import { Projectile } from '../entities/projectile.js';
import { Asteroid } from '../entities/asteroid.js';
import { SpaceDebris, Satellite } from '../entities/hazards.js';
import {
    circleThickSegmentContact,
    closestPointOnSegment,
    correctWallPenetration,
    isLineBlockedByWalls,
    isPointInRoom,
    reflectVelocity,
    slideVelocity,
    sweptCircleSegmentIntersection,
    updateNewtonian
} from '../physics.js';
import { createExperimentalRooms } from '../world/experimental_rooms.js';

const verticalWall = { start: { x: 0, y: 100 }, end: { x: 0, y: 0 } };

test('closest-point and thick-segment contact handle faces, endpoints, diagonals, and zero-length walls', () => {
    assert.deepEqual(closestPointOnSegment({ x: 4, y: 5 }, verticalWall.start, verticalWall.end), { x: 0, y: 5, t: 0.95 });
    assert.deepEqual(closestPointOnSegment({ x: 4, y: 5 }, { x: 2, y: 3 }, { x: 2, y: 3 }), { x: 2, y: 3, t: 0 });

    const face = circleThickSegmentContact({ x: 8, y: 50, radius: 5 }, verticalWall, 10);
    assert.deepEqual(face.normal, { x: 1, y: 0 });
    assert.equal(face.penetration, 2);
    const endpoint = circleThickSegmentContact({ x: 6, y: -6, radius: 5 }, verticalWall, 10);
    assert.ok(endpoint && Number.isFinite(endpoint.normal.x) && endpoint.penetration > 0);
    const diagonal = circleThickSegmentContact(
        { x: 50, y: 56, radius: 5 },
        { start: { x: 0, y: 0 }, end: { x: 100, y: 100 } },
        10
    );
    assert.ok(diagonal && Number.isFinite(diagonal.normal.y));
});

test('penetration correction, wall sliding, head-on stops, and outward motion are stable', () => {
    const entity = { x: 8, y: 50, vx: -10, vy: 7, radius: 5 };
    const contact = circleThickSegmentContact(entity, verticalWall, 10);
    correctWallPenetration(entity, contact, 0.5);
    slideVelocity(entity, contact.normal);
    assert.equal(entity.x, 10.5);
    assert.equal(entity.vx, 0);
    assert.equal(entity.vy, 7);

    const outward = { vx: 4, vy: 3 };
    slideVelocity(outward, { x: 1, y: 0 });
    assert.deepEqual(outward, { vx: 4, vy: 3 });
});

test('reflection preserves speed and swept contacts prevent tunneling', () => {
    const body = { vx: -30, vy: 40 };
    reflectVelocity(body, { x: 1, y: 0 });
    assert.deepEqual(body, { vx: 30, vy: 40 });
    assert.equal(Math.hypot(body.vx, body.vy), 50);

    const hit = sweptCircleSegmentIntersection({ x: 100, y: 50 }, { x: -100, y: 50 }, 2, verticalWall, 10);
    assert.ok(hit && hit.t < 1);
    assert.equal(isLineBlockedByWalls({ x: 100, y: 50 }, { x: -100, y: 50 }, [verticalWall], 10), true);
    assert.equal(isLineBlockedByWalls({ x: 5, y: 50 }, { x: 100, y: 50 }, [verticalWall], 10), false);
    assert.equal(isPointInRoom({ x: 50, y: 50 }, { left: 0, top: 0, right: 100, bottom: 100 }), true);
});

test('movement strategy keeps base wrapping and disables it only for Experimental context', () => {
    const wrapped = { x: WORLD_WIDTH - 1, y: 100, vx: 10, vy: 0 };
    updateNewtonian(wrapped, 1);
    assert.equal(wrapped.x, 9);

    const bounded = { x: 1919, y: 100, vx: 10, vy: 0 };
    updateNewtonian(bounded, 1, undefined, { wrap: false });
    assert.equal(bounded.x, 1929);
});

test('Experimental camera clamps while a fresh base camera remains wrap-aware', () => {
    const camera = new Camera();
    camera.zoom = 1;
    camera.useRoomBounds({ left: 0, top: 0, right: 1920, bottom: 1080 });
    camera.follow({ x: 40, y: 40 });
    assert.deepEqual({ x: camera.x, y: camera.y, mode: camera.boundaryMode }, { x: 960, y: 540, mode: 'ROOM' });

    const wrapped = new Camera();
    assert.equal(wrapped.boundaryMode, 'WRAP');
    assert.ok(wrapped.worldToScreen(WORLD_WIDTH - 5, 0).x < 1920);
});

test('Experimental projectile wall outcomes remove ordinary shots and detonate missiles once', () => {
    const room = createExperimentalRooms()[0];
    const removed = [];
    const detonated = [];
    const game = {
        experimentalRooms: [room],
        audio: { playSpatialUnwrapped() {} },
        getActiveCameras: () => [],
        removeProjectile(projectile) { projectile.isRemoved = true; removed.push(projectile); },
        detonateMissile(projectile) { projectile.hasDetonated = true; detonated.push(projectile); },
        detonateAoEProjectile() {}
    };
    const shot = new Projectile(100, 100, -1000, 0);
    shot.previousX = 100;
    shot.x = -100;
    assert.equal(Game.prototype.resolveExperimentalProjectileWall.call(game, shot), true);
    assert.equal(shot.isRemoved, true);

    const missile = new Projectile(100, 200, -1000, 0);
    missile.isMissile = true;
    missile.previousX = 100;
    missile.x = -100;
    Game.prototype.resolveExperimentalProjectileWall.call(game, missile);
    assert.equal(detonated.length, 1);
    assert.equal(removed.filter(item => item === missile).length, 1);
});

test('world rules expose rooms only for the explicit Experimental state', () => {
    const room = createExperimentalRooms()[0];
    const experimental = Game.prototype.getWorldRules.call({ gameState: GAME_MODE.EXPERIMENTAL, experimentalRooms: [room] });
    const solo = Game.prototype.getWorldRules.call({ gameState: GAME_MODE.SOLO, experimentalRooms: [room] });
    assert.deepEqual([experimental.wrap, experimental.camera, experimental.spawn], [false, 'ROOM', 'ROOM']);
    assert.deepEqual([solo.wrap, solo.usesRooms, solo.camera, solo.spawn, solo.room], [true, false, 'WRAP', 'GLOBAL', null]);
});

test('Experimental entity coordination slides ships, bounces large bodies, and destroys small asteroids environmentally', () => {
    const room = createExperimentalRooms()[0];
    const audio = { playSpatialUnwrapped() {} };
    const ship = { x: 20, y: 400, vx: -20, vy: 9, radius: 20 };
    Game.prototype.resolveExperimentalSlide.call({ experimentalRooms: [room], audio, getActiveCameras: () => [] }, ship);
    assert.ok(ship.x > 20);
    assert.equal(ship.vx, 0);
    assert.equal(ship.vy, 9);

    const large = new Asteroid(30, 500, 'large');
    large.vx = -30;
    large.vy = 40;
    const small = new Asteroid(10, 600, 'small');
    const debris = new SpaceDebris(20, 700);
    debris.vx = -12;
    debris.vy = 5;
    const satellite = new Satellite(20, 800);
    satellite.vx = -20;
    satellite.vy = 0;
    const angular = [large.rotSpeed, debris.rotSpeed, satellite.rotSpeed];
    const destroyed = [];
    const game = {
        experimentalRooms: [room],
        asteroids: [large, small],
        hazards: [debris, satellite],
        audio,
        getActiveCameras: () => [],
        hitTarget(target, killer) { destroyed.push([target, killer]); }
    };
    Game.prototype.resolveExperimentalEntityWalls.call(game);
    assert.equal(Math.hypot(large.vx, large.vy), 50);
    assert.ok(large.vx > 0 && debris.vx > 0 && satellite.vx > 0);
    assert.deepEqual([large.rotSpeed, debris.rotSpeed, satellite.rotSpeed], angular);
    assert.deepEqual(destroyed, [[small, null]]);
});

test('Experimental spawn queries stay inside the room-safe region and away from a player', () => {
    const room = createExperimentalRooms()[0];
    const game = {
        experimentalRooms: [room],
        players: [{ x: 960, y: 540, radius: 30, isDead: false }]
    };
    const spawn = Game.prototype.findExperimentalSpawn.call(game, 80);
    assert.ok(spawn.x >= room.spawnRegion.left + 80 && spawn.x <= room.spawnRegion.right - 80);
    assert.ok(spawn.y >= room.spawnRegion.top + 80 && spawn.y <= room.spawnRegion.bottom - 80);
    assert.ok(Math.hypot(spawn.x - 960, spawn.y - 540) > 230);
});
