import test from 'node:test';
import assert from 'node:assert/strict';

import { Asteroid } from '../entities/asteroid.js';
import { SpaceDebris, Satellite } from '../entities/hazards.js';
import { Player } from '../entities/player.js';
import { Game } from '../game.js';

test('XP uses cumulative quadratic per-level requirements and queues every crossed level', () => {
    const player = new Player(0, 0);
    assert.equal(player.level, 0);
    assert.deepEqual([0, 1, 2, 3, 4].map(level => player.getLevelThreshold(level)), [0, 100, 500, 1400, 3000]);
    assert.deepEqual([0, 1, 2, 3, 4, 10].map(level => player.getXPRequirement(level)), [100, 400, 900, 1600, 2500, 12100]);
    assert.equal(player.addXP(99), 0);
    assert.equal(player.level, 0);
    assert.equal(player.addXP(1), 1);
    assert.equal(player.addXP(400), 1);
    assert.equal(player.totalXP, 500);
    assert.equal(player.level, 2);
    assert.equal(player.pendingLevelUps, 2);
    assert.equal(player.score, 0);
    assert.equal(player.addXP(-1), 0);
    assert.equal(player.addXP(Number.NaN), 0);
});

test('level choices validate ten-level caps and Shield Recharge leaves capacity unchanged', () => {
    const player = new Player(0, 0);
    player.pendingLevelUps = 22;
    for (let i = 0; i < 10; i++) assert.equal(player.applyLevelUpgrade('projectile'), true);
    assert.equal(player.applyLevelUpgrade('projectile'), false);
    for (let i = 0; i < 10; i++) assert.equal(player.applyLevelUpgrade('speed'), true);
    assert.equal(player.getSpeedMultiplier(), 2);
    assert.equal(player.applyLevelUpgrade('speed'), false);
    assert.equal(player.pendingLevelUps, 2);
    assert.equal(player.applyLevelUpgrade('shield'), true);
    assert.equal(player.maxShieldCharges, 0);
    assert.equal(player.shieldRechargeUpgradeCount, 1);
    assert.equal(player.pendingLevelUps, 1);
});

test('Projectile state clamps legacy values and Speed scales thrust without changing the speed cap', () => {
    const legacyPlayer = new Player(0, 0);
    legacyPlayer.projectileUpgradeCount = 10;
    legacyPlayer.pendingLevelUps = 1;
    assert.equal(legacyPlayer.applyLevelUpgrade('projectile'), false);
    assert.equal(legacyPlayer.projectileUpgradeCount, 10);
    assert.equal(legacyPlayer.pendingLevelUps, 1);

    const speeds = [0, 5, 10].map(speedUpgradeCount => {
        const player = new Player(0, 0);
        player.controlMode = 'KEYBOARD';
        player.speedUpgradeCount = speedUpgradeCount;
        player.update(0.1, { KeyW: true }, {}, null);
        return Math.hypot(player.vx, player.vy);
    });
    assert.deepEqual(speeds, [80, 120, 160]);

    const capped = new Player(0, 0);
    capped.speedUpgradeCount = 10;
    capped.vx = 900;
    capped.update(0, {}, {}, null);
    assert.equal(Math.hypot(capped.vx, capped.vy), 800);
});

test('NPCs immediately resolve every queued choice from selectable upgrades', () => {
    const npc = new Player(0, 0);
    npc.isNPC = true;
    npc.projectileUpgradeCount = 10;
    npc.speedUpgradeCount = 10;
    npc.pendingLevelUps = 3;
    assert.equal(npc.resolveNPCLevelUps(() => 0), 3);
    assert.equal(npc.pendingLevelUps, 0);
    assert.equal(npc.shieldRechargeUpgradeCount, 3);
});

test('new NPCs initialize at a target level with consistent XP and resolved upgrades', () => {
    for (const targetLevel of [3, 8, 25, 500]) {
        const npc = new Player(0, 0);
        npc.isNPC = true;
        assert.equal(npc.initializeNPCLevel(targetLevel, () => 0), true);
        assert.equal(npc.level, targetLevel);
        assert.equal(npc.totalXP, npc.getLevelThreshold(targetLevel));
        assert.equal(npc.pendingLevelUps, 0);
        assert.equal(npc.projectileUpgradeCount, Math.min(10, targetLevel));
        assert.equal(npc.speedUpgradeCount, Math.min(10, Math.max(0, targetLevel - 10)));
        assert.equal(npc.shieldRechargeUpgradeCount, Math.min(10, Math.max(0, targetLevel - 20)));
        assert.equal(npc.score, 0);
        assert.equal(npc.prestigeLevel, 0);
    }
});

test('standard match composition starts humans at level 0 and NPCs at level 1', () => {
    const makeGame = () => ({
        players: [], p1ControlMode: 'KEYBOARD', botAggressionLevel: 3,
        configurePlayerShields() {}, resetMouseLockInput() {}
    });
    const solo = makeGame();
    Game.prototype.spawnPlayers.call(solo, 'SOLO', 3);
    assert.deepEqual(solo.players.map(player => [player.isNPC, player.level, player.controlMode]), [
        [false, 0, 'KEYBOARD'], [true, 1, undefined], [true, 1, undefined]
    ]);

    const pvp = makeGame();
    Game.prototype.spawnPlayers.call(pvp, 'PVP', 3);
    assert.deepEqual(pvp.players.map(player => [player.isNPC, player.level]), [[false, 0], [false, 0], [true, 1]]);
    assert.equal(pvp.players[1].controlMode, 'GAMEPAD');
});

test('disabled transformations enforce Earthling without consuming score or granting prestige', () => {
    const player = new Player(0, 0);
    player.score = 100;
    player.isEventHorizon = true;
    player.justPrestiged = true;
    player.update(0, {}, {}, null, [], [], [], false, 20, [], null, false);
    assert.equal(player.score, 100);
    assert.equal(player.prestigeLevel, 0);
    assert.equal(player.justPrestiged, false);
    assert.equal(player.isMartian, false);
    assert.equal(player.isCyborg, false);
    assert.equal(player.isDimensionX, false);
    assert.equal(player.isEventHorizon, false);
    assert.match(player.name, /^EARTHLING/);
});

test('Projectile upgrades extend supported bursts without changing each round pattern', () => {
    const player = new Player(0, 0);
    for (const gun of ['Normal', 'Antigun', 'Double']) {
        player.activeGun = gun;
        for (let upgrades = 0; upgrades <= 5; upgrades++) {
            player.projectileUpgradeCount = upgrades;
            const base = gun === 'Normal' ? 1 : 2;
            assert.equal(player.getGunProjectiles(0, 0, 0).length, base, `${gun} pattern at ${upgrades}`);
            assert.equal(player.getBurstRoundCount(), 3 + upgrades, `${gun} burst at ${upgrades}`);
        }
    }
    player.projectileUpgradeCount = 5;
    player.activeGun = 'Laser';
    assert.equal(player.getGunProjectiles(0, 0, 0).length, 1);
    player.activeGun = 'Normal';
    player.isCyborg = true;
    assert.equal(player.getGunProjectiles(0, 0, 0).length, 1);
});

test('Earthling Capsule 3 and the Martian base weapon share one laser definition', () => {
    const earthling = new Player(0, 0);
    earthling.activeGun = 'Laser';
    earthling.projectileUpgradeCount = 4;

    const martian = new Player(0, 0);
    martian.setEvolutionForm('MARTIAN');
    martian.projectileUpgradeCount = 4;

    assert.deepEqual(earthling.resolveBaseProjectile(), martian.resolveBaseProjectile());
    assert.equal(martian.resolveBaseProjectile().quantity, 7);
    assert.equal(martian.getGunProjectiles(0, 0, 0)[0].isLaser, true);
});

test('Martian Capsule 3 duplicates every completed gun-pattern emission in parallel', () => {
    const player = new Player(100, 100);
    player.setEvolutionForm('MARTIAN');
    player.martianParallelGuns = 2;

    for (const [gun, patternSize] of [['Normal', 1], ['Antigun', 2], ['Double', 2]]) {
        player.activeGun = gun;
        const shots = player.getGunProjectiles(player.x, player.y, player.rotation);
        assert.equal(shots.length, patternSize * 2);
        for (let index = 0; index < patternSize; index++) {
            const original = shots[index];
            const duplicate = shots[index + patternSize];
            assert.equal(duplicate.vx, original.vx);
            assert.equal(duplicate.vy, original.vy);
            assert.equal(duplicate.rotation, original.rotation);
            assert.ok(Math.abs(Math.hypot(duplicate.x - original.x, duplicate.y - original.y) - 30) < 1e-9);
            assert.equal(duplicate.isLaser, true);
        }
    }
});

test('Martian base fire shares Earthling cadence and Capsule 3 does not add a timer', () => {
    const fireOnce = player => {
        player.spawnImmunityTimer = 0;
        const shots = player.fire();
        return { shots, cooldown: player.fireCooldown, burstCount: player.burstCount };
    };
    const earthling = fireOnce(new Player(0, 0));
    const martianPlayer = new Player(0, 0);
    martianPlayer.setEvolutionForm('MARTIAN');
    martianPlayer.martianParallelGuns = 2;
    const martian = fireOnce(martianPlayer);

    assert.equal(martian.cooldown, earthling.cooldown);
    assert.equal(martian.burstCount, earthling.burstCount);
    assert.equal(martian.shots.length, 2);
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
    player.maxShieldCharges += 3;

    player.resetLevelProgress();

    assert.equal(player.totalXP, 0);
    assert.equal(player.level, 0);
    assert.equal(player.pendingLevelUps, 0);
    assert.equal(player.projectileUpgradeCount, 0);
    assert.equal(player.speedUpgradeCount, 0);
    assert.equal(player.shieldRechargeUpgradeCount, 0);
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

test('Arcade and Experimental disable transformations', () => {
    for (const [gameState, expected] of [['ARCADE', false], ['EXPERIMENTAL', false], ['SOLO', true], ['PVP', true]]) {
        assert.equal(Game.prototype.areTransformationsEnabled.call({ gameState }), expected);
    }
});

test('Arcade waves advance once and sustain exactly eight living NPCs', () => {
    const game = {
        gameState: 'ARCADE',
        arcadeGameOver: false,
        arcadeWaveSize: 1,
        arcadeSustainEight: false,
        players: [{ isNPC: false, isDead: false }],
        spawned: [],
        nextArcadeReplacementLevel: 9,
        spawnArcadeWave(count, targetLevel) { this.spawned.push(...Array(count).fill(targetLevel)); },
        spawnArcadeNPC(targetLevel) {
            this.spawned.push(targetLevel);
            const npc = { isNPC: true, isDead: false, isEliminated: false };
            this.players.push(npc);
            return npc;
        }
    };
    Game.prototype.reconcileArcadeNPCs.call(game);
    assert.equal(game.arcadeWaveSize, 2);
    assert.deepEqual(game.spawned, [2, 2]);

    game.arcadeWaveSize = 7;
    game.spawned = [];
    Game.prototype.reconcileArcadeNPCs.call(game);
    assert.equal(game.arcadeWaveSize, 8);
    assert.equal(game.arcadeSustainEight, true);
    assert.deepEqual(game.spawned, Array(8).fill(8));

    game.players.push(...Array.from({ length: 5 }, () => ({ isNPC: true, isDead: false, isEliminated: false })));
    game.spawned = [];
    Game.prototype.reconcileArcadeNPCs.call(game);
    assert.deepEqual(game.spawned, [9, 10, 11]);
    assert.equal(game.nextArcadeReplacementLevel, 12);
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

test('confirmed NPC death awards level-scaled XP once and shield absorption awards none', () => {
    globalThis.window = globalThis.window || {};
    const killer = new Player(0, 0);
    const victim = new Player(0, 0, 2);
    victim.isNPC = true;
    victim.initializeNPCLevel(1);
    victim.spawnImmunityTimer = 0;
    const game = {
        players: [killer, victim],
        audio: { playSpatial() {} },
        getActiveCameras: () => [],
        clearAimLocksForTarget() {},
        createExplosion() {},
        awardXP: Game.prototype.awardXP
    };
    for (let hit = 0; hit < 11; hit++) Game.prototype.playerDeath.call(game, victim, killer);
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

test('NPC XP rewards use the defeated NPC level and reject humans or malformed levels', () => {
    const game = {};
    for (const [level, expected] of [[1, 100], [2, 200], [3, 300], [10, 1000]]) {
        const npc = Object.assign(new Player(0, 0), { isNPC: true, level });
        assert.equal(Game.prototype.getNPCXPReward.call(game, npc), expected);
    }
    assert.equal(Game.prototype.getNPCXPReward.call(game, Object.assign(new Player(0, 0), { level: 10 })), 0);
    assert.equal(Game.prototype.getNPCXPReward.call(game, { isNPC: true, level: Number.NaN }), 0);
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
    const hardcoreGame = makeGame([hardcoreVictim], true);
    for (let hit = 0; hit < 10; hit++) Game.prototype.playerDeath.call(hardcoreGame, hardcoreVictim);
    assert.equal(hardcoreVictim.level, 0);
    assert.equal(hardcoreVictim.totalXP, 0);

    const standardVictim = new Player(0, 0);
    standardVictim.spawnImmunityTimer = 0;
    standardVictim.totalXP = 100;
    standardVictim.level = 1;
    standardVictim.pendingLevelUps = 1;
    standardVictim.burstCount = 4;
    const standardGame = makeGame([standardVictim], false);
    for (let hit = 0; hit < 10; hit++) Game.prototype.playerDeath.call(standardGame, standardVictim);
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
