import test from 'node:test';
import assert from 'node:assert/strict';

import { Player, MAX_STACKABLE_WEAPON_STREAMS } from '../entities/player.js';

const select = (player, slot) => {
    player.powerUpCapsules = slot;
    return player.activatePowerUp();
};

for (const weapon of ['Antigun', 'Double']) {
    test(`${weapon} stacks to three parallel base patterns and rejects a fourth selection`, () => {
        const player = new Player(100, 100);
        player.slot1Type = weapon;
        const basePatternSize = 2;
        for (let streams = 1; streams <= MAX_STACKABLE_WEAPON_STREAMS; streams++) {
            assert.equal(select(player, 1), true);
            assert.equal(player.weaponStreamCounts[weapon], streams);
            const shots = player.getGunProjectiles(player.x, player.y, 0);
            assert.equal(shots.length, basePatternSize * streams);
            for (let i = basePatternSize; i < shots.length; i++) {
                assert.equal(shots[i].vx, shots[i % basePatternSize].vx);
                assert.equal(shots[i].vy, shots[i % basePatternSize].vy);
                assert.equal(shots[i].owner, player);
            }
        }
        player.powerUpCapsules = 1;
        assert.equal(player.canActivateCapsuleSlot(1), false);
        assert.equal(player.activatePowerUp(), false);
        assert.equal(player.powerUpCapsules, 1);
        assert.equal(player.weaponStreamCounts[weapon], 3);
    });
}

test('Laser stacks to three centered parallel streams and clears on life reset', () => {
    const player = new Player(100, 100);
    for (let streams = 1; streams <= 3; streams++) {
        assert.equal(select(player, 3), true);
        const shots = player.getGunProjectiles(player.x, player.y, 0);
        assert.equal(shots.length, streams);
        assert.equal(shots.every(shot => shot.isLaser && shot.owner === player && shot.vx === 0), true);
        const center = shots.reduce((sum, shot) => sum + shot.x, 0) / shots.length;
        assert.ok(Math.abs(center - player.x) < 1e-9);
    }
    player.powerUpCapsules = 3;
    assert.equal(player.activatePowerUp(), false);
    assert.equal(player.powerUpCapsules, 3);
    player.resetTransientLifeState();
    assert.deepEqual(player.weaponStreamCounts, { Laser: 0, Antigun: 0, Double: 0 });
});

test('capsule tiers four and five grant Cyborg and Ghost while leaving Shields unchanged', () => {
    const player = new Player(0, 0);
    player.configureShields(2, 6);
    assert.equal(select(player, 4), true);
    assert.equal(player.hasCyborgWeapon, true);
    assert.equal(player.isCyborg, true);
    assert.deepEqual([player.shieldCharges, player.maxShieldCharges], [2, 2]);
    assert.equal(select(player, 5), true);
    assert.equal(player.ghosts.length, 1);
    assert.deepEqual([player.shieldCharges, player.maxShieldCharges], [2, 2]);
});
