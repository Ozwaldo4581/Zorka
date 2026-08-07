import test from 'node:test';
import assert from 'node:assert/strict';

import { Player } from '../entities/player.js';

function readyPlayer() {
    const player = new Player(100, 100);
    player.spawnImmunityTimer = 0;
    return player;
}

function selectMissile(player) {
    player.powerUpCapsules = 2;
    return player.activatePowerUp();
}

test('Missile capsule progression caps at three without changing firing cadence', () => {
    const player = readyPlayer();

    for (let expectedLevel = 1; expectedLevel <= 3; expectedLevel++) {
        assert.equal(selectMissile(player), true);
        assert.equal(player.missileLevel, expectedLevel);
        assert.equal(player.hasMissile, true);

        player.fireCooldown = 0;
        const volley = player.fire().filter(projectile => projectile.isMissile);
        assert.equal(volley.length, expectedLevel);
        assert.equal(player.fireCooldown, 0.75);
    }

    assert.equal(selectMissile(player), false);
    assert.equal(player.missileLevel, 3);
});

test('missile volleys use symmetric parallel lanes at 80% of the normal speed cap', () => {
    const player = readyPlayer();
    for (let i = 0; i < 3; i++) selectMissile(player);

    const missiles = player.fire().filter(projectile => projectile.isMissile);
    assert.deepEqual(missiles.map(projectile => projectile.x), [70, 100, 130]);
    assert.deepEqual(missiles.map(projectile => projectile.y), [100, 100, 100]);
    for (const missile of missiles) {
        assert.equal(Math.hypot(missile.vx, missile.vy), player.getMaximumNormalSpeed() * 0.8);
        missile.update(0.1, [], [player], []);
        assert.equal(Math.hypot(missile.vx, missile.vy), 640, 'homing preserves launch speed');
    }
});

test('missile progression clears with transient life state', () => {
    const player = readyPlayer();
    selectMissile(player);
    selectMissile(player);

    player.resetTransientLifeState();

    assert.equal(player.hasMissile, false);
    assert.equal(player.missileLevel, 0);
    assert.equal(selectMissile(player), true);
    assert.equal(player.missileLevel, 1);
});
