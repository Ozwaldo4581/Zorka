import { updateNewtonian, checkCollision, nearestWrappedDisplacement, closestPointOnSegment } from '../physics.js';
import { Projectile } from './projectile.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT } from '../game.js';

const BASE_GUN_COOLDOWN = 0.75;
const BURST_INTERVAL = 0.05;
const BASE_PROJECTILE_SPEED = 1200;
const NORMAL_SHIP_SPEED_CAP = 800;
const MARTIAN_PARALLEL_OFFSET = 30;
export const SPECTER_FLEE_RANGE = 2700;
export const SPECTER_WALL_AWARENESS_DISTANCE = 600;
export const SPECTER_WALL_REPULSION_STRENGTH = 2;
export const SPECTER_CORNER_ESCAPE_MINIMUM_STRENGTH = 1.75;
export const SPECTER_WANDER_RETARGET_MIN_TIME = 0.25;
export const SPECTER_WANDER_RETARGET_MAX_TIME = 0.85;
export const SPECTER_WANDER_TURN_MIN_ANGLE = Math.PI / 6;
export const SPECTER_WANDER_TURN_MAX_ANGLE = Math.PI / 2;
export const SPAWN_IMMUNITY_DURATION = 1;
export const EXPERIMENTAL_RESPAWN_PHASE_DURATION = 3;
export const MAX_STACKABLE_WEAPON_STREAMS = 3;
export const STACKABLE_CAPSULE_GUNS = Object.freeze(['Antigun', 'Double', 'Laser', 'Orb']);
export const MAX_PROJECTILE_UPGRADES = 10;
export const NPC_MAX_PROJECTILE_UPGRADES = 5;
export const MAX_SHIELD_RECHARGE_UPGRADES = 10;
export const MIN_SHIELD_RECHARGE_DELAY = 1;
export const BASE_PLAYER_HP = 5;
const HUMAN_STARTING_HP_BONUS = 5;
export const DAMAGE_PULSE_DURATION = 0.35;

export function getHPBlockLayout(maxHP, totalWidth = 120, normalGap = 2, minimumBlockWidth = 0.5) {
    const blockCount = Math.max(1, Math.floor(Number(maxHP) || 1));
    const gap = Math.min(normalGap, Math.max(0, (totalWidth - blockCount * minimumBlockWidth) / Math.max(1, blockCount - 1)));
    const blockWidth = Math.max(0, (totalWidth - gap * (blockCount - 1)) / blockCount);
    return { blockCount, gap, blockWidth, totalWidth };
}

export class Player {
    constructor(x, y, id = 1, color = '#00ffff') {
        this.x = x;
        this.y = y;
        this.id = id; 
        this.color = color;
        this.vx = 0;
        this.vy = 0;
        this.rotation = 0;
        this.radius = 25;
        this.thrust = 800*2;
        this.brakeForce = 400;
        this.isDead = false;
        this.respawnTimer = 0;
        this.fireCooldown = 0;
        this.isNPC = false;
        this.isExperimentalFleeingNPC = false;
        this.isExperimentalSpawnSpecter = false;
        this.experimentalSpecterRecovering = false;
        this.experimentalSpecterRecoveryTarget = null;
        this.experimentalSpecterWanderTimer = 0;
        this.lockedAimTarget = null;
        this.controllerAimLockLatched = false;
        this.controllerAimLockArmed = true;
        this.faceButtonState = [false, false, false, false];
        
        // Power-up System
        this.powerUpCapsules = 0;
        this.maxPowerUpSlots = 5;
        this.activeGun = 'Normal'; // Normal, Antigun, Double, Laser
        this.weaponStreamCounts = { Laser: 0, Antigun: 0, Double: 0, Orb: 0 };
        this.slot1Type = Math.random() < 0.5 ? 'Antigun' : 'Double'; // Randomize slot 1 type on spawn
        this.ghosts = []; // List of Ghost entities
        this.hasForcefield = false;
        this.shieldCharges = 0;
        this.maxShieldCharges = 0;
        this.baselineMaxShieldCharges = 0;
        this.baseShieldRechargeDelay = 6;
        this.shieldRechargeDelay = 6;
        this.shieldRechargeTimer = 0;
        this.maxHP = BASE_PLAYER_HP + HUMAN_STARTING_HP_BONUS;
        this.currentHP = this.maxHP;
        this.hpRechargeDelay = 20;
        this.hpRechargeTimer = 0;
        this.hasMissile = false;
        this.missileLevel = 0;
        this.missileShotCounter = 0;
        this.martianParallelGuns = 1; // Base is 1 for Martian
        this.bonusSpeed = 0; // For Event Horizon Horror
        
        // Burst fire system
        this.burstCount = 0;
        this.burstTimer = 0;
        this.shouldTriggerBurstFire = false;
        
        // NPC specific
        this.npcTarget = null;
        this.npcThinkTimer = 0;
        this.score = 0;
        this.prestigeLevel = 0; // Number of stars
        this.justPrestiged = false;
        this.name = `EARTHLING ${id}`;
        this.isMartian = false;
        this.isCyborg = false;
        this.isDimensionX = false;
        this.isEventHorizon = false;
        this.isEliminated = false; 

        // Spawn immunity
        this.spawnImmunityTimer = SPAWN_IMMUNITY_DURATION;
        this.experimentalRespawnPhaseTimer = 0;
        this.experimentalRespawnPhaseDuration = EXPERIMENTAL_RESPAWN_PHASE_DURATION;
        this.experimentalRespawnAnchorX = null;
        this.experimentalRespawnAnchorY = null;
        this.experimentalSpawnProtectionPending = false;

        // NPC accuracy: 1-5 scale (1 = 60%, 5 = 95%). Lower accuracy means the NPC
        // will aim at a random offset near the target instead of directly at it.
        this.accuracyLevel = 1;

        // Kill streak tracking: killStreak resets to 0 on death; highTide records the
        // highest kill streak this ship has ever reached in the current session.
        this.killStreak = 0;
        this.highTide = 0;
        this.deaths = 0;
        this.shieldLossPulseTimer = 0;
        this.hullLossPulseTimer = 0;

        // Arena-local progression. Score remains the independent evolution currency.
        this.totalXP = 0;
        this.totalCapsulesGained = 0;
        this.level = 0;
        this.pendingLevelUps = 0;
        this.projectileUpgradeCount = 0;
        this.speedUpgradeCount = 0;
        this.shieldRechargeUpgradeCount = 0;
        this.maxProjectileUpgrades = MAX_PROJECTILE_UPGRADES;
        this.maxSpeedUpgrades = 10;
        this.maxShieldRechargeUpgrades = MAX_SHIELD_RECHARGE_UPGRADES;

        // NPC Personality / Behavior state
        this.npcBehaviorTimer = 0;
        this.npcBehaviorState = 'NORMAL'; // NORMAL, FLEE, NO_FIRE
        this.npcWanderAngle = Math.random() * Math.PI * 2;
    }

    // Randomly picks a new aggression and accuracy level.
    rollAggression() {
        this.aggressionLevel = 1 + Math.floor(Math.random() * 5);
        this.rollAccuracy();
    }

    rollAccuracy() {
        this.accuracyLevel = 1 + Math.floor(Math.random() * 5);
    }

    getXPRequirement(level = this.level) {
        const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
        return 100 * (safeLevel + 1) ** 2;
    }

    getLevelThreshold(level) {
        const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
        return 100 * safeLevel * (safeLevel + 1) * (2 * safeLevel + 1) / 6;
    }

    getXPProgressRatio() {
        const levelStart = this.getLevelThreshold(this.level);
        const levelEnd = this.getLevelThreshold(this.level + 1);
        const required = levelEnd - levelStart;
        if (required <= 0) return 0;
        return Math.max(0, Math.min(1, (this.totalXP - levelStart) / required));
    }

    addXP(amount) {
        if (!Number.isFinite(amount) || amount <= 0) return 0;
        this.totalXP += amount;
        let levelsGained = 0;
        while (this.totalXP >= this.getLevelThreshold(this.level + 1)) {
            this.level++;
            this.increaseMaxHP();
            if (!this.isNPC) this.increaseMaxShields();
            this.pendingLevelUps++;
            levelsGained++;
        }
        return levelsGained;
    }

    canSelectLevelUpgrade(choice) {
        if (this.pendingLevelUps <= 0) return false;
        if (choice === 'shield' && this.isExperimentalFleeingNPC) return false;
        if (choice === 'projectile') {
            const projectileUpgradeLimit = this.isNPC
                ? NPC_MAX_PROJECTILE_UPGRADES
                : this.maxProjectileUpgrades;
            return this.projectileUpgradeCount < projectileUpgradeLimit;
        }
        if (choice === 'speed') return this.speedUpgradeCount < this.maxSpeedUpgrades;
        return choice === 'shield' && this.shieldRechargeUpgradeCount < this.maxShieldRechargeUpgrades;
    }

    applyLevelUpgrade(choice) {
        if (choice === 'projectile') {
            this.projectileUpgradeCount = Math.min(this.maxProjectileUpgrades, Math.max(0, this.projectileUpgradeCount));
        }
        if (!this.canSelectLevelUpgrade(choice)) return false;
        if (choice === 'projectile') this.projectileUpgradeCount++;
        else if (choice === 'speed') this.speedUpgradeCount++;
        else if (choice === 'shield') {
            this.shieldRechargeUpgradeCount++;
            this.updateShieldRechargeDelay();
        }
        this.pendingLevelUps--;
        this.onPersistentProgressionChanged?.(this);
        return true;
    }

    resolveNPCLevelUps(random = Math.random) {
        if (!this.isNPC) return 0;
        let applied = 0;
        while (this.pendingLevelUps > 0) {
            const choices = ['projectile', 'speed', 'shield'].filter(choice => this.canSelectLevelUpgrade(choice));
            const index = Math.min(choices.length - 1, Math.floor(random() * choices.length));
            if (!choices[index]) {
                this.pendingLevelUps = 0;
                break;
            }
            if (!this.applyLevelUpgrade(choices[index])) break;
            applied++;
        }
        return applied;
    }

    initializeNPCLevel(targetLevel, random = Math.random, capsuleBudget = null) {
        if (!this.isNPC || this.level !== 0 || this.totalXP !== 0 || this.pendingLevelUps !== 0) return false;
        const normalizedLevel = Math.max(1, Math.floor(Number(targetLevel) || 1));
        this.maxHP = BASE_PLAYER_HP + (this.isNPC ? 0 : HUMAN_STARTING_HP_BONUS);
        this.restoreHP();
        this.addXP(this.getLevelThreshold(normalizedLevel));
        this.resolveNPCLevelUps(random);
        if (this.level !== normalizedLevel || this.pendingLevelUps !== 0) return false;
        this.applyNPCCapsuleBudget(capsuleBudget === null ? this.level : capsuleBudget, random);
        return true;
    }

    getSpeedMultiplier() {
        return Math.min(2, 1 + this.speedUpgradeCount * 0.1);
    }

    getEffectiveThrust() {
        return this.thrust * this.getSpeedMultiplier();
    }

    getNormalShipSpeedCap() {
        return NORMAL_SHIP_SPEED_CAP;
    }

    getPersistentProgressionSnapshot() {
        return {
            level: this.level,
            totalXP: this.totalXP,
            pendingLevelUps: this.pendingLevelUps,
            projectileUpgradeCount: this.projectileUpgradeCount,
            speedUpgradeCount: this.speedUpgradeCount,
            shieldRechargeUpgradeCount: this.shieldRechargeUpgradeCount,
            deaths: this.deaths
        };
    }

    getLeaderboardStats() {
        return {
            name: this.name,
            level: this.level,
            hullStrength: this.maxHP,
            shields: `${this.shieldCharges}/${this.maxShieldCharges}`,
            projectile: this.projectileUpgradeCount,
            shieldRecharge: this.shieldRechargeUpgradeCount,
            shieldRechargeDelay: this.shieldRechargeDelay,
            speed: 1 + this.speedUpgradeCount,
            deaths: this.deaths
        };
    }

    applyPersistentProgression(snapshot) {
        const integer = (value, minimum = 0) => Number.isFinite(Number(value))
            ? Math.max(minimum, Math.floor(Number(value)))
            : minimum;
        this.level = integer(snapshot?.level);
        this.totalXP = integer(snapshot?.totalXP);
        this.projectileUpgradeCount = Math.min(this.maxProjectileUpgrades, integer(snapshot?.projectileUpgradeCount));
        this.speedUpgradeCount = Math.min(this.maxSpeedUpgrades, integer(snapshot?.speedUpgradeCount));
        this.shieldRechargeUpgradeCount = Math.min(this.maxShieldRechargeUpgrades,
            integer(snapshot?.shieldRechargeUpgradeCount ?? snapshot?.levelShieldUpgradeCount));
        this.deaths = integer(snapshot?.deaths);
        const usedChoices = this.projectileUpgradeCount + this.speedUpgradeCount + this.shieldRechargeUpgradeCount;
        this.pendingLevelUps = integer(snapshot?.pendingLevelUps, Math.max(0, this.level - usedChoices));
        this.maxHP = BASE_PLAYER_HP + HUMAN_STARTING_HP_BONUS + this.level;
        this.restoreHP();
        if (this.isExperimentalFleeingNPC) this.baselineMaxShieldCharges = 0;
        this.maxShieldCharges = this.isExperimentalFleeingNPC
            ? 0 : this.baselineMaxShieldCharges + (this.isNPC ? 0 : this.level);
        this.updateShieldRechargeDelay();
        this.restoreShieldCharges(this.maxShieldCharges);
        return this.getPersistentProgressionSnapshot();
    }

    resetTransientLifeState() {
        this.cancelBurstFire();
        this.resetControllerAimLock(true);
        this.isDead = false;
        this.respawnTimer = 0;
        this.vx = 0;
        this.vy = 0;
        this.spawnImmunityTimer = SPAWN_IMMUNITY_DURATION;
        this.experimentalRespawnPhaseTimer = 0;
        this.experimentalRespawnAnchorX = null;
        this.experimentalRespawnAnchorY = null;
        this.experimentalSpawnProtectionPending = false;
        this.experimentalSpecterRecovering = false;
        this.experimentalSpecterRecoveryTarget = null;
        this.restoreHP();
        this.powerUpCapsules = 0;
        this.activeGun = 'Normal';
        this.weaponStreamCounts = { Laser: 0, Antigun: 0, Double: 0, Orb: 0 };
        this.ghosts = [];
        this.history = [];
        this.hasMissile = false;
        this.missileLevel = 0;
        this.missileShotCounter = 0;
        this.martianParallelGuns = 1;
        this.resetEvolutionForm();
        this.bonusSpeed = 0;
        this.restoreShieldCharges(this.maxShieldCharges);
    }

    startExperimentalRespawnPhase(x = this.x, y = this.y) {
        this.cancelBurstFire();
        this.experimentalRespawnPhaseTimer = this.experimentalRespawnPhaseDuration;
        this.experimentalRespawnAnchorX = x;
        this.experimentalRespawnAnchorY = y;
        this.experimentalSpawnProtectionPending = true;
        this.spawnImmunityTimer = 0;
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
    }

    isExperimentalRespawnPhaseActive() {
        return this.experimentalRespawnPhaseTimer > 0;
    }

    isTranslationLocked() {
        return this.isExperimentalRespawnPhaseActive();
    }

    isWeaponLocked() {
        return this.isExperimentalRespawnPhaseActive();
    }

    isDamageImmune() {
        return this.isExperimentalRespawnPhaseActive() || this.spawnImmunityTimer > 0;
    }

    getExperimentalRespawnTintProgress() {
        if (!this.isExperimentalRespawnPhaseActive()) return 1;

        const fadeDuration = 1;
        const fadeStartRemaining = fadeDuration;

        if (this.experimentalRespawnPhaseTimer > fadeStartRemaining) {
            return 0;
        }

        return Math.max(
            0,
            Math.min(
                1,
                1 - this.experimentalRespawnPhaseTimer / fadeDuration
            )
        );
    }

    updateExperimentalRespawnPhase(dt) {
        if (!this.isExperimentalRespawnPhaseActive()) return false;
        this.experimentalRespawnPhaseTimer = Math.max(0, this.experimentalRespawnPhaseTimer - dt);
        if (this.experimentalRespawnPhaseTimer > 0) return false;

        this.experimentalRespawnAnchorX = null;
        this.experimentalRespawnAnchorY = null;
        if (this.experimentalSpawnProtectionPending) {
            this.experimentalSpawnProtectionPending = false;
            this.spawnImmunityTimer = SPAWN_IMMUNITY_DURATION;
        }
        return true;
    }

    getBurstRoundCount() {
        return this.resolveBaseProjectile().quantity;
    }

    cancelBurstFire() {
        this.burstCount = 0;
        this.burstTimer = 0;
        this.shouldTriggerBurstFire = false;
    }

    resetLevelProgress() {
        const automaticShieldCapacity = this.isNPC ? 0 : this.level;
        this.totalXP = 0;
        this.level = 0;
        this.pendingLevelUps = 0;
        this.projectileUpgradeCount = 0;
        this.speedUpgradeCount = 0;
        this.maxHP = BASE_PLAYER_HP + (this.isNPC ? 0 : HUMAN_STARTING_HP_BONUS);
        this.restoreHP();

        this.maxShieldCharges = this.isExperimentalFleeingNPC ? 0 : Math.max(this.baselineMaxShieldCharges,
            this.maxShieldCharges - automaticShieldCapacity);
        if (this.isExperimentalFleeingNPC) this.baselineMaxShieldCharges = 0;
        this.shieldRechargeUpgradeCount = 0;
        this.updateShieldRechargeDelay();
        this.shieldCharges = Math.min(this.shieldCharges, this.maxShieldCharges);
        this.hasForcefield = this.shieldCharges > 0;
        this.shieldRechargeTimer = 0;
        this.cancelBurstFire();
    }

    clearAimLock() {
        this.lockedAimTarget = null;
    }

    resetControllerAimLock(requireRelease = false) {
        this.clearAimLock();
        this.controllerAimLockLatched = false;
        this.controllerAimLockArmed = !requireRelease;
    }

    updateControllerAimLockTrigger(value, acquireThreshold, releaseThreshold) {
        if (value <= releaseThreshold) {
            if (this.controllerAimLockLatched || !this.controllerAimLockArmed) this.clearAimLock();
            this.controllerAimLockLatched = false;
            this.controllerAimLockArmed = true;
            return false;
        }

        if (value >= acquireThreshold && this.controllerAimLockArmed) {
            this.clearAimLock();
            this.controllerAimLockLatched = true;
            this.controllerAimLockArmed = false;
            return true;
        }

        return false;
    }

    getControllerAimDirection(gamepad, deadzone = 0.15) {
        const x = Number.isFinite(gamepad?.axes?.[2]) ? gamepad.axes[2] : 0;
        const y = Number.isFinite(gamepad?.axes?.[3]) ? gamepad.axes[3] : 0;
        const magnitude = Math.hypot(x, y);
        if (magnitude > deadzone) return { x: x / magnitude, y: y / magnitude };
        return { x: Math.sin(this.rotation), y: -Math.cos(this.rotation) };
    }

    get aimLockActive() {
        return this.lockedAimTarget !== null;
    }

    beginAimLock(target) {
        if (!target) return false;
        this.lockedAimTarget = target;
        return true;
    }

    resolveAimLock(isTargetValid) {
        const target = this.lockedAimTarget;
        const targetIsValid = target
            && typeof isTargetValid === 'function'
            && isTargetValid(target)
            && Number.isFinite(target.x)
            && Number.isFinite(target.y);

        if (targetIsValid) return target;

        this.clearAimLock();
        return null;
    }

    handleGamepadPowerUpIntents(gamepad) {
        const pressed = [0, 1, 2, 3].map(index => Boolean(gamepad?.buttons?.[index]?.pressed));
        const justPressed = pressed.map((value, index) => value && !this.faceButtonState[index]);
        this.faceButtonState = pressed;

        if (this.pendingLevelUps > 0) {
            if (justPressed[2]) this.useProjectileLevelPowerUp();
            if (justPressed[3]) this.useSpeedLevelPowerUp();
            if (justPressed[1]) this.useGeneralLevelPowerUp();
        } else if (justPressed[0]) {
            this.consumeCapsules();
        }
    }

    consumeCapsules() {
        return this.activatePowerUp();
    }

    useProjectileLevelPowerUp() {
        return this.applyLevelUpgrade('projectile');
    }

    useSpeedLevelPowerUp() {
        return this.applyLevelUpgrade('speed');
    }

    useGeneralLevelPowerUp() {
        return this.applyLevelUpgrade('shield');
    }

    getDirectionalThrust(inputX, inputY) {
        const effectiveThrust = this.getEffectiveThrust();
        return { x: inputX * effectiveThrust, y: inputY * effectiveThrust };
    }

    setEvolutionForm(form) {
        if (this.isMartian && form !== 'MARTIAN') this.martianParallelGuns = 1;
        this.isMartian = form === 'MARTIAN';
        this.isCyborg = form === 'CYBORG';
        this.isDimensionX = form === 'DIMENSION X';
        this.isEventHorizon = false;
        this.name = this.isNPC ? `${form} BOT ${this.id}` : `${form} ${this.id}`;
    }

    resetEvolutionForm() {
        this.setEvolutionForm('EARTHLING');
        this.justPrestiged = false;
    }

    updateEvolutionState(transformationKills = 20) {
        const killsPerStep = Math.max(1, transformationKills || 1);
        const prestigeThreshold = killsPerStep * 4;

        this.justPrestiged = false;

        if (this.score >= prestigeThreshold) {
            const prestigeGained = Math.floor(this.score / prestigeThreshold);
            this.prestigeLevel += prestigeGained;
            this.score = this.score % prestigeThreshold;
            this.justPrestiged = true;
        }

        if (this.score >= killsPerStep * 3) {
            this.setEvolutionForm('DIMENSION X');
        } else if (this.score >= killsPerStep * 2) {
            this.setEvolutionForm('CYBORG');
        } else if (this.score >= killsPerStep) {
            this.setEvolutionForm('MARTIAN');
        } else {
            this.setEvolutionForm('EARTHLING');
        }
    }

    update(dt, keys, mouse, camera, others = [], asteroids = [], gamepads = [], isSplitScreen = false, transformationKills = 20, hazards = [], isAimTargetValid = null, allowTransformations = true, worldRules = null, touchIntent = null) {
        this.updateDamagePulses(dt);
        if (this.isDead) {
            this.resetControllerAimLock(true);
            return;
        }

        this.updateShieldRecharge(dt);
        this.updateHPRecharge(dt);

        const translationLocked = this.isTranslationLocked();
        const respawnAnchorX = this.experimentalRespawnAnchorX;
        const respawnAnchorY = this.experimentalRespawnAnchorY;
        const standardImmunityStarted = this.updateExperimentalRespawnPhase(dt);

        // Update standard immunity only when it was active at frame start.
        if (!standardImmunityStarted && this.spawnImmunityTimer > 0) {
            this.spawnImmunityTimer -= dt;
        }

        // Evolution is a mode rule; disabled modes keep the independent score
        // currency but never process form or prestige transitions.
        if (allowTransformations) this.updateEvolutionState(transformationKills);
        else this.resetEvolutionForm();

        // Handle Ghost Movement
        this.updateGhosts(dt, worldRules);

        // Handle Burst Fire Logic
        if (translationLocked) {
            this.cancelBurstFire();
        } else if (this.burstCount > 0) {
            this.burstTimer -= dt;
            if (this.burstTimer <= 0) {
                this.burstCount--;
                this.burstTimer = 0.05; 
                this.shouldTriggerBurstFire = true; 
            }
        }

        let fx = 0;
        let fy = 0;
        this.shouldFire = false;
        this.isThrusting = false;

        // Handle Gamepad Input
        let gp = null;
        if (this.id === 1) {
            const gamepadsList = Array.from(gamepads).filter(g => g !== null);
            if (this.controlMode === 'GAMEPAD' && gamepadsList.length > 0) {
                // P1 always takes Pad 0 whenever GAMEPAD mode is selected/forced,
                // in Solo, PVP (split-screen), and Online - even with only 1 pad connected.
                gp = gamepadsList[0];
            }
        } else if (this.id === 2) {
            // P2 is always Gamepad-only, and must use a DIFFERENT physical controller than P1
            const gamepadsList = Array.from(gamepads).filter(g => g !== null);
            const p1 = others.find(p => p.id === 1);
            const p1OnGamepad = p1 && p1.controlMode === 'GAMEPAD';
            if (p1OnGamepad) {
                if (gamepadsList.length >= 2) gp = gamepadsList[1]; // P2 takes second pad
            } else {
                if (gamepadsList.length >= 1) gp = gamepadsList[0]; // P2 takes the only pad
            }
        }

        if (this.isNPC) {
            this.updateNPC(dt, others, asteroids, (f) => { fx = f.x; fy = f.y; }, hazards, worldRules);
        } else if (this.id === 1) {
            // Player 1: Controller OR Keyboard
            if (gp) {
                const lsX = gp.axes[0];
                const lsY = gp.axes[1];
                const deadzone = 0.15;

                const aimTarget = this.resolveAimLock(isAimTargetValid);
                if (aimTarget) {
                    const delta = nearestWrappedDisplacement(this.x, this.y, aimTarget.x, aimTarget.y);
                    if (Math.hypot(delta.x, delta.y) > 2) this.rotation = Math.atan2(delta.y, delta.x) + Math.PI / 2;
                } else {
                    const rsX = gp.axes[2];
                    const rsY = gp.axes[3];
                    if (Math.abs(rsX) > deadzone || Math.abs(rsY) > deadzone) {
                        this.rotation = Math.atan2(rsY, rsX) + Math.PI / 2;
                    }
                }

                if (Math.abs(lsX) > deadzone || Math.abs(lsY) > deadzone) {
                    const force = this.getDirectionalThrust(lsX, lsY);
                    fx += force.x;
                    fy += force.y;
                    this.isThrusting = true;
                }

                this.handleGamepadPowerUpIntents(gp);

            }
            
            // Only use Keyboard/Mouse fallback when P1 hasn't chosen Gamepad control,
            // or no gamepad is actually connected. When GAMEPAD mode is active with a
            // pad connected, the right stick has full authority over aiming.
            if (this.controlMode !== 'GAMEPAD' || !gp) {
                // Fallback to Keyboard/Mouse
                // If split screen, anchor is at 1/4 width (center of left half)
                const anchorX = isSplitScreen ? (DESIGN_WIDTH / 4) : (DESIGN_WIDTH / 2);

                if (!touchIntent?.preserveAimLock && (mouse.m2Released || !mouse.m2Held)) this.clearAimLock();

                const aimTarget = this.resolveAimLock(isAimTargetValid);
                if (aimTarget) {
                    const delta = nearestWrappedDisplacement(this.x, this.y, aimTarget.x, aimTarget.y);
                    if (Math.hypot(delta.x, delta.y) > 2) {
                        this.rotation = Math.atan2(delta.y, delta.x) + Math.PI / 2;
                    }
                } else {
                    const dx = mouse.x - anchorX;
                    const dy = mouse.y - (DESIGN_HEIGHT / 2);
                    const mouseDeadzone = 2;
                    if (Math.abs(dx) > mouseDeadzone || Math.abs(dy) > mouseDeadzone || mouse.clicked) {
                        this.rotation = Math.atan2(dy, dx) + Math.PI / 2;
                    }
                }
                const inputX = Number(Boolean(keys['KeyD'])) - Number(Boolean(keys['KeyA']));
                const inputY = Number(Boolean(keys['KeyS'])) - Number(Boolean(keys['KeyW']));
                if (inputX !== 0 || inputY !== 0) {
                    const force = this.getDirectionalThrust(inputX, inputY);
                    fx += force.x;
                    fy += force.y;
                    this.isThrusting = true;
                }
                
                if (keys['Space']) {
                    this.activatePowerUp();
                    keys['Space'] = false;
                }

            }
            if (touchIntent?.movementActive) {
                const force = this.getDirectionalThrust(touchIntent.moveX, touchIntent.moveY);
                fx = force.x;
                fy = force.y;
                this.isThrusting = touchIntent.moveX !== 0 || touchIntent.moveY !== 0;
            }
            if (touchIntent?.aimActive && (touchIntent.aimX !== 0 || touchIntent.aimY !== 0)) {
                this.clearAimLock();
                this.rotation = Math.atan2(touchIntent.aimY, touchIntent.aimX) + Math.PI / 2;
            }
            this.shouldFire = Boolean(touchIntent?.fireHeld);
        } else if (this.id === 2) {
            // Player 2: Controller ONLY
            if (gp) {
                const lsX = gp.axes[0];
                const lsY = gp.axes[1];
                const deadzone = 0.15;

                const aimTarget = this.resolveAimLock(isAimTargetValid);
                if (aimTarget) {
                    const delta = nearestWrappedDisplacement(this.x, this.y, aimTarget.x, aimTarget.y);
                    if (Math.hypot(delta.x, delta.y) > 2) this.rotation = Math.atan2(delta.y, delta.x) + Math.PI / 2;
                } else {
                    const rsX = gp.axes[2];
                    const rsY = gp.axes[3];
                    if (Math.abs(rsX) > deadzone || Math.abs(rsY) > deadzone) {
                        this.rotation = Math.atan2(rsY, rsX) + Math.PI / 2;
                    }
                }

                if (Math.abs(lsX) > deadzone || Math.abs(lsY) > deadzone) {
                    const force = this.getDirectionalThrust(lsX, lsY);
                    fx += force.x;
                    fy += force.y;
                    this.isThrusting = true;
                }

                this.handleGamepadPowerUpIntents(gp);

            }
            // NO KEYBOARD FALLBACK FOR P2
        }

        if (translationLocked) {
            this.x = respawnAnchorX;
            this.y = respawnAnchorY;
            this.vx = 0;
            this.vy = 0;
            this.isThrusting = false;
        } else {
            updateNewtonian(this, dt, { x: fx, y: fy }, worldRules);
        }
        
        // Speed cap
        let maxSpeed = this.getNormalShipSpeedCap();
        if (this.isEventHorizon) {
            maxSpeed += this.bonusSpeed;
        }
        const currentSpeed = Math.hypot(this.vx, this.vy);
        if (currentSpeed > maxSpeed) {
            this.vx = (this.vx / currentSpeed) * maxSpeed;
            this.vy = (this.vy / currentSpeed) * maxSpeed;
        }

        if (this.fireCooldown > 0) this.fireCooldown -= dt;
    }

    configureShields(maxShieldCharges, rechargeDelay) {
        if (this.isExperimentalFleeingNPC) {
            this.baselineMaxShieldCharges = 0;
            this.maxShieldCharges = 0;
            this.shieldCharges = 0;
            this.hasForcefield = false;
            this.shieldRechargeTimer = 0;
            return;
        }
        this.baselineMaxShieldCharges = Math.max(0, maxShieldCharges || 0);
        this.maxShieldCharges = this.baselineMaxShieldCharges + (this.isNPC ? 0 : this.level);
        this.baseShieldRechargeDelay = Math.max(0, rechargeDelay || 0);
        this.updateShieldRechargeDelay();
        this.shieldCharges = this.maxShieldCharges;
        this.hasForcefield = this.shieldCharges > 0;
        this.shieldRechargeTimer = 0;
    }

    getShieldRechargeDelay() {
        const baseDelay = Math.max(0, Number(this.baseShieldRechargeDelay) || 0);
        if (baseDelay === 0) return 0;
        const level = Math.min(this.maxShieldRechargeUpgrades,
            Math.max(0, Math.floor(Number(this.shieldRechargeUpgradeCount) || 0)));
        return Math.max(MIN_SHIELD_RECHARGE_DELAY,
            baseDelay - (baseDelay - MIN_SHIELD_RECHARGE_DELAY) * level / this.maxShieldRechargeUpgrades);
    }

    updateShieldRechargeDelay() {
        this.shieldRechargeDelay = this.getShieldRechargeDelay();
        this.shieldRechargeTimer = 0;
        return this.shieldRechargeDelay;
    }

    increaseMaxShields(amount = 1) {
        if (this.isExperimentalFleeingNPC) return 0;
        const increase = Math.max(0, Math.floor(Number(amount) || 0));
        this.maxShieldCharges += increase;
        this.shieldCharges = Math.min(this.shieldCharges, this.maxShieldCharges);
        return this.maxShieldCharges;
    }

    // Capsule Shield remains a match-local capacity bonus; selectable level
    // progression uses Shield Recharge instead.
    applyShieldUpgrade() {
        if (this.isExperimentalFleeingNPC) return false;
        this.maxShieldCharges += 1;
        this.shieldCharges = Math.min(this.maxShieldCharges, this.shieldCharges + 1);
        this.hasForcefield = this.shieldCharges > 0;
        this.shieldRechargeTimer = 0;
        return true;
    }

    restoreShieldCharges(shieldCharges) {
        if (this.isExperimentalFleeingNPC) {
            this.baselineMaxShieldCharges = 0;
            this.maxShieldCharges = 0;
            this.shieldCharges = 0;
            this.hasForcefield = false;
            this.shieldRechargeTimer = 0;
            return;
        }
        const safeMaximum = Number.isFinite(this.maxShieldCharges)
            ? Math.max(0, this.maxShieldCharges)
            : 0;
        const safeCharges = Number.isFinite(shieldCharges) ? Math.max(0, shieldCharges) : 0;

        this.maxShieldCharges = safeMaximum;
        this.shieldCharges = Math.min(safeMaximum, safeCharges);
        this.hasForcefield = this.shieldCharges > 0;
        this.shieldRechargeTimer = 0;
    }

    restoreShieldsToMaximum() {
        this.restoreShieldCharges(this.maxShieldCharges);
        return this.shieldCharges;
    }

    grantShieldCharge() {
        if (this.shieldCharges >= this.maxShieldCharges) return false;
        this.restoreShieldCharges(this.shieldCharges + 1);
        return this.shieldCharges > 0;
    }

    consumeShield() {
        if (this.shieldCharges <= 0) return false;
        this.shieldCharges = Math.max(0, this.shieldCharges - 1);
        this.hasForcefield = this.shieldCharges > 0;
        this.shieldRechargeTimer = 0;
        return true;
    }

    markShieldLoss() {
        this.shieldLossPulseTimer = DAMAGE_PULSE_DURATION;
    }

    markHullLoss() {
        this.hullLossPulseTimer = DAMAGE_PULSE_DURATION;
    }

    updateDamagePulses(dt) {
        const elapsed = Math.max(0, Number(dt) || 0);
        this.shieldLossPulseTimer = Math.max(0, this.shieldLossPulseTimer - elapsed);
        this.hullLossPulseTimer = Math.max(0, this.hullLossPulseTimer - elapsed);
    }

    getDamagePulseScale(timer) {
        if (timer <= 0) return 1;
        const progress = 1 - timer / DAMAGE_PULSE_DURATION;
        return 1 + 3 * (1 - progress) ** 2;
    }

    clearShieldCharges() {
        const chargesRemoved = Math.max(0, this.shieldCharges);
        this.shieldCharges = 0;
        this.hasForcefield = false;
        this.shieldRechargeTimer = 0;
        return chargesRemoved;
    }

    // Returns true when HP absorbed the hit and the ship remains alive.
    // False means the hit depleted HP, or HP was already depleted.
    takeHPDamage() {
        if (this.currentHP <= 0) return false;
        this.currentHP = Math.max(0, this.currentHP - 1);
        this.hpRechargeTimer = this.hpRechargeDelay;
        return this.currentHP > 0;
    }

    restoreHP() {
        this.currentHP = this.maxHP;
        this.hpRechargeTimer = 0;
    }

    increaseMaxHP(amount = 1) {
        const increase = Math.max(0, Math.floor(Number(amount) || 0));
        this.maxHP += increase;
        this.currentHP = Math.min(this.maxHP, this.currentHP + increase);
    }

    updateHPRecharge(dt) {
        if (this.isDead) {
            this.hpRechargeTimer = 0;
            return;
        }
        if (this.hpRechargeTimer <= 0) return;
        this.hpRechargeTimer = Math.max(0, this.hpRechargeTimer - dt);
        if (this.hpRechargeTimer === 0) {
            this.restoreHP();
            this.restoreShieldsToMaximum();
        }
    }

    updateShieldRecharge(dt) {
        if (this.isDead || this.maxShieldCharges <= 0 || this.shieldCharges >= this.maxShieldCharges) {
            this.shieldRechargeTimer = 0;
            return;
        }

        if (this.shieldRechargeDelay === 0) {
            this.shieldCharges = this.maxShieldCharges;
            this.hasForcefield = true;
            this.shieldRechargeTimer = 0;
            return;
        }

        this.shieldRechargeTimer += dt;
        if (this.shieldRechargeTimer >= this.shieldRechargeDelay) {
            this.shieldCharges = Math.min(this.maxShieldCharges, this.shieldCharges + 1);
            this.hasForcefield = true;
            this.shieldRechargeTimer = 0;
        }
    }

    updateGhosts(dt, worldRules = null) {
        if (this.isEventHorizon || this.isDead) {
            this.ghosts = [];
            this.history = [];
            return;
        }

        if (!this.history) this.history = [];

        const usesWrappedWorld = !worldRules?.usesRooms;
        const getPathDelta = (from, to) => {
            let dx = to.x - from.x;
            let dy = to.y - from.y;

            if (usesWrappedWorld) {
                if (dx > WORLD_WIDTH / 2) dx -= WORLD_WIDTH;
                else if (dx < -WORLD_WIDTH / 2) dx += WORLD_WIDTH;

                if (dy > WORLD_HEIGHT / 2) dy -= WORLD_HEIGHT;
                else if (dy < -WORLD_HEIGHT / 2) dy += WORLD_HEIGHT;
            }

            return { dx, dy };
        };

        const currentPoint = { x: this.x, y: this.y, rotation: this.rotation };
        const newestPoint = this.history[0];

        if (!newestPoint) {
            this.history.unshift(currentPoint);
        } else {
            const movement = getPathDelta(currentPoint, newestPoint);
            const movedDistance = Math.hypot(movement.dx, movement.dy);

            // Record breadcrumbs by actual travel rather than by frame count.
            // A tiny threshold prevents stationary players from filling the buffer.
            if (movedDistance >= 1) this.history.unshift(currentPoint);
        }

        let shipSize = this.radius * 3.5;
        if (this.isMartian) shipSize *= 2;
        else if (this.isCyborg) shipSize *= 1.3;
        else if (this.isDimensionX) shipSize *= 1.6;

        const ghostSpacing = shipSize + 24;
        const maximumTrailDistance = Math.max(ghostSpacing, ghostSpacing * this.ghosts.length) + 300;

        // Keep enough physical trail for every ghost, independent of frame rate.
        let retainedDistance = 0;
        let keepCount = Math.min(this.history.length, 1);
        for (let i = 1; i < this.history.length; i++) {
            const segment = getPathDelta(this.history[i - 1], this.history[i]);
            retainedDistance += Math.hypot(segment.dx, segment.dy);
            keepCount = i + 1;
            if (retainedDistance >= maximumTrailDistance) break;
        }
        if (this.history.length > keepCount) this.history.length = keepCount;
        if (this.history.length > 720) this.history.length = 720;

        this.ghosts.forEach((ghost, index) => {
            const targetDistance = ghostSpacing * (index + 1);
            let travelled = 0;
            let position = this.history[this.history.length - 1] || currentPoint;

            for (let i = 1; i < this.history.length; i++) {
                const newer = this.history[i - 1];
                const older = this.history[i];
                const segment = getPathDelta(newer, older);
                const segmentLength = Math.hypot(segment.dx, segment.dy);

                if (segmentLength <= 0) continue;

                if (travelled + segmentLength >= targetDistance) {
                    const ratio = (targetDistance - travelled) / segmentLength;
                    let x = newer.x + segment.dx * ratio;
                    let y = newer.y + segment.dy * ratio;

                    if (usesWrappedWorld) {
                        x = ((x % WORLD_WIDTH) + WORLD_WIDTH) % WORLD_WIDTH;
                        y = ((y % WORLD_HEIGHT) + WORLD_HEIGHT) % WORLD_HEIGHT;
                    }

                    position = { x, y };
                    break;
                }

                travelled += segmentLength;
            }

            ghost.x = position.x;
            ghost.y = position.y;
            // Ghost ships still mirror the player's current aim direction.
            ghost.rotation = this.rotation;
        });
    }

    updateNPC(dt, others, asteroids, setForce, hazards = [], worldRules = null) {
        const effectiveThrust = this.getEffectiveThrust();
        if (this.isDummy) {
            setForce({ x: 0, y: 0 });
            return;
        }
        if (worldRules?.usesRooms && worldRules.hasHumanInArea?.(this.roomId) === false) {
            this.npcTarget = null;
            this.shouldFire = false;
            this.isThrusting = false;
            setForce({ x: 0, y: 0 });
            return;
        }
        this.npcThinkTimer -= dt;
        this.npcBehaviorTimer -= dt;
        if (this.isExperimentalFleeingNPC) {
            this.shouldFire = false;
            this.shouldTriggerBurstFire = false;
        }
        if (this.isExperimentalFleeingNPC && this.experimentalSpecterRecovering) {
            const target = this.experimentalSpecterRecoveryTarget;
            const dx = target?.x - this.x;
            const dy = target?.y - this.y;
            const distance = Math.hypot(dx, dy);
            if (!target || !Number.isFinite(distance) || distance <= 100) {
                this.experimentalSpecterRecovering = false;
                this.experimentalSpecterRecoveryTarget = null;
            } else {
                const targetRotation = Math.atan2(dy, dx) + Math.PI / 2;
                const difference = Math.atan2(
                    Math.sin(targetRotation - this.rotation),
                    Math.cos(targetRotation - this.rotation)
                );
                this.rotation += Math.max(-4 * dt, Math.min(4 * dt, difference));
                this.isThrusting = true;
                setForce({
                    x: Math.sin(this.rotation) * effectiveThrust,
                    y: -Math.cos(this.rotation) * effectiveThrust
                });
                return;
            }
        }
        if (worldRules?.usesRooms && this.npcTarget?.roomId !== this.roomId) this.npcTarget = null;
        if (this.isFixedPositionNPC) {
            this.vx = 0;
            this.vy = 0;
            this.x = Number.isFinite(this.fixedAnchorX) ? this.fixedAnchorX : this.x;
            this.y = Number.isFinite(this.fixedAnchorY) ? this.fixedAnchorY : this.y;
        }

        // Personality/Behavior state transitions
        if (!this.isExperimentalFleeingNPC && this.npcBehaviorTimer <= 0) {
            if (this.aggressionLevel === 1) { // Timmy
                // 30% chance to flee for 2-4 seconds
                if (Math.random() < 0.3 && this.npcBehaviorState === 'NORMAL') {
                    this.npcBehaviorState = 'FLEE';
                    this.npcBehaviorTimer = 2 + Math.random() * 2;
                } else {
                    this.npcBehaviorState = 'NORMAL';
                    this.npcBehaviorTimer = 3 + Math.random() * 5;
                }
            } else if (this.aggressionLevel === 2) { // Gus
                // 40% chance to stop shooting for 1-3 seconds
                if (Math.random() < 0.4 && this.npcBehaviorState === 'NORMAL') {
                    this.npcBehaviorState = 'NO_FIRE';
                    this.npcBehaviorTimer = 1 + Math.random() * 2;
                } else {
                    this.npcBehaviorState = 'NORMAL';
                    this.npcBehaviorTimer = 3 + Math.random() * 4;
                }
            } else {
                this.npcBehaviorState = 'NORMAL';
                this.npcBehaviorTimer = 10;
            }
        }

        // Aggression Range: 1-5 scale set on spawn/respawn (see rollAggression()).
        // Scaled 3x linearly to match the 9x9 world expansion (from 3x3).
        const aggressionRange = 900 + this.aggressionLevel * 900; // Level 1 = 1800, Level 5 = 5400

        // Target selection priority:
        // 1. Nearest alive player/NPC within aggression range
        // 2. Nearest satellite or debris within aggression range (if no players found)
        if (this.npcThinkTimer <= 0) {
            this.npcThinkTimer = 0.5 + Math.random();
            let minDist = Infinity;
            this.npcTarget = null;
            
            // Priority 1: Players
            others.forEach(other => {
                if (other === this || other.isDead || other.isEliminated) return;
                if (this.isSector9BBGEncounterNPC && other.isNPC) return;
                if (!this.isSector9BBGEncounterNPC && other.isSector9BBGEncounterNPC) return;
                if (worldRules?.usesRooms && other.roomId !== this.roomId) return;
                const d = Math.hypot(other.x - this.x, other.y - this.y);
                const isInRange = this.isExperimentalFleeingNPC ? d <= SPECTER_FLEE_RANGE : d <= aggressionRange;
                if (d < minDist && isInRange) {
                    minDist = d;
                    this.npcTarget = other;
                }
            });

            // Priority 2: Hazards (if no players in range)
            if (!this.npcTarget && !this.isExperimentalFleeingNPC) {
                hazards.forEach(h => {
                    if (h.isDestroyed) return;
                    if (worldRules?.usesRooms && h.roomId !== this.roomId) return;
                    const d = Math.hypot(h.x - this.x, h.y - this.y);
                    if (d < minDist && d <= aggressionRange) {
                        minDist = d;
                        this.npcTarget = h;
                    }
                });
            }

            // Update wander angle occasionally if no target
            if (!this.npcTarget && !this.isExperimentalFleeingNPC) {
                this.npcWanderAngle += (Math.random() - 0.5) * 2;
            }
        }

        // --- Asteroid Avoidance (predictive) ---
        // NPCs steer away from asteroids, but with human-like error and awareness lapses.
        let avoidFx = 0, avoidFy = 0;
        let threatLevel = 0; 
        const detectionRange = 180; // Reduced from 260
        const lookAheadTime = 0.7; // Reduced from 1.1
        
        // Random "awareness lapse": 20% of the time, bots are less effective at dodging
        const hasAwarenessLapse = Math.random() < 0.2;

        asteroids.forEach(a => {
            if (worldRules?.usesRooms && a.roomId !== this.roomId) return;
            const dx = a.x - this.x;
            const dy = a.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= 0) return;

            // Near-field repulsion
            const avoidDist = a.radius + detectionRange;
            if (dist < avoidDist && !hasAwarenessLapse) {
                // Reduced force multiplier from 2.2 to 1.5
                const forceMag = (1 - dist / avoidDist) * effectiveThrust * 1.5;
                avoidFx -= (dx / dist) * forceMag;
                avoidFy -= (dy / dist) * forceMag;
                threatLevel = Math.max(threatLevel, 1 - dist / avoidDist);
            }

            // Predictive check
            const relVx = a.vx - this.vx;
            const relVy = a.vy - this.vy;
            const futureDx = dx + relVx * lookAheadTime;
            const futureDy = dy + relVy * lookAheadTime;
            const futureDist = Math.hypot(futureDx, futureDy);
            const collisionThreshold = a.radius + this.radius + 30; // Reduced buffer from 50 to 30
            if (dist < 500 && futureDist < collisionThreshold) {
                // Randomize avoidance slightly so they don't always pick the perfect path
                const errorAngle = (Math.random() - 0.5) * 0.5;
                const cosE = Math.cos(errorAngle);
                const sinE = Math.sin(errorAngle);
                
                // Reduced force multiplier from 2.4 to 1.8
                const forceMag = effectiveThrust * (hasAwarenessLapse ? 0.8 : 1.8);
                
                const rawAvoidX = -(dx / dist) * forceMag;
                const rawAvoidY = -(dy / dist) * forceMag;
                
                avoidFx += rawAvoidX * cosE - rawAvoidY * sinE;
                avoidFy += rawAvoidX * sinE + rawAvoidY * cosE;
                threatLevel = Math.max(threatLevel, hasAwarenessLapse ? 0.5 : 1);
            }
        });

        if (worldRules?.room) {
            const predicted = { x: this.x + this.vx * lookAheadTime, y: this.y + this.vy * lookAheadTime };
            const walls = worldRules.getWallsFor?.(this) || worldRules.room.walls;
            for (const wall of walls) {
                const closest = closestPointOnSegment(predicted, wall.start, wall.end);
                const dx = predicted.x - closest.x;
                const dy = predicted.y - closest.y;
                const distance = Math.hypot(dx, dy);
                const avoidDistance = this.radius + worldRules.room.wallCollisionThickness / 2 + detectionRange;
                if (distance > 0 && distance < avoidDistance) {
                    const force = (1 - distance / avoidDistance) * effectiveThrust * 1.5;
                    avoidFx += dx / distance * force;
                    avoidFy += dy / distance * force;
                    threatLevel = Math.max(threatLevel, 1 - distance / avoidDistance);
                }
            }
        }

        const isEvading = threatLevel > 0;
        // The more urgent the avoidance, the less the NPC prioritizes chasing its target
        const chaseWeight = isEvading ? Math.max(0, 1 - threatLevel) : 1;

        let fx = 0, fy = 0;
        const specterAvoidance = this.isExperimentalFleeingNPC
            ? this.getSpecterShipAvoidance(others, worldRules) : null;
        if (this.isExperimentalFleeingNPC) {
            const wallAvoidance = this.getSpecterWallAvoidance(worldRules);
            const hasThreat = specterAvoidance.threatCount > 0;
            this.npcBehaviorState = hasThreat ? 'FLEE' : 'WANDER';
            this.npcTarget = hasThreat ? specterAvoidance.nearestTarget : null;
            const steering = hasThreat && specterAvoidance.magnitude > Number.EPSILON
                ? { x: specterAvoidance.x / specterAvoidance.magnitude, y: specterAvoidance.y / specterAvoidance.magnitude }
                : this.getSpecterWanderDirection(dt);
            const desiredX = steering.x + wallAvoidance.x;
            const desiredY = steering.y + wallAvoidance.y;
            const targetRot = Math.atan2(desiredY, desiredX) + Math.PI / 2;
            const diff = Math.atan2(Math.sin(targetRot - this.rotation), Math.cos(targetRot - this.rotation));
            this.rotation += Math.max(-3 * dt, Math.min(3 * dt, diff));
            fx = Math.sin(this.rotation) * effectiveThrust * chaseWeight
                + wallAvoidance.x * effectiveThrust;
            fy = -Math.cos(this.rotation) * effectiveThrust * chaseWeight
                + wallAvoidance.y * effectiveThrust;
            if (chaseWeight > 0) this.isThrusting = true;
        } else if (this.npcTarget) {
            const dx = this.npcTarget.x - this.x;
            const dy = this.npcTarget.y - this.y;
            
            // Apply accuracy offset: lower accuracy = higher random deviation in aim
            // 1 = 60% accuracy, 5 = 95% accuracy
            const accuracyBase = 0.6 + (this.accuracyLevel - 1) * 0.0875; // 0.6 to 0.95
            let targetRot = Math.atan2(dy, dx) + Math.PI / 2;
            
            if (!this.isExperimentalFleeingNPC && Math.random() > accuracyBase) {
                const spread = (1 - accuracyBase) * 1.5; // Max ~0.6 radians spread at lowest accuracy
                targetRot += (Math.random() - 0.5) * spread;
            }

            // Timmy (lvl 1) flee logic: run away if in FLEE state
            if (this.npcBehaviorState === 'FLEE') {
                targetRot += Math.PI; // Face away
            }

            // Smooth rotate (still track the target even while dodging, so it can keep firing)
            const diff = targetRot - this.rotation;
            this.rotation += Math.max(-4 * dt, Math.min(4 * dt, diff));

            const dist = Math.hypot(dx, dy);
            
            if (this.npcBehaviorState === 'FLEE') {
                // Thrust away at full speed
                fx = Math.sin(this.rotation) * effectiveThrust * chaseWeight;
                fy = -Math.cos(this.rotation) * effectiveThrust * chaseWeight;
                if (chaseWeight > 0) this.isThrusting = true;
            } else {
                if (dist > 300) {
                    fx = Math.sin(this.rotation) * effectiveThrust * chaseWeight;
                    fy = -Math.cos(this.rotation) * effectiveThrust * chaseWeight;
                    if (chaseWeight > 0) this.isThrusting = true;
                } else if (dist < 150) {
                    fx = -Math.sin(this.rotation) * effectiveThrust * chaseWeight;
                    fy = Math.cos(this.rotation) * effectiveThrust * chaseWeight;
                    if (chaseWeight > 0) this.isThrusting = true;
                }
            }

            // Fire if roughly facing target and within engagement range (scales with aggression)
            // Gus (lvl 2) stops shooting in NO_FIRE state
            const gusCanFire = this.npcBehaviorState !== 'NO_FIRE';
            const isFacingTarget = this.npcBehaviorState === 'FLEE' ? false : (Math.abs(diff) < 0.3);

            if (isFacingTarget && dist < aggressionRange && gusCanFire) {
                this.shouldFire = true;
            }

            // NPC Power-up logic: Use if capsules are high or defensive needed
            if (this.powerUpCapsules > 0 && !this.isExperimentalFleeingNPC) {
                const shouldActivate = (this.powerUpCapsules >= 4) || (this.powerUpCapsules >= 1 && Math.random() < 0.01);
                if (shouldActivate) {
                    this.activatePowerUp();
                }
            }
        } else {
            // Wandering behavior when no target
            // Non-aggressive travel speed set to 50%
            const travelWeight = 0.5;
            this.rotation += (this.npcWanderAngle - this.rotation) * dt * 2;
            fx = Math.sin(this.rotation) * effectiveThrust * travelWeight * chaseWeight;
            fy = -Math.cos(this.rotation) * effectiveThrust * travelWeight * chaseWeight;
            if (chaseWeight > 0) this.isThrusting = true;
        }

        if (this.isFixedPositionNPC) {
            this.vx = 0;
            this.vy = 0;
            this.x = Number.isFinite(this.fixedAnchorX) ? this.fixedAnchorX : this.x;
            this.y = Number.isFinite(this.fixedAnchorY) ? this.fixedAnchorY : this.y;
            this.isThrusting = false;
            setForce({ x: 0, y: 0 });
            return;
        }

        fx += avoidFx;
        fy += avoidFy;
        if (isEvading) this.isThrusting = true;

        if (this.isExperimentalFleeingNPC) {
            this.shouldFire = false;
            this.shouldTriggerBurstFire = false;
        }

        setForce({ x: fx, y: fy });
    }

    getSpecterShipAvoidance(others, worldRules = null, fleeRange = SPECTER_FLEE_RANGE) {
        let x = 0;
        let y = 0;
        let threatCount = 0;
        let nearestTarget = null;
        let nearestDistance = Infinity;
        for (const other of others) {
            if (other === this || other.isDead || other.isEliminated) continue;
            if (worldRules?.usesRooms && other.roomId !== this.roomId) continue;
            const delta = worldRules?.usesRooms
                ? { x: other.x - this.x, y: other.y - this.y }
                : nearestWrappedDisplacement(this.x, this.y, other.x, other.y);
            const distance = Math.hypot(delta.x, delta.y);
            if (distance <= Number.EPSILON || distance > fleeRange) continue;
            const weight = 1 / distance;
            x -= delta.x / distance * weight;
            y -= delta.y / distance * weight;
            threatCount++;
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestTarget = other;
            }
        }
        return { x, y, magnitude: Math.hypot(x, y), threatCount, nearestTarget };
    }

    getSpecterWanderDirection(dt, random = Math.random) {
        this.experimentalSpecterWanderTimer -= Math.max(0, dt);
        if (this.experimentalSpecterWanderTimer <= 0) {
            this.experimentalSpecterWanderTimer = SPECTER_WANDER_RETARGET_MIN_TIME
                + random() * (SPECTER_WANDER_RETARGET_MAX_TIME - SPECTER_WANDER_RETARGET_MIN_TIME);
            const direction = random() < 0.5 ? -1 : 1;
            const turn = SPECTER_WANDER_TURN_MIN_ANGLE
                + random() * (SPECTER_WANDER_TURN_MAX_ANGLE - SPECTER_WANDER_TURN_MIN_ANGLE);
            this.npcWanderAngle += direction * turn;
        }
        return { x: Math.sin(this.npcWanderAngle), y: -Math.cos(this.npcWanderAngle) };
    }

    getSpecterWallAvoidance(worldRules = null) {
        if (!worldRules?.room) return { x: 0, y: 0, cornered: false };
        const walls = worldRules.getWallsFor?.(this) || worldRules.room.walls || [];
        let x = 0;
        let y = 0;
        const strongNormals = [];
        for (const wall of walls) {
            const closest = closestPointOnSegment(this, wall.start, wall.end);
            const dx = this.x - closest.x;
            const dy = this.y - closest.y;
            const distance = Math.hypot(dx, dy);
            if (distance <= Number.EPSILON || distance >= SPECTER_WALL_AWARENESS_DISTANCE) continue;
            const normal = { x: dx / distance, y: dy / distance };
            const falloff = 1 - distance / SPECTER_WALL_AWARENESS_DISTANCE;
            const strength = falloff * falloff * SPECTER_WALL_REPULSION_STRENGTH;
            x += normal.x * strength;
            y += normal.y * strength;
            if (falloff >= 0.45) strongNormals.push(normal);
        }
        let cornered = false;
        for (let first = 0; first < strongNormals.length && !cornered; first++) {
            for (let second = first + 1; second < strongNormals.length; second++) {
                const dot = strongNormals[first].x * strongNormals[second].x
                    + strongNormals[first].y * strongNormals[second].y;
                if (Math.abs(dot) < 0.75) {
                    cornered = true;
                    break;
                }
            }
        }
        if (cornered) {
            const magnitude = Math.hypot(x, y);
            if (magnitude > Number.EPSILON && magnitude < SPECTER_CORNER_ESCAPE_MINIMUM_STRENGTH) {
                x = x / magnitude * SPECTER_CORNER_ESCAPE_MINIMUM_STRENGTH;
                y = y / magnitude * SPECTER_CORNER_ESCAPE_MINIMUM_STRENGTH;
            }
        }
        return { x, y, cornered };
    }

    beginExperimentalSpecterWallRecovery(x, y) {
        if (!this.isExperimentalFleeingNPC || this.experimentalSpecterRecovering
            || !Number.isFinite(x) || !Number.isFinite(y)) return false;
        this.experimentalSpecterRecovering = true;
        this.experimentalSpecterRecoveryTarget = { x, y };
        return true;
    }

    addCapsule() {
        if (this.isEventHorizon) return; // Event Horizon Horror does not gain power-ups
        this.totalCapsulesGained++;
        this.powerUpCapsules++;
        if (this.powerUpCapsules > this.maxPowerUpSlots) {
            this.powerUpCapsules = 1;
        }
    }

    canActivateCapsuleSlot(slot) {
        const normalizedSlot = Math.floor(Number(slot) || 0);
        if (normalizedSlot < 1 || normalizedSlot > this.maxPowerUpSlots) return false;
        if (normalizedSlot === 1
            && (this.weaponStreamCounts?.[this.slot1Type] || 0) >= MAX_STACKABLE_WEAPON_STREAMS) return false;
        if (normalizedSlot === 2 && this.missileLevel >= 3) return false;
        if (normalizedSlot === 3) {
            if (this.isMartian) return this.martianParallelGuns < 2;
            if ((this.weaponStreamCounts?.Laser || 0) >= MAX_STACKABLE_WEAPON_STREAMS) return false;
        }
        if (normalizedSlot === 4
            && (this.weaponStreamCounts?.Orb || 0) >= MAX_STACKABLE_WEAPON_STREAMS) return false;
        if (normalizedSlot === 5 && this.ghosts.length >= 2) return false;
        return true;
    }

    selectStackableCapsuleGun(weapon) {
        if (!STACKABLE_CAPSULE_GUNS.includes(weapon)) {
            return { applied: false, reason: 'invalid-weapon' };
        }
        const currentRank = this.activeGun === weapon ? (this.weaponStreamCounts?.[weapon] || 0) : 0;
        if (currentRank >= MAX_STACKABLE_WEAPON_STREAMS) {
            return { applied: false, reason: 'maxed', weapon, rank: currentRank };
        }

        const switched = this.activeGun !== weapon;
        this.weaponStreamCounts = { Laser: 0, Antigun: 0, Double: 0, Orb: 0 };
        this.activeGun = weapon;
        this.weaponStreamCounts[weapon] = switched ? 1 : currentRank + 1;
        this.cancelBurstFire();
        return {
            applied: true,
            reason: switched ? 'switched' : 'rank-increased',
            weapon,
            rank: this.weaponStreamCounts[weapon]
        };
    }

    activatePowerUp() {
        if (this.powerUpCapsules === 0) return false;

        const slot = this.powerUpCapsules;
        if (!this.canActivateCapsuleSlot(slot)) {
            if (slot === 1) this.powerUpError = `${this.slot1Type.toUpperCase()} MAXED`;
            else if (slot === 2) this.powerUpError = 'MISSILE MAXED';
            else if (slot === 3) this.powerUpError = 'LASER MAXED';
            else if (slot === 4) this.powerUpError = 'ORB MAXED';
            else if (slot === 5) this.powerUpError = 'GHOST MAXED';
            return false;
        }
        let success = true;

        switch (slot) {
            case 1: // Random Antigun or Double
                success = this.selectStackableCapsuleGun(this.slot1Type).applied;
                break;
            case 2: // Missile
                this.hasMissile = true;
                this.missileLevel++;
                this.missileShotCounter = 0;
                break;
            case 3: // Laser (or Martian Parallel Guns)
                if (this.isMartian) {
                    // Martian Capsule 3 adds one parallel copy to each base emission.
                    this.martianParallelGuns = 2;
                } else {
                    success = this.selectStackableCapsuleGun('Laser').applied;
                }
                break;
            case 4: // Orb weapon
                success = this.selectStackableCapsuleGun('Orb').applied;
                break;
            case 5: // Ghost
                if (this.ghosts.length < 2) {
                    this.ghosts.push({ x: this.x, y: this.y, rotation: this.rotation });
                } else {
                    success = false;
                    this.powerUpError = 'GHOST MAXED';
                }
                break;
        }

        if (success) {
            this.powerUpCapsules = 0;
            this.powerUpError = null;
        }
        return success;
    }

    applyNPCCapsuleBudget(budget, random = Math.random) {
        if (!this.isNPC) return 0;

        let remainingBudget = Math.max(0, Math.floor(Number(budget) || 0));
        let spent = 0;

        while (remainingBudget > 0) {
            const affordableSlots = [];
            for (let slot = 1; slot <= this.maxPowerUpSlots; slot++) {
                if (slot <= remainingBudget && this.canActivateCapsuleSlot(slot)) {
                    affordableSlots.push(slot);
                }
            }
            if (affordableSlots.length === 0) break;

            const index = Math.min(affordableSlots.length - 1, Math.floor(random() * affordableSlots.length));
            const slot = affordableSlots[index];
            this.powerUpCapsules = slot;
            if (!this.activatePowerUp()) break;

            spent += slot;
            remainingBudget -= slot;
        }

        this.powerUpCapsules = 0;
        this.powerUpError = null;
        return spent;
    }

    applyRandomCapsulePowerUps(count, random = Math.random) {
        const targetCount = Math.max(0, Math.floor(Number(count) || 0));
        let applied = 0;
        while (applied < targetCount) {
            const availableSlots = [];
            for (let slot = 1; slot <= this.maxPowerUpSlots; slot++) {
                if (this.canActivateCapsuleSlot(slot)) availableSlots.push(slot);
            }
            if (availableSlots.length === 0) break;
            const index = Math.min(availableSlots.length - 1, Math.floor(random() * availableSlots.length));
            this.powerUpCapsules = availableSlots[index];
            if (!this.activatePowerUp()) break;
            applied++;
        }
        this.powerUpCapsules = 0;
        this.powerUpError = null;
        return applied;
    }

    applyOrdinaryNPCCapsulePowerUps(count, random = Math.random) {
        const targetCount = Math.max(0, Math.floor(Number(count) || 0));
        let applied = 0;
        let hasCapsuleGun = false;
        while (applied < targetCount) {
            const availableSlots = [];
            for (let slot = 1; slot <= this.maxPowerUpSlots; slot++) {
                if (hasCapsuleGun && [1, 3, 4].includes(slot)) continue;
                if (this.canActivateCapsuleSlot(slot)) availableSlots.push(slot);
            }
            if (availableSlots.length === 0) break;
            const index = Math.min(availableSlots.length - 1, Math.floor(random() * availableSlots.length));
            const slot = availableSlots[index];
            this.powerUpCapsules = slot;
            if (!this.activatePowerUp()) break;
            if ([1, 3, 4].includes(slot) && !this.isMartian) hasCapsuleGun = true;
            applied++;
        }
        this.powerUpCapsules = 0;
        this.powerUpError = null;
        return applied;
    }

    clearExperimentalRoomCapsuleBonuses() {
        this.activeGun = 'Normal';
        this.weaponStreamCounts = { Laser: 0, Antigun: 0, Double: 0, Orb: 0 };
        this.cancelBurstFire();
        this.hasMissile = false;
        this.missileLevel = 0;
        this.missileShotCounter = 0;
        this.martianParallelGuns = 1;
        this.resetEvolutionForm();
        this.ghosts = [];
        this.history = [];
    }

    fire(isBurstShot = false) {
        if (this.isEventHorizon) return null; // Event Horizon Horror does not shoot projectiles
        if (this.spawnImmunityTimer > 0 || this.isWeaponLocked()) return null; // Cannot shoot during immunity

        if (this.fireCooldown <= 0 || isBurstShot) {
            // Main weapon logic
            const projectiles = [];
            
            // Check if this weapon supports burst
            const baseProjectile = this.resolveBaseProjectile();
            const hasOrbWeapon = this.activeGun === 'Orb' && (this.weaponStreamCounts?.Orb || 0) > 0;
            const isBurstWeapon = hasOrbWeapon || (!this.isCyborg && !this.isDimensionX);

            if (!isBurstShot) {
                this.fireCooldown = isBurstWeapon ? BASE_GUN_COOLDOWN : 0.35;
                if (isBurstWeapon) {
                    this.burstCount = baseProjectile.quantity - 1;
                    this.burstTimer = BURST_INTERVAL;
                }
            }

            // Main Gun Fire
            const mainProjs = this.getGunProjectiles(this.x, this.y, this.rotation, baseProjectile);
            projectiles.push(...mainProjs);

            // Ghost Fire
            this.ghosts.forEach(ghost => {
                const ghostProjs = this.getGunProjectiles(ghost.x, ghost.y, ghost.rotation, baseProjectile);
                ghostProjs.forEach(p => p.isGhost = true);
                projectiles.push(...ghostProjs);
            });

            // Missile cadence counts successful primary firing cycles, never burst follow-ups.
            if (!isBurstShot && this.missileLevel > 0) {
                this.missileShotCounter++;
                const shotsPerMissile = 4 - this.missileLevel;
                if (this.missileShotCounter >= shotsPerMissile) {
                    this.missileShotCounter = 0;
                    projectiles.push(this.createMissile(this.x, this.y, this.rotation));

                    this.ghosts.forEach(ghost => {
                        projectiles.push(this.createMissile(ghost.x, ghost.y, ghost.rotation));
                    });
                }
            }

            return projectiles;
        }
        return null;
    }

    createMissile(x, y, rotation) {
        const speed = this.getNormalShipSpeedCap() * 1.8;
        const vx = Math.sin(rotation) * speed;
        const vy = -Math.cos(rotation) * speed;
        const p = new Projectile(x, y, vx, vy, this.color);
        p.owner = this;
        p.isMissile = true;
        p.radius = 14; // Larger missile body/hitbox
        p.aoeRadius = 160; // Large area-of-effect blast radius on detonation
        return p;
    }

    getLaserProjectileDefinition() {
        return {
            kind: 'laser',
            isLaser: true,
            speed: BASE_PROJECTILE_SPEED,
            radius: 8,
            lifeSpan: 10,
            canWrap: true
        };
    }

    resolveBaseProjectile() {
        const quantity = 3 + Math.min(this.maxProjectileUpgrades, Math.max(0, this.projectileUpgradeCount));
        const usesOrb = this.isCyborg || (this.activeGun === 'Orb' && (this.weaponStreamCounts?.Orb || 0) > 0);
        const usesLaser = !usesOrb && (this.isMartian || (!this.isDimensionX && this.activeGun === 'Laser'));
        const definition = usesLaser ? this.getLaserProjectileDefinition() : {
            kind: 'projectile',
            isLaser: false,
            speed: BASE_PROJECTILE_SPEED,
            radius: 8,
            lifeSpan: 999999,
            canWrap: true
        };

        return { ...definition, isOrb: usesOrb, projectileLevel: this.projectileUpgradeCount, quantity };
    }

    getGunProjectiles(x, y, rotation, baseProjectile = this.resolveBaseProjectile()) {
        const projs = [];
        const isDistanceLimitedGun = !baseProjectile.isLaser
            && !baseProjectile.isOrb
            && !this.isDimensionX
            && ['Normal', 'Antigun', 'Double'].includes(this.activeGun);

        const createProj = (angle, lateralOffset = 0) => {
            const projSpeed = baseProjectile.isOrb ? baseProjectile.speed * 0.5 : baseProjectile.speed;
            const vx = Math.sin(angle) * projSpeed;
            const vy = -Math.cos(angle) * projSpeed;
            
            // Base offset from ship center (larger offset for larger ships)
            let spawnOffset = 40;
            if (this.isMartian) spawnOffset = 80;
            else if (this.isDimensionX) spawnOffset = 64; // Scaled with ship size
            else if (baseProjectile.isOrb) spawnOffset = 52;
            
            let sx = x + Math.sin(angle) * spawnOffset;
            let sy = y - Math.cos(angle) * spawnOffset;
            
            // Parallel offset (for Martian Laser upgrade)
            if (lateralOffset !== 0) {
                sx += Math.cos(angle) * lateralOffset;
                sy += Math.sin(angle) * lateralOffset;
            }

            const p = new Projectile(sx, sy, vx, vy, this.color);
            p.owner = this;
            p.isLaser = baseProjectile.isLaser;
            p.radius = baseProjectile.radius;
            p.lifeSpan = baseProjectile.lifeSpan;
            p.canWrap = baseProjectile.canWrap;
            if (isDistanceLimitedGun) p.maxTravelDistance = WORLD_WIDTH;

            // Cyborg base projectile is a single shot orb
            if (baseProjectile.isOrb) {
                p.isLaser = false;
                p.isOrb = true;
                p.radius = 45; // Reduced to 75% of previous size (60 -> 45)
                p.lifeSpan = 1.8; // Increased lifespan to compensate for slower speed
                p.aoeRadius = 80; // Adjusted AoE proportionally
            }

            // Dimension X base projectile is a tentacle
            if (this.isDimensionX) {
                p.isLaser = false;
                p.isTentacle = true;
                p.radius = 16; // Scaled down with ship
                p.lifeSpan = 1.0; // Life handled by tentacle phase logic
            }
            
            return p;
        };

        if (this.isCyborg && (this.weaponStreamCounts?.Orb || 0) === 0 && this.activeGun === 'Laser') {
            // Cyborg Laser powerup: Decoy (Fake Asteroid)
            const dp = createProj(rotation);
            dp.isDecoy = true;
            dp.radius = 50; // Hitbox for the large decoy
            dp.lifeSpan = 5.0; // Lasts longer
            dp.vx *= 0.25; // Moves slower like an asteroid
            dp.vy *= 0.25;
            return [dp];
        }
        if (this.isDimensionX && this.activeGun === 'Laser') {
            // Dimension X Laser powerup: Dual tentacles
            return [createProj(rotation - 0.3), createProj(rotation + 0.3)];
        }

        const emissionAngles = [];
        switch (this.activeGun === 'Laser' ? 'Normal' : this.activeGun) {
            case 'Antigun':
                emissionAngles.push(rotation, rotation + Math.PI);
                break;
            case 'Double':
                emissionAngles.push(rotation - 0.25, rotation + 0.25);
                break;
            default: // Normal
                emissionAngles.push(rotation);
                break;
        }

        const selectedStreams = baseProjectile.isOrb && !this.isCyborg
            ? Math.max(1, this.weaponStreamCounts.Orb)
            : this.isMartian
            ? this.martianParallelGuns
            : Math.max(1, this.weaponStreamCounts?.[this.activeGun] || 0);
        for (let stream = 0; stream < selectedStreams; stream++) {
            const lateralOffset = (stream - (selectedStreams - 1) / 2) * MARTIAN_PARALLEL_OFFSET;
            emissionAngles.forEach(angle => projs.push(createProj(angle, lateralOffset)));
        }
        return projs;
    }

    drawSpriteWithTint(ctx, img, size, accentAlpha = .2) {
        if (!img) return;
        if (this.isExperimentalFleeingNPC) {
            ctx.drawImage(img, -size / 2, -size / 2, size, size);
            return;
        }

        const usesBaseShip =
            !this.isMartian &&
            !this.isCyborg &&
            !this.isDimensionX &&
            !this.isEventHorizon;

        // The normal ship now uses a white/grayscale source image.
        // Multiply applies the exact player color while retaining the
        // source image's highlights, shadows, glow, and transparency.
        if (usesBaseShip) {
            const spriteSize = Math.max(1, Math.ceil(size));
            const cacheKey = `${this.color}:${spriteSize}`;

            if (!this._whiteTintCache) {
                this._whiteTintCache = new Map();
            }

            let tintedCanvas = this._whiteTintCache.get(cacheKey);

            if (!tintedCanvas) {
                tintedCanvas = document.createElement('canvas');
                tintedCanvas.width = spriteSize;
                tintedCanvas.height = spriteSize;

                const tintCtx = tintedCanvas.getContext('2d');

                if (!tintCtx) {
                    ctx.drawImage(
                        img,
                        -size / 2,
                        -size / 2,
                        size,
                        size
                    );
                    return;
                }

                // Draw the white/grayscale source.
                tintCtx.drawImage(
                    img,
                    0,
                    0,
                    spriteSize,
                    spriteSize
                );

                // Color the visible pixels while retaining light and dark values.
                tintCtx.globalCompositeOperation = 'multiply';
                tintCtx.globalAlpha = 0.6;
                tintCtx.fillStyle = this.color;
                tintCtx.fillRect(
                    0,
                    0,
                    spriteSize,
                    spriteSize
                );

                // Reset opacity before restoring the sprite's transparency.
                tintCtx.globalAlpha = 1;

                // Restore the source image's exact transparency.
                tintCtx.globalCompositeOperation = 'destination-in';
                tintCtx.drawImage(
                    img,
                    0,
                    0,
                    spriteSize,
                    spriteSize
                );

                tintCtx.globalCompositeOperation = 'source-over';

                this._whiteTintCache.set(cacheKey, tintedCanvas);
            }

            const tintProgress = this.getExperimentalRespawnTintProgress();

            if (tintProgress < 1) {
                const respawnTintCanvas = document.createElement('canvas');
                respawnTintCanvas.width = spriteSize;
                respawnTintCanvas.height = spriteSize;

                const respawnTintCtx = respawnTintCanvas.getContext('2d');

                if (respawnTintCtx) {
                    respawnTintCtx.drawImage(
                        img,
                        0,
                        0,
                        spriteSize,
                        spriteSize
                    );

                    respawnTintCtx.globalCompositeOperation = 'multiply';
                    respawnTintCtx.globalAlpha = 0.6;
                    respawnTintCtx.fillStyle = '#717171';
                    respawnTintCtx.fillRect(
                        0,
                        0,
                        spriteSize,
                        spriteSize
                    );

                    respawnTintCtx.globalAlpha = 1;
                    respawnTintCtx.globalCompositeOperation = 'destination-in';
                    respawnTintCtx.drawImage(
                        img,
                        0,
                        0,
                        spriteSize,
                        spriteSize
                    );

                    respawnTintCtx.globalCompositeOperation = 'source-over';

                    ctx.save();
                    ctx.globalAlpha *= 1 - tintProgress;
                    ctx.drawImage(
                        respawnTintCanvas,
                        -size / 2,
                        -size / 2,
                        size,
                        size
                    );
                    ctx.restore();
                }
            }

            if (tintProgress > 0) {
                ctx.save();
                ctx.globalAlpha *= tintProgress;
                ctx.drawImage(
                    tintedCanvas,
                    -size / 2,
                    -size / 2,
                    size,
                    size
                );
                ctx.restore();
            }

            return;
        }

        // Preserve the existing behavior for special transformation artwork.
        if (this.isDimensionX || this.color === '#00ffff') {
            ctx.drawImage(
                img,
                -size / 2,
                -size / 2,
                size,
                size
            );
            return;
        }

        const filter = this.getHueFilter(this.color);

        if (!filter) {
            ctx.drawImage(
                img,
                -size / 2,
                -size / 2,
                size,
                size
            );
            return;
        }

        ctx.save();
        ctx.filter = filter;
        ctx.drawImage(
            img,
            -size / 2,
            -size / 2,
            size,
            size
        );
        ctx.restore();
    }

    draw(ctx, assets, camera) {
        // Draw Ghosts
        this.ghosts.forEach(ghost => {
            ctx.save();
            camera.apply(ctx, ghost.x, ghost.y);
            ctx.rotate(ghost.rotation);
            ctx.globalAlpha = 0.5;
            let size = this.radius * 3.5;
            if (this.isMartian) size *= 2; 
            else if (this.isDimensionX) size *= 2.4; // Increased by 50% (1.6 * 1.5 = 2.4)
            else if (this.isEventHorizon) size *= (1 + (this.highTide || 0) * 0.02); // More reasonable scaling
            else if (this.isCyborg) size *= 1.3;
            let img = assets.ship;
            if (this.isMartian) img = assets.ufo;
            if (this.isCyborg) img = assets.cyborg;
            if (this.isDimensionX) img = assets.dimensionX;
            if (this.isEventHorizon) img = assets.eventHorizon;
            this.drawSpriteWithTint(ctx, img, size, 0.45);
            ctx.restore();
        });

        // Draw Player
        ctx.save();
        camera.apply(ctx, this.x, this.y);
        
        // Shield
            if (this.hasForcefield) {
                const shieldAlpha = 0.8;

                ctx.save();

                ctx.globalAlpha = shieldAlpha;
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 4;
                ctx.beginPath();

                const shieldRadius = this.radius * 2;

                // Offset the shield slightly toward the rear of the ship.
                const shieldOffsetX = 0;
                const shieldOffsetY = 0;

                ctx.arc(
                    shieldOffsetX,
                    shieldOffsetY,
                    shieldRadius,
                    0,
                    Math.PI * 2
                );

                ctx.stroke();
                ctx.restore();

        }

        // Ship-attached status uses this same wrapped camera transform as the ship and shield.
        ctx.save();
        const hpBarWidth = 120;
        const hpBarHeight = 8;
        const hpBarY = this.radius * 2 + 10;
        const hpBarX = -hpBarWidth / 2;
        const hpBarRight = hpBarX + hpBarWidth;
        const { blockCount: maxHP, gap, blockWidth } = getHPBlockLayout(this.maxHP, hpBarWidth);
        const currentHP = Math.max(0, Math.min(maxHP, Math.floor(this.currentHP || 0)));

        for (let index = 0; index < maxHP; index++) {
            const blockX = hpBarX + index * (blockWidth + gap);
            const renderedWidth = index === maxHP - 1 ? hpBarRight - blockX : blockWidth;
            ctx.fillStyle = index < currentHP ? '#248cff' : 'rgba(36, 140, 255, 0.18)';
            const pulseScale = index === currentHP - 1 ? this.getDamagePulseScale(this.hullLossPulseTimer) : 1;
            const pulseWidth = renderedWidth * pulseScale;
            const pulseHeight = hpBarHeight * pulseScale;
            ctx.fillRect(
                blockX - (pulseWidth - renderedWidth) / 2,
                hpBarY - (pulseHeight - hpBarHeight) / 2,
                pulseWidth,
                pulseHeight
            );
            if (index >= currentHP && renderedWidth >= 1) {
                ctx.strokeStyle = 'rgba(36, 140, 255, 0.7)';
                ctx.lineWidth = Math.min(1, renderedWidth);
                ctx.strokeRect(blockX, hpBarY, renderedWidth, hpBarHeight);
            }
        }

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px Orbitron';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        ctx.fillText(`${this.level}`, hpBarX - 8, hpBarY + hpBarHeight / 2);
        ctx.textAlign = 'left';
        const shieldTextX = hpBarRight + 8;
        const shieldTextY = hpBarY + hpBarHeight / 2;
        ctx.save();
        ctx.translate(shieldTextX, shieldTextY);
        const shieldPulseScale = this.getDamagePulseScale(this.shieldLossPulseTimer);
        ctx.scale(shieldPulseScale, shieldPulseScale);
        ctx.fillText(`${this.shieldCharges}/${this.maxShieldCharges}`, 0, 0);
        ctx.restore();
        ctx.restore();

        // Spawn Immunity Flashing
        if (this.spawnImmunityTimer > 0) {
            ctx.globalAlpha = 0.5 + Math.sin(Date.now() * 0.02) * 0.3;
        }

        ctx.rotate(this.rotation);
        
        let size = this.radius * 3.6;
        if (this.isMartian) size *= 2;
        else if (this.isDimensionX) size *= 1.6; // 4 * 0.4 = 1.6
        else if (this.isEventHorizon) size *= (1 + (this.highTide || 0) * 0.02);
        else if (this.isCyborg) size *= 1.3;
        let img = assets.ship;
        if (this.isMartian) img = assets.ufo;
        if (this.isCyborg) img = assets.cyborg;
        if (this.isDimensionX) img = assets.dimensionX;
        if (this.isEventHorizon) img = assets.eventHorizon;
        this.drawSpriteWithTint(ctx, img, size, 0.7);
        ctx.restore();
    }

    getHueFilter(color) {
        // Approximate hue rotation from cyan (#00ffff) to target color
        const colors = {
            '#00ffff': '', // Cyan (Original)
            '#ff00ff': 'hue-rotate(120deg)', // Magenta
            '#ffff00': 'hue-rotate(-60deg)', // Yellow
            '#ff0000': 'hue-rotate(180deg)', // Red
            '#00ff00': 'hue-rotate(-120deg)', // Green
            '#0000ff': 'hue-rotate(60deg)', // Blue
            '#ff8800': 'hue-rotate(210deg)', // Orange
            '#8800ff': 'hue-rotate(90deg)' // Purple
        };
        return colors[color] || '';
    }

    get speed() {
        return Math.hypot(this.vx, this.vy);
    }
}
