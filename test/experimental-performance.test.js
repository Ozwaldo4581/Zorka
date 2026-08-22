import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_MODE, Game, WORLD_HEIGHT, WORLD_WIDTH } from '../game.js';
import { Camera } from '../camera.js';
import { Player } from '../entities/player.js';
import { Projectile } from '../entities/projectile.js';
import { Asteroid } from '../entities/asteroid.js';
import { Satellite } from '../entities/hazards.js';
import { createExperimentalAreas, createExperimentalDoors } from '../world/experimental_rooms.js';

function createGame(overrides = {}) {
    const experimentalRooms = createExperimentalAreas(WORLD_WIDTH, WORLD_HEIGHT);
    const game = {
        gameState: GAME_MODE.EXPERIMENTAL,
        experimentalRooms,
        experimentalDoors: createExperimentalDoors(experimentalRooms),
        players: [], asteroids: [], hazards: [], projectiles: [], vfx: [],
        audio: { playSpatial() {}, playSpatialUnwrapped() {} },
        getActiveCameras: () => [],
        clearAimLocksForTarget() {},
        ...overrides
    };
    Game.prototype.initializeExperimentalAreaIndexes.call(game);
    return game;
}

test('Experimental derived indexes reconcile insertion, transfer, removal, VFX, and cleanup', () => {
    const game = createGame();
    const player = Object.assign(new Player(8640, 9800, 1), { roomId: 'experimental-room-1' });
    const asteroid = Object.assign(new Asteroid(100, 100, 'large'), { roomId: 'experimental-room-1' });
    const projectile = Object.assign(new Projectile(100, 100, 0, 0), { roomId: 'experimental-room-1' });
    game.players.push(player);
    game.asteroids.push(asteroid);
    Game.prototype.indexExperimentalEntity.call(game, 'players', player);
    Game.prototype.indexExperimentalEntity.call(game, 'asteroids', asteroid);
    Game.prototype.addProjectile.call(game, projectile);
    Game.prototype.createExplosion.call(game, 100, 100, 20, player.roomId);

    assert.deepEqual(Game.prototype.getExperimentalAreaEntities.call(game, player.roomId, 'players'), [player]);
    assert.deepEqual(Game.prototype.getExperimentalAreaEntities.call(game, player.roomId, 'asteroids'), [asteroid]);
    assert.deepEqual(Game.prototype.getExperimentalAreaEntities.call(game, player.roomId, 'projectiles'), [projectile]);
    assert.equal(Game.prototype.getExperimentalAreaEntities.call(game, player.roomId, 'vfx').length, 1);

    player.y = WORLD_HEIGHT + player.radius + game.experimentalDoors[0].transitionTolerance + 1;
    Game.prototype.resolveExperimentalPlayerRoomMembership.call(game, player);
    assert.equal(player.roomId, 'experimental-hallway-1-2');
    assert.deepEqual(Game.prototype.getExperimentalAreaEntities.call(game, 'experimental-room-1', 'players'), []);
    assert.deepEqual(Game.prototype.getExperimentalAreaEntities.call(game, player.roomId, 'players'), [player]);

    Game.prototype.removeProjectile.call(game, projectile);
    assert.deepEqual(Game.prototype.getExperimentalAreaEntities.call(game, 'experimental-room-1', 'projectiles'), []);
    Game.prototype.clearExperimentalState.call(game);
    assert.equal(game.experimentalAreaIndexes.size, 0);
});

test('Experimental collision candidates never cross areas and retain doorway-local human contact', () => {
    const game = createGame();
    const projectile = Object.assign(new Projectile(500, 500, 0, 0), { roomId: 'experimental-room-1' });
    const local = Object.assign(new Asteroid(500, 500, 'small'), { roomId: 'experimental-room-1' });
    const distant = Object.assign(new Asteroid(500, 500, 'small'), { roomId: 'experimental-room-2' });
    for (const entity of [projectile, local, distant]) {
        const kind = entity instanceof Projectile ? 'projectiles' : 'asteroids';
        game[kind].push(entity);
        Game.prototype.indexExperimentalEntity.call(game, kind, entity);
    }
    assert.deepEqual(Game.prototype.getExperimentalCandidates.call(game, projectile, 'asteroids', game.asteroids), [local]);
});

test('rooms without humans skip NPC targeting, firing, Satellite shots, VFX, and spatial audio', () => {
    let audioRequests = 0;
    const game = createGame({
        audio: {
            playSpatial() { audioRequests++; },
            playSpatialUnwrapped() { audioRequests++; }
        }
    });
    game.hasHumanInExperimentalArea = roomId => Game.prototype.hasHumanInExperimentalArea.call(game, roomId);
    game.addProjectile = projectile => Game.prototype.addProjectile.call(game, projectile);
    game.playSpatialEvent = (...args) => Game.prototype.playSpatialEvent.call(game, ...args);
    const npc = Object.assign(new Player(100, 100, 3), {
        roomId: 'experimental-room-2', isNPC: true, vx: 25, vy: 0,
        npcTarget: { roomId: 'experimental-room-2' }, shouldFire: true
    });
    const satellite = Object.assign(new Satellite(200, 200), { roomId: npc.roomId, fireCooldown: 0 });
    game.players.push(npc);
    game.hazards.push(satellite);
    Game.prototype.indexExperimentalEntity.call(game, 'players', npc);
    Game.prototype.indexExperimentalEntity.call(game, 'hazards', satellite);
    const worldRules = Game.prototype.getWorldRules.call(game);

    npc.update(1, { worldRules });
    satellite.update(1, game, worldRules);
    Game.prototype.handleFire.call(game, npc.id);
    assert.equal(npc.x, 125);
    assert.equal(npc.npcTarget, null);
    assert.equal(npc.shouldFire, false);
    assert.equal(satellite.fireCooldown, 0);
    assert.equal(game.projectiles.length, 0);
    assert.equal(Game.prototype.createExplosion.call(game, 200, 200, 40, npc.roomId), null);
    assert.equal(Game.prototype.playSpatialEvent.call(game, 'explosion', 200, 200, npc.roomId), false);
    assert.equal(game.vfx.length, 0);
    assert.equal(audioRequests, 0);
});

test('active Experimental areas retain NPC, Satellite, VFX, and audio behavior', () => {
    let audioRequests = 0;
    const game = createGame({ audio: { playSpatialUnwrapped() { audioRequests++; } } });
    game.hasHumanInExperimentalArea = roomId => Game.prototype.hasHumanInExperimentalArea.call(game, roomId);
    game.addProjectile = projectile => Game.prototype.addProjectile.call(game, projectile);
    game.playSpatialEvent = (...args) => Game.prototype.playSpatialEvent.call(game, ...args);
    const human = Object.assign(new Player(100, 100, 1), { roomId: 'experimental-room-1' });
    const satellite = Object.assign(new Satellite(200, 200), { roomId: human.roomId, fireCooldown: 0 });
    game.players.push(human);
    game.hazards.push(satellite);
    Game.prototype.indexExperimentalEntity.call(game, 'players', human);
    Game.prototype.indexExperimentalEntity.call(game, 'hazards', satellite);
    satellite.update(0.016, game, Game.prototype.getWorldRules.call(game));
    assert.equal(game.projectiles.length, 1);
    assert.ok(Game.prototype.createExplosion.call(game, 100, 100, 20, human.roomId));
    assert.equal(Game.prototype.playSpatialEvent.call(game, 'explosion', 100, 100, human.roomId), true);
    assert.equal(audioRequests, 2);
});

test('Experimental simulation collections materialize active areas only', () => {
    const game = createGame();
    const human = Object.assign(new Player(100, 100, 1), {
        roomId: 'experimental-room-1'
    });
    const activeAsteroid = Object.assign(new Asteroid(100, 100, 'small'), {
        roomId: 'experimental-room-1'
    });
    const dormantAsteroid = Object.assign(new Asteroid(100, 100, 'small'), {
        roomId: 'experimental-room-2'
    });
    game.players.push(human);
    game.asteroids.push(activeAsteroid, dormantAsteroid);
    Game.prototype.indexExperimentalEntity.call(game, 'players', human);
    Game.prototype.indexExperimentalEntity.call(game, 'asteroids', activeAsteroid);
    Game.prototype.indexExperimentalEntity.call(game, 'asteroids', dormantAsteroid);

    const activity = Game.prototype.createExperimentalActivityContext.call(game);
    const simulationAsteroids = Game.prototype.getExperimentalActivityEntities.call(
        game, activity, 'asteroids'
    );
    assert.deepEqual(simulationAsteroids, [activeAsteroid]);
    assert.equal(
        Game.prototype.getExperimentalActivityEntities.call(game, activity, 'asteroids'),
        simulationAsteroids,
        'a kind is materialized once per activity context'
    );
    assert.deepEqual(game.asteroids, [activeAsteroid, dormantAsteroid]);

    const lateProjectile = Object.assign(new Projectile(120, 100, 0, 0), {
        roomId: human.roomId
    });
    Game.prototype.addProjectile.call(game, lateProjectile);
    assert.deepEqual(
        Game.prototype.getExperimentalActivityEntities.call(game, activity, 'projectiles'),
        [lateProjectile],
        'a kind first requested after insertion includes the same-frame entity'
    );
});

test('Experimental activity reuses area-level NPC candidate bundles without caching decisions', () => {
    const game = createGame();
    const roomId = 'experimental-room-1';
    const human = Object.assign(new Player(100, 100, 1), { roomId });
    const firstNPC = Object.assign(new Player(200, 100, 2), { roomId, isNPC: true });
    const secondNPC = Object.assign(new Player(300, 100, 3), { roomId, isNPC: true });
    const asteroid = Object.assign(new Asteroid(400, 100, 'large'), { roomId });
    const hazard = Object.assign(new Satellite(500, 100), { roomId });
    game.players.push(human, firstNPC, secondNPC);
    game.asteroids.push(asteroid);
    game.hazards.push(hazard);
    for (const player of game.players) Game.prototype.indexExperimentalEntity.call(game, 'players', player);
    Game.prototype.indexExperimentalEntity.call(game, 'asteroids', asteroid);
    Game.prototype.indexExperimentalEntity.call(game, 'hazards', hazard);

    const activity = Game.prototype.createExperimentalActivityContext.call(game);
    const candidates = Game.prototype.getExperimentalNPCCandidates.call(game, activity, roomId);

    assert.equal(Game.prototype.getExperimentalNPCCandidates.call(game, activity, roomId), candidates);
    assert.deepEqual(candidates.players, [human, firstNPC, secondNPC]);
    assert.deepEqual(candidates.asteroids, [asteroid]);
    assert.deepEqual(candidates.hazards, [hazard]);
    assert.equal(Object.hasOwn(candidates, 'npcTarget'), false, 'the activity cache must not own NPC decisions');

    human.isDead = true;
    assert.equal(candidates.players.includes(human), true, 'broad cached references leave life-state authority on entities');
});

test('Experimental collision pass ignores dormant-area projectiles and targets', () => {
    const game = createGame({
        hitTarget() { throw new Error('dormant target entered collision resolution'); }
    });
    game.createCollisionSpatialHash = entities => Game.prototype.createCollisionSpatialHash.call(game, entities);
    const dormantProjectile = Object.assign(new Projectile(100, 100, 0, 0), {
        roomId: 'experimental-room-2'
    });
    const dormantAsteroid = Object.assign(new Asteroid(100, 100, 'small'), {
        roomId: 'experimental-room-2'
    });
    game.projectiles.push(dormantProjectile);
    game.asteroids.push(dormantAsteroid);

    Game.prototype.checkCollisions.call(game, {
        projectiles: [],
        asteroids: [],
        hazards: []
    });
    assert.deepEqual(game.projectiles, [dormantProjectile]);
    assert.equal(dormantAsteroid.isDestroyed, false);
});

test('Experimental wall candidates spatially narrow immutable geometry and retain door blockers', () => {
    const game = createGame();
    const room = game.experimentalRooms.find(area => area.roomNumber === 8);
    const interiorWall = room.walls.find(wall => wall.id.includes('-interior-'));
    const entity = Object.assign(new Asteroid(interiorWall.start.x, interiorWall.start.y, 'large'), {
        roomId: room.id,
        previousX: interiorWall.start.x - 50,
        previousY: interiorWall.start.y - 50
    });

    const allEligibleWalls = Game.prototype.getExperimentalCollisionWalls.call(game, entity);
    const candidates = Game.prototype.getExperimentalCollisionWallCandidates.call(game, entity);

    assert.ok(candidates.includes(interiorWall));
    assert.ok(candidates.length < allEligibleWalls.length / 2, 'Sector 8 should send only nearby static walls to narrow phase');
    assert.deepEqual(
        candidates.filter(wall => !wall.isDoorBlocker).map(wall => wall.id),
        allEligibleWalls.filter(wall => candidates.includes(wall) && !wall.isDoorBlocker).map(wall => wall.id),
        'spatial candidates retain authoritative wall-source ordering'
    );
    assert.deepEqual(
        candidates.filter(wall => wall.isDoorBlocker).map(wall => wall.id),
        game.experimentalDoors.filter(door => door.roomIds.includes(room.id)).map(door => door.blocker.id),
        'conditional door blockers remain a separate eligible candidate set'
    );
});

test('Experimental render contexts reuse camera-pass area, activity, and viewport state', () => {
    const game = createGame();
    const roomId = 'experimental-room-1';
    const human = Object.assign(new Player(100, 100, 1), { roomId });
    const asteroid = Object.assign(new Asteroid(120, 100, 'large'), { roomId });
    game.players.push(human);
    game.asteroids.push(asteroid);
    Game.prototype.indexExperimentalEntity.call(game, 'players', human);
    Game.prototype.indexExperimentalEntity.call(game, 'asteroids', asteroid);
    const firstCamera = Object.assign(new Camera(), { x: 100, y: 100, zoom: 0.6 });
    const secondCamera = Object.assign(new Camera(), { x: 1000, y: 800, zoom: 0.8 });

    const first = Game.prototype.createExperimentalRenderContext.call(game, firstCamera);
    const second = Game.prototype.createExperimentalRenderContext.call(game, secondCamera);

    assert.notEqual(first, second, 'each camera pass owns a separate render context');
    assert.equal(first.camera, firstCamera);
    assert.equal(second.camera, secondCamera);
    assert.notDeepEqual(first.viewport, second.viewport);
    assert.equal(
        Game.prototype.getExperimentalActivityEntities.call(game, first.activity, 'asteroids'),
        Game.prototype.getExperimentalActivityEntities.call(game, first.activity, 'asteroids')
    );
    assert.deepEqual(
        Game.prototype.getRenderableEntities.call(game, [asteroid], firstCamera, first.areaIds, first),
        [asteroid]
    );
});
