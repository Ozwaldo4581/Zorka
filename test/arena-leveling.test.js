import test from 'node:test';
import assert from 'node:assert/strict';

import { Asteroid } from '../entities/asteroid.js';
import { SpaceDebris, Satellite } from '../entities/hazards.js';
import { Player } from '../entities/player.js';
import { Game } from '../game.js';

test('XP uses cumulative triangular thresholds and queues every crossed level', () => {
    const player = new Player(0, 0);
    assert.deepEqual([1, 2, 3, 4].map(level => player.getLevelThreshold(level)), [100, 300, 600, 1000]);
    assert.equal(player.addXP(99), 0);
    assert.equal(player.level, 0);
    assert.equal(player.addXP(1), 1);
    assert.equal(player.addXP(500), 2);
    assert.equal(player.totalXP, 600);
    assert.equal(player.level, 3);
    assert.equal(player.pendingLevelUps, 3);
    assert.equal(player.score, 0);
    assert.equal(player.addXP(-1), 0);
    assert.equal(player.addXP(Number.NaN), 0);
});

test('level choices validate caps, consume only successful choices, and share Shield capacity', () => {
    const player = new Player(0, 0);
    player.pendingLevelUps = 22;
    for (let i = 0; i < 10; i++) assert.equal(player.applyLevelUpgrade('projectile'), true);
    assert.equal(player.applyLevelUpgrade('projectile'), false);
    for (let i = 0; i < 10; i++) assert.equal(player.applyLevelUpgrade('speed'), true);
    assert.equal(player.getSpeedMultiplier(), 2);
    assert.equal(player.applyLevelUpgrade('speed'), false);
    assert.equal(player.pendingLevelUps, 2);
    assert.equal(player.applyLevelUpgrade('shield'), true);
    assert.equal(player.maxShieldCharges, 1);
    assert.equal(player.shieldCharges, 1);
    assert.equal(player.pendingLevelUps, 1);
});

test('NPCs immediately resolve every queued choice from selectable upgrades', () => {
    const npc = new Player(0, 0);
    npc.isNPC = true;
    npc.projectileUpgradeCount = 10;
    npc.speedUpgradeCount = 10;
    npc.pendingLevelUps = 3;
    assert.equal(npc.resolveNPCLevelUps(() => 0), 3);
    assert.equal(npc.pendingLevelUps, 0);
    assert.equal(npc.maxShieldCharges, 3);
});

test('Projectile upgrades extend supported bursts without changing each round pattern', () => {
    const player = new Player(0, 0);
    for (const gun of ['Normal', 'Antigun', 'Double']) {
        player.activeGun = gun;
        for (let upgrades = 0; upgrades <= 10; upgrades++) {
            player.projectileUpgradeCount = upgrades;
            const base = gun === 'Normal' ? 1 : 2;
            assert.equal(player.getGunProjectiles(0, 0, 0).length, base, `${gun} pattern at ${upgrades}`);
            assert.equal(player.getBurstRoundCount(), 3 + upgrades, `${gun} burst at ${upgrades}`);
        }
    }
    player.projectileUpgradeCount = 10;
    player.activeGun = 'Laser';
    assert.equal(player.getGunProjectiles(0, 0, 0).length, 1);
    player.activeGun = 'Normal';
    player.isCyborg = true;
    assert.equal(player.getGunProjectiles(0, 0, 0).length, 1);
});

test('level reset clears level bonuses while preserving non-level shield capacity', () => {
    const player = new Player(0, 0);
    player.configureShields(2, 6);
    player.applyShieldUpgrade(); // Capsule-earned capacity.
    player.pendingLevelUps = 3;
    player.applyLevelUpgrade('projectile');
    player.applyLevelUpgrade('speed');
    player.applyLevelUpgrade('shield');
    player.totalXP = 600;
    player.level = 3;

    player.resetLevelProgress();

    assert.equal(player.totalXP, 0);
    assert.equal(player.level, 0);
    assert.equal(player.pendingLevelUps, 0);
    assert.equal(player.projectileUpgradeCount, 0);
    assert.equal(player.speedUpgradeCount, 0);
    assert.equal(player.levelShieldUpgradeCount, 0);
    assert.equal(player.maxShieldCharges, 3);
    assert.equal(player.shieldCharges, 3);
});

test('capsules gained remains cumulative when the active capsule slot wraps or is spent', () => {
    const player = new Player(0, 0);
    for (let index = 0; index < 6; index++) player.addCapsule();
    assert.equal(player.powerUpCapsules, 1);
    assert.equal(player.totalCapsulesGained, 6);
    player.powerUpCapsules = 0;
    assert.equal(player.totalCapsulesGained, 6);

    player.isEventHorizon = true;
    player.addCapsule();
    assert.equal(player.totalCapsulesGained, 6);
});

test('Arcade forces Hardcore without changing the configured option', () => {
    const game = { gameState: 'ARCADE', hardcoreMode: false };
    assert.equal(Game.prototype.isHardcoreActive.call(game), true);
    assert.equal(game.hardcoreMode, false);
    game.gameState = 'SOLO';
    assert.equal(Game.prototype.isHardcoreActive.call(game), false);
});

test('Arcade waves advance once and sustain exactly eight living NPCs', () => {
    const game = {
        gameState: 'ARCADE',
        arcadeGameOver: false,
        arcadeWaveSize: 1,
        arcadeSustainEight: false,
        players: [{ isNPC: false, isDead: false }],
        spawned: 0,
        spawnArcadeWave(count) { this.spawned += count; }
    };
    Game.prototype.reconcileArcadeNPCs.call(game);
    assert.equal(game.arcadeWaveSize, 2);
    assert.equal(game.spawned, 2);

    game.arcadeWaveSize = 7;
    game.spawned = 0;
    Game.prototype.reconcileArcadeNPCs.call(game);
    assert.equal(game.arcadeWaveSize, 8);
    assert.equal(game.arcadeSustainEight, true);
    assert.equal(game.spawned, 8);

    game.players.push(...Array.from({ length: 5 }, () => ({ isNPC: true, isDead: false, isEliminated: false })));
    game.spawned = 0;
    Game.prototype.reconcileArcadeNPCs.call(game);
    assert.equal(game.spawned, 3);
});

const rewardGame = killer => ({
    players: [killer],
    asteroids: [],
    hazards: [],
    gameState: 'SOLO',
    audio: { playSpatial() {} },
    getActiveCameras: () => [],
    createExplosion() {},
    spawnAsteroid() {},
    spawnSatellite() {},
    spawnSpaceDebris() {},
    awardXP: Game.prototype.awardXP
});

test('confirmed targets award authoritative XP once by target type', () => {
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = () => 0;
    try {
        for (const [target, expected] of [
            [new Asteroid(0, 0, 'large'), 1],
            [new Asteroid(0, 0, 'medium'), 0],
            [new Asteroid(0, 0, 'small'), 0],
            [new SpaceDebris(0, 0), 5],
            [new Satellite(0, 0), 15]
        ]) {
            const killer = new Player(100, 100);
            const game = rewardGame(killer);
            game.asteroids = target instanceof Asteroid ? [target] : [];
            game.hazards = target instanceof Asteroid ? [] : [target];
            target.maxHits = 1;
            Game.prototype.hitTarget.call(game, target, killer);
            Game.prototype.hitTarget.call(game, target, killer);
            assert.equal(killer.totalXP, expected);
        }
    } finally {
        globalThis.setTimeout = originalSetTimeout;
    }
});

test('confirmed ship death awards 100 XP once and shield absorption awards none', () => {
    globalThis.window = globalThis.window || {};
    const killer = new Player(0, 0);
    const victim = new Player(0, 0, 2);
    victim.spawnImmunityTimer = 0;
    const game = {
        players: [killer, victim],
        audio: { playSpatial() {} },
        getActiveCameras: () => [],
        clearAimLocksForTarget() {},
        createExplosion() {},
        awardXP: Game.prototype.awardXP
    };
    Game.prototype.playerDeath.call(game, victim, killer);
    Game.prototype.playerDeath.call(game, victim, killer);
    assert.equal(killer.totalXP, 100);

    const shielded = new Player(0, 0, 3);
    shielded.spawnImmunityTimer = 0;
    shielded.configureShields(1, 6);
    game.players.push(shielded);
    Game.prototype.playerDeath.call(game, shielded, killer);
    assert.equal(killer.totalXP, 100);
    assert.equal(shielded.isDead, false);
});

test('Hardcore resets victim level progress only after a confirmed unshielded death', () => {
    globalThis.window = globalThis.window || {};
    const makeGame = (players, hardcoreMode) => ({
        players,
        hardcoreMode,
        audio: { playSpatial() {} },
        getActiveCameras: () => [],
        clearAimLocksForTarget() {},
        createExplosion() {},
        awardXP: Game.prototype.awardXP
    });

    const hardcoreVictim = new Player(0, 0);
    hardcoreVictim.spawnImmunityTimer = 0;
    hardcoreVictim.totalXP = 100;
    hardcoreVictim.level = 1;
    hardcoreVictim.pendingLevelUps = 1;
    Game.prototype.playerDeath.call(makeGame([hardcoreVictim], true), hardcoreVictim);
    assert.equal(hardcoreVictim.level, 0);
    assert.equal(hardcoreVictim.totalXP, 0);

    const standardVictim = new Player(0, 0);
    standardVictim.spawnImmunityTimer = 0;
    standardVictim.totalXP = 100;
    standardVictim.level = 1;
    standardVictim.pendingLevelUps = 1;
    standardVictim.burstCount = 4;
    Game.prototype.playerDeath.call(makeGame([standardVictim], false), standardVictim);
    assert.equal(standardVictim.level, 1);
    assert.equal(standardVictim.totalXP, 100);
    assert.equal(standardVictim.pendingLevelUps, 1);
    assert.equal(standardVictim.burstCount, 0);

    const shielded = new Player(0, 0);
    shielded.spawnImmunityTimer = 0;
    shielded.level = 1;
    shielded.configureShields(1, 6);
    Game.prototype.playerDeath.call(makeGame([shielded], true), shielded);
    assert.equal(shielded.level, 1);
    assert.equal(shielded.isDead, false);
});
