import test from 'node:test';
import assert from 'node:assert/strict';
import {
    Game,
    GAME_MODE,
    WORLD_WIDTH
} from '../game.js';
import { Projectile } from '../entities/projectile.js';
import {
    AudioManager,
    EXPLOSION_BURST_MAX_VOICES,
    EXPLOSION_BURST_WINDOW_SECONDS
} from '../audio_manager.js';

function missile(x, y, { skinny = false, owner = null, radius = 14, aoeRadius = 160 } = {}) {
    const projectile = new Projectile(x, y, 0, 0);
    projectile.owner = owner;
    projectile.radius = radius;
    projectile.aoeRadius = aoeRadius;
    projectile.isMissile = !skinny;
    projectile.isSkinnyMissile = skinny;
    return projectile;
}

function createDetonationGame(projectiles, gameState = GAME_MODE.SOLO) {
    const explosions = [];
    const game = {
        gameState,
        projectiles,
        asteroids: [],
        hazards: [],
        players: [],
        experimentalRooms: [],
        experimentalDoors: [],
        experimentalAreaIndexes: new Map(),
        audio: { playSpatial() {}, playSpatialUnwrapped() {} },
        camera: {},
        getActiveCameras: () => [],
        createExplosion(x, y, radius) { explosions.push({ x, y, radius }); },
        isExperimentalBlastBlocked() { return false; },
        detonateMissile(projectile) { return Game.prototype.detonateMissile.call(game, projectile); },
        detonateAoEProjectile(projectile) { return Game.prototype.detonateAoEProjectile.call(game, projectile); },
        removeProjectile(projectile) { return Game.prototype.removeProjectile.call(game, projectile); },
        clearAimLocksForTarget() {}
    };
    return { game, explosions };
}

test('standard missile blasts recursively detonate and remove nearby missiles once', () => {
    const sharedOwner = { id: 1 };
    const first = missile(100, 100, { owner: sharedOwner });
    const second = missile(250, 100, { owner: sharedOwner });
    const third = missile(400, 100, { owner: { id: 2 } });
    const ordinaryProjectile = new Projectile(120, 100, 0, 0);
    const { game, explosions } = createDetonationGame([first, second, third, ordinaryProjectile]);

    game.detonateMissile(first);
    game.removeProjectile(first);

    assert.equal(explosions.length, 3, 'each eligible missile creates exactly one explosion');
    assert.equal(first.hasDetonated, true);
    assert.equal(second.hasDetonated, true, 'same-owner missiles participate in the chain');
    assert.equal(third.hasDetonated, true, 'the chain reaches missiles outside the first blast');
    assert.equal(ordinaryProjectile.hasDetonated, undefined, 'ordinary projectiles do not chain');
    assert.deepEqual(game.projectiles, [ordinaryProjectile]);
});

test('standard missile blasts dispatch skinny missiles through their existing AoE path', () => {
    const first = missile(100, 100);
    const skinny = missile(200, 100, { skinny: true, aoeRadius: 80 });
    const { game, explosions } = createDetonationGame([first, skinny]);

    game.detonateMissile(first);

    assert.equal(skinny.hasDetonated, true);
    assert.deepEqual(explosions.map(explosion => explosion.radius), [160, 80]);
    assert.deepEqual(game.projectiles, [first]);
});

test('standard missile chain distance wraps across the sandbox world seam', () => {
    const first = missile(10, 100);
    const wrappedNeighbor = missile(WORLD_WIDTH - 10, 100);
    const { game } = createDetonationGame([first, wrappedNeighbor]);

    game.detonateMissile(first);

    assert.equal(wrappedNeighbor.hasDetonated, true);
    assert.equal(wrappedNeighbor.isRemoved, true);
});

test('Experimental missile chains stay room-local and respect blast obstruction', () => {
    const first = missile(100, 100);
    const blocked = missile(200, 100);
    const otherRoom = missile(120, 100);
    first.roomId = 'room-1';
    blocked.roomId = 'room-1';
    otherRoom.roomId = 'room-2';
    const { game } = createDetonationGame([first, blocked, otherRoom], GAME_MODE.EXPERIMENTAL);
    game.experimentalAreaIndexes = new Map([
        ['room-1', { projectiles: new Set([first, blocked]) }],
        ['room-2', { projectiles: new Set([otherRoom]) }]
    ]);
    game.isExperimentalBlastBlocked = (source, target) => source === first && target === blocked;

    game.detonateMissile(first);

    assert.equal(blocked.hasDetonated, undefined, 'walls block otherwise eligible missiles');
    assert.equal(otherRoom.hasDetonated, undefined, 'other-room missiles are not candidates');
});

test('explosion spatial audio limits only explosion voices within its rolling window', () => {
    const audio = new AudioManager();
    let currentTime = 10;
    let sourcesStarted = 0;
    audio.ctx = {
        get currentTime() { return currentTime; },
        destination: {},
        createBufferSource() {
            return { connect() {}, start() { sourcesStarted++; } };
        },
        createGain() { return { gain: { value: 0 }, connect() {} }; },
        createStereoPanner() { return { pan: { value: 0 }, connect() {} }; }
    };
    audio.isUnlocked = true;
    audio.buffers = { explosion: {}, laser_fire: {} };
    const cameras = [{ x: 0, isPointOnScreen: () => true }];

    for (let i = 0; i < EXPLOSION_BURST_MAX_VOICES + 4; i++) {
        audio.playSpatial('explosion', 0, 0, cameras);
    }
    assert.equal(sourcesStarted, EXPLOSION_BURST_MAX_VOICES);

    audio.playSpatialUnwrapped('laser_fire', 0, 0, cameras);
    assert.equal(sourcesStarted, EXPLOSION_BURST_MAX_VOICES + 1, 'unrelated SFX remain unaffected');

    currentTime += EXPLOSION_BURST_WINDOW_SECONDS + 0.001;
    audio.playSpatialUnwrapped('explosion', 0, 0, cameras);
    assert.equal(sourcesStarted, EXPLOSION_BURST_MAX_VOICES + 2, 'explosions resume when the window clears');
});
