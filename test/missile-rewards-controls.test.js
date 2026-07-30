import test from 'node:test';
import assert from 'node:assert/strict';

import { Game, WORLD_WIDTH } from '../game.js';
import { Player } from '../entities/player.js';
import { Projectile } from '../entities/projectile.js';
import { SpaceDebris, Satellite } from '../entities/hazards.js';

const pad = (...pressed) => ({
    buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: pressed.includes(index) }))
});

test('missiles snapshot their firing player lock independently', () => {
    const first = new Player(0, 0, 1);
    const second = new Player(0, 0, 2);
    const firstTarget = new Player(100, 0, 3);
    const secondTarget = new Player(200, 0, 4);
    first.beginAimLock(firstTarget);
    second.beginAimLock(secondTarget);

    const firstMissile = first.createMissile(0, 0, 0);
    const secondMissile = second.createMissile(0, 0, 0);
    first.beginAimLock(secondTarget);

    assert.equal(firstMissile.owner, first);
    assert.equal(firstMissile.missileTarget, firstTarget);
    assert.equal(secondMissile.owner, second);
    assert.equal(secondMissile.missileTarget, secondTarget);
});

test('missile steering uses the nearest wrapped target and clears invalid targets', () => {
    const owner = new Player(100, 100, 1);
    const target = new Player(WORLD_WIDTH - 5, 100, 2);
    const missile = new Projectile(5, 100, 0, -100);
    missile.owner = owner;
    missile.isMissile = true;
    missile.missileTarget = target;

    missile.update(0.1, [], [owner, target], []);
    assert.ok(missile.vx < 0, 'missile turns left across the horizontal seam');
    assert.equal(missile.missileTarget, target);

    target.isDead = true;
    missile.update(0.1, [], [owner, target], []);
    assert.equal(missile.missileTarget, null);
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
    assert.equal(player.powerUpCapsules, 0);
    assert.equal(player.pendingLevelUps, 3);
    player.handleGamepadPowerUpIntents(pad(0));

    player.handleGamepadPowerUpIntents(pad());
    player.handleGamepadPowerUpIntents(pad(2));
    assert.equal(player.projectileUpgradeCount, 1);
    player.handleGamepadPowerUpIntents(pad());
    player.handleGamepadPowerUpIntents(pad(3));
    assert.equal(player.speedUpgradeCount, 1);
    player.handleGamepadPowerUpIntents(pad());
    player.handleGamepadPowerUpIntents(pad(1));
    assert.equal(player.levelShieldUpgradeCount, 1);
    assert.equal(player.pendingLevelUps, 0);
});
