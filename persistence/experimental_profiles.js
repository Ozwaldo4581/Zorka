export const EXPERIMENTAL_PROFILE_STORAGE_KEY = 'zorka.experimentalProfiles.v1';
export const EXPERIMENTAL_PROFILE_SCHEMA_VERSION = 3;
export const EXPERIMENTAL_PROFILE_SLOT_COUNT = 5;
export const EXPERIMENTAL_PROFILE_NAME_MAX_LENGTH = 20;

const emptySlots = () => Array(EXPERIMENTAL_PROFILE_SLOT_COUNT).fill(null);
const integer = (value, minimum = 0) => Number.isFinite(Number(value))
    ? Math.max(minimum, Math.floor(Number(value)))
    : minimum;

export function normalizeExperimentalProfile(profile, slot) {
    if (!profile || typeof profile !== 'object') return null;
    const name = String(profile.name ?? '').trim().slice(0, EXPERIMENTAL_PROFILE_NAME_MAX_LENGTH);
    if (!name) return null;
    const level = integer(profile.level);
    const projectileUpgradeCount = Math.min(10, integer(profile.projectileUpgradeCount));
    const speedUpgradeCount = Math.min(10, integer(profile.speedUpgradeCount));
    const shieldRechargeUpgradeCount = Math.min(10, integer(
        profile.shieldRechargeUpgradeCount ?? profile.levelShieldUpgradeCount
    ));
    const usedLevelUps = projectileUpgradeCount + speedUpgradeCount + shieldRechargeUpgradeCount;
    return Object.freeze({
        version: EXPERIMENTAL_PROFILE_SCHEMA_VERSION,
        slot,
        name,
        level,
        totalXP: integer(profile.totalXP),
        pendingLevelUps: integer(profile.pendingLevelUps, Math.max(0, level - usedLevelUps)),
        projectileUpgradeCount,
        speedUpgradeCount,
        shieldRechargeUpgradeCount,
        deaths: integer(profile.deaths)
    });
}

function migratePayload(payload) {
    if (Array.isArray(payload)) return { version: 0, slots: payload };
    if (!payload || typeof payload !== 'object') return { version: EXPERIMENTAL_PROFILE_SCHEMA_VERSION, slots: [] };
    const version = integer(payload.version);
    const slots = Array.isArray(payload.slots) ? payload.slots : [];
    // Version 1 profiles used Level 1 as their creation baseline. Their stored
    // level, XP, and choices already describe equivalent cumulative progress,
    // so migration deliberately preserves those values rather than shifting them.
    if (version <= 1) return { version: EXPERIMENTAL_PROFILE_SCHEMA_VERSION, slots };
    return { version, slots };
}

export class ExperimentalProfileStore {
    constructor(storage = undefined, logger = console) {
        this.logger = logger;
        this.warned = false;
        this.memorySlots = emptySlots();
        try {
            this.storage = storage === undefined ? globalThis.localStorage : storage;
        } catch (error) {
            this.storage = null;
            this.warn('Profile storage is unavailable; saves will last for this page session.');
        }
    }

    warn(message) {
        if (this.warned) return;
        this.warned = true;
        this.logger?.warn?.(`[Zorka] ${message}`);
    }

    loadSlots() {
        if (!this.storage) return this.memorySlots.map(profile => profile && { ...profile });
        try {
            const raw = this.storage.getItem(EXPERIMENTAL_PROFILE_STORAGE_KEY);
            if (raw === null) return emptySlots();
            const payload = migratePayload(JSON.parse(raw));
            const slots = emptySlots();
            payload.slots.slice(0, EXPERIMENTAL_PROFILE_SLOT_COUNT).forEach((profile, slot) => {
                slots[slot] = normalizeExperimentalProfile(profile, slot);
            });
            this.memorySlots = slots;
            return slots.map(profile => profile && { ...profile });
        } catch (error) {
            this.warn('Profile data could not be read; using session-only profile storage.');
            return this.memorySlots.map(profile => profile && { ...profile });
        }
    }

    persist(slots) {
        this.memorySlots = slots.map((profile, slot) => normalizeExperimentalProfile(profile, slot));
        if (!this.storage) return;
        try {
            this.storage.setItem(EXPERIMENTAL_PROFILE_STORAGE_KEY, JSON.stringify({
                version: EXPERIMENTAL_PROFILE_SCHEMA_VERSION,
                slots: this.memorySlots
            }));
        } catch (error) {
            this.warn('Profile data could not be saved; progress will last for this page session.');
            this.storage = null;
        }
    }

    createProfile(slot, name) {
        this.assertSlot(slot);
        const slots = this.loadSlots();
        if (slots[slot]) throw new Error('That profile slot is already occupied.');
        const profile = normalizeExperimentalProfile({
            name,
            level: 0,
            totalXP: 0,
            pendingLevelUps: 0,
            deaths: 0
        }, slot);
        if (!profile) throw new Error('Enter a profile name.');
        slots[slot] = profile;
        this.persist(slots);
        return { ...profile };
    }

    updateProfile(slot, snapshot) {
        this.assertSlot(slot);
        const slots = this.loadSlots();
        const current = slots[slot];
        if (!current) throw new Error('The selected profile no longer exists.');
        const profile = normalizeExperimentalProfile({ ...snapshot, name: current.name }, slot);
        slots[slot] = profile;
        this.persist(slots);
        return { ...profile };
    }


    deleteProfile(slot) {
        this.assertSlot(slot);
        const slots = this.loadSlots();
        slots[slot] = null;
        this.persist(slots);
        return true;
    }

    getProfile(slot) {
        this.assertSlot(slot);
        return this.loadSlots()[slot];
    }

    getSummaries() {
        return this.loadSlots().map(profile => profile
            ? Object.freeze({
                slot: profile.slot, name: profile.name, level: profile.level,
                projectileUpgradeCount: profile.projectileUpgradeCount,
                shieldRechargeUpgradeCount: profile.shieldRechargeUpgradeCount
            })
            : null);
    }

    assertSlot(slot) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= EXPERIMENTAL_PROFILE_SLOT_COUNT) {
            throw new RangeError('Experimental profile slot must be between 0 and 4.');
        }
    }
}
