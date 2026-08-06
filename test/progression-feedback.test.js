import test from 'node:test';
import assert from 'node:assert/strict';

import { Game, GAME_MODE } from '../game.js';
import { Player } from '../entities/player.js';
import { HUD } from '../ui/hud.js';

const makeCanvasContext = () => ({
    texts: [], fills: [],
    save() {}, restore() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {},
    fillRect(x, y, width, height) { this.fills.push({ x, y, width, height }); },
    fillText(value) { this.texts.push(String(value)); }
});

test('Solo and Experimental leaderboards read Player progression stats while other modes keep score columns', () => {
    const player = new Player(0, 0, 1, '#abc');
    player.name = 'Nova';
    player.configureShields(3, 6);
    player.projectileUpgradeCount = 1;
    player.speedUpgradeCount = 2;
    const expectedStats = {
        name: 'Nova', level: 0, hullStrength: 10, shields: '3/3',
        projectile: 1, shieldRecharge: 0, shieldRechargeDelay: 6,
        speed: 3, deaths: 0
    };
    assert.deepEqual(player.getLeaderboardStats(), expectedStats);

    const hud = new HUD();
    for (const mode of [GAME_MODE.SOLO, GAME_MODE.EXPERIMENTAL]) {
        const ctx = makeCanvasContext();
        hud.drawScoreboard(ctx, [player], false, mode);
        for (const label of ['Level', 'Hull Strength', 'Shields', 'Projectile', 'Speed', 'Deaths']) {
            assert.ok(ctx.texts.includes(label));
        }
        for (const key of ['level', 'hullStrength', 'shields', 'projectile', 'shieldRecharge', 'speed', 'deaths']) {
            assert.ok(ctx.texts.includes(String(expectedStats[key])));
        }
    }

    const pvp = makeCanvasContext();
    hud.drawScoreboard(pvp, [player], false, GAME_MODE.PVP);
    assert.ok(pvp.texts.includes('HIGH TIDE'));
    assert.equal(pvp.texts.includes('Hull Strength'), false);
});

test('standalone level panel no longer draws or reserves space for a shield number', () => {
    const player = new Player(0, 0);
    player.shieldCharges = 7;
    const ctx = makeCanvasContext();
    ctx.save = () => {};
    ctx.restore = () => {};
    new HUD().drawLevelDisplay(ctx, player, 20, 850);
    assert.equal(ctx.texts.includes('SHIELD'), false);
    assert.equal(ctx.texts.includes('7'), false);
    assert.equal(ctx.fills[0].width, 100);
});

test('standard projectile audio plays once for an accepted burst and not for its secondary rounds', () => {
    const player = new Player(0, 0);
    player.spawnImmunityTimer = 0;
    const sounds = [];
    const game = {
        gameState: GAME_MODE.SOLO,
        players: [player], projectiles: [],
        addProjectile: Game.prototype.addProjectile,
        getActiveCameras: () => [],
        audio: { playSpatial(name) { sounds.push(name); } }
    };
    Game.prototype.handleFire.call(game, player.id);
    Game.prototype.handleFire.call(game, player.id, true);
    Game.prototype.handleFire.call(game, player.id, true);
    assert.deepEqual(sounds, ['laser_fire']);

    Game.prototype.handleFire.call(game, player.id);
    assert.deepEqual(sounds, ['laser_fire'], 'cooldown-blocked fire stays silent');
    player.fireCooldown = 0;
    Game.prototype.handleFire.call(game, player.id);
    assert.deepEqual(sounds, ['laser_fire', 'laser_fire']);
});

test('Experimental death records one death and displays attributed return feedback', () => {
    globalThis.window = globalThis.window || {};
    const victim = new Player(0, 0);
    const killer = Object.assign(new Player(0, 0, 2), { name: 'TIMMY', isNPC: true });
    victim.spawnImmunityTimer = 0;
    victim.currentHP = 1;
    const game = {
        gameState: GAME_MODE.EXPERIMENTAL,
        hardcoreMode: false,
        players: [victim, killer],
        startingShieldCharges: 0,
        audio: { playSpatial() {} },
        experimentalRooms: [],
        getActiveCameras: () => [],
        clearAimLocksForTarget() {}, createExplosion() {},
        awardXP: Game.prototype.awardXP
    };
    Game.prototype.resolvePlayerDamage.call(game, victim, 1, killer);
    assert.equal(victim.deaths, 1);
    assert.deepEqual(
        [game.experimentalSectorMessage.text, game.experimentalSectorMessage.detail],
        ["Defeated by Zorka's Enemies", 'Returning to Sector 1']
    );
    Game.prototype.resolvePlayerDamage.call(game, victim, 1, killer);
    assert.equal(victim.deaths, 1, 'a dead player cannot be counted twice before respawn');
    assert.equal(Game.prototype.getDamageSourceDisplayName.call(game, null), 'the Environment');

    const soloVictim = new Player(0, 0);
    soloVictim.spawnImmunityTimer = 0;
    soloVictim.currentHP = 1;
    const solo = { ...game, gameState: GAME_MODE.SOLO, players: [soloVictim, killer], experimentalSectorMessage: null };
    Game.prototype.resolvePlayerDamage.call(solo, soloVictim, 1, killer);
    assert.equal(solo.experimentalSectorMessage, null);
});
