import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_MODE, Game, WORLD_HEIGHT, WORLD_WIDTH } from '../game.js';
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

    npc.update(1, {}, {}, null, [], [], [], false, 20, [], null, true, worldRules);
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
