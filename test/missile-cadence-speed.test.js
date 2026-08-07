import test from 'node:test';
import assert from 'node:assert/strict';

import { Player } from '../entities/player.js';

function selectMissile(player) {
    player.powerUpCapsules = 2;
    return player.activatePowerUp();
}

function firePrimary(player) {
    player.fireCooldown = 0;
    return player.fire() || [];
}

test('Missile capsules cap at level three and reset without consuming a fourth capsule', () => {
    const player = new Player(0, 0);
    player.spawnImmunityTimer = 0;

    for (let level = 1; level <= 3; level++) {
        assert.equal(selectMissile(player), true);
        assert.equal(player.missileLevel, level);
    }
    player.powerUpCapsules = 2;
    assert.equal(player.canActivateCapsuleSlot(2), false);
    assert.equal(player.activatePowerUp(), false);
    assert.equal(player.powerUpCapsules, 2);
    assert.equal(player.missileLevel, 3);

    player.missileShotCounter = 2;
    player.resetTransientLifeState();
    assert.deepEqual([player.hasMissile, player.missileLevel, player.missileShotCounter], [false, 0, 0]);
});

test('Missile levels use primary-shot cadence and ignore burst follow-up shots', () => {
    for (const [level, expectedCycles] of [[1, [3, 6]], [2, [2, 4, 6]], [3, [1, 2, 3, 4, 5, 6]]]) {
        const player = new Player(0, 0);
        player.spawnImmunityTimer = 0;
        for (let i = 0; i < level; i++) assert.equal(selectMissile(player), true);

        const missileCycles = [];
        for (let cycle = 1; cycle <= 6; cycle++) {
            const primary = firePrimary(player);
            if (primary.some(shot => shot.isMissile)) missileCycles.push(cycle);
            const counterAfterPrimary = player.missileShotCounter;
            player.fire(true);
            assert.equal(player.missileShotCounter, counterAfterPrimary);
        }
        assert.deepEqual(missileCycles, expectedCycles, `level ${level}`);
    }
});

test('Missile launch and homing retain 80 percent of the normal ship speed cap', () => {
    for (const speedUpgradeCount of [0, 10]) {
        const player = new Player(0, 0);
        player.speedUpgradeCount = speedUpgradeCount;
        const missile = player.createMissile(0, 0, 0);
        const expectedSpeed = player.getNormalShipSpeedCap() * 0.8;
        assert.equal(Math.hypot(missile.vx, missile.vy), expectedSpeed);

        const target = { x: 100, y: 100, isDead: false, isEliminated: false };
        player.lockedAimTarget = target;
        missile.updateMissile(0.1, [], [player, target], [], []);
        assert.ok(Math.abs(Math.hypot(missile.vx, missile.vy) - expectedSpeed) < 1e-9);
    }
});
