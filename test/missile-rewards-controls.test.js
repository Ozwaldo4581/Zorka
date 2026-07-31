import test from 'node:test';
import assert from 'node:assert/strict';

import { Game, WORLD_WIDTH } from '../game.js';
import { Player } from '../entities/player.js';
import { Projectile } from '../entities/projectile.js';
import { SpaceDebris, Satellite } from '../entities/hazards.js';

const pad = (...pressed) => ({
    buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: pressed.includes(index) }))
});

test('active missiles read their firing player lock independently in real time', () => {
    const first = new Player(0, 0, 1);
    const second = new Player(0, 0, 2);
    const firstTarget = new Player(100, 0, 3);
    const secondTarget = new Player(200, 0, 4);
    first.beginAimLock(firstTarget);
    second.beginAimLock(secondTarget);

    const firstMissile = first.createMissile(0, 0, 0);
    const secondMissile = second.createMissile(0, 0, 0);
    assert.equal(firstMissile.owner, first);
    assert.equal(secondMissile.owner, second);
    firstMissile.update(0.1, [], [first, second, firstTarget, secondTarget], []);
    secondMissile.update(0.1, [], [first, second, firstTarget, secondTarget], []);
    assert.ok(firstMissile.vx > 0, 'first missile tracks its owner\'s right-side lock');
    assert.ok(secondMissile.vx > 0, 'second missile tracks its owner\'s right-side lock');

    first.beginAimLock({ ...secondTarget, x: -200 });
    firstMissile.update(0.5, [], [first, second, firstTarget, secondTarget, first.lockedAimTarget], []);
    secondMissile.update(0.1, [], [first, second, firstTarget, secondTarget], []);
    assert.ok(firstMissile.vx < 0, 'changing player one lock redirects its active missile');
    assert.ok(secondMissile.vx > 0, 'player one lock does not redirect player two missile');
});

test('missiles auto-acquire with wrapped distance and resume it after lock release', () => {
    const owner = new Player(100, 100, 1);
    const target = new Player(WORLD_WIDTH - 5, 100, 2);
    const lockedTarget = new Player(200, 100, 3);
    const missile = new Projectile(5, 100, 0, -100);
    missile.owner = owner;
    missile.isMissile = true;

    missile.update(0.1, [], [owner, target], []);
    assert.ok(missile.vx < 0, 'missile turns left across the horizontal seam');
    assert.equal(missile.missileTarget, target);

    owner.beginAimLock(lockedTarget);
    missile.update(0.5, [], [owner, target, lockedTarget], []);
    assert.ok(missile.vx > 0, 'live lock overrides the automatic target');
    assert.equal(missile.missileTarget, target, 'lock does not replace automatic fallback state');

    owner.clearAimLock();
    missile.vx = 0;
    missile.vy = -100;
    missile.update(0.1, [], [owner, target, lockedTarget], []);
    assert.ok(missile.vx < 0, 'automatic target resumes immediately after release');

    target.isDead = true;
    missile.update(0.1, [], [owner, target], []);
    assert.equal(missile.missileTarget, null, 'destroyed automatic target is discarded safely');
});

test('an invalid live lock falls back without changing the owner lock or another missile', () => {
    const first = new Player(0, 0, 1);
    const second = new Player(3000, 0, 2);
    const firstFallback = new Player(-200, 0, 3);
    const secondLock = new Player(200, 0, 4);
    const destroyedLock = new Player(300, 0, 5);
    destroyedLock.isDead = true;
    first.beginAimLock(destroyedLock);
    second.beginAimLock(secondLock);

    const firstMissile = first.createMissile(0, 0, 0);
    const secondMissile = second.createMissile(0, 0, 0);
    const players = [first, second, firstFallback, secondLock, destroyedLock];
    firstMissile.update(0.1, [], players, []);
    secondMissile.update(0.1, [], players, []);

    assert.equal(firstMissile.missileTarget, firstFallback);
    assert.ok(firstMissile.vx < 0, 'invalid lock immediately uses automatic acquisition');
    assert.ok(secondMissile.vx > 0, 'another owner\'s valid lock remains effective');
    assert.equal(first.lockedAimTarget, destroyedLock, 'projectile validation does not mutate player truth');
    assert.equal(second.lockedAimTarget, secondLock);
});

const rewardGame = killer => ({
    players: [killer], asteroids: [], hazards: [], gameState: 'SOLO',
    audio: { playSpatial() {} }, getActiveCameras: () => [], createExplosion() {},
    spawnSatellite() {}, spawnSpaceDebris() {}, awardXP: Game.prototype.awardXP
});

test('debris and satellites award existing XP without capsules', () => {
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = () => 0;
    try {
        for (const [target, xp] of [[new SpaceDebris(0, 0), 5], [new Satellite(0, 0), 15]]) {
            const killer = new Player(100, 100);
            const game = rewardGame(killer);
            game.hazards = [target];
            target.maxHits = 1;
            Game.prototype.hitTarget.call(game, target, killer);
            assert.equal(killer.totalXP, xp);
            assert.equal(killer.powerUpCapsules, 0);
            assert.equal(killer.totalCapsulesGained, 0);
        }
    } finally {
        globalThis.setTimeout = originalSetTimeout;
    }
});

test('controller face buttons dispatch distinct player intents on press edges', () => {
    const player = new Player(0, 0);
    player.powerUpCapsules = 1;
    player.pendingLevelUps = 3;

    player.handleGamepadPowerUpIntents(pad(0));
    assert.equal(player.projectileUpgradeCount, 1);
    assert.equal(player.powerUpCapsules, 1, 'contextual A must not also consume capsules');
    player.handleGamepadPowerUpIntents(pad());
    player.handleGamepadPowerUpIntents(pad(3));
    assert.equal(player.speedUpgradeCount, 1);
    player.handleGamepadPowerUpIntents(pad());
    player.handleGamepadPowerUpIntents(pad(1));
    assert.equal(player.levelShieldUpgradeCount, 1);
    assert.equal(player.pendingLevelUps, 0);

    player.handleGamepadPowerUpIntents(pad());
    player.handleGamepadPowerUpIntents(pad(0));
    assert.equal(player.powerUpCapsules, 0, 'normal A resumes capsule activation');

    player.pendingLevelUps = 1;
    player.handleGamepadPowerUpIntents(pad());
    player.handleGamepadPowerUpIntents(pad(2));
    assert.equal(player.projectileUpgradeCount, 2, 'X remains Projectile');
});
