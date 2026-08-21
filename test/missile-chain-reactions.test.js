import test from 'node:test';
import assert from 'node:assert/strict';
import {
    Game,
    GAME_MODE,
    MISSILE_DAMAGE,
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
        applyStandardTargetDamage(target, amount, owner) {
            return Game.prototype.applyStandardTargetDamage.call(game, target, amount, owner);
        },
        hitTarget(target) {
            target.hits++;
            if (target.hits >= target.maxHits) target.isDestroyed = true;
        },
        resolvePlayerDamage(player, amount, owner) {
            player.damageEvents ??= [];
            player.damageEvents.push({ amount, owner });
        },
        clearAimLocksForTarget() {}
    };
    return { game, explosions };
}

test('standard target damage repeats authoritative hits and stops at destruction', () => {
    const { game } = createDetonationGame([]);
    for (const [remainingHits, expectedHits, expectedDestroyed] of [
        [1, 1, true],
        [2, 2, true],
        [3, 3, true],
        [4, 3, false]
    ]) {
        const target = { hits: 0, maxHits: remainingHits, isDestroyed: false };
        game.applyStandardTargetDamage(target, MISSILE_DAMAGE, null);
        assert.deepEqual(
            [target.hits, target.isDestroyed],
            [expectedHits, expectedDestroyed],
            `target with ${remainingHits} remaining hits consumes only its valid damage budget`
        );
    }
});

test('standard missile blast routes three damage through target-specific damage seams', () => {
    const owner = { id: 1 };
    const enemy = { id: 2, x: 120, y: 100, radius: 10, isDead: false };
    const asteroid = { x: 110, y: 100, radius: 10, hits: 0, maxHits: 5, isDestroyed: false };
    const hazard = { x: 115, y: 100, radius: 10, hits: 0, maxHits: 5, isDestroyed: false };
    const first = missile(100, 100, { owner });
    const { game } = createDetonationGame([first]);
    game.players = [owner, enemy];
    game.asteroids = [asteroid];
    game.hazards = [hazard];

    game.detonateMissile(first);

    assert.equal(asteroid.hits, MISSILE_DAMAGE);
    assert.equal(hazard.hits, MISSILE_DAMAGE);
    assert.deepEqual(enemy.damageEvents, [{ amount: MISSILE_DAMAGE, owner }]);
    assert.equal(owner.damageEvents, undefined, 'the missile owner remains immune');
});

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
    assert.equal(ordinaryProjectile.hasDetonated, undefined, 'ordinary projectiles are removed without detonating');
    assert.equal(ordinaryProjectile.isRemoved, true);
    Game.prototype.compactRemovedProjectiles.call(game);
    assert.deepEqual(game.projectiles, []);
});

test('standard missile blasts dispatch skinny missiles through their existing AoE path', () => {
    const first = missile(100, 100);
    const skinny = missile(200, 100, { skinny: true, aoeRadius: 80 });
    const { game, explosions } = createDetonationGame([first, skinny]);

    game.detonateMissile(first);

    assert.equal(skinny.hasDetonated, true);
    assert.deepEqual(explosions.map(explosion => explosion.radius), [160, 80]);
    Game.prototype.compactRemovedProjectiles.call(game);
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

test('missile blasts remove hostile ordinary gun variants and Orbs but preserve other projectiles', () => {
    const owner = { id: 1 };
    const enemy = { id: 2 };
    const first = missile(100, 100, { owner });
    const normal = new Projectile(120, 100, 0, 0); normal.owner = enemy;
    const antigun = new Projectile(130, 100, 0, 0); antigun.owner = enemy;
    const doubleGun = new Projectile(140, 100, 0, 0); doubleGun.owner = enemy;
    const orb = new Projectile(150, 100, 0, 0); orb.owner = enemy; orb.isOrb = true;
    const laser = new Projectile(160, 100, 0, 0); laser.owner = enemy; laser.isLaser = true;
    const friendly = new Projectile(170, 100, 0, 0); friendly.owner = owner;
    const outside = new Projectile(300, 100, 0, 0); outside.owner = enemy;
    const { game } = createDetonationGame([
        first, normal, antigun, doubleGun, orb, laser, friendly, outside
    ]);

    game.detonateMissile(first);

    assert.equal(normal.isRemoved, true);
    assert.equal(antigun.isRemoved, true);
    assert.equal(doubleGun.isRemoved, true);
    assert.equal(orb.isRemoved, true);
    Game.prototype.compactRemovedProjectiles.call(game);
    assert.deepEqual(game.projectiles, [first, laser, friendly, outside]);
});

test('Experimental missile projectile blast removal stays room-local and respects walls', () => {
    const owner = { id: 1, roomId: 'room-1' };
    const enemy = { id: 2, roomId: 'room-1' };
    const first = missile(100, 100, { owner }); first.roomId = 'room-1';
    const removed = new Projectile(120, 100, 0, 0); removed.owner = enemy; removed.roomId = 'room-1';
    const blocked = new Projectile(130, 100, 0, 0); blocked.owner = enemy; blocked.roomId = 'room-1';
    const otherRoom = new Projectile(120, 100, 0, 0); otherRoom.owner = enemy; otherRoom.roomId = 'room-2';
    const { game } = createDetonationGame([first, removed, blocked, otherRoom], GAME_MODE.EXPERIMENTAL);
    game.experimentalAreaIndexes = new Map([
        ['room-1', { projectiles: new Set([first, removed, blocked]) }],
        ['room-2', { projectiles: new Set([otherRoom]) }]
    ]);
    game.isExperimentalBlastBlocked = (source, target) => source === first && target === blocked;

    game.detonateMissile(first);

    assert.equal(removed.isRemoved, true);
    assert.equal(blocked.isRemoved, undefined);
    assert.equal(otherRoom.isRemoved, undefined);
});

test('Experimental missile entity damage stays room-local and respects walls', () => {
    const owner = { id: 1, roomId: 'room-1' };
    const first = missile(100, 100, { owner }); first.roomId = 'room-1';
    const clear = { x: 120, y: 100, radius: 10, hits: 0, maxHits: 5, roomId: 'room-1' };
    const blocked = { x: 130, y: 100, radius: 10, hits: 0, maxHits: 5, roomId: 'room-1' };
    const otherRoom = { x: 120, y: 100, radius: 10, hits: 0, maxHits: 5, roomId: 'room-2' };
    const { game } = createDetonationGame([first], GAME_MODE.EXPERIMENTAL);
    game.asteroids = [clear, blocked, otherRoom];
    game.experimentalAreaIndexes = new Map([
        ['room-1', { projectiles: new Set([first]), asteroids: new Set([clear, blocked]) }],
        ['room-2', { projectiles: new Set(), asteroids: new Set([otherRoom]) }]
    ]);
    game.isExperimentalBlastBlocked = (source, target) => target === blocked;

    game.detonateMissile(first);

    assert.equal(clear.hits, MISSILE_DAMAGE);
    assert.equal(blocked.hits, 0);
    assert.equal(otherRoom.hits, 0);
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
