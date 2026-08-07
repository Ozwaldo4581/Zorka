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

function fireTrigger(player) {
    player.fireCooldown = 0;
    return player.fire().filter(projectile => projectile.isMissile);
}

test('Missile capsule progression caps at three without changing gun cadence', () => {
    const player = readyPlayer();

    for (let expectedLevel = 1; expectedLevel <= 3; expectedLevel++) {
        assert.equal(selectMissile(player), true);
        assert.equal(player.missileLevel, expectedLevel);
        assert.equal(player.hasMissile, true);
        assert.equal(player.missileShotCounter, 0);
    }

    assert.equal(selectMissile(player), false);
    assert.equal(player.missileLevel, 3);
});

test('Missile levels trigger one missile every third, second, or first gun shot', () => {
    const expectedPatterns = [
        [0, 0, 1, 0, 0, 1],
        [0, 1, 0, 1, 0, 1],
        [1, 1, 1, 1, 1, 1]
    ];

    for (let level = 1; level <= 3; level++) {
        const player = readyPlayer();
        for (let i = 0; i < level; i++) selectMissile(player);
        const pattern = expectedPatterns[level - 1].map(() => {
            const missiles = fireTrigger(player);
            assert.ok(missiles.length <= 1, 'a gun trigger emits at most one missile');
            assert.equal(player.fireCooldown, 0.75, 'missiles retain the ordinary gun cadence');
            return missiles.length;
        });
        assert.deepEqual(pattern, expectedPatterns[level - 1]);
    }
});

test('the single triggered missile travels at 80% of the normal speed cap', () => {
    const player = readyPlayer();
    for (let i = 0; i < 3; i++) selectMissile(player);

    const [missile] = fireTrigger(player);
    assert.deepEqual({ x: missile.x, y: missile.y }, { x: player.x, y: player.y });
    assert.equal(Math.hypot(missile.vx, missile.vy), player.getMaximumNormalSpeed() * 0.8);
    missile.update(0.1, [], [player], []);
    assert.equal(Math.hypot(missile.vx, missile.vy), 640, 'homing preserves launch speed');
});

test('fired missiles expire so sustained fire cannot grow the live collection forever', () => {
    const player = readyPlayer();
    for (let i = 0; i < 3; i++) selectMissile(player);

    const [missile] = fireTrigger(player);
    assert.equal(missile.lifeSpan, 30);
    missile.update(30.01, [], [player], []);
    assert.ok(missile.lifeSpan < 0);
});

test('missile progression clears with transient life state', () => {
    const player = readyPlayer();
    selectMissile(player);
    selectMissile(player);

    player.resetTransientLifeState();

    assert.equal(player.hasMissile, false);
    assert.equal(player.missileLevel, 0);
    assert.equal(player.missileShotCounter, 0);
    assert.equal(selectMissile(player), true);
    assert.equal(player.missileLevel, 1);
});
