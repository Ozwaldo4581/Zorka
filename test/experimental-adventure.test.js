import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { Game, GAME_MODE } from '../game.js';
import { Player } from '../entities/player.js';
import { Projectile } from '../entities/projectile.js';

globalThis.window ??= {};

test('Experimental adventure label and shared controller helper text match gameplay', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="btn-experimental-start" aria-label="Adventure">[\s\S]*?SharpieAdventure\.png[\s\S]*?<\/button>/);
    const hud = await readFile(new URL('../ui/hud.js', import.meta.url), 'utf8');
    assert.match(hud, /\['1 \/ X', '2 \/ Y', '3 \/ B'\]/);
    assert.match(hud, /Press Spacebar \/ A to select a Capsule Bonus/);
});

test('Experimental is forced Hardcore and confirmed human death ends once without respawn', () => {
    const human = new Player(100, 100, 1, '#f00');
    human.currentHP = 1;
    human.spawnImmunityTimer = 0;
    human.totalXP = 321;
    human.level = 4;
    human.totalCapsulesGained = 7;
    let result = null;
    let gameOvers = 0;
    const game = {
        gameState: GAME_MODE.EXPERIMENTAL,
        hardcoreMode: false,
        players: [human],
        experimentalRooms: [],
        audio: { playSpatialUnwrapped() {} },
        getActiveCameras: () => [],
        clearAimLocksForTarget() {},
        awardXP() {},
        playSpatialEvent() {},
        createExplosion() {},
        showArcadeGameOver(value) { gameOvers++; result = value; }
    };
    assert.equal(Game.prototype.isHardcoreActive.call(game), true);
    Game.prototype.resolvePlayerDamage.call(game, human, 1);
    assert.equal(human.isDead, true);
    assert.equal(human.respawnTimer, 0);
    assert.deepEqual(result, { finalLevel: 4, totalXP: 321, totalCapsulesGained: 7 });
    Game.prototype.resolvePlayerDamage.call(game, human, 1);
    assert.equal(gameOvers, 1);
});

test('Experimental shields prevent Game Over and NPC death remains a respawn outcome', () => {
    const human = new Player(0, 0, 1);
    human.configureShields(1, 0);
    human.spawnImmunityTimer = 0;
    const npc = new Player(0, 0, 2);
    npc.isNPC = true;
    npc.currentHP = 1;
    npc.spawnImmunityTimer = 0;
    let gameOvers = 0;
    const game = {
        gameState: GAME_MODE.EXPERIMENTAL, hardcoreMode: false, players: [human, npc],
        experimentalRooms: [], audio: { playSpatialUnwrapped() {} },
        getActiveCameras: () => [], clearAimLocksForTarget() {}, awardXP() {},
        playSpatialEvent() {}, createExplosion() {}, showArcadeGameOver() { gameOvers++; }
    };
    Game.prototype.resolvePlayerDamage.call(game, human, 1);
    assert.equal(human.isDead, false);
    Game.prototype.resolvePlayerDamage.call(game, npc, 1);
    assert.equal(npc.isDead, true);
    assert.equal(npc.respawnTimer, 2);
    assert.equal(gameOvers, 0);
});

test('Experimental hostility uses NPC color after room locality and lets human status override color', () => {
    const redNpc = Object.assign(new Player(0, 0, 2, '#f00'), { isNPC: true, roomId: 'one' });
    const blueNpc = Object.assign(new Player(0, 0, 3, '#00f'), { isNPC: true, roomId: 'one' });
    const otherRedNpc = Object.assign(new Player(0, 0, 4, '#f00'), { isNPC: true, roomId: 'one' });
    const redHuman = Object.assign(new Player(0, 0, 1, '#f00'), { roomId: 'one' });
    const remoteBlue = Object.assign(new Player(0, 0, 5, '#00f'), { isNPC: true, roomId: 'two' });
    const game = { gameState: GAME_MODE.EXPERIMENTAL };
    assert.equal(Game.prototype.isHostileTarget.call(game, redNpc, redHuman), true);
    assert.equal(Game.prototype.isHostileTarget.call(game, redNpc, otherRedNpc), false);
    assert.equal(Game.prototype.isHostileTarget.call(game, redNpc, blueNpc), true);
    assert.equal(Game.prototype.isHostileTarget.call(game, blueNpc, redNpc), true);
    assert.equal(Game.prototype.isHostileTarget.call(game, redNpc, redNpc), false);
    assert.equal(Game.prototype.isHostileTarget.call(game, redNpc, remoteBlue), false);
    assert.equal(Game.prototype.isHostileTarget.call({ gameState: GAME_MODE.SOLO }, redNpc, otherRedNpc), true);
});

test('Experimental projectile collision applies the same color hostility rule', () => {
    const owner = Object.assign(new Player(0, 0, 2, '#f00'), { isNPC: true, roomId: 'one' });
    const friendly = Object.assign(new Player(0, 0, 3, '#f00'), { isNPC: true, roomId: 'one' });
    const enemy = Object.assign(new Player(0, 0, 4, '#00f'), { isNPC: true, roomId: 'one' });
    const shot = Object.assign(new Projectile(0, 0, 0, 0), { owner, roomId: 'one' });
    const damaged = [];
    const game = {
        gameState: GAME_MODE.EXPERIMENTAL, players: [owner, friendly, enemy], projectiles: [shot],
        asteroids: [], hazards: [], experimentalDoors: [], experimentalAreaIndexes: null,
        playerDeath(player) { damaged.push(player); }, removeProjectile() {},
        getExperimentalAreaEntities: Game.prototype.getExperimentalAreaEntities,
        getExperimentalCandidates: Game.prototype.getExperimentalCandidates,
        areExperimentalEntitiesCoLocated: Game.prototype.areExperimentalEntitiesCoLocated,
        isHostileTarget: Game.prototype.isHostileTarget
    };
    Game.prototype.checkCollisions.call(game);
    assert.deepEqual(damaged, [enemy]);
});

test('Experimental hallway and objective messages share sector styling with subordinate purge detail', () => {
    const calls = [];
    const ctx = { save() {}, restore() {}, fillText(text) { calls.push([text, this.font, this.fillStyle]); } };
    const game = {
        gameState: GAME_MODE.EXPERIMENTAL, players: [],
        experimentalObjectiveMessage: { lines: ['The Princess is in Sector 9!'] },
        experimentalSectorMessage: null
    };
    Game.prototype.showExperimentalHallwayMessage.call(game);
    Game.prototype.drawExperimentalMessages.call(game, ctx);
    assert.deepEqual(calls[0].slice(1), ['bold 42px "Courier New", monospace', '#ffffff']);
    assert.deepEqual(calls[1].slice(0, 2), ['Sector 0', 'bold 42px "Courier New", monospace']);
    assert.deepEqual(calls[2].slice(0, 2), ['Capsule Bonuses Purged', 'bold 26px "Courier New", monospace']);
});
