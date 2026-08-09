import test from 'node:test';
import assert from 'node:assert/strict';

import { getHPBlockLayout, Player } from '../entities/player.js';
import { Game, MISSILE_DAMAGE } from '../game.js';

const makeDamageGame = players => ({
    players,
    gameState: 'SOLO',
    hardcoreMode: false,
    startingShieldCharges: 0,
    audio: { playSpatial() {} },
    getActiveCameras: () => [],
    clearAimLocksForTarget() {},
    createExplosion() {},
    awardXP: Game.prototype.awardXP
});

test('Player owns HP damage, resettable recharge, and instant full restoration', () => {
    const player = new Player(0, 0);
    assert.deepEqual([player.currentHP, player.maxHP, player.hpRechargeTimer], [10, 10, 0]);

    assert.equal(player.takeHPDamage(), true);
    assert.deepEqual([player.currentHP, player.hpRechargeTimer], [9, 20]);
    player.updateHPRecharge(19);
    assert.deepEqual([player.currentHP, player.hpRechargeTimer], [9, 1]);
    player.takeHPDamage();
    assert.deepEqual([player.currentHP, player.hpRechargeTimer], [8, 20]);
    player.updateHPRecharge(20);
    assert.deepEqual([player.currentHP, player.hpRechargeTimer], [10, 0]);
});

test('level gains grant only the newly earned current and maximum HP', () => {
    const player = new Player(0, 0);
    player.currentHP = 2;
    player.hpRechargeTimer = 12;
    assert.equal(player.addXP(500), 2);
    assert.deepEqual([player.level, player.currentHP, player.maxHP], [2, 4, 12]);
    assert.equal(player.hpRechargeTimer, 12);

    player.resetLevelProgress();
    assert.deepEqual([player.level, player.currentHP, player.maxHP, player.hpRechargeTimer], [0, 10, 10, 0]);
});

test('Game resolves immunity, shields, HP, death, and respawn in order', () => {
    globalThis.window = globalThis.window || {};
    const killer = new Player(0, 0);
    const victim = new Player(0, 0, 2);
    victim.configureShields(1, 6);
    const game = makeDamageGame([killer, victim]);

    Game.prototype.playerDeath.call(game, victim, killer);
    assert.deepEqual([victim.shieldCharges, victim.currentHP], [1, 10]);

    victim.spawnImmunityTimer = 0;
    Game.prototype.playerDeath.call(game, victim, killer);
    assert.deepEqual([victim.shieldCharges, victim.currentHP, victim.hpRechargeTimer], [0, 10, 0]);

    for (let hit = 0; hit < 9; hit++) Game.prototype.playerDeath.call(game, victim, killer);
    assert.deepEqual([victim.isDead, victim.currentHP, killer.score], [false, 1, 0]);
    Game.prototype.playerDeath.call(game, victim, killer);
    assert.deepEqual([victim.isDead, victim.currentHP, killer.score], [true, 0, 1]);

    victim.maxHP = 8;
    victim.currentHP = 0;
    victim.hpRechargeTimer = 20;
    Game.prototype.respawnPlayer.call(game, victim);
    assert.deepEqual([victim.isDead, victim.currentHP, victim.maxHP, victim.hpRechargeTimer], [false, 8, 8, 0]);
});

test('Game resolves a multi-point hit as one shield-first damage event', () => {
    globalThis.window = globalThis.window || {};
    const cases = [
        { shields: 5, hp: 5, expected: [0, 5, false] },
        { shields: 3, hp: 5, expected: [0, 3, false] },
        { shields: 10, hp: 5, expected: [5, 5, false] },
        { shields: 0, hp: 5, expected: [0, 0, true] },
        { shields: 1, hp: 3, expected: [0, 0, true] }
    ];

    for (const { shields, hp, expected } of cases) {
        const player = new Player(0, 0);
        player.spawnImmunityTimer = 0;
        player.configureShields(shields, 6);
        player.currentHP = hp;
        const game = makeDamageGame([player]);
        const result = Game.prototype.resolvePlayerDamage.call(game, player, 5);
        assert.deepEqual([player.shieldCharges, player.currentHP, player.isDead], expected);
        assert.equal(result.shieldsConsumed + result.hpLost, Math.min(5, shields + hp));
        assert.equal(result.died, expected[2]);
    }
});

test('Missile damage budget resolves shields, hull, immunity, and Specter hull uniformly', () => {
    globalThis.window = globalThis.window || {};
    const cases = [
        { shields: 3, hp: 5, expected: [0, 5, false] },
        { shields: 1, hp: 5, expected: [0, 3, false] },
        { shields: 0, hp: 5, expected: [0, 2, false] },
        { shields: 0, hp: 2, expected: [0, 0, true] }
    ];

    for (const { shields, hp, expected } of cases) {
        const player = new Player(0, 0);
        player.spawnImmunityTimer = 0;
        player.configureShields(shields, 6);
        player.currentHP = hp;
        const result = Game.prototype.resolvePlayerDamage.call(
            makeDamageGame([player]), player, MISSILE_DAMAGE
        );
        assert.deepEqual([player.shieldCharges, player.currentHP, player.isDead], expected);
        assert.equal(result.shieldsConsumed + result.hpLost, Math.min(MISSILE_DAMAGE, shields + hp));
    }

    const immune = new Player(0, 0);
    immune.configureShields(3, 6);
    Game.prototype.resolvePlayerDamage.call(makeDamageGame([immune]), immune, MISSILE_DAMAGE);
    assert.deepEqual([immune.shieldCharges, immune.currentHP, immune.isDead], [3, 10, false]);

    const specter = new Player(0, 0);
    specter.isExperimentalFleeingNPC = true;
    specter.spawnImmunityTimer = 0;
    specter.configureShields(0, 6);
    specter.currentHP = 4;
    Game.prototype.resolvePlayerDamage.call(makeDamageGame([specter]), specter, MISSILE_DAMAGE);
    assert.deepEqual([specter.shieldCharges, specter.currentHP, specter.isDead], [0, 1, false]);
});

test('damage starts and refreshes Player-owned shield and hull pulses that expire with updates', () => {
    const player = new Player(0, 0);
    player.spawnImmunityTimer = 0;
    player.configureShields(2, 6);
    const game = makeDamageGame([player]);

    Game.prototype.resolvePlayerDamage.call(game, player, 3);
    assert.equal(player.shieldCharges, 0);
    assert.equal(player.currentHP, 9);
    assert.ok(player.shieldLossPulseTimer > 0);
    assert.ok(player.hullLossPulseTimer > 0);

    const firstHullPulse = player.hullLossPulseTimer;
    player.updateDamagePulses(0.2);
    assert.ok(player.hullLossPulseTimer < firstHullPulse);
    Game.prototype.resolvePlayerDamage.call(game, player, 1);
    assert.equal(player.hullLossPulseTimer, firstHullPulse);
    player.updateDamagePulses(1);
    assert.deepEqual([player.shieldLossPulseTimer, player.hullLossPulseTimer], [0, 0]);

    player.spawnImmunityTimer = 1;
    Game.prototype.resolvePlayerDamage.call(game, player, 1);
    assert.deepEqual([player.shieldLossPulseTimer, player.hullLossPulseTimer], [0, 0]);
});

test('fixed-width HP layout compresses blocks without overflowing', () => {
    const layouts = [5, 6, 10, 20, 500].map(maxHP => getHPBlockLayout(maxHP));
    for (const layout of layouts) {
        const occupiedWidth = layout.blockCount * layout.blockWidth + (layout.blockCount - 1) * layout.gap;
        assert.ok(layout.blockWidth > 0);
        assert.ok(occupiedWidth <= layout.totalWidth + Number.EPSILON * 100);
        assert.ok(Math.abs(occupiedWidth - 120) < 1e-9);
    }
    assert.ok(layouts[0].blockWidth > layouts[1].blockWidth);
    assert.ok(layouts[1].blockWidth > layouts[2].blockWidth);
    assert.ok(layouts[2].blockWidth > layouts[3].blockWidth);
    assert.ok(layouts[4].gap < 2);
});
