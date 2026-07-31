import test from 'node:test';
import assert from 'node:assert/strict';

import { Camera, DEFAULT_GAMEPLAY_ZOOM } from '../camera.js';
import { Game, GAME_MODE, WORLD_HEIGHT, WORLD_WIDTH } from '../game.js';
import { Player } from '../entities/player.js';
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
import { createExperimentalDoors, createExperimentalRooms } from '../world/experimental_rooms.js';

const createExperimentalContext = overrides => {
    const experimentalRooms = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);
    return {
        gameState: GAME_MODE.EXPERIMENTAL,
        experimentalRooms,
        experimentalDoors: createExperimentalDoors(experimentalRooms),
        players: [],
        asteroids: [],
        hazards: [],
        projectiles: [],
        audio: { playSpatialUnwrapped() {}, playSpatial() {} },
        getActiveCameras: () => [],
        ...overrides
    };
};

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

test('Experimental camera follows directly at every wall while a fresh base camera remains wrap-aware', () => {
    const camera = new Camera();
    camera.useDirectWorld();
    for (const target of [{ x: 40, y: 40 }, { x: 17240, y: 40 }, { x: 40, y: 9680 }, { x: 17240, y: 9680 }]) {
        camera.follow(target);
        assert.deepEqual({ x: camera.x, y: camera.y, mode: camera.boundaryMode }, { ...target, mode: 'ROOM' });
    }

    const wrapped = new Camera();
    assert.equal(wrapped.zoom, DEFAULT_GAMEPLAY_ZOOM);
    assert.equal(wrapped.boundaryMode, 'WRAP');
    assert.ok(wrapped.worldToScreen(WORLD_WIDTH - 5, 0).x < 1920);
});

test('the door blocker ignores humans, blocks NPCs, and swept resolution prevents tunneling', () => {
    const game = createExperimentalContext();
    const human = new Player(8640, 9800, 1);
    human.roomId = 'experimental-room-1';
    human.previousX = 8640;
    human.previousY = 9600;
    human.vy = 400;
    const npc = new Player(8640, 9800, 3);
    npc.isNPC = true;
    npc.roomId = 'experimental-room-1';
    npc.previousX = 8640;
    npc.previousY = 9600;
    npc.vy = 400;

    assert.equal(Game.prototype.resolveExperimentalSlide.call(game, human), false);
    assert.equal(human.y, 9800);
    assert.equal(Game.prototype.resolveExperimentalSlide.call(game, npc), true);
    assert.ok(npc.y < WORLD_HEIGHT);
    assert.equal(npc.vy, 0);
    assert.equal(npc.roomId, 'experimental-room-1');
});

test('Experimental collision categories centrally distinguish every door outcome representation', () => {
    const human = new Player(0, 0, 1);
    const npc = new Player(0, 0, 3);
    npc.isNPC = true;
    const ordinary = new Projectile(0, 0, 0, 0);
    const missile = new Projectile(0, 0, 0, 0); missile.isMissile = true;
    const laser = new Projectile(0, 0, 0, 0); laser.isLaser = true;
    const tentacle = new Projectile(0, 0, 0, 0); tentacle.isTentacle = true;
    const orbital = new Projectile(0, 0, 0, 0); orbital.isOrbital = true;
    const large = new Asteroid(0, 0, 'large');
    const medium = new Asteroid(0, 0, 'medium');
    const small = new Asteroid(0, 0, 'small');
    const satellite = new Satellite(0, 0);
    const debris = new SpaceDebris(0, 0);
    const categories = [human, npc, ordinary, missile, laser, tentacle, orbital, large, medium, small, satellite, debris]
        .map(entity => Game.prototype.getExperimentalCollisionCategory.call({}, entity));
    assert.deepEqual(categories, [
        'human-player', 'npc-ship', 'ordinary-projectile', 'missile', 'laser', 'tentacle', 'orbital',
        'large-asteroid', 'medium-asteroid', 'small-asteroid', 'satellite', 'space-debris'
    ]);
});

test('human membership commits beyond the doorway clearance without changing motion or camera', () => {
    const game = createExperimentalContext();
    const player = new Player(8640, WORLD_HEIGHT, 1);
    player.roomId = 'experimental-room-1';
    player.vx = 12;
    player.vy = 34;
    const camera = new Camera();
    camera.useDirectWorld();
    camera.follow(player);
    const cameraBefore = { x: camera.x, y: camera.y };

    assert.equal(Game.prototype.resolveExperimentalPlayerRoomMembership.call(game, player), 'experimental-room-1');
    player.y = WORLD_HEIGHT + player.radius + game.experimentalDoors[0].transitionTolerance + 1;
    assert.equal(Game.prototype.resolveExperimentalPlayerRoomMembership.call(game, player), 'experimental-room-2');
    assert.deepEqual({ vx: player.vx, vy: player.vy }, { vx: 12, vy: 34 });
    assert.deepEqual({ x: camera.x, y: camera.y }, cameraBefore);
    assert.equal(Game.prototype.resolveExperimentalPlayerRoomMembership.call(game, player), 'experimental-room-2');
    player.y = WORLD_HEIGHT - player.radius - game.experimentalDoors[0].transitionTolerance - 1;
    assert.equal(Game.prototype.resolveExperimentalPlayerRoomMembership.call(game, player), 'experimental-room-1');
});

test('door projectile outcomes block every representation regardless of human ownership', () => {
    const owner = new Player(8640, 9600, 1);
    owner.roomId = 'experimental-room-1';
    const removed = [];
    const detonated = [];
    const game = createExperimentalContext({
        players: [owner],
        removeProjectile(projectile) { projectile.isRemoved = true; removed.push(projectile); return true; },
        detonateMissile(projectile) { projectile.hasDetonated = true; detonated.push(projectile); },
        detonateAoEProjectile(projectile) { projectile.hasDetonated = true; detonated.push(projectile); }
    });
    for (const kind of ['ordinary', 'laser', 'tentacle', 'orbital', 'missile']) {
        const projectile = new Projectile(8640, 9800, 0, 400);
        projectile.owner = owner;
        projectile.roomId = owner.roomId;
        projectile.previousX = 8640;
        projectile.previousY = 9600;
        if (kind === 'laser') projectile.isLaser = true;
        if (kind === 'tentacle') projectile.isTentacle = true;
        if (kind === 'orbital') projectile.isOrbital = true;
        if (kind === 'missile') projectile.isMissile = true;
        game.projectiles.push(projectile);
        assert.equal(Game.prototype.resolveExperimentalProjectileWall.call(game, projectile), true, kind);
        assert.ok(projectile.y <= WORLD_HEIGHT, kind);
    }
    assert.equal(removed.length, 5);
    assert.equal(detonated.length, 1);
});

test('door blocker reflects confined bodies and environmentally replaces a small asteroid in its room', () => {
    const large = new Asteroid(8640, 9800, 'large');
    const small = new Asteroid(8640, 9800, 'small');
    const debris = new SpaceDebris(8640, 9800);
    const satellite = new Satellite(8640, 9800);
    for (const entity of [large, small, debris, satellite]) {
        entity.roomId = 'experimental-room-1';
        entity.previousX = 8640;
        entity.previousY = 9600;
        entity.vx = 0;
        entity.vy = 100;
    }
    const angular = [large.rotSpeed, debris.rotSpeed, satellite.rotSpeed];
    const replacements = [];
    const game = createExperimentalContext({
        asteroids: [large, small],
        hazards: [debris, satellite],
        hitTarget(target, killer) {
            assert.equal(killer, null);
            target.isDestroyed = true;
            this.asteroids.splice(this.asteroids.indexOf(target), 1);
        },
        spawnAsteroid(size, x, y, roomId) { replacements.push({ size, roomId }); }
    });
    Game.prototype.resolveExperimentalEntityWalls.call(game);
    assert.ok(large.vy < 0 && debris.vy < 0 && satellite.vy < 0);
    assert.deepEqual([large.rotSpeed, debris.rotSpeed, satellite.rotSpeed], angular);
    assert.equal(small.isDestroyed, true);
    assert.deepEqual(replacements, [{ size: 'small', roomId: 'experimental-room-1' }]);
});

test('Experimental respawn stays in the human current room', () => {
    const player = new Player(8640, 12000, 1);
    player.roomId = 'experimental-room-2';
    player.isDead = true;
    const game = createExperimentalContext({
        players: [player],
        startingShieldCharges: 3,
        findExperimentalSpawn: Game.prototype.findExperimentalSpawn
    });
    Game.prototype.respawnPlayer.call(game, player);
    const room2 = game.experimentalRooms[1];
    assert.equal(player.roomId, room2.id);
    assert.ok(player.y >= room2.spawnRegion.top + player.radius && player.y <= room2.spawnRegion.bottom - player.radius);
});

test('NPC targeting drops players across the doorway and cross-room collisions are rejected', () => {
    const npc = new Player(8640, 9600, 3);
    npc.isNPC = true;
    npc.roomId = 'experimental-room-1';
    npc.aggressionLevel = 5;
    npc.accuracyLevel = 5;
    const human = new Player(8640, 9900, 1);
    human.roomId = 'experimental-room-2';
    npc.npcTarget = human;
    npc.npcThinkTimer = 1;
    const game = createExperimentalContext({ players: [human, npc] });
    const worldRules = Game.prototype.getWorldRules.call(game);

    npc.updateNPC(0.016, [human, npc], [], () => {}, [], worldRules);
    assert.equal(npc.npcTarget, null);
    assert.notEqual(npc.shouldFire, true);
    assert.equal(Game.prototype.areExperimentalEntitiesCoLocated.call(game, npc, human), false);
    game.gameState = GAME_MODE.SOLO;
    assert.equal(Game.prototype.areExperimentalEntitiesCoLocated.call(game, npc, human), true);
});

test('Experimental cleanup restores the prior wrapped camera strategy and zoom', () => {
    const camera = new Camera();
    const originalZoom = camera.zoom;
    camera.zoom = 1;
    camera.useDirectWorld();
    const game = {
        camera,
        experimentalCameraState: { previousZoom: originalZoom },
        players: [],
        asteroids: [],
        hazards: [],
        projectiles: []
    };
    Game.prototype.clearExperimentalState.call(game);
    assert.equal(camera.zoom, originalZoom);
    assert.equal(camera.boundaryMode, 'WRAP');
    assert.equal(camera.roomBounds, null);
});

test('Experimental projectile wall outcomes remove ordinary shots and detonate missiles once', () => {
    const room = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT)[0];
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
    const room = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT)[0];
    const experimental = Game.prototype.getWorldRules.call({ gameState: GAME_MODE.EXPERIMENTAL, experimentalRooms: [room] });
    const solo = Game.prototype.getWorldRules.call({ gameState: GAME_MODE.SOLO, experimentalRooms: [room] });
    assert.deepEqual([experimental.wrap, experimental.camera, experimental.spawn], [false, 'ROOM', 'ROOM']);
    assert.deepEqual([solo.wrap, solo.usesRooms, solo.camera, solo.spawn, solo.room], [true, false, 'WRAP', 'GLOBAL', null]);
});

test('Experimental entity coordination slides ships, bounces large bodies, and destroys small asteroids environmentally', () => {
    const room = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT)[0];
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
    const room = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT)[0];
    const game = {
        experimentalRooms: [room],
        players: [{ x: 960, y: 540, radius: 30, isDead: false }]
    };
    const spawn = Game.prototype.findExperimentalSpawn.call(game, 80);
    assert.ok(spawn.x >= room.spawnRegion.left + 80 && spawn.x <= room.spawnRegion.right - 80);
    assert.ok(spawn.y >= room.spawnRegion.top + 80 && spawn.y <= room.spawnRegion.bottom - 80);
    assert.ok(Math.hypot(spawn.x - 960, spawn.y - 540) > 230);
});
