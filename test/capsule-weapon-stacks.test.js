import test from 'node:test';
import assert from 'node:assert/strict';

import { Player, MAX_STACKABLE_WEAPON_STREAMS } from '../entities/player.js';
import { PLAYER_COLORS, chooseOrdinaryNPCColor } from '../game.js';

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
    assert.deepEqual(player.weaponStreamCounts, { Laser: 0, Antigun: 0, Double: 0, Orb: 0 });
});

test('Orb stacks to three centered streams, shares projectile scaling, and clears on life reset', () => {
    const player = new Player(100, 100);
    const originalRadius = player.radius;
    player.projectileUpgradeCount = 4;
    for (let streams = 1; streams <= MAX_STACKABLE_WEAPON_STREAMS; streams++) {
        assert.equal(select(player, 4), true);
        assert.equal(player.weaponStreamCounts.Orb, streams);
        const shots = player.getGunProjectiles(player.x, player.y, 0);
        assert.equal(shots.length, streams);
        assert.equal(shots.every(shot => shot.isOrb && shot.owner === player && shot.vx === 0), true);
        assert.ok(Math.abs(shots.reduce((sum, shot) => sum + shot.x, 0) / shots.length - player.x) < 1e-9);
    }
    player.spawnImmunityTimer = 0;
    const initialShots = player.fire();
    assert.equal(initialShots.length, MAX_STACKABLE_WEAPON_STREAMS);
    assert.equal(player.fireCooldown, 0.75);
    assert.equal(player.burstCount, player.resolveBaseProjectile().quantity - 1);
    assert.equal(player.radius, originalRadius);
    assert.equal(player.isCyborg, false);
    player.powerUpCapsules = 4;
    assert.equal(player.canActivateCapsuleSlot(4), false);
    assert.equal(player.activatePowerUp(), false);
    assert.equal(player.powerUpCapsules, 4);
    player.resetTransientLifeState();
    assert.equal(player.weaponStreamCounts.Orb, 0);
});

test('capsule tiers four and five grant Orb and Ghost while leaving Shields unchanged', () => {
    const player = new Player(0, 0);
    player.configureShields(2, 6);
    assert.equal(select(player, 4), true);
    assert.equal(player.weaponStreamCounts.Orb, 1);
    assert.equal(player.isCyborg, false);
    assert.equal('hasCyborgWeapon' in player, false);
    assert.deepEqual([player.shieldCharges, player.maxShieldCharges], [2, 2]);
    assert.equal(select(player, 5), true);
    assert.equal(player.ghosts.length, 1);
    assert.deepEqual([player.shieldCharges, player.maxShieldCharges], [2, 2]);
});

test('switching capsule guns clears the previous rank and restarts it on return', () => {
    const player = new Player(0, 0);
    for (let rank = 1; rank <= 3; rank++) assert.equal(select(player, 3), true);
    assert.equal(select(player, 3), false);
    assert.equal(player.powerUpCapsules, 3);

    assert.equal(select(player, 4), true);
    assert.equal(player.activeGun, 'Orb');
    assert.deepEqual(player.weaponStreamCounts, { Laser: 0, Antigun: 0, Double: 0, Orb: 1 });
    assert.equal(player.canActivateCapsuleSlot(3), true);

    assert.equal(select(player, 3), true);
    assert.equal(player.activeGun, 'Laser');
    assert.deepEqual(player.weaponStreamCounts, { Laser: 1, Antigun: 0, Double: 0, Orb: 0 });
});

test('ordinary NPC capsule assignment allows at most one rank-one gun', () => {
    const npc = new Player(0, 0);
    npc.isNPC = true;
    npc.slot1Type = 'Double';
    npc.applyOrdinaryNPCCapsulePowerUps(20, () => 0);
    const ranks = Object.values(npc.weaponStreamCounts);
    assert.equal(ranks.filter(rank => rank > 0).length, 1);
    assert.equal(Math.max(...ranks), 1);
});

test('ordinary NPC colors exclude every authoritative human palette color', () => {
    for (const humanColor of PLAYER_COLORS) {
        for (const random of [0, 0.5, 0.999999]) {
            assert.notEqual(chooseOrdinaryNPCColor(humanColor, () => random), humanColor);
        }
    }
    assert.equal(chooseOrdinaryNPCColor('#00ffff', () => 0, ['#00ffff']), '#ffffff');
});
