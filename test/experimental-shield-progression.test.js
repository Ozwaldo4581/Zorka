import test from 'node:test';
import assert from 'node:assert/strict';

import { Player } from '../entities/player.js';
import { ExperimentalProfileStore, EXPERIMENTAL_PROFILE_STORAGE_KEY } from '../persistence/experimental_profiles.js';

class Storage {
    constructor(payload) { this.value = JSON.stringify(payload); }
    getItem(key) { return key === EXPERIMENTAL_PROFILE_STORAGE_KEY ? this.value : null; }
    setItem(key, value) { if (key === EXPERIMENTAL_PROFILE_STORAGE_KEY) this.value = value; }
}

test('human level gains add permanent maximum shields while NPC initialization does not', () => {
    const human = new Player(0, 0);
    human.configureShields(3, 6);
    human.shieldCharges = 1;
    assert.equal(human.addXP(500), 2);
    assert.deepEqual([human.level, human.maxShieldCharges, human.shieldCharges], [2, 5, 1]);

    const npc = Object.assign(new Player(0, 0, 2), { isNPC: true });
    npc.configureShields(3, 6);
    assert.equal(npc.initializeNPCLevel(6, () => 0), true);
    assert.equal(npc.maxShieldCharges, 3);
});

test('Shield Recharge improves monotonically through ten without changing capacity', () => {
    const player = new Player(0, 0);
    player.configureShields(3, 6);
    player.pendingLevelUps = 11;
    const delays = [player.shieldRechargeDelay];
    for (let level = 1; level <= 10; level++) {
        assert.equal(player.applyLevelUpgrade('shield'), true);
        delays.push(player.shieldRechargeDelay);
        assert.equal(player.maxShieldCharges, 3);
    }
    assert.ok(delays.every((delay, index) => index === 0 || delay < delays[index - 1]));
    assert.equal(delays.at(-1), 1);
    assert.equal(player.applyLevelUpgrade('shield'), false);
});

test('Projectile progression and firing safely support ten selections', () => {
    const player = new Player(0, 0);
    player.pendingLevelUps = 11;
    for (let level = 1; level <= 10; level++) assert.equal(player.applyLevelUpgrade('projectile'), true);
    assert.equal(player.applyLevelUpgrade('projectile'), false);
    assert.equal(player.resolveBaseProjectile().quantity, 13);
    player.spawnImmunityTimer = 0;
    assert.ok(player.fire().length > 0);
    assert.equal(player.burstCount, 12);
});

test('respawn reset and the existing hull recharge event restore shields to maximum', () => {
    const player = new Player(0, 0);
    player.configureShields(3, 6);
    player.addXP(100);
    player.shieldCharges = 0;
    player.resetTransientLifeState();
    assert.deepEqual([player.shieldCharges, player.maxShieldCharges, player.shieldRechargeTimer], [4, 4, 0]);

    player.shieldCharges = 0;
    player.currentHP = player.maxHP - 1;
    player.hpRechargeTimer = 20;
    player.updateHPRecharge(20);
    assert.deepEqual([player.currentHP, player.maxHP, player.shieldCharges, player.hpRechargeTimer],
        [player.maxHP, player.maxHP, player.maxShieldCharges, 0]);
});

test('schema two shield selections migrate to recharge and schema three round-trips level ten', () => {
    const storage = new Storage({ version: 2, slots: [{
        name: 'Legacy', level: 20, totalXP: 1000, pendingLevelUps: 0,
        projectileUpgradeCount: 5, speedUpgradeCount: 2, levelShieldUpgradeCount: 3
    }] });
    const store = new ExperimentalProfileStore(storage);
    const legacy = store.getProfile(0);
    assert.deepEqual([legacy.version, legacy.projectileUpgradeCount, legacy.shieldRechargeUpgradeCount], [4, 5, 3]);
    const saved = store.updateProfile(0, { ...legacy, projectileUpgradeCount: 10, shieldRechargeUpgradeCount: 10 });
    assert.deepEqual([saved.projectileUpgradeCount, saved.shieldRechargeUpgradeCount], [10, 10]);
    assert.deepEqual(store.getProfile(0), saved);
});
