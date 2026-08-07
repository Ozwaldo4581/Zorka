import test from 'node:test';
import assert from 'node:assert/strict';
import {
    Game,
    GAME_MODE,
    WORLD_WIDTH,
    PROJECTILE_COMBAT_CATEGORY as CATEGORY,
    PROJECTILE_CONSUMPTION as CONSUMPTION,
    getProjectileCombatCategory,
    resolveProjectileConsumption
} from '../game.js';
import { Projectile } from '../entities/projectile.js';

const projectile = (kind, owner = null, x = 100, roomId = undefined) => {
    const shot = new Projectile(x, 100, 0, 0);
    shot.owner = owner;
    shot.roomId = roomId;
    if (kind === CATEGORY.MISSILE) shot.isMissile = true;
    if (kind === CATEGORY.SKINNY_MISSILE) shot.isSkinnyMissile = true;
    if (kind === CATEGORY.LASER) shot.isLaser = true;
    if (kind === CATEGORY.ORB) shot.isOrb = true;
    return shot;
};

test('projectile combat classification excludes special-control representations', () => {
    assert.equal(getProjectileCombatCategory(projectile(CATEGORY.MISSILE)), CATEGORY.MISSILE);
    assert.equal(getProjectileCombatCategory(projectile(CATEGORY.SKINNY_MISSILE)), CATEGORY.SKINNY_MISSILE);
    assert.equal(getProjectileCombatCategory(projectile(CATEGORY.LASER)), CATEGORY.LASER);
    assert.equal(getProjectileCombatCategory(projectile(CATEGORY.ORB)), CATEGORY.ORB);
    assert.equal(getProjectileCombatCategory(projectile(CATEGORY.ORDINARY_GUN)), CATEGORY.ORDINARY_GUN);
    for (const flag of ['isTentacle', 'isOrbital', 'isDecoy']) {
        const special = projectile(CATEGORY.ORDINARY_GUN);
        special[flag] = true;
        assert.equal(getProjectileCombatCategory(special), CATEGORY.OTHER, flag);
    }
});

test('pure projectile hierarchy resolves laser, orb, ordinary, and missile outcomes', () => {
    assert.equal(resolveProjectileConsumption(CATEGORY.LASER, CATEGORY.ORDINARY_GUN), CONSUMPTION.NEITHER);
    assert.equal(resolveProjectileConsumption(CATEGORY.LASER, CATEGORY.ORB), CONSUMPTION.SECOND);
    assert.equal(resolveProjectileConsumption(CATEGORY.ORB, CATEGORY.LASER), CONSUMPTION.FIRST);
    assert.equal(resolveProjectileConsumption(CATEGORY.ORB, CATEGORY.ORDINARY_GUN), CONSUMPTION.SECOND);
    assert.equal(resolveProjectileConsumption(CATEGORY.ORB, CATEGORY.ORB), CONSUMPTION.BOTH);
    assert.equal(resolveProjectileConsumption(CATEGORY.ORDINARY_GUN, CATEGORY.ORDINARY_GUN), CONSUMPTION.NEITHER);
    assert.equal(resolveProjectileConsumption(CATEGORY.LASER, CATEGORY.LASER), CONSUMPTION.NEITHER);
    for (const damaging of [CATEGORY.ORDINARY_GUN, CATEGORY.LASER, CATEGORY.ORB, CATEGORY.MISSILE, CATEGORY.SKINNY_MISSILE]) {
        assert.notEqual(resolveProjectileConsumption(damaging, CATEGORY.MISSILE), CONSUMPTION.NEITHER, damaging);
    }
});

function collisionGame(projectiles, gameState = GAME_MODE.SOLO) {
    const explosions = [];
    const game = {
        gameState, projectiles, players: [], asteroids: [], hazards: [], experimentalDoors: [],
        experimentalAreaIndexes: null, audio: { playSpatial() {}, playSpatialUnwrapped() {} }, camera: {},
        getActiveCameras: () => [], isExperimentalBlastBlocked: () => false,
        createExplosion(x, y, radius) { explosions.push({ x, y, radius }); },
        clearAimLocksForTarget() {},
        removeProjectile(p) { return Game.prototype.removeProjectile.call(game, p); },
        detonateMissile(p) { return Game.prototype.detonateMissile.call(game, p); },
        detonateAoEProjectile(p) { return Game.prototype.detonateAoEProjectile.call(game, p); }
    };
    return { game, explosions };
}

test('authoritative pair pass enforces survivability and detonates missiles once', () => {
    const enemyA = { id: 1 };
    const enemyB = { id: 2 };
    const laser = projectile(CATEGORY.LASER, enemyA);
    const ordinary = projectile(CATEGORY.ORDINARY_GUN, enemyB);
    const { game } = collisionGame([laser, ordinary]);
    Game.prototype.checkCollisions.call(game);
    assert.deepEqual(game.projectiles, [laser, ordinary]);

    const orb = projectile(CATEGORY.ORB, enemyB);
    game.projectiles.push(orb);
    Game.prototype.checkCollisions.call(game);
    assert.deepEqual(game.projectiles, [laser, ordinary]);

    const interceptor = projectile(CATEGORY.LASER, enemyA);
    const missile = projectile(CATEGORY.MISSILE, enemyB);
    game.projectiles.push(interceptor, missile);
    Game.prototype.checkCollisions.call(game);
    assert.deepEqual(game.projectiles, [laser, ordinary, interceptor]);
    assert.equal(missile.hasDetonated, true);
});

test('ordinary interception consumes both shots while orbs survive missile interception', () => {
    const enemyA = { id: 1 };
    const enemyB = { id: 2 };
    const ordinary = projectile(CATEGORY.ORDINARY_GUN, enemyA);
    const missile = projectile(CATEGORY.MISSILE, enemyB);
    const first = collisionGame([ordinary, missile]).game;
    Game.prototype.checkCollisions.call(first);
    assert.deepEqual(first.projectiles, []);
    assert.equal(missile.hasDetonated, true);

    const orb = projectile(CATEGORY.ORB, enemyA);
    const skinny = projectile(CATEGORY.SKINNY_MISSILE, enemyB);
    const second = collisionGame([orb, skinny]).game;
    Game.prototype.checkCollisions.call(second);
    assert.deepEqual(second.projectiles, [orb]);
    assert.equal(skinny.hasDetonated, true);
});

test('laser survives orb interception in either projectile order', () => {
    for (const orbFirst of [false, true]) {
        const laser = projectile(CATEGORY.LASER, { id: 1 });
        const orb = projectile(CATEGORY.ORB, { id: 2 });
        const game = collisionGame(orbFirst ? [orb, laser] : [laser, orb]).game;
        Game.prototype.checkCollisions.call(game);
        assert.deepEqual(game.projectiles, [laser]);
    }
});

test('standard and skinny missiles consume and detonate each other exactly once', () => {
    const standard = projectile(CATEGORY.MISSILE, { id: 1 });
    const skinny = projectile(CATEGORY.SKINNY_MISSILE, { id: 2 });
    const { game, explosions } = collisionGame([standard, skinny]);
    Game.prototype.checkCollisions.call(game);
    assert.deepEqual(game.projectiles, []);
    assert.equal(standard.hasDetonated, true);
    assert.equal(skinny.hasDetonated, true);
    assert.equal(explosions.length, 2);
});

test('ownerless damaging projectiles intercept missiles', () => {
    const satelliteLaser = projectile(CATEGORY.LASER);
    const missile = projectile(CATEGORY.MISSILE, { id: 2 });
    const game = collisionGame([satelliteLaser, missile]).game;
    Game.prototype.checkCollisions.call(game);
    assert.deepEqual(game.projectiles, [satelliteLaser]);
    assert.equal(missile.hasDetonated, true);
});

test('same-owner and separate Experimental-room projectiles do not interact', () => {
    const owner = { id: 1 };
    const laser = projectile(CATEGORY.LASER, owner);
    const ordinary = projectile(CATEGORY.ORDINARY_GUN, owner);
    const standard = collisionGame([laser, ordinary]).game;
    Game.prototype.checkCollisions.call(standard);
    assert.equal(standard.projectiles.length, 2);

    const roomLaser = projectile(CATEGORY.LASER, { id: 1 }, 100, 'one');
    const roomShot = projectile(CATEGORY.ORDINARY_GUN, { id: 2 }, 100, 'two');
    const experimental = collisionGame([roomLaser, roomShot], GAME_MODE.EXPERIMENTAL).game;
    experimental.experimentalAreaIndexes = new Map([
        ['one', { projectiles: new Set([roomLaser]) }],
        ['two', { projectiles: new Set([roomShot]) }]
    ]);
    Game.prototype.checkCollisions.call(experimental);
    assert.equal(experimental.projectiles.length, 2);
});

test('sandbox projectile interception is wrap-aware', () => {
    const laser = projectile(CATEGORY.LASER, { id: 1 }, 4);
    const ordinary = projectile(CATEGORY.ORDINARY_GUN, { id: 2 }, WORLD_WIDTH - 4);
    const game = collisionGame([laser, ordinary]).game;
    Game.prototype.checkCollisions.call(game);
    assert.deepEqual(game.projectiles, [laser, ordinary]);
});

test('sandbox projectile broad phase resolves missile interception across the wrap seam', () => {
    const laser = projectile(CATEGORY.LASER, { id: 1 }, 4);
    const missile = projectile(CATEGORY.MISSILE, { id: 2 }, WORLD_WIDTH - 4);
    const game = collisionGame([laser, missile]).game;
    Game.prototype.checkCollisions.call(game);
    assert.deepEqual(game.projectiles, [laser]);
    assert.equal(missile.hasDetonated, true);
});
