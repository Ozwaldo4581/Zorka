import test from 'node:test';
import assert from 'node:assert/strict';

import { Asteroid } from '../entities/asteroid.js';
import { Player } from '../entities/player.js';
import { Game, SHIELD_RECHARGE_DELAYS, getShieldRechargeDelay } from '../game.js';

const collisionGame = ({ player, asteroids = [], projectiles = [] }) => ({
    players: [player], asteroids, projectiles, hazards: [],
    hitTarget(target) { target.hits++; target.isDestroyed = target.hits >= target.maxHits; },
    playerDeath: Game.prototype.playerDeath,
    resolvePlayerDamage: Game.prototype.resolvePlayerDamage,
    removeProjectile(projectile) { projectile.isRemoved = true; this.projectiles.splice(this.projectiles.indexOf(projectile), 1); },
    audio: { playSpatial() {} }, getActiveCameras: () => [], createExplosion() {}, clearAimLocksForTarget() {},
    removeProjectileMethod: Game.prototype.removeProjectile
});

const runCollisions = game => Game.prototype.checkCollisions.call(game);

test('small asteroid contact destroys the asteroid without consuming shields or recharge progress', () => {
    const player = new Player(100, 100);
    player.spawnImmunityTimer = 0;
    player.configureShields(3, 6);
    player.shieldCharges = 2;
    player.shieldRechargeTimer = 4;
    const asteroid = new Asteroid(100, 100, 'small');
    const game = collisionGame({ player, asteroids: [asteroid] });

    runCollisions(game);

    assert.equal(player.shieldCharges, 2);
    assert.equal(player.shieldRechargeTimer, 4);
    assert.equal(player.isDead, false);
    assert.equal(asteroid.isDestroyed, true);
});

test('small asteroid contact cannot damage an unshielded player', () => {
    const player = new Player(100, 100);
    player.spawnImmunityTimer = 0;
    player.configureShields(0, 6);
    const asteroid = new Asteroid(100, 100, 'small');
    runCollisions(collisionGame({ player, asteroids: [asteroid] }));
    assert.equal(player.isDead, false);
    assert.equal(player.shieldCharges, 0);
});

test('large asteroid contact clears shields, preserves HP timing, and forces one destruction', () => {
    const player = new Player(100, 100);
    player.spawnImmunityTimer = 0;
    player.configureShields(5, 6);
    player.currentHP = 1;
    player.hpRechargeTimer = 12;
    const asteroid = new Asteroid(100, 100, 'large');
    const game = collisionGame({ player, asteroids: [asteroid] });

    runCollisions(game);

    assert.deepEqual([player.shieldCharges, player.currentHP, player.hpRechargeTimer, player.isDead], [0, 1, 12, false]);
    assert.equal(asteroid.hits, asteroid.maxHits);
    assert.equal(asteroid.isDestroyed, true);
});

test('large asteroid contact cannot kill an unshielded player', () => {
    const player = new Player(100, 100);
    player.spawnImmunityTimer = 0;
    const asteroid = new Asteroid(100, 100, 'large');
    runCollisions(collisionGame({ player, asteroids: [asteroid] }));
    assert.deepEqual([player.shieldCharges, player.currentHP, player.isDead], [0, 5, false]);
    assert.equal(asteroid.isDestroyed, true);
});

test('large collision reuses asteroid destruction for Medium children without rewards', t => {
    t.mock.method(globalThis, 'setTimeout', () => 0);
    const player = new Player(100, 100);
    player.spawnImmunityTimer = 0;
    player.configureShields(2, 6);
    const asteroid = new Asteroid(100, 100, 'large');
    const game = collisionGame({ player, asteroids: [asteroid] });
    const spawned = [];
    game.hitTarget = Game.prototype.hitTarget;
    game.spawnAsteroid = (size, x, y) => spawned.push({ size, x, y });
    game.awardXP = Game.prototype.awardXP;
    game.gameState = 'SOLO';

    runCollisions(game);

    assert.deepEqual(spawned, Array.from({ length: 3 }, () => ({ size: 'medium', x: 100, y: 100 })));
    assert.equal(game.asteroids.includes(asteroid), false);
    assert.equal(player.totalXP, 0);
});

test('medium asteroid contact routes five damage through shields then HP only once per contact', () => {
    const player = new Player(100, 100);
    player.spawnImmunityTimer = 0;
    player.configureShields(3, 6);
    const asteroid = new Asteroid(100, 100, 'medium');
    const game = collisionGame({ player, asteroids: [asteroid] });

    runCollisions(game);
    assert.deepEqual([player.shieldCharges, player.currentHP, player.hpRechargeTimer, player.isDead], [0, 3, 20, false]);
    assert.equal(asteroid.isDestroyed, false);

    runCollisions(game);
    assert.deepEqual([player.shieldCharges, player.currentHP], [0, 3]);
});

test('medium asteroid damage can be fully shielded or blocked by spawn immunity', () => {
    const shielded = new Player(100, 100);
    shielded.spawnImmunityTimer = 0;
    shielded.configureShields(10, 6);
    shielded.hpRechargeTimer = 9;
    runCollisions(collisionGame({ player: shielded, asteroids: [new Asteroid(100, 100, 'medium')] }));
    assert.deepEqual([shielded.shieldCharges, shielded.currentHP, shielded.hpRechargeTimer], [5, 5, 9]);

    const immune = new Player(100, 100);
    immune.configureShields(5, 6);
    runCollisions(collisionGame({ player: immune, asteroids: [new Asteroid(100, 100, 'medium')] }));
    assert.deepEqual([immune.shieldCharges, immune.currentHP, immune.isDead], [5, 5, false]);
});

test('small asteroid projectile collision still removes the projectile and hits the asteroid', () => {
    const player = new Player(1000, 1000);
    const asteroid = new Asteroid(100, 100, 'small');
    const projectile = { x: 100, y: 100, radius: 2, owner: player, aoeRadius: 0 };
    const game = collisionGame({ player, asteroids: [asteroid], projectiles: [projectile] });
    runCollisions(game);
    assert.equal(projectile.isRemoved, true);
    assert.equal(asteroid.isDestroyed, true);
});

test('recharge option mapping is explicit and defaults to the middle rate', () => {
    assert.deepEqual(SHIELD_RECHARGE_DELAYS, { 0: null, 1: 10, 2: 7, 3: 4, 4: 1.5, 5: 0.5 });
    assert.equal(getShieldRechargeDelay(3), 4);
    assert.equal(getShieldRechargeDelay(99), 4);
});

test('Arena shield configuration becomes current and maximum Player state', () => {
    const player = new Player(0, 0);
    Game.prototype.configurePlayerShields.call({ startingShieldCharges: 3, shieldRechargeRate: 3 }, player);
    assert.equal(player.shieldCharges, 3);
    assert.equal(player.maxShieldCharges, 3);
    assert.equal(player.shieldRechargeDelay, 4);
});

test('missing shields restore one per interval and never exceed maximum', () => {
    const player = new Player(0, 0);
    player.configureShields(3, 6);
    player.shieldCharges = 0;
    player.hasForcefield = false;
    player.updateShieldRecharge(6);
    assert.equal(player.shieldCharges, 1);
    player.updateShieldRecharge(6);
    assert.equal(player.shieldCharges, 2);
    player.updateShieldRecharge(6);
    player.updateShieldRecharge(100);
    assert.equal(player.shieldCharges, 3);
});

test('shield loss restarts recharge progress', () => {
    const player = new Player(0, 0);
    player.configureShields(3, 6);
    player.consumeShield();
    player.updateShieldRecharge(4);
    player.consumeShield();
    assert.equal(player.shieldRechargeTimer, 0);
    player.updateShieldRecharge(2);
    assert.equal(player.shieldCharges, 1);
    player.updateShieldRecharge(4);
    assert.equal(player.shieldCharges, 2);
});

test('zero capacity disables recharge and zero delay restores safely on one update', () => {
    const disabled = new Player(0, 0);
    disabled.configureShields(0, 0);
    disabled.updateShieldRecharge(100);
    assert.equal(disabled.shieldCharges, 0);

    const immediate = new Player(0, 0);
    immediate.configureShields(3, 0);
    immediate.consumeShield();
    immediate.updateShieldRecharge(0);
    assert.equal(immediate.shieldCharges, 3);
    assert.equal(immediate.shieldRechargeTimer, 0);
});

test('players own independent recharge timers and lifecycle configuration resets them', () => {
    const first = new Player(0, 0);
    const second = new Player(0, 0);
    first.configureShields(3, 6);
    second.configureShields(3, 6);
    first.consumeShield();
    second.consumeShield();
    first.updateShieldRecharge(4);
    second.updateShieldRecharge(2);
    assert.equal(first.shieldRechargeTimer, 4);
    assert.equal(second.shieldRechargeTimer, 2);
    first.configureShields(3, 6);
    assert.equal(first.shieldRechargeTimer, 0);
    assert.equal(first.shieldCharges, 3);
    assert.equal(second.shieldRechargeTimer, 2);
});

test('Shield upgrades increase match-local capacity and grant one current charge', () => {
    for (const [current, maximum, expectedCurrent, expectedMaximum] of [
        [2, 2, 3, 3],
        [1, 2, 2, 3],
        [0, 0, 1, 1]
    ]) {
        const player = new Player(0, 0);
        player.configureShields(maximum, 6);
        player.restoreShieldCharges(current);
        player.shieldRechargeTimer = 5;
        player.applyShieldUpgrade();
        assert.equal(player.shieldCharges, expectedCurrent);
        assert.equal(player.maxShieldCharges, expectedMaximum);
        assert.equal(player.hasForcefield, true);
        assert.equal(player.shieldRechargeTimer, 0);
    }
});

test('slot five always applies Shield and consumes the capsule stack', () => {
    const player = new Player(0, 0);
    player.configureShields(2, 6);
    player.powerUpCapsules = 5;
    player.powerUpError = 'OLD ERROR';
    player.activatePowerUp();
    assert.equal(player.shieldCharges, 3);
    assert.equal(player.maxShieldCharges, 3);
    assert.equal(player.powerUpCapsules, 0);
    assert.equal(player.powerUpError, null);
});

test('respawn restores starting charges without erasing upgraded capacity', () => {
    const player = new Player(0, 0);
    player.configureShields(2, 6);
    player.applyShieldUpgrade();
    player.restoreShieldCharges(0);

    player.restoreShieldCharges(2);

    assert.equal(player.shieldCharges, 2);
    assert.equal(player.maxShieldCharges, 3);
    player.updateShieldRecharge(6);
    assert.equal(player.shieldCharges, 3);
});
