import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ExperimentalProfileStore,
    EXPERIMENTAL_PROFILE_SCHEMA_VERSION,
    EXPERIMENTAL_PROFILE_SLOT_COUNT,
    EXPERIMENTAL_PROFILE_STORAGE_KEY
} from '../persistence/experimental_profiles.js';

class FakeStorage {
    constructor(entries = {}) { this.entries = new Map(Object.entries(entries)); this.writes = 0; }
    getItem(key) { return this.entries.has(key) ? this.entries.get(key) : null; }
    setItem(key, value) { this.entries.set(key, value); this.writes++; }
}

test('missing profile storage returns five empty slots', () => {
    const store = new ExperimentalProfileStore(new FakeStorage());
    assert.deepEqual(store.loadSlots(), Array(EXPERIMENTAL_PROFILE_SLOT_COUNT).fill(null));
});

test('creating and updating one trimmed profile preserves every other slot', () => {
    const storage = new FakeStorage();
    const store = new ExperimentalProfileStore(storage);
    const created = store.createProfile(2, '  Nova  ');
    assert.equal(created.name, 'Nova');
    assert.equal(created.level, 0);
    assert.equal(created.totalXP, 0);
    assert.deepEqual(store.getSummaries(), [null, null, { slot: 2, name: 'Nova', level: 0 }, null, null]);

    store.updateProfile(2, {
        name: 'Ignored rename', level: 4, totalXP: 750, pendingLevelUps: 1,
        projectileUpgradeCount: 1, speedUpgradeCount: 1, shieldRechargeUpgradeCount: 1,
        powerUpCapsules: 5, activeGun: 'Laser', roomId: 'experimental-room-9'
    });
    assert.deepEqual(store.getProfile(2), {
        version: 4, slot: 2, name: 'Nova', level: 4, totalXP: 750, pendingLevelUps: 1,
        projectileUpgradeCount: 1, speedUpgradeCount: 1, shieldRechargeUpgradeCount: 1, deaths: 0,
        unlockedShortcutIds: []
    });
    assert.equal(store.loadSlots().filter(Boolean).length, 1);
    assert.equal(JSON.parse(storage.getItem(EXPERIMENTAL_PROFILE_STORAGE_KEY)).version, EXPERIMENTAL_PROFILE_SCHEMA_VERSION);
});

test('names are bounded and blank names are rejected', () => {
    const store = new ExperimentalProfileStore(new FakeStorage());
    assert.throws(() => store.createProfile(0, '   '), /profile name/i);
    assert.equal(store.createProfile(0, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ').name, 'ABCDEFGHIJKLMNOPQRST');
});

test('corrupt and unavailable storage recover without repeated warnings', () => {
    const warnings = [];
    const corrupt = new FakeStorage({ [EXPERIMENTAL_PROFILE_STORAGE_KEY]: '{broken' });
    const store = new ExperimentalProfileStore(corrupt, { warn: message => warnings.push(message) });
    assert.deepEqual(store.loadSlots(), Array(5).fill(null));
    assert.deepEqual(store.loadSlots(), Array(5).fill(null));
    assert.equal(warnings.length, 1);

    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    const fallback = new ExperimentalProfileStore(blocked, { warn() {} });
    fallback.createProfile(1, 'Session Pilot');
    assert.equal(fallback.getProfile(1).name, 'Session Pilot');
});

test('stored values are normalized, truncated, migrated, and stripped of temporary data', () => {
    const slots = Array.from({ length: 7 }, (_, slot) => ({
        name: ` Pilot ${slot} `,
        level: slot === 0 ? -4 : 2,
        totalXP: slot === 0 ? 'bad' : 200,
        projectileUpgradeCount: -3,
        speedUpgradeCount: Number.NaN,
        levelShieldUpgradeCount: -1,
        powerUpCapsules: 5,
        activeGun: 'Laser'
    }));
    const storage = new FakeStorage({ [EXPERIMENTAL_PROFILE_STORAGE_KEY]: JSON.stringify(slots) });
    const profiles = new ExperimentalProfileStore(storage).loadSlots();
    assert.equal(profiles.length, 5);
    assert.deepEqual(profiles[0], {
        version: 4, slot: 0, name: 'Pilot 0', level: 0, totalXP: 0, pendingLevelUps: 0,
        projectileUpgradeCount: 0, speedUpgradeCount: 0, shieldRechargeUpgradeCount: 0, deaths: 0,
        unlockedShortcutIds: []
    });
    assert.equal('powerUpCapsules' in profiles[0], false);
    assert.equal('activeGun' in profiles[0], false);
});

test('version 1 migration preserves existing progression and permanent bonuses', () => {
    const storage = new FakeStorage({ [EXPERIMENTAL_PROFILE_STORAGE_KEY]: JSON.stringify({
        version: 1,
        slots: [{
            name: 'Veteran', level: 1, totalXP: 237, pendingLevelUps: 0,
            projectileUpgradeCount: 1, speedUpgradeCount: 2, levelShieldUpgradeCount: 3
        }, { name: 'Early Tester', level: 0, totalXP: 42 }]
    }) });
    const [veteran, earlyTester] = new ExperimentalProfileStore(storage).loadSlots();
    assert.deepEqual(veteran, {
        version: 4, slot: 0, name: 'Veteran', level: 1, totalXP: 237, pendingLevelUps: 0,
        projectileUpgradeCount: 1, speedUpgradeCount: 2, shieldRechargeUpgradeCount: 3, deaths: 0,
        unlockedShortcutIds: []
    });
    assert.equal(earlyTester.level, 0);
    assert.equal(earlyTester.totalXP, 42);
});

test('shortcut unlocks normalize by stable ID, persist, and reset only through the focused helper', () => {
    const storage = new FakeStorage();
    const store = new ExperimentalProfileStore(storage);
    store.createProfile(0, 'Pathfinder');
    store.updateProfile(0, {
        name: 'ignored',
        unlockedShortcutIds: ['sector-1-to-4', 'unknown', 'sector-1-to-4', 'sector-1-to-8']
    });
    assert.deepEqual(store.getProfile(0).unlockedShortcutIds, ['sector-1-to-4', 'sector-1-to-8']);
    assert.deepEqual(new ExperimentalProfileStore(storage).getProfile(0).unlockedShortcutIds, ['sector-1-to-4', 'sector-1-to-8']);
    assert.deepEqual(store.resetShortcutUnlocks(0).unlockedShortcutIds, []);
    assert.deepEqual(store.getSummaries()[0], { slot: 0, name: 'Pathfinder', level: 0 });
});
